"use client";

import { useState } from "react";
import type { ResultadoFlash } from "@/lib/flash";

/** Importar o histórico do Flash Report (o DATA do artefato antigo, em .json): simula, mostra os prédios e as semanas, importa. */
export function ImportarFlash() {
  const [dados, setDados] = useState<unknown>(null);
  const [resultado, setResultado] = useState<(ResultadoFlash & { modo: string }) | null>(null);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function escolherArquivo(f: File | undefined) {
    setResultado(null);
    setErro("");
    setDados(null);
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return setErro("JSON maior que 10 MB.");
    try {
      setDados(JSON.parse(await f.text()));
    } catch {
      setErro("O arquivo não é um JSON válido.");
    }
  }

  async function enviar(modo: "simular" | "importar") {
    setEnviando(true);
    setErro("");
    try {
      const r = await fetch("/api/importar/flash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modo, dados }) });
      const corpo = await r.json().catch(() => ({ erro: "Resposta inválida do servidor." }));
      if (!r.ok) throw new Error(corpo.erro ?? "Falha no envio.");
      setResultado({ modo, ...corpo });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha no envio.");
    } finally {
      setEnviando(false);
    }
  }

  const botao = "bg-marca px-3 py-1.5 text-[14px] font-bold text-marca-texto disabled:opacity-50";
  const simulou = resultado?.modo === "simular";
  return (
    <>
      <section className="grid gap-3 border border-borda bg-superficie p-3">
        <label className="grid gap-1 text-[13px] text-suave">
          Arquivo .json do Flash Report (até 10 MB)
          <input
            type="file"
            accept=".json,application/json"
            className="w-full min-w-0 text-[14px] text-texto"
            onChange={(e) => escolherArquivo(e.target.files?.[0])}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button className={botao} disabled={!dados || enviando} onClick={() => enviar("simular")}>
            Simular
          </button>
          <button className={botao} disabled={!simulou || enviando} onClick={() => enviar("importar")}>
            Importar
          </button>
        </div>
        {erro && (
          <p role="alert" className="text-[13px] text-erro">
            {erro}
          </p>
        )}
      </section>
      {resultado && (
        <section className="grid gap-2" aria-live="polite">
          <h2 className="text-lg font-bold">{simulou ? "Simulação: nada foi gravado" : "Resultado da importação"}</h2>
          <p className="text-[14px]">
            Semanas: {resultado.semanas.novas} novas, {resultado.semanas.atualizadas} {simulou ? "a atualizar" : "atualizadas"}, {resultado.semanas.iguais} sem
            mudança.
            {!simulou && (
              <>
                {" "}
                <a href="/flash" className="font-bold underline">
                  Abrir o Flash Report
                </a>
              </>
            )}
          </p>
          <ul className="grid gap-1 text-[14px]">
            {resultado.predios.map((p) => (
              <li key={p.slug} className="border border-borda bg-superficie px-3 py-2">
                <b>{p.nome}</b> → {p.novo ? <span className="text-ok">{simulou ? "será cadastrado" : "cadastrado"}</span> : <>cadastro “{p.cadastro}”</>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
