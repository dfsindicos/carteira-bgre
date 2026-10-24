import { z } from "zod";
import { prisma } from "./db";
import {
  CODIGOS,
  calcular,
  esquemaNota,
  formatarPeriodo,
  periodoAnterior,
  prazoPadrao,
  type Notas,
  type Periodo,
} from "./scorecard";

// Regras da avaliação trimestral. As server actions (src/app/acoes.ts) só leem a sessão e chamam estas funções com o
// e-mail de quem está mexendo: assim os testes exercitam a mesma regra sem precisar de cookie.

export type Resposta = { ok: true } | { ok: false; erro: string };
const falha = (erro: string): Resposta => ({ ok: false, erro });

const esquemaPeriodo = z.object({ ano: z.number().int().min(2020).max(2100), trimestre: z.number().int().min(1).max(4) });

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
async function registrar(tx: Tx, email: string, entidade: string, entidadeId: string, campo: string, antes: unknown, depois: unknown) {
  const txt = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
  await tx.logAlteracao.create({ data: { email, entidade, entidadeId, campo, antes: txt(antes), depois: txt(depois) } });
}

const paraNotas = (notas: { item: string; nota: unknown }[]): Notas =>
  Object.fromEntries(notas.map((n) => [n.item, n.nota === null ? null : Number(n.nota)]));

/** Cria a avaliação do trimestre (ou devolve a que já existe). Prazo padrão: último dia do mês seguinte. */
export async function criarAvaliacao(email: string, condominioId: string, periodo: Periodo) {
  const p = esquemaPeriodo.parse(periodo);
  const existente = await prisma.avaliacao.findUnique({ where: { condominioId_ano_trimestre: { condominioId, ...p } } });
  if (existente) return existente;
  return prisma.$transaction(async (tx) => {
    const a = await tx.avaliacao.create({ data: { condominioId, ...p, entregaAte: prazoPadrao(p) } });
    await registrar(tx, email, "Avaliacao", a.id, "criada", null, formatarPeriodo(p));
    return a;
  });
}

const esquemaCampo = z.object({
  avaliacaoId: z.string().min(1),
  item: z.enum(CODIGOS as [string, ...string[]]),
  campo: z.enum(["nota", "comentario"]),
  valor: z.string().max(2000),
});

