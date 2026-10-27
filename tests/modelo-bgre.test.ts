import "./ambiente";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { carregarModelo, gravarCelula, preencherModelo, salvarModelo } from "@/lib/modelo-bgre";
import { MODELOS } from "@/lib/scorecard";
import { limparECriar } from "./dados";

beforeEach(() => limparECriar());
afterAll(() => prisma.$disconnect());

// Modelo sintético no formato do da BGRE: rótulos no topo, cabeçalho com "#", "Peso" e "Comentário", marcas G a K.
async function modeloSintetico({ sem }: { sem?: string } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Score Card");
  wb.addWorksheet("Classificação").getCell("D5").value = 0.98;
  ws.getCell("C7").value = "Contratada:  Outra";
  ws.getCell("C8").value = "Local de Prestação:  Prédio Antigo";
  ws.getCell("C9").value = "Período avaliado: jan a mar/26";
  ["Item", "#", "Descrição", "Peso", "Excelente", "Bom", "Satisfatório", "Regular", "Ruim"].forEach((t, i) => (ws.getRow(11).getCell(3 + i).value = t));
  ws.getCell("N11").value = "Comentário";
  let linha = 12;
  for (const codigo of MODELOS.ADMINISTRADORA.codigos.filter((c) => c !== sem)) {
    linha++;
    ws.getCell(`D${linha}`).value = codigo;
    ws.getCell(`F${linha}`).value = { formula: "239/686", result: 0.348 };
    ["G", "H", "I", "J", "K"].forEach(
      (c, i) => (ws.getCell(`${c}${linha}`).value = { formula: `IF($F${linha}>=Classificação!$D$5-${i / 10},"X","")`, result: "" }),
    );
    ws.getCell(`N${linha}`).value = "comentário antigo";
  }
  ws.getCell("G14").value = "X"; // marca digitada à mão no modelo, de outro trimestre
  ws.getCell(`F${linha + 2}`).value = "AVALIAÇÃO FINAL";
  ws.getCell(`H${linha + 2}`).value = { formula: `AVERAGE(F13:F${linha})`, result: 0.348 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const dados = (notas: Record<string, number>) => ({
  tipo: "ADMINISTRADORA" as const,
  condominio: "Torre Teste",
  contratada: "Adm. Teste",
  periodo: { ano: 2026, trimestre: 3 },
  status: "RASCUNHO" as const,
  notas,
  comentarios: { "1.1": "jul 46/46 <ok> & ago" },
  meses: "jul a set/26",
});

describe("planilha no modelo da BGRE", () => {
  it("preenche cabeçalho, notas e comentários, refaz as marcas e manda recalcular ao abrir", async () => {
    const saida = await preencherModelo(await modeloSintetico(), dados({ "1.1": 97.57, "2.1": 0 }));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(saida as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Score Card")!;
    expect([ws.getCell("C7").value, ws.getCell("C8").value, ws.getCell("C9").value]).toEqual([
      "Contratada: Adm. Teste",
      "Local de Prestação: Torre Teste",
      "Período avaliado: jul a set/26",
    ]);
    expect([ws.getCell("F13").value, ws.getCell("N13").value]).toEqual([0.9757, "jul 46/46 <ok> & ago"]);
    expect([ws.getCell("F14").value, ws.getCell("N14").value]).toEqual([0, null]);
    expect(ws.getCell("F15").value).toBeNull(); // item sem nota fica em branco
    expect((ws.getCell("G14").value as { formula: string }).formula).toBe('IF($F14>=Classificação!$D$5-0,"X","")');
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Score Card", "Classificação"]);
    const zip = await JSZip.loadAsync(saida);
    expect(await zip.file("xl/workbook.xml")!.async("string")).toContain('fullCalcOnLoad="1"');
    expect(zip.file("xl/calcChain.xml")).toBeNull();
  });

  it("cria a célula que o modelo não tem, na ordem das colunas", () => {
    const xml = '<row r="4"><c r="A4" s="1"/><c r="D4"><v>1</v></c></row>';
    expect(gravarCelula(xml, "B4", { numero: 2 })).toBe('<row r="4"><c r="A4" s="1"/><c r="B4"><v>2</v></c><c r="D4"><v>1</v></c></row>');
    expect(gravarCelula(xml, "A4", { texto: "a&b" })).toContain('<c r="A4" s="1" t="inlineStr"><is><t xml:space="preserve">a&amp;b</t></is></c>');
  });

  it("guarda só o modelo que serve, com log; recusa outro formato e modelo sem algum item", async () => {
    expect(await salvarModelo("pessoa@exemplo.test", "ADMINISTRADORA", "modelo.pdf", Buffer.from("%PDF-1.4"))).toMatch(/xlsx/);
    expect(await salvarModelo("pessoa@exemplo.test", "ADMINISTRADORA", "m.xlsx", await modeloSintetico({ sem: "3.2" }))).toMatch(/3\.2/);
    expect(await carregarModelo("ADMINISTRADORA")).toBeNull();
    const bom = await modeloSintetico();
    expect(await salvarModelo("pessoa@exemplo.test", "ADMINISTRADORA", "m.xlsx", bom)).toBeNull();
    expect((await carregarModelo("ADMINISTRADORA"))!.equals(bom)).toBe(true);
    expect(await prisma.logAlteracao.count({ where: { entidade: "ModeloPlanilha" } })).toBe(1);
  });
});
