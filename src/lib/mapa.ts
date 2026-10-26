import { prisma } from "./db";
import { estadoPorPassos, paraNotas, passosDe } from "./avaliacoes";
import { CONTRATADA_SINDICANCIA, calcular, periodoEmAvaliacao, periodoSeguinte, type Periodo, type Tipo } from "./scorecard";

// Mapa condomínio × trimestre (a visão "Todos" do artefato), por tipo de avaliação.

/** Primeiro trimestre do mapa. */
export const INICIO_MAPA: Periodo = { ano: 2025, trimestre: 1 };
const ordem = (p: Periodo) => p.ano * 4 + p.trimestre;

export function trimestresDoMapa(corrente: Periodo): Periodo[] {
  const lista: Periodo[] = [];
  for (let p = INICIO_MAPA; ordem(p) <= ordem(corrente); p = periodoSeguinte(p)) lista.push(p);
  return lista;
}

/**
 * Situação da avaliação no trimestre, como no artefato: fora do período (antes do "avaliado desde"); concluída (4/4);
 * em andamento (1 a 3 passos); sem planilha (trimestre fechado, nenhum passo, nenhuma nota e nenhuma estimativa);
 * a fazer (o resto).
 */
export type Situacao = "fora" | "concluida" | "andamento" | "sem-planilha" | "a-fazer";

export type DadosCelula = { feitos: number; final: number | null; temNota: boolean; estimativa: number | null } | null;
export type Celula = { periodo: Periodo; situacao: Situacao; feitos: number; nota: number | null; estimativa: number | null };

export function celula(periodo: Periodo, corrente: Periodo, desde: Periodo | null, a: DadosCelula): Celula {
  const base = { periodo, feitos: a?.feitos ?? 0, nota: a?.final ?? null, estimativa: a?.final == null ? (a?.estimativa ?? null) : null };
  if (ordem(periodo) < ordem(desde ?? INICIO_MAPA)) return { ...base, situacao: "fora" };
  const porPassos = estadoPorPassos(base.feitos);
  if (porPassos !== "a-fazer") return { ...base, situacao: porPassos };
  const fechado = ordem(periodo) < ordem(corrente);
  return { ...base, situacao: fechado && !a?.temNota && base.estimativa === null ? "sem-planilha" : "a-fazer" };
}

const media = (l: number[]) => (l.length ? l.reduce((s, v) => s + v, 0) / l.length : null);

export async function mapa(tipo: Tipo, corrente: Periodo = periodoEmAvaliacao()) {
  const trimestres = trimestresDoMapa(corrente);
  const condominios = await prisma.condominio.findMany({
    where: { ativo: true },
    include: { administradora: true, avaliacoes: { where: { tipo }, include: { notas: true } } },
    orderBy: { nome: "asc" },
  });
  const linhas = condominios.map((c) => {
    const desde = c.avaliadoDesdeAno && c.avaliadoDesdeTrimestre ? { ano: c.avaliadoDesdeAno, trimestre: c.avaliadoDesdeTrimestre } : null;
    const celulas = trimestres.map((p) => {
      const a = c.avaliacoes.find((x) => x.ano === p.ano && x.trimestre === p.trimestre);
      return celula(
        p,
        corrente,
        desde,
        a ? {
          feitos: passosDe(a).filter(Boolean).length,
          final: calcular(paraNotas(a.notas), tipo).final,
          temNota: a.notas.some((n) => n.nota !== null),
          estimativa: a.estimativa === null ? null : Number(a.estimativa),
        } : null,
      );
    });
    const notas = celulas.flatMap((x) => (x.nota === null ? [] : [x.nota]));
    const dentro = celulas.filter((x) => x.situacao !== "fora");
    return {
      id: c.id,
      nome: c.nome,
      contratada: tipo === "SINDICANCIA" ? CONTRATADA_SINDICANCIA : c.administradora.nome,
      desde,
      celulas,
      media: media(notas),
      concluidas: dentro.filter((x) => x.situacao === "concluida").length,
      total: dentro.length,
    };
  });

  const todas = linhas.flatMap((l) => l.celulas).filter((x) => x.situacao !== "fora");
  const fechada = (x: Celula) => ordem(x.periodo) < ordem(corrente);
  const doCorrente = todas.filter((x) => ordem(x.periodo) === ordem(corrente));
  const notas = todas.flatMap((x) => (x.nota === null ? [] : [x.nota]));
  return {
    tipo,
    corrente,
    trimestres,
    linhas,
    indicadores: {
      concluidas: todas.filter((x) => x.situacao === "concluida").length,
      total: todas.length,
      media: media(notas),
      comNota: notas.length,
      correnteConcluidas: doCorrente.filter((x) => x.situacao === "concluida").length,
      correnteTotal: doCorrente.length,
      abertasComPlanilha: todas.filter((x) => fechada(x) && x.situacao !== "concluida" && x.nota !== null).length,
      semPlanilha: todas.filter((x) => x.situacao === "sem-planilha").length,
    },
    porTrimestre: trimestres.map((p, i) => ({ periodo: p, media: media(linhas.flatMap((l) => (l.celulas[i]!.nota === null ? [] : [l.celulas[i]!.nota!]))) })),
  };
}
