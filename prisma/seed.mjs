// Dados de demonstração, todos inventados (regra do repositório: nada de dado real). Só roda com SEED_DEMO=true.
// Idempotente: pode rodar de novo sem duplicar (upsert pelo nome e por condomínio+trimestre+tipo). Cria as duas
// avaliações (Administradora e Sindicância) de 1T25 ao 3T26 em vários estados: concluída, em andamento, estimativa,
// sem planilha e a fazer, e condomínios com "avaliado desde".
//   SEED_DEMO=true npm run db:seed
import { PrismaClient } from "@prisma/client";

if (process.env.SEED_DEMO !== "true") {
  console.log("Seed de demonstração desligado (SEED_DEMO diferente de true).");
  process.exit(0);
}

const prisma = new PrismaClient();
const CODIGOS = {
  ADMINISTRADORA: ["1.1", "2.1", "2.2.1", "2.2.2", "2.2.3", "2.3", "2.4", "2.5", "2.6", "3.1", "3.2", "3.3", "3.4", "4.1", "4.2", "4.3"],
  SINDICANCIA: ["1.1", "1.2", "2.1", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "4.1", "4.2"],
};
const TRIMESTRES = [
  [2025, 1],
  [2025, 2],
  [2025, 3],
  [2025, 4],
  [2026, 1],
  [2026, 2],
  [2026, 3],
];

const administradoras = [
  { nome: "Adm. Alfa (demo)", emails: "evidencias@adm-alfa.example" },
  { nome: "Adm. Beta (demo)", emails: "gerencia@adm-beta.example\nfinanceiro@adm-beta.example" },
  { nome: "Adm. Gama (demo)", emails: "" },
];

// [nome, administradora, base da nota, avaliado desde [ano, trimestre] ou null]
const condominios = [
  ["Torre Aurora (demo)", 0, 86, [2026, 1]],
  ["Centro Empresarial Sul (demo)", 1, 78, null],
  ["Edifício Horizonte (demo)", 0, 91, null],
  ["Parque Empresarial Leste (demo)", 2, 94, [2025, 3]],
  ["Corporate Norte (demo)", 1, 97.5, null],
];

// Notas variando em volta da base, sempre entre 0 e 100, com duas casas.
const nota = (base, i) => Math.max(0, Math.min(100, Math.round((base + ((i * 7) % 9) - 4) * 100) / 100));

/**
 * Estado de cada avaliação no mapa: "concluida" (notas + 4 passos), "andamento" (notas + 2 passos), "estimativa"
 * (1 passo, estimativa e andamento), "parcial" (metade das notas, 1 passo), null = não cria (sem planilha / a fazer).
 */
function estado(tipo, ci, qi) {
  const fechado = qi < TRIMESTRES.length - 1;
  if (tipo === "ADMINISTRADORA") {
    if (ci === 1 && qi === 2) return null; // sem planilha num trimestre fechado
    if (qi <= 4) return "concluida";
    if (qi === 5) return ci % 2 ? "andamento" : "concluida";
    return ["estimativa", "parcial", null, "estimativa", "andamento"][ci];
  }
  if (qi < 4) return ci === 4 && qi >= 2 ? "concluida" : null;
  if (fechado) return ci === 1 && qi === 5 ? "andamento" : ci === 3 && qi === 4 ? null : "concluida";
  return ["estimativa", null, "parcial", null, "estimativa"][ci];
}

const adms = [];
for (const a of administradoras) adms.push(await prisma.administradora.upsert({ where: { nome: a.nome }, update: {}, create: a }));

for (const [ci, [nome, adm, base, desde]] of condominios.entries()) {
  const desdeDados = { avaliadoDesdeAno: desde?.[0] ?? null, avaliadoDesdeTrimestre: desde?.[1] ?? null };
  const c = await prisma.condominio.upsert({ where: { nome }, update: desdeDados, create: { nome, administradoraId: adms[adm].id, ...desdeDados } });
  for (const tipo of ["ADMINISTRADORA", "SINDICANCIA"]) {
    for (const [qi, [ano, trimestre]] of TRIMESTRES.entries()) {
      if (desde && ano * 4 + trimestre < desde[0] * 4 + desde[1]) continue;
      const e = estado(tipo, ci, qi);
      if (!e) continue;
      const codigos = CODIGOS[tipo];
      const b = base + (tipo === "SINDICANCIA" ? 2 : 0) + qi * 0.6 - 2;
      const comNotas = e === "concluida" || e === "andamento" ? codigos : e === "parcial" ? codigos.slice(0, Math.ceil(codigos.length / 2)) : [];
      const feitos = { concluida: 4, andamento: 2, estimativa: 1, parcial: 1 }[e];
      const dia = (n) => new Date(Date.UTC(ano, trimestre * 3, 3 + n * 5, 15));
      const checklist = {
        status: feitos === 4 ? "ENTREGUE" : "RASCUNHO",
        passo1Em: feitos >= 1 ? dia(0) : null,
        passo1Por: feitos >= 1 ? "pessoa.demo@exemplo.test" : null,
        passo2Em: feitos >= 2 ? dia(1) : null,
        passo2Por: feitos >= 2 ? "pessoa.demo@exemplo.test" : null,
        passo3Em: feitos >= 3 ? dia(2) : null,
        passo3Por: feitos >= 3 ? "pessoa.demo@exemplo.test" : null,
        entregueEm: feitos === 4 ? dia(4) : null,
        passo4Por: feitos === 4 ? "pessoa.demo@exemplo.test" : null,
        andamento: e === "estimativa" || e === "parcial" ? ["Falta: SST de setembro (2.5) (exemplo)", "Falta: RGM de setembro (exemplo)"] : [],
        andamentoEm: e === "estimativa" || e === "parcial" ? new Date(Date.UTC(2026, 9, 21)) : null,
        estimativa: e === "estimativa" ? Math.round(b * 100) / 100 : null,
      };
      await prisma.avaliacao.upsert({
        where: { condominioId_ano_trimestre_tipo: { condominioId: c.id, ano, trimestre, tipo } },
        update: checklist,
        create: {
          condominioId: c.id,
          ano,
          trimestre,
          tipo,
          entregaAte: new Date(Date.UTC(ano, trimestre * 3 + 1, 0)),
          ...checklist,
          notas: {
            create: comNotas.map((item, i) => ({
              item,
              nota: nota(b, i),
              comentario: i % 4 === 0 ? "Evidência recebida (exemplo)." : "",
            })),
          },
        },
      });
    }
  }
}
await prisma.condominio.upsert({
  where: { nome: "Residencial Antigo (demo, inativo)" },
  update: {},
  create: { nome: "Residencial Antigo (demo, inativo)", administradoraId: adms[2].id, ativo: false },
});

console.log("Seed de demonstração aplicado.");
await prisma.$disconnect();
