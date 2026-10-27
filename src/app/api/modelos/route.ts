import { NextResponse } from "next/server";
import { z } from "zod";
import { LIMITE_MODELO, salvarModelo } from "@/lib/modelo-bgre";
import { mesmaOrigem } from "@/lib/origem";
import { TIPOS, type Tipo } from "@/lib/scorecard";
import { sessaoAtual } from "@/lib/sessao";

export const dynamic = "force-dynamic";

const esquema = z.object({ tipo: z.enum(TIPOS as [Tipo, ...Tipo[]]), arquivo: z.instanceof(File) });
const responder = (corpo: unknown, status = 200) => NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });

/** Envio do modelo oficial da planilha da BGRE (multipart: tipo e arquivo). */
export async function POST(req: Request) {
  let email: string;
  try {
    email = (await sessaoAtual()).email;
  } catch {
    return responder({ erro: "Entre com a conta Microsoft da DF." }, 401);
  }
  if (!mesmaOrigem(req)) return responder({ erro: "Origem não permitida." }, 403);
  if (Number(req.headers.get("content-length")) > LIMITE_MODELO + 64 * 1024) return responder({ erro: "Modelo maior que 5 MB." }, 413);
  const form = await req.formData().catch(() => null);
  const v = esquema.safeParse({ tipo: form?.get("tipo"), arquivo: form?.get("arquivo") });
  if (!v.success) return responder({ erro: "Escolha o tipo e o arquivo .xlsx." }, 400);
  const erro = await salvarModelo(email, v.data.tipo, v.data.arquivo.name.slice(0, 200), Buffer.from(await v.data.arquivo.arrayBuffer()));
  return erro ? responder({ erro }, 422) : responder({ ok: true });
}
