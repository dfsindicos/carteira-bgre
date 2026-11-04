import { z } from "zod";
import { prisma } from "./db";
import { registrar, type Resposta, type Tx } from "./avaliacoes";
import { normalizarNome } from "./importacao-json";
import {
  CRITICIDADES,
  ROTULO_CRITICIDADE,
  SLA_PADRAO,
  UNIDADES,
  descreverRegra,
  diaHora,
  estaAberta,
  lerDataHoraSP,
  prazoConclusao,
  prazoResposta,
  situacaoPrazo,
  situacaoResposta,
  vencida,
  type ConfigSla,
  type DemandaPrazo,
} from "./prazos-demandas";

// Demandas que a BGRE manda à DF (decisões do usuário de 2026-11-03). A Triagem Contratante lê três caixas da equipe da
// DF e grava por /api/integracao/demandas (integrarMensagens); a DF trabalha em /demandas. As regras
// recebem o e-mail de quem mexe (as server actions só leem a sessão) e toda alteração grava LogAlteracao.

export const SITUACOES = ["ABERTA", "EM_ANDAMENTO", "AGUARDANDO", "CONCLUIDA", "ARQUIVADA"] as const;
export type Situacao = (typeof SITUACOES)[number];
export const ROTULO_SITUACAO: Record<Situacao, string> = {
  ABERTA: "Aberta",
  EM_ANDAMENTO: "Em andamento",
  AGUARDANDO: "Aguardando",
  CONCLUIDA: "Concluída",
  ARQUIVADA: "Arquivada",
};
export const AGUARDANDO = ["DF", "BGRE", "ADMINISTRADORA", "LOCATARIO", "CORRETORA", "FORNECEDOR"] as const;
export type Aguardando = (typeof AGUARDANDO)[number];
export const ROTULO_AGUARDANDO: Record<Aguardando, string> = { DF: "DF", BGRE: "BGRE", ADMINISTRADORA: "Administradora", LOCATARIO: "Locatário", CORRETORA: "Corretora", FORNECEDOR: "Fornecedor" };

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
  responsavel: z.string().trim().max(300).nullish(),
  origemPlanner: z.string().max(5000).nullish(),
});
export const esquemaLote = z.object({ mensagens: z.array(esquemaMensagem).min(1, "Mande ao menos uma mensagem.").max(100, "No máximo 100 mensagens por envio.") });
export type MensagemIntegracao = z.input<typeof esquemaMensagem>;

