import "./ambiente";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { criarAvaliacao, marcarPassos, salvarAcompanhamento, salvarCampo } from "@/lib/avaliacoes";
import { salvarCondominio } from "@/lib/cadastro";
import { celula, mapa, trimestresDoMapa } from "@/lib/mapa";
import { CODIGOS, formatarPeriodo } from "@/lib/scorecard";
import { limparECriar } from "./dados";

const EMAIL = "pessoa@exemplo.test";
const CORRENTE = { ano: 2026, trimestre: 3 };
const T = (ano: number, trimestre: number) => ({ ano, trimestre });
let condominioId = "";
let administradoraId = "";

beforeEach(async () => {
  const { condominio, adm } = await limparECriar();
  condominioId = condominio.id;
  administradoraId = adm.id;
});
afterAll(() => prisma.$disconnect());

describe("estados da célula", () => {
  const dados = (o: Partial<{ feitos: number; final: number | null; temNota: boolean; estimativa: number | null }>) => ({ feitos: 0, final: null, temNota: false, estimativa: null, ...o });
  it("concluída, em andamento, estimativa, sem planilha, a fazer e fora do período", () => {
    expect(celula(T(2026, 2), CORRENTE, null, dados({ feitos: 4, final: 95, temNota: true }))).toMatchObject({ situacao: "concluida", nota: 95 });
    expect(celula(T(2026, 2), CORRENTE, null, dados({ feitos: 2, final: 80, temNota: true }))).toMatchObject({ situacao: "andamento", feitos: 2, nota: 80 });
    expect(celula(T(2026, 2), CORRENTE, null, dados({ estimativa: 90.4 }))).toMatchObject({ situacao: "a-fazer", nota: null, estimativa: 90.4 });
    expect(celula(T(2026, 2), CORRENTE, null, null)).toMatchObject({ situacao: "sem-planilha" });
    // Trimestre corrente sem nada: a fazer, não "sem planilha".
    expect(celula(CORRENTE, CORRENTE, null, null)).toMatchObject({ situacao: "a-fazer" });
    // Fechado com nota parcial: a fazer (tem planilha).
    expect(celula(T(2026, 1), CORRENTE, null, dados({ temNota: true }))).toMatchObject({ situacao: "a-fazer" });
    expect(celula(T(2025, 4), CORRENTE, T(2026, 1), null)).toMatchObject({ situacao: "fora" });
    expect(celula(T(2026, 1), CORRENTE, T(2026, 1), null)).toMatchObject({ situacao: "sem-planilha" });
    // Com nota final, a estimativa não aparece.
    expect(celula(T(2026, 2), CORRENTE, null, dados({ final: 92, temNota: true, estimativa: 80 })).estimativa).toBeNull();
  });

  it("trimestres de 1T25 até o corrente", () => {
    expect(trimestresDoMapa(CORRENTE).map(formatarPeriodo)).toEqual(["1T25", "2T25", "3T25", "4T25", "1T26", "2T26", "3T26"]);
  });
});

describe("mapa e “avaliado desde”", () => {
  it("monta linhas, indicadores e médias por tipo; avaliado desde deixa os anteriores fora do período", async () => {
    expect(await salvarCondominio(EMAIL, { id: condominioId, nome: "Torre Teste", administradoraId, ativo: true, avaliadoDesde: "1t26" })).toEqual({ ok: true });
    expect((await salvarCondominio(EMAIL, { id: condominioId, nome: "Torre Teste", administradoraId, ativo: true, avaliadoDesde: "5T26" })).ok).toBe(false);
    const log = await prisma.logAlteracao.findFirstOrThrow({ where: { campo: "avaliadoDesde" } });
    expect([log.antes, log.depois]).toEqual([null, "1T26"]);

    const concluida = await criarAvaliacao(EMAIL, condominioId, T(2026, 1));
    for (const item of CODIGOS) await salvarCampo(EMAIL, { avaliacaoId: concluida.id, item, campo: "nota", valor: "95" });
    await marcarPassos(EMAIL, concluida.id, [1, 2, 3, 4], true);
    const estimada = await criarAvaliacao(EMAIL, condominioId, T(2026, 2));
    await salvarAcompanhamento(EMAIL, { avaliacaoId: estimada.id, andamento: "Falta: RGM", estimativa: "88" });
    await criarAvaliacao(EMAIL, condominioId, T(2026, 3), "SINDICANCIA");

    const m = await mapa("ADMINISTRADORA", CORRENTE);
    const l = m.linhas[0]!;
    expect(l.celulas.map((c) => c.situacao)).toEqual(["fora", "fora", "fora", "fora", "concluida", "a-fazer", "a-fazer"]);
    expect(l.celulas[5]!.estimativa).toBe(88);
    expect([l.media, l.concluidas, l.total]).toEqual([95, 1, 3]);
    expect(m.indicadores).toMatchObject({ concluidas: 1, total: 3, media: 95, comNota: 1, correnteConcluidas: 0, correnteTotal: 1, abertasComPlanilha: 0, semPlanilha: 0 });
    expect(m.porTrimestre.map((t) => t.media)).toEqual([null, null, null, null, 95, null, null]);

    const s = await mapa("SINDICANCIA", CORRENTE);
    expect(s.linhas[0]!.contratada).toBe("DF Síndicos");
    expect(s.linhas[0]!.celulas.map((c) => c.situacao)).toEqual(["fora", "fora", "fora", "fora", "sem-planilha", "sem-planilha", "a-fazer"]);
    expect(s.indicadores.semPlanilha).toBe(2);
  });
});
