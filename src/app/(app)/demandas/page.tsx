import Link from "next/link";
import { AbasDemandas, Etiqueta, PontoSituacao, botao, botaoPrimario, eyebrow } from "@/components/demandas";
import { FiltroSelect } from "@/components/demandas-cliente";
import { INDICADORES, ROTULO_AGUARDANDO, ROTULO_SITUACAO, VISOES, listarDemandas, type Filtros, type Indicador, type Visao } from "@/lib/demandas";
import { ROTULO_CRITICIDADE, diaHora, estaAberta } from "@/lib/prazos-demandas";

const COR_INDICADOR: Record<Indicador, string> = { abertas: "border-t-marca", sem: "border-t-erro", vencidas: "border-t-erro", semana: "border-t-atencao", noprazo: "border-t-ok" };

/** Demandas da BGRE: indicadores, filtros e a tabela; cada linha abre a demanda. */
export default async function Demandas({ searchParams }: { searchParams: Promise<Filtros> }) {
  const f = await searchParams;
  const r = await listarDemandas(f);
  const url = (mudar: Partial<Filtros>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ vis: r.vis === "abertas" ? undefined : r.vis, cond: f.cond, resp: f.resp, kpi: r.kpi ?? undefined, ...mudar })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/demandas?${s}` : "/demandas";
  };
  const exportar = url({}).replace("/demandas", "/demandas/exportar");
  const titulo = r.vis === "abertas" ? "Demandas em aberto" : `Demandas · ${VISOES[r.vis].toLowerCase()}`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid max-w-3xl gap-1">
          <span className={eyebrow}>Carteira BGRE · Demandas recebidas da BGRE</span>
          <h1 className="text-2xl leading-tight font-bold">{titulo}</h1>
          <p className="text-[13px] text-suave">
            Cada e-mail da BGRE que pede algo à DF vira uma demanda, aberta pela Triagem Contratante com o horário de envio do e-mail (três caixas da
            equipe da DF). Resposta na mesma conversa entra como atualização, não como demanda nova.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/demandas/nova" className={botao}>
            Registrar demanda (telefone, reunião)
          </Link>
          <a href={exportar} className={botaoPrimario}>
            Exportar Excel
          </a>
        </div>
      </div>

      <AbasDemandas atual="lista" />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {(Object.keys(INDICADORES) as Indicador[]).map((k) => {
          const ativo = r.kpi === k;
          return (
            <Link
              key={k}
              href={ativo ? url({ kpi: undefined }) : url({ kpi: k, vis: k === "noprazo" ? "concluidas" : undefined })}
              aria-pressed={ativo}
              className={`grid gap-0.5 border border-t-[3px] border-borda bg-superficie px-3 py-2.5 ${COR_INDICADOR[k]} ${ativo ? "ring-2 ring-ouro ring-inset" : "hover:border-ouro"}`}
            >
              <b className="text-[28px] leading-none text-titulo tabular-nums">{r.indicadores[k]}</b>
              <span className="text-[12.5px] text-suave">
                {INDICADORES[k]}
                {k === "noprazo" && r.concluidas30 ? ` · de ${r.concluidas30}` : ""}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <div role="group" aria-label="Situação" className="flex flex-wrap border border-borda bg-superficie">
          {(Object.keys(VISOES) as Visao[]).map((v) => (
            <Link
              key={v}
              href={url({ vis: v === "abertas" ? undefined : v, kpi: undefined })}
              aria-current={r.vis === v ? "true" : undefined}
              className={`border-borda px-3 py-1.5 text-[13px] not-first:border-l ${r.vis === v ? "bg-marca font-bold text-marca-texto" : "text-texto hover:bg-superficie-2"}`}
            >
              {VISOES[v]}
            </Link>
          ))}
        </div>
        <FiltroSelect nome="cond" rotulo="Condomínio" opcoes={[...r.condominios, ["sem", "Sem condomínio"]]} />
        <FiltroSelect nome="resp" rotulo="Responsável" opcoes={[...r.responsaveis.map((x): [string, string] => [x, x]), ["sem", "Sem responsável"]]} />
        <span className="text-[12px] text-suave">
          {r.linhas.length} {r.linhas.length === 1 ? "demanda" : "demandas"}
          {r.kpi && (
            <>
              {" "}
              · {INDICADORES[r.kpi].toLowerCase()} ·{" "}
              <Link href={url({ kpi: undefined })} className="underline">
                tirar filtro
              </Link>
            </>
          )}
        </span>
      </div>

      <div className="overflow-x-auto border border-borda bg-superficie">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="bg-marca text-left text-[12.5px] text-marca-texto">
              <th className="px-2.5 py-2">Nº</th>
              <th className="px-2.5 py-2">Demanda</th>
              <th className="px-2.5 py-2 max-md:hidden">Condomínio</th>
              <th className="px-2.5 py-2 max-md:hidden">Chegou</th>
              <th className="px-2.5 py-2 max-sm:hidden">1ª resposta</th>
              <th className="px-2.5 py-2 max-sm:hidden">Prazo</th>
              <th className="px-2.5 py-2 max-sm:hidden">Situação</th>
            </tr>
          </thead>
          <tbody>
            {r.linhas.map((d) => (
              <tr key={d.id} className="border-t border-borda align-top hover:bg-superficie-2">
                <td className="px-2.5 py-2 tabular-nums">{d.numero}</td>
                <td className="min-w-40 px-2.5 py-2">
                  <Link href={`/demandas/${d.id}`} className="font-bold hover:underline">
                    {d.titulo}
                  </Link>
                  <span className="block text-[12px] text-suave">
                    {d.remetenteNome || d.remetenteEmail || "—"} · <b>{ROTULO_CRITICIDADE[d.criticidade]}</b> ·{" "}
                    {d.responsavel ? d.responsavel : <b>sem responsável</b>}
                  </span>
                  <span className="block text-[12px] text-suave md:hidden">
                    {d.condominio?.nome ?? "sem condomínio"} · chegou {diaHora(d.chegadaEm)}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] sm:hidden">
                    <Etiqueta e={d.resposta} />
                    <Etiqueta e={d.prazo} />
                    <PontoSituacao situacao={d.situacao} rotulo={ROTULO_SITUACAO[d.situacao]} />
                  </span>
                </td>
                <td className="px-2.5 py-2 max-md:hidden">{d.condominio?.nome ?? <span className="text-suave">—</span>}</td>
                <td className="px-2.5 py-2 whitespace-nowrap tabular-nums max-md:hidden">{diaHora(d.chegadaEm)}</td>
                <td className="px-2.5 py-2 max-sm:hidden">
                  <Etiqueta e={d.resposta} />
                </td>
                <td className="px-2.5 py-2 max-sm:hidden">
                  <Etiqueta e={d.prazo} />
                </td>
                <td className="px-2.5 py-2 max-sm:hidden">
                  <PontoSituacao situacao={d.situacao} rotulo={ROTULO_SITUACAO[d.situacao]} />
                  {d.aguardando && estaAberta(d) && <span className="block text-[12px] text-suave">aguardando {ROTULO_AGUARDANDO[d.aguardando]}</span>}
                </td>
              </tr>
            ))}
            {!r.linhas.length && (
              <tr>
                <td colSpan={7} className="px-2.5 py-7 text-center text-suave">
                  Nenhuma demanda neste filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-suave">
        O relógio começa no envio do e-mail da BGRE, nunca no horário do registro. A 1ª resposta é reconhecida sozinha quando alguém da DF responde na
        mesma conversa; quem respondeu por telefone marca à mão na demanda. Nada se apaga: o que não era demanda é arquivado com motivo.
      </p>
    </>
  );
}
