import { describe, expect, it } from "vitest";
import { criarSessao, lerSessao } from "@/lib/sessao";

process.env.AUTH_SECRET = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres";

describe("sessão", () => {
  it("lê de volta quem entrou", async () => {
    const token = await criarSessao({ nome: "Pessoa Teste", email: "pessoa@exemplo.com.br" });
    expect(await lerSessao(token)).toEqual({ nome: "Pessoa Teste", email: "pessoa@exemplo.com.br" });
  });

  it("recusa cookie adulterado, vazio ou assinado com outro segredo", async () => {
    const token = await criarSessao({ nome: "Pessoa Teste", email: "pessoa@exemplo.com.br" });
    expect(await lerSessao(token.slice(0, -2) + "xx")).toBeNull();
    expect(await lerSessao(undefined)).toBeNull();
    process.env.AUTH_SECRET = "outro-segredo-de-teste-com-mais-de-trinta-e-dois";
    expect(await lerSessao(token)).toBeNull();
  });
});
