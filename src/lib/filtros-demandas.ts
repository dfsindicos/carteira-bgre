// Filtros, busca e ordem da lista /demandas (pedido do usuário de 2026-11-04: "filtrar e organizar, colocar em alguma
// ordem, por data de chegada dos e-mails, por número do item cadastrado"). Funções puras: recebem as linhas já com o
// prazo calculado e "agora"; tudo vem da URL (?ord=chegada&dir=asc&crit=URGENTE…), sem estado no navegador.

import { CRITICIDADES, SITUACOES_ABERTAS } from "./prazos-demandas";

// Os mesmos valores do enum AguardandoDemanda (src/lib/demandas.ts, que usa o banco e não entra aqui).
const AGUARDANDO_VALORES = ["DF", "BGRE", "ADMINISTRADORA", "LOCATARIO", "CORRETORA", "FORNECEDOR"];

export const ORDENS = {
  numero: "Nº",
  chegada: "Chegada do e-mail",
  prazo: "Prazo",
  movimento: "Última movimentação",
  criticidade: "Criticidade",
  condominio: "Condomínio",
} as const;
export type Ordem = keyof typeof ORDENS;
export type Sentido = "asc" | "desc";
/** Sentido padrão de cada ordem: Nº, chegada e movimentação mais novos primeiro; prazo mais urgente primeiro; criticidade da Crítica para baixo; condomínio A→Z. */
export const SENTIDO_PADRAO: Record<Ordem, Sentido> = { numero: "desc", chegada: "desc", prazo: "asc", movimento: "desc", criticidade: "asc", condominio: "asc" };

export const FILTROS_PRAZO = { vencidas: "Vencidas", hoje: "Vence hoje", "7dias": "Próximos 7 dias", sem: "Sem prazo" } as const;
export const FILTROS_RESPOSTA = { feita: "Feita", pendente: "Pendente" } as const;
export const FILTROS_ORIGEM = { TRIAGEM: "Triagem (e-mail)", PLANNER: "Planner/Monday importado", MANUAL: "Registro à mão" } as const;
export const NINGUEM = "ninguem";

/** Os filtros e a ordem lidos da URL, já validados (valor desconhecido = sem filtro). */
export type FiltrosLista = {
  crit?: string;
  ag?: string;
  prazo?: keyof typeof FILTROS_PRAZO;
  resp1?: keyof typeof FILTROS_RESPOSTA;
  de?: string;
  ate?: string;
  origem?: keyof typeof FILTROS_ORIGEM;
  q?: string;
  ord: Ordem;
  dir: Sentido;
};

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const de = <T extends string>(v: string | undefined, validos: readonly string[]) => (v && validos.includes(v) ? (v as T) : undefined);
const dia = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export function lerFiltros(p: Record<string, string | string[] | undefined>): FiltrosLista {
  const ord = de<Ordem>(um(p.ord), Object.keys(ORDENS)) ?? "numero";
  return {
    crit: de(um(p.crit), CRITICIDADES),
    ag: de(um(p.ag), [...AGUARDANDO_VALORES, NINGUEM]),
    prazo: de(um(p.prazo), Object.keys(FILTROS_PRAZO)),
    resp1: de(um(p.resp1), Object.keys(FILTROS_RESPOSTA)),
    de: dia(um(p.de)),
    ate: dia(um(p.ate)),
    origem: de(um(p.origem), Object.keys(FILTROS_ORIGEM)),
    q: um(p.q)?.slice(0, 200),
    ord,
    dir: de<Sentido>(um(p.dir), ["asc", "desc"]) ?? SENTIDO_PADRAO[ord],
  };
}

/** Quantos filtros novos estão ligados (a ordem não conta), para "Filtros e ordem (2)". */
export const contarFiltros = (f: FiltrosLista) => [f.crit, f.ag, f.prazo, f.resp1, f.de, f.ate, f.origem, f.q].filter(Boolean).length;

