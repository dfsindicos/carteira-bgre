import Link from "next/link";
import { acaoCriarAvaliacao } from "@/app/acoes";
import { AbasTipo } from "@/components/abas-tipo";
import { Ponto, Situacao } from "@/components/classificacao";
import { MapaAvaliacoes } from "@/components/mapa-avaliacoes";
import { listarTrimestre } from "@/lib/avaliacoes";
import { mapa } from "@/lib/mapa";
import { formatarNota, formatarPeriodo, lerPeriodo, lerTipo, mesesDoPeriodo, periodoAnterior, periodoEmAvaliacao, periodoSeguinte } from "@/lib/scorecard";

/** Avaliação trimestral: o mapa condomínio × trimestre (padrão) ou, com ?periodo=3T26, a lista daquele trimestre. */
export default async function AvaliacaoTrimestral({ searchParams }: { searchParams: Promise<{ periodo?: string; tipo?: string }> }) {
  const busca = await searchParams;
  const tipo = lerTipo(busca.tipo);
  const lerLista = lerPeriodo(busca.periodo);
  const periodo = lerLista ?? periodoEmAvaliacao();
  const p = formatarPeriodo(periodo);
  const visao = "border border-marca px-3 py-1.5 text-[13px] font-bold text-titulo";

  if (!lerLista) {
    const m = await mapa(tipo);
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Avaliação trimestral</h1>
          <Link href={`/avaliacao?periodo=${p}&tipo=${tipo}`} className={visao}>
            Lista do {p}
          </Link>
        </div>
        <AbasTipo tipo={tipo} href={(t) => `/avaliacao?tipo=${t}`} />
        <MapaAvaliacoes m={m} tipo={tipo} />
      </>
    );
  }

  const lista = await listarTrimestre(periodo, tipo);
  const seta = "inline-flex size-9 items-center justify-center border border-borda bg-superficie text-lg hover:border-ouro";
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Avaliação trimestral</h1>
        <nav aria-label="Trimestre" className="flex items-center gap-2">
          <Link href={`/avaliacao?periodo=${formatarPeriodo(periodoAnterior(periodo))}&tipo=${tipo}`} className={seta} aria-label="Trimestre anterior">
            ‹
          </Link>
          <span className="min-w-28 text-center">
            <b className="text-lg">{p}</b> <span className="text-[13px] text-suave">{mesesDoPeriodo(periodo)}</span>
          </span>
          <Link href={`/avaliacao?periodo=${formatarPeriodo(periodoSeguinte(periodo))}&tipo=${tipo}`} className={seta} aria-label="Trimestre seguinte">
            ›
          </Link>
          <Link href={`/avaliacao?tipo=${tipo}`} className={visao}>
            Mapa
          </Link>
        </nav>
      </div>
      <AbasTipo tipo={tipo} href={(t) => `/avaliacao?periodo=${p}&tipo=${t}`} />

      <ul className="grid gap-2">
        {lista.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border border-borda bg-superficie px-3 py-2.5">
            <div className="min-w-0 flex-1 basis-56">
              <b className="block">
                {c.nome}
                {!c.ativo && <span className="ml-2 text-[12px] font-normal text-suave">(inativo)</span>}
              </b>
              <span className="text-[13px] text-suave">{tipo === "SINDICANCIA" ? "DF Síndicos" : c.administradora}</span>
            </div>
            <Situacao status={c.status} />
            {c.status && <span className="text-[12.5px] text-suave tabular-nums">{c.feitos}/4 passos</span>}
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
              <Link href={`/avaliacao/${c.id}/${p}?tipo=${tipo}`} className="bg-marca px-3 py-1.5 text-[13px] font-bold text-marca-texto">
                Abrir
              </Link>
            ) : (
              <form action={acaoCriarAvaliacao}>
                <input type="hidden" name="condominioId" value={c.id} />
                <input type="hidden" name="periodo" value={p} />
                <input type="hidden" name="tipo" value={tipo} />
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
