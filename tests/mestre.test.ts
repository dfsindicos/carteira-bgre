import "./ambiente";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { QUEM, estadoDoMestre, executarSincronizacao, sincronizarComMestre, type DadosMestre } from "@/lib/mestre";
import { limparECriar } from "./dados";

// Cadastro mestre (2026-11-12): a cópia do cadastro do Action Log. Nomes sintéticos.
let admId = "";
let condId = "";
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "SincronizacaoMestre"');
  const { adm, condominio } = await limparECriar(); // "Adm. Teste" com o condomínio "Torre Teste"
  admId = adm.id;
  condId = condominio.id;
  await prisma.administradora.update({ where: { id: admId }, data: { emails: "evidencias@exemplo.test" } });
});
afterAll(() => prisma.$disconnect());

const mestre = (extra: Partial<DadosMestre> = {}): DadosMestre => ({
  administradoras: [
    { codigo: "adm-1", nome: "ADM TESTE" },
    { codigo: "adm-2", nome: "Gestora Nova" },
    { codigo: "adm-3", nome: "Sem Condomínio Ligado" },
  ],
  condominios: [
    { codigo: "c-1", nome: "Torre Teste", outrosNomes: [], administradora: "adm-1", ativo: true },
    { codigo: "c-2", nome: "Edifício Beta", outrosNomes: ["Beta"], administradora: "adm-2", ativo: true },
    { codigo: "c-3", nome: "Desligado", outrosNomes: [], administradora: "adm-3", ativo: false },
  ],
  ...extra,
});

