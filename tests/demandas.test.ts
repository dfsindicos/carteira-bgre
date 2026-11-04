import "./ambiente";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  arquivarDemanda,
  atualizarDemanda,
  carregarDemanda,
  carregarSla,
  integrarMensagens,
  listarDemandas,
  marcarPrimeiraResposta,
  reabrirDemanda,
  registrarAndamento,
  registrarDemanda,
  reprocessarDemandas,
  salvarSla,
  voltarSlaPadrao,
  type MensagemIntegracao,
} from "@/lib/demandas";
import { SLA_PADRAO, prazoConclusao } from "@/lib/prazos-demandas";
import { GET, PATCH, POST } from "@/app/api/integracao/demandas/route";
import { limparECriar } from "./dados";

// Tudo sintético: pessoas e e-mails de exemplo.test, prédio "Torre Teste" de tests/dados.ts.
const EMAIL = "pessoa@dfsindicos.com.br";
let condominioId = "";
beforeEach(async () => {
  condominioId = (await limparECriar()).condominio.id;
});
afterAll(() => prisma.$disconnect());

const msg = (o: Partial<MensagemIntegracao> = {}): MensagemIntegracao => ({
  conversationId: "conv-1",
  internetMessageId: "<m1@exemplo.test>",
  assunto: "RE: ENC: Envio do laudo do gerador",
  remetenteNome: "Gestão de ativos",
  remetenteEmail: "ativos@bgre.exemplo.test",
  enviadoEm: "2026-10-30T16:42:00-03:00",
  caixa: "caixa1@dfsindicos.com.br",
  webLink: "https://outlook.office365.com/owa/?ItemID=abc",
  resumo: "Pede o laudo do gerador até 05/11.",
  demanda: true,
  criticidadeSugerida: "Ordinária",
  prazo: "2026-11-05",
  condominio: "torre teste",
  ...o,
});

