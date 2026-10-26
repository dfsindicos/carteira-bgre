import { z } from "zod";
import { prisma } from "./db";
import { aplicarPassos, dataSP, registrar, type NumeroPasso, type Tx } from "./avaliacoes";
import { gravarNotas, normalizar } from "./importacao";
import { MODELOS, TIPOS, calcular, formatarNota, formatarPeriodo, lerPeriodo, prazoPadrao, type Notas, type Tipo } from "./scorecard";

// Importação do JSON do artefato "Checklist Avaliações BGRE": checklist (4 passos com data), andamento e estimativa e,
// quando vierem "itens", também as notas e os comentários (os .zip do OneDrive ficaram grandes demais para a tela).
// Simular roda a mesma gravação numa transação desfeita no fim: o que a simulação mostra é o que a importação faz.

const data = z.iso.date();
const nota = z.number().min(0, "Nota de 0 a 100.").max(100, "Nota de 0 a 100.");

const esquemaAvaliacao = z.object({
  tipo: z.enum(TIPOS as [Tipo, ...Tipo[]]),
  condominio: z.string().trim().min(1).max(200),
  ano: z.number().int().min(2020).max(2100),
  trimestre: z.number().int().min(1).max(4),
  // Campo ausente = não mexe; null = desmarca ou apaga.
  passos: z.object({ "1": data.nullable(), "2": data.nullable(), "3": data.nullable(), "4": data.nullable() }).partial().optional(),
  andamento: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
  andamentoEm: data.nullable().optional(),
  estimativa: nota.nullable().optional(),
  itens: z
    .record(z.string().max(10), z.object({ nota: nota.nullable().optional(), comentario: z.string().max(2000).nullable().optional() }))
    .optional(),
  notaFinalPlanilha: nota.nullable().optional(),
  arquivo: z.string().max(200).nullable().optional(),
});
// Prédios que a importação cria se ainda não existirem (pedido do usuário de 2026-10-26: cadastrar junto com as notas).
const esquemaPredio = z.object({
  nome: z.string().trim().min(2).max(120),
  administradora: z.string().trim().min(2).max(120),
  avaliadoDesde: z.string().trim().refine((t) => !!lerPeriodo(t), "“avaliadoDesde” no formato 1T26.").nullable().optional(),
});
export const esquemaJson = z.object({
  cadastro: z.array(esquemaPredio).max(200).optional(),
  avaliacoes: z.array(esquemaAvaliacao).max(2000, "No máximo 2.000 avaliações por arquivo."),
});
export type EntradaJson = z.infer<typeof esquemaAvaliacao>;

/** Nome para casar com o cadastro: sem acento, caixa, pontuação e o texto entre parênteses ("Torre (CTN)" = "torre"). */
export const normalizarNome = (s: string) => normalizar(s.replace(/\([^)]*\)/g, " "));

/** Cadastro mais parecido, pelas palavras em comum (ou um nome contido no outro), para sugerir na simulação. */
export function candidato<T extends { nome: string }>(nome: string, lista: T[]): T | null {
  const a = normalizarNome(nome);
  const pa = new Set(a.split(" ").filter(Boolean));
  let melhor: T | null = null;
  let nota = 0;
  for (const c of lista) {
    const b = normalizarNome(c.nome);
    const pb = b.split(" ").filter(Boolean);
    let n = pb.filter((p) => pa.has(p)).length / Math.max(pa.size, pb.length, 1);
    if (a && b && (a.includes(b) || b.includes(a))) n = Math.max(n, 0.5);
    if (n > nota) [melhor, nota] = [c, n];
  }
  return melhor;
}

export type LinhaJson = {
  indice: number;
  tipo: Tipo;
  condominio: string;
  /** Nome normalizado: a chave de `escolhas`. */
  chave: string;
  periodo: string;
  condominioId?: string;
  condominioNome?: string;
  candidato?: { id: string; nome: string };
  acao: "nova" | "atualizar" | "sem mudança" | "escolher" | "ignorada" | "erro";
  mudancas: string[];
  avisos: string[];
  erro?: string;
};

class Desfazer extends Error {}
const meioDia = (d: string) => new Date(`${d}T12:00:00Z`); // 9h em São Paulo: o mesmo dia em qualquer fuso do Brasil

