import { z } from "zod";
import { prisma } from "./db";
import { registrar, type Resposta, type Tx } from "./avaliacoes";
import { filtrar, lerFiltros, ordenar } from "./filtros-demandas";
import { normalizarNome } from "./importacao-json";
import {
  CRITICIDADES,
  ROTULO_CRITICIDADE,
  SLA_PADRAO,
  UNIDADES,
  descreverRegra,
  diaHora,
  SITUACOES_ABERTAS,
  estaAberta,
  lerDataHoraSP,
  prazoConclusao,
  prazoResposta,
  situacaoPrazo,
  situacaoResposta,
  vencida,
  type ConfigSla,
  type Criticidade,
  type DemandaPrazo,
} from "./prazos-demandas";

// Demandas que a BGRE manda à DF (decisões do usuário de 2026-11-03). A Triagem Contratante lê três caixas da equipe da
// DF e grava por /api/integracao/demandas (integrarMensagens); a DF trabalha em /demandas. As regras
// recebem o e-mail de quem mexe (as server actions só leem a sessão) e toda alteração grava LogAlteracao.

export const SITUACOES = ["ABERTA", "EM_ANDAMENTO", "AGUARDANDO", "REUNIAO", "CONCLUIDA", "ARQUIVADA"] as const;
export type Situacao = (typeof SITUACOES)[number];
export const ROTULO_SITUACAO: Record<Situacao, string> = {
  ABERTA: "Aberta",
  EM_ANDAMENTO: "Em andamento",
  AGUARDANDO: "Aguardando",
  REUNIAO: "Reunião",
  CONCLUIDA: "Concluída",
  ARQUIVADA: "Arquivada",
};
export const AGUARDANDO = ["DF", "BGRE", "ADMINISTRADORA", "LOCATARIO", "CORRETORA", "FORNECEDOR"] as const;
export type Aguardando = (typeof AGUARDANDO)[number];
export const ROTULO_AGUARDANDO: Record<Aguardando, string> = { DF: "DF", BGRE: "BGRE", ADMINISTRADORA: "Administradora", LOCATARIO: "Locatário", CORRETORA: "Corretora", FORNECEDOR: "Fornecedor" };

/** Valor do select e do filtro para "Toda a carteira" (Demanda.todaCarteira; pedido do usuário de 2026-11-04). */
export const TODA_CARTEIRA = "toda-carteira";
export const ROTULO_TODA_CARTEIRA = "Toda a carteira";
/** Nome do condomínio da demanda para as telas, o Excel e a integração. */
export const nomeCondominio = (d: { todaCarteira: boolean; condominio: { nome: string } | null }) => (d.todaCarteira ? ROTULO_TODA_CARTEIRA : (d.condominio?.nome ?? null));
// Como a Triagem pode escrever "toda a carteira" no campo condominio (normalizado por normalizarNome).
const NOMES_TODA_CARTEIRA = new Set(["toda a carteira", "toda carteira", "todos", "todos os condominios", "portfolio", "todo o portfolio"]);
export const ehTodaCarteira = (nome: string) => NOMES_TODA_CARTEIRA.has(normalizarNome(nome));

/** Quem grava pela integração, no LogAlteracao. */
export const ROTINA = "rotina Triagem Contratante";
/** Mensagem enviada por alguém destes domínios na conversa é da DF (marca a 1ª resposta). */
const DOMINIOS_DF = ["dfsindicos.com.br"];
export const ehDaDf = (email: string) => DOMINIOS_DF.includes(email.trim().toLowerCase().split("@").pop() ?? "");

// "RE: ENC: Pedido" → "Pedido".
export const limparAssunto = (s: string) => s.replace(/^\s*(?:(?:re|res|fw|fwd|enc|tr|rv)\s*:\s*)+/i, "").trim();
// "Ordinária" ou "ordinaria" → "ORDINARIA".
const semAcento = (v: unknown) => (typeof v === "string" ? v.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase().replace(/\s+/g, "_") : v);
const esquemaCriticidade = z.preprocess(semAcento, z.enum(CRITICIDADES));
const linkHttps = z.string().trim().max(4000).refine((s) => /^https:\/\/\S+$/i.test(s), "link precisa começar com https://");

// ── Configuração do SLA ─────────────────────────────────────────────────────────────────────────────────────────────

/** SLA em vigor: as linhas gravadas em /demandas/sla, e o padrão (Einstein) no que não foi gravado. */
export async function carregarSla(db: Pick<Tx, "slaDemanda" | "opcoesSlaDemanda"> = prisma): Promise<ConfigSla> {
  const [linhas, opcoes] = await Promise.all([db.slaDemanda.findMany(), db.opcoesSlaDemanda.findUnique({ where: { id: "atual" } })]);
  const regras = structuredClone(SLA_PADRAO.regras);
  for (const l of linhas)
    regras[l.criticidade] = { resposta: { valor: l.respostaValor, unidade: l.respostaUnidade }, conclusao: { valor: l.conclusaoValor, unidade: l.conclusaoUnidade } };
  return {
    regras,
    contarFeriados: opcoes?.contarFeriados ?? SLA_PADRAO.contarFeriados,
    prazoEmailPrevalece: opcoes?.prazoEmailPrevalece ?? SLA_PADRAO.prazoEmailPrevalece,
  };
}

const esquemaRegra = z.object({ valor: z.coerce.number().int("Use números inteiros.").min(1, "O prazo mínimo é 1.").max(999), unidade: z.enum(UNIDADES) });
const esquemaRegraSla = z.object({ resposta: esquemaRegra, conclusao: esquemaRegra });
export const esquemaSla = z
  .object({
    regras: z.object({ CRITICA: esquemaRegraSla, URGENTE: esquemaRegraSla, ORDINARIA: esquemaRegraSla, COMPLEXA: esquemaRegraSla }),
    contarFeriados: z.boolean(),
    prazoEmailPrevalece: z.boolean(),
  })
  .superRefine((v, ctx) => {
    for (const c of CRITICIDADES)
      if (v.regras[c].resposta.unidade === "COMBINADO")
        ctx.addIssue({ code: "custom", message: `${ROTULO_CRITICIDADE[c]}: a 1ª resposta não pode ser "prazo combinado".`, path: ["regras", c] });
  });