describe("integração com a Triagem", () => {
  it("cria uma demanda por conversa, com o relógio no envio do e-mail e o condomínio pelo nome normalizado", async () => {
    const r = await integrarMensagens({ mensagens: [msg()] });
    expect(r).toMatchObject({ criadas: 1, atualizadas: 0, duplicadas: 0, ignoradas: 0 });
    const d = await prisma.demanda.findFirstOrThrow({ include: { mensagens: true } });
    expect(d).toMatchObject({
      titulo: "Envio do laudo do gerador",
      condominioId,
      criticidade: "ORDINARIA",
      chegadaEm: new Date("2026-10-30T19:42:00Z"),
      prazoEmail: new Date("2026-11-05T00:00:00Z"),
      situacao: "ABERTA",
      origem: "TRIAGEM",
      conversas: ["conv-1"],
    });
    expect(d.mensagens).toHaveLength(1);
    expect(await prisma.logAlteracao.count({ where: { entidade: "Demanda", campo: "criada", email: "rotina Triagem Contratante" } })).toBe(1);
  });

  it("a mesma mensagem nas três caixas (ou a rotina rodando de novo) não duplica", async () => {
    await integrarMensagens({ mensagens: [msg()] });
    const r = await integrarMensagens({ mensagens: [msg({ caixa: "caixa2@dfsindicos.com.br" }), msg({ caixa: "caixa3@dfsindicos.com.br" })] });
    expect(r).toMatchObject({ criadas: 0, atualizadas: 0, duplicadas: 2 });
    expect(await prisma.demanda.count()).toBe(1);
    expect(await prisma.mensagemDemanda.count()).toBe(1);
  });

  it("a mesma mensagem com outro ID de conversa (outra caixa) liga a conversa, e a resposta de lá vira atualização", async () => {
    await integrarMensagens({ mensagens: [msg()] });
    await integrarMensagens({ mensagens: [msg({ conversationId: "conv-1-outra-caixa" })] });
    const r = await integrarMensagens({ mensagens: [msg({ conversationId: "conv-1-outra-caixa", internetMessageId: "<m2@exemplo.test>", enviadoEm: "2026-10-31T10:00:00-03:00" })] });
    expect(r).toMatchObject({ criadas: 0, atualizadas: 1 });
    expect((await prisma.demanda.findFirstOrThrow()).conversas).toEqual(["conv-1", "conv-1-outra-caixa"]);
  });

  it("nova mensagem na conversa vira atualização; a primeira da DF marca a 1ª resposta; informativo sem demanda é ignorado", async () => {
    const r = await integrarMensagens({
      mensagens: [
        // Fora de ordem de propósito: a resposta da DF vem antes da original no lote.
        msg({ internetMessageId: "<df@exemplo.test>", remetenteNome: "Analista DF", remetenteEmail: "Analista@DFSindicos.com.br", enviadoEm: "2026-10-31T09:10:00-03:00", resumo: "Cobramos a administradora.", demanda: false }),
        msg(),
        msg({ conversationId: "conv-2", internetMessageId: "<info@exemplo.test>", demanda: false, resumo: "Só para conhecimento." }),
        msg({ internetMessageId: "<m3@exemplo.test>", enviadoEm: "2026-11-01T11:00:00-03:00", demanda: false, prazo: "2026-11-06", resumo: "Novo prazo: 06/11." }),
        msg({ internetMessageId: "<df2@exemplo.test>", remetenteEmail: "outra@dfsindicos.com.br", enviadoEm: "2026-11-01T12:00:00-03:00", demanda: false }),
      ],
    });
    expect(r).toMatchObject({ criadas: 1, atualizadas: 3, ignoradas: 1, primeirasRespostas: 1 });
    const d = await prisma.demanda.findFirstOrThrow({ include: { mensagens: { orderBy: { em: "asc" } } } });
    expect(d.primeiraRespostaEm).toEqual(new Date("2026-10-31T12:10:00Z"));
    expect(d.primeiraRespostaPor).toBe("analista@dfsindicos.com.br");
    expect(d.prazoEmail).toEqual(new Date("2026-11-06T00:00:00Z"));
    expect(d.mensagens.map((m) => m.tipo)).toEqual(["RECEBIDA", "ENVIADA_DF", "RECEBIDA", "ENVIADA_DF"]);
    expect(await prisma.demanda.count()).toBe(1);
  });

  it("mensagem da DF não abre demanda; condomínio não achado fica vazio; carga do Planner marca a origem", async () => {
    const r = await integrarMensagens({
      mensagens: [
        msg({ remetenteEmail: "alguem@dfsindicos.com.br" }),
        msg({ conversationId: "conv-9", internetMessageId: "<p@exemplo.test>", condominio: "Prédio Inexistente", origemPlanner: "[BGRE] card antigo", responsavel: "Equipe DF" }),
      ],
    });
    expect(r).toMatchObject({ criadas: 1, ignoradas: 1 });
    expect(await prisma.demanda.findFirstOrThrow()).toMatchObject({ condominioId: null, origem: "PLANNER", origemPlanner: "[BGRE] card antigo", responsavel: "Equipe DF" });
  });

  it("recusa o que está fora do formato, com o campo", async () => {
    expect(await integrarMensagens({ mensagens: [msg({ enviadoEm: "30/10/2026" })] })).toMatchObject({ erro: expect.stringMatching(/mensagens\.0\.enviadoEm/) });
    expect(await integrarMensagens({ mensagens: [msg({ webLink: "javascript:alert(1)" })] })).toMatchObject({ erro: expect.stringMatching(/webLink/) });
    expect(await integrarMensagens({ mensagens: Array.from({ length: 101 }, (_, i) => msg({ internetMessageId: `<${i}@x>` })) })).toMatchObject({ erro: expect.stringMatching(/100/) });
  });
});

