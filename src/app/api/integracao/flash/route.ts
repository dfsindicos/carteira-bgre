import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { gravarFlash, lerFlash } from "@/lib/flash";

export const dynamic = "force-dynamic";

// Endereço da rotina do Flash Report (segunda e quarta): GET lê o painel no formato DATA, POST grava o DATA novo.
// Fora do login Microsoft (middleware); a senha é FLASH_TOKEN, comparada em tempo constante. Sem ela, desligado.
const LIMITE = 10 * 1024 * 1024;
const responder = (corpo: unknown, status = 200) => NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
const resumo = (s: string) => createHash("sha256").update(s).digest();

function autorizado(req: Request) {
  const token = process.env.FLASH_TOKEN;
  if (!token) return responder({ erro: "FLASH_TOKEN não configurado no servidor." }, 503);
  const enviado = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  return timingSafeEqual(resumo(enviado), resumo(token)) ? null : responder({ erro: "Senha inválida." }, 401);
}

export async function GET(req: Request) {
  const negado = autorizado(req);
  if (negado) return negado;
  const dados = await lerFlash();
  return dados ? responder(dados) : responder({ erro: "Nada gravado ainda: importe o histórico pela tela Importar." }, 404);
}

export async function POST(req: Request) {
  const negado = autorizado(req);
  if (negado) return negado;
  const tamanho = Number(req.headers.get("content-length"));
  if (!tamanho || tamanho > LIMITE) return responder({ erro: "Envie no máximo 10 MB, com Content-Length." }, 413);
  const r = await gravarFlash("rotina do Flash Report", await req.json().catch(() => null), { gravar: true });
  return "erro" in r ? responder(r, 422) : responder(r);
}
