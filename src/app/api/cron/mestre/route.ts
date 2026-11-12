import { executarSincronizacao } from "@/lib/mestre";
import { conferirToken, responder } from "@/lib/token";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Cadastro mestre: chamado de hora em hora pelo cron do servidor (deploy/subir.sh) com o CRON_SECRET.
export async function POST(req: Request) {
  const negado = conferirToken(req, "CRON_SECRET");
  if (negado) return negado;
  const r = await executarSincronizacao();
  return responder(r, r.ok ? 200 : 502);
}
