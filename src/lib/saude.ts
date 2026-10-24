import { prisma } from "./db";

/**
 * O banco responde? Com prazo de 3 s: a verificação de saúde nunca fica pendurada (ex.: conexões todas ocupadas por uma
 * importação longa); sem resposta a tempo, responde "não" e o monitoramento vê 503 em vez de silêncio.
 */
export async function verificarBanco(prazoMs = 3000): Promise<boolean> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<false>((resolve) => {
    relogio = setTimeout(() => resolve(false), prazoMs);
  });
  try {
    return await Promise.race([prisma.$queryRaw`SELECT 1`.then(() => true as const), prazo]);
  } catch {
    return false;
  } finally {
    clearTimeout(relogio);
  }
}