/** Grava o SLA (tabela e opções), com uma linha de LogAlteracao por valor mudado (entidade "ConfiguracaoSla"). */
export async function salvarSla(email: string, entrada: unknown, campoLog?: string): Promise<Resposta & { mudancas?: number }> {
  const e = esquemaSla.safeParse(entrada);
  if (!e.success) return { ok: false, erro: e.error.issues[0]?.message ?? "Dados inválidos." };
  const novo: ConfigSla = e.data;
  return prisma.$transaction(async (tx) => {
    const atual = await carregarSla(tx);
    let mudancas = 0;
    for (const c of CRITICIDADES) {
      const [a, n] = [atual.regras[c], novo.regras[c]];
      for (const parte of ["resposta", "conclusao"] as const) {
        if (a[parte].valor === n[parte].valor && a[parte].unidade === n[parte].unidade) continue;
        mudancas++;
        await registrar(tx, email, "ConfiguracaoSla", c, `${ROTULO_CRITICIDADE[c]}: ${parte === "resposta" ? "1ª resposta" : "conclusão"}`, descreverRegra(a[parte]), descreverRegra(n[parte]));
      }
      await tx.slaDemanda.upsert({
        where: { criticidade: c },
        create: { criticidade: c, respostaValor: n.resposta.valor, respostaUnidade: n.resposta.unidade, conclusaoValor: n.conclusao.valor, conclusaoUnidade: n.conclusao.unidade, atualizadoPor: email },
        update: { respostaValor: n.resposta.valor, respostaUnidade: n.resposta.unidade, conclusaoValor: n.conclusao.valor, conclusaoUnidade: n.conclusao.unidade, atualizadoPor: email },
      });
    }
    const sim = (b: boolean) => (b ? "sim" : "não");
    if (atual.contarFeriados !== novo.contarFeriados) {
      mudancas++;
      await registrar(tx, email, "ConfiguracaoSla", "opcoes", "feriados contam como dia não útil", sim(atual.contarFeriados), sim(novo.contarFeriados));
    }
    if (atual.prazoEmailPrevalece !== novo.prazoEmailPrevalece) {
      mudancas++;
      await registrar(tx, email, "ConfiguracaoSla", "opcoes", "prazo do e-mail prevalece", sim(atual.prazoEmailPrevalece), sim(novo.prazoEmailPrevalece));
    }
    await tx.opcoesSlaDemanda.upsert({
      where: { id: "atual" },
      create: { id: "atual", contarFeriados: novo.contarFeriados, prazoEmailPrevalece: novo.prazoEmailPrevalece, atualizadoPor: email },
      update: { contarFeriados: novo.contarFeriados, prazoEmailPrevalece: novo.prazoEmailPrevalece, atualizadoPor: email },
    });
    if (campoLog && mudancas) await registrar(tx, email, "ConfiguracaoSla", "opcoes", campoLog, null, `${mudancas} ${mudancas === 1 ? "valor" : "valores"}`);
    return { ok: true as const, mudancas };
  });
}

/** "Voltar ao padrão do Einstein". */
export const voltarSlaPadrao = (email: string) => salvarSla(email, SLA_PADRAO, "voltou ao padrão do Einstein");

export const historicoSla = () => prisma.logAlteracao.findMany({ where: { entidade: "ConfiguracaoSla" }, orderBy: { em: "desc" }, take: 200 });

// ── Integração com a Triagem Contratante ────────────────────────────────────────────────────────────────────────────

// O que a rotina sugere (decisões do usuário de 2026-11-04). Texto vazio = não mexe. A rotina nunca conclui nem arquiva.
export const SITUACOES_SUGERIDAS = ["ABERTA", "EM_ANDAMENTO", "AGUARDANDO", "REUNIAO"] as const;
type SituacaoSugerida = (typeof SITUACOES_SUGERIDAS)[number];
const esquemaSituacaoSugerida = z.preprocess(semAcento, z.enum(SITUACOES_SUGERIDAS));
const esquemaAguardando = z.preprocess(semAcento, z.enum(AGUARDANDO));
const textoSugerido = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((t) => t || undefined);
const camposSugeridos = {
  titulo: textoSugerido(120),
  pedido: textoSugerido(5000),
  oQueFazer: textoSugerido(2000),
  proximoPasso: textoSugerido(500),
  aguardando: esquemaAguardando.nullish(),
  situacaoSugerida: esquemaSituacaoSugerida.nullish(),
  todaCarteira: z.boolean().nullish(),
};

const esquemaMensagem = z.object({
  conversationId: z.string().trim().min(1).max(1000),
  internetMessageId: z.string().trim().min(1).max(1000),
  assunto: z.string().max(1000).default(""),
  remetenteNome: z.string().max(300).default(""),
  remetenteEmail: z.string().trim().toLowerCase().max(320).default(""),
  enviadoEm: z.iso.datetime({ offset: true }),
  caixa: z.string().trim().max(320).default(""),
  webLink: linkHttps.nullish(),
  resumo: z.string().max(20_000).default(""),
  demanda: z.boolean(),
  criticidadeSugerida: esquemaCriticidade.nullish(),
  prazo: z.iso.date().nullish(),
  condominio: z.string().max(300).nullish(),
  // Atalho antigo de situacaoSugerida: "REUNIAO" (só na criação).
  reuniao: z.boolean().nullish(),
  responsavel: z.string().trim().max(300).nullish(),
  origemPlanner: z.string().max(5000).nullish(),
  ...camposSugeridos,
});
export const esquemaLote = z.object({ mensagens: z.array(esquemaMensagem).min(1, "Mande ao menos uma mensagem.").max(100, "No máximo 100 mensagens por envio.") });
export type MensagemIntegracao = z.input<typeof esquemaMensagem>;