/** Grava uma nota ou um comentário (um campo por vez, como a grade do Action Log). Avaliação entregue não muda. */
export async function salvarCampo(email: string, entrada: { avaliacaoId: string; item: string; campo: "nota" | "comentario"; valor: string }): Promise<Resposta> {
  const e = esquemaCampo.safeParse(entrada);
  if (!e.success) return falha("Dados inválidos.");
  const { avaliacaoId, item, campo } = e.data;
  let valor: number | string | null = e.data.valor.trim();
  if (campo === "nota") {
    const n = esquemaNota.safeParse(e.data.valor);
    if (!n.success) return falha(n.error.issues[0]?.message ?? "Nota inválida.");
    valor = n.data;
  }

  return prisma.$transaction(async (tx) => {
    // Trava a linha da avaliação: "Marcar como entregue" ao mesmo tempo espera esta gravação terminar.
    const [a] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "Avaliacao" WHERE id = ${avaliacaoId} FOR UPDATE`;
    if (!a) return falha("Avaliação não encontrada.");
    if (a.status === "ENTREGUE") return falha("Avaliação entregue: reabra para editar.");
    const atual = await tx.notaItem.findUnique({ where: { avaliacaoId_item: { avaliacaoId, item } } });
    const antes = campo === "nota" ? (atual?.nota == null ? null : Number(atual.nota)) : (atual?.comentario ?? "");
    if (antes === valor) return { ok: true } as const;
    await tx.notaItem.upsert({
      where: { avaliacaoId_item: { avaliacaoId, item } },
      create: { avaliacaoId, item, [campo]: valor },
      update: { [campo]: valor },
    });
    await tx.avaliacao.update({ where: { id: avaliacaoId }, data: { atualizadoEm: new Date() } });
    await registrar(tx, email, "Avaliacao", avaliacaoId, `${item} ${campo === "nota" ? "nota" : "comentário"}`, antes, valor);
    return { ok: true } as const;
  });
}

/** Entregar bloqueia a edição; reabrir libera. Entregar exige as 16 notas (a planilha da BGRE vai completa). */
export async function mudarStatus(email: string, avaliacaoId: string, status: "ENTREGUE" | "RASCUNHO"): Promise<Resposta> {
  return prisma.$transaction(async (tx) => {
    const a = await tx.avaliacao.findUnique({ where: { id: avaliacaoId }, include: { notas: true } });
    if (!a) return falha("Avaliação não encontrada.");
    if (a.status === status) return { ok: true } as const;
    if (status === "ENTREGUE") {
      const { faltam } = calcular(paraNotas(a.notas));
      if (faltam) return falha(`Faltam ${faltam} ${faltam === 1 ? "nota" : "notas"} para entregar.`);
    }
    await tx.avaliacao.update({ where: { id: a.id }, data: { status, entregueEm: status === "ENTREGUE" ? new Date() : null } });
    await registrar(tx, email, "Avaliacao", a.id, "status", a.status, status);
    return { ok: true } as const;
  });
}

const esquemaPrazo = z.union([z.literal(""), z.iso.date()]);

export async function mudarPrazo(email: string, avaliacaoId: string, texto: string): Promise<Resposta> {
  const d = esquemaPrazo.safeParse(texto);
  if (!d.success) return falha("Data inválida.");
  const nova = d.data ? new Date(`${d.data}T00:00:00Z`) : null;
  return prisma.$transaction(async (tx) => {
    const a = await tx.avaliacao.findUnique({ where: { id: avaliacaoId } });
    if (!a) return falha("Avaliação não encontrada.");
    if (a.status === "ENTREGUE") return falha("Avaliação entregue: reabra para editar.");
    if (a.entregaAte?.getTime() === nova?.getTime()) return { ok: true } as const;
    await tx.avaliacao.update({ where: { id: a.id }, data: { entregaAte: nova } });
    await registrar(tx, email, "Avaliacao", a.id, "entregaAte", a.entregaAte, nova);
    return { ok: true } as const;
  });
}

/** Avaliação de um condomínio num trimestre, com as notas em número (ou null se ainda não foi criada). */
export async function carregarAvaliacao(condominioId: string, periodo: Periodo) {
  const condominio = await prisma.condominio.findUnique({ where: { id: condominioId }, include: { administradora: true } });
  if (!condominio) return null;
  const a = await prisma.avaliacao.findUnique({
    where: { condominioId_ano_trimestre: { condominioId, ...periodo } },
    include: { notas: true },
  });
  const avaliacao = a && {
    ...a,
    notas: paraNotas(a.notas),
    comentarios: Object.fromEntries(a.notas.map((n) => [n.item, n.comentario])) as Record<string, string>,
  };
  return { condominio, avaliacao };
}

/** Lista do trimestre: condomínios ativos (e os inativos que têm avaliação nele), com status e nota de cada um. */
export async function listarTrimestre(periodo: Periodo) {
  const condominios = await prisma.condominio.findMany({
    where: { OR: [{ ativo: true }, { avaliacoes: { some: periodo } }] },
    include: { administradora: true, avaliacoes: { where: periodo, include: { notas: true } } },
    orderBy: { nome: "asc" },
  });
  return condominios.map((c) => {
    const a = c.avaliacoes[0];
    return {
      id: c.id,
      nome: c.nome,
      ativo: c.ativo,
      administradora: c.administradora.nome,
      status: a?.status ?? null,
      resultado: a ? calcular(paraNotas(a.notas)) : null,
    };
  });
}

/**
 * Painel: o trimestre de referência é o mais recente com alguma nota final. Para cada condomínio ativo, a nota final
 * nele e a diferença contra o anterior. Os piores primeiro; quem não tem nota fica no topo (é o que pede ação).
 */
export async function painel(emAvaliacao: Periodo) {
  // shortcut: lê todas as avaliações e calcula em memória (40 condomínios × 4 trimestres por ano é pouco); se pesar, filtrar pelos últimos trimestres.
  const avaliacoes = await prisma.avaliacao.findMany({ include: { notas: true } });
  const finais = new Map<string, number>(); // "condominioId ano trimestre" → nota final
  let ref: Periodo | null = null;
  for (const a of avaliacoes) {
    const { final } = calcular(paraNotas(a.notas));
    if (final === null) continue;
    finais.set(`${a.condominioId} ${a.ano} ${a.trimestre}`, final);
    if (!ref || a.ano * 4 + a.trimestre > ref.ano * 4 + ref.trimestre) ref = { ano: a.ano, trimestre: a.trimestre };
  }
  const ant = ref && periodoAnterior(ref);
  const condominios = await prisma.condominio.findMany({ where: { ativo: true }, include: { administradora: true }, orderBy: { nome: "asc" } });
  const linhas = condominios
    .map((c) => {
      const nota = ref ? (finais.get(`${c.id} ${ref.ano} ${ref.trimestre}`) ?? null) : null;
      const anterior = ant ? (finais.get(`${c.id} ${ant.ano} ${ant.trimestre}`) ?? null) : null;
      return { id: c.id, nome: c.nome, administradora: c.administradora.nome, nota, diferenca: nota !== null && anterior !== null ? nota - anterior : null };
    })
    .sort((x, y) => (x.nota ?? -1) - (y.nota ?? -1));
  const comNota = linhas.filter((l) => l.nota !== null);
  const media = comNota.length ? comNota.reduce((s, l) => s + (l.nota as number), 0) / comNota.length : null;
  const rascunhos = avaliacoes.filter((a) => a.ano === emAvaliacao.ano && a.trimestre === emAvaliacao.trimestre && a.status === "RASCUNHO").length;
  return { referencia: ref, anterior: ant, media, ativos: condominios.length, rascunhos, linhas };
}

