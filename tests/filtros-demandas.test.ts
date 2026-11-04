import { describe, expect, it } from "vitest";
import { AGUARDANDO } from "@/lib/demandas";
import { casaBusca, contarFiltros, filtrar, lerFiltros, ordenar, type LinhaFiltro } from "@/lib/filtros-demandas";

// Horários de São Paulo escritos como UTC-3.
const sp = (s: string) => new Date(`${s}-03:00`);
const agora = sp("2026-11-04T10:00");
const linha = (o: Partial<LinhaFiltro> & { numero: number }): LinhaFiltro => ({
  titulo: `Demanda ${o.numero}`,
  pedido: null,
  oQueFazer: null,
  remetenteNome: "Gestão de ativos",
  remetenteEmail: "ativos@bgre.exemplo.test",
  assuntos: [],
  criticidade: "ORDINARIA",
  aguardando: null,
  origem: "TRIAGEM",
  situacao: "ABERTA",
  chegadaEm: sp("2026-11-01T09:00"),
  primeiraRespostaEm: null,
  prazoLimite: null,
  condominioNome: null,
  ultimaMovimentacao: sp("2026-11-01T09:00"),
  ...o,
});
const L = [
  linha({ numero: 1, chegadaEm: sp("2026-10-20T08:00"), prazoLimite: sp("2026-11-03T23:59"), criticidade: "URGENTE", condominioNome: "Torre Beta", aguardando: "ADMINISTRADORA", ultimaMovimentacao: sp("2026-11-03T15:00") }),
  linha({ numero: 2, chegadaEm: sp("2026-11-02T14:00"), prazoLimite: sp("2026-11-04T18:00"), criticidade: "CRITICA", condominioNome: "Ápice Tower", primeiraRespostaEm: sp("2026-11-02T15:00"), origem: "PLANNER" }),
  linha({ numero: 3, chegadaEm: sp("2026-10-30T11:00"), prazoLimite: sp("2026-11-09T23:59"), pedido: "“Favor enviar o laudo do gerador.”", origem: "MANUAL", ultimaMovimentacao: sp("2026-11-04T08:00") }),
  linha({ numero: 4, chegadaEm: sp("2026-11-03T09:30"), criticidade: "COMPLEXA", assuntos: ["RE: Renovação do seguro"], oQueFazer: "Pedir o mapa à corretora", aguardando: "CORRETORA" }),
  linha({ numero: 5, chegadaEm: sp("2026-11-04T07:00"), prazoLimite: sp("2026-12-01T23:59"), situacao: "CONCLUIDA", condominioNome: "Torre Beta" }),
];
const nums = (ls: LinhaFiltro[]) => ls.map((l) => l.numero);

