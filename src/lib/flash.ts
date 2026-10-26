import { z } from "zod";
import { prisma } from "./db";
import { registrar } from "./avaliacoes";
import { normalizarNome } from "./importacao-json";

// Flash Report semanal da carteira (pedido do usuário de 2026-10-26: "igual ao artefato"). Os dados chegam no formato
// `DATA` do artefato antigo, pela rotina (/api/integracao/flash, com FLASH_TOKEN) ou pela tela Importar; o painel
// (public/flash.html, o mesmo do artefato) lê de volta pelo /flash/dados.js.

// O painel monta HTML com o texto; o executivo usa <b> e <p> de propósito. Qualquer outra tag vira "‹", para um e-mail
// copiado no relatório nunca virar script na página.
export const limparHtml = (s: string) => s.replace(/<(?!\/?(?:b|i|p|br)>)/gi, "‹");
const texto = (max = 5000) => z.string().max(max).transform(limparHtml);
const slug = z.string().regex(/^[a-z0-9-]{1,40}$/, "slug com letras minúsculas, números e hífen");
const dia = z.iso.date();
const evento = z.object({ d: z.string().max(10), t: texto(), ret: z.boolean().optional() });

const esquemaSemana = z.object({
  ini: dia,
  fim: dia,
  bgre: z.boolean().default(false),
  rec: z.string().max(40).nullable().optional(),
  no_prazo: z.boolean().nullable().optional(),
  sev: z.enum(["alta", "media", "baixa"]),
  resumo: texto(),
  motivo: texto().default(""),
  atencao: z.array(texto()).max(50).default([]),
  pend: z.array(texto()).max(50).default([]),
  energia: z.array(evento).max(100).default([]),
  elevadores: z.array(evento).max(100).default([]),
  seguranca: z.array(evento).max(100).default([]),
  n_medico: z.number().int().min(0).max(1000).default(0),
  chuvas: z.array(evento).max(100).default([]),
  lim: texto().optional(),
});
const cor = z.enum(["alta", "media", "baixa", "c1", "c2", "c3", "c4"]);
const esquemaExec = z.object({
  manchetes: z
    .array(z.object({ c: cor, ic: z.enum(["alert", "bolt", "drop", "clock"]), t: texto(500) }))
    .max(20)
    .default([]),
  prioridades: z
    .array(
      z.object({
        sev: z.enum(["alta", "media", "baixa"]),
        condos: z.array(slug).max(20),
        num: texto(40),
        numl: texto(200),
        t: texto(300),
        fatos: z.array(texto(500)).max(10).default([]),
        act: texto(500).default(""),
      }),
    )
    .max(30)
    .default([]),
  temas: z
    .array(z.object({ t: texto(300), num: texto(40), numl: texto(200), p: texto(1000), condos: z.array(slug).max(20), good: z.boolean().optional() }))
    .max(30)
    .default([]),
  datas: z
    .array(z.object({ iso: dia, d: texto(40), aprox: z.boolean().optional(), c: slug, o: texto(300), s: texto(500) }))
    .max(100)
    .default([]),
  metodo: texto(20_000).default(""),
});
export const esquemaFlash = z.object({
  condos: z
    .array(z.object({ slug, nome: texto(120), adm: texto(120), formato: texto(300).default("") }))
    .min(1)
    .max(100),
  weeks: z.array(dia).max(600),
  entries: z.record(slug, z.record(dia, esquemaSemana)),
  cobertos: z.record(slug, z.record(dia, dia)).default({}),
  exec: esquemaExec,
  geradoEm: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, "geradoEm no formato DD/MM/AAAA"),
  siglas: z.record(slug, z.string().max(4).transform(limparHtml)).default({}),
});
export type DadosFlash = z.infer<typeof esquemaFlash>;

export type ResultadoFlash = {
  predios: { slug: string; nome: string; cadastro: string; novo: boolean }[];
  semanas: { novas: number; atualizadas: number; iguais: number };
};

class Desfazer extends Error {}
// O JSONB do Postgres reordena as chaves: comparar com as chaves em ordem.
const estavel = (v: unknown) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x,
  );

/**
 * Grava (ou simula, numa transação desfeita) o painel inteiro. O prédio é achado pelo slug já ligado, depois pelo nome
 * (sem acento, caixa, pontuação e parênteses; ou um nome contido no outro, se só um bater); quem não existir é criado
 * com a administradora. Semana já gravada é substituída; semana que não veio fica como estava.
 */
