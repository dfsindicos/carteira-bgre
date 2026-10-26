import Link from "next/link";
import { MODELOS, TIPOS, type Tipo } from "@/lib/scorecard";

/** Abas "Avaliação da Administradora" / "Avaliação da Sindicância", como no artefato (ativa sublinhada em dourado). */
export function AbasTipo({ tipo, href }: { tipo: Tipo; href: (t: Tipo) => string }) {
  return (
    <nav aria-label="Tipo de avaliação" className="flex gap-1 overflow-x-auto border-b border-borda">
      {TIPOS.map((t) => (
        <Link
          key={t}
          href={href(t)}
          aria-current={t === tipo ? "page" : undefined}
          className={`shrink-0 border-b-[3px] px-3 py-2 text-[14px] whitespace-nowrap ${t === tipo ? "border-ouro font-bold" : "border-transparent text-suave hover:text-texto"}`}
        >
          <span className="max-sm:hidden">Avaliação da </span>
          {MODELOS[t].nome.replace("Avaliação da ", "")}
        </Link>
      ))}
    </nav>
  );
}
