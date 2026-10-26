"use client";

import { useState } from "react";
import type { LinhaJson } from "@/lib/importacao-json";

const ACAO: Record<LinhaJson["acao"], [string, string]> = {
  nova: ["nova avaliação", "text-ok"],
  atualizar: ["atualizar", "text-atencao"],
  "sem mudança": ["sem mudança", "text-suave"],
  escolher: ["escolha o condomínio", "text-erro"],
  ignorada: ["ignorada", "text-suave"],
  erro: ["erro", "text-erro"],
};
const TIPO = { ADMINISTRADORA: "Administradora", SINDICANCIA: "Sindicância" };

type Resultado = { modo: "simular" | "importar"; linhas: LinhaJson[]; condominios: { id: string; nome: string }[]; temNotas: boolean };

/**
 * Importar o JSON do artefato "Checklist Avaliações BGRE": checklist, andamento, estimativa e, com "itens", as notas.
 * O nome que não casa com o cadastro mostra o candidato e um seletor (escolher um condomínio ou ignorar); a escolha
 * vale para todas as linhas com o mesmo nome e pede nova simulação.
 */
export function ImportarJson() {
  const [dados, setDados] = useState<unknown>(null);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [substituir, setSubstituir] = useState(false);
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [simulado, setSimulado] = useState(false);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(modo: "simular" | "importar", novasEscolhas = escolhas) {
    setEnviando(true);
    setErro("");
    try {
      const r = await fetch("/api/importar/json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modo, substituir, escolhas: novasEscolhas, dados }),
      });
      const corpo = await r.json().catch(() => ({ erro: "Resposta inválida do servidor." }));
      if (!r.ok) throw new Error(corpo.erro ?? "Falha no envio.");
      setResultado({ modo, ...corpo });
      setSimulado(modo === "simular");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha no envio.");
    } finally {
      setEnviando(false);
    }
  }

  async function escolherArquivo(f: File | undefined) {
    setResultado(null);
    setSimulado(false);
    setEscolhas({});
    setErro("");
    setDados(null);
    setNomeArquivo(f?.name ?? "");
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return setErro("JSON maior que 10 MB: divida em partes.");
    try {
      setDados(JSON.parse(await f.text()));
    } catch {
      setErro("O arquivo não é um JSON válido.");
    }
  }

  const escolher = (chave: string, valor: string) => {
    const novas = { ...escolhas, [chave]: valor };
    if (!valor) delete novas[chave];
    setEscolhas(novas);
    void enviar("simular", novas);
  };

  const linhas = resultado?.linhas ?? [];
  const conta = (a: LinhaJson["acao"]) => linhas.filter((l) => l.acao === a).length;
  const botao = "bg-marca px-3 py-1.5 text-[14px] font-bold text-marca-texto disabled:opacity-50";
  const nomesVistos = new Set<string>();

  return (
    <>
      <section className="grid gap-3 border border-borda bg-superficie p-3">
        <label className="grid gap-1 text-[13px] text-suave">
          Arquivo .json do checklist (até 10 MB)
          <input type="file" accept=".json,application/json" className="w-full min-w-0 text-[14px] text-texto" onChange={(e) => escolherArquivo(e.target.files?.[0])} />
        </label>
        <label className="flex items-center gap-2 text-[14px]">
          <input
            type="checkbox"
            className="size-4"
            checked={substituir}
            onChange={(e) => {
              setSubstituir(e.target.checked);
              setSimulado(false);
              setResultado(null);
            }}
          />
          Substituir as notas das avaliações que já têm notas
        </label>
        <div className="flex flex-wrap gap-2">
          <button className={botao} disabled={!dados || enviando} onClick={() => enviar("simular")}>
            Simular
          </button>
          <button className={botao} disabled={!simulado || enviando || !linhas.some((l) => l.acao === "nova" || l.acao === "atualizar")} onClick={() => enviar("importar")}>
            Importar
          </button>
          {enviando && <span className="self-center text-[13px] text-suave">Conferindo {nomeArquivo}…</span>}
        </div>
        {erro && (
          <p role="alert" className="text-[13px] text-erro">
            {erro}
          </p>
        )}
      </section>

      {resultado && (
        <section className="grid gap-2" aria-live="polite">
          <h2 className="text-lg font-bold">{resultado.modo === "simular" ? "Simulação: nada foi gravado" : "Resultado da importação"}</h2>
          <p className="text-[14px]">
            {linhas.length} avaliações: {conta("nova")} novas, {conta("atualizar")} {resultado.modo === "simular" ? "a atualizar" : "atualizadas"}, {conta("sem mudança")} sem mudança,{" "}
            {conta("escolher")} sem condomínio, {conta("ignorada")} ignoradas, {conta("erro")} com erro.
            {resultado.temNotas ? " O arquivo traz notas." : " O arquivo traz só checklist, andamento e estimativa."}
          </p>
          <ul className="grid gap-2">
            {linhas.map((l) => {
              const [texto, cor] = ACAO[l.acao];
              const primeiraDoNome = !l.condominioId && !nomesVistos.has(l.chave);
              if (!l.condominioId) nomesVistos.add(l.chave);
              return (
                <li key={l.indice} className="grid gap-1 border border-borda bg-superficie px-3 py-2.5 text-[14px] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)] md:gap-x-4">
                  <span className="min-w-0">
                    <b>{l.condominioNome ?? l.condominio}</b> · {l.periodo} · {TIPO[l.tipo]}
                    {l.condominioNome && l.condominioNome !== l.condominio && <span className="block text-[12.5px] text-suave">no arquivo: {l.condominio}</span>}
                  </span>
                  <span className="min-w-0">
                    <b className={cor}>{texto}</b>
                    {l.mudancas.length > 0 && <span className="block text-[12.5px] text-suave">{l.mudancas.join(", ")}</span>}
                    {l.erro && <span className="block text-[12.5px] text-erro">{l.erro}</span>}
                  </span>
                  <span className="grid min-w-0 gap-1">
                    {!l.condominioId && primeiraDoNome && (
                      <label className="grid gap-0.5 text-[12.5px] text-suave">
                        {l.candidato ? `Não achei “${l.condominio}”. Parecido: ${l.candidato.nome}.` : `Não achei “${l.condominio}”.`}
                        <select
                          value={escolhas[l.chave] ?? ""}
                          onChange={(e) => escolher(l.chave, e.target.value)}
                          disabled={enviando}
                          className="w-full min-w-0 border border-borda bg-superficie px-1.5 py-1 text-[14px] text-texto"
                        >
                          <option value="">Escolha…</option>
                          {l.candidato && <option value={l.candidato.id}>Usar {l.candidato.nome}</option>}
                          <option value="ignorar">Ignorar este nome</option>
                          {resultado.condominios
                            .filter((c) => c.id !== l.candidato?.id)
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.nome}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    {l.avisos.length > 0 && (
                      <ul className="list-disc pl-4 text-[12.5px] text-atencao">
                        {l.avisos.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