/** Aplica uma entrada do JSON na avaliação (criando vazia se preciso). Devolve o que mudou e os avisos. */
async function aplicar(tx: Tx, email: string, e: EntradaJson, condominioId: string, substituir: boolean) {
  const mudancas: string[] = [];
  const avisos: string[] = [];
  const periodo = { ano: e.ano, trimestre: e.trimestre };
  const origem = `${formatarPeriodo(periodo)}${e.tipo === "SINDICANCIA" ? " Sindicância" : ""} · ${e.arquivo || "JSON do checklist"}`;
  const chave = { condominioId_ano_trimestre_tipo: { condominioId, ...periodo, tipo: e.tipo } };
  let a = await tx.avaliacao.findUnique({ where: chave, include: { notas: true } });
  const nova = !a;
  if (!a) {
    a = await tx.avaliacao.create({ data: { condominioId, ...periodo, tipo: e.tipo, entregaAte: prazoPadrao(periodo) }, include: { notas: true } });
    await registrar(tx, email, "Avaliacao", a.id, "criada pela importação do checklist", null, origem);
    mudancas.push("avaliação criada");
  }

  if (e.itens) {
    const codigos = MODELOS[e.tipo].codigos;
    const notas: Notas = {};
    const comentarios: Record<string, string> = {};
    for (const [codigo, v] of Object.entries(e.itens)) {
      if (!codigos.includes(codigo)) {
        avisos.push(`Item ${codigo} não existe no Score Card da ${e.tipo === "SINDICANCIA" ? "Sindicância" : "Administradora"}: ignorado.`);
        continue;
      }
      notas[codigo] = typeof v.nota === "number" ? Math.round(v.nota * 100) / 100 : null;
      if (v.comentario) comentarios[codigo] = v.comentario;
    }
    const calculada = calcular(notas, e.tipo).final;
    if (typeof e.notaFinalPlanilha === "number" && calculada !== null && Math.abs(e.notaFinalPlanilha - calculada) > 0.1)
      avisos.push(`A planilha diz ${formatarNota(e.notaFinalPlanilha)}, o sistema calcula ${formatarNota(calculada)}.`);
    const r = await gravarNotas(tx, email, condominioId, { tipo: e.tipo, periodo, notas, comentarios, origem }, a, { substituir, entregue: false });
    if (r === "pulada") avisos.push("Já tem notas: notas puladas (marque “Substituir” para trocar).");
    else if (r !== "sem mudança") mudancas.push(r === "substituída" ? "notas substituídas" : "notas importadas");
    a = await tx.avaliacao.findUniqueOrThrow({ where: { id: a.id }, include: { notas: true } });
  }

  if (e.passos) {
    const desejado = Object.fromEntries(Object.entries(e.passos).map(([n, d]) => [Number(n), d ? meioDia(d) : null])) as Partial<Record<NumeroPasso, Date | null>>;
    const r = await aplicarPassos(tx, email, a, desejado, { exigirNotas: false });
    if (r.ok && r.mudou) mudancas.push("checklist");
  }

  const dados: Record<string, unknown> = {};
  if (e.andamento && e.andamento.join("\n") !== a.andamento.join("\n")) {
    dados.andamento = e.andamento;
    await registrar(tx, email, "Avaliacao", a.id, "andamento", a.andamento.join(" | ") || null, e.andamento.join(" | ") || null);
    mudancas.push("andamento");
  }
  if (e.andamentoEm !== undefined && (e.andamentoEm ?? null) !== (a.andamentoEm && a.andamentoEm.toISOString().slice(0, 10))) {
    dados.andamentoEm = e.andamentoEm ? new Date(`${e.andamentoEm}T00:00:00Z`) : null;
    await registrar(tx, email, "Avaliacao", a.id, "andamentoEm", a.andamentoEm?.toISOString().slice(0, 10), e.andamentoEm);
    if (!mudancas.includes("andamento")) mudancas.push("andamento");
  } else if (dados.andamento && e.andamentoEm === undefined) dados.andamentoEm = new Date(`${dataSP(new Date())}T00:00:00Z`);
  const estimativaAntes = a.estimativa === null ? null : Number(a.estimativa);
  if (e.estimativa !== undefined && e.estimativa !== estimativaAntes) {
    dados.estimativa = e.estimativa;
    await registrar(tx, email, "Avaliacao", a.id, "estimativa", estimativaAntes, e.estimativa);
    mudancas.push("estimativa");
  }
  if (Object.keys(dados).length) await tx.avaliacao.update({ where: { id: a.id }, data: dados });
  if (mudancas.length && !nova) await registrar(tx, email, "Avaliacao", a.id, "importação do checklist", null, origem);
  return { mudancas, avisos, nova };
}

/**
 * Simula (gravar = false) ou importa o JSON. `escolhas` liga o nome normalizado que não casou a um condomínio (id) ou a
 * "ignorar"; sem escolha, a linha fica "escolher" e não grava. Cada avaliação numa transação própria.
 */
