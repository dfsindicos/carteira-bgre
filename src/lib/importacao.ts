import ExcelJS from "exceljs";
import JSZip from "jszip";
import { prisma } from "./db";
import { MODELOS, calcular, formatarNota, formatarPeriodo, prazoPadrao, type Notas, type Periodo, type Tipo } from "./scorecard";

// Importação das avaliações já entregues à BGRE, a partir das planilhas do modelo oficial da Brookfield (uma por prédio,
// trimestre e tipo: Administradora ou Sindicância). A tela simula (sem gravar) e depois importa os mesmos arquivos; nada
// é guardado em disco. A importação do JSON do checklist fica em src/lib/importacao-json.ts.

export const LIMITES = { planilhas: 200, xlsx: 5 * 1024 * 1024, zip: 60 * 1024 * 1024 };

export type Arquivo = { nome: string; bytes: Uint8Array };

export type Lida = {
  arquivo: string;
  tipo: Tipo;
  erro?: string;
  predio?: string;
  administradora?: string;
  periodo?: Periodo;
  notas: Notas;
  comentarios: Record<string, string>;
  finalPlanilha: number | null;
  avisos: string[];
};

export type Linha = {
  arquivo: string;
  tipo?: Tipo;
  erro?: string;
  predio?: string;
  predioNovo?: boolean;
  administradora?: string;
  administradoraNova?: boolean;
  periodo?: string;
  lidas: number;
  /** Itens do Score Card do tipo (16 ou 13). */
  total: number;
  finalPlanilha: number | null;
  finalCalculada: number | null;
  avisos: string[];
  acao: "nova" | "pular" | "substituir" | "erro";
  resultado?: "importada" | "pulada" | "substituída" | "sem mudança";
};

export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const arred = (v: number) => Math.round(v * 100) / 100;

// ── Leitura da planilha ────────────────────────────────────────────────────────────────────────────────────────────

/** Valor da célula: o resultado calculado das fórmulas, o texto do rich text e do hyperlink. */
function valor(c: ExcelJS.Cell): unknown {
  const v = c.value;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v || "formula" in v || "sharedFormula" in v) return (v as { result?: unknown }).result ?? null;
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return (v as { text: unknown }).text;
    if ("error" in v) return null;
  }
  return v;
}
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