describe("rota /api/integracao/demandas", () => {
  const pedido = (metodo: string, token?: string, corpo?: unknown) => {
    const body = corpo === undefined ? undefined : JSON.stringify(corpo);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body) headers["content-length"] = String(Buffer.byteLength(body));
    return new Request("http://localhost/api/integracao/demandas?abertas=1", { method: metodo, headers, body });
  };

  it("sem DEMANDAS_TOKEN no servidor: 503; token errado: 401; certo: grava e lê as abertas", async () => {
    delete process.env.DEMANDAS_TOKEN;
    expect((await POST(pedido("POST", "x", { mensagens: [msg()] }))).status).toBe(503);
    expect((await GET(pedido("GET", "x"))).status).toBe(503);
    process.env.DEMANDAS_TOKEN = "token-de-teste-1234567890";
    expect((await POST(pedido("POST", "errado", { mensagens: [msg()] }))).status).toBe(401);
    expect((await GET(pedido("GET"))).status).toBe(401);
    expect(await prisma.demanda.count()).toBe(0);

    const ok = await POST(pedido("POST", "token-de-teste-1234567890", { mensagens: [msg()] }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ criadas: 1 });
    expect((await POST(pedido("POST", "token-de-teste-1234567890", { mensagens: [] }))).status).toBe(422);

    const lista = await (await GET(pedido("GET", "token-de-teste-1234567890"))).json();
    expect(lista.demandas).toHaveLength(1);
    expect(lista.demandas[0]).toMatchObject({ numero: expect.any(Number), titulo: "Envio do laudo do gerador", condominio: "Torre Teste", situacao: "ABERTA", prazoOrigem: "email" });
    delete process.env.DEMANDAS_TOKEN;
  });
});

describe("configuração do SLA", () => {
  it("começa no padrão do Einstein; salvar grava log de cada valor e recalcula; voltar ao padrão também", async () => {
    expect(await carregarSla()).toEqual(SLA_PADRAO);
    const novo = structuredClone(SLA_PADRAO);
    novo.regras.ORDINARIA.conclusao = { valor: 3, unidade: "DIAS_UTEIS" };
    novo.contarFeriados = false;
    expect(await salvarSla(EMAIL, novo)).toMatchObject({ ok: true, mudancas: 2 });
    const logs = await prisma.logAlteracao.findMany({ where: { entidade: "ConfiguracaoSla" }, orderBy: { campo: "asc" } });
    expect(logs.map((l) => [l.campo, l.antes, l.depois, l.email])).toEqual([
      ["Ordinária: conclusão", "5 dias úteis", "3 dias úteis", EMAIL],
      ["feriados contam como dia não útil", "sim", "não", EMAIL],
    ]);
    expect(await salvarSla(EMAIL, novo)).toMatchObject({ ok: true, mudancas: 0 });

    await integrarMensagens({ mensagens: [msg({ prazo: null })] });
    const d = await prisma.demanda.findFirstOrThrow();
    // 3 du a partir de sexta 30/10, com Finados contando como útil: 2, 3 e 4/11.
    expect(prazoConclusao(d, await carregarSla()).em).toEqual(new Date("2026-11-04T19:42:00Z"));

    expect(await voltarSlaPadrao(EMAIL)).toMatchObject({ ok: true, mudancas: 2 });
    expect(await carregarSla()).toEqual(SLA_PADRAO);
    expect(await prisma.logAlteracao.count({ where: { entidade: "ConfiguracaoSla", campo: "voltou ao padrão do Einstein" } })).toBe(1);
  });

  it("recusa 1ª resposta em prazo combinado e valor fora da faixa", async () => {
    const ruim = structuredClone(SLA_PADRAO);
    ruim.regras.URGENTE.resposta = { valor: 2, unidade: "COMBINADO" };
    expect(await salvarSla(EMAIL, ruim)).toMatchObject({ ok: false, erro: expect.stringMatching(/Urgente/) });
    const zero = structuredClone(SLA_PADRAO);
    zero.regras.CRITICA.resposta.valor = 0;
    expect(await salvarSla(EMAIL, zero)).toMatchObject({ ok: false });
    expect(await prisma.slaDemanda.count()).toBe(0);
  });
});

