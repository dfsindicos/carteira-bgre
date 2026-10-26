"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { criarAvaliacao, marcarPassos, mudarPrazo, salvarAcompanhamento, salvarCampo, type NumeroPasso, type Resposta } from "@/lib/avaliacoes";
import { salvarAdministradora, salvarCondominio } from "@/lib/cadastro";
import { formatarPeriodo, lerPeriodo, lerTipo } from "@/lib/scorecard";
import { sessaoAtual } from "@/lib/sessao";

// Server actions: leem quem está usando pela sessão e chamam as regras de src/lib, que validam tudo com Zod.

const texto = (f: FormData, nome: string) => String(f.get(nome) ?? "");

export async function acaoCriarAvaliacao(form: FormData) {
  const { email } = await sessaoAtual();
  const periodo = lerPeriodo(texto(form, "periodo"));
  const condominioId = z.string().min(1).parse(texto(form, "condominioId"));
  if (!periodo) throw new Error("Período inválido.");
  const tipo = lerTipo(texto(form, "tipo"));
  await criarAvaliacao(email, condominioId, periodo, tipo);
  redirect(`/avaliacao/${condominioId}/${formatarPeriodo(periodo)}?tipo=${tipo}`);
}

export async function acaoSalvarCampo(entrada: { avaliacaoId: string; item: string; campo: "nota" | "comentario"; valor: string }): Promise<Resposta> {
  const { email } = await sessaoAtual();
  const r = await salvarCampo(email, entrada);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/** Checklist: marca ou desmarca passos (o 4 é "Enviada à BGRE": trava as notas). marcarPassos valida com Zod. */
export async function acaoPassos(avaliacaoId: string, passos: NumeroPasso[], marcado: boolean): Promise<Resposta> {
  const { email } = await sessaoAtual();
  const r = await marcarPassos(email, avaliacaoId, passos, marcado);
  revalidatePath("/", "layout");
  return r;
}

export async function acaoAcompanhamento(form: FormData): Promise<Resposta> {
  const { email } = await sessaoAtual();
  const r = await salvarAcompanhamento(email, { avaliacaoId: texto(form, "avaliacaoId"), andamento: texto(form, "andamento"), estimativa: texto(form, "estimativa") });
  revalidatePath("/", "layout");
  return r;
}

export async function acaoPrazo(avaliacaoId: string, data: string): Promise<Resposta> {
  const { email } = await sessaoAtual();
  const r = await mudarPrazo(email, z.string().parse(avaliacaoId), z.string().parse(data));
  revalidatePath("/", "layout");
  return r;
}

export async function acaoSalvarAdministradora(form: FormData): Promise<Resposta> {
  const { email } = await sessaoAtual();
  const r = await salvarAdministradora(email, { id: texto(form, "id") || undefined, nome: texto(form, "nome"), emails: texto(form, "emails") });
  revalidatePath("/", "layout");
  return r;
}

export async function acaoSalvarCondominio(form: FormData): Promise<Resposta> {
  const { email } = await sessaoAtual();
  const r = await salvarCondominio(email, {
    id: texto(form, "id") || undefined,
    nome: texto(form, "nome"),
    administradoraId: texto(form, "administradoraId"),
    ativo: form.get("ativo") === "on",
    avaliadoDesde: texto(form, "avaliadoDesde"),
  });
  revalidatePath("/", "layout");
  return r;
}
