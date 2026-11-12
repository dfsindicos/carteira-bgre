import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { COOKIE_SESSAO, criarSessao } from "@/lib/sessao";

process.env.AUTH_SECRET = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres";
delete process.env.APP_URL;

describe("middleware: sem login não entra", () => {
  it("manda as telas para /entrar e responde 401 nas rotas de API", async () => {
    const tela = await middleware(new NextRequest("http://localhost/avaliacao/x/3T26/planilha"));
    expect(tela.status).toBe(307);
    expect(tela.headers.get("location")).toBe("http://localhost/entrar?next=%2Favaliacao%2Fx%2F3T26%2Fplanilha");
    expect((await middleware(new NextRequest("http://localhost/api/qualquer"))).status).toBe(401);
  });

  it("recusa cookie falso e deixa passar quem tem sessão válida", async () => {
    const falso = new NextRequest("http://localhost/", { headers: { cookie: `${COOKIE_SESSAO}=abc.def.ghi` } });
    expect((await middleware(falso)).status).toBe(307);
    const token = await criarSessao({ nome: "Pessoa Teste", email: "pessoa@dfsindicos.com.br" });
    const ok = await middleware(new NextRequest("http://localhost/", { headers: { cookie: `${COOKIE_SESSAO}=${token}` } }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-middleware-next")).toBe("1");
    expect(ok.cookies.get(COOKIE_SESSAO)).toBeUndefined();
  });

  it("renova o cookie da sessão que já passou da metade das 12 h", async () => {
    const { SignJWT } = await import("jose");
    const chave = new TextEncoder().encode(process.env.AUTH_SECRET);
    const agora = Math.floor(Date.now() / 1000);
    const velho = await new SignJWT({ nome: "Pessoa Teste", email: "pessoa@dfsindicos.com.br" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(agora - 8 * 3600)
      .setExpirationTime(agora + 4 * 3600)
      .sign(chave);
    const ok = await middleware(new NextRequest("http://localhost/", { headers: { cookie: `${COOKIE_SESSAO}=${velho}` } }));
    expect(ok.status).toBe(200);
    const renovado = ok.cookies.get(COOKIE_SESSAO);
    expect(renovado?.value).toBeTruthy();
    expect(renovado?.value).not.toBe(velho);
    expect(renovado?.maxAge).toBe(12 * 3600);
  });
});
