import "./ambiente";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { importarPlanilhas, lerPlanilha, periodoDoNome, periodoDoTexto, type Arquivo } from "@/lib/importacao";
import { CODIGOS, MODELOS, calcular } from "@/lib/scorecard";
import { limparECriar } from "./dados";

const EMAIL = "pessoa@exemplo.test";

type Opcoes = {
  predio?: string;
  adm?: string;
  periodo?: string;
  /** Valor na mesma célula do rótulo ("Rótulo:  valor") ou na célula seguinte. */
  naCelulaSeguinte?: boolean;
  notas?: Record<string, number | string | null>;
  comentarios?: Record<string, string>;
  final?: number;
  aba?: string;
  virgula43?: boolean;
  nota35?: number | string;
};

/** Planilha sintética no layout do modelo da Brookfield: C4:N56, colunas Item | # | Descrição | Peso | … | Comentário. */
async function planilha(o: Opcoes = {}): Promise<Uint8Array> {
  const notas: Record<string, number | string | null> = { ...Object.fromEntries(CODIGOS.map((c, i) => [c, (90 + (i % 9)) / 100])), ...o.notas };
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(o.aba ?? "Score Card");
  wb.addWorksheet("Classificação", { state: "hidden" });
  wb.addWorksheet("fonte dados_cálculos");
  ws.getCell("C4").value = "Avaliação Trimestral de Prestação de Serviços - Gerenciamento de Propriedades";
  const topo: [string, string][] = [
    ["Contratada:", o.adm ?? "Adm Demo"],
    ["Local de Prestação:", o.predio ?? "Torre Demo"],
    ["Período avaliado:", o.periodo ?? "abr a jun/26"],
  ];
  topo.forEach(([r, v], i) => {
    if (o.naCelulaSeguinte) {
      ws.getCell(6 + i, 3).value = r;
      ws.getCell(6 + i, 5).value = v;
    } else ws.getCell(6 + i, 3).value = `${r}  ${v}`;
  });
  ["Item", "#", "Descrição", "Peso", "Excelente", "Bom", "Satisfatório", "Regular", "Ruim", "Não Aplicável", null, "Comentário"].forEach(
    (t, i) => (ws.getCell(10, 3 + i).value = t),
  );
  let linha = 11;
  const escrever = (codigo: string, desc: string, v: number | string | null | undefined) => {
    ws.getCell(linha, 4).value = codigo;
    ws.getCell(linha, 5).value = desc;
    if (typeof v === "number") ws.getCell(linha, 6).value = { formula: `AVERAGE(G${linha}:K${linha})`, result: v };
    else if (v !== null && v !== undefined) ws.getCell(linha, 6).value = v;
    if (o.comentarios?.[codigo]) ws.getCell(linha, 14).value = o.comentarios[codigo];
    linha++;
  };
  ws.getCell(linha++, 3).value = "1. Atendimento das OS";
  for (const c of CODIGOS) {
    if (c === "2.2.1") escrever("2.2", "Realização de Serviços programados", null);
    escrever(c === "4.3" && o.virgula43 ? "4,3" : c, `Descrição ${c}`, notas[c]);
    if (c === "3.4") escrever("3.5", "Fornecimento planilha medições equipamentos", o.nota35 ?? null);
  }
  const final = o.final ?? calcular(Object.fromEntries(Object.entries(notas).map(([c, v]) => [c, typeof v === "number" ? v * 100 : null]))).final! / 100;
  ws.getCell(linha, 3).value = "AVALIAÇÃO FINAL";
  ws.getCell(linha, 6).value = { formula: "SUM(X1:X2)", result: final };
  ws.getCell(linha, 7).value = "Bom";
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const arq = async (nome: string, o?: Opcoes): Promise<Arquivo> => ({ nome, bytes: await planilha(o) });
const simular = (a: Arquivo[], substituir = false) => importarPlanilhas(EMAIL, a, { substituir, gravar: false });
const importar = (a: Arquivo[], substituir = false) => importarPlanilhas(EMAIL, a, { substituir, gravar: true });
const linhas = async (p: ReturnType<typeof importarPlanilhas>) => {
  const r = await p;
  if ("erro" in r) throw new Error(r.erro);
  return r.linhas;
};

beforeEach(async () => {
  await limparECriar();
});
afterAll(() => prisma.$disconnect());

describe("período", () => {
  it("lê as variações reais do texto e do nome do arquivo", () => {
    expect(periodoDoTexto("abr a jun/26")).toEqual({ trimestre: 2, ano: 2026 });
    expect(periodoDoTexto("jan a mar de 2026")).toEqual({ trimestre: 1, ano: 2026 });
    expect(periodoDoTexto("OUT A DEZ/25")).toEqual({ trimestre: 4, ano: 2025 });
    expect(periodoDoTexto("jul a set/2025")).toEqual({ trimestre: 3, ano: 2025 });
    expect(periodoDoTexto("abr a jun de")).toEqual({ trimestre: 2, ano: null });
    expect(periodoDoNome("Torre - 2T26 - avaliação.xlsx")).toEqual({ trimestre: 2, ano: 2026 });
    expect(periodoDoNome("Torre - Q226 - x.xlsx")).toEqual({ trimestre: 2, ano: 2026 });
    expect(periodoDoNome("Torre Demo - Q2-26 - x.xlsx")).toEqual({ trimestre: 2, ano: 2026 });
    expect(periodoDoNome("TD - 1T25 - x.xlsx")).toEqual({ trimestre: 1, ano: 2025 });
    expect(periodoDoNome("sem período.xlsx")).toBeNull();
  });

  it("usa o nome do arquivo quando a planilha não tem o ano, e falha sem nenhum dos dois", async () => {
    const a = await lerPlanilha("TD - Q1-25 - x.xlsx", await planilha({ periodo: "abr a jun de" }));
    expect(a.periodo).toEqual({ ano: 2025, trimestre: 2 });
    const b = await lerPlanilha("sem.xlsx", await planilha({ periodo: "abr a jun de" }));
    expect(b.erro).toMatch(/período/);
  });
});

describe("leitura da planilha", () => {
  it("lê rótulos na mesma célula ou na seguinte, notas em %, comentários, 4,3, N/A e ignora 2.2 e 3.5", async () => {
    const l = await lerPlanilha(
      "x.xlsx",
      await planilha({
        naCelulaSeguinte: true,
        periodo: "OUT A DEZ/25",
        virgula43: true,
        notas: { "4.3": 0.955, "2.5": "N/A", "2.6": null, "1.1": 97.5 },
        comentarios: { "2.2.1": "12 de 13 semanas" },
        nota35: 0.8,
      }),
    );
    expect(l.erro).toBeUndefined();
    expect(l.predio).toBe("Torre Demo");
    expect(l.administradora).toBe("Adm Demo");
    expect(l.periodo).toEqual({ ano: 2025, trimestre: 4 });
    expect(l.notas["4.3"]).toBe(95.5);
    expect(l.notas["1.1"]).toBe(97.5);
    expect(l.notas["2.5"]).toBeNull();
    expect(l.notas["2.6"]).toBeNull();
    expect(Object.keys(l.notas).sort()).toEqual([...CODIGOS].sort());
    expect(l.comentarios["2.2.1"]).toBe("12 de 13 semanas");
    expect(l.avisos).toEqual(expect.arrayContaining(["2.5 sem nota (N/A).", "2.6 sem nota (vazio).", "3.5 ignorado (não entra no Score Card)."]));
  });

  it("avisa quando a nota final da planilha difere da conta do sistema em mais de 0,1 ponto", async () => {
    const igual = await lerPlanilha("x.xlsx", await planilha());
    expect(igual.avisos).toEqual([]);
    const diferente = await lerPlanilha("x.xlsx", await planilha({ final: 0.5 }));
    expect(diferente.finalPlanilha).toBe(50);
    expect(diferente.avisos.join()).toMatch(/A planilha diz 50,0%, o sistema calcula 9\d,\d%/);
  });

  it("acha a aba pela célula AVALIAÇÃO FINAL quando o nome muda", async () => {
    const l = await lerPlanilha("x.xlsx", await planilha({ aba: "Avaliação" }));
    expect(l.erro).toBeUndefined();
    expect(Object.values(l.notas).filter((n) => n !== null)).toHaveLength(16);
  });
});

describe("importação", () => {
  it("abre o .zip ignorando pasta, __MACOSX, ~$ e o que não é .xlsx", async () => {
    const zip = new JSZip();
    zip.file("Pasta/Torre Demo - 2T26 - a.xlsx", await planilha());
    zip.file("Pasta/Torre Demo - 1T26 - b.xlsx", await planilha({ periodo: "jan a mar de 2026" }));
    zip.file("__MACOSX/Pasta/._Torre Demo - 2T26 - a.xlsx", "lixo");
    zip.file("Pasta/~$Torre Demo - 2T26 - a.xlsx", "lixo");
    zip.file("Pasta/leia.txt", "lixo");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const l = await linhas(simular([{ nome: "pasta.zip", bytes }]));
    expect(l.map((x) => [x.arquivo, x.periodo, x.acao])).toEqual([
      ["Torre Demo - 2T26 - a.xlsx", "2T26", "nova"],
      ["Torre Demo - 1T26 - b.xlsx", "1T26", "nova"],
    ]);
  });

  it("simula sem gravar; prédio e administradora novos aparecem como novos e são criados na importação", async () => {
    const a = [await arq("TD - 2T26.xlsx"), await arq("TD - 1T26.xlsx", { periodo: "jan a mar/26" })];
    const s = await linhas(simular(a));
    expect(s.map((x) => [x.predioNovo, x.administradoraNova, x.lidas, x.acao])).toEqual([
      [true, true, 16, "nova"],
      [false, false, 16, "nova"],
    ]);
    expect(await prisma.avaliacao.count()).toBe(0);

    const r = await linhas(importar(a));
    expect(r.map((x) => x.resultado)).toEqual(["importada", "importada"]);
    const c = await prisma.condominio.findUniqueOrThrow({ where: { nome: "Torre Demo" }, include: { administradora: true, avaliacoes: { include: { notas: true } } } });
    expect(c.administradora).toMatchObject({ nome: "Adm Demo", emails: "" });
    expect(c.avaliacoes.map((x) => x.status)).toEqual(["ENTREGUE", "ENTREGUE"]);
    expect(c.avaliacoes[0]!.notas).toHaveLength(16);
    const log = await prisma.logAlteracao.findMany({ orderBy: { em: "asc" } });
    expect(log.map((x) => [x.entidade, x.campo, x.email])).toEqual([
      ["Administradora", "criada pela importação", EMAIL],
      ["Condominio", "criado pela importação", EMAIL],
      ["Avaliacao", "importada", EMAIL],
      ["Avaliacao", "importada", EMAIL],
    ]);
    expect(log[2]!.depois).toBe("2T26 · TD - 2T26.xlsx");
  });

  it("acha prédio e administradora já cadastrados pelo nome normalizado", async () => {
    const l = await linhas(simular([await arq("x - 2T26.xlsx", { predio: "TORRE  teste.", adm: "adm teste" })]));
    expect(l[0]).toMatchObject({ predioNovo: false, administradoraNova: false, acao: "nova" });
  });

  it("pula a avaliação que já existe; reimportar não muda nada; com substituir troca e registra antes e depois", async () => {
    const a = [await arq("TD - 2T26.xlsx", { comentarios: { "1.1": "antes" } })];
    await importar(a);
    const logs = await prisma.logAlteracao.count();

    const again = await linhas(importar(a));
    expect(again[0]).toMatchObject({ acao: "pular", resultado: "pulada" });
    expect(await prisma.logAlteracao.count()).toBe(logs);
    expect((await linhas(importar(a, true)))[0]).toMatchObject({ acao: "substituir", resultado: "sem mudança" });
    expect(await prisma.logAlteracao.count()).toBe(logs);

    const novo = [await arq("TD - 2T26.xlsx", { notas: { "1.1": 0.8 }, comentarios: { "1.1": "depois" } })];
    expect((await linhas(simular(novo, true)))[0]!.acao).toBe("substituir");
    expect((await linhas(importar(novo, true)))[0]!.resultado).toBe("substituída");
    const n = await prisma.notaItem.findFirstOrThrow({ where: { item: "1.1" } });
    expect([Number(n.nota), n.comentario]).toEqual([80, "depois"]);
    const novos = await prisma.logAlteracao.findMany({ orderBy: { em: "asc" }, skip: logs });
    expect(novos.map((x) => [x.campo, x.antes, x.depois])).toEqual([
      ["1.1 nota", "90", "80"],
      ["1.1 comentário", "antes", "depois"],
      ["substituída pela importação", null, "2T26 · TD - 2T26.xlsx"],
    ]);
  });

  it("arquivo inválido não derruba os outros", async () => {
    const l = await linhas(
      importar([
        { nome: "quebrada.xlsx", bytes: new TextEncoder().encode("não é xlsx") },
        { nome: "notas.pdf", bytes: new Uint8Array(3) },
        await arq("sem período.xlsx", { periodo: "" }),
        await arq("TD - 2T26.xlsx"),
      ]),
    );
    expect(l.map((x) => [x.arquivo, x.acao, x.erro ?? x.resultado])).toEqual([
      ["notas.pdf", "erro", "Não é .xlsx nem .zip."],
      ["quebrada.xlsx", "erro", "Não é uma planilha .xlsx válida."],
      ["sem período.xlsx", "erro", "Não achei o período (nem na planilha nem no nome do arquivo)."],
      ["TD - 2T26.xlsx", "nova", "importada"],
    ]);
    expect(await prisma.avaliacao.count()).toBe(1);
  });
});

/**
 * Planilha sintética no layout da Sindicância (Rev. 3): aba "Score Card Set.21", "Empreendimento:" com o valor na célula
 * seguinte, "Periodo avaliado:" com o valor duas células depois, cabeçalho com "Comentários", linhas "Resultado:".
 */
async function planilhaSindicancia(o: { predio?: string; periodo?: string; notas?: Record<string, number | null>; comentarios?: Record<string, string>; titulo?: boolean } = {}) {
  const codigos = MODELOS.SINDICANCIA.codigos;
  const notas: Record<string, number | null> = { ...Object.fromEntries(codigos.map((c, i) => [c, (91 + (i % 8)) / 100])), ...o.notas };
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Score Card Set.21");
  if (o.titulo !== false) ws.getCell("C3").value = "Avaliação dos Indicadores de Performance de Sindicância - Rev. 3 (Fevereiro 2024)";
  ws.getCell("C5").value = "Contratada: DF Sindicos";
  ws.getCell("C6").value = "Empreendimento:";
  ws.getCell("D6").value = o.predio ?? "Torre Teste";
  ws.getCell("C7").value = "Periodo avaliado:";
  ws.getCell("E7").value = o.periodo ?? "abr, mai e jun/26";
  ["Item", "#", "Descrição", "Peso", null, null, null, "Comentários"].forEach((t, i) => (ws.getCell(9, 3 + i).value = t));
  let linha = 10;
  for (const g of MODELOS.SINDICANCIA.grupos) {
    ws.getCell(linha++, 3).value = g.nome;
    for (const it of g.itens) {
      ws.getCell(linha, 4).value = it.codigo;
      ws.getCell(linha, 5).value = it.descricao;
      const v = notas[it.codigo];
      if (typeof v === "number") ws.getCell(linha, 6).value = { formula: `AVERAGE(G${linha}:I${linha})`, result: v };
      if (o.comentarios?.[it.codigo]) ws.getCell(linha, 10).value = o.comentarios[it.codigo];
      linha++;
    }
    ws.getCell(linha, 5).value = "Resultado:";
    ws.getCell(linha++, 6).value = 0.9;
  }
  const final = calcular(Object.fromEntries(Object.entries(notas).map(([c, v]) => [c, v === null ? null : v * 100])), "SINDICANCIA").final;
  ws.getCell(linha, 3).value = "AVALIAÇÃO FINAL";
  ws.getCell(linha, 6).value = { formula: "SUM(X1:X2)", result: final === null ? 0 : final / 100 };
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("planilha da Sindicância", () => {
  it("reconhece pelo título e lê Empreendimento, Periodo (duas células depois), Comentários e os 13 itens", async () => {
    const l = await lerPlanilha("x.xlsx", await planilhaSindicancia({ notas: { "3.8": 0.75 }, comentarios: { "3.4": "nota da administradora" } }));
    expect(l.erro).toBeUndefined();
    expect(l.tipo).toBe("SINDICANCIA");
    expect(l.predio).toBe("Torre Teste");
    expect(l.administradora).toBeUndefined();
    expect(l.periodo).toEqual({ ano: 2026, trimestre: 2 });
    expect(Object.keys(l.notas)).toEqual(MODELOS.SINDICANCIA.codigos);
    expect(l.notas["3.8"]).toBe(75);
    expect(l.comentarios["3.4"]).toBe("nota da administradora");
    expect(l.avisos).toEqual([]);
    expect(l.finalPlanilha).toBeCloseTo(calcular(l.notas, "SINDICANCIA").final!, 1);
  });

  it("reconhece pelo rótulo Empreendimento quando não há título", async () => {
    expect((await lerPlanilha("x.xlsx", await planilhaSindicancia({ titulo: false }))).tipo).toBe("SINDICANCIA");
    expect((await lerPlanilha("x.xlsx", await planilha())).tipo).toBe("ADMINISTRADORA");
  });

  it("importa as duas no mesmo envio (a da Administradora antes) e não mistura com a da Administradora", async () => {
    const envio = [
      { nome: "Sin - 2T26.xlsx", bytes: await planilhaSindicancia({ predio: "Torre Nova" }) },
      await arq("TN - 2T26.xlsx", { predio: "Torre Nova" }),
    ];
    const s = await linhas(simular(envio));
    expect(s.map((x) => [x.tipo, x.acao, x.lidas, x.total])).toEqual([
      ["ADMINISTRADORA", "nova", 16, 16],
      ["SINDICANCIA", "nova", 13, 13],
    ]);
    const r = await linhas(importar(envio));
    expect(r.map((x) => x.resultado)).toEqual(["importada", "importada"]);
    const avs = await prisma.avaliacao.findMany({ include: { notas: true }, orderBy: { tipo: "asc" } });
    expect(avs.map((a) => [a.tipo, a.notas.length, a.status, !!a.entregueEm])).toEqual([
      ["ADMINISTRADORA", 16, "ENTREGUE", true],
      ["SINDICANCIA", 13, "ENTREGUE", true],
    ]);
    // Reimportar pula as duas.
    expect((await linhas(importar(envio))).map((x) => x.resultado)).toEqual(["pulada", "pulada"]);
  });

  it("Sindicância de prédio que não existe é erro (não cria prédio sem administradora)", async () => {
    const l = await linhas(importar([{ nome: "Sin.xlsx", bytes: await planilhaSindicancia({ predio: "Prédio Desconhecido" }) }]));
    expect(l[0]).toMatchObject({ acao: "erro", erro: expect.stringMatching(/Prédio não cadastrado/) });
    expect(await prisma.avaliacao.count()).toBe(0);
  });
});

