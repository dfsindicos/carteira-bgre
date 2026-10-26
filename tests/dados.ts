import { prisma } from "@/lib/db";

// Apaga tudo e cria uma administradora e um condomínio sintéticos.
export async function limparECriar() {
  await prisma.$executeRawUnsafe('TRUNCATE "FlashPainel", "FlashSemana", "LogAlteracao", "NotaItem", "Avaliacao", "Condominio", "Administradora" CASCADE');
  const adm = await prisma.administradora.create({ data: { nome: "Adm. Teste" } });
  const condominio = await prisma.condominio.create({ data: { nome: "Torre Teste", administradoraId: adm.id } });
  return { adm, condominio };
}
