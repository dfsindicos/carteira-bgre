import "./ambiente";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { carregarAvaliacao, criarAvaliacao, salvarCampo } from "@/lib/avaliacoes";
import { candidato, importarJson, normalizarNome } from "@/lib/importacao-json";
import { MODELOS } from "@/lib/scorecard";
import { limparECriar } from "./dados";

const EMAIL = "pessoa@exemplo.test";
let condominioId = "";

beforeEach(async () => {
  condominioId = (await limparECriar()).condominio.id;
});
afterAll(() => prisma.$disconnect());

const avaliacao = (o: Record<string, unknown> = {}) => ({
  tipo: "ADMINISTRADORA",
  condominio: "Torre Teste",
  ano: 2026,
  trimestre: 2,
  passos: { "1": "2026-07-10", "2": "2026-07-15", "3": null, "4": null },
  andamento: ["Falta: SST de setembro (2.5)"],
  andamentoEm: "2026-10-21",
  estimativa: 90.35,
  ...o,
});
const rodar = async (avaliacoes: unknown[], o: Parameters<typeof importarJson>[2] = {}) => {
  const r = await importarJson(EMAIL, { avaliacoes }, o);
  if ("erro" in r) throw new Error(r.erro);
  return r.linhas;
};

describe("nomes", () => {
  it("normaliza sem acento, caixa, pontuação e parênteses; sugere o mais parecido", () => {
    expect(normalizarNome("Centenário (CTN)")).toBe("centenario");
    expect(normalizarNome("  TORRE-teste. ")).toBe("torre teste");
    const lista = [{ nome: "Torre Teste" }, { nome: "Parque Sul" }];
    expect(candidato("Torre Testes Norte", lista)?.nome).toBe("Torre Teste");
    expect(candidato("Nada a ver", lista)).toBeNull();
  });
});

describe("importação do JSON", () => {
  it("valida o formato com Zod", async () => {
    expect(await importarJson(EMAIL, { avaliacoes: [avaliacao({ trimestre: 5 })] }, {})).toMatchObject({ erro: expect.stringMatching(/avaliacoes\.0\.trimestre/) });
    expect(await importarJson(EMAIL, { avaliacoes: [avaliacao({ passos: { "1": "10/07/2026" } })] }, {})).toMatchObject({ erro: expect.any(String) });
  });

  it("simula sem gravar; cria a avaliação vazia com checklist, andamento e estimativa; reimportar não muda nada", async () => {
    const nome = avaliacao({ condominio: "torre teste (antigo nome)" });
    const s = await rodar([nome]);
    expect(s[0]).toMatchObject({ acao: "nova", condominioId, mudancas: ["avaliação criada", "checklist", "andamento", "estimativa"] });
    expect(await prisma.avaliacao.count()).toBe(0);
    expect(await prisma.logAlteracao.count()).toBe(0);

    expect((await rodar([nome], { gravar: true }))[0]!.acao).toBe("nova");
    const d = (await carregarAvaliacao(condominioId, { ano: 2026, trimestre: 2 }))!.avaliacao!;
    expect(d.passos.map((p) => p && p.em.toISOString().slice(0, 10))).toEqual(["2026-07-10", "2026-07-15", null, null]);
    expect(d.passos[0]!.por).toBe(EMAIL);
    expect([d.andamento, d.andamentoEm?.toISOString().slice(0, 10), d.estimativa, d.status, Object.keys(d.notas)]).toEqual([
      ["Falta: SST de setembro (2.5)"],
      "2026-10-21",
      90.35,
      "RASCUNHO",
      [],
    ]);
    const logs = await prisma.logAlteracao.count();
    expect(logs).toBeGreaterThan(0);
    expect((await rodar([nome], { gravar: true }))[0]!.acao).toBe("sem mudança");
    expect(await prisma.logAlteracao.count()).toBe(logs);
  });

  it("nome sem par mostra o candidato e espera a escolha; escolher grava, ignorar pula", async () => {
    const outra = avaliacao({ condominio: "Torre Testes Norte", tipo: "SINDICANCIA" });
    const s = await rodar([outra]);
    expect(s[0]).toMatchObject({ acao: "escolher", candidato: { id: condominioId, nome: "Torre Teste" }, chave: "torre testes norte" });
    expect((await rodar([outra], { escolhas: { "torre testes norte": "ignorar" }, gravar: true }))[0]!.acao).toBe("ignorada");
    expect(await prisma.avaliacao.count()).toBe(0);
    const r = await rodar([outra], { escolhas: { "torre testes norte": condominioId }, gravar: true });
    expect(r[0]).toMatchObject({ acao: "nova", condominioNome: "Torre Teste" });
    expect((await prisma.avaliacao.findFirstOrThrow()).tipo).toBe("SINDICANCIA");
  });

  it("passo 4 no JSON marca como entregue sem exigir notas; null desmarca; campo ausente não mexe", async () => {
    await rodar([avaliacao({ passos: { "4": "2026-07-31" } })], { gravar: true });
    let a = await prisma.avaliacao.findFirstOrThrow();
    expect([a.status, a.entregueEm?.toISOString().slice(0, 10), a.passo1Em]).toEqual(["ENTREGUE", "2026-07-31", null]);
    await rodar([avaliacao({ passos: { "4": null }, andamento: undefined, estimativa: undefined })], { gravar: true });
    a = await prisma.avaliacao.findFirstOrThrow();
    expect([a.status, a.entregueEm, a.andamento, Number(a.estimativa)]).toEqual(["RASCUNHO", null, ["Falta: SST de setembro (2.5)"], 90.35]);
  });
});