/** O que a lista precisa de cada demanda para filtrar e ordenar. */
export type LinhaFiltro = {
  numero: number;
  titulo: string;
  pedido: string | null;
  oQueFazer: string | null;
  remetenteNome: string;
  remetenteEmail: string;
  assuntos: string[];
  criticidade: string;
  aguardando: string | null;
  origem: string;
  situacao: string;
  chegadaEm: Date;
  primeiraRespostaEm: Date | null;
  prazoLimite: Date | null;
  condominioNome: string | null;
  ultimaMovimentacao: Date;
};

const DIA = 86_400_000;
/** AAAA-MM-DD no fuso de São Paulo (UTC-3, sem horário de verão). */
const diaSP = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
export const normalizarBusca = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Busca: "41", "#41" ou "nº 41" acham o número; o resto procura em título, pedido, o que fazer, remetente e assuntos. */
export function casaBusca(l: LinhaFiltro, q: string) {
  const n = normalizarBusca(q);
  if (!n) return true;
  const num = /^(?:#|n[ºo°.]?\s*)?(\d+)$/.exec(n);
  if (num) return l.numero === Number(num[1]);
  const texto = normalizarBusca([l.titulo, l.pedido, l.oQueFazer, l.remetenteNome, l.remetenteEmail, ...l.assuntos].filter(Boolean).join(" \n "));
  return n.split(" ").every((p) => texto.includes(p));
}

export function filtrar<T extends LinhaFiltro>(linhas: T[], f: FiltrosLista, agora: Date): T[] {
  const aberta = (l: LinhaFiltro) => SITUACOES_ABERTAS.includes(l.situacao);
  return linhas.filter((l) => {
    if (f.crit && l.criticidade !== f.crit) return false;
    if (f.ag && (f.ag === NINGUEM ? l.aguardando !== null : l.aguardando !== f.ag)) return false;
    if (f.resp1 && (f.resp1 === "feita") !== !!l.primeiraRespostaEm) return false;
    if (f.origem && l.origem !== f.origem) return false;
    if (f.de && diaSP(l.chegadaEm) < f.de) return false;
    if (f.ate && diaSP(l.chegadaEm) > f.ate) return false;
    if (f.prazo) {
      const p = l.prazoLimite;
      if (f.prazo === "sem") {
        if (p) return false;
      } else if (!p || !aberta(l)) return false;
      else if (f.prazo === "vencidas" && !(p < agora)) return false;
      else if (f.prazo === "hoje" && !(p >= agora && diaSP(p) === diaSP(agora))) return false;
      else if (f.prazo === "7dias" && !(p >= agora && p.getTime() - agora.getTime() <= 7 * DIA)) return false;
    }
    if (f.q && !casaBusca(l, f.q)) return false;
    return true;
  });
}

const PESO_CRITICIDADE: Record<string, number> = { CRITICA: 0, URGENTE: 1, ORDINARIA: 2, COMPLEXA: 3 };

/** Ordena (cópia). Sem prazo ou sem condomínio ficam sempre no fim; empate = número mais novo primeiro. */
export function ordenar<T extends LinhaFiltro>(linhas: T[], ord: Ordem, dir: Sentido): T[] {
  const chave = (l: LinhaFiltro): number | string | null => {
    switch (ord) {
      case "numero":
        return l.numero;
      case "chegada":
        return l.chegadaEm.getTime();
      case "prazo":
        return l.prazoLimite?.getTime() ?? null;
      case "movimento":
        return l.ultimaMovimentacao.getTime();
      case "criticidade":
        return PESO_CRITICIDADE[l.criticidade] ?? 9;
      case "condominio":
        return l.condominioNome ? normalizarBusca(l.condominioNome) : null;
    }
  };
  const s = dir === "asc" ? 1 : -1;
  return [...linhas].sort((a, b) => {
    const [x, y] = [chave(a), chave(b)];
    if (x === null || y === null) return x === y ? b.numero - a.numero : x === null ? 1 : -1;
    const c = typeof x === "string" ? x.localeCompare(y as string, "pt-BR") : x - (y as number);
    return c ? c * s : b.numero - a.numero;
  });
}
