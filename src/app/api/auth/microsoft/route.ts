import { NextRequest, NextResponse } from "next/server";
import { configMicrosoft, inicioLogin } from "@/lib/microsoft";
import { destinoSeguro } from "@/lib/destino";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const config = configMicrosoft();
  if (!config) return NextResponse.redirect(new URL("/entrar?erro=microsoft", process.env.APP_URL || request.url));

  const { url, estado } = await inicioLogin(config);
  const resposta = NextResponse.redirect(url);
  resposta.cookies.set("login_microsoft", JSON.stringify({ ...estado, next: destinoSeguro(request.nextUrl.searchParams.get("next")) }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/auth/callback/microsoft",
  });
  return resposta;
}