describe("demandas pela tela", () => {
  it("registra à mão com o horário informado; muda campos com log; conclui, arquiva com motivo e reabre", async () => {
    const agora = new Date("2026-11-03T18:00:00Z");
    expect(await registrarDemanda(EMAIL, { titulo: "x", remetenteNome: "BGRE", canal: "Telefone", chegadaEm: "2026-11-03T09:00", criticidade: "URGENTE" }, agora)).toMatchObject({ ok: false });
    expect(
      await registrarDemanda(EMAIL, { titulo: "Pedido por telefone", remetenteNome: "BGRE", canal: "Telefone", chegadaEm: "2026-11-04T09:00", criticidade: "URGENTE" }, agora),
    ).toMatchObject({ ok: false, erro: expect.stringMatching(/futuro/) });
    const r = await registrarDemanda(
      EMAIL,
      { titulo: "Pedido por telefone", remetenteNome: "Operações BGRE", canal: "Telefone", chegadaEm: "2026-11-03T09:00", criticidade: "URGENTE", condominioId, prazoEmail: "", responsavel: "" },
      agora,
    );
    expect(r).toMatchObject({ ok: true });
    const id = r.id!;
    expect(await prisma.demanda.findUniqueOrThrow({ where: { id } })).toMatchObject({ origem: "MANUAL", canal: "Telefone", chegadaEm: new Date("2026-11-03T12:00:00Z") });

    expect(await atualizarDemanda(EMAIL, id, "responsavel", "analista@dfsindicos.com.br")).toEqual({ ok: true });
    expect(await atualizarDemanda(EMAIL, id, "aguardando", "LOCATARIO")).toEqual({ ok: true });
    expect(await atualizarDemanda(EMAIL, id, "condominioId", "")).toEqual({ ok: true });
    expect(await atualizarDemanda(EMAIL, id, "situacao", "ARQUIVADA")).toMatchObject({ ok: false });
    expect(await atualizarDemanda(EMAIL, id, "numero", "9")).toMatchObject({ ok: false });
    expect(await marcarPrimeiraResposta(EMAIL, id, "2026-11-03T08:00", agora)).toMatchObject({ ok: false, erro: expect.stringMatching(/antes da chegada/) });
    expect(await marcarPrimeiraResposta(EMAIL, id, "2026-11-03T10:30", agora)).toEqual({ ok: true });
    expect(await marcarPrimeiraResposta(EMAIL, id, "", agora)).toMatchObject({ ok: false });
    expect(await registrarAndamento(EMAIL, "Pessoa", id, "  ")).toMatchObject({ ok: false });
    expect(await registrarAndamento(EMAIL, "Pessoa", id, "Liguei para a BGRE.", agora)).toEqual({ ok: true });

    const fim = new Date("2026-11-03T19:00:00Z");
    expect(await atualizarDemanda(EMAIL, id, "situacao", "CONCLUIDA", fim)).toEqual({ ok: true });
    expect(await prisma.demanda.findUniqueOrThrow({ where: { id } })).toMatchObject({ situacao: "CONCLUIDA", concluidaEm: fim, primeiraRespostaEm: new Date("2026-11-03T13:30:00Z") });
    expect(await reabrirDemanda(EMAIL, id)).toEqual({ ok: true });
    expect(await arquivarDemanda(EMAIL, id, "")).toMatchObject({ ok: false });
    expect(await arquivarDemanda(EMAIL, id, "Era só informativo.")).toEqual({ ok: true });
    expect(await atualizarDemanda(EMAIL, id, "responsavel", "outra pessoa")).toMatchObject({ ok: false, erro: expect.stringMatching(/arquivada/) });
    expect(await prisma.demanda.findUniqueOrThrow({ where: { id } })).toMatchObject({ situacao: "ARQUIVADA", motivoArquivo: "Era só informativo.", concluidaEm: null });

    const logs = await prisma.logAlteracao.findMany({ where: { entidade: "Demanda", entidadeId: id }, orderBy: { em: "asc" } });
    expect(logs.map((l) => l.campo)).toEqual(["criada", "responsável", "aguardando", "condomínio", "1ª resposta", "andamento", "situação", "situação", "arquivada"]);
    expect(logs.find((l) => l.campo === "condomínio")).toMatchObject({ antes: "Torre Teste", depois: null, email: EMAIL });

    const tela = (await carregarDemanda(id))!;
    expect(tela.eventos.map((e) => e.tipo)).toContain("NOTA");
    expect(tela.eventos.some((e) => e.texto.startsWith("Aguardando: — → Locatário"))).toBe(true);
  });

  it("lista com indicadores e filtros", async () => {
    await integrarMensagens({
      mensagens: [
        msg(),
        msg({ conversationId: "conv-2", internetMessageId: "<b@x>", assunto: "Outro pedido", condominio: null, prazo: null, criticidadeSugerida: "CRITICA", enviadoEm: "2026-11-03T10:00:00-03:00" }),
      ],
    });
    const agora = new Date("2026-11-06T12:00:00Z");
    const r = await listarDemandas({}, agora);
    expect(r.indicadores).toMatchObject({ abertas: 2, sem: 2, vencidas: 2, semana: 0, noprazo: 0 });
    expect((await listarDemandas({ cond: "sem" }, agora)).linhas.map((l) => l.titulo)).toEqual(["Outro pedido"]);
    expect((await listarDemandas({ cond: condominioId }, agora)).linhas).toHaveLength(1);
    expect((await listarDemandas({ vis: "concluidas" }, agora)).linhas).toHaveLength(0);
    const id = (await prisma.demanda.findFirstOrThrow({ where: { titulo: "Outro pedido" } })).id;
    await atualizarDemanda(EMAIL, id, "situacao", "CONCLUIDA", new Date("2026-11-03T13:30:00Z"));
    expect((await listarDemandas({ kpi: "noprazo" }, agora)).linhas.map((l) => l.titulo)).toEqual(["Outro pedido"]);
  });
});

