import { NextRequest, NextResponse } from "next/server";
import { COOKIE_SESSAO } from "@/lib/sessao";

export async function POST(request: NextRequest) {
  const resposta = NextResponse.redirect(new URL("/entrar", process.env.APP_URL || request.url), 303);
  resposta.cookies.delete(COOKIE_SESSAO);
  return resposta;
}
