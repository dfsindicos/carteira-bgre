import { z } from "zod";

// Score Card da Brookfield (planilha 2T26): grupos, pesos, itens e escala. Puro: serve ao servidor, às telas e à planilha.

export type Fonte = "al" | "ev" | "df";
export const FONTES: Record<Fonte, string> = { al: "Action Log", ev: "Evidência", df: "DF" };

export type Item = { codigo: string; descricao: string; fonte: Fonte };
export type Grupo = { nome: string; peso: number; itens: Item[] };

const item = (codigo: string, descricao: string, fonte: Fonte): Item => ({ codigo, descricao, fonte });

export const GRUPOS: Grupo[] = [
  {
    nome: "1. Atendimento das ordens de serviço pelos prestadores",
    peso: 0.15,
    itens: [item("1.1", "Cumprimento dos prazos pré-estabelecidos para realização dos serviços", "ev")],
  },
  {
    nome: "2. Resultados operacionais da gerenciadora",
    peso: 0.35,
    itens: [
      item("2.1", "Preenchimento e inserção de documentos nas plataformas (procedimento Brookfield)", "df"),
      item("2.2.1", "Visitas de zeladoria", "al"),
      item("2.2.2", "Acompanhamento e manutenção da documentação legal", "df"),
      item("2.2.3", "Executar e controlar os itens de CAPEX", "al"),
      item("2.3", "Fornecimento dos relatórios gerenciais financeiros (pasta fechada)", "ev"),
      item("2.4", "Reunião mensal com o síndico, formalizada em ata", "al"),
      item("2.5", "Indicadores de Segurança do Trabalho dos prestadores", "ev"),
      item("2.6", "Fornecimento e apresentação do RGM", "ev"),
    ],
  },
  {
    nome: "3. Gestão de processos",
    peso: 0.25,
    itens: [
      item("3.1", "Controle de inadimplência", "al"),
      item("3.2", "Plano de contas com justificativa das variações acima de 5%", "ev"),
      item("3.3", "Compras dentro da normativa Brookfield", "df"),
      item("3.4", "Contratações dentro da normativa Brookfield", "df"),
    ],
  },
  {
    nome: "4. Satisfação do usuário",
    peso: 0.25,
    itens: [
      item("4.1", "Satisfação do usuário com os serviços prestados", "ev"),
      item("4.2", "Resultado da pesquisa de satisfação", "ev"),
      item("4.3", "Qualidade dos serviços", "ev"),
    ],
  },
];

export const ITENS: Item[] = GRUPOS.flatMap((g) => g.itens);
export const CODIGOS = ITENS.map((i) => i.codigo);

export type Classificacao = "Excelente" | "Bom" | "Satisfatório" | "Regular" | "Ruim";
export const ESCALA = "Excelente > 98% · Bom 95–98% · Satisfatório 90–95% · Regular 80–90% · Ruim < 80%";

export function classificar(v: number): Classificacao {
  return v > 98 ? "Excelente" : v >= 95 ? "Bom" : v >= 90 ? "Satisfatório" : v >= 80 ? "Regular" : "Ruim";
}

/** Cor do ponto da classificação nas telas: verde, âmbar ou vermelho, como no protótipo. */
export function corDaClassificacao(c: Classificacao): "ok" | "atencao" | "erro" {
  return c === "Excelente" || c === "Bom" ? "ok" : c === "Ruim" ? "erro" : "atencao";
}

// Tira o ruído da conta em ponto flutuante (98 × 0,15 + … = 98,00000000000001), que mudaria a classificação no limite.
const limpar = (v: number) => Math.round(v * 1e6) / 1e6;

export type Notas = Record<string, number | null | undefined>;

export type Resultado = {
  grupos: { media: number | null; classificacao: Classificacao | null }[];
  /** Só com os 16 itens com nota; até lá, null e `faltam` diz quantas notas faltam. */
  final: number | null;
  classificacao: Classificacao | null;
  faltam: number;
};

/** Média do grupo = média simples dos itens com nota; final = Σ média do grupo × peso. */
export function calcular(notas: Notas): Resultado {
  const tem = (c: string) => typeof notas[c] === "number";
  const grupos = GRUPOS.map((g) => {
    const valores = g.itens.filter((i) => tem(i.codigo)).map((i) => notas[i.codigo] as number);
    const media = valores.length ? limpar(valores.reduce((s, v) => s + v, 0) / valores.length) : null;
    return { media, classificacao: media === null ? null : classificar(media) };
  });
  const faltam = CODIGOS.filter((c) => !tem(c)).length;
  const final = faltam ? null : limpar(GRUPOS.reduce((s, g, i) => s + (grupos[i]!.media as number) * g.peso, 0));
  return { grupos, final, classificacao: final === null ? null : classificar(final), faltam };
}

/** Nota digitada: vazio apaga; aceita vírgula ou ponto; de 0 a 100, com até 2 casas (Decimal(5,2) no banco). */
export const esquemaNota = z
  .string()
  .trim()
  .transform((s, ctx) => {
    if (s === "") return null;
    if (!/^-?\d+([.,]\d+)?$/.test(s)) {
      ctx.addIssue({ code: "custom", message: "Digite um número, como 94,3." });
      return z.NEVER;
    }
    const n = Number(s.replace(",", "."));
    if (n < 0 || n > 100) {
      ctx.addIssue({ code: "custom", message: "A nota vai de 0 a 100." });
      return z.NEVER;
    }
    return Math.round(n * 100) / 100;
  });

export const formatarNota = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

// Período no formato da BGRE: "3T26" = 3º trimestre de 2026.
export type Periodo = { ano: number; trimestre: number };

export const formatarPeriodo = ({ ano, trimestre }: Periodo) => `${trimestre}T${String(ano % 100).padStart(2, "0")}`;

export function lerPeriodo(texto: string | undefined | null): Periodo | null {
  const m = /^([1-4])T(\d{2})$/i.exec(texto ?? "");
  return m ? { ano: 2000 + Number(m[2]), trimestre: Number(m[1]) } : null;
}

export const periodoAnterior = ({ ano, trimestre }: Periodo): Periodo =>
  trimestre === 1 ? { ano: ano - 1, trimestre: 4 } : { ano, trimestre: trimestre - 1 };

export const periodoSeguinte = ({ ano, trimestre }: Periodo): Periodo =>
  trimestre === 4 ? { ano: ano + 1, trimestre: 1 } : { ano, trimestre: trimestre + 1 };

/** O trimestre em avaliação é o que acabou: em outubro de 2026 a DF avalia o 3T26. */
export function periodoEmAvaliacao(hoje = new Date()): Periodo {
  return periodoAnterior({ ano: hoje.getFullYear(), trimestre: Math.floor(hoje.getMonth() / 3) + 1 });
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "jul a set/26" */
export const mesesDoPeriodo = ({ ano, trimestre }: Periodo) =>
  `${MESES[(trimestre - 1) * 3]} a ${MESES[trimestre * 3 - 1]}/${String(ano % 100).padStart(2, "0")}`;

/** Prazo padrão de entrega à BGRE: último dia do mês seguinte ao trimestre (3T26 → 31/10/2026). Editável na tela. */
export const prazoPadrao = ({ ano, trimestre }: Periodo) => new Date(Date.UTC(ano, trimestre * 3 + 1, 0));
