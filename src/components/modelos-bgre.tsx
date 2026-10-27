"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Modelo = { tipo: "ADMINISTRADORA" | "SINDICANCIA"; nome: string; enviadoEm: string; enviadoPor: string };
const ROTULO = { ADMINISTRADORA: "Administradora", SINDICANCIA: "Sindicância" };

/** Envio do modelo oficial da planilha da BGRE, um por tipo. O servidor recusa o arquivo em que não acha os itens. */
export function ModelosBgre({ modelos }: { modelos: Modelo[] }) {
  const router = useRouter();
  const [estado, setEstado] = useState<Record<string, { erro?: string; ok?: string; enviando?: boolean }>>({});

  async function enviar(tipo: Modelo["tipo"], arquivo: File | undefined) {
    if (!arquivo) return;
    setEstado((e) => ({ ...e, [tipo]: { enviando: true } }));
    const form = new FormData();
    form.set("tipo", tipo);
    form.set("arquivo", arquivo);
    const r = await fetch("/api/modelos", { method: "POST", body: form }).catch(() => null);
    const corpo = r ? await r.json().catch(() => ({})) : {};
    setEstado((e) => ({ ...e, [tipo]: r?.ok ? { ok: `Modelo “${arquivo.name}” guardado.` } : { erro: corpo.erro ?? "Falha no envio." } }));
    if (r?.ok) router.refresh();
  }

  return (
    <ul className="grid gap-2">
      {(["ADMINISTRADORA", "SINDICANCIA"] as const).map((tipo) => {
        const m = modelos.find((x) => x.tipo === tipo);
        const e = estado[tipo] ?? {};
        return (
          <li key={tipo} className="grid gap-1.5 border border-borda bg-superficie px-3 py-2.5 text-[14px]">
            <b>{ROTULO[tipo]}</b>
            <span className="text-[13px] text-suave">
              {m
                ? `Em uso: ${m.nome} · enviado em ${new Date(m.enviadoEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} por ${m.enviadoPor}`
                : "Sem modelo: a planilha sai no formato da DF."}
            </span>
            <label className="grid gap-1 text-[13px] text-suave">
              {m ? "Trocar o modelo (.xlsx)" : "Enviar o modelo (.xlsx)"}
              <input
                type="file"
                accept=".xlsx"
                disabled={e.enviando}
                onChange={(ev) => enviar(tipo, ev.target.files?.[0])}
                className="w-full min-w-0 text-[14px] text-texto"
              />
            </label>
            {e.enviando && <span className="text-[13px] text-suave">Conferindo o modelo…</span>}
            {e.erro && (
              <p role="alert" className="text-[13px] text-erro">
                {e.erro}
              </p>
            )}
            {e.ok && <p className="text-[13px] text-ok">{e.ok}</p>}
          </li>
        );
      })}
    </ul>
  );
}
