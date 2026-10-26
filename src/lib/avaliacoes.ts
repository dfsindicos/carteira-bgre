import { z } from "zod";
import { prisma } from "./db";
import {
  MODELOS,
  calcular,
  esquemaNota,
  formatarPeriodo,
  periodoAnterior,
  prazoPadrao,
  type Notas,
  type Periodo,
  type Tipo,
} from "./scorecard";

// Regras da avaliação trimestral. As server actions (src/app/acoes.ts) só leem a sessão e chamam estas funções com o
// e-mail de quem está mexendo: assim os testes exercitam a mesma regra sem precisar de cookie.

export type Resposta = { ok: true } | { ok: false; erro: string };
const falha = (erro: string): Resposta => ({ ok: false, erro });

const esquemaPeriodo = z.object({ ano: z.number().int().min(2020).max(2100), trimestre: z.number().int().min(1).max(4) });

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export async function registrar(tx: Tx, email: string, entidade: string, entidadeId: string, campo: string, antes: unknown, depois: unknown) {
  const txt = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
  await tx.logAlteracao.create({ data: { email, entidade, entidadeId, campo, antes: txt(antes), depois: txt(depois) } });
}

export const paraNotas = (notas: { item: string; nota: unknown }[]): Notas =>
  Object.fromEntries(notas.map((n) => [n.item, n.nota === null ? null : Number(n.nota)]));

/** Data (AAAA-MM-DD) no fuso de São Paulo, para comparar e mostrar dias. */
export const dataSP = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);

// ── Checklist do trimestre ────────────────────────────────────────────────────────────────────────────────────────
// Quatro passos por avaliação, cada um com a data e quem marcou. O passo 4 ("Enviada à BGRE") é o status ENTREGUE, com
// a data em entregueEm: marcar o passo 4 trava a edição das notas, desmarcar libera.

export const NUMEROS_PASSOS = [1, 2, 3, 4] as const;
export type NumeroPasso = (typeof NUMEROS_PASSOS)[number];
const COLUNAS = {
  1: ["passo1Em", "passo1Por"],
  2: ["passo2Em", "passo2Por"],
  3: ["passo3Em", "passo3Por"],
  4: ["entregueEm", "passo4Por"],
} as const;

type ComPassos = { [K in (typeof COLUNAS)[NumeroPasso][0]]: Date | null } & { [K in (typeof COLUNAS)[NumeroPasso][1]]: string | null };
export type MarcaPasso = { em: Date; por: string | null } | null;

export const passosDe = (a: ComPassos): MarcaPasso[] =>
  NUMEROS_PASSOS.map((n) => {
    const em = a[COLUNAS[n][0]];
    return em ? { em, por: a[COLUNAS[n][1]] } : null;
  });

/** Concluída = 4 de 4 passos; em andamento = de 1 a 3; a fazer = nenhum. */
export const estadoPorPassos = (feitos: number) => (feitos === 4 ? "concluida" : feitos > 0 ? "andamento" : "a-fazer");

/**
 * Põe os passos no estado pedido (data ou null). Passo já marcado no mesmo dia não muda; cada mudança grava
 * LogAlteracao ("passo N", antes e depois em AAAA-MM-DD), e o passo 4 também o "status". Usado pela tela e pela
 * importação do checklist (que traz as datas e não exige as notas).
 */
export async function aplicarPassos(
  tx: Tx,
  email: string,
  a: ComPassos & { id: string; status: string; tipo: Tipo; notas: { item: string; nota: unknown }[] },
  desejado: Partial<Record<NumeroPasso, Date | null>>,
  { exigirNotas = true } = {},
): Promise<Resposta & { mudou?: boolean }> {
  const data: Record<string, unknown> = {};
  const logs: [string, unknown, unknown][] = [];
  for (const n of NUMEROS_PASSOS) {
    if (!(n in desejado)) continue;
    const [colEm, colPor] = COLUNAS[n];
    const antes = a[colEm];
    const depois = desejado[n] ?? null;
    if ((antes && depois && dataSP(antes) === dataSP(depois)) || (!antes && !depois)) continue;
    if (n === 4 && depois && exigirNotas) {
      const { faltam } = calcular(paraNotas(a.notas), a.tipo);
      if (faltam) return falha(`Faltam ${faltam} ${faltam === 1 ? "nota" : "notas"} para entregar.`);
    }
    data[colEm] = depois;
    data[colPor] = depois ? email : null;
    logs.push([`passo ${n}`, antes && dataSP(antes), depois && dataSP(depois)]);
    if (n === 4) {
      const status = depois ? "ENTREGUE" : "RASCUNHO";
      data.status = status;
      if (status !== a.status) logs.push(["status", a.status, status]);
    }
  }
  if (!logs.length) return { ok: true, mudou: false };
  await tx.avaliacao.update({ where: { id: a.id }, data });
  for (const [campo, antes, depois] of logs) await registrar(tx, email, "Avaliacao", a.id, campo, antes, depois);
  return { ok: true, mudou: true };
}