export type ResultadoIntegracao = {
  criadas: number;
  atualizadas: number;
  duplicadas: number;
  ignoradas: number;
  primeirasRespostas: number;
  mensagens: { internetMessageId: string; acao: "criada" | "atualizacao" | "duplicada" | "ignorada"; numero?: number; mudou?: string[]; preservado?: string[] }[];
};

// ── "A tela manda; a rotina só sugere" ─────────────────────────────────────────────────────────────────────────────

/** O campo (rótulo do LogAlteracao) foi mudado por uma pessoa depois da última gravação da rotina nele? */
async function editadoPorPessoa(tx: Tx, demandaId: string, rotulo: string) {
  const ultimo = (pessoa: boolean) =>
    tx.logAlteracao.findFirst({
      where: { entidade: "Demanda", entidadeId: demandaId, campo: rotulo, email: pessoa ? { not: ROTINA } : ROTINA },
      orderBy: { em: "desc" },
      select: { em: true },
    });
  const [pessoa, rotina] = await Promise.all([ultimo(true), ultimo(false)]);
  return !!pessoa && (!rotina || pessoa.em > rotina.em);
}

type Sugestao = {
  titulo?: string;
  pedido?: string;
  oQueFazer?: string;
  proximoPasso?: string;
  situacao?: SituacaoSugerida | null;
  aguardando?: Aguardando | null;
  criticidade?: Criticidade | null;
  condominio?: { condominioId: string | null; todaCarteira: boolean; nome: string | null };
};
type DemandaComCondominio = NonNullable<Awaited<ReturnType<typeof buscarDemanda>>>;
const buscarDemanda = (tx: Tx, where: { id: string } | { numero: number }) => tx.demanda.findUnique({ where, include: { condominio: { select: { nome: true } } } });

/**
 * Aplica o que a rotina sugere numa demanda que já existe: cada campo só muda se nenhuma pessoa o mudou pela tela
 * depois da última gravação da rotina; a situação só muda em demanda aberta (a rotina nunca conclui nem arquiva). Cada
 * mudança grava LogAlteracao com o e-mail da rotina, para aparecer na linha do tempo.
 */
async function aplicarSugestoes(tx: Tx, d: DemandaComCondominio, s: Sugestao) {
  const mudou: string[] = [];
  const preservado: string[] = [];
  const data: Record<string, unknown> = {};
  const tentar = async (campo: CampoDemanda, antes: string | null, depois: string | null, aplicar: () => void) => {
    if (antes === depois) return;
    const rotulo = ROTULO_CAMPO[campo];
    if (await editadoPorPessoa(tx, d.id, rotulo)) return void preservado.push(rotulo);
    aplicar();
    await registrar(tx, ROTINA, "Demanda", d.id, rotulo, antes, depois);
    mudou.push(rotulo);
  };
  for (const c of ["titulo", "pedido", "oQueFazer", "proximoPasso"] as const) {
    const v = s[c];
    if (v) await tentar(c, d[c] ?? null, v, () => (data[c] = v));
  }
  if (s.situacao && estaAberta(d)) {
    const v = s.situacao;
    await tentar("situacao", d.situacao, v, () => (data.situacao = v));
  }
  if (s.aguardando) {
    const v = s.aguardando;
    await tentar("aguardando", d.aguardando, v, () => (data.aguardando = v));
  }
  if (s.criticidade) {
    const v = s.criticidade;
    await tentar("criticidade", d.criticidade, v, () => (data.criticidade = v));
  }
  if (s.condominio) {
    const v = s.condominio;
    await tentar("condominioId", nomeCondominio(d), v.todaCarteira ? ROTULO_TODA_CARTEIRA : v.nome, () => Object.assign(data, { condominioId: v.condominioId, todaCarteira: v.todaCarteira }));
  }
  if (Object.keys(data).length) await tx.demanda.update({ where: { id: d.id }, data });
  return { mudou, preservado };
}

const dataDe = (iso: string) => new Date(`${iso}T00:00:00Z`);
const mesmoDia = (a: Date | null, b: Date | null) => (a ? a.toISOString().slice(0, 10) : null) === (b ? b.toISOString().slice(0, 10) : null);

/**
 * Grava um lote da Triagem. Uma demanda por conversa do Outlook; a mesma mensagem (internetMessageId) que chegou às três
 * caixas entra uma vez só; mensagem nova na conversa vira atualização; a primeira enviada por alguém da DF depois da
 * chegada marca a 1ª resposta. Informativo (demanda: false) e mensagem da DF sem demanda na conversa são ignorados.
 * O lote inteiro roda numa transação, sob uma trava, para duas rodadas ao mesmo tempo não criarem a mesma demanda.
 */
