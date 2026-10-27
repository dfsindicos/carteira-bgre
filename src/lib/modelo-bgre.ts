import ExcelJS from "exceljs";
import JSZip from "jszip";
import { registrar } from "./avaliacoes";
import { prisma } from "./db";
import { normalizar } from "./importacao";
import { MODELOS, type Tipo } from "./scorecard";
import type { DadosPlanilha } from "./planilha";

// Planilha no modelo oficial da BGRE (pedido do usuário de 2026-10-27: "exatamente o modelo da planilha deles").
// O modelo (.xlsx) fica no banco, enviado pela tela Cadastro; o repositório é público e o arquivo é da Brookfield.
// O preenchimento mexe só nas células de valor do XML da aba do Score Card: logo, estilos, fórmulas e as outras abas
// ficam como vieram. Onde achar cada coisa é lido do próprio modelo, como na importação (rótulos, "#", "Peso").

type Lugar = { ref: string; prefixo: string | null };
export type Mapa = {
  aba: string;
  contratada: Lugar;
  local: Lugar;
  periodo: Lugar;
  itens: Record<string, { linha: number }>;
  colNota: number;
  colComentario: number;
  /** Colunas das marcas "X" de Excelente a Ruim, com as fórmulas de uma linha modelo (só na planilha da Administradora). */
  marcas: { linha: number; formulas: Record<number, string> } | null;
};

const letra = (c: number): string => (c > 26 ? letra(Math.floor((c - 1) / 26)) : "") + String.fromCharCode(65 + ((c - 1) % 26));
const texto = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "richText" in v) return v.richText.map((r) => r.text).join("");
  if (typeof v === "object" && "result" in v) return String(v.result ?? "");
  return String(v);
};

