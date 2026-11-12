/**
 * Para onde o login Microsoft devolve a pessoa (o `next` de /entrar). Só caminho interno: começa com uma barra seguida
 * de algo que não seja barra nem contrabarra (o navegador lê `//site.com` e `/\site.com` como outro site) e não tem
 * caracteres de controle (o navegador apaga tabulação e quebra de linha, e `/\t/site.com` vira `//site.com`).
 * Qualquer outra coisa vira "/".
 */
export function destinoSeguro(next: string | null | undefined): string {
  if (!next || next.length > 2000) return "/";
  if (!/^\/(?![/\\])/.test(next)) return "/";
  if (/[\u0000-\u001f\u007f]/.test(next)) return "/";
  return next;
}

/**
 * A URL completa do destino, montada sobre a base do sistema (APP_URL). Segunda trava: se a URL montada sair da origem
 * do sistema, volta para a página inicial.
 */
export function urlDoDestino(next: string | null | undefined, base: string): URL {
  const raiz = new URL("/", base);
  try {
    const url = new URL(destinoSeguro(next), raiz);
    return url.origin === raiz.origin ? url : raiz;
  } catch {
    return raiz;
  }
}
