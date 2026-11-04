import { demandasAbertas, integrarMensagens, reprocessarDemandas } from "@/lib/demandas";
import { conferirToken, responder } from "@/lib/token";

export const dynamic = "force-dynamic";

// Endereço da Triagem Contratante para as demandas da BGRE (formato em docs/operacao.md). POST grava um lote de até 100
// mensagens; PATCH refaz a análise das abertas (a tela manda: o que uma pessoa editou fica); GET ?abertas=1 devolve as
// abertas para o e-mail diário [Triagem]. Fora do login Microsoft (middleware); a senha é DEMANDAS_TOKEN, comparada em
// tempo constante. Sem ela, desligado (503).
const LIMITE = 5 * 1024 * 1024;
const autorizado = (req: Request) => conferirToken(req, "DEMANDAS_TOKEN");

export async function GET(req: Request) {
  const negado = autorizado(req);
  if (negado) return negado;
  return responder({ demandas: await demandasAbertas() });
}

export async function POST(req: Request) {
  const negado = autorizado(req);
  if (negado) return negado;
  const tamanho = Number(req.headers.get("content-length"));
  if (!tamanho || tamanho > LIMITE) return responder({ erro: "Envie no máximo 5 MB, com Content-Length." }, 413);
  const r = await integrarMensagens(await req.json().catch(() => null));
  return "erro" in r ? responder(r, 422) : responder(r);
}

export async function PATCH(req: Request) {
  const negado = autorizado(req);
  if (negado) return negado;
  const tamanho = Number(req.headers.get("content-length"));
  if (!tamanho || tamanho > LIMITE) return responder({ erro: "Envie no máximo 5 MB, com Content-Length." }, 413);
  const r = await reprocessarDemandas(await req.json().catch(() => null));
  return "erro" in r ? responder(r, 422) : responder(r);
}