describe("Reunião e Toda a carteira (pedidos do usuário de 2026-11-04)", () => {
  it("convite de reunião nasce com a situação Reunião, conta como aberta e vem no GET; não muda demanda existente", async () => {
    const r = await integrarMensagens({
      mensagens: [
        msg({ conversationId: "conv-r", internetMessageId: "<r1@x>", assunto: "Convite: alinhamento mensal", reuniao: true, prazo: null }),
        msg(),
        msg({ internetMessageId: "<m2@x>", enviadoEm: "2026-10-31T10:00:00-03:00", reuniao: true, demanda: false }),
      ],
    });
    expect(r).toMatchObject({ criadas: 2, atualizadas: 1 });
    expect((await prisma.demanda.findFirstOrThrow({ where: { conversas: { has: "conv-r" } } })).situacao).toBe("REUNIAO");
    expect((await prisma.demanda.findFirstOrThrow({ where: { conversas: { has: "conv-1" } } })).situacao).toBe("ABERTA");

    const agora = new Date("2026-11-03T12:00:00Z");
    const lista = await listarDemandas({}, agora);
    expect(lista.indicadores.abertas).toBe(2);
    expect(lista.linhas).toHaveLength(2);
    expect((await listarDemandas({ vis: "reuniao" }, agora)).linhas.map((l) => l.titulo)).toEqual(["Convite: alinhamento mensal"]);

    process.env.DEMANDAS_TOKEN = "token-de-teste-1234567890";
    const get = await GET(new Request("http://localhost/api/integracao/demandas?abertas=1", { headers: { authorization: "Bearer token-de-teste-1234567890" } }));
    const { demandas } = await get.json();
    expect(demandas.map((d: { situacao: string }) => d.situacao).sort()).toEqual(["ABERTA", "REUNIAO"]);
    delete process.env.DEMANDAS_TOKEN;

    const id = (await prisma.demanda.findFirstOrThrow({ where: { conversas: { has: "conv-1" } } })).id;
    expect(await atualizarDemanda(EMAIL, id, "situacao", "REUNIAO")).toEqual({ ok: true });
    expect((await carregarDemanda(id))!.eventos.some((e) => e.texto === "Situação: Aberta → Reunião.")).toBe(true);
  });

  it("Toda a carteira: pela integração, no detalhe (com log), no registro à mão e no filtro", async () => {
    await integrarMensagens({
      mensagens: [
        msg({ conversationId: "conv-t", internetMessageId: "<t@x>", assunto: "Pedido para todos os prédios", condominio: "Portfólio" }),
        msg({ conversationId: "conv-s", internetMessageId: "<s@x>", assunto: "Sem prédio", condominio: null }),
        msg(),
      ],
    });
    const toda = await prisma.demanda.findFirstOrThrow({ where: { conversas: { has: "conv-t" } } });
    expect(toda).toMatchObject({ todaCarteira: true, condominioId: null });

    const agora = new Date("2026-11-03T12:00:00Z");
    expect((await listarDemandas({ cond: "toda-carteira" }, agora)).linhas.map((l) => l.titulo)).toEqual(["Pedido para todos os prédios"]);
    expect((await listarDemandas({ cond: "sem" }, agora)).linhas.map((l) => l.titulo)).toEqual(["Sem prédio"]);

    // Escolher um condomínio zera "Toda a carteira"; voltar a "Toda a carteira" zera o condomínio.
    expect(await atualizarDemanda(EMAIL, toda.id, "condominioId", condominioId)).toEqual({ ok: true });
    expect(await prisma.demanda.findUniqueOrThrow({ where: { id: toda.id } })).toMatchObject({ todaCarteira: false, condominioId });
    expect(await atualizarDemanda(EMAIL, toda.id, "condominioId", "toda-carteira")).toEqual({ ok: true });
    expect(await prisma.demanda.findUniqueOrThrow({ where: { id: toda.id } })).toMatchObject({ todaCarteira: true, condominioId: null });
    expect(await atualizarDemanda(EMAIL, toda.id, "condominioId", "toda-carteira")).toEqual({ ok: true }); // sem mudança, sem log
    const logs = await prisma.logAlteracao.findMany({ where: { entidadeId: toda.id, campo: "condomínio" }, orderBy: { em: "asc" } });
    expect(logs.map((l) => [l.antes, l.depois])).toEqual([
      ["Toda a carteira", "Torre Teste"],
      ["Torre Teste", "Toda a carteira"],
    ]);

    const r = await registrarDemanda(
      EMAIL,
      { titulo: "Pedido em reunião", remetenteNome: "BGRE", canal: "Reunião", chegadaEm: "2026-11-03T09:00", criticidade: "ORDINARIA", condominioId: "toda-carteira" },
      agora,
    );
    expect(await prisma.demanda.findUniqueOrThrow({ where: { id: r.id! } })).toMatchObject({ todaCarteira: true, condominioId: null });

    process.env.DEMANDAS_TOKEN = "token-de-teste-1234567890";
    const { demandas } = await (await GET(new Request("http://localhost/api/integracao/demandas?abertas=1", { headers: { authorization: "Bearer token-de-teste-1234567890" } }))).json();
    expect(demandas.filter((d: { condominio: string | null }) => d.condominio === "Toda a carteira")).toHaveLength(2);
    delete process.env.DEMANDAS_TOKEN;
  });
});

