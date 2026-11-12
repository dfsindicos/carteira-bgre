import { describe, expect, it } from "vitest";
import { DURACAO_S, criarSessao, lerSessao, lerSessaoComPrazo, renovarSeNecessario } from "@/lib/sessao";
import { emailPermitido } from "@/lib/acesso";

process.env.AUTH_SECRET = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres";

describe("sessão", () => {
  it("lê de volta quem entrou", async () => {
    const token = await criarSessao({ nome: "Pessoa Teste", email: "pessoa@dfsindicos.com.br" });
    expect(await lerSessao(token)).toEqual({ nome: "Pessoa Teste", email: "pessoa@dfsindicos.com.br" });
  });

  it("recusa cookie adulterado, vazio ou assinado com outro segredo", async () => {
    const token = await criarSessao({ nome: "Pessoa Teste", email: "pessoa@dfsindicos.com.br" });
    expect(await lerSessao(token.slice(0, -2) + "xx")).toBeNull();
    expect(await lerSessao(undefined)).toBeNull();
    process.env.AUTH_SECRET = "outro-segredo-de-teste-com-mais-de-trinta-e-dois";
    expect(await lerSessao(token)).toBeNull();
  });

  it("derruba a sessão de quem não é da DF, mesmo assinada (convidado aberto antes da trava)", async () => {
    process.env.AUTH_SECRET = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres";
    const token = await criarSessao({ nome: "Pessoa de Fora", email: "pessoa@administradora.com.br" });
    expect(await lerSessao(token)).toBeNull();
  });
});

describe("sessão de 12 h com renovação deslizante", () => {
  it("vale 12 h e só é renovada depois da metade", async () => {
    process.env.AUTH_SECRET = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres";
    expect(DURACAO_S).toBe(12 * 60 * 60);
    const agora = Math.floor(Date.now() / 1000);
    const lida = await lerSessaoComPrazo(await criarSessao({ nome: "Pessoa Teste", email: "pessoa@dfsindicos.com.br" }));
    expect(lida).not.toBeNull();
    expect(lida!.venceEm - agora).toBeGreaterThan(DURACAO_S - 5);
    expect(lida!.venceEm - agora).toBeLessThanOrEqual(DURACAO_S);
    expect(await renovarSeNecessario(lida!, agora)).toBeNull();
    const depois = agora + DURACAO_S / 2 + 60;
    const novo = await renovarSeNecessario(lida!, depois);
    expect(novo).toEqual(expect.any(String));
    expect((await lerSessaoComPrazo(novo!))!.sessao).toEqual({ nome: "Pessoa Teste", email: "pessoa@dfsindicos.com.br" });
  });
});

describe("acesso só da DF", () => {
  it("aceita só o domínio da DF e recusa convidados e outros domínios", () => {
    expect(emailPermitido("Fulano@DFSindicos.com.br")).toBe(true);
    expect(emailPermitido("fulana@administradora.com.br")).toBe(false);
    expect(emailPermitido("fulana_administradora.com.br#EXT#@dfsindicos.onmicrosoft.com")).toBe(false);
    expect(emailPermitido("alguem@dfsindicos.com.br.golpe.com")).toBe(false);
    expect(emailPermitido("")).toBe(false);
  });

  it("LOGIN_EMAILS libera uma pessoa avulsa e LOGIN_DOMINIOS troca a lista", () => {
    process.env.LOGIN_EMAILS = "consultor@parceiro.com.br";
    expect(emailPermitido("consultor@parceiro.com.br")).toBe(true);
    expect(emailPermitido("outro@parceiro.com.br")).toBe(false);
    process.env.LOGIN_DOMINIOS = "parceiro.com.br";
    expect(emailPermitido("outro@parceiro.com.br")).toBe(true);
    expect(emailPermitido("fulano@dfsindicos.com.br")).toBe(false);
    delete process.env.LOGIN_EMAILS;
    delete process.env.LOGIN_DOMINIOS;
  });
});
