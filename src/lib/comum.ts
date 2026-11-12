// Nomes normalizados para casar cadastros (importações e cadastro mestre).

/** Sem acento, caixa e pontuação. */
export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Nome para casar cadastros: sem acento, caixa, pontuação e o que estiver entre parênteses ("Torre (TD)" = "torre"). */
export const normalizarNome = (s: string) => normalizar(s.replace(/\([^)]*\)/g, " "));

/**
 * Nome de condomínio: o que está entre parênteses CONTA ("Jardim Demo (Cond. Geral)" e "Jardim Demo (Torre 7)" são dois;
 * problema visto pelo usuário em 2026-11-12). Sem acento, caixa e pontuação.
 */
export const chaveCondominio = (s: string) => normalizar(s);

/** Acha pelo nome: igual (com o parênteses) primeiro; sem ele, só se houver um único candidato. */
export function acharCondominioPorNome<T extends { nome: string }>(lista: T[], nome: string): T | undefined {
  const exato = lista.find((c) => chaveCondominio(c.nome) === chaveCondominio(nome));
  if (exato) return exato;
  const parecidos = lista.filter((c) => normalizarNome(c.nome) === normalizarNome(nome));
  if (parecidos.length === 1) return parecidos[0];
  // Pontuação entre números e espaços não contam ("10001 Demo" = "10.001 Demo"; visto pelo usuário em 2026-11-12),
  // só com candidato único.
  const junto = (s: string) => chaveCondominio(s).replace(/ /g, "");
  const colados = lista.filter((c) => junto(c.nome) === junto(nome));
  return colados.length === 1 ? colados[0] : undefined;
}
