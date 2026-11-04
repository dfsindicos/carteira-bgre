import Link from "next/link";
import type { Etiqueta as TipoEtiqueta, Tom } from "@/lib/prazos-demandas";

// Peças das telas de Demandas que não precisam de JavaScript no navegador (as interativas ficam em demandas-cliente.tsx).

const TOM: Record<Tom, string> = {
  erro: "bg-erro-suave text-erro",
  atencao: "bg-atencao-suave text-atencao",
  ok: "bg-ok-suave text-ok",
  info: "bg-info-suave text-info",
  neutro: "bg-marca-suave text-titulo",
};
const SIMBOLO: Partial<Record<Tom, string>> = { erro: "▲", atencao: "●", ok: "✓" };

/** Etiqueta de prazo: cor e texto sempre juntos (padrão DF), com o símbolo do protótipo. */
export function Etiqueta({ e }: { e: TipoEtiqueta }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-[10px] px-2 py-px text-[11.5px] font-bold sm:whitespace-nowrap ${TOM[e.tom]}`}>
      {SIMBOLO[e.tom] && <span aria-hidden="true">{SIMBOLO[e.tom]}</span>}
      {e.texto}
    </span>
  );
}

export const COR_SITUACAO: Record<string, string> = {
  ABERTA: "bg-erro",
  EM_ANDAMENTO: "bg-atencao",
  AGUARDANDO: "bg-info",
  REUNIAO: "bg-ouro",
  CONCLUIDA: "bg-ok",
  ARQUIVADA: "bg-suave",
};

/** Ponto colorido da situação, com o texto. */
export function PontoSituacao({ situacao, rotulo }: { situacao: string; rotulo: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden="true" className={`size-2 rounded-full ${COR_SITUACAO[situacao] ?? "bg-suave"}`} />
      {rotulo}
    </span>
  );
}

/** Abas "Demandas" / "Configuração de SLA" (ativa sublinhada em dourado). */
export function AbasDemandas({ atual }: { atual: "lista" | "sla" }) {
  const abas = [
    ["lista", "/demandas", "Demandas"],
    ["sla", "/demandas/sla", "Configuração de SLA"],
  ] as const;
  return (
    <nav aria-label="Seções de Demandas" className="flex gap-1 overflow-x-auto border-b border-borda">
      {abas.map(([id, href, rotulo]) => (
        <Link
          key={id}
          href={href}
          aria-current={id === atual ? "page" : undefined}
          className={`shrink-0 border-b-[3px] px-3 py-2 text-[14px] whitespace-nowrap ${id === atual ? "border-ouro font-bold" : "border-transparent text-suave hover:text-texto"}`}
        >
          {rotulo}
        </Link>
      ))}
    </nav>
  );
}

export const eyebrow = "text-[11px] font-bold tracking-[0.12em] text-ouro uppercase";
export const botao = "inline-flex min-h-9 items-center border border-marca px-3 py-1.5 text-[13px] font-bold text-titulo hover:bg-marca-suave";
export const botaoPrimario = "inline-flex min-h-9 items-center bg-marca px-3 py-1.5 text-[13px] font-bold text-marca-texto";
export const campo = "w-full border border-borda bg-superficie px-2 py-1.5 text-[14px] text-texto";
export const rotulo = "grid min-w-0 gap-0.5 text-[12px] text-suave";