describe("importação do JSON com notas (itens)", () => {
  const itens = (v: number) => Object.fromEntries(MODELOS.ADMINISTRADORA.codigos.map((c) => [c, { nota: v, comentario: null }]));

  it("grava notas e comentários; avisa item fora do modelo e nota final divergente; nova com passo 4 entra entregue", async () => {
    const e = avaliacao({
      passos: { "1": "2026-07-10", "2": "2026-07-10", "3": "2026-07-11", "4": "2026-07-31" },
      itens: { ...itens(95), "2.2.1": { nota: 90.678, comentario: "12 de 13 semanas" }, "9.9": { nota: 50 } },
      notaFinalPlanilha: 80,
      arquivo: "TT - 2T26.xlsx",
    });
    const s = await rodar([e]);
    expect(s[0]!.mudancas).toEqual(["avaliação criada", "notas importadas", "checklist", "andamento", "estimativa"]);
    expect(s[0]!.avisos).toEqual([
      "Item 9.9 não existe no Score Card da Administradora: ignorado.",
      expect.stringMatching(/^A planilha diz 80,0%, o sistema calcula 9\d,\d%\.$/),
    ]);
    await rodar([e], { gravar: true });
    const d = (await carregarAvaliacao(condominioId, { ano: 2026, trimestre: 2 }))!.avaliacao!;
    expect([d.notas["2.2.1"], d.comentarios["2.2.1"], Object.keys(d.notas).length, d.status]).toEqual([90.68, "12 de 13 semanas", 16, "ENTREGUE"]);
    const log = await prisma.logAlteracao.findFirstOrThrow({ where: { campo: "notas importadas" } });
    expect(log.depois).toBe("2T26 · TT - 2T26.xlsx");
    expect((await rodar([e], { gravar: true }))[0]!.acao).toBe("sem mudança");
  });

  it("avaliação que já tem notas: sem Substituir pula as notas e avisa (o checklist entra); com Substituir troca", async () => {
    const a = await criarAvaliacao(EMAIL, condominioId, { ano: 2026, trimestre: 2 });
    await salvarCampo(EMAIL, { avaliacaoId: a.id, item: "1.1", campo: "nota", valor: "70" });
    const e = avaliacao({ itens: itens(99) });
    const r = await rodar([e], { gravar: true });
    expect(r[0]!.avisos).toContain("Já tem notas: notas puladas (marque “Substituir” para trocar).");
    expect(r[0]!.mudancas).toEqual(["checklist", "andamento", "estimativa"]);
    expect((await carregarAvaliacao(condominioId, { ano: 2026, trimestre: 2 }))!.avaliacao!.notas["1.1"]).toBe(70);

    const t = await rodar([e], { gravar: true, substituir: true });
    expect(t[0]).toMatchObject({ acao: "atualizar", mudancas: ["notas substituídas"] });
    expect((await carregarAvaliacao(condominioId, { ano: 2026, trimestre: 2 }))!.avaliacao!.notas["1.1"]).toBe(99);
    expect(await prisma.logAlteracao.count({ where: { campo: "1.1 nota", antes: "70", depois: "99" } })).toBe(1);
  });

  it("avaliação criada vazia (só checklist) recebe as notas sem Substituir; Sindicância usa os 13 itens", async () => {
    await rodar([avaliacao({ tipo: "SINDICANCIA" })], { gravar: true });
    const itensSin = Object.fromEntries(MODELOS.SINDICANCIA.codigos.map((c) => [c, { nota: 100 }]));
    const r = await rodar([avaliacao({ tipo: "SINDICANCIA", itens: { ...itensSin, "2.2.1": { nota: 1 } } })], { gravar: true });
    expect(r[0]!.mudancas).toEqual(["notas importadas"]);
    expect(r[0]!.avisos).toEqual(["Item 2.2.1 não existe no Score Card da Sindicância: ignorado."]);
    const d = (await carregarAvaliacao(condominioId, { ano: 2026, trimestre: 2 }, "SINDICANCIA"))!.avaliacao!;
    expect(Object.keys(d.notas)).toHaveLength(13);
  });

  it("cria os prédios do cadastro que faltam (e a administradora), só ao importar; o que já existe não muda", async () => {
    const entrada = {
      cadastro: [
        { nome: "Torre Teste", administradora: "Outra Adm", avaliadoDesde: "1T25" },
        { nome: "Parque Novo (demo)", administradora: "Adm Nova Demo", avaliadoDesde: "1T26" },
      ],
      avaliacoes: [avaliacao({ condominio: "Parque Novo (demo)" })],
    };
    const sim = await importarJson(EMAIL, entrada, {});
    if ("erro" in sim) throw new Error(sim.erro);
    expect(sim.prediosNovos).toEqual(["Parque Novo (demo)"]);
    expect(sim.linhas[0]?.acao).toBe("nova");
    expect(await prisma.condominio.count({ where: { nome: "Parque Novo (demo)" } })).toBe(0);

    const r = await importarJson(EMAIL, entrada, { gravar: true });
    if ("erro" in r) throw new Error(r.erro);
    const c = await prisma.condominio.findFirstOrThrow({ where: { nome: "Parque Novo (demo)" }, include: { administradora: true } });
    expect([c.administradora.nome, c.avaliadoDesdeAno, c.avaliadoDesdeTrimestre]).toEqual(["Adm Nova Demo", 2026, 1]);
    expect(r.linhas[0]?.acao).toBe("nova");
    expect(await prisma.administradora.count({ where: { nome: "Outra Adm" } })).toBe(0);
    expect(await prisma.logAlteracao.count({ where: { entidadeId: c.id, campo: "criado pela importação" } })).toBe(1);

    const de_novo = await importarJson(EMAIL, entrada, { gravar: true });
    if ("erro" in de_novo) throw new Error(de_novo.erro);
    expect(de_novo.prediosNovos).toEqual([]);
    expect(await prisma.condominio.count({ where: { nome: "Parque Novo (demo)" } })).toBe(1);
  });
});
