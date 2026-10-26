import { NextResponse } from "next/server";
import { z } from "zod";
import { importarJson } from "@/lib/importacao-json";
import { mesmaOrigem } from "@/lib/origem";
import { sessaoAtual } from "@/lib/sessao";

export const dynamic = "force-dynamic";

// O JSON do checklist, com as notas, cabe folgado em 10 MB (2.000 avaliações).
const LIMITE = 10 * 1024 * 1024;
const esquema = z.object({
  modo: z.enum(["simular", "importar"]),
  substituir: z.boolean().default(false),
  // nome normalizado → id do condomínio ou "ignorar"
  escolhas: z.record(z.string().max(200), z.string().max(50)).default({}),
  // O conteúdo é validado por esquemaJson em src/lib/importacao-json.ts.
  dados: z.unknown(),
});
const responder = (corpo: unknown, status = 200) => NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });

/** Importar o JSON do checklist: { modo, substituir, escolhas, dados }. */
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
  if (!tamanho || tamanho > LIMITE) return responder({ erro: "JSON maior que 10 MB: divida em partes." }, 413);
  const corpo = esquema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return responder({ erro: "Dados inválidos." }, 400);
  const { modo, substituir, escolhas, dados } = corpo.data;
  const r = await importarJson(email, dados, { escolhas, substituir, gravar: modo === "importar" });
  return "erro" in r ? responder(r, 422) : responder(r);
}