/** Acha no modelo as células do cabeçalho, as linhas dos itens e as colunas de nota, comentário e marcas. */
export async function mapearModelo(modelo: Buffer, tipo: Tipo): Promise<Mapa> {
  // Só os valores e fórmulas interessam aqui; sem os desenhos (logo), que o exceljs não lê quando o modelo usa caminho
  // absoluto ("/xl/drawings/…"), como o da Sindicância.
  const zip = await JSZip.loadAsync(modelo);
  for (const f of Object.keys(zip.files).filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n)))
    zip.file(f, (await zip.file(f)!.async("string")).replace(/<(legacyDrawing|drawing)\b[^>]*\/>/g, ""));
  for (const f of Object.keys(zip.files).filter((n) => n.startsWith("xl/worksheets/_rels/") || n.startsWith("xl/drawings/"))) zip.remove(f);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await zip.generateAsync({ type: "nodebuffer" })) as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("O arquivo não tem nenhuma aba.");
  const celulas: { linha: number; coluna: number; t: string; n: string; formula?: string }[] = [];
  ws.eachRow((r, linha) =>
    r.eachCell((c, coluna) => {
      if (c.isMerged && c.master.address !== c.address) return; // célula escondida numa mesclagem repete o valor da principal
      const t = texto(c.value).trim();
      const formula = c.formula ? String(c.formula) : undefined;
      if (t || formula) celulas.push({ linha, coluna, t, n: normalizar(t), formula });
    }),
  );
  // "Contratada: CBRE" na mesma célula, ou "Empreendimento:" com o valor na próxima célula preenchida da linha.
  const lugar = (...rotulos: string[]): Lugar => {
    const c = celulas.find((x) => rotulos.some((r) => x.n.startsWith(r)) && !x.formula);
    if (!c) throw new Error(`Não achei o rótulo "${rotulos[0]}" no topo do modelo.`);
    const [antes, ...resto] = c.t.split(":");
    const seguinte = celulas.find((x) => x.linha === c.linha && x.coluna > c.coluna);
    if (resto.join(":").trim() || !seguinte) return { ref: `${letra(c.coluna)}${c.linha}`, prefixo: `${antes}: ` };
    return { ref: `${letra(seguinte.coluna)}${seguinte.linha}`, prefixo: null };
  };
  const cab = celulas.find((c) => c.t === "#" && celulas.some((x) => x.linha === c.linha && x.n === "peso"));
  if (!cab) throw new Error('Não achei a linha de cabeçalho com "#" e "Peso".');
  const coluna = (pred: (n: string) => boolean, nome: string) => {
    const c = celulas.find((x) => x.linha === cab.linha && pred(x.n));
    if (!c) throw new Error(`Não achei a coluna "${nome}" no cabeçalho.`);
    return c.coluna;
  };
  const colNota = coluna((n) => n === "peso", "Peso");
  const colComentario = coluna((n) => n.startsWith("comentario"), "Comentário");
  const fim = celulas.find((c) => c.linha > cab.linha && c.n === "avaliacao final")?.linha ?? Infinity;
  const itens: Mapa["itens"] = {};
  for (const c of celulas.filter((x) => x.coluna === cab.coluna && x.linha > cab.linha && x.linha < fim)) itens[c.t] ??= { linha: c.linha };
  const faltam = MODELOS[tipo].codigos.filter((k) => !itens[k]);
  if (faltam.length)
    throw new Error(`O modelo não tem os itens ${faltam.join(", ")} do Score Card da ${tipo === "SINDICANCIA" ? "Sindicância" : "Administradora"}.`);

  // Marcas: as cinco colunas depois da nota, numa linha de item em que todas são fórmula que olha a própria nota.
  let marcas: Mapa["marcas"] = null;
  const notaRef = new RegExp(`\\$?${letra(colNota)}(\\d+)\\b`);
  for (const k of MODELOS[tipo].codigos) {
    const linha = itens[k]!.linha;
    const fs = [1, 2, 3, 4, 5].map((d) => celulas.find((x) => x.linha === linha && x.coluna === colNota + d)?.formula);
    if (fs.every((f) => f && notaRef.exec(f)?.[1] === String(linha))) {
      marcas = { linha, formulas: Object.fromEntries(fs.map((f, i) => [colNota + i + 1, f!])) };
      break;
    }
  }
  return {
    aba: ws.name,
    contratada: lugar("contratada"),
    local: lugar("local de prestacao", "empreendimento"),
    periodo: lugar("periodo avaliado"),
    itens: Object.fromEntries(MODELOS[tipo].codigos.map((k) => [k, itens[k]!])),
    colNota,
    colComentario,
    marcas,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
type Valor = { numero: number } | { texto: string } | { formula: string } | null;

/** Troca o conteúdo de uma célula do XML da aba, mantendo o estilo (s). Cria a célula na linha se não existir. */
export function gravarCelula(xml: string, ref: string, valor: Valor): string {
  const conteudo = (s: string) => {
    const estilo = s ? ` s="${s}"` : "";
    if (!valor) return `<c r="${ref}"${estilo}/>`;
    if ("numero" in valor) return `<c r="${ref}"${estilo}><v>${valor.numero}</v></c>`;
    if ("texto" in valor) return `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${esc(valor.texto)}</t></is></c>`;
    return `<c r="${ref}"${estilo} t="str"><f>${esc(valor.formula)}</f></c>`;
  };
  const atual = new RegExp(`<c r="${ref}"(?=[\\s/>])([^>]*?)(/>|>[\\s\\S]*?</c>)`);
  const m = atual.exec(xml);
  if (m) return xml.slice(0, m.index) + conteudo(/\ss="(\d+)"/.exec(m[1]!)?.[1] ?? "") + xml.slice(m.index + m[0].length);
  // Célula ausente: entra na linha, antes da primeira célula de coluna maior (a ordem importa para o Excel).
  const [, col, linha] = /^([A-Z]+)(\d+)$/.exec(ref)!;
  const linhaRe = new RegExp(`<row r="${linha}"[^>]*?(/>|>([\\s\\S]*?)</row>)`);
  const r = linhaRe.exec(xml);
  if (!r) throw new Error(`O modelo não tem a linha ${linha}.`);
  if (r[1] === "/>") return xml.replace(r[0], r[0].replace(/\/>$/, `>${conteudo("")}</row>`));
  const numero = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const depois = [...r[2]!.matchAll(/<c r="([A-Z]+)\d+"/g)].find((c) => numero(c[1]!) > numero(col!));
  const corpo = depois ? r[2]!.replace(depois[0], conteudo("") + depois[0]) : r[2]! + conteudo("");
  return xml.replace(r[0], r[0].replace(r[2]!, corpo));
}

/** Preenche o modelo oficial com a avaliação: cabeçalho, nota (fração, formato % do modelo) e comentário de cada item. */
export async function preencherModelo(modelo: Buffer, d: DadosPlanilha & { meses: string }): Promise<Buffer> {
  const tipo = d.tipo ?? "ADMINISTRADORA";
  const mapa = await mapearModelo(modelo, tipo);
  const zip = await JSZip.loadAsync(modelo);
  const arquivoDaAba = await caminhoDaAba(zip, mapa.aba);
  let xml = await zip.file(arquivoDaAba)!.async("string");

  const cabecalho = (l: Lugar, valor: string) => (xml = gravarCelula(xml, l.ref, { texto: `${l.prefixo ?? ""}${valor}` }));
  cabecalho(mapa.contratada, d.contratada);
  cabecalho(mapa.local, d.condominio);
  cabecalho(mapa.periodo, d.meses);
  for (const [codigo, { linha }] of Object.entries(mapa.itens)) {
    const nota = d.notas[codigo];
    xml = gravarCelula(xml, `${letra(mapa.colNota)}${linha}`, typeof nota === "number" ? { numero: Math.round(nota * 100) / 10000 } : null);
    xml = gravarCelula(xml, `${letra(mapa.colComentario)}${linha}`, d.comentarios[codigo] ? { texto: d.comentarios[codigo]! } : null);
    // As marcas "X" voltam a ser fórmula em todos os itens: o modelo pode trazer "X" digitado à mão de outro trimestre.
    if (mapa.marcas)
      for (const [col, f] of Object.entries(mapa.marcas.formulas)) {
        const formula = f.replace(new RegExp(`(\\$?${letra(mapa.colNota)})${mapa.marcas.linha}\\b`, "g"), `$1${linha}`);
        xml = gravarCelula(xml, `${letra(Number(col))}${linha}`, { formula });
      }
  }
  // Resultado guardado das fórmulas sai: é o do modelo, com as notas de outro trimestre. Quem abre recalcula.
  xml = xml.replace(/(<f\b[^>]*(?:\/>|>[\s\S]*?<\/f>))<v>[\s\S]*?<\/v>|(<f\b[^>]*(?:\/>|>[\s\S]*?<\/f>))<v\/>/g, "$1$2");
  zip.file(arquivoDaAba, xml);

  // Sem a cadeia de cálculo antiga (ela cita fórmulas que viraram valor) e com recálculo ao abrir, para as marcas,
  // os índices por bloco e a avaliação final saírem das fórmulas da BGRE com as notas novas.
  zip.remove("xl/calcChain.xml");
  for (const [arquivo, padrao] of [
    ["xl/_rels/workbook.xml.rels", /<Relationship [^>]*calcChain[^>]*\/>/g],
    ["[Content_Types].xml", /<Override [^>]*calcChain[^>]*\/>/g],
  ] as const) {
    const f = zip.file(arquivo);
    if (f) zip.file(arquivo, (await f.async("string")).replace(padrao, ""));
  }
  const wb = await zip.file("xl/workbook.xml")!.async("string");
  zip.file(
    "xl/workbook.xml",
    /<calcPr\b/.test(wb)
      ? wb.replace(/<calcPr\b([^>]*?)\s*\/>/, (_, a: string) => `<calcPr${a.replace(/\sfullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"/>`)
      : wb.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>'),
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Caminho do XML da aba pelo nome (workbook.xml → rels). */
async function caminhoDaAba(zip: JSZip, nome: string): Promise<string> {
  const wb = await zip.file("xl/workbook.xml")!.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  const sheet = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((s) => s.includes(`name="${esc(nome)}"`));
  const rid = sheet && /r:id="([^"]+)"/.exec(sheet)?.[1];
  const alvo = rid && new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`).exec(rels)?.[0];
  const target = alvo && /Target="([^"]+)"/.exec(alvo)?.[1];
  if (!target) throw new Error(`Não achei o XML da aba "${nome}".`);
  return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
}

export const LIMITE_MODELO = 5 * 1024 * 1024;

/** Guarda (ou troca) o modelo de um tipo, só se o preenchimento acha nele tudo o que precisa. Devolve o erro, se houver. */
export async function salvarModelo(email: string, tipo: Tipo, nome: string, arquivo: Buffer): Promise<string | null> {
  if (arquivo.length > LIMITE_MODELO) return "Modelo maior que 5 MB.";
  if (arquivo[0] !== 0x50 || arquivo[1] !== 0x4b || !/\.xlsx$/i.test(nome)) return "Envie o modelo em .xlsx.";
  try {
    await preencherModelo(arquivo, {
      tipo,
      condominio: "Teste",
      contratada: "Teste",
      periodo: { ano: 2026, trimestre: 1 },
      status: "RASCUNHO",
      notas: {},
      comentarios: {},
      meses: "jan a mar/26",
    });
  } catch (e) {
    return `Este arquivo não serve de modelo: ${e instanceof Error ? e.message : "não consegui ler."}`;
  }
  await prisma.$transaction(async (tx) => {
    const antes = await tx.modeloPlanilha.findUnique({ where: { tipo }, select: { nome: true } });
    const bytes = new Uint8Array(arquivo);
    await tx.modeloPlanilha.upsert({
      where: { tipo },
      create: { tipo, nome, arquivo: bytes, enviadoPor: email },
      update: { nome, arquivo: bytes, enviadoPor: email },
    });
    await registrar(tx, email, "ModeloPlanilha", tipo, "modelo", antes?.nome ?? null, nome);
  });
  return null;
}

export async function carregarModelo(tipo: Tipo): Promise<Buffer | null> {
  const m = await prisma.modeloPlanilha.findUnique({ where: { tipo }, select: { arquivo: true } });
  return m ? Buffer.from(m.arquivo) : null;
}
export const listarModelos = () => prisma.modeloPlanilha.findMany({ select: { tipo: true, nome: true, enviadoEm: true, enviadoPor: true } });