export async function importarJson(
  email: string,
  bruto: unknown,
  { escolhas = {}, substituir = false, gravar = false }: { escolhas?: Record<string, string>; substituir?: boolean; gravar?: boolean },
) {
  const v = esquemaJson.safeParse(bruto);
  if (!v.success) {
    const i = v.error.issues[0];
    return { erro: `JSON fora do formato${i?.path.length ? ` em ${i.path.join(".")}` : ""}: ${i?.message ?? "inválido"}.` };
  }
  // Prédios do "cadastro" que ainda não existem: criados (com a administradora, se faltar) antes das avaliações; na
  // simulação só são listados, e as avaliações deles aparecem como "nova".
  const existentes = await prisma.condominio.findMany({ select: { nome: true } });
  const jaTem = new Set(existentes.map((c) => normalizarNome(c.nome)));
  const novos = (v.data.cadastro ?? []).filter((p, i, l) => !jaTem.has(normalizarNome(p.nome)) && l.findIndex((q) => normalizarNome(q.nome) === normalizarNome(p.nome)) === i);
  if (gravar)
    for (const p of novos)
      await prisma.$transaction(async (tx) => {
        const adms = await tx.administradora.findMany({ select: { id: true, nome: true } });
        let adm = adms.find((a) => normalizarNome(a.nome) === normalizarNome(p.administradora));
        if (!adm) {
          adm = await tx.administradora.create({ data: { nome: p.administradora, emails: "" } });
          await registrar(tx, email, "Administradora", adm.id, "criada pela importação", null, p.administradora);
        }
        const desde = p.avaliadoDesde ? lerPeriodo(p.avaliadoDesde) : null;
        const c = await tx.condominio.create({
          data: { nome: p.nome, administradoraId: adm.id, ativo: true, avaliadoDesdeAno: desde?.ano ?? null, avaliadoDesdeTrimestre: desde?.trimestre ?? null },
        });
        await registrar(tx, email, "Condominio", c.id, "criado pela importação", null, `${p.nome} · ${adm.nome}${desde ? ` · desde ${formatarPeriodo(desde)}` : ""}`);
      });
  const aCriar = gravar ? new Set<string>() : new Set(novos.map((p) => normalizarNome(p.nome)));

  const condominios = await prisma.condominio.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } });
  const porNome = new Map(condominios.map((c) => [normalizarNome(c.nome), c]));
  const linhas: LinhaJson[] = [];

  for (const [indice, e] of v.data.avaliacoes.entries()) {
    const chave = normalizarNome(e.condominio);
    const linha: LinhaJson = { indice, tipo: e.tipo, condominio: e.condominio, chave, periodo: formatarPeriodo(e), acao: "escolher", mudancas: [], avisos: [] };
    const escolha = escolhas[chave];
    const c = porNome.get(chave) ?? condominios.find((x) => x.id === escolha);
    if (!c && aCriar.has(chave)) {
      linhas.push({ ...linha, condominioNome: e.condominio, acao: "nova", mudancas: ["prédio novo, criado pela importação"] });
      continue;
    }
    if (!c) {
      const sugestao = candidato(e.condominio, condominios);
      if (sugestao) linha.candidato = sugestao;
      linha.acao = escolha === "ignorar" ? "ignorada" : "escolher";
      linhas.push(linha);
      continue;
    }
    linha.condominioId = c.id;
    linha.condominioNome = c.nome;
    try {
      const r = await prisma
        .$transaction(
          async (tx) => {
            const r = await aplicar(tx, email, e, c.id, substituir);
            if (!gravar) throw new Desfazer(JSON.stringify(r));
            return r;
          },
          { timeout: 20_000 },
        )
        .catch((err) => {
          if (err instanceof Desfazer) return JSON.parse(err.message) as Awaited<ReturnType<typeof aplicar>>;
          throw err;
        });
      Object.assign(linha, { mudancas: r.mudancas, avisos: r.avisos, acao: r.nova ? "nova" : r.mudancas.length ? "atualizar" : "sem mudança" });
    } catch (err) {
      console.error("[importar-json] falha:", e.condominio, formatarPeriodo(e), err instanceof Error ? err.message : err);
      Object.assign(linha, { acao: "erro", erro: "Falha ao gravar esta avaliação; as outras seguiram." });
    }
    linhas.push(linha);
  }
  return { linhas, condominios, temNotas: v.data.avaliacoes.some((e) => !!e.itens), prediosNovos: novos.map((p) => p.nome) };
}

