"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { criarAvaliacao, mudarPrazo, mudarStatus, salvarCampo, type Resposta } from "@/lib/avaliacoes";
import { salvarAdministradora, salvarCondominio } from "@/lib/cadastro";
import { formatarPeriodo, lerPeriodo } from "@/lib/scorecard";
import { sessaoAtual } from "@/lib/sessao";

// Server actions: leem quem está usando pela sessão e chamam as regras de src/lib, que validam tudo com Zod.

const texto = (f: FormData, nome: string) => String(f.get(nome) ?? "");

export async function acaoCriarAvaliacao(form: FormData) {
  const { email } = await sessaoAtual();
  const periodo = lerPeriodo(texto(form, "periodo"));
  const condominioId = z.string().min(1).parse(texto(form, "condominioId"));
  if (!periodo) throw new Error("Período inválido.");
  await criarAvaliacao(email, condominioId, periodo);
  redirect(`/avaliacao/${condominioId}/${formatarPeriodo(periodo)}`);
}

export async function acaoSalvarCampo(entrada: { avaliacaoId: string; item: string; campo: "nota" | "comentario"; valor: string }): Promise<Resposta> {
  const { email } = await sessaoAtual();
  const r = await salvarCampo(email, entrada);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function acaoStatus(avaliacaoId: string, status: "ENTREGUE" | "RASCUNHO"): Promise<Resposta> {
  const { email } = await sessaoAtual();
  const r = await mudarStatus(email, z.string().parse(avaliacaoId), z.enum(["ENTREGUE", "RASCUNHO"]).parse(status));
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
  });
  revalidatePath("/", "layout");
  return r;
}
