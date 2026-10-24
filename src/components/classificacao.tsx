import { corDaClassificacao, type Classificacao } from "@/lib/scorecard";

const COR = { ok: "text-ok", atencao: "text-atencao", erro: "text-erro" };

/** Classificação com ponto colorido (verde, âmbar, vermelho) e o texto sempre por escrito. */
export function Ponto({ c }: { c: Classificacao | null }) {
  if (!c) return <span className="text-suave">—</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${COR[corDaClassificacao(c)]}`}>
      <span aria-hidden="true" className="size-2.5 rounded-full bg-current" />
      {c}
    </span>
  );
}

const ETIQUETA = {
  RASCUNHO: ["Rascunho", "bg-atencao-suave text-atencao"],
  ENTREGUE: ["Entregue", "bg-ok-suave text-ok"],
  NENHUMA: ["Sem avaliação", "bg-superficie-2 text-suave border border-borda"],
} as const;

export function Situacao({ status }: { status: "RASCUNHO" | "ENTREGUE" | null }) {
  const [texto, cls] = ETIQUETA[status ?? "NENHUMA"];
  return <span className={`inline-block rounded-sm px-2 py-px text-xs font-bold whitespace-nowrap ${cls}`}>{texto}</span>;
}