export async function integrarMensagens(bruto: unknown): Promise<ResultadoIntegracao | { erro: string }> {
  const v = esquemaLote.safeParse(bruto);
  if (!v.success) {
    const i = v.error.issues[0];
    return { erro: `Dados fora do formato${i?.path.length ? ` em ${i.path.join(".")}` : ""}: ${i?.message ?? "inválido"}.` };
  }
  // Na ordem do envio: a original antes das respostas, mesmo que a rotina mande fora de ordem.
  const lote = [...v.data.mensagens].sort((a, b) => Date.parse(a.enviadoEm) - Date.parse(b.enviadoEm));
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(72620311)");
      const r: ResultadoIntegracao = { criadas: 0, atualizadas: 0, duplicadas: 0, ignoradas: 0, primeirasRespostas: 0, mensagens: [] };
      const cadastro = await tx.condominio.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } });
      const porNome = new Map<string, string>();
      for (const c of cadastro) if (!porNome.has(normalizarNome(c.nome))) porNome.set(normalizarNome(c.nome), c.id);

      for (const m of lote) {
        const enviadoEm = new Date(m.enviadoEm);
        const daDf = ehDaDf(m.remetenteEmail);
        const ja = await tx.mensagemDemanda.findUnique({ where: { internetMessageId: m.internetMessageId }, select: { demanda: { select: { id: true, numero: true, conversas: true } } } });
        if (ja) {
          // A mesma mensagem vista noutra caixa: se lá a conversa tem outro ID, liga também, para as respostas de lá.
          if (!ja.demanda.conversas.includes(m.conversationId))
            await tx.demanda.update({ where: { id: ja.demanda.id }, data: { conversas: { push: m.conversationId } } });
          r.duplicadas++;
          r.mensagens.push({ internetMessageId: m.internetMessageId, acao: "duplicada", numero: ja.demanda.numero });
          continue;
        }
        const mensagem = {
          internetMessageId: m.internetMessageId,
          conversationId: m.conversationId,
          tipo: daDf ? ("ENVIADA_DF" as const) : ("RECEBIDA" as const),
          em: enviadoEm,
          autorNome: m.remetenteNome,
          autorEmail: m.remetenteEmail,
          assunto: m.assunto,
          texto: m.resumo.trim() || limparAssunto(m.assunto) || "(sem resumo)",
          caixa: m.caixa || null,
          webLink: m.webLink ?? null,
        };
        const d = await tx.demanda.findFirst({ where: { conversas: { has: m.conversationId } }, orderBy: { numero: "asc" } });
        if (!d) {
          if (!m.demanda || daDf) {
            r.ignoradas++;
            r.mensagens.push({ internetMessageId: m.internetMessageId, acao: "ignorada" });
            continue;
          }
          const todaCarteira = !!m.todaCarteira || (!!m.condominio && ehTodaCarteira(m.condominio));
          const condominioId = m.condominio && !todaCarteira ? (porNome.get(normalizarNome(m.condominio)) ?? null) : null;
          const nova = await tx.demanda.create({
            data: {
              titulo: m.titulo ?? (limparAssunto(m.assunto) || m.resumo.slice(0, 120) || "(sem assunto)").slice(0, 300),
              pedido: m.pedido ?? null,
              oQueFazer: m.oQueFazer ?? null,
              proximoPasso: m.proximoPasso ?? null,
              // "DF em cópia": a rotina manda situacaoSugerida AGUARDANDO e aguardando ADMINISTRADORA.
              aguardando: m.aguardando ?? null,
              remetenteNome: m.remetenteNome,
              remetenteEmail: m.remetenteEmail,
              condominioId,
              todaCarteira,
              situacao: m.situacaoSugerida ?? (m.reuniao ? "REUNIAO" : "ABERTA"),
              criticidade: m.criticidadeSugerida ?? "ORDINARIA",
              chegadaEm: enviadoEm,
              prazoEmail: m.prazo ? dataDe(m.prazo) : null,
              responsavel: m.responsavel ?? "",
              conversas: [m.conversationId],
              webLink: m.webLink ?? null,
              origem: m.origemPlanner ? "PLANNER" : "TRIAGEM",
              origemPlanner: m.origemPlanner ?? null,
              mensagens: { create: mensagem },
            },
          });
          await registrar(tx, ROTINA, "Demanda", nova.id, "criada", null, `nº ${nova.numero} · ${nova.titulo}${m.condominio && !condominioId && !todaCarteira ? ` · condomínio "${m.condominio}" não achado no cadastro` : ""}`);
          r.criadas++;
          r.mensagens.push({ internetMessageId: m.internetMessageId, acao: "criada", numero: nova.numero });
          continue;
        }

        await tx.mensagemDemanda.create({ data: { ...mensagem, demandaId: d.id } });
        const data: Record<string, unknown> = {};
        if (daDf && !d.primeiraRespostaEm && enviadoEm >= d.chegadaEm) {
          data.primeiraRespostaEm = enviadoEm;
          data.primeiraRespostaPor = m.remetenteEmail;
          await registrar(tx, ROTINA, "Demanda", d.id, "1ª resposta", null, `${enviadoEm.toISOString()} · ${m.remetenteEmail}`);
          r.primeirasRespostas++;
        }
        if (!daDf && enviadoEm < d.chegadaEm) {
          // A original chegou depois de uma resposta (outra rodada): o relógio começa no envio mais antigo.
          data.chegadaEm = enviadoEm;
          await registrar(tx, ROTINA, "Demanda", d.id, "chegada", d.chegadaEm, enviadoEm);
        }
        if (!daDf && m.prazo && !mesmoDia(d.prazoEmail, dataDe(m.prazo))) {
          data.prazoEmail = dataDe(m.prazo);
          await registrar(tx, ROTINA, "Demanda", d.id, "prazo do e-mail", d.prazoEmail?.toISOString().slice(0, 10), m.prazo);
        }
        if (!d.webLink && m.webLink) data.webLink = m.webLink;
        if (Object.keys(data).length) await tx.demanda.update({ where: { id: d.id }, data });
        // A análise nova da rotina: só onde nenhuma pessoa mexeu pela tela.
        const atual = (await buscarDemanda(tx, { id: d.id }))!;
        const { mudou, preservado } = await aplicarSugestoes(tx, atual, {
          pedido: m.pedido,
          oQueFazer: m.oQueFazer,
          proximoPasso: m.proximoPasso,
          situacao: m.situacaoSugerida,
          aguardando: m.aguardando,
        });
        r.atualizadas++;
        r.mensagens.push({ internetMessageId: m.internetMessageId, acao: "atualizacao", numero: d.numero, mudou, preservado });
      }
      return r;
    },
    { timeout: 60_000 },
  );
}

