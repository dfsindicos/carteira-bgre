"use client";

import { useState, useTransition } from "react";
import { acaoPrazo, acaoStatus } from "@/app/acoes";
import type { Resposta } from "@/lib/avaliacoes";

/** "Marcar como entregue" / "Reabrir", com a mensagem de erro do servidor (ex.: faltam notas). */
export function BotaoStatus({ avaliacaoId, entregue }: { avaliacaoId: string; entregue: boolean }) {
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const clicar = () =>
    iniciar(async () => {
      if (entregue && !confirm("Reabrir a avaliação para edição?")) return;
      const r: Resposta = await acaoStatus(avaliacaoId, entregue ? "RASCUNHO" : "ENTREGUE");
      setErro(r.ok ? "" : r.erro);
    });
  return (
    <span className="inline-flex flex-col">
      <button onClick={clicar} disabled={pendente} className="border border-marca px-3 py-1.5 text-[13px] font-bold text-titulo disabled:opacity-60">
        {entregue ? "Reabrir" : "Marcar como entregue"}
      </button>
      {erro && (
        <span role="alert" className="text-[12px] text-erro">
          {erro}
        </span>
      )}
    </span>
  );
}

/** Prazo de entrega à BGRE, gravado ao mudar a data. */
export function CampoPrazo({ avaliacaoId, valor, bloqueado }: { avaliacaoId: string; valor: string; bloqueado: boolean }) {
  const [erro, setErro] = useState("");
  return (
    <label className="inline-flex flex-wrap items-center gap-1.5">
      entrega à BGRE até
      <input
        type="date"
        defaultValue={valor}
        disabled={bloqueado}
        onChange={async (e) => {
          const r = await acaoPrazo(avaliacaoId, e.target.value);
          setErro(r.ok ? "" : r.erro);
        }}
        className="border border-borda bg-superficie px-1 py-0.5 text-texto disabled:bg-superficie-2"
      />
      {erro && (
        <span role="alert" className="text-erro">
          {erro}
        </span>
      )}
    </label>
  );
}