const esquemaPassos = z.object({ avaliacaoId: z.string().min(1), passos: z.array(z.union(NUMEROS_PASSOS.map((n) => z.literal(n)))).min(1), marcado: z.boolean() });

/** Marca ou desmarca passos do checklist ("Marcar tudo como feito" = os 4; "Limpar" = desmarca os 4). */
export async function marcarPassos(email: string, avaliacaoId: string, passos: NumeroPasso[], marcado: boolean): Promise<Resposta> {
  const e = esquemaPassos.safeParse({ avaliacaoId, passos, marcado });
  if (!e.success) return falha("Dados inválidos.");
  return prisma.$transaction(async (tx) => {
    // Trava a linha: uma nota gravando ao mesmo tempo espera, e não entra nota depois do passo 4.
    await tx.$queryRaw`SELECT id FROM "Avaliacao" WHERE id = ${avaliacaoId} FOR UPDATE`;
    const a = await tx.avaliacao.findUnique({ where: { id: avaliacaoId }, include: { notas: true } });
    if (!a) return falha("Avaliação não encontrada.");
    const agora = new Date();
    const desejado = Object.fromEntries(e.data.passos.map((n) => [n, marcado ? (a[COLUNAS[n][0]] ?? agora) : null]));
    const { ok, ...r } = await aplicarPassos(tx, email, a, desejado);
    return ok ? { ok } : { ok, erro: (r as { erro: string }).erro };
  });
}

/** Entregar = marcar o passo 4 (exige todas as notas); reabrir = desmarcar. */
export const mudarStatus = (email: string, avaliacaoId: string, status: "ENTREGUE" | "RASCUNHO") =>
  marcarPassos(email, avaliacaoId, [4], status === "ENTREGUE");

// ── Andamento e estimativa ─────────────────────────────────────────────────────────────────────────────────────────

export const esquemaAndamento = z.array(z.string().trim().min(1).max(500)).max(30);

const esquemaAcompanhamento = z.object({
  avaliacaoId: z.string().min(1),
  // Uma anotação por linha.
  andamento: z
    .string()
    .max(15_000)
    .transform((s) => s.split("\n").map((l) => l.trim()).filter(Boolean))
    .pipe(z.array(z.string().max(500, "Cada anotação tem no máximo 500 caracteres.")).max(30, "No máximo 30 anotações.")),
  estimativa: esquemaNota,
});

/** Grava as anotações de andamento (com a data de hoje, se mudaram) e a nota estimada. Não trava com o passo 4. */
export async function salvarAcompanhamento(email: string, entrada: z.input<typeof esquemaAcompanhamento>): Promise<Resposta> {
  const e = esquemaAcompanhamento.safeParse(entrada);
  if (!e.success) return falha(e.error.issues[0]?.message ?? "Dados inválidos.");
  const { avaliacaoId, andamento, estimativa } = e.data;
  return prisma.$transaction(async (tx) => {
    const a = await tx.avaliacao.findUnique({ where: { id: avaliacaoId } });
    if (!a) return falha("Avaliação não encontrada.");
    const antes = { andamento: a.andamento, estimativa: a.estimativa === null ? null : Number(a.estimativa) };
    const data: Record<string, unknown> = {};
    if (antes.andamento.join("\n") !== andamento.join("\n")) {
      data.andamento = andamento;
      data.andamentoEm = andamento.length ? new Date(`${dataSP(new Date())}T00:00:00Z`) : null;
      await registrar(tx, email, "Avaliacao", a.id, "andamento", antes.andamento.join(" | ") || null, andamento.join(" | ") || null);
    }
    if (antes.estimativa !== estimativa) {
      data.estimativa = estimativa;
      await registrar(tx, email, "Avaliacao", a.id, "estimativa", antes.estimativa, estimativa);
    }
    if (Object.keys(data).length) await tx.avaliacao.update({ where: { id: a.id }, data });
    return { ok: true } as const;
  });
}

/** Cria a avaliação do trimestre (ou devolve a que já existe). Prazo padrão: último dia do mês seguinte. */
export async function criarAvaliacao(email: string, condominioId: string, periodo: Periodo, tipo: Tipo = "ADMINISTRADORA") {
  const p = esquemaPeriodo.parse(periodo);
  const t = z.enum(["ADMINISTRADORA", "SINDICANCIA"]).parse(tipo);
  const existente = await prisma.avaliacao.findUnique({ where: { condominioId_ano_trimestre_tipo: { condominioId, ...p, tipo: t } } });
  if (existente) return existente;
  return prisma.$transaction(async (tx) => {
    const a = await tx.avaliacao.create({ data: { condominioId, ...p, tipo: t, entregaAte: prazoPadrao(p) } });
    await registrar(tx, email, "Avaliacao", a.id, "criada", null, `${formatarPeriodo(p)} ${MODELOS[t].nome}`);
    return a;
  });
}