const esquemaReprocesso = z.object({
  demandas: z
    .array(z.object({ numero: z.number().int().positive(), condominio: z.string().max(300).nullish(), criticidadeSugerida: esquemaCriticidade.nullish(), ...camposSugeridos }))
    .min(1, "Mande ao menos uma demanda.")
    .max(100, "No máximo 100 demandas por envio."),
});
export type ReprocessoIntegracao = z.input<typeof esquemaReprocesso>["demandas"][number];
export type ResultadoReprocesso = {
  alteradas: number;
  semMudanca: number;
  recusadas: number;
  demandas: { numero: number; mudou: string[]; preservado: string[]; aviso?: string; erro?: string }[];
};

/**
 * PATCH /api/integracao/demandas: a rotina refaz a análise das demandas abertas. Título, situação, aguardando,
 * condomínio e criticidade só mudam se nenhuma pessoa os mudou pela tela; pedido, "o que a DF faz" e próximo passo
 * seguem a mesma regra (na primeira vez, ninguém os editou ainda). Concluída ou arquivada é recusada.
 */
export async function reprocessarDemandas(bruto: unknown): Promise<ResultadoReprocesso | { erro: string }> {
  const v = esquemaReprocesso.safeParse(bruto);
  if (!v.success) {
    const i = v.error.issues[0];
    return { erro: `Dados fora do formato${i?.path.length ? ` em ${i.path.join(".")}` : ""}: ${i?.message ?? "inválido"}.` };
  }
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(72620311)");
      const r: ResultadoReprocesso = { alteradas: 0, semMudanca: 0, recusadas: 0, demandas: [] };
      const cadastro = await tx.condominio.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } });
      for (const s of v.data.demandas) {
        const d = await buscarDemanda(tx, { numero: s.numero });
        if (!d || !estaAberta(d)) {
          r.recusadas++;
          r.demandas.push({ numero: s.numero, mudou: [], preservado: [], erro: d ? `Demanda ${ROTULO_SITUACAO[d.situacao].toLowerCase()}: só as abertas são reprocessadas.` : "Demanda não encontrada." });
          continue;
        }
        let condominio: Sugestao["condominio"];
        let aviso: string | undefined;
        if (s.todaCarteira || (s.condominio && ehTodaCarteira(s.condominio))) condominio = { condominioId: null, todaCarteira: true, nome: null };
        else if (s.condominio) {
          const c = cadastro.find((x) => normalizarNome(x.nome) === normalizarNome(s.condominio!));
          if (c) condominio = { condominioId: c.id, todaCarteira: false, nome: c.nome };
          else aviso = `condomínio "${s.condominio}" não achado no cadastro`;
        }
        const res = await aplicarSugestoes(tx, d, {
          titulo: s.titulo,
          pedido: s.pedido,
          oQueFazer: s.oQueFazer,
          proximoPasso: s.proximoPasso,
          situacao: s.situacaoSugerida,
          aguardando: s.aguardando,
          criticidade: s.criticidadeSugerida,
          condominio,
        });
        r[res.mudou.length ? "alteradas" : "semMudanca"]++;
        r.demandas.push({ numero: s.numero, ...res, ...(aviso ? { aviso } : {}) });
      }
      return r;
    },
    { timeout: 60_000 },
  );
}

/** As demandas abertas, para o e-mail diário [Triagem] (GET /api/integracao/demandas?abertas=1). */
export async function demandasAbertas(agora = new Date()) {
  const [cfg, lista] = await Promise.all([
    carregarSla(),
    prisma.demanda.findMany({ where: { situacao: { in: SITUACOES_ABERTAS as Situacao[] } }, include: { condominio: { select: { nome: true } } }, orderBy: { numero: "asc" } }),
  ]);
  const app = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return lista.map((d) => {
    const p = prazoConclusao(d, cfg);
    const r = prazoResposta(d, cfg);
    return {
      numero: d.numero,
      titulo: d.titulo,
      condominio: nomeCondominio(d),
      pedido: d.pedido,
      oQueFazer: d.oQueFazer,
      proximoPasso: d.proximoPasso,
      criticidade: d.criticidade,
      chegadaEm: d.chegadaEm.toISOString(),
      primeiraRespostaEm: d.primeiraRespostaEm?.toISOString() ?? null,
      primeiraRespostaAte: r?.toISOString() ?? null,
      prazo: p.em?.toISOString() ?? null,
      prazoOrigem: p.origem,
      vencida: vencida(d, cfg, agora),
      situacao: d.situacao,
      situacaoPrazo: situacaoPrazo(d, cfg, agora).texto,
      aguardando: d.aguardando,
      responsavel: d.responsavel || null,
      link: d.webLink,
      pagina: app ? `${app}/demandas/${d.id}` : `/demandas/${d.id}`,
    };
  });
}

// ── Telas ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const VISOES = { abertas: "Em aberto", aguardando: "Aguardando terceiros", reuniao: "Reunião", concluidas: "Concluídas", arquivadas: "Arquivadas", todas: "Todas" } as const;
export type Visao = keyof typeof VISOES;
export const INDICADORES = {
  abertas: "Em aberto",
  sem: "Sem 1ª resposta",
  vencidas: "Prazo vencido",
  semana: "Vencem em 7 dias",
  noprazo: "Concluídas no prazo (30 dias)",
} as const;
export type Indicador = keyof typeof INDICADORES;
/** Parâmetros da URL da lista (os de sempre e os de src/lib/filtros-demandas.ts). */
export type Filtros = { vis?: string; cond?: string; resp?: string; kpi?: string } & Record<string, string | string[] | undefined>;

const DIA = 86_400_000;
function predicado(k: Indicador, d: DemandaPrazo, cfg: ConfigSla, agora: Date) {
  const em = prazoConclusao(d, cfg).em;
  switch (k) {
    case "abertas":
      return estaAberta(d);
    case "sem":
      return estaAberta(d) && !d.primeiraRespostaEm;
    case "vencidas":
      return vencida(d, cfg, agora);
    case "semana":
      return estaAberta(d) && !!em && em >= agora && em.getTime() - agora.getTime() <= 7 * DIA;
    case "noprazo":
      return d.situacao === "CONCLUIDA" && !!d.concluidaEm && d.concluidaEm.getTime() >= agora.getTime() - 30 * DIA && !!em && d.concluidaEm <= em;
  }
}

