"use client";

import { useState, useTransition } from "react";
import type { Resposta } from "@/lib/avaliacoes";

/**
 * Formulário de uma linha do cadastro. Envia por onSubmit (e não por action={...}) porque o React 19 limpa o formulário
 * ao fim da ação e apagaria o que foi digitado quando há erro; só limpa no sucesso de uma linha nova.
 */
export function FormularioLinha({
  acao,
  limpar = false,
  rotulo = "Salvar",
  className = "",
  children,
}: {
  acao: (f: FormData) => Promise<Resposta>;
  limpar?: boolean;
  rotulo?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  return (
    <form
      className={`flex flex-wrap items-end gap-2 ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        iniciar(async () => {
          const r = await acao(new FormData(form));
          setMsg(r.ok ? { ok: true, texto: "Salvo." } : { ok: false, texto: r.erro });
          if (r.ok && limpar) form.reset();
        });
      }}
    >
      {children}
      <button disabled={pendente} className="bg-marca px-3 py-1.5 text-[13px] font-bold text-marca-texto disabled:opacity-60">
        {rotulo}
      </button>
      {msg && (
        <span role={msg.ok ? "status" : "alert"} className={`basis-full text-[12.5px] ${msg.ok ? "text-ok" : "text-erro"}`}>
          {msg.texto}
        </span>
      )}
    </form>
  );
}
