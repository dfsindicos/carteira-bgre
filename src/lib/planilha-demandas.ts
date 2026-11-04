import ExcelJS from "exceljs";
import { ROTULO_AGUARDANDO, ROTULO_SITUACAO, nomeCondominio, type listarDemandas } from "./demandas";
import { ROTULO_CRITICIDADE } from "./prazos-demandas";

// "Exportar Excel" da página Demandas: as linhas do filtro atual, no padrão de planilha da DF (Calibri 10, cabeçalho
// azul-marinho 2F4162 com texto branco, bordas finas A6A6A6, painel congelado, filtro automático).

type Linha = Awaited<ReturnType<typeof listarDemandas>>["linhas"][number];
const MARINHO = "FF2F4162";
const borda = { style: "thin" as const, color: { argb: "FFA6A6A6" } };
const BORDAS = { top: borda, left: borda, bottom: borda, right: borda };
// O Excel não tem fuso: as datas vão no relógio de São Paulo (UTC-3, sem horário de verão).
const sp = (d: Date | null) => (d ? new Date(d.getTime() - 3 * 3_600_000) : null);
const ORIGEM = { email: "e-mail", sla: "SLA", combinado: "combinado", "a-combinar": "a combinar" } as const;

export async function planilhaDemandas(linhas: Linha[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DF Síndicos · Carteira BGRE";
  const ws = wb.addWorksheet("Demandas BGRE", { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
  const colunas: [string, number, string?][] = [
    ["Nº", 6],
    ["Demanda", 48],
    ["Pedido por", 26],
    ["E-mail", 28],
    ["Condomínio", 24],
    ["Criticidade", 11],
    ["Chegou", 16, "dd/mm/yyyy hh:mm"],
    ["1ª resposta em", 16, "dd/mm/yyyy hh:mm"],
    ["1ª resposta", 34],
    ["Prazo", 16, "dd/mm/yyyy hh:mm"],
    ["Origem do prazo", 13],
    ["Situação do prazo", 22],
    ["Situação", 14],
    ["Aguardando", 14],
    ["Responsável", 24],
    ["Concluída em", 16, "dd/mm/yyyy hh:mm"],
    ["Motivo do arquivamento", 30],
    ["Link do e-mail", 30],
  ];
  ws.columns = colunas.map(([header, width, numFmt]) => ({ header, width, style: numFmt ? { numFmt } : {} }));
  for (const d of linhas)
    ws.addRow([
      d.numero,
      d.titulo,
      d.remetenteNome,
      d.remetenteEmail,
      nomeCondominio(d) ?? "",
      ROTULO_CRITICIDADE[d.criticidade],
      sp(d.chegadaEm),
      sp(d.primeiraRespostaEm),
      d.resposta.texto,
      sp(d.prazoEm.em),
      ORIGEM[d.prazoEm.origem],
      d.prazo.texto,
      ROTULO_SITUACAO[d.situacao],
      d.aguardando ? ROTULO_AGUARDANDO[d.aguardando] : "",
      d.responsavel,
      sp(d.concluidaEm),
      d.motivoArquivo ?? "",
      d.webLink ? { text: "abrir", hyperlink: d.webLink } : "",
    ]);
  ws.eachRow((row, n) =>
    row.eachCell({ includeEmpty: true }, (c) => {
      c.font = n === 1 ? { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } } : { name: "Calibri", size: 10 };
      if (n === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MARINHO } };
      c.alignment = { vertical: "top", wrapText: n === 1 || Number(c.col) === 2 };
      c.border = BORDAS;
    }),
  );
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