const naVisao = (vis: Visao, s: string) =>
  vis === "todas" ? true : vis === "abertas" ? estaAberta({ situacao: s }) : vis === "aguardando" ? s === "AGUARDANDO" : vis === "reuniao" ? s === "REUNIAO" : vis === "concluidas" ? s === "CONCLUIDA" : s === "ARQUIVADA";

/** Página /demandas: indicadores (sobre todas), opções dos filtros e as linhas filtradas, já com as etiquetas de prazo. */
export async function listarDemandas(f: Filtros, agora = new Date()) {
  const kpi = f.kpi && f.kpi in INDICADORES ? (f.kpi as Indicador) : null;
  // "Concluídas no prazo" só existe entre as concluídas; os outros indicadores, entre as abertas.
  const vis: Visao = f.vis && f.vis in VISOES ? (f.vis as Visao) : kpi === "noprazo" ? "concluidas" : "abertas";
  const filtros = lerFiltros(f);
  const [cfg, todas, logs] = await Promise.all([
    carregarSla(),
    prisma.demanda.findMany({ include: { condominio: { select: { id: true, nome: true } }, mensagens: { select: { assunto: true, em: true } } }, orderBy: { numero: "desc" } }),
    prisma.logAlteracao.groupBy({ by: ["entidadeId"], where: { entidade: "Demanda" }, _max: { em: true } }),
  ]);
  const ultimoLog = new Map(logs.map((l) => [l.entidadeId, l._max.em]));
  const indicadores = Object.fromEntries((Object.keys(INDICADORES) as Indicador[]).map((k) => [k, todas.filter((d) => predicado(k, d, cfg, agora)).length])) as Record<Indicador, number>;
  const concluidas30 = todas.filter((d) => d.situacao === "CONCLUIDA" && d.concluidaEm && d.concluidaEm.getTime() >= agora.getTime() - 30 * DIA).length;
  const condominios = [...new Map(todas.filter((d) => d.condominio).map((d) => [d.condominio!.id, d.condominio!.nome])).entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  const responsaveis = [...new Set(todas.map((d) => d.responsavel).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const naVisaoAtual = todas.filter((d) => naVisao(vis, d.situacao));
  const filtradas = naVisaoAtual
    .filter((d) => !f.cond || (f.cond === "sem" ? !d.condominioId && !d.todaCarteira : f.cond === TODA_CARTEIRA ? d.todaCarteira : d.condominioId === f.cond))
    .filter((d) => !f.resp || (f.resp === "sem" ? !d.responsavel : d.responsavel === f.resp))
    .filter((d) => !kpi || predicado(kpi, d, cfg, agora))
    .map((d) => {
      const prazoEm = prazoConclusao(d, cfg);
      const movimentos = [d.chegadaEm, ultimoLog.get(d.id), ...d.mensagens.map((m) => m.em)].filter((x): x is Date => !!x);
      return {
        ...d,
        resposta: situacaoResposta(d, cfg, agora),
        prazo: situacaoPrazo(d, cfg, agora),
        prazoEm,
        prazoLimite: prazoEm.em,
        condominioNome: nomeCondominio(d),
        assuntos: [...new Set(d.mensagens.map((m) => m.assunto).filter(Boolean))],
        ultimaMovimentacao: new Date(Math.max(...movimentos.map((x) => x.getTime()))),
      };
    });
  const linhas = ordenar(filtrar(filtradas, filtros, agora), filtros.ord, filtros.dir);
  return { vis, kpi, filtros, totalVisao: naVisaoAtual.length, indicadores, concluidas30, condominios, responsaveis, linhas, cfg };
}

/** Página /demandas/[id]: a demanda, a conversa e o histórico (LogAlteracao), numa linha do tempo. */
export async function carregarDemanda(id: string, agora = new Date()) {
  const d = await prisma.demanda.findUnique({ where: { id }, include: { condominio: { select: { id: true, nome: true } }, mensagens: { orderBy: { em: "asc" } } } });
  if (!d) return null;
  const [cfg, logs, condominios, responsaveis] = await Promise.all([
    carregarSla(),
    prisma.logAlteracao.findMany({ where: { entidade: "Demanda", entidadeId: id }, orderBy: { em: "asc" } }),
    prisma.condominio.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.demanda.findMany({ where: { responsavel: { not: "" } }, select: { responsavel: true }, distinct: ["responsavel"] }),
  ]);
  type Evento = { em: Date; quem: string; texto: string; tipo: "RECEBIDA" | "ENVIADA_DF" | "NOTA" | "LOG"; link?: string | null; caixa?: string | null };
  const eventos: Evento[] = [
    ...d.mensagens.map((m) => ({ em: m.em, quem: m.autorNome || m.autorEmail || "—", texto: m.texto, tipo: m.tipo, link: m.webLink, caixa: m.caixa })),
    // O andamento já aparece como nota; a criação pela tela, como o pedido.
    ...logs.filter((l) => l.campo !== "andamento").map((l) => ({ em: l.em, quem: l.email, texto: textoLog(l), tipo: "LOG" as const })),
  ].sort((a, b) => a.em.getTime() - b.em.getTime());
  return {
    demanda: d,
    cfg,
    eventos,
    condominios,
    responsaveis: responsaveis.map((r) => r.responsavel).sort((a, b) => a.localeCompare(b, "pt-BR")),
    resposta: situacaoResposta(d, cfg, agora),
    respostaAte: prazoResposta(d, cfg),
    prazo: situacaoPrazo(d, cfg, agora),
    prazoEm: prazoConclusao(d, cfg),
  };
}

const ROTULO_VALOR: Record<string, Record<string, string>> = { situação: ROTULO_SITUACAO, aguardando: ROTULO_AGUARDANDO, criticidade: ROTULO_CRITICIDADE };
function textoLog(l: { campo: string; antes: string | null; depois: string | null }) {
  // Datas ISO gravadas no log ("2026-10-30T19:42:00.000Z · fulano") aparecem como "30/10 16h42 · fulano".
  const hora = (x: string) => x.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (iso) => diaHora(new Date(iso)));
  const v = (x: string | null) => (x === null || x === "" ? "—" : hora(ROTULO_VALOR[l.campo]?.[x] ?? x));
  if (l.campo === "criada") return `Demanda registrada${l.depois ? `: ${l.depois}` : ""}.`;
  if (l.campo === "arquivada") return `Arquivada. Motivo: ${l.depois ?? "—"}`;
  if (l.campo === "1ª resposta") return `1ª resposta marcada (${v(l.depois)}).`;
  return `${l.campo[0]!.toUpperCase()}${l.campo.slice(1)}: ${v(l.antes)} → ${v(l.depois)}.`;
}

// ── Alterações pela tela ────────────────────────────────────────────────────────────────────────────────────────────

const falha = (erro: string): Resposta => ({ ok: false, erro });
const dataOuNula = z.union([z.literal(""), z.iso.date()]).default("").transform((s) => (s ? dataDe(s) : null));

const esquemaNova = z.object({
  titulo: z.string().trim().min(3, "Escreva o que a BGRE pediu.").max(300),
  remetenteNome: z.string().trim().min(1, "Diga quem pediu.").max(300),
  remetenteEmail: z.union([z.literal(""), z.email("E-mail inválido.")]).default(""),
  canal: z.enum(["Telefone", "Reunião", "WhatsApp", "E-mail", "Outro"]),
  chegadaEm: z.string().transform((s, ctx) => {
    const d = lerDataHoraSP(s);
    if (!d) ctx.addIssue({ code: "custom", message: "Informe o dia e a hora em que o pedido chegou." });
    return d ?? new Date(0);
  }),
  criticidade: esquemaCriticidade,
  // Id do condomínio, TODA_CARTEIRA ou vazio.
  condominioId: z.string().max(100).default(""),
  prazoEmail: dataOuNula,
  responsavel: z.string().trim().max(300).default(""),
  descricao: z.string().trim().max(10_000).default(""),
  webLink: z.union([z.literal(""), linkHttps]).default(""),
});

/** "Registrar demanda" à mão (telefone, reunião…): o horário de chegada é o informado, nunca o do cadastro. */
export async function registrarDemanda(email: string, entrada: unknown, agora = new Date()): Promise<Resposta & { id?: string }> {
  const e = esquemaNova.safeParse(entrada);
  if (!e.success) return falha(e.error.issues[0]?.message ?? "Dados inválidos.");
  const n = e.data;
  if (n.chegadaEm.getTime() > agora.getTime() + 5 * 60_000) return falha("A chegada não pode ser no futuro.");
  const todaCarteira = n.condominioId === TODA_CARTEIRA;
  if (todaCarteira) n.condominioId = "";
  if (n.condominioId && !(await prisma.condominio.findUnique({ where: { id: n.condominioId } }))) return falha("Condomínio não encontrado.");
  return prisma.$transaction(async (tx) => {
    const d = await tx.demanda.create({
      data: {
        titulo: n.titulo,
        remetenteNome: n.remetenteNome,
        remetenteEmail: n.remetenteEmail.toLowerCase(),
        condominioId: n.condominioId || null,
        todaCarteira,
        criticidade: n.criticidade,
        chegadaEm: n.chegadaEm,
        prazoEmail: n.prazoEmail,
        responsavel: n.responsavel,
        webLink: n.webLink || null,
        origem: "MANUAL",
        canal: n.canal,
        mensagens: { create: { tipo: "RECEBIDA", em: n.chegadaEm, autorNome: n.remetenteNome, autorEmail: n.remetenteEmail, texto: n.descricao || `${n.titulo} (${n.canal.toLowerCase()})` } },
      },
    });
    await registrar(tx, email, "Demanda", d.id, "criada", null, `nº ${d.numero} · registrada à mão (${n.canal.toLowerCase()})`);
    return { ok: true as const, id: d.id };
  });
}

export const CAMPOS_EDITAVEIS = ["titulo", "pedido", "oQueFazer", "proximoPasso", "responsavel", "situacao", "aguardando", "criticidade", "condominioId", "prazoEmail", "prazoCombinado"] as const;
export type CampoDemanda = (typeof CAMPOS_EDITAVEIS)[number];
const ROTULO_CAMPO: Record<CampoDemanda, string> = {
  titulo: "título",
  pedido: "pedido",
  oQueFazer: "o que a DF faz",
  proximoPasso: "próximo passo",
  responsavel: "responsável",
  situacao: "situação",
  aguardando: "aguardando",
  criticidade: "criticidade",
  condominioId: "condomínio",
  prazoEmail: "prazo do e-mail",
  prazoCombinado: "prazo combinado",
};
const VALIDADORES: Record<CampoDemanda, z.ZodType<unknown>> = {
  titulo: z.string().trim().min(3, "Título curto demais.").max(300),
  pedido: z.string().trim().max(5000).transform((t) => t || null),
  oQueFazer: z.string().trim().max(2000).transform((t) => t || null),
  proximoPasso: z.string().trim().max(500).transform((t) => t || null),
  responsavel: z.string().trim().max(300),
  // Arquivar tem motivo: só por arquivarDemanda.
  situacao: z.enum(["ABERTA", "EM_ANDAMENTO", "AGUARDANDO", "REUNIAO", "CONCLUIDA"], "Para arquivar, use “Arquivar” com o motivo."),
  aguardando: z.union([z.literal("").transform(() => null), z.enum(AGUARDANDO)]),
  criticidade: esquemaCriticidade,
  condominioId: z.string().max(100).transform((s) => s || null),
  prazoEmail: dataOuNula,
  prazoCombinado: dataOuNula,
};

const paraLog = (campo: CampoDemanda, v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? null : String(v));

/** Muda um campo da demanda (troca de responsável, situação, aguardando, criticidade…), com LogAlteracao. */
export async function atualizarDemanda(email: string, id: string, campo: string, valor: string, agora = new Date()): Promise<Resposta> {
  if (!(CAMPOS_EDITAVEIS as readonly string[]).includes(campo)) return falha("Campo inválido.");
  const c = campo as CampoDemanda;
  const e = VALIDADORES[c].safeParse(valor);
  if (!e.success) return falha(e.error.issues[0]?.message ?? "Valor inválido.");
  const novo = e.data;
  return prisma.$transaction(async (tx) => {
    const d = await tx.demanda.findUnique({ where: { id }, include: { condominio: { select: { nome: true } } } });
    if (!d) return falha("Demanda não encontrada.");
    if (d.situacao === "ARQUIVADA") return falha("Demanda arquivada: reabra antes de mudar.");
    // "Toda a carteira" é o valor TODA_CARTEIRA no select: grava todaCarteira e deixa condominioId nulo.
    const antes = c === "condominioId" && d.todaCarteira ? TODA_CARTEIRA : d[c];
    if (paraLog(c, antes) === paraLog(c, novo)) return { ok: true as const };
    const data: Record<string, unknown> = { [c]: novo };
    let [logAntes, logDepois] = [paraLog(c, antes), paraLog(c, novo)];
    if (c === "condominioId") {
      const toda = novo === TODA_CARTEIRA;
      const cond = novo && !toda ? await tx.condominio.findUnique({ where: { id: novo as string }, select: { nome: true } }) : null;
      if (novo && !toda && !cond) return falha("Condomínio não encontrado.");
      data.condominioId = toda ? null : novo;
      data.todaCarteira = toda;
      [logAntes, logDepois] = [nomeCondominio(d), toda ? ROTULO_TODA_CARTEIRA : (cond?.nome ?? null)];
    }
    if (c === "situacao") {
      if (novo === "CONCLUIDA") data.concluidaEm = agora;
      else if (d.situacao === "CONCLUIDA") data.concluidaEm = null;
    }
    await tx.demanda.update({ where: { id }, data });
    await registrar(tx, email, "Demanda", id, ROTULO_CAMPO[c], logAntes, logDepois);
    return { ok: true as const };
  });
}

/** "Registrar andamento": nota na linha do tempo, com LogAlteracao. */
export async function registrarAndamento(email: string, nome: string, id: string, texto: string, agora = new Date()): Promise<Resposta> {
  const t = z.string().trim().min(1, "Escreva o andamento antes de gravar.").max(10_000).safeParse(texto);
  if (!t.success) return falha(t.error.issues[0]!.message);
  return prisma.$transaction(async (tx) => {
    const d = await tx.demanda.findUnique({ where: { id }, select: { id: true } });
    if (!d) return falha("Demanda não encontrada.");
    await tx.mensagemDemanda.create({ data: { demandaId: id, tipo: "NOTA", em: agora, autorNome: nome, autorEmail: email, texto: t.data } });
    await registrar(tx, email, "Demanda", id, "andamento", null, t.data);
    return { ok: true as const };
  });
}

/** Marca a 1ª resposta à mão (quem respondeu por telefone): agora, ou no horário informado (São Paulo). */
export async function marcarPrimeiraResposta(email: string, id: string, quando = "", agora = new Date()): Promise<Resposta> {
  const em = quando ? lerDataHoraSP(quando) : agora;
  if (!em) return falha("Horário inválido.");
  if (em.getTime() > agora.getTime() + 5 * 60_000) return falha("A 1ª resposta não pode ser no futuro.");
  return prisma.$transaction(async (tx) => {
    const d = await tx.demanda.findUnique({ where: { id } });
    if (!d) return falha("Demanda não encontrada.");
    if (d.primeiraRespostaEm) return falha("A 1ª resposta já está marcada.");
    if (em < d.chegadaEm) return falha("A 1ª resposta não pode ser antes da chegada da demanda.");
    await tx.demanda.update({ where: { id }, data: { primeiraRespostaEm: em, primeiraRespostaPor: email } });
    await registrar(tx, email, "Demanda", id, "1ª resposta", null, `${em.toISOString()} · marcada à mão`);
    return { ok: true as const };
  });
}

/** Nada se apaga: demanda que não era demanda é arquivada com o motivo. */
export async function arquivarDemanda(email: string, id: string, motivo: string, agora = new Date()): Promise<Resposta> {
  const m = z.string().trim().min(3, "Escreva o motivo do arquivamento.").max(2000).safeParse(motivo);
  if (!m.success) return falha(m.error.issues[0]!.message);
  return prisma.$transaction(async (tx) => {
    const d = await tx.demanda.findUnique({ where: { id } });
    if (!d) return falha("Demanda não encontrada.");
    if (d.situacao === "ARQUIVADA") return falha("A demanda já está arquivada.");
    await tx.demanda.update({ where: { id }, data: { situacao: "ARQUIVADA", arquivadaEm: agora, motivoArquivo: m.data } });
    await registrar(tx, email, "Demanda", id, "arquivada", d.situacao, m.data);
    return { ok: true as const };
  });
}

/** Reabre uma demanda concluída ou arquivada (volta a "Em andamento"). */
export async function reabrirDemanda(email: string, id: string): Promise<Resposta> {
  return prisma.$transaction(async (tx) => {
    const d = await tx.demanda.findUnique({ where: { id } });
    if (!d) return falha("Demanda não encontrada.");
    if (estaAberta(d)) return falha("A demanda já está aberta.");
    await tx.demanda.update({ where: { id }, data: { situacao: "EM_ANDAMENTO", concluidaEm: null, arquivadaEm: null } });
    await registrar(tx, email, "Demanda", id, "situação", d.situacao, "EM_ANDAMENTO");
    return { ok: true as const };
  });
}