describe("análise da Triagem: a tela manda, a rotina só sugere (decisões do usuário de 2026-11-04)", () => {
  const analise = {
    titulo: "Enviar o laudo do gerador à BGRE",
    pedido: "“Favor enviar o laudo do gerador até 05/11.”",
    oQueFazer: "Pedir o laudo à administradora e enviar à BGRE.",
    proximoPasso: "Cobrar a administradora amanhã.",
  };

  it("cria com título, análise, aguardando e toda a carteira; DF em cópia nasce aguardando a administradora", async () => {
    const r = await integrarMensagens({
      mensagens: [
        msg({ ...analise, todaCarteira: true, condominio: null }),
        msg({ conversationId: "conv-cc", internetMessageId: "<cc@x>", demanda: true, situacaoSugerida: "AGUARDANDO", aguardando: "Administradora", oQueFazer: "Acompanhar a resposta da administradora." }),
        msg({ conversationId: "conv-l", internetMessageId: "<l@x>", situacaoSugerida: "Em andamento", aguardando: "LOCATARIO" }),
      ],
    });
    expect(r).toMatchObject({ criadas: 3 });
    expect(await prisma.demanda.findFirstOrThrow({ where: { conversas: { has: "conv-1" } } })).toMatchObject({ ...analise, todaCarteira: true, condominioId: null, situacao: "ABERTA" });
    expect(await prisma.demanda.findFirstOrThrow({ where: { conversas: { has: "conv-cc" } } })).toMatchObject({ situacao: "AGUARDANDO", aguardando: "ADMINISTRADORA" });
    expect(await prisma.demanda.findFirstOrThrow({ where: { conversas: { has: "conv-l" } } })).toMatchObject({ situacao: "EM_ANDAMENTO", aguardando: "LOCATARIO" });
    expect(await integrarMensagens({ mensagens: [msg({ situacaoSugerida: "CONCLUIDA" })] })).toMatchObject({ erro: expect.stringMatching(/situacaoSugerida/) });
    expect(await integrarMensagens({ mensagens: [msg({ titulo: "x".repeat(121) })] })).toMatchObject({ erro: expect.stringMatching(/titulo/) });

    process.env.DEMANDAS_TOKEN = "token-de-teste-1234567890";
    const { demandas } = await (await GET(new Request("http://localhost/api/integracao/demandas?abertas=1", { headers: { authorization: "Bearer token-de-teste-1234567890" } }))).json();
    expect(demandas.find((d: { titulo: string }) => d.titulo === analise.titulo)).toMatchObject({ pedido: analise.pedido, oQueFazer: analise.oQueFazer, proximoPasso: analise.proximoPasso, condominio: "Toda a carteira" });
    delete process.env.DEMANDAS_TOKEN;
  });

  it("mensagem nova na conversa atualiza a análise e a situação, menos o que uma pessoa editou pela tela; nunca reabre", async () => {
    await integrarMensagens({ mensagens: [msg(analise)] });
    const d = await prisma.demanda.findFirstOrThrow();
    expect(await atualizarDemanda(EMAIL, d.id, "oQueFazer", "Ligar para a BGRE.")).toEqual({ ok: true });
    expect(await atualizarDemanda(EMAIL, d.id, "aguardando", "BGRE")).toEqual({ ok: true });

    const r = await integrarMensagens({
      mensagens: [
        msg({ internetMessageId: "<m2@x>", enviadoEm: "2026-10-31T10:00:00-03:00", demanda: false, oQueFazer: "Outra ação", proximoPasso: "Novo passo", situacaoSugerida: "AGUARDANDO", aguardando: "FORNECEDOR" }),
      ],
    });
    expect(r).toMatchObject({ atualizadas: 1 });
    if ("erro" in r) throw new Error(r.erro);
    expect(r.mensagens[0]).toMatchObject({ mudou: ["próximo passo", "situação"], preservado: ["o que a DF faz", "aguardando"] });
    expect(await prisma.demanda.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ oQueFazer: "Ligar para a BGRE.", proximoPasso: "Novo passo", situacao: "AGUARDANDO", aguardando: "BGRE" });
    expect(await prisma.logAlteracao.count({ where: { entidadeId: d.id, email: "rotina Triagem Contratante", campo: { in: ["próximo passo", "situação"] } } })).toBe(2);

    // Uma pessoa muda a situação: a rotina não troca mais; e concluída a rotina não reabre.
    expect(await atualizarDemanda(EMAIL, d.id, "situacao", "EM_ANDAMENTO")).toEqual({ ok: true });
    await integrarMensagens({ mensagens: [msg({ internetMessageId: "<m3@x>", enviadoEm: "2026-11-01T10:00:00-03:00", demanda: false, situacaoSugerida: "REUNIAO" })] });
    expect((await prisma.demanda.findUniqueOrThrow({ where: { id: d.id } })).situacao).toBe("EM_ANDAMENTO");
  });

  it("PATCH reprocessa as abertas: troca o que ninguém editou, preserva o resto e recusa fechada", async () => {
    await integrarMensagens({ mensagens: [msg({ prazo: null }), msg({ conversationId: "conv-2", internetMessageId: "<b@x>", assunto: "Outro" })] });
    const [a, b] = await prisma.demanda.findMany({ orderBy: { numero: "asc" } });
    expect(await atualizarDemanda(EMAIL, a!.id, "titulo", "Título escolhido pela equipe")).toEqual({ ok: true });
    expect(await atualizarDemanda(EMAIL, b!.id, "situacao", "CONCLUIDA")).toEqual({ ok: true });

    const r = await reprocessarDemandas({
      demandas: [
        { numero: a!.numero, ...analise, condominio: "Todos os condomínios", criticidadeSugerida: "URGENTE", aguardando: "DF" },
        { numero: b!.numero, ...analise },
        { numero: 99999, pedido: "x" },
      ],
    });
    expect(r).toMatchObject({ alteradas: 1, recusadas: 2 });
    if ("erro" in r) throw new Error(r.erro);
    expect(r.demandas[0]).toMatchObject({ preservado: ["título"] });
    expect(r.demandas[0]!.mudou).toEqual(["pedido", "o que a DF faz", "próximo passo", "aguardando", "criticidade", "condomínio"]);
    expect(r.demandas[1]!.erro).toMatch(/concluída/);
    expect(await prisma.demanda.findUniqueOrThrow({ where: { id: a!.id } })).toMatchObject({
      titulo: "Título escolhido pela equipe",
      pedido: analise.pedido,
      criticidade: "URGENTE",
      todaCarteira: true,
      condominioId: null,
    });
    expect((await prisma.demanda.findUniqueOrThrow({ where: { id: b!.id } })).pedido).toBeNull();
    // Rodar de novo não muda nada.
    expect(await reprocessarDemandas({ demandas: [{ numero: a!.numero, ...analise, criticidadeSugerida: "URGENTE" }] })).toMatchObject({ alteradas: 0, semMudanca: 1 });

    process.env.DEMANDAS_TOKEN = "token-de-teste-1234567890";
    const corpo = JSON.stringify({ demandas: [{ numero: a!.numero, proximoPasso: "Ligar na sexta." }] });
    const res = await PATCH(
      new Request("http://localhost/api/integracao/demandas", { method: "PATCH", headers: { authorization: "Bearer token-de-teste-1234567890", "content-length": String(Buffer.byteLength(corpo)) }, body: corpo }),
    );
    expect(await res.json()).toMatchObject({ alteradas: 1, demandas: [{ mudou: ["próximo passo"] }] });
    expect((await PATCH(new Request("http://localhost/api/integracao/demandas", { method: "PATCH", headers: { authorization: "Bearer errado" } }))).status).toBe(401);
    delete process.env.DEMANDAS_TOKEN;
  });
});
