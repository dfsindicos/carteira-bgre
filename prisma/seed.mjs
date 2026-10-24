// Dados de demonstração, todos inventados (regra do repositório: nada de dado real). Só roda com SEED_DEMO=true.
// Idempotente: pode rodar de novo sem duplicar (upsert pelo nome e pelo condomínio+trimestre).
//   SEED_DEMO=true npm run db:seed
import { PrismaClient } from "@prisma/client";

if (process.env.SEED_DEMO !== "true") {
  console.log("Seed de demonstração desligado (SEED_DEMO diferente de true).");
  process.exit(0);
}

const prisma = new PrismaClient();
const CODIGOS = ["1.1", "2.1", "2.2.1", "2.2.2", "2.2.3", "2.3", "2.4", "2.5", "2.6", "3.1", "3.2", "3.3", "3.4", "4.1", "4.2", "4.3"];

const administradoras = [
  { nome: "Adm. Alfa (demo)", emails: "evidencias@adm-alfa.example" },
  { nome: "Adm. Beta (demo)", emails: "gerencia@adm-beta.example\nfinanceiro@adm-beta.example" },
  { nome: "Adm. Gama (demo)", emails: "" },
];

// [nome, administradora, base da nota no 2T26, variação no 3T26, notas que faltam no 3T26]
const condominios = [
  ["Torre Aurora (demo)", 0, 88, -4, 0],
  ["Centro Empresarial Sul (demo)", 1, 88, 1, 5],
  ["Edifício Horizonte (demo)", 0, 91, 0.4, 0],
  ["Parque Empresarial Leste (demo)", 2, 94, 2, 0],
  ["Corporate Norte (demo)", 1, 98.5, 0, 0],
];

// Notas variando em volta da base, sempre entre 0 e 100, com duas casas.
const nota = (base, i) => Math.max(0, Math.min(100, Math.round((base + ((i * 7) % 9) - 4) * 100) / 100));

const adms = [];
for (const a of administradoras) adms.push(await prisma.administradora.upsert({ where: { nome: a.nome }, update: {}, create: a }));

for (const [nome, adm, base, variacao, faltam] of condominios) {
  const c = await prisma.condominio.upsert({ where: { nome }, update: {}, create: { nome, administradoraId: adms[adm].id } });
  for (const [trimestre, b, status, sem] of [
    [2, base, "ENTREGUE", 0],
    [3, base + variacao, "RASCUNHO", faltam],
  ]) {
    const chave = { condominioId: c.id, ano: 2026, trimestre };
    if (await prisma.avaliacao.findUnique({ where: { condominioId_ano_trimestre: chave } })) continue;
    await prisma.avaliacao.create({
      data: {
        ...chave,
        status,
        entregaAte: new Date(Date.UTC(2026, trimestre * 3 + 1, 0)),
        entregueEm: status === "ENTREGUE" ? new Date(Date.UTC(2026, 6, 28, 15)) : null,
        notas: {
          create: CODIGOS.slice(0, CODIGOS.length - sem).map((item, i) => ({
            item,
            nota: nota(b, i),
            comentario: i % 4 === 0 ? "Evidência recebida da administradora (exemplo)." : "",
          })),
        },
      },
    });
  }
}
await prisma.condominio.upsert({
  where: { nome: "Residencial Antigo (demo, inativo)" },
  update: {},
  create: { nome: "Residencial Antigo (demo, inativo)", administradoraId: adms[2].id, ativo: false },
});

console.log("Seed de demonstração aplicado.");
await prisma.$disconnect();
