"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { acaoCampoDemanda, acaoReabrirDemanda } from "@/app/acoes";

/** Filtro da lista (condomínio, responsável): muda a URL ao escolher, sem botão. */
export function FiltroSelect({ nome, rotulo, opcoes }: { nome: string; rotulo: string; opcoes: [string, string][] }) {
  const router = useRouter();
  const busca = useSearchParams();
  return (
    <label className="flex items-center gap-1.5 text-[13px] text-suave">
      {rotulo}
      <select
        value={busca.get(nome) ?? ""}
        onChange={(e) => {
          const p = new URLSearchParams(busca.toString());
          if (e.target.value) p.set(nome, e.target.value);
          else p.delete(nome);
          router.push(`/demandas?${p.toString()}`);
        }}
        className="min-h-9 max-w-52 border border-borda bg-superficie px-2 text-[14px] text-texto"
      >
        <option value="">Todos</option>
        {opcoes.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Campo da demanda que grava ao mudar (select, data) ou ao sair do campo (texto), com o erro do servidor embaixo.
 * `opcoes` = select; `tipo` = input.
 */
export function CampoDemanda({
  id,
  campo,
  valor,
  rotulo,
  opcoes,
  tipo = "text",
  lista,
  desabilitado,
}: {
  id: string;
  campo: string;
  valor: string;
  rotulo: string;
  opcoes?: [string, string][];
  tipo?: "text" | "date";
  lista?: string[];
  desabilitado?: boolean;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  const gravar = (v: string) => {
    if (v === valor) return;
    iniciar(async () => {
      const r = await acaoCampoDemanda(id, campo, v);
      setMsg(r.ok ? { ok: true, texto: "Salvo." } : { ok: false, texto: r.erro });
    });
  };
  const cls = "min-h-9 w-full border border-borda bg-superficie px-2 py-1 text-[14px] text-texto disabled:bg-superficie-2";
  return (
    <span className="grid gap-0.5">
      {opcoes ? (
        <select aria-label={rotulo} defaultValue={valor} disabled={desabilitado || pendente} onChange={(e) => gravar(e.target.value)} className={cls}>
          {opcoes.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      ) : (
        <>
          <input
            aria-label={rotulo}
            type={tipo}
            defaultValue={valor}
            disabled={desabilitado || pendente}
            list={lista ? `${campo}-opcoes` : undefined}
            onChange={tipo === "date" ? (e) => gravar(e.target.value) : undefined}
            onBlur={tipo === "text" ? (e) => gravar(e.target.value.trim()) : undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tipo === "text") (e.target as HTMLInputElement).blur();
            }}
            className={cls}
          />
          {lista && (
            <datalist id={`${campo}-opcoes`}>
              {lista.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          )}
        </>
      )}
      {msg && (
        <span role={msg.ok ? "status" : "alert"} className={`text-[12px] ${msg.ok ? "text-ok" : "text-erro"}`}>
          {msg.texto}
        </span>
      )}
    </span>
  );
}

/** Concluir (situação Concluída) ou reabrir uma demanda concluída/arquivada. */
export function BotaoSituacao({ id, acao, rotulo, confirmar, className }: { id: string; acao: "concluir" | "reabrir"; rotulo: string; confirmar?: string; className: string }) {
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={pendente}
        className={`${className} disabled:opacity-60`}
        onClick={() =>
          iniciar(async () => {
            if (confirmar && !confirm(confirmar)) return;
            const r = acao === "concluir" ? await acaoCampoDemanda(id, "situacao", "CONCLUIDA") : await acaoReabrirDemanda(id);
            setErro(r.ok ? "" : r.erro);
          })
        }
      >
        {rotulo}
      </button>
      {erro && (
        <span role="alert" className="text-[12px] text-erro">
          {erro}
        </span>
      )}
    </span>
  );
}