const esquemaCampo = z.object({
  avaliacaoId: z.string().min(1),
  item: z.string().regex(/^\d+(\.\d+)+$/),
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
    const [a] = await tx.$queryRaw<{ status: string; tipo: Tipo }[]>`SELECT status, tipo FROM "Avaliacao" WHERE id = ${avaliacaoId} FOR UPDATE`;
    if (!a) return falha("Avaliação não encontrada.");
    if (!MODELOS[a.tipo].codigos.includes(item)) return falha("Item não existe neste Score Card.");
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
export async function carregarAvaliacao(condominioId: string, periodo: Periodo, tipo: Tipo = "ADMINISTRADORA") {
  const condominio = await prisma.condominio.findUnique({ where: { id: condominioId }, include: { administradora: true } });
  if (!condominio) return null;
  const a = await prisma.avaliacao.findUnique({
    where: { condominioId_ano_trimestre_tipo: { condominioId, ...periodo, tipo } },
    include: { notas: true },
  });
  const avaliacao = a && {
    ...a,
    estimativa: a.estimativa === null ? null : Number(a.estimativa),
    passos: passosDe(a),
    notas: paraNotas(a.notas),
    comentarios: Object.fromEntries(a.notas.map((n) => [n.item, n.comentario])) as Record<string, string>,
  };
  return { condominio, avaliacao };
}

/** Lista do trimestre: condomínios ativos (e os inativos que têm avaliação nele), com status e nota de cada um. */
export async function listarTrimestre(periodo: Periodo, tipo: Tipo = "ADMINISTRADORA") {
  const condominios = await prisma.condominio.findMany({
    where: { OR: [{ ativo: true }, { avaliacoes: { some: { ...periodo, tipo } } }] },
    include: { administradora: true, avaliacoes: { where: { ...periodo, tipo }, include: { notas: true } } },
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
      feitos: a ? passosDe(a).filter(Boolean).length : 0,
      resultado: a ? calcular(paraNotas(a.notas), tipo) : null,
    };
  });
}

/**
 * Painel: o trimestre de referência é o mais recente com alguma nota final da Administradora. Para cada condomínio
 * ativo, a nota final nele, a diferença contra o anterior e a nota da Sindicância no mesmo trimestre. Os piores
 * primeiro; quem não tem nota fica no topo (é o que pede ação).
 */
export async function painel(emAvaliacao: Periodo) {
  // shortcut: lê todas as avaliações e calcula em memória (40 condomínios × 4 trimestres por ano é pouco); se pesar, filtrar pelos últimos trimestres.
  const avaliacoes = await prisma.avaliacao.findMany({ include: { notas: true } });
  const finais = new Map<string, number>(); // "tipo condominioId ano trimestre" → nota final
  let ref: Periodo | null = null;
  for (const a of avaliacoes) {
    const { final } = calcular(paraNotas(a.notas), a.tipo);
    if (final === null) continue;
    finais.set(`${a.tipo} ${a.condominioId} ${a.ano} ${a.trimestre}`, final);
    if (a.tipo !== "ADMINISTRADORA") continue;
    if (!ref || a.ano * 4 + a.trimestre > ref.ano * 4 + ref.trimestre) ref = { ano: a.ano, trimestre: a.trimestre };
  }
  const ant = ref && periodoAnterior(ref);
  const condominios = await prisma.condominio.findMany({ where: { ativo: true }, include: { administradora: true }, orderBy: { nome: "asc" } });
  const linhas = condominios
    .map((c) => {
      const nota = ref ? (finais.get(`ADMINISTRADORA ${c.id} ${ref.ano} ${ref.trimestre}`) ?? null) : null;
      const anterior = ant ? (finais.get(`ADMINISTRADORA ${c.id} ${ant.ano} ${ant.trimestre}`) ?? null) : null;
      const sindicancia = ref ? (finais.get(`SINDICANCIA ${c.id} ${ref.ano} ${ref.trimestre}`) ?? null) : null;
      return { id: c.id, nome: c.nome, administradora: c.administradora.nome, nota, sindicancia, diferenca: nota !== null && anterior !== null ? nota - anterior : null };
    })
    .sort((x, y) => (x.nota ?? -1) - (y.nota ?? -1));
  const comNota = linhas.filter((l) => l.nota !== null);
  const media = comNota.length ? comNota.reduce((s, l) => s + (l.nota as number), 0) / comNota.length : null;
  const rascunhos = avaliacoes.filter((a) => a.ano === emAvaliacao.ano && a.trimestre === emAvaliacao.trimestre && a.tipo === "ADMINISTRADORA" && a.status === "RASCUNHO").length;
  return { referencia: ref, anterior: ant, media, ativos: condominios.length, rascunhos, linhas };
}

