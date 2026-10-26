import "./ambiente";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { gravarFlash, lerFlash, limparHtml } from "@/lib/flash";
import { limparECriar } from "./dados";

const EMAIL = "pessoa@exemplo.test";
beforeEach(() => limparECriar());
afterAll(() => prisma.$disconnect());

const semana = (o: Record<string, unknown> = {}) => ({
  ini: "2026-10-05",
  fim: "2026-10-11",
  bgre: true,
  rec: "2026-10-12 14:00 UTC",
  no_prazo: true,
  sev: "media",
  resumo: "Semana de rotina.",
  ...o,
});
const painel = (o: Record<string, unknown> = {}) => ({
  condos: [
    { slug: "torre-teste", nome: "Torre Teste (Bloco A)", adm: "Adm. Teste", formato: "Padrão" },
    { slug: "parque-novo", nome: "Parque Novo", adm: "Outra Adm.", formato: "" },
  ],
  weeks: ["2026-10-05"],
  entries: {
    "torre-teste": { "2026-10-05": semana() },
    "parque-novo": { "2026-10-05": semana({ sev: "alta", resumo: "Falta de energia <script>alert(1)</script>" }) },
  },
  cobertos: {},
  exec: { manchetes: [{ c: "alta", ic: "bolt", t: "<b>Parque Novo</b>: queda de energia" }], metodo: "<p>Como foi feito.</p>" },
  geradoEm: "12/10/2026",
  ...o,
});

describe("Flash Report", () => {
  it("deixa só <b>, <i>, <p> e <br>; o resto das tags vira ‹", () => {
    expect(limparHtml("<b>ok</b> <img src=x onerror=alert(1)> <script>x</script> 3 < 5")).toBe(
      "<b>ok</b> ‹img src=x onerror=alert(1)> ‹script>x‹/script> 3 ‹ 5",
    );
  });

  it("valida o formato e recusa semana de prédio fora de condos", async () => {
    expect(await gravarFlash(EMAIL, painel({ geradoEm: "2026-10-12" }))).toMatchObject({ erro: expect.stringMatching(/geradoEm/) });
    expect(await gravarFlash(EMAIL, painel({ entries: { outro: {} } }))).toMatchObject({ erro: expect.stringMatching(/outro/) });
  });

  it("simula sem gravar; importa ligando pelo nome e criando o que falta; reimportar não muda nada; lê de volta", async () => {
    const s = await gravarFlash(EMAIL, painel());
    expect(s).toMatchObject({
      predios: [
        { cadastro: "Torre Teste", novo: false },
        { cadastro: "Parque Novo", novo: true },
      ],
      semanas: { novas: 2 },
    });
    expect(await prisma.flashSemana.count()).toBe(0);
    expect(await prisma.condominio.count()).toBe(1);
    expect(await lerFlash()).toBeNull();

    expect(await gravarFlash(EMAIL, painel(), { gravar: true })).toMatchObject({ semanas: { novas: 2, atualizadas: 0 } });
    expect((await prisma.condominio.findMany({ orderBy: { nome: "asc" } })).map((c) => [c.flashSlug, c.ativo])).toEqual([
      ["parque-novo", false],
      ["torre-teste", true],
    ]);
    expect(await prisma.administradora.count()).toBe(2);
    expect(await prisma.logAlteracao.count({ where: { entidade: "Condominio" } })).toBe(2);
    expect(await gravarFlash(EMAIL, painel(), { gravar: true })).toMatchObject({ semanas: { novas: 0, atualizadas: 0, iguais: 2 } });

    // A rotina manda a semana seguinte e corrige a anterior; nada duplica, e o slug continua ligando mesmo com outro nome.
    const nova = painel({
      weeks: ["2026-10-05", "2026-10-12"],
      entries: { "torre-teste": { "2026-10-05": semana({ sev: "baixa" }), "2026-10-12": semana({ ini: "2026-10-12", fim: "2026-10-18" }) } },
    });
    nova.condos[0]!.nome = "Torre Teste renomeada";
    expect(await gravarFlash(EMAIL, nova, { gravar: true })).toMatchObject({ semanas: { novas: 1, atualizadas: 1 } });
    expect(await prisma.flashSemana.count()).toBe(3);

    const d = (await lerFlash())!;
    expect(d.weeks).toEqual(["2026-10-05", "2026-10-12"]);
    expect(Object.keys(d.entries["torre-teste"]!)).toEqual(["2026-10-05", "2026-10-12"]);
    expect(d.entries["parque-novo"]!["2026-10-05"]).toMatchObject({ sev: "alta", resumo: "Falta de energia ‹script>alert(1)‹/script>", atencao: [] });
    expect(d.exec.manchetes[0]!.t).toBe("<b>Parque Novo</b>: queda de energia");
  });
});
