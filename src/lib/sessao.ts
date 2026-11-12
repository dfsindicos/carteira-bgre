import { SignJWT, jwtVerify } from "jose";
import { emailPermitido } from "./acesso";

// Sessão em cookie assinado (HS256 com AUTH_SECRET); a mesma função serve ao middleware (Edge) e às rotas.
// Vale 12 h e é renovada pelo middleware quando já passou da metade (renovação deslizante): quem usa o sistema não
// percebe; quem fica 12 h sem abrir entra de novo. Não há lista de sessões no banco: o corte de emergência de todas é
// trocar o AUTH_SECRET (ver docs/operacao.md, "Login").
export const COOKIE_SESSAO = "sessao";
export const DURACAO_S = 60 * 60 * 12;

export type Sessao = { nome: string; email: string };

function chave() {
  const segredo = process.env.AUTH_SECRET ?? "";
  if (segredo.length < 32) throw new Error("AUTH_SECRET ausente ou curto (mínimo de 32 caracteres).");
  return new TextEncoder().encode(segredo);
}

export function criarSessao(sessao: Sessao) {
  return new SignJWT(sessao).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${DURACAO_S}s`).sign(chave());
}

/**
 * Devolve a sessão do cookie, ou null se faltar, estiver vencida, adulterada, for de quem não é da DF
 * (ver `emailPermitido`) ou o servidor estiver sem AUTH_SECRET.
 */
export async function lerSessao(token: string | undefined): Promise<Sessao | null> {
  return (await lerSessaoComPrazo(token))?.sessao ?? null;
}

/** Como `lerSessao`, mais o vencimento (segundos desde 1970), para o middleware decidir a renovação. */
export async function lerSessaoComPrazo(token: string | undefined): Promise<{ sessao: Sessao; venceEm: number } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, chave(), { algorithms: ["HS256"] });
    if (typeof payload.nome !== "string" || typeof payload.email !== "string" || !emailPermitido(payload.email)) return null;
    if (typeof payload.exp !== "number") return null;
    return { sessao: { nome: payload.nome, email: payload.email }, venceEm: payload.exp };
  } catch {
    return null;
  }
}

/** Token novo se a sessão já passou da metade da validade; senão null (o cookie atual continua). */
export async function renovarSeNecessario(lida: { sessao: Sessao; venceEm: number }, agoraS = Math.floor(Date.now() / 1000)) {
  return lida.venceEm - agoraS < DURACAO_S / 2 ? criarSessao(lida.sessao) : null;
}

export const OPCOES_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: DURACAO_S,
  path: "/",
};

/** Quem está usando, nas server components, server actions e rotas (o middleware já barrou quem não entrou). */
export async function sessaoAtual(): Promise<Sessao> {
  const { cookies } = await import("next/headers");
  const sessao = await lerSessao((await cookies()).get(COOKIE_SESSAO)?.value);
  if (!sessao) throw new Error("Sem sessão: entre com a conta Microsoft da DF.");
  return sessao;
}
