// Quem pode usar a Carteira BGRE (mesma regra do Vistorias, 2026-10-29): só a equipe da DF (decisão do usuário: "Só pessoas da DF usam"). Conferir apenas o
// diretório Microsoft não basta: convidados (gente de fora com quem a DF compartilhou um arquivo ou equipe) também
// entram pelo diretório da DF. Por isso o e-mail precisa ser de um domínio da DF; LOGIN_DOMINIOS troca a lista
// (separada por vírgula) e LOGIN_EMAILS libera pessoas avulsas. Vale no login e em toda leitura de sessão, para uma
// sessão aberta antes da trava cair sozinha.
const DOMINIOS_PADRAO = ["dfsindicos.com.br"];

const lista = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

export function emailPermitido(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e || e.includes("#ext#")) return false;
  if (lista(process.env.LOGIN_EMAILS).includes(e)) return true;
  const dominios = lista(process.env.LOGIN_DOMINIOS);
  const dominio = e.slice(e.lastIndexOf("@") + 1);
  return e.includes("@") && (dominios.length ? dominios : DOMINIOS_PADRAO).includes(dominio);
}

/** Erro de login de quem não é da DF (a tela de entrada mostra "Esta conta não tem acesso"). */
export class ForaDaDF extends Error {}
