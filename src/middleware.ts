import { NextRequest, NextResponse } from "next/server";
import { COOKIE_SESSAO, OPCOES_COOKIE, lerSessaoComPrazo, renovarSeNecessario } from "@/lib/sessao";

// Tudo exige login Microsoft da DF, menos a tela de entrada, o próprio login, a verificação de saúde, as tarefas do
// cron e a integração com as rotinas (que têm segredo próprio) e os arquivos estáticos da tela de entrada (logo e ícone).
// Sessão válida que já passou da metade das 12 h sai com cookie renovado (renovação deslizante).
export async function middleware(request: NextRequest) {
  const lida = await lerSessaoComPrazo(request.cookies.get(COOKIE_SESSAO)?.value);
  if (lida) {
    const resposta = NextResponse.next();
    const novo = await renovarSeNecessario(lida);
    if (novo) resposta.cookies.set(COOKIE_SESSAO, novo, OPCOES_COOKIE);
    return resposta;
  }
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ erro: "Entre com a conta Microsoft da DF." }, { status: 401 });
  const entrar = new URL("/entrar", process.env.APP_URL || request.url);
  entrar.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(entrar);
}

export const config = {
  matcher: ["/((?!entrar|api/auth/|api/saude|api/cron/|api/integracao/|_next/|favicon|icon\\.svg$|.*\\.png$).*)"],
};