describe("filtros e ordem da lista de demandas", () => {
  it("lê a URL: padrão Nº decrescente; valor desconhecido vira sem filtro; sentido padrão por ordem", () => {
    expect(lerFiltros({})).toMatchObject({ ord: "numero", dir: "desc" });
    expect(lerFiltros({ ord: "prazo" })).toMatchObject({ ord: "prazo", dir: "asc" });
    expect(lerFiltros({ ord: "chegada", dir: "asc", crit: "URGENTE", ag: "ninguem", prazo: "xyz", de: "04/11/2026", q: "  laudo " })).toEqual({
      ord: "chegada",
      dir: "asc",
      crit: "URGENTE",
      ag: "ninguem",
      prazo: undefined,
      resp1: undefined,
      de: undefined,
      ate: undefined,
      origem: undefined,
      q: "laudo",
    });
    expect(contarFiltros(lerFiltros({ crit: "URGENTE", q: "x", ord: "prazo" }))).toBe(2);
    expect(lerFiltros({ ag: "LOCATARIO" }).ag).toBe("LOCATARIO");
    expect([...AGUARDANDO].every((a) => lerFiltros({ ag: a }).ag === a)).toBe(true);
  });

  it("ordena por Nº, chegada, prazo (sem prazo no fim nos dois sentidos), movimentação, criticidade e condomínio", () => {
    expect(nums(ordenar(L, "numero", "desc"))).toEqual([5, 4, 3, 2, 1]);
    expect(nums(ordenar(L, "numero", "asc"))).toEqual([1, 2, 3, 4, 5]);
    expect(nums(ordenar(L, "chegada", "desc"))).toEqual([5, 4, 2, 3, 1]);
    expect(nums(ordenar(L, "chegada", "asc"))).toEqual([1, 3, 2, 4, 5]);
    expect(nums(ordenar(L, "prazo", "asc"))).toEqual([1, 2, 3, 5, 4]);
    expect(nums(ordenar(L, "prazo", "desc"))).toEqual([5, 3, 2, 1, 4]);
    // 3 (04/11), 1 (03/11) e as outras empatadas em 01/11: empate = Nº mais novo primeiro.
    expect(nums(ordenar(L, "movimento", "desc"))).toEqual([3, 1, 5, 4, 2]);
    expect(nums(ordenar(L, "criticidade", "asc"))).toEqual([2, 1, 5, 3, 4]);
    // Acento não muda a ordem (Ápice antes de Torre); sem condomínio no fim.
    expect(nums(ordenar(L, "condominio", "asc"))).toEqual([2, 5, 1, 4, 3]);
  });

  it("filtra por prazo, 1ª resposta, aguardando, origem, criticidade e período, combinados", () => {
    const f = (p: Record<string, string>) => nums(filtrar(L, lerFiltros(p), agora));
    expect(f({ prazo: "vencidas" })).toEqual([1]);
    expect(f({ prazo: "hoje" })).toEqual([2]);
    expect(f({ prazo: "7dias" })).toEqual([2, 3]);
    expect(f({ prazo: "sem" })).toEqual([4]);
    expect(f({ resp1: "feita" })).toEqual([2]);
    expect(f({ resp1: "pendente" })).toEqual([1, 3, 4, 5]);
    expect(f({ ag: "ninguem" })).toEqual([2, 3, 5]);
    expect(f({ ag: "CORRETORA" })).toEqual([4]);
    expect(f({ origem: "PLANNER" })).toEqual([2]);
    expect(f({ crit: "URGENTE" })).toEqual([1]);
    // Período pela data de São Paulo: 01/11 a 03/11 inclui a chegada de 03/11 às 9h30.
    expect(f({ de: "2026-11-01", ate: "2026-11-03" })).toEqual([2, 4]);
    expect(f({ de: "2026-11-01", ate: "2026-11-03", resp1: "pendente", prazo: "sem" })).toEqual([4]);
  });

  it("busca pelo número, sem acento e em vários campos (título, pedido, o que fazer, remetente, assunto)", () => {
    const busca = (q: string) => nums(L.filter((l) => casaBusca(l, q)));
    expect(busca("3")).toEqual([3]);
    expect(busca("#4")).toEqual([4]);
    expect(busca("nº 2")).toEqual([2]);
    expect(busca("LAUDO gerador")).toEqual([3]);
    expect(busca("renovacao")).toEqual([4]);
    expect(busca("corretora")).toEqual([4]);
    expect(busca("ativos@bgre")).toEqual([1, 2, 3, 4, 5]);
    expect(busca("nada disso")).toEqual([]);
  });
});

describe("ordem pelas demais colunas", () => {
  const ls = [
    linha({ numero: 1, titulo: "Cobrar laudo", situacao: "AGUARDANDO", respostaLimite: new Date("2026-11-05T12:00:00Z") }),
    linha({ numero: 2, titulo: "Agendar reunião", situacao: "ABERTA", primeiraRespostaEm: new Date("2026-11-01T12:00:00Z") }),
    linha({ numero: 3, titulo: "Bater o orçamento", situacao: "REUNIAO", respostaLimite: new Date("2026-11-04T12:00:00Z") }),
    linha({ numero: 4, titulo: "Último sem limite", situacao: "EM_ANDAMENTO", respostaLimite: null }),
  ];
  it("ordena por título, 1ª resposta e situação, nos dois sentidos", () => {
    expect(ordenar(ls, "titulo", "asc").map((l) => l.numero)).toEqual([2, 3, 1, 4]);
    expect(ordenar(ls, "titulo", "desc").map((l) => l.numero)).toEqual([4, 1, 3, 2]);
    // Pendentes pelo limite (mais urgente primeiro), depois as respondidas; sem limite no fim.
    expect(ordenar(ls, "resposta", "asc").map((l) => l.numero)).toEqual([3, 1, 2, 4]);
    expect(ordenar(ls, "situacao", "asc").map((l) => l.numero)).toEqual([2, 4, 1, 3]);
    expect(lerFiltros({ ord: "situacao" })).toMatchObject({ ord: "situacao", dir: "asc" });
  });
});
