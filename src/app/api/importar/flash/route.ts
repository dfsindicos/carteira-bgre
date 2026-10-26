import { NextResponse } from "next/server";
import { z } from "zod";
import { gravarFlash } from "@/lib/flash";
import { mesmaOrigem } from "@/lib/origem";
import { sessaoAtual } from "@/lib/sessao";

export const dynamic = "force-dynamic";

const LIMITE = 10 * 1024 * 1024;
// O conteúdo é validado por esquemaFlash em src/lib/flash.ts.
const esquema = z.object({ modo: z.enum(["simular", "importar"]), dados: z.unknown() });
const responder = (corpo: unknown, status = 200) => NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });

/** Importar pela tela o histórico do Flash Report (o DATA do artefato): { modo, dados }. */
export async function POST(req: Request) {
  let email: string;
  try {
    email = (await sessaoAtual()).email;
  } catch {
    return responder({ erro: "Entre com a conta Microsoft da DF." }, 401);
  }
  if (!mesmaOrigem(req)) return responder({ erro: "Origem não permitida." }, 403);
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return responder({ erro: "Envie JSON." }, 415);
  const tamanho = Number(req.headers.get("content-length"));
  if (!tamanho || tamanho > LIMITE) return responder({ erro: "JSON maior que 10 MB." }, 413);
  const corpo = esquema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return responder({ erro: "Dados inválidos." }, 400);
  const r = await gravarFlash(email, corpo.data.dados, { gravar: corpo.data.modo === "importar" });
  return "erro" in r ? responder(r, 422) : responder(r);
}
