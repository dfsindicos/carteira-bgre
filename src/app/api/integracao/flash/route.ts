import { gravarFlash, lerFlash } from "@/lib/flash";
import { conferirToken, responder } from "@/lib/token";

export const dynamic = "force-dynamic";

// Endereço da rotina do Flash Report (segunda e quarta): GET lê o painel no formato DATA, POST grava o DATA novo.
// Fora do login Microsoft (middleware); a senha é FLASH_TOKEN, comparada em tempo constante. Sem ela, desligado.
const LIMITE = 10 * 1024 * 1024;
const autorizado = (req: Request) => conferirToken(req, "FLASH_TOKEN");

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