export async function gravarFlash(email: string, bruto: unknown, { gravar = false } = {}): Promise<ResultadoFlash | { erro: string }> {
  const v = esquemaFlash.safeParse(bruto);
  if (!v.success) {
    const i = v.error.issues[0];
    return { erro: `Dados fora do formato${i?.path.length ? ` em ${i.path.join(".")}` : ""}: ${i?.message ?? "inválido"}.` };
  }
  const d = v.data;
  const slugs = new Set(d.condos.map((c) => c.slug));
  const solto = Object.keys(d.entries).find((s) => !slugs.has(s));
  if (solto) return { erro: `“${solto}” tem semanas mas não está em condos.` };

  try {
    return await prisma.$transaction(
      async (tx) => {
        const r: ResultadoFlash = { predios: [], semanas: { novas: 0, atualizadas: 0, iguais: 0 } };
        const ids = new Map<string, string>();
        for (const p of d.condos) {
          const cadastro = await tx.condominio.findMany({ select: { id: true, nome: true, flashSlug: true } });
          const a = normalizarNome(p.nome);
          const contidos = cadastro.filter((c) => !c.flashSlug && a && (a.includes(normalizarNome(c.nome)) || normalizarNome(c.nome).includes(a)));
          let c =
            cadastro.find((c) => c.flashSlug === p.slug) ??
            cadastro.find((c) => !c.flashSlug && normalizarNome(c.nome) === a) ??
            (contidos.length === 1 ? contidos[0] : undefined);
          const novo = !c;
          if (!c) {
            let adm = (await tx.administradora.findMany({ select: { id: true, nome: true } })).find((x) => normalizarNome(x.nome) === normalizarNome(p.adm));
            if (!adm) {
              adm = await tx.administradora.create({ data: { nome: p.adm, emails: "" }, select: { id: true, nome: true } });
              await registrar(tx, email, "Administradora", adm.id, "criada pela importação do Flash Report", null, p.adm);
            }
            // Inativo: entra no Flash Report sem entrar no Score Card; o Cadastro reativa se a BGRE passar a avaliá-lo.
            c = await tx.condominio.create({
              data: { nome: p.nome, administradoraId: adm.id, flashSlug: p.slug, ativo: false },
              select: { id: true, nome: true, flashSlug: true },
            });
            await registrar(tx, email, "Condominio", c.id, "criado pela importação do Flash Report", null, `${p.nome} · ${adm.nome} · inativo no Score Card`);
          } else if (c.flashSlug !== p.slug) {
            await tx.condominio.update({ where: { id: c.id }, data: { flashSlug: p.slug } });
            await registrar(tx, email, "Condominio", c.id, "flashSlug", c.flashSlug, p.slug);
          }
          ids.set(p.slug, c.id);
          r.predios.push({ slug: p.slug, nome: p.nome, cadastro: c.nome, novo });
        }

        for (const [s, semanas] of Object.entries(d.entries)) {
          const condominioId = ids.get(s)!;
          const antes = new Map(
            (await tx.flashSemana.findMany({ where: { condominioId }, select: { semana: true, dados: true } })).map((x) => [
              x.semana.toISOString().slice(0, 10),
              estavel(x.dados),
            ]),
          );
          for (const [semana, dados] of Object.entries(semanas)) {
            const anterior = antes.get(semana);
            if (anterior === estavel(dados)) {
              r.semanas.iguais++;
              continue;
            }
            r.semanas[anterior === undefined ? "novas" : "atualizadas"]++;
            await tx.flashSemana.upsert({
              where: { condominioId_semana: { condominioId, semana: new Date(`${semana}T00:00:00Z`) } },
              create: { condominioId, semana: new Date(`${semana}T00:00:00Z`), dados },
              update: { dados },
            });
          }
        }
        const painel = Object.fromEntries(Object.entries(d).filter(([k]) => k !== "entries"));
        await tx.flashPainel.upsert({ where: { id: "atual" }, create: { id: "atual", dados: painel }, update: { dados: painel } });
        await registrar(
          tx,
          email,
          "FlashPainel",
          "atual",
          "atualizado",
          null,
          `${d.geradoEm} · ${r.semanas.novas} novas, ${r.semanas.atualizadas} atualizadas`,
        );
        if (!gravar) throw new Desfazer(JSON.stringify(r));
        return r;
      },
      { timeout: 120_000 },
    );
  } catch (err) {
    if (err instanceof Desfazer) return JSON.parse(err.message) as ResultadoFlash;
    throw err;
  }
}

/** O painel no formato `DATA` (o que o template e a rotina leem), ou null se nada foi gravado ainda. */
export async function lerFlash() {
  const painel = await prisma.flashPainel.findUnique({ where: { id: "atual" } });
  if (!painel) return null;
  const dados = painel.dados as Omit<DadosFlash, "entries">;
  const semanas = await prisma.flashSemana.findMany({
    select: { semana: true, dados: true, condominio: { select: { flashSlug: true } } },
    orderBy: { semana: "asc" },
  });
  const entries: Record<string, Record<string, unknown>> = Object.fromEntries(dados.condos.map((c) => [c.slug, {}]));
  for (const s of semanas) if (s.condominio.flashSlug) (entries[s.condominio.flashSlug] ??= {})[s.semana.toISOString().slice(0, 10)] = s.dados;
  return { ...dados, entries };
}
