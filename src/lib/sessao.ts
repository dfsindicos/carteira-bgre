import { SignJWT, jwtVerify } from "jose";

// Sessão em cookie assinado (HS256 com AUTH_SECRET); a mesma função serve ao middleware (Edge) e às rotas.
export const COOKIE_SESSAO = "sessao";
const DURACAO_S = 60 * 60 * 24 * 30;

export type Sessao = { nome: string; email: string };

function chave() {
  const segredo = process.env.AUTH_SECRET ?? "";
  if (segredo.length < 32) throw new Error("AUTH_SECRET ausente ou curto (mínimo de 32 caracteres).");
  return new TextEncoder().encode(segredo);
}

export function criarSessao(sessao: Sessao) {
  return new SignJWT(sessao).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${DURACAO_S}s`).sign(chave());
}

/** Devolve a sessão do cookie, ou null se faltar, estiver vencida, adulterada, ou o servidor estiver sem AUTH_SECRET. */
export async function lerSessao(token: string | undefined): Promise<Sessao | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, chave(), { algorithms: ["HS256"] });
    return typeof payload.nome === "string" && typeof payload.email === "string" ? { nome: payload.nome, email: payload.email } : null;
  } catch {
    return null;
  }
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
