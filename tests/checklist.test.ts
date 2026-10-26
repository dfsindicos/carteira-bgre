import "./ambiente";
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { carregarAvaliacao, criarAvaliacao, marcarPassos, salvarAcompanhamento, salvarCampo } from "@/lib/avaliacoes";
import { MODELOS } from "@/lib/scorecard";
import { limparECriar } from "./dados";

const EMAIL = "pessoa@exemplo.test";
const T3 = { ano: 2026, trimestre: 3 };
let condominioId = "";

beforeEach(async () => {
  condominioId = (await limparECriar()).condominio.id;
});
afterAll(() => prisma.$disconnect());

const preencher = async (id: string, codigos: string[]) => {
  for (const item of codigos) expect(await salvarCampo(EMAIL, { avaliacaoId: id, item, campo: "nota", valor: "95" })).toEqual({ ok: true });
};

describe("checklist do trimestre", () => {
  it("marca e desmarca um passo com data, quem marcou e LogAlteracao; marcar de novo não muda", async () => {
    const a = await criarAvaliacao(EMAIL, condominioId, T3);
    expect(await marcarPassos(EMAIL, a.id, [2], true)).toEqual({ ok: true });
    const marcado = (await carregarAvaliacao(condominioId, T3))!.avaliacao!;
    expect(marcado.passos[1]).toMatchObject({ por: EMAIL });
    expect(marcado.passos.filter(Boolean)).toHaveLength(1);
    expect(await marcarPassos(EMAIL, a.id, [2], true)).toEqual({ ok: true });
    expect(await marcarPassos(EMAIL, a.id, [2], false)).toEqual({ ok: true });
    expect((await carregarAvaliacao(condominioId, T3))!.avaliacao!.passos).toEqual([null, null, null, null]);
    const log = await prisma.logAlteracao.findMany({ where: { campo: "passo 2" }, orderBy: { em: "asc" } });
    expect(log.map((l) => [l.antes === null, l.depois === null, l.email])).toEqual([
      [true, false, EMAIL],
      [false, true, EMAIL],
    ]);
  });

  it("marcar tudo exige as notas (passo 4); com elas marca os 4, trava as notas; Limpar destrava", async () => {
    const a = await criarAvaliacao(EMAIL, condominioId, T3, "SINDICANCIA");
    expect(await marcarPassos(EMAIL, a.id, [1, 2, 3, 4], true)).toEqual({ ok: false, erro: "Faltam 13 notas para entregar." });
    expect(await prisma.logAlteracao.count({ where: { campo: { startsWith: "passo" } } })).toBe(0);
    await preencher(a.id, MODELOS.SINDICANCIA.codigos);
    expect(await marcarPassos(EMAIL, a.id, [1, 2, 3, 4], true)).toEqual({ ok: true });
    const d = (await carregarAvaliacao(condominioId, T3, "SINDICANCIA"))!.avaliacao!;
    expect(d.passos.every(Boolean)).toBe(true);
    expect(d.status).toBe("ENTREGUE");
    expect(d.entregueEm).toEqual(d.passos[3]!.em);
    expect(await salvarCampo(EMAIL, { avaliacaoId: a.id, item: "3.8", campo: "nota", valor: "10" })).toEqual({ ok: false, erro: "Avaliação entregue: reabra para editar." });

    // Passos 1 a 3 não travam: só o 4.
    expect(await marcarPassos(EMAIL, a.id, [4], false)).toEqual({ ok: true });
    expect(await salvarCampo(EMAIL, { avaliacaoId: a.id, item: "3.8", campo: "nota", valor: "10" })).toEqual({ ok: true });
    expect(await marcarPassos(EMAIL, a.id, [1, 2, 3, 4], false)).toEqual({ ok: true });
    const limpo = (await carregarAvaliacao(condominioId, T3, "SINDICANCIA"))!.avaliacao!;
    expect([limpo.passos, limpo.status, limpo.entregueEm]).toEqual([[null, null, null, null], "RASCUNHO", null]);
    const status = await prisma.logAlteracao.findMany({ where: { campo: "status" }, orderBy: { em: "asc" } });
    expect(status.map((l) => l.depois)).toEqual(["ENTREGUE", "RASCUNHO"]);
  });

  it("recusa passo fora de 1 a 4 e item de outro Score Card", async () => {
    const a = await criarAvaliacao(EMAIL, condominioId, T3, "SINDICANCIA");
    expect((await marcarPassos(EMAIL, a.id, [5 as 4], true)).ok).toBe(false);
    expect(await salvarCampo(EMAIL, { avaliacaoId: a.id, item: "2.2.1", campo: "nota", valor: "90" })).toEqual({ ok: false, erro: "Item não existe neste Score Card." });
  });

  it("Administradora e Sindicância do mesmo trimestre são avaliações separadas", async () => {
    const adm = await criarAvaliacao(EMAIL, condominioId, T3);
    const sin = await criarAvaliacao(EMAIL, condominioId, T3, "SINDICANCIA");
    expect(adm.id).not.toBe(sin.id);
    expect(await prisma.avaliacao.count()).toBe(2);
  });
});