describe("cadastro mestre", () => {
  it("liga pelo nome e pelos outros nomes, cria o que falta e a administradora só quando um condomínio ligado precisa", async () => {
    const adm = await prisma.administradora.create({ data: { nome: "Gestora Antiga" } });
    await prisma.condominio.create({ data: { nome: "Beta", administradoraId: adm.id } });
    await prisma.condominio.create({ data: { nome: "Só Daqui", administradoraId: admId } });
    const r = await sincronizarComMestre(mestre());
    expect(r.conflitos).toEqual([]);
    expect(r.soAqui).toEqual(["Só Daqui"]);
    expect(r.administradoras).toEqual({ ligadas: 1, criadas: 1, renomeadas: 1 });
    const adms = await prisma.administradora.findMany({ orderBy: { nome: "asc" } });
    // "Adm. Teste" casou com "ADM TESTE" (sem pontuação e caixa) e passou a ter o nome do mestre; os e-mails ficaram.
    expect(adms.map((a) => [a.nome, a.codigoMestre, a.emails])).toEqual([
      ["ADM TESTE", "adm-1", "evidencias@exemplo.test"],
      ["Gestora Antiga", null, ""],
      ["Gestora Nova", "adm-2", ""],
    ]);
    const conds = await prisma.condominio.findMany({ orderBy: { nome: "asc" }, include: { administradora: true } });
    expect(conds.map((c) => [c.nome, c.codigoMestre, c.administradora.nome, c.ativo])).toEqual([
      ["Edifício Beta", "c-2", "Gestora Nova", true], // era "Beta" (outro nome), na Gestora Antiga
      ["Só Daqui", null, "ADM TESTE", true],
      ["Torre Teste", "c-1", "ADM TESTE", true],
    ]);
    expect(await prisma.logAlteracao.count({ where: { email: QUEM } })).toBeGreaterThan(0);
    expect((await estadoDoMestre()).ultima).toMatchObject({ ok: true });
  });

  it("rodar de novo não muda nada nem grava log", async () => {
    await sincronizarComMestre(mestre());
    const logs = await prisma.logAlteracao.count();
    const r = await sincronizarComMestre(mestre());
    expect(r.administradoras).toEqual({ ligadas: 0, criadas: 0, renomeadas: 0 });
    expect(r.condominios).toEqual({ criados: 0, atualizados: 0, inativados: 0 });
    expect(await prisma.logAlteracao.count()).toBe(logs);
  });

  it("desligado ou arquivado vira inativo sem apagar avaliações nem o Flash; nome e administradora seguem o mestre", async () => {
    await prisma.condominio.update({ where: { id: condId }, data: { flashSlug: "torre-teste", avaliadoDesdeAno: 2025, avaliadoDesdeTrimestre: 2 } });
    await prisma.avaliacao.create({ data: { condominioId: condId, ano: 2026, trimestre: 3 } });
    await sincronizarComMestre(mestre());
    const m = mestre();
    m.administradoras[0]!.nome = "Adm Teste Renomeada";
    m.condominios = [
      { codigo: "c-1", nome: "Torre Teste", outrosNomes: [], administradora: "adm-1", ativo: false },
      { codigo: "c-2", nome: "Edifício Beta Novo", outrosNomes: [], administradora: "adm-1", ativo: true },
    ];
    const r = await sincronizarComMestre(m);
    expect(r.condominios).toEqual({ criados: 0, atualizados: 1, inativados: 1 });
    const c1 = await prisma.condominio.findUniqueOrThrow({ where: { id: condId }, include: { avaliacoes: true } });
    expect([c1.ativo, c1.flashSlug, c1.avaliadoDesdeAno, c1.avaliacoes.length]).toEqual([false, "torre-teste", 2025, 1]);
    const c2 = await prisma.condominio.findUniqueOrThrow({ where: { codigoMestre: "c-2" }, include: { administradora: true } });
    expect([c2.nome, c2.administradora.nome]).toEqual(["Edifício Beta Novo", "Adm Teste Renomeada"]);
    expect((await prisma.administradora.findUniqueOrThrow({ where: { id: admId } })).emails).toBe("evidencias@exemplo.test");
    // Religado no mestre: volta a ficar ativo.
    m.condominios[0]!.ativo = true;
    await sincronizarComMestre(m);
    expect((await prisma.condominio.findUniqueOrThrow({ where: { id: condId } })).ativo).toBe(true);
  });

  it("nome que já existe aqui com outro código vira conflito e não renomeia", async () => {
    await sincronizarComMestre(mestre());
    await prisma.condominio.create({ data: { nome: "Nome Ocupado", administradoraId: admId, codigoMestre: "outro" } });
    const m = mestre();
    m.condominios[0]!.nome = "Nome Ocupado";
    const r = await sincronizarComMestre(m);
    expect(r.conflitos).toEqual(["Torre Teste: o nome do Action Log (Nome Ocupado) já existe aqui"]);
    expect((await prisma.condominio.findUniqueOrThrow({ where: { id: condId } })).nome).toBe("Torre Teste");
  });

  it("parênteses contam ao casar pelo nome; sem o parênteses, só casa se houver um único candidato", async () => {
    await prisma.condominio.create({ data: { nome: "O Parque (Torre 7)", administradoraId: admId } });
    await prisma.condominio.create({ data: { nome: "O Parque (Cond. Geral)", administradoraId: admId } });
    await prisma.condominio.create({ data: { nome: "Solar (Bloco A)", administradoraId: admId } });
    const r = await sincronizarComMestre({
      administradoras: [{ codigo: "adm-1", nome: "Adm. Teste" }],
      condominios: [
        { codigo: "p7", nome: "O Parque - T07", outrosNomes: ["O Parque (Torre 7)"], administradora: "adm-1", ativo: true },
        { codigo: "pg", nome: "O Parque (Cond. Geral)", outrosNomes: [], administradora: "adm-1", ativo: true },
        { codigo: "px", nome: "O Parque", outrosNomes: [], administradora: "adm-1", ativo: true }, // dois candidatos: não casa, cria
        { codigo: "so", nome: "Solar", outrosNomes: [], administradora: "adm-1", ativo: true }, // candidato único: casa
      ],
    });
    const conds = await prisma.condominio.findMany({ where: { codigoMestre: { not: null } }, orderBy: { codigoMestre: "asc" } });
    expect(conds.map((c) => [c.codigoMestre, c.nome])).toEqual([
      ["p7", "O Parque - T07"],
      ["pg", "O Parque (Cond. Geral)"],
      ["px", "O Parque"],
      ["so", "Solar"],
    ]);
    expect(r.condominios.criados).toBe(1);
  });

  it("falha ao ler o Action Log fica registrada e não mexe na cópia", async () => {
    const antes = await prisma.condominio.findMany({ orderBy: { id: "asc" } });
    process.env.INTEGRACAO_TOKEN = "token-de-teste";
    const r = await executarSincronizacao(new Date(), (async () => new Response("x", { status: 401 })) as typeof fetch);
    expect(r).toEqual({ ok: false, erro: "o Action Log respondeu 401" });
    const lixo = await executarSincronizacao(new Date(), (async () => Response.json({ condominios: "x" })) as unknown as typeof fetch);
    expect(lixo).toEqual({ ok: false, erro: "resposta do Action Log fora do formato" });
    expect(await prisma.condominio.findMany({ orderBy: { id: "asc" } })).toEqual(antes);
    expect(await prisma.logAlteracao.count({ where: { email: QUEM } })).toBe(0);
    expect((await estadoDoMestre()).ultima).toMatchObject({ ok: false, erro: "resposta do Action Log fora do formato" });
    const ok = await executarSincronizacao(new Date(), (async (url: string, init: RequestInit) => {
      expect(url).toBe("https://actionlog.gestaodfsindicos.tech/api/integracao/cadastro?sistema=bgre");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer token-de-teste");
      return Response.json({ geradoEm: "2026-11-12T12:00:00Z", sistema: "bgre", ...mestre(), proprietarios: [], pessoasAdministradoras: [] });
    }) as unknown as typeof fetch);
    expect(ok.ok).toBe(true);
    delete process.env.INTEGRACAO_TOKEN;
    const semToken = await executarSincronizacao(new Date(), (async () => Response.json(mestre())) as unknown as typeof fetch);
    expect(semToken).toEqual({ ok: false, erro: "INTEGRACAO_TOKEN não configurado no servidor." });
  });
});
