import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { configMicrosoft, concluirLogin } from "@/lib/microsoft";
import { COOKIE_SESSAO, OPCOES_COOKIE, criarSessao } from "@/lib/sessao";

export const dynamic = "force-dynamic";

const esquemaEstado = z.object({ state: z.string(), nonce: z.string(), verificador: z.string(), next: z.string() });
const COOKIE_ESTADO = { name: "login_microsoft", path: "/api/auth/callback/microsoft" };

export async function GET(request: NextRequest) {
  const base = process.env.APP_URL || request.url;
  // O motivo vai para o log do servidor (workflow "VPS: diagnóstico"); a tela mostra só a mensagem genérica.
  const falhou = (motivo: string) => {
    console.error(`[login microsoft] ${motivo} · ${request.headers.get("user-agent") ?? ""}`.slice(0, 500));
    const r = NextResponse.redirect(new URL("/entrar?erro=microsoft", base));
    r.cookies.delete(COOKIE_ESTADO);
    return r;
  };

  const config = configMicrosoft();
  const code = request.nextUrl.searchParams.get("code");
  let estado: z.infer<typeof esquemaEstado>;
  try {
    estado = esquemaEstado.parse(JSON.parse(request.cookies.get(COOKIE_ESTADO.name)?.value ?? ""));
  } catch {
    // Sem o cookie da ida: em geral o login voltou num navegador diferente do que o começou (app instalado no iPhone).
    return falhou("sem o cookie de estado da ida");
  }
  const erroMicrosoft = request.nextUrl.searchParams.get("error");
  if (erroMicrosoft) return falhou(`Microsoft respondeu ${erroMicrosoft}: ${request.nextUrl.searchParams.get("error_description") ?? ""}`);
  if (!config) return falhou("login Microsoft sem configuração no servidor");
  if (!code) return falhou("retorno sem código");
  if (request.nextUrl.searchParams.get("state") !== estado.state) return falhou("state diferente do da ida");

  let token: string;
  try {
    const pessoa = await concluirLogin(config, code, estado.verificador, estado.nonce);
    token = await criarSessao({ nome: pessoa.nome, email: pessoa.email });
  } catch (erro) {
    return falhou(erro instanceof Error ? erro.message : String(erro));
  }

  const resposta = NextResponse.redirect(new URL(estado.next, base));
  resposta.cookies.delete(COOKIE_ESTADO);
  resposta.cookies.set(COOKIE_SESSAO, token, OPCOES_COOKIE);
  return resposta;
}
