import { describe, expect, it } from "vitest";
import {
  SLA_PADRAO,
  fimDoDia,
  lerDataHoraSP,
  paraDataHoraSP,
  prazoConclusao,
  prazoResposta,
  situacaoPrazo,
  situacaoResposta,
  somarDiasUteis,
  type ConfigSla,
  type DemandaPrazo,
} from "@/lib/prazos-demandas";

// Horários de São Paulo (UTC-3) escritos como UTC: 16h42 em SP = 19h42Z.
const sp = (s: string) => new Date(`${s}-03:00`);
const demanda = (o: Partial<DemandaPrazo> = {}): DemandaPrazo => ({
  criticidade: "ORDINARIA",
  chegadaEm: sp("2026-10-30T16:42"), // sexta-feira
  prazoEmail: null,
  prazoCombinado: null,
  primeiraRespostaEm: null,
  situacao: "ABERTA",
  concluidaEm: null,
  ...o,
});
const cfg = (o: Partial<ConfigSla> = {}): ConfigSla => ({ ...structuredClone(SLA_PADRAO), ...o });

describe("prazos das demandas", () => {
  it("horas corridas: crítica responde em 1 h e conclui (plano) em 4 h, mesmo na sexta à noite", () => {
    const d = demanda({ criticidade: "CRITICA", chegadaEm: sp("2026-10-30T22:30") });
    expect(prazoResposta(d, cfg())).toEqual(sp("2026-10-30T23:30"));
    expect(prazoConclusao(d, cfg())).toEqual({ em: sp("2026-10-31T02:30"), origem: "sla" });
  });

  it("dias úteis pulam o fim de semana e Finados (2/11); sem contar feriados, Finados é dia útil", () => {
    const d = demanda();
    // 1 du a partir de sexta 30/10: sábado, domingo e segunda (Finados) não contam → terça 3/11, mesmo horário.
    expect(prazoResposta(d, cfg())).toEqual(sp("2026-11-03T16:42"));
    // 5 du: 3, 4, 5, 6 e 9/11.
    expect(prazoConclusao(d, cfg()).em).toEqual(sp("2026-11-09T16:42"));
    expect(prazoResposta(d, cfg({ contarFeriados: false }))).toEqual(sp("2026-11-02T16:42"));
    expect(somarDiasUteis(sp("2026-12-24T10:00"), 1)).toEqual(sp("2026-12-28T10:00")); // Natal na sexta
  });

  it("chegada em dia não útil conta das 8h do próximo dia útil", () => {
    expect(somarDiasUteis(sp("2026-10-31T10:00"), 1)).toEqual(sp("2026-11-04T08:00")); // sábado → terça 8h (+1 = quarta)
  });

  it("prazo escrito no e-mail prevalece sobre o SLA (até 23h59 do dia), a menos que a configuração desligue", () => {
    const d = demanda({ prazoEmail: new Date("2026-11-05T00:00:00Z") });
    expect(prazoConclusao(d, cfg())).toEqual({ em: sp("2026-11-05T23:59:59"), origem: "email" });
    expect(prazoConclusao(d, cfg({ prazoEmailPrevalece: false }))).toEqual({ em: sp("2026-11-09T16:42"), origem: "sla" });
    expect(fimDoDia("2026-11-05")).toEqual(sp("2026-11-05T23:59:59"));
  });

  it("prazo combinado: sem data, a combinar; com a data combinada, ela; com a opção desligada, o do e-mail serve", () => {
    const d = demanda({ criticidade: "COMPLEXA" });
    expect(prazoConclusao(d, cfg())).toEqual({ em: null, origem: "a-combinar" });
    expect(prazoResposta(d, cfg())).toEqual(sp("2026-11-04T16:42")); // 2 du
    expect(prazoConclusao({ ...d, prazoCombinado: new Date("2026-11-20T00:00:00Z") }, cfg())).toEqual({ em: sp("2026-11-20T23:59:59"), origem: "combinado" });
    expect(prazoConclusao({ ...d, prazoEmail: new Date("2026-11-12T00:00:00Z") }, cfg({ prazoEmailPrevalece: false }))).toMatchObject({ origem: "email" });
    expect(situacaoPrazo(d, cfg(), sp("2026-11-03T15:00"))).toEqual({ tom: "neutro", texto: "Prazo a combinar" });
  });

  it("etiquetas: resposta vencida, no prazo e com atraso; prazo vencido, perto e cumprido", () => {
    const agora = sp("2026-11-03T15:00");
    const crit = demanda({ criticidade: "URGENTE", chegadaEm: sp("2026-11-03T09:00") });
    expect(situacaoResposta(crit, cfg(), agora)).toEqual({ tom: "erro", texto: "Sem resposta · venceu 03/11 13h00" });
    expect(situacaoResposta({ ...crit, primeiraRespostaEm: sp("2026-11-03T10:00") }, cfg(), agora)).toMatchObject({ tom: "ok" });
    expect(situacaoResposta({ ...crit, primeiraRespostaEm: sp("2026-11-03T14:00") }, cfg(), agora)).toMatchObject({ tom: "atencao" });
    expect(situacaoResposta(demanda({ chegadaEm: sp("2026-11-03T09:00") }), cfg(), agora)).toEqual({ tom: "atencao", texto: "Responder até 04/11 09h00" });

    expect(situacaoPrazo(demanda({ prazoEmail: new Date("2026-11-02T00:00:00Z") }), cfg(), agora)).toEqual({ tom: "erro", texto: "Venceu 02/11" });
    expect(situacaoPrazo(demanda({ prazoEmail: new Date("2026-11-03T00:00:00Z") }), cfg(), agora)).toEqual({ tom: "erro", texto: "Vence hoje" });
    expect(situacaoPrazo(demanda({ prazoEmail: new Date("2026-11-08T00:00:00Z") }), cfg(), agora)).toMatchObject({ tom: "atencao" });
    expect(situacaoPrazo(demanda({ prazoEmail: new Date("2026-11-20T00:00:00Z") }), cfg(), agora)).toEqual({ tom: "info", texto: "20/11" });
    const concluida = demanda({ situacao: "CONCLUIDA", concluidaEm: sp("2026-11-05T10:00"), prazoEmail: new Date("2026-11-05T00:00:00Z") });
    expect(situacaoPrazo(concluida, cfg(), agora)).toEqual({ tom: "ok", texto: "Cumprido · 05/11" });
    expect(situacaoPrazo({ ...concluida, concluidaEm: sp("2026-11-06T08:00") }, cfg(), agora)).toEqual({ tom: "atencao", texto: "Concluída após 05/11" });
  });

  it("lê e escreve o campo datetime-local no horário de São Paulo", () => {
    expect(lerDataHoraSP("2026-11-03T14:05")).toEqual(new Date("2026-11-03T17:05:00Z"));
    expect(lerDataHoraSP("03/11/2026 14:05")).toBeNull();
    expect(paraDataHoraSP(new Date("2026-11-03T17:05:00Z"))).toBe("2026-11-03T14:05");
  });
});