describe("andamento e estimativa", () => {
  it("grava anotações (uma por linha) com a data, estimativa e log; não trava com o passo 4", async () => {
    const a = await criarAvaliacao(EMAIL, condominioId, T3);
    expect(await salvarAcompanhamento(EMAIL, { avaliacaoId: a.id, andamento: "Falta: SST de setembro (2.5)\n\n  Falta: RGM  ", estimativa: "90,35" })).toEqual({ ok: true });
    await prisma.avaliacao.update({ where: { id: a.id }, data: { status: "ENTREGUE" } });
    expect(await salvarAcompanhamento(EMAIL, { avaliacaoId: a.id, andamento: "Falta: SST de setembro (2.5)\nFalta: RGM", estimativa: "90,35" })).toEqual({ ok: true });
    const d = (await carregarAvaliacao(condominioId, T3))!.avaliacao!;
    expect(d.andamento).toEqual(["Falta: SST de setembro (2.5)", "Falta: RGM"]);
    expect(d.andamentoEm).not.toBeNull();
    expect(d.estimativa).toBe(90.35);
    const log = await prisma.logAlteracao.findMany({ where: { campo: { in: ["andamento", "estimativa"] } } });
    expect(log.map((l) => [l.campo, l.depois]).sort()).toEqual([
      ["andamento", "Falta: SST de setembro (2.5) | Falta: RGM"],
      ["estimativa", "90.35"],
    ]);
    expect((await salvarAcompanhamento(EMAIL, { avaliacaoId: a.id, andamento: "", estimativa: "101" })).ok).toBe(false);
  });
});

describe("migração do status Entregue para o passo 4", () => {
  it("avaliação ENTREGUE ganha o passo 4, com a data de entrega (ou da última alteração)", async () => {
    const sql = readFileSync("prisma/migrations/20261026120000_sindicancia_checklist/migration.sql", "utf8");
    const update = sql.slice(sql.indexOf('UPDATE "Avaliacao"'));
    const entregue = new Date("2026-07-28T15:00:00Z");
    const comData = await prisma.avaliacao.create({ data: { condominioId, ano: 2026, trimestre: 1, status: "ENTREGUE", entregueEm: entregue } });
    const semData = await prisma.avaliacao.create({ data: { condominioId, ano: 2026, trimestre: 2, status: "ENTREGUE" } });
    const rascunho = await prisma.avaliacao.create({ data: { condominioId, ano: 2026, trimestre: 3 } });
    await prisma.$executeRawUnsafe(update);
    const [a, b, c] = await Promise.all([comData, semData, rascunho].map((x) => prisma.avaliacao.findUniqueOrThrow({ where: { id: x.id } })));
    expect([a!.entregueEm, a!.passo4Por]).toEqual([entregue, "migração (status Entregue)"]);
    expect(b!.entregueEm).toEqual(b!.atualizadoEm);
    expect([c!.entregueEm, c!.passo4Por]).toEqual([null, null]);
    expect((await carregarAvaliacao(condominioId, { ano: 2026, trimestre: 1 }))!.avaliacao!.passos[3]).toMatchObject({ em: entregue });
  });
});
