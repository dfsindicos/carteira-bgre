import { NextResponse } from "next/server";
import { verificarBanco } from "@/lib/saude";

export const dynamic = "force-dynamic";

/** Verificação de saúde (monitoramento e healthcheck do Docker): responde 200 só se o banco responde. Não expõe dado nenhum. */
export async function GET() {
  const ok = await verificarBanco();
  return NextResponse.json({ ok }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
