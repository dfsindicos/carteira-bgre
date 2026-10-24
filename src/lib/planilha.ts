import ExcelJS from "exceljs";
import { ESCALA, FONTES, GRUPOS, calcular, classificar, formatarPeriodo, mesesDoPeriodo, type Notas, type Periodo } from "./scorecard";

// "Gerar planilha BGRE": a avaliação do trimestre num .xlsx, no padrão de planilha da DF (Calibri 10, cabeçalho
// azul-marinho 2F4162 com texto branco, bordas finas A6A6A6, painel congelado).
// shortcut: formato próprio da DF; trocar pelo modelo oficial da BGRE quando o usuário mandar o arquivo deles.

export type DadosPlanilha = {
  condominio: string;
  contratada: string;
  periodo: Periodo;
  status: "RASCUNHO" | "ENTREGUE";
  notas: Notas;
  comentarios: Record<string, string>;
};

const MARINHO = "FF2F4162";
const CINZA = "FFA6A6A6";
const ROTULO = "FFFFF9DB";
const GRUPO = "FFE8ECF3";
const borda = { style: "thin" as const, color: { argb: CINZA } };
const BORDAS = { top: borda, left: borda, bottom: borda, right: borda };
const fundo = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
// Notas guardadas de 0 a 100; na planilha vão como fração com formato de %, para o Excel somar e comparar.
const pct = (v: number | null | undefined) => (typeof v === "number" ? v / 100 : null);

export async function planilhaBgre(d: DadosPlanilha): Promise<Buffer> {
  const r = calcular(d.notas);
  const wb = new ExcelJS.Workbook();
  wb.creator = "DF Síndicos · Carteira BGRE";
  const ws = wb.addWorksheet(`Avaliação ${formatarPeriodo(d.periodo)}`, { views: [{ showGridLines: false }] });
  ws.properties.defaultRowHeight = 15;
  [3, 9, 62, 12, 11, 15, 50].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  ws.getCell("B2").value = "AVALIAÇÃO TRIMESTRAL DA GERENCIADORA · SCORE CARD";
  ws.getCell("B2").font = { name: "Calibri", size: 16, bold: true, color: { argb: MARINHO } };
  ws.getCell("B3").value = `${d.condominio} · ${formatarPeriodo(d.periodo)} (${mesesDoPeriodo(d.periodo)})`;
  ws.getCell("B3").font = { name: "Calibri", size: 12, color: { argb: "FF5B6470" } };

  const ident: [string, string][] = [
    ["Condomínio", d.condominio],
    ["Contratada", d.contratada],
    ["Período", `${formatarPeriodo(d.periodo)} (${mesesDoPeriodo(d.periodo)})`],
    ["Situação", d.status === "ENTREGUE" ? "Entregue" : "Rascunho"],
  ];
  ident.forEach(([rotulo, valor], i) => {
    const linha = 5 + i;
    ws.mergeCells(linha, 3, linha, 7);
    const a = ws.getCell(linha, 2);
    a.value = rotulo;
    a.font = { name: "Calibri", size: 10, bold: true };
    a.fill = fundo(ROTULO);
    a.border = BORDAS;
    const b = ws.getCell(linha, 3);
    b.value = valor;
    b.font = { name: "Calibri", size: 10 };
    b.border = BORDAS;
  });

  const cab = ws.getRow(10);
  cab.values = [undefined, "#", "Item", "Fonte", "Nota", "Classificação", "Comentário / evidência"];
  cab.eachCell((c) => {
    c.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = fundo(MARINHO);
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = BORDAS;
  });
  ws.views = [{ state: "frozen", ySplit: 10, showGridLines: false }];

  let linha = 11;
  const escrever = (valores: (string | number | null)[], opcoes: { grupo?: boolean } = {}) => {
    const row = ws.getRow(linha++);
    row.values = [undefined, ...valores];
    for (let c = 2; c <= 7; c++) {
      const cel = row.getCell(c);
      cel.font = { name: "Calibri", size: 10, bold: !!opcoes.grupo };
      cel.border = BORDAS;
      cel.alignment = { vertical: "top", wrapText: true, horizontal: c === 5 ? "right" : c === 4 || c === 6 ? "center" : "left" };
      if (opcoes.grupo) cel.fill = fundo(GRUPO);
    }
    row.getCell(5).numFmt = "0.0%";
    return row;
  };

  GRUPOS.forEach((g, gi) => {
    const res = r.grupos[gi]!;
    const row = escrever([`${gi + 1}`, `${g.nome} · peso ${Math.round(g.peso * 100)}%`, "", pct(res.media), res.classificacao ?? "", ""], { grupo: true });
    ws.mergeCells(row.number, 3, row.number, 4);
    for (const it of g.itens) {
      const nota = d.notas[it.codigo];
      escrever([it.codigo, it.descricao, FONTES[it.fonte], pct(nota), typeof nota === "number" ? classificar(nota) : "", d.comentarios[it.codigo] ?? ""]);
    }
  });

  linha++;
  const fim = ws.getRow(linha);
  fim.values = [undefined, "", "AVALIAÇÃO FINAL", "", pct(r.final), r.classificacao ?? `Faltam ${r.faltam}`, ""];
  for (let c = 2; c <= 7; c++) {
    const cel = fim.getCell(c);
    cel.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    cel.fill = fundo(MARINHO);
    cel.border = BORDAS;
    cel.alignment = { vertical: "middle", horizontal: c === 5 ? "right" : c === 6 ? "center" : "left" };
  }
  fim.getCell(5).numFmt = "0.0%";
  fim.height = 22;
  const esc = ws.getCell(linha + 1, 3);
  esc.value = `Escala: ${ESCALA}`;
  esc.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF5B6470" } };
  const pesos = ws.getCell(linha + 2, 3);
  pesos.value = "Média do grupo = média simples dos itens; avaliação final = soma das médias dos grupos × peso.";
  pesos.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF5B6470" } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
