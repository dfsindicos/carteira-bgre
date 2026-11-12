// Nomes normalizados para casar cadastros (importações e cadastro mestre).

/** Sem acento, caixa e pontuação. */
export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Nome para casar cadastros: sem acento, caixa, pontuação e o que estiver entre parênteses ("Torre (CTN)" = "torre"). */
export const normalizarNome = (s: string) => normalizar(s.replace(/\([^)]*\)/g, " "));

/**
 * Nome de condomínio: o que está entre parênteses CONTA ("O Parque (Cond. Geral)" e "O Parque (Torre 7)" são dois;
 * problema visto pelo usuário em 2026-11-12). Sem acento, caixa e pontuação.
 */
export const chaveCondominio = (s: string) => normalizar(s);

/** Acha pelo nome: igual (com o parênteses) primeiro; sem ele, só se houver um único candidato. */
export function acharCondominioPorNome<T extends { nome: string }>(lista: T[], nome: string): T | undefined {
  const exato = lista.find((c) => chaveCondominio(c.nome) === chaveCondominio(nome));
  if (exato) return exato;
  const parecidos = lista.filter((c) => normalizarNome(c.nome) === normalizarNome(nome));
  return parecidos.length === 1 ? parecidos[0] : undefined;
}
