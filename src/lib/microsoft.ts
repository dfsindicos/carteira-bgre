// Login com a conta Microsoft da DF (OpenID Connect, fluxo de código com PKCE). Só pessoas do diretório da DF entram
// (decisão do usuário: "Login Microsoft da DF. Só pessoas da DF usam"). Mesmo código das Aprovações.
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ForaDaDF, emailPermitido } from "./acesso";

const BASE = process.env.MICROSOFT_LOGIN_URL || "https://login.microsoftonline.com";

export function configMicrosoft() {
  const tenant = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;
  if (!tenant || !clientId || !clientSecret || !appUrl) return null;
  return { tenant, clientId, clientSecret, redirectUri: `${appUrl}/api/auth/callback/microsoft` };
}

export type ConfigMicrosoft = NonNullable<ReturnType<typeof configMicrosoft>>;

function aleatorio() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

async function desafio(verificador: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificador));
  return Buffer.from(hash).toString("base64url");
}

/** Endereço de ida para a Microsoft e os valores que precisam voltar iguais (guardados num cookie de 10 minutos). */
export async function inicioLogin(config: ConfigMicrosoft) {
  const estado = { state: aleatorio(), nonce: aleatorio(), verificador: aleatorio() };
  const url = new URL(`${BASE}/${config.tenant}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    response_mode: "query",
    scope: "openid profile email",
    state: estado.state,
    nonce: estado.nonce,
    code_challenge: await desafio(estado.verificador),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), estado };
}

let chaves: ReturnType<typeof createRemoteJWKSet> | undefined;

/** Troca o código pelo id_token e confere assinatura, emissor, destinatário, nonce e diretório. Devolve quem entrou. */
export async function concluirLogin(config: ConfigMicrosoft, code: string, verificador: string, nonce: string) {
  const resposta = await fetch(`${BASE}/${config.tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verificador,
    }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok || typeof dados.id_token !== "string") {
    // Código e primeira linha da descrição (ex.: AADSTS7000215, segredo inválido) para o log; nunca o segredo.
    const motivo = `${dados.error ?? resposta.status} ${String(dados.error_description ?? "").split("\n")[0]}`.trim();
    throw new Error(`A Microsoft não devolveu o id_token: ${motivo}`.slice(0, 400));
  }

  chaves ??= createRemoteJWKSet(new URL(`${BASE}/${config.tenant}/discovery/v2.0/keys`));
  const { payload } = await jwtVerify(dados.id_token, chaves, {
    issuer: `${BASE}/${config.tenant}/v2.0`,
    audience: config.clientId,
  });
  // O emissor já é do diretório da DF; o tid confere de novo, para nunca aceitar conta de outra empresa.
  if (payload.nonce !== nonce || payload.tid !== config.tenant) throw new Error("Resposta da Microsoft inválida.");

  const email = String(payload.email ?? payload.preferred_username ?? "").trim().toLowerCase();
  if (!email || typeof payload.oid !== "string") throw new Error("Conta Microsoft sem e-mail.");
  // Convidado do diretório (conta de outra empresa): o id_token traz "idp" com o emissor da casa dele.
  const convidado = typeof payload.idp === "string" && !payload.idp.includes(config.tenant);
  if (convidado || !emailPermitido(email)) throw new ForaDaDF(`conta de fora da DF recusada (${convidado ? "convidado" : "domínio"}): ${email.replace(/^[^@]*/, (m) => m.slice(0, 2) + "***")}`);
  return { oid: payload.oid, email, nome: typeof payload.name === "string" && payload.name ? payload.name : email };
}
