import { NextResponse } from "next/server";
import { z } from "zod";
import { importarPlanilhas, type Arquivo } from "@/lib/importacao";
import { mesmaOrigem } from "@/lib/origem";
import { sessaoAtual } from "@/lib/sessao";

export const dynamic = "force-dynamic";

// Corpo inteiro do envio: um .zip de até 60 MB ou várias .xlsx; o limite de cada arquivo fica em src/lib/importacao.ts.
const LIMITE_ENVIO = 100 * 1024 * 1024;
const esquema = z.object({ modo: z.enum(["simular", "importar"]), substituir: z.literal("on").optional() });
const responder = (corpo: unknown, status = 200) => NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });

/** Importar: multipart com `arquivos` (.xlsx ou .zip), `modo` e `substituir`. Lê na memória e descarta. */
export async function POST(req: Request) {
  let email: string;
  try {
    email = (await sessaoAtual()).email;
  } catch {
    return responder({ erro: "Entre com a conta Microsoft da DF." }, 401);
  }
  if (!mesmaOrigem(req)) return responder({ erro: "Origem não permitida." }, 403);
  if (!(req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) return responder({ erro: "Envie o formulário com os arquivos." }, 415);
  const tamanho = Number(req.headers.get("content-length"));
  if (!tamanho || tamanho > LIMITE_ENVIO) return responder({ erro: "Envio maior que 100 MB: divida em partes." }, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return responder({ erro: "Formulário inválido." }, 400);
  }
  const campos = esquema.safeParse({ modo: form.get("modo") ?? undefined, substituir: form.get("substituir") ?? undefined });
  if (!campos.success) return responder({ erro: "Dados inválidos." }, 400);
  const arquivos: Arquivo[] = [];
  for (const f of form.getAll("arquivos")) {
    if (!(f instanceof File)) return responder({ erro: "Dados inválidos." }, 400);
    arquivos.push({ nome: f.name.slice(0, 200), bytes: new Uint8Array(await f.arrayBuffer()) });
  }
  if (!arquivos.length) return responder({ erro: "Escolha as planilhas (.xlsx) ou o .zip da pasta." }, 400);

  const r = await importarPlanilhas(email, arquivos, { substituir: !!campos.data.substituir, gravar: campos.data.modo === "importar" });
  return "erro" in r ? responder(r, 422) : responder(r);
}
