import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { planilhaBgre } from "@/lib/planilha";
import { CODIGOS, calcular } from "@/lib/scorecard";

describe("planilha BGRE", () => {
  it("abre no exceljs com cabeçalho, itens, comentários e a nota final", async () => {
    const notas = Object.fromEntries(CODIGOS.map((c, i) => [c, 85 + (i % 10)]));
    const final = calcular(notas).final!;
    const arquivo = await planilhaBgre({
      condominio: "Torre Teste",
      contratada: "Adm. Teste",
      periodo: { ano: 2026, trimestre: 3 },
      status: "RASCUNHO",
      notas,
      comentarios: { "2.2.1": "=HYPERLINK(\"x\")" },
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(arquivo as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe("Avaliação 3T26");
    const valores: unknown[][] = [];
    ws.eachRow((r) => valores.push((r.values as unknown[]).slice(1)));
    const plano = valores.flat();
    expect(plano).toContain("Torre Teste");
    expect(plano).toContain("Adm. Teste");
    expect(plano).toContain("3T26 (jul a set/26)");
    for (const c of CODIGOS) expect(plano).toContain(c);
    // Texto digitado entra como texto, nunca como fórmula.
    expect(plano).toContain('=HYPERLINK("x")');
    // Colunas: A vazia, B #, C texto, D fonte, E nota, F classificação.
    const linhaFinal = valores.find((l) => l.includes("AVALIAÇÃO FINAL"))!;
    expect(linhaFinal[4]).toBeCloseTo(final / 100, 9);
    expect(linhaFinal[5]).toBe(calcular(notas).classificacao);
  });
});
