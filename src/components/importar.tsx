"use client";

import { useState } from "react";
import type { Linha } from "@/lib/importacao";
import { formatarNota } from "@/lib/scorecard";

const ACAO: Record<Linha["acao"], [string, string]> = {
  nova: ["nova avaliação", "text-ok"],
  pular: ["já existe: será pulada", "text-suave"],
  substituir: ["já existe: será substituída", "text-atencao"],
  erro: ["erro", "text-erro"],
};

function Novo({ nome, novo, a }: { nome?: string; novo?: boolean; a?: boolean }) {
  if (!nome) return <span className="text-suave">—</span>;
  return (
    <span>
      {nome} {novo && <span className="rounded-sm bg-ouro-suave px-1.5 text-[11px] font-bold text-titulo">{a ? "nova" : "novo"}</span>}
    </span>
  );
}

function Acao({ l }: { l: Linha }) {
  const [texto, cor] = ACAO[l.acao];
  return (
    <span className={`font-bold ${cor}`}>
      {l.resultado ?? texto}
      {l.erro && <span className="block font-normal">{l.erro}</span>}
    </span>
  );
}

const Avisos = ({ l }: { l: Linha }) =>
  l.avisos.length ? (
    <ul className="list-disc pl-4 text-[12.5px] text-atencao">
      {l.avisos.map((a) => (
        <li key={a}>{a}</li>
      ))}
    </ul>
  ) : null;

/** Escolher arquivos, simular, conferir e importar os mesmos arquivos. */
export function Importar() {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [substituir, setSubstituir] = useState(false);
  const [simulado, setSimulado] = useState(false);
  const [resultado, setResultado] = useState<{ modo: "simular" | "importar"; linhas: Linha[] } | null>(null);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(modo: "simular" | "importar") {
    const form = new FormData();
    form.set("modo", modo);
    if (substituir) form.set("substituir", "on");
    arquivos.forEach((f) => form.append("arquivos", f));
    setEnviando(true);
    setErro("");
    try {
      const r = await fetch("/api/importar", { method: "POST", body: form });
      const corpo = await r.json().catch(() => ({ erro: "Resposta inválida do servidor." }));
      if (!r.ok) throw new Error(corpo.erro ?? "Falha no envio.");
      setResultado({ modo, linhas: corpo.linhas });
      setSimulado(modo === "simular");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha no envio.");
    } finally {
      setEnviando(false);
    }
  }
  const mudou = () => {
    setSimulado(false);
    setResultado(null);
  };

  const linhas = resultado?.linhas ?? [];
  const conta = (f: (l: Linha) => boolean) => linhas.filter(f).length;
  const resumo =
    resultado?.modo === "importar"
      ? `${linhas.length} planilhas: ${conta((l) => l.resultado === "importada")} importadas, ${conta((l) => l.resultado === "substituída")} substituídas, ${conta((l) => l.resultado === "pulada" || l.resultado === "sem mudança")} sem mudança, ${conta((l) => l.acao === "erro")} com erro.`
      : `${linhas.length} planilhas: ${conta((l) => l.acao === "nova")} novas, ${conta((l) => l.acao === "substituir")} a substituir, ${conta((l) => l.acao === "pular")} a pular, ${conta((l) => l.acao === "erro")} com erro.`;
  const botao = "bg-marca px-3 py-1.5 text-[14px] font-bold text-marca-texto disabled:opacity-50";

  return (
    <>
      <section className="grid gap-3 border border-borda bg-superficie p-3">
        <label className="grid gap-1 text-[13px] text-suave">
          Planilhas (.xlsx) ou um .zip — até 200 planilhas, 5 MB cada, .zip até 60 MB
          <input
            type="file"
            multiple
            accept=".xlsx,.zip"
            className="w-full min-w-0 text-[14px] text-texto"
            onChange={(e) => {
              setArquivos([...(e.target.files ?? [])]);
              mudou();
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-[14px]">
          <input
            type="checkbox"
            className="size-4"
            checked={substituir}
            onChange={(e) => {
              setSubstituir(e.target.checked);
              mudou();
            }}
          />
          Substituir as avaliações que já existem
        </label>
        <div className="flex flex-wrap gap-2">
          <button className={botao} disabled={!arquivos.length || enviando} onClick={() => enviar("simular")}>
            Simular
          </button>
          <button className={botao} disabled={!simulado || enviando || !linhas.some((l) => l.acao === "nova" || l.acao === "substituir")} onClick={() => enviar("importar")}>
            Importar
          </button>
          {enviando && <span className="self-center text-[13px] text-suave">Lendo as planilhas…</span>}
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
          <p className="text-[14px]">{resumo}</p>

          <ul className="grid gap-2 md:hidden">
            {linhas.map((l, i) => (
              <li key={i} className="grid gap-1 border border-borda bg-superficie px-3 py-2.5 text-[14px]">
                <b className="break-all">{l.arquivo}</b>
                <span>
                  <Novo nome={l.predio} novo={l.predioNovo} /> · <Novo nome={l.administradora ?? (l.tipo === "SINDICANCIA" ? "DF Síndicos" : undefined)} novo={l.administradoraNova} a /> · {l.periodo ?? "—"}
                </span>
                <span className="tabular-nums">
                  {l.tipo === "SINDICANCIA" ? "Sindicância · " : ""}{l.lidas} de {l.total} notas · planilha {formatarNota(l.finalPlanilha)} · sistema {formatarNota(l.finalCalculada)}
                </span>
                <Acao l={l} />
                <Avisos l={l} />
              </li>
            ))}
          </ul>

          <table className="hidden w-full border-collapse border border-borda bg-superficie text-[13.5px] md:table">
            <thead className="bg-marca text-left text-marca-texto">
              <tr>
                {["Arquivo", "Prédio", "Contratada", "Trimestre", "Notas", "Final (planilha · sistema)", "O que acontece", "Avisos"].map((t) => (
                  <th key={t} className="px-2 py-1.5 font-bold">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i} className="border-t border-borda align-top">
                  <td className="max-w-56 px-2 py-1.5 break-all">{l.arquivo}</td>
                  <td className="px-2 py-1.5">
                    <Novo nome={l.predio} novo={l.predioNovo} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Novo nome={l.administradora ?? (l.tipo === "SINDICANCIA" ? "DF Síndicos" : undefined)} novo={l.administradoraNova} a />
                  </td>
                  <td className="px-2 py-1.5">{l.periodo ?? "—"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">
                    {l.lidas} de {l.total}
                    {l.tipo === "SINDICANCIA" && <span className="block text-[12px] text-suave">Sindicância</span>}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">
                    {formatarNota(l.finalPlanilha)} · {formatarNota(l.finalCalculada)}
                  </td>
                  <td className="px-2 py-1.5">
                    <Acao l={l} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Avisos l={l} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
