import Link from "next/link";
import { acaoCriarAvaliacao } from "@/app/acoes";
import { Ponto, Situacao } from "@/components/classificacao";
import { listarTrimestre } from "@/lib/avaliacoes";
import { formatarNota, formatarPeriodo, lerPeriodo, mesesDoPeriodo, periodoAnterior, periodoEmAvaliacao, periodoSeguinte } from "@/lib/scorecard";

export default async function AvaliacaoTrimestral({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const periodo = lerPeriodo((await searchParams).periodo) ?? periodoEmAvaliacao();
  const p = formatarPeriodo(periodo);
  const lista = await listarTrimestre(periodo);
  const seta = "inline-flex size-9 items-center justify-center border border-borda bg-superficie text-lg hover:border-ouro";
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Avaliação trimestral</h1>
        <nav aria-label="Trimestre" className="flex items-center gap-2">
          <Link href={`/avaliacao?periodo=${formatarPeriodo(periodoAnterior(periodo))}`} className={seta} aria-label="Trimestre anterior">
            ‹
          </Link>
          <span className="min-w-28 text-center">
            <b className="text-lg">{p}</b> <span className="text-[13px] text-suave">{mesesDoPeriodo(periodo)}</span>
          </span>
          <Link href={`/avaliacao?periodo=${formatarPeriodo(periodoSeguinte(periodo))}`} className={seta} aria-label="Trimestre seguinte">
            ›
          </Link>
        </nav>
      </div>

      <ul className="grid gap-2">
        {lista.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border border-borda bg-superficie px-3 py-2.5">
            <div className="min-w-0 flex-1 basis-56">
              <b className="block">
                {c.nome}
                {!c.ativo && <span className="ml-2 text-[12px] font-normal text-suave">(inativo)</span>}
              </b>
              <span className="text-[13px] text-suave">{c.administradora}</span>
            </div>
            <Situacao status={c.status} />
            <span className="min-w-36 text-[14px] tabular-nums">
              {!c.resultado ? (
                <span className="text-suave">—</span>
              ) : c.resultado.final === null ? (
                <span className="text-suave">faltam {c.resultado.faltam} notas</span>
              ) : (
                <span className="inline-flex gap-2">
                  {formatarNota(c.resultado.final)} <Ponto c={c.resultado.classificacao} />
                </span>
              )}
            </span>
            {c.status ? (
              <Link href={`/avaliacao/${c.id}/${p}`} className="bg-marca px-3 py-1.5 text-[13px] font-bold text-marca-texto">
                Abrir
              </Link>
            ) : (
              <form action={acaoCriarAvaliacao}>
                <input type="hidden" name="condominioId" value={c.id} />
                <input type="hidden" name="periodo" value={p} />
                <button className="border border-marca px-3 py-1.5 text-[13px] font-bold text-titulo">Criar avaliação</button>
              </form>
            )}
          </li>
        ))}
        {!lista.length && <li className="text-suave">Nenhum condomínio ativo. Cadastre em <Link href="/cadastro" className="text-info underline">Cadastro</Link>.</li>}
      </ul>
    </>
  );
}