export type ResultadoIntegracao = {
  criadas: number;
  atualizadas: number;
  duplicadas: number;
  ignoradas: number;
  primeirasRespostas: number;
  mensagens: { internetMessageId: string; acao: "criada" | "atualizacao" | "duplicada" | "ignorada"; numero?: number }[];
};

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
          const condominioId = m.condominio ? (porNome.get(normalizarNome(m.condominio)) ?? null) : null;
          const nova = await tx.demanda.create({
            data: {
              titulo: (limparAssunto(m.assunto) || m.resumo.slice(0, 120) || "(sem assunto)").slice(0, 300),
              remetenteNome: m.remetenteNome,
              remetenteEmail: m.remetenteEmail,
              condominioId,
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
          await registrar(tx, ROTINA, "Demanda", nova.id, "criada", null, `nº ${nova.numero} · ${nova.titulo}${m.condominio && !condominioId ? ` · condomínio "${m.condominio}" não achado no cadastro` : ""}`);
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
        r.atualizadas++;
        r.mensagens.push({ internetMessageId: m.internetMessageId, acao: "atualizacao", numero: d.numero });
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
    prisma.demanda.findMany({ where: { situacao: { in: ["ABERTA", "EM_ANDAMENTO", "AGUARDANDO"] } }, include: { condominio: { select: { nome: true } } }, orderBy: { numero: "asc" } }),
  ]);
  const app = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return lista.map((d) => {
    const p = prazoConclusao(d, cfg);
    const r = prazoResposta(d, cfg);
    return {
      numero: d.numero,
      titulo: d.titulo,
      condominio: d.condominio?.nome ?? null,
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

export const VISOES = { abertas: "Em aberto", aguardando: "Aguardando terceiros", concluidas: "Concluídas", arquivadas: "Arquivadas", todas: "Todas" } as const;
export type Visao = keyof typeof VISOES;
export const INDICADORES = {
  abertas: "Em aberto",
  sem: "Sem 1ª resposta",
  vencidas: "Prazo vencido",
  semana: "Vencem em 7 dias",
  noprazo: "Concluídas no prazo (30 dias)",
} as const;
export type Indicador = keyof typeof INDICADORES;
export type Filtros = { vis?: string; cond?: string; resp?: string; kpi?: string };

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
  vis === "todas" ? true : vis === "abertas" ? estaAberta({ situacao: s }) : vis === "aguardando" ? s === "AGUARDANDO" : vis === "concluidas" ? s === "CONCLUIDA" : s === "ARQUIVADA";

/** Página /demandas: indicadores (sobre todas), opções dos filtros e as linhas filtradas, já com as etiquetas de prazo. */
export async function listarDemandas(f: Filtros, agora = new Date()) {
  const kpi = f.kpi && f.kpi in INDICADORES ? (f.kpi as Indicador) : null;
  // "Concluídas no prazo" só existe entre as concluídas; os outros indicadores, entre as abertas.
  const vis: Visao = f.vis && f.vis in VISOES ? (f.vis as Visao) : kpi === "noprazo" ? "concluidas" : "abertas";
  const [cfg, todas] = await Promise.all([
    carregarSla(),
    prisma.demanda.findMany({ include: { condominio: { select: { id: true, nome: true } } }, orderBy: { chegadaEm: "desc" } }),
  ]);
  const indicadores = Object.fromEntries((Object.keys(INDICADORES) as Indicador[]).map((k) => [k, todas.filter((d) => predicado(k, d, cfg, agora)).length])) as Record<Indicador, number>;
  const concluidas30 = todas.filter((d) => d.situacao === "CONCLUIDA" && d.concluidaEm && d.concluidaEm.getTime() >= agora.getTime() - 30 * DIA).length;
  const condominios = [...new Map(todas.filter((d) => d.condominio).map((d) => [d.condominio!.id, d.condominio!.nome])).entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  const responsaveis = [...new Set(todas.map((d) => d.responsavel).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const linhas = todas
    .filter((d) => naVisao(vis, d.situacao))
    .filter((d) => !f.cond || (f.cond === "sem" ? !d.condominioId : d.condominioId === f.cond))
    .filter((d) => !f.resp || (f.resp === "sem" ? !d.responsavel : d.responsavel === f.resp))
    .filter((d) => !kpi || predicado(kpi, d, cfg, agora))
    .map((d) => ({ ...d, resposta: situacaoResposta(d, cfg, agora), prazo: situacaoPrazo(d, cfg, agora), prazoEm: prazoConclusao(d, cfg) }))
    // Vencendo (vermelho) primeiro; depois as mais novas.
    .sort((a, b) => Number(b.prazo.tom === "erro") - Number(a.prazo.tom === "erro") || b.chegadaEm.getTime() - a.chegadaEm.getTime());
  return { vis, kpi, indicadores, concluidas30, condominios, responsaveis, linhas, cfg };
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
  if (n.condominioId && !(await prisma.condominio.findUnique({ where: { id: n.condominioId } }))) return falha("Condomínio não encontrado.");
  return prisma.$transaction(async (tx) => {
    const d = await tx.demanda.create({
      data: {
        titulo: n.titulo,
        remetenteNome: n.remetenteNome,
        remetenteEmail: n.remetenteEmail.toLowerCase(),
        condominioId: n.condominioId || null,
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

export const CAMPOS_EDITAVEIS = ["titulo", "responsavel", "situacao", "aguardando", "criticidade", "condominioId", "prazoEmail", "prazoCombinado"] as const;
export type CampoDemanda = (typeof CAMPOS_EDITAVEIS)[number];
const ROTULO_CAMPO: Record<CampoDemanda, string> = {
  titulo: "título",
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
  responsavel: z.string().trim().max(300),
  // Arquivar tem motivo: só por arquivarDemanda.
  situacao: z.enum(["ABERTA", "EM_ANDAMENTO", "AGUARDANDO", "CONCLUIDA"], "Para arquivar, use “Arquivar” com o motivo."),
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
    const antes = d[c];
    if (paraLog(c, antes) === paraLog(c, novo)) return { ok: true as const };
    const data: Record<string, unknown> = { [c]: novo };
    let [logAntes, logDepois] = [paraLog(c, antes), paraLog(c, novo)];
    if (c === "condominioId") {
      const cond = novo ? await tx.condominio.findUnique({ where: { id: novo as string }, select: { nome: true } }) : null;
      if (novo && !cond) return falha("Condomínio não encontrado.");
      [logAntes, logDepois] = [d.condominio?.nome ?? null, cond?.nome ?? null];
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

