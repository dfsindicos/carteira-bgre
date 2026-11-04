"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { acaoCampoDemanda, acaoReabrirDemanda } from "@/app/acoes";

/**
 * "Filtros e ordem": recolhido no celular; aberto sozinho em tela de 768 px ou mais. Sem JavaScript, fica recolhido e
 * abre ao tocar (o formulário é GET e funciona igual).
 */
export function FiltrosRecolhiveis({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current && window.matchMedia("(min-width: 768px)").matches) ref.current.open = true;
  }, []);
  return (
    <details
      ref={ref}
      className="group grid gap-2"
      // Campo vazio não vai para a URL (?q=&cond=…): desligado no envio, não é enviado.
      onSubmitCapture={(e) => {
        for (const el of (e.target as HTMLFormElement).elements)
          if ((el instanceof HTMLInputElement || el instanceof HTMLSelectElement) && el.name && !el.value) el.disabled = true;
      }}
    >
      <summary className="w-fit cursor-pointer border border-borda bg-superficie px-3 py-1.5 text-[13px] font-bold text-titulo">{rotulo}</summary>
      <div className="mt-2">{children}</div>
    </details>
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
  tipo?: "text" | "date" | "textarea";
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
      ) : tipo === "textarea" ? (
        <textarea
          aria-label={rotulo}
          defaultValue={valor}
          disabled={desabilitado || pendente}
          onBlur={(e) => gravar(e.target.value.trim())}
          rows={2}
          className={`${cls} min-h-16`}
        />
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
