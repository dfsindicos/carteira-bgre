import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { Resposta } from "./avaliacoes";
import { formatarPeriodo, lerPeriodo } from "./scorecard";

// Cadastro de administradoras e condomínios. Sem exclusão: condomínio que sai da carteira fica inativo.

const nome = z.string().trim().min(2, "Informe o nome.").max(120, "Nome longo demais.");

const esquemaAdministradora = z.object({
  id: z.string().optional(),
  nome,
  // Lista de e-mails separados por vírgula, ponto e vírgula ou linha; guardada normalizada, um por linha.
  emails: z
    .string()
    .max(2000)
    .transform((s) => s.split(/[\s,;]+/).filter(Boolean).map((e) => e.toLowerCase()))
    .pipe(z.array(z.email("E-mail inválido na lista.")))
    .transform((l) => [...new Set(l)].join("\n")),
});

const esquemaCondominio = z.object({
  id: z.string().optional(),
  nome,
  administradoraId: z.string().min(1, "Escolha a administradora."),
  ativo: z.boolean(),
  // Primeiro trimestre avaliado ("1T26"); vazio = desde o início do mapa.
  avaliadoDesde: z
    .string()
    .trim()
    .default("")
    .transform((t, ctx) => {
      if (!t) return { avaliadoDesdeAno: null, avaliadoDesdeTrimestre: null };
      const p = lerPeriodo(t);
      if (!p) {
        ctx.addIssue({ code: "custom", message: "“Avaliado desde” no formato 1T26." });
        return z.NEVER;
      }
      return { avaliadoDesdeAno: p.ano, avaliadoDesdeTrimestre: p.trimestre };
    }),
});

const desdeTexto = (c: { avaliadoDesdeAno: number | null; avaliadoDesdeTrimestre: number | null }) =>
  c.avaliadoDesdeAno && c.avaliadoDesdeTrimestre ? formatarPeriodo({ ano: c.avaliadoDesdeAno, trimestre: c.avaliadoDesdeTrimestre }) : "";

const duplicado = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function salvarAdministradora(email: string, entrada: z.input<typeof esquemaAdministradora>): Promise<Resposta> {
  const e = esquemaAdministradora.safeParse(entrada);
  if (!e.success) return { ok: false, erro: e.error.issues[0]?.message ?? "Dados inválidos." };
  const { id, ...dados } = e.data;
  try {
    await prisma.$transaction(async (tx) => {
      const antes = id ? await tx.administradora.findUniqueOrThrow({ where: { id } }) : null;
      const depois = id ? await tx.administradora.update({ where: { id }, data: dados }) : await tx.administradora.create({ data: dados });
      const campos = (["nome", "emails"] as const).filter((c) => antes?.[c] !== depois[c]);
      await tx.logAlteracao.createMany({
        data: campos.map((c) => ({ email, entidade: "Administradora", entidadeId: depois.id, campo: c, antes: antes?.[c] ?? null, depois: depois[c] })),
      });
    });
    return { ok: true };
  } catch (err) {
    if (duplicado(err)) return { ok: false, erro: "Já existe uma administradora com esse nome." };
    throw err;
  }
}

export async function salvarCondominio(email: string, entrada: z.input<typeof esquemaCondominio>): Promise<Resposta> {
  const e = esquemaCondominio.safeParse(entrada);
  if (!e.success) return { ok: false, erro: e.error.issues[0]?.message ?? "Dados inválidos." };
  const { id, avaliadoDesde, ...resto } = e.data;
  const dados = { ...resto, ...avaliadoDesde };
  try {
    await prisma.$transaction(async (tx) => {
      const antes = id ? await tx.condominio.findUniqueOrThrow({ where: { id } }) : null;
      const depois = id ? await tx.condominio.update({ where: { id }, data: dados }) : await tx.condominio.create({ data: dados });
      const campos = (["nome", "administradoraId", "ativo"] as const).filter((c) => antes?.[c] !== depois[c]);
      if ((antes ? desdeTexto(antes) : "") !== desdeTexto(depois))
        await tx.logAlteracao.create({
          data: { email, entidade: "Condominio", entidadeId: depois.id, campo: "avaliadoDesde", antes: antes && (desdeTexto(antes) || null), depois: desdeTexto(depois) || null },
        });
      await tx.logAlteracao.createMany({
        data: campos.map((c) => ({
          email,
          entidade: "Condominio",
          entidadeId: depois.id,
          campo: c,
          antes: antes ? String(antes[c]) : null,
          depois: String(depois[c]),
        })),
      });
    });
    return { ok: true };
  } catch (err) {
    if (duplicado(err)) return { ok: false, erro: "Já existe um condomínio com esse nome." };
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") return { ok: false, erro: "Administradora não encontrada." };
    throw err;
  }
}

export function listarCadastro() {
  return Promise.all([
    prisma.administradora.findMany({ orderBy: { nome: "asc" }, include: { _count: { select: { condominios: true } } } }),
    prisma.condominio.findMany({ orderBy: [{ ativo: "desc" }, { nome: "asc" }] }),
  ]);
}