type Celula = { linha: number; coluna: number; v: unknown; t: string; n: string };

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "abr a jun/26", "jan a mar de 2026", "OUT A DEZ/25", "abr a jun de" (sem ano: ano null). */
export function periodoDoTexto(t: string): { trimestre: number | null; ano: number | null } {
  const n = normalizar(t.replace(/\//g, " / "));
  const mes = new RegExp(`\\b(${MESES.join("|")})`).exec(n);
  const ano = [...t.matchAll(/(?:\/|\bde)\s*(\d{4}|\d{2})\b/gi)].pop()?.[1];
  return {
    trimestre: mes ? Math.floor(MESES.indexOf(mes[1]!) / 3) + 1 : null,
    ano: ano ? (ano.length === 2 ? 2000 + Number(ano) : Number(ano)) : null,
  };
}

/** "TD - 2T26 - ….xlsx", "TD - Q226 - …", "Torre Demo - Q2-26 - …". */
export function periodoDoNome(nome: string): Periodo | null {
  const m = /(?:^|[^a-z0-9])([1-4])T(\d{2})(?![0-9])/i.exec(nome) ?? /(?:^|[^a-z0-9])Q([1-4])-?(\d{2})(?![0-9])/i.exec(nome);
  return m ? { trimestre: Number(m[1]), ano: 2000 + Number(m[2]) } : null;
}

/** Nota da planilha (fração 0–1, ou já em % até 100) para 0–100 com 2 casas; null quando N/A, vazia ou inválida. */
function nota(v: unknown): number | null {
  let n: number | null = typeof v === "number" ? v : null;
  if (typeof v === "string") {
    const m = /^(\d+(?:[.,]\d+)?)\s*(%?)$/.exec(v.trim());
    if (m) n = m[2] ? Number(m[1]!.replace(",", ".")) / 100 : Number(m[1]!.replace(",", "."));
  }
  if (n === null || !Number.isFinite(n) || n < 0 || n > 100) return null;
  return arred(n <= 1 ? n * 100 : n);
}

export async function lerPlanilha(arquivo: string, bytes: Uint8Array): Promise<Lida> {
  const lida: Lida = { arquivo, tipo: "ADMINISTRADORA", notas: {}, comentarios: {}, finalPlanilha: null, avisos: [] };
  const falha = (erro: string) => ({ ...lida, erro });
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    return falha("Não é uma planilha .xlsx válida.");
  }

  const celulas = (ws: ExcelJS.Worksheet) => {
    const l: Celula[] = [];
    ws.eachRow((r, linha) =>
      r.eachCell((c, coluna) => {
        const v = valor(c);
        const t = texto(v);
        if (t) l.push({ linha, coluna, v, t, n: normalizar(t) });
      }),
    );
    return l;
  };
  const folhas = wb.worksheets;
  const ws =
    folhas.find((w) => normalizar(w.name).startsWith("score card")) ?? folhas.find((w) => celulas(w).some((c) => c.n === "avaliacao final"));
  if (!ws) return falha('Não achei a aba "Score Card" (nem uma aba com "AVALIAÇÃO FINAL").');
  const cs = celulas(ws);

  // Rótulo do topo: o valor vem depois dos dois-pontos na mesma célula ou na próxima célula preenchida da linha.
  const campo = (rotulo: string) => {
    const c = cs.find((x) => x.n.startsWith(rotulo));
    if (!c) return "";
    const depois = c.t.includes(":") ? c.t.slice(c.t.indexOf(":") + 1).trim() : "";
    if (depois) return depois;
    return cs.find((x) => x.linha === c.linha && x.coluna > c.coluna && x.t !== c.t)?.t ?? "";
  };
  // Sindicância: título "…Performance de Sindicância…" ou rótulo "Empreendimento"; a da Administradora usa "Local de Prestação".
  const sindicancia = cs.some((c) => c.n.includes("performance de sindicancia")) || (cs.some((c) => c.n.startsWith("empreendimento")) && !cs.some((c) => c.n.startsWith("local de prestacao")));
  if (sindicancia) {
    lida.tipo = "SINDICANCIA";
    lida.predio = campo("empreendimento") || undefined;
    if (!lida.predio) return falha('Não achei o "Empreendimento".');
  } else {
    lida.administradora = campo("contratada") || undefined;
    lida.predio = campo("local de prestacao") || undefined;
    if (!lida.predio) return falha('Não achei o "Local de Prestação".');
    if (!lida.administradora) return falha('Não achei a "Contratada".');
  }
  const codigos = MODELOS[lida.tipo].codigos;

  const doTexto = periodoDoTexto(campo("periodo avaliado"));
  const doNome = periodoDoNome(arquivo);
  const ano = doTexto.ano ?? doNome?.ano;
  const trimestre = doTexto.trimestre ?? doNome?.trimestre;
  if (!ano || !trimestre || ano < 2020 || ano > 2100) return falha("Não achei o período (nem na planilha nem no nome do arquivo).");
  lida.periodo = { ano, trimestre };
  if (doNome && formatarPeriodo(doNome) !== formatarPeriodo(lida.periodo))
    lida.avisos.push(`O nome do arquivo diz ${formatarPeriodo(doNome)}; vale o período da planilha, ${formatarPeriodo(lida.periodo)}.`);

  // Cabeçalho da tabela: a linha que tem "#", "Peso" e "Comentário" (ou "Comentários", na da Sindicância).
  const rotuloCab = (x: Celula, r: string) => (r === "peso" ? x.n === r : x.n === "comentario" || x.n === "comentarios");
  const cab = cs.find((c) => c.t === "#" && ["peso", "comentario"].every((r) => cs.some((x) => x.linha === c.linha && rotuloCab(x, r))));
  if (!cab) return falha('Não achei o cabeçalho da tabela (# | Peso | Comentário).');
  const col = (r: string) => cs.find((x) => x.linha === cab.linha && rotuloCab(x, r))!.coluna;
  const [cNota, cComentario] = [col("peso"), col("comentario")];
  const fim = cs.find((c) => c.linha > cab.linha && c.n === "avaliacao final");
  const naLinha = (linha: number, coluna: number) => cs.find((x) => x.linha === linha && x.coluna === coluna);

  const vistos = new Set<string>();
  for (const c of cs.filter((x) => x.coluna === cab.coluna && x.linha > cab.linha && (!fim || x.linha < fim.linha))) {
    const codigo = c.t.replace(/,/g, ".");
    if (!/^\d+(\.\d+)+$/.test(codigo) || (!sindicancia && codigo === "2.2")) continue;
    const v = naLinha(c.linha, cNota)?.v;
    if (!sindicancia && codigo === "3.5") {
      if (nota(v) !== null) lida.avisos.push("3.5 ignorado (não entra no Score Card).");
      continue;
    }
    if (!codigos.includes(codigo)) {
      lida.avisos.push(`Item ${codigo} não existe no Score Card: ignorado.`);
      continue;
    }
    if (vistos.has(codigo)) {
      lida.avisos.push(`Item ${codigo} repetido: vale o primeiro.`);
      continue;
    }
    vistos.add(codigo);
    const n = nota(v);
    lida.notas[codigo] = n;
    if (n === null) lida.avisos.push(`${codigo} sem nota (${texto(v) || "vazio"}).`);
    const comentario = naLinha(c.linha, cComentario)?.t ?? "";
    if (comentario) lida.comentarios[codigo] = comentario.slice(0, 2000);
  }
  const faltam = codigos.filter((c) => !vistos.has(c));
  if (faltam.length) lida.avisos.push(`Itens não encontrados: ${faltam.join(", ")}.`);

  if (fim) {
    const v = naLinha(fim.linha, cNota)?.v;
    const numero = typeof v === "number" ? v : cs.find((x) => x.linha === fim.linha && x.coluna > fim.coluna && typeof x.v === "number")?.v;
    lida.finalPlanilha = nota(numero);
  }
  const calculada = calcular(lida.notas, lida.tipo).final;
  if (lida.finalPlanilha !== null && calculada !== null && Math.abs(lida.finalPlanilha - calculada) > 0.1)
    lida.avisos.push(`A planilha diz ${formatarNota(lida.finalPlanilha)}, o sistema calcula ${formatarNota(calculada)}.`);
  return lida;
}

// ── Arquivos enviados: .xlsx soltos ou um .zip da pasta do OneDrive ───────────────────────────────────────────────

/** Abre os .zip e confere os limites. Arquivo fora da regra vira linha de erro, sem derrubar os outros. */
export async function abrirArquivos(enviados: Arquivo[]): Promise<{ planilhas: Arquivo[]; erros: Linha[] } | { erro: string }> {
  const planilhas: Arquivo[] = [];
  const erros: Linha[] = [];
  const erro = (arquivo: string, msg: string) =>
    erros.push({ arquivo, erro: msg, lidas: 0, total: 0, finalPlanilha: null, finalCalculada: null, avisos: [], acao: "erro" });
  for (const a of enviados) {
    const ext = a.nome.toLowerCase().split(".").pop();
    if (ext === "xlsx") {
      if (a.bytes.length > LIMITES.xlsx) erro(a.nome, "Maior que 5 MB.");
      else planilhas.push(a);
    } else if (ext === "zip") {
      if (a.bytes.length > LIMITES.zip) {
        erro(a.nome, "Maior que 60 MB.");
        continue;
      }
      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(a.bytes);
      } catch {
        erro(a.nome, "Não é um .zip válido.");
        continue;
      }
      for (const f of Object.values(zip.files)) {
        const base = f.name.split("/").pop() ?? "";
        if (f.dir || f.name.includes("__MACOSX/") || base.startsWith("~$") || base.startsWith("._") || !/\.xlsx$/i.test(base)) continue;
        // Confere o tamanho descompactado declarado antes de abrir (barra .zip que explode na memória).
        const declarado = (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
        if (declarado > LIMITES.xlsx) {
          erro(base, "Maior que 5 MB.");
          continue;
        }
        const bytes = await f.async("uint8array");
        if (bytes.length > LIMITES.xlsx) erro(base, "Maior que 5 MB.");
        else planilhas.push({ nome: base, bytes });
        if (planilhas.length > LIMITES.planilhas) break;
      }
    } else erro(a.nome, "Não é .xlsx nem .zip.");
    if (planilhas.length > LIMITES.planilhas) return { erro: `No máximo ${LIMITES.planilhas} planilhas por vez.` };
  }
  return { planilhas, erros };
}

// ── Simular e importar ─────────────────────────────────────────────────────────────────────────────────────────────

type Db = Pick<typeof prisma, "condominio" | "administradora" | "avaliacao">;
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Existente = { id: string; notas: { item: string; nota: unknown; comentario: string }[] };

/** Avaliação "com notas": alguma nota ou comentário. A criada vazia (só checklist, pelo JSON) recebe as notas sem "Substituir". */
export const temNotas = (a: Existente | null) => !!a && a.notas.some((n) => n.nota !== null || n.comentario !== "");

// shortcut: acha pelo nome normalizado lendo o cadastro inteiro (dezenas de linhas); com milhares, guardar o nome normalizado.
async function acharPorNome<T extends { nome: string }>(lista: Promise<T[]>, nome: string) {
  const n = normalizar(nome);
  return (await lista).find((x) => normalizar(x.nome) === n) ?? null;
}

export type Conteudo = { tipo: Tipo; periodo: Periodo; notas: Notas; comentarios: Record<string, string>; origem: string };

/**
 * Grava as notas e os comentários de uma avaliação (planilha .xlsx ou JSON). Nova: cria com as notas (entregue = passo 4
 * marcado agora). Existente sem notas: preenche. Existente com notas: pula, ou troca com "substituir" (o checklist fica
 * como estava). Tudo com LogAlteracao.
 */
export async function gravarNotas(
  tx: Tx,
  email: string,
  condominioId: string,
  c: Conteudo,
  existente: Existente | null,
  { substituir, entregue }: { substituir: boolean; entregue: boolean },
): Promise<NonNullable<Linha["resultado"]>> {
  const codigos = MODELOS[c.tipo].codigos;
  const log = (entidadeId: string, campo: string, antes: string | null, depois: string | null) =>
    tx.logAlteracao.create({ data: { email, entidade: "Avaliacao", entidadeId, campo, antes, depois } });

  if (existente && temNotas(existente) && !substituir) return "pulada";
  if (existente) {
    let mudou = false;
    for (const item of codigos) {
      const atual = existente.notas.find((n) => n.item === item);
      const antes = { nota: atual?.nota == null ? null : Number(atual.nota), comentario: atual?.comentario ?? "" };
      const depois = { nota: c.notas[item] ?? null, comentario: c.comentarios[item] ?? "" };
      if (antes.nota === depois.nota && antes.comentario === depois.comentario) continue;
      mudou = true;
      await tx.notaItem.upsert({
        where: { avaliacaoId_item: { avaliacaoId: existente.id, item } },
        create: { avaliacaoId: existente.id, item, ...depois },
        update: depois,
      });
      if (antes.nota !== depois.nota) await log(existente.id, `${item} nota`, antes.nota?.toString() ?? null, depois.nota?.toString() ?? null);
      if (antes.comentario !== depois.comentario) await log(existente.id, `${item} comentário`, antes.comentario, depois.comentario);
    }
    if (!mudou) return "sem mudança";
    await tx.avaliacao.update({ where: { id: existente.id }, data: { atualizadoEm: new Date() } });
    const preenchida = !temNotas(existente);
    await log(existente.id, preenchida ? "notas importadas" : "substituída pela importação", null, c.origem);
    return preenchida ? "importada" : "substituída";
  }

  const a = await tx.avaliacao.create({
    data: {
      condominioId,
      ...c.periodo,
      tipo: c.tipo,
      entregaAte: prazoPadrao(c.periodo),
      ...(entregue ? { status: "ENTREGUE" as const, entregueEm: new Date(), passo4Por: email } : {}),
      notas: {
        create: codigos.filter((k) => k in c.notas || k in c.comentarios).map((item) => ({
          item,
          nota: c.notas[item] ?? null,
          comentario: c.comentarios[item] ?? "",
        })),
      },
    },
  });
  await log(a.id, "importada", null, c.origem);
  return "importada";
}

const buscarExistente = (db: Db, condominioId: string, p: Periodo, tipo: Tipo) =>
  db.avaliacao.findUnique({ where: { condominioId_ano_trimestre_tipo: { condominioId, ...p, tipo } }, include: { notas: true } });

async function situacao(db: Db, l: Lida) {
  const condominio = await acharPorNome(db.condominio.findMany({ include: { administradora: true } }), l.predio!);
  const administradora =
    condominio ? condominio.administradora : l.administradora ? await acharPorNome(db.administradora.findMany(), l.administradora) : null;
  const existente = condominio ? await buscarExistente(db, condominio.id, l.periodo!, l.tipo) : null;
  return { condominio, administradora, existente };
}

async function gravar(tx: Tx, email: string, l: Lida, substituir: boolean): Promise<Linha["resultado"]> {
  const { condominio, administradora, existente } = await situacao(tx, l);
  const log = (entidade: string, entidadeId: string, campo: string, depois: string) =>
    tx.logAlteracao.create({ data: { email, entidade, entidadeId, campo, antes: null, depois } });

  let condominioId = condominio?.id;
  if (!condominioId) {
    // A Sindicância não traz administradora: o prédio precisa existir (a simulação já marcou como erro).
    if (l.tipo === "SINDICANCIA") throw new Error("Prédio da Sindicância não cadastrado.");
    let administradoraId = administradora?.id;
    if (!administradoraId) {
      administradoraId = (await tx.administradora.create({ data: { nome: l.administradora! } })).id;
      await log("Administradora", administradoraId, "criada pela importação", `${l.administradora} · ${l.arquivo}`);
    }
    condominioId = (await tx.condominio.create({ data: { nome: l.predio!, administradoraId } })).id;
    await log("Condominio", condominioId, "criado pela importação", `${l.predio} · ${l.arquivo}`);
  }
  const origem = `${formatarPeriodo(l.periodo!)}${l.tipo === "SINDICANCIA" ? " Sindicância" : ""} · ${l.arquivo}`;
  return gravarNotas(tx, email, condominioId, { ...l, periodo: l.periodo!, origem }, existente, { substituir, entregue: true });
}

/**
 * Lê os arquivos e diz o que vai acontecer com cada um (gravar = false) ou grava (gravar = true), um arquivo por
 * transação: um arquivo com erro não impede os outros. Sem "substituir", avaliação que já tem notas é pulada. As da
 * Administradora vão antes, para que o prédio criado por uma delas sirva à Sindicância do mesmo envio.
 */
export async function importarPlanilhas(email: string, enviados: Arquivo[], { substituir, gravar: deVerdade }: { substituir: boolean; gravar: boolean }) {
  const abertos = await abrirArquivos(enviados);
  if ("erro" in abertos) return abertos;
  const linhas: Linha[] = [...abertos.erros];
  // Na simulação, o que um arquivo anterior do mesmo envio vai criar conta como existente para os seguintes.
  const planejados = { predios: new Map<string, string>(), adms: new Set<string>(), avaliacoes: new Set<string>() };

  const lidas: Lida[] = [];
  for (const a of abertos.planilhas) lidas.push(await lerPlanilha(a.nome, a.bytes));
  lidas.sort((x, y) => (x.tipo === y.tipo ? 0 : x.tipo === "ADMINISTRADORA" ? -1 : 1));

  for (const l of lidas) {
    const base: Linha = {
      arquivo: l.arquivo,
      tipo: l.tipo,
      predio: l.predio,
      administradora: l.administradora,
      periodo: l.periodo && formatarPeriodo(l.periodo),
      lidas: Object.values(l.notas).filter((n) => typeof n === "number").length,
      total: MODELOS[l.tipo].codigos.length,
      finalPlanilha: l.finalPlanilha,
      finalCalculada: calcular(l.notas, l.tipo).final,
      avisos: l.avisos,
      acao: "erro",
    };
    if (l.erro) {
      linhas.push({ ...base, erro: l.erro });
      continue;
    }
    const s = await situacao(prisma, l);
    const chavePredio = normalizar(l.predio!);
    if (l.tipo === "SINDICANCIA" && !s.condominio && !planejados.predios.has(chavePredio)) {
      linhas.push({ ...base, erro: "Prédio não cadastrado: importe antes a planilha da Administradora ou cadastre o prédio." });
      continue;
    }
    const chave = `${l.tipo} ${chavePredio} ${base.periodo}`;
    const existe = temNotas(s.existente) || planejados.avaliacoes.has(chave);
    const admDoCadastro = s.condominio?.administradora.nome ?? planejados.predios.get(chavePredio);
    const linha: Linha = {
      ...base,
      predioNovo: !s.condominio && !planejados.predios.has(chavePredio),
      administradoraNova: !!l.administradora && !admDoCadastro && !s.administradora && !planejados.adms.has(normalizar(l.administradora)),
      acao: existe ? (substituir ? "substituir" : "pular") : "nova",
    };
    if (l.administradora && admDoCadastro && normalizar(admDoCadastro) !== normalizar(l.administradora))
      linha.avisos = [...linha.avisos, `No cadastro, a administradora do prédio é ${admDoCadastro}.`];
    if (existe && !substituir) linha.avisos = [...linha.avisos, "Já existe: pulada (marque “Substituir” para trocar)."];
    planejados.predios.set(chavePredio, admDoCadastro ?? l.administradora ?? "");
    if (l.administradora) planejados.adms.add(normalizar(l.administradora));
    planejados.avaliacoes.add(chave);

    if (deVerdade) {
      try {
        linha.resultado = await prisma.$transaction((tx) => gravar(tx, email, l, substituir), { timeout: 20_000 });
      } catch (e) {
        console.error("[importar] falha ao gravar:", l.arquivo, e instanceof Error ? e.message : e);
        linhas.push({ ...linha, acao: "erro", erro: "Falha ao gravar esta planilha; as outras seguiram." });
        continue;
      }
    }
    linhas.push(linha);
  }
  return { linhas };
}
