import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

// Senha das rotinas (/api/integracao/*): "Authorization: Bearer <token>", comparada em tempo constante (resumo SHA-256
// dos dois lados, para o tamanho não vazar). Variável vazia no servidor = endereço desligado (503).
export const responder = (corpo: unknown, status = 200) => NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
const resumo = (s: string) => createHash("sha256").update(s).digest();

/** null = autorizado; senão, a resposta 503 (sem token configurado) ou 401 (token errado). */
export function conferirToken(req: Request, variavel: string) {
  const token = process.env[variavel];
  if (!token) return responder({ erro: `${variavel} não configurado no servidor.` }, 503);
  const enviado = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  return timingSafeEqual(resumo(enviado), resumo(token)) ? null : responder({ erro: "Senha inválida." }, 401);
}
