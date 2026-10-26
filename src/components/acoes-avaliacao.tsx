"use client";

import { useState, useTransition } from "react";
import { acaoPassos, acaoPrazo } from "@/app/acoes";
import type { NumeroPasso, Resposta } from "@/lib/avaliacoes";
import type { Passo } from "@/lib/scorecard";

/** "Marcar como entregue" / "Reabrir" = marcar ou desmarcar o passo 4, com a mensagem de erro do servidor (ex.: faltam notas). */
export function BotaoStatus({ avaliacaoId, entregue }: { avaliacaoId: string; entregue: boolean }) {
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const clicar = () =>
    iniciar(async () => {
      if (entregue && !confirm("Reabrir a avaliação para edição?")) return;
      const r: Resposta = await acaoPassos(avaliacaoId, [4], !entregue);
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

/**
 * Checklist do trimestre: 4 passos, cada um com a data e quem marcou. Clicar marca ou desmarca; "Marcar tudo como
 * feito", "Limpar" e "Copiar checklist" (texto para colar no e-mail ou no WhatsApp).
 */
export function Checklist({
  avaliacaoId,
  titulo,
  passos,
  marcas,
}: {
  avaliacaoId: string;
  /** "Avaliação da Sindicância — Torre — 3T26", primeira linha do texto copiado. */
  titulo: string;
  passos: Passo[];
  marcas: ({ em: string; por: string | null } | null)[];
}) {
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  const feitos = marcas.filter(Boolean).length;
  const mudar = (numeros: NumeroPasso[], marcado: boolean) =>
    iniciar(async () => {
      if (!marcado && numeros.includes(4) && marcas[3] && !confirm("Desmarcar “Enviada à BGRE” libera a edição das notas. Continuar?")) return;
      const r = await acaoPassos(avaliacaoId, numeros, marcado);
      setMsg(r.ok ? null : { ok: false, texto: r.erro });
    });
  const copiar = async () => {
    const texto = [titulo, ...passos.map((p, i) => `${marcas[i] ? "[x]" : "[ ]"} ${p.titulo}${marcas[i] ? ` (${marcas[i]!.em})` : ""}`)].join("\n");
    try {
      await navigator.clipboard.writeText(texto);
      setMsg({ ok: true, texto: "Checklist copiado." });
    } catch {
      setMsg({ ok: false, texto: "Não consegui copiar: o navegador bloqueou a área de transferência." });
    }
  };
  const botao = "px-3 py-1.5 text-[13px] font-bold disabled:opacity-60";
  return (
    <section className="grid gap-2" aria-labelledby="titulo-checklist">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="titulo-checklist" className="text-lg font-bold">
          Checklist do trimestre
        </h2>
        <span className="text-[13px] text-suave">
          {feitos} de {passos.length} passos
        </span>
      </div>
      <ul className="grid gap-2">
        {passos.map((p, i) => {
          const m = marcas[i];
          return (
            <li key={p.titulo}>
              <button
                role="checkbox"
                aria-checked={!!m}
                disabled={pendente}
                onClick={() => mudar([(i + 1) as NumeroPasso], !m)}
                className={`grid w-full grid-cols-[1.5rem_1fr] gap-x-3 gap-y-1 border border-l-4 bg-superficie px-3 py-2.5 text-left hover:border-marca disabled:opacity-70 sm:grid-cols-[1.5rem_1fr_auto] ${m ? "border-borda border-l-ok" : "border-borda border-l-borda border-dashed"}`}
              >
                <span aria-hidden="true" className={`mt-0.5 grid size-5 place-items-center border text-[13px] font-bold ${m ? "border-marca bg-marca text-marca-texto" : "border-suave"}`}>
                  {m ? "✓" : ""}
                </span>
                <span className="min-w-0">
                  <b className={`block text-[15px] ${m ? "text-suave line-through" : ""}`}>
                    {i + 1}. {p.titulo}
                  </b>
                  <span className="block text-[13px] text-suave">{p.descricao}</span>
                </span>
                {m && (
                  <span className="col-start-2 self-center text-[12px] text-suave sm:col-start-3">
                    feito em {m.em}
                    {m.por && <span className="block max-w-56 truncate">por {m.por}</span>}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={pendente} onClick={() => mudar([1, 2, 3, 4], true)} className={`${botao} bg-marca text-marca-texto`}>
          Marcar tudo como feito
        </button>
        <button disabled={pendente} onClick={() => mudar([1, 2, 3, 4], false)} className={`${botao} border border-borda text-suave`}>
          Limpar
        </button>
        <button onClick={copiar} className={`${botao} border border-marca text-titulo`}>
          Copiar checklist
        </button>
        {msg && (
          <span role={msg.ok ? "status" : "alert"} className={`text-[12.5px] ${msg.ok ? "text-ok" : "text-erro"}`}>
            {msg.texto}
          </span>
        )}
      </div>
    </section>
  );
}
