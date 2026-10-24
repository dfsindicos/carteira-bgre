import { NextRequest, NextResponse } from "next/server";
import { COOKIE_SESSAO, lerSessao } from "@/lib/sessao";

// Tudo exige login Microsoft da DF, menos a tela de entrada, o próprio login, a verificação de saúde, as tarefas do
// cron (que têm segredo próprio) e os arquivos estáticos da tela de entrada (logo e ícone).
export async function middleware(request: NextRequest) {
  if (await lerSessao(request.cookies.get(COOKIE_SESSAO)?.value)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ erro: "Entre com a conta Microsoft da DF." }, { status: 401 });
  const entrar = new URL("/entrar", process.env.APP_URL || request.url);
  entrar.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(entrar);
}

export const config = {
  matcher: ["/((?!entrar|api/auth/|api/saude|api/cron/|_next/|favicon|icon\\.svg$|.*\\.png$).*)"],
};
