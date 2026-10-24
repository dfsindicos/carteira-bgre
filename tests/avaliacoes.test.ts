import "./ambiente";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { carregarAvaliacao, criarAvaliacao, mudarPrazo, mudarStatus, painel, salvarCampo } from "@/lib/avaliacoes";
import { salvarAdministradora, salvarCondominio } from "@/lib/cadastro";
import { CODIGOS } from "@/lib/scorecard";
import { limparECriar } from "./dados";

const EMAIL = "pessoa@exemplo.test";
const T3 = { ano: 2026, trimestre: 3 };
let condominioId = "";

beforeEach(async () => {
  condominioId = (await limparECriar()).condominio.id;
});
afterAll(() => prisma.$disconnect());

const preencher = async (id: string, v = "96") => {
  for (const item of CODIGOS) expect(await salvarCampo(EMAIL, { avaliacaoId: id, item, campo: "nota", valor: v })).toEqual({ ok: true });
};

describe("avaliação", () => {
  it("cria uma vez só por condomínio e trimestre, com prazo no fim do mês seguinte", async () => {
    const a = await criarAvaliacao(EMAIL, condominioId, T3);
    const b = await criarAvaliacao(EMAIL, condominioId, T3);
    expect(b.id).toBe(a.id);
    expect(a.entregaAte?.toISOString().slice(0, 10)).toBe("2026-10-31");
    expect(await prisma.avaliacao.count()).toBe(1);
  });

  it("grava nota e comentário e registra cada alteração no log", async () => {
    const a = await criarAvaliacao(EMAIL, condominioId, T3);
    expect(await salvarCampo(EMAIL, { avaliacaoId: a.id, item: "2.2.1", campo: "nota", valor: "94,5" })).toEqual({ ok: true });
    expect(await salvarCampo(EMAIL, { avaliacaoId: a.id, item: "2.2.1", campo: "comentario", valor: "12 de 13 semanas" })).toEqual({ ok: true });
    expect(await salvarCampo(EMAIL, { avaliacaoId: a.id, item: "2.2.1", campo: "nota", valor: "97" })).toEqual({ ok: true });
    // Mesmo valor de novo não gera log.
    expect(await salvarCampo(EMAIL, { avaliacaoId: a.id, item: "2.2.1", campo: "nota", valor: "97,00" })).toEqual({ ok: true });

    const d = await carregarAvaliacao(condominioId, T3);
    expect(d?.avaliacao?.notas["2.2.1"]).toBe(97);
    expect(d?.avaliacao?.comentarios["2.2.1"]).toBe("12 de 13 semanas");
    const log = await prisma.logAlteracao.findMany({ where: { entidadeId: a.id, campo: { startsWith: "2.2.1" } }, orderBy: { em: "asc" } });
    expect(log.map((l) => [l.campo, l.antes, l.depois, l.email])).toEqual([
      ["2.2.1 nota", null, "94.5", EMAIL],
      ["2.2.1 comentário", "", "12 de 13 semanas", EMAIL],
      ["2.2.1 nota", "94.5", "97", EMAIL],
    ]);
  });

  it("recusa nota fora de 0 a 100 e item que não existe, sem gravar", async () => {
    const a = await criarAvaliacao(EMAIL, condominioId, T3);
    expect(await salvarCampo(EMAIL, { avaliacaoId: a.id, item: "1.1", campo: "nota", valor: "101" })).toEqual({ ok: false, erro: "A nota vai de 0 a 100." });
    expect((await salvarCampo(EMAIL, { avaliacaoId: a.id, item: "9.9", campo: "nota", valor: "50" })).ok).toBe(false);
    expect(await prisma.notaItem.count()).toBe(0);
  });

  it("só entrega com as 16 notas; entregue não edita; reabrir libera", async () => {
    const a = await criarAvaliacao(EMAIL, condominioId, T3);
    await salvarCampo(EMAIL, { avaliacaoId: a.id, item: "1.1", campo: "nota", valor: "90" });
    expect(await mudarStatus(EMAIL, a.id, "ENTREGUE")).toEqual({ ok: false, erro: "Faltam 15 notas para entregar." });

    await preencher(a.id);
    expect(await mudarStatus(EMAIL, a.id, "ENTREGUE")).toEqual({ ok: true });
    expect(await salvarCampo(EMAIL, { avaliacaoId: a.id, item: "1.1", campo: "nota", valor: "10" })).toEqual({ ok: false, erro: "Avaliação entregue: reabra para editar." });
    expect(await mudarPrazo(EMAIL, a.id, "2026-11-05")).toMatchObject({ ok: false });
    expect((await carregarAvaliacao(condominioId, T3))?.avaliacao?.notas["1.1"]).toBe(96);

    expect(await mudarStatus(EMAIL, a.id, "RASCUNHO")).toEqual({ ok: true });
    expect(await salvarCampo(EMAIL, { avaliacaoId: a.id, item: "1.1", campo: "nota", valor: "10" })).toEqual({ ok: true });
    const status = await prisma.logAlteracao.findMany({ where: { campo: "status" }, orderBy: { em: "asc" } });
    expect(status.map((l) => l.depois)).toEqual(["ENTREGUE", "RASCUNHO"]);
  });

  it("painel: média do último trimestre com nota final e diferença contra o anterior", async () => {
    const a2 = await criarAvaliacao(EMAIL, condominioId, { ano: 2026, trimestre: 2 });
    await preencher(a2.id, "90");
    const a3 = await criarAvaliacao(EMAIL, condominioId, T3);
    await preencher(a3.id, "96");
    const p = await painel(T3);
    expect(p.referencia).toEqual(T3);
    expect(p.media).toBeCloseTo(96, 6);
    expect(p.linhas[0]).toMatchObject({ nome: "Torre Teste", administradora: "Adm. Teste" });
    expect(p.linhas[0]!.diferenca).toBeCloseTo(6, 6);
    expect(p.rascunhos).toBe(1);
  });
});

describe("cadastro", () => {
  it("cria e edita administradora e condomínio com log; nome repetido é recusado", async () => {
    expect(await salvarAdministradora(EMAIL, { nome: "Adm. Nova", emails: "a@x.test; B@x.test, a@x.test" })).toEqual({ ok: true });
    const adm = await prisma.administradora.findUniqueOrThrow({ where: { nome: "Adm. Nova" } });
    expect(adm.emails).toBe("a@x.test\nb@x.test");
    expect(await salvarAdministradora(EMAIL, { nome: "Adm. Nova", emails: "" })).toEqual({ ok: false, erro: "Já existe uma administradora com esse nome." });
    expect((await salvarAdministradora(EMAIL, { nome: "Outra", emails: "não é e-mail" })).ok).toBe(false);

    expect(await salvarCondominio(EMAIL, { id: condominioId, nome: "Torre Teste", administradoraId: adm.id, ativo: false })).toEqual({ ok: true });
    const log = await prisma.logAlteracao.findMany({ where: { entidade: "Condominio", entidadeId: condominioId } });
    expect(log.map((l) => l.campo).sort()).toEqual(["administradoraId", "ativo"]);
    expect((await painel(T3)).ativos).toBe(0);
  });
});
