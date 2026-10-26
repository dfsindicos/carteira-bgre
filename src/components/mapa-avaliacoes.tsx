import Link from "next/link";
import { type Celula, type Situacao, mapa } from "@/lib/mapa";
import { faixaMapa, formatarPeriodo, type Tipo } from "@/lib/scorecard";

// Mapa condomínio × trimestre, indicadores e os dois gráficos (CSS puro), como a visão "Todos" do artefato.

type Mapa = Awaited<ReturnType<typeof mapa>>;
const FAIXA = {
  ok: { cheia: "bg-ok text-white border-ok", clara: "bg-ok-suave text-ok border-ok", barra: "bg-ok" },
  atencao: { cheia: "bg-atencao text-white border-atencao", clara: "bg-atencao-suave text-atencao border-atencao", barra: "bg-atencao" },
  erro: { cheia: "bg-erro text-white border-erro", clara: "bg-erro-suave text-erro border-erro", barra: "bg-erro" },
};
const fmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ROTULO: Record<Situacao, string> = { fora: "fora do período", concluida: "concluída", andamento: "em andamento", "sem-planilha": "sem planilha", "a-fazer": "a fazer" };

function ConteudoCelula({ c }: { c: Celula }) {
  if (c.nota !== null)
    return (
      <>
        <span>{fmt(c.nota)}</span>
        {c.situacao === "concluida" && <i className="text-[10.5px] not-italic">✓</i>}
        {c.situacao === "andamento" && <i className="text-[10.5px] not-italic">{c.feitos}/4</i>}
      </>
    );
  if (c.estimativa !== null)
    return (
      <>
        <span>~{fmt(c.estimativa)}</span>
        <i className="text-[10.5px] font-normal not-italic">est.</i>
      </>
    );
  return <span>{c.situacao === "sem-planilha" ? "∅" : c.situacao === "concluida" ? "✓" : c.situacao === "andamento" ? `${c.feitos}/4` : "○"}</span>;
}

function classeCelula(c: Celula) {
  if (c.situacao === "fora") return "border-transparent bg-superficie-2 text-suave font-normal";
  if (c.nota !== null) return FAIXA[faixaMapa(c.nota)][c.situacao === "concluida" ? "cheia" : "clara"];
  if (c.situacao === "sem-planilha") return "border-dashed border-erro bg-erro-suave text-erro";
  return "border-dashed border-borda text-suave";
}

function Indicador({ valor, total, rotulo, cor = "" }: { valor: string | number; total?: number; rotulo: string; cor?: string }) {
  return (
    <div className="grid gap-0.5 border border-borda bg-superficie px-3 py-2.5">
      <b className={`text-2xl tabular-nums ${cor}`}>
        {valor}
        {total !== undefined && <small className="text-[13px] font-normal text-suave"> / {total}</small>}
      </b>
      <span className="text-[12.5px] text-suave">{rotulo}</span>
    </div>
  );
}

export function MapaAvaliacoes({ m, tipo }: { m: Mapa; tipo: Tipo }) {
  const ind = m.indicadores;
  const corrente = formatarPeriodo(m.corrente);
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <Indicador valor={ind.concluidas} total={ind.total} rotulo="avaliações concluídas" />
        <Indicador
          valor={ind.media === null ? "—" : `${fmt(ind.media)}%`}
          rotulo={`nota média (${ind.comNota} ${ind.comNota === 1 ? "avaliação" : "avaliações"})`}
          cor={ind.media === null ? "" : { ok: "text-ok", atencao: "text-atencao", erro: "text-erro" }[faixaMapa(ind.media)]}
        />
        <Indicador valor={ind.correnteConcluidas} total={ind.correnteTotal} rotulo={`trimestre corrente (${corrente})`} />
        <Indicador valor={ind.abertasComPlanilha} rotulo="com planilha, ainda abertas" cor={ind.abertasComPlanilha ? "text-atencao" : ""} />
        <Indicador valor={ind.semPlanilha} rotulo="trimestres fechados sem planilha" cor={ind.semPlanilha ? "text-erro" : ""} />
      </div>

      <section className="grid gap-2" aria-labelledby="titulo-mapa">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 id="titulo-mapa" className="text-lg font-bold">
            Condomínio × trimestre
          </h2>
          <span className="text-[12.5px] text-suave">clique numa célula para abrir a avaliação</span>
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-suave">
          <span><i className="mr-1 inline-block size-3 bg-ok align-middle" />nota ≥ 90</span>
          <span><i className="mr-1 inline-block size-3 bg-atencao align-middle" />70–89,9</span>
          <span><i className="mr-1 inline-block size-3 bg-erro align-middle" />&lt; 70</span>
          <span>cheia ✓ = concluída · clara n/4 = em andamento · ~ = estimativa · ∅ = fechado sem planilha · ○ = a fazer · – = fora do período</span>
        </p>
        <div className="overflow-x-auto border border-borda bg-superficie">
          <table className="w-full min-w-[640px] border-separate border-spacing-[3px] text-[13px]">
            <thead>
              <tr className="text-[11px] text-suave">
                <th className="sticky left-0 z-10 bg-superficie" />
                {m.trimestres.map((p) => (
                  <th key={formatarPeriodo(p)} className="px-0.5 font-normal">
                    {formatarPeriodo(p)}
                  </th>
                ))}
                <th className="px-1 font-normal">Média</th>
                <th className="px-1 font-normal">Concluídas</th>
              </tr>
            </thead>
            <tbody>
              {m.linhas.map((l) => (
                <tr key={l.id}>
                  <th scope="row" className="sticky left-0 z-10 max-w-40 bg-superficie py-0.5 pr-2 pl-1.5 text-left font-normal">
                    <span className="block truncate font-bold" title={l.nome}>
                      {l.nome}
                    </span>
                    <small className="block truncate text-[11px] text-suave">{l.contratada}</small>
                  </th>
                  {l.celulas.map((c) => {
                    const p = formatarPeriodo(c.periodo);
                    const cls = `flex h-9 w-full min-w-14 items-center justify-center gap-1 border-[1.5px] font-bold tabular-nums ${classeCelula(c)}`;
                    const rotulo = `${l.nome} ${p}: ${c.nota !== null ? `nota ${fmt(c.nota)}, ` : c.estimativa !== null ? `estimativa ${fmt(c.estimativa)}, ` : ""}${ROTULO[c.situacao]}`;
                    return (
                      <td key={p}>
                        {c.situacao === "fora" ? (
                          <span className={cls} aria-label={rotulo} title={rotulo}>
                            –
                          </span>
                        ) : (
                          <Link href={`/avaliacao/${l.id}/${p}?tipo=${tipo}`} className={`${cls} hover:outline-2 hover:outline-texto`} aria-label={rotulo} title={rotulo}>
                            <ConteudoCelula c={c} />
                          </Link>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-1 text-center whitespace-nowrap tabular-nums">
                    {l.media === null ? (
                      <span className="text-suave">—</span>
                    ) : (
                      <span className={`rounded-full px-2 py-px text-[11.5px] font-bold ${FAIXA[faixaMapa(l.media)].clara}`}>{fmt(l.media)}</span>
                    )}
                  </td>
                  <td className="px-1 text-center whitespace-nowrap text-suave tabular-nums">
                    {l.concluidas} de {l.total}
                  </td>
                </tr>
              ))}
              {!m.linhas.length && (
                <tr>
                  <td colSpan={m.trimestres.length + 3} className="p-3 text-suave">
                    Nenhum condomínio ativo. Cadastre em <Link href="/cadastro" className="text-info underline">Cadastro</Link>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <section className="grid gap-2 border border-borda bg-superficie p-3" aria-labelledby="titulo-media">
          <h2 id="titulo-media" className="font-bold">
            Nota média por trimestre
          </h2>
          <div className="flex h-36 items-end gap-1.5 sm:gap-2.5" role="img" aria-label={m.porTrimestre.map((t) => `${formatarPeriodo(t.periodo)}: ${t.media === null ? "sem nota" : fmt(t.media)}`).join("; ")}>
            {m.porTrimestre.map((t) => (
              <div key={formatarPeriodo(t.periodo)} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[11px] font-bold tabular-nums">{t.media === null ? "—" : fmt(t.media)}</span>
                <div
                  className={`w-full max-w-11 ${t.media === null ? "bg-borda" : FAIXA[faixaMapa(t.media)].barra}`}
                  style={{ height: t.media === null ? "3px" : `${Math.max(6, ((t.media - 50) / 50) * 100)}%` }}
                />
                <span className="text-[10.5px] text-suave">{formatarPeriodo(t.periodo)}</span>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-suave">Colunas a partir de 50%. Média só das avaliações com nota final.</p>
        </section>

        <section className="grid content-start gap-2 border border-borda bg-superficie p-3" aria-labelledby="titulo-andamento-mapa">
          <h2 id="titulo-andamento-mapa" className="font-bold">
            Andamento por condomínio
          </h2>
          <ul className="grid gap-1.5">
            {m.linhas.map((l) => {
              const conta = (s: Situacao) => l.celulas.filter((c) => c.situacao === s).length;
              const partes: [Situacao, string][] = [
                ["concluida", "bg-ok"],
                ["andamento", "bg-atencao"],
                ["a-fazer", "bg-[repeating-linear-gradient(45deg,var(--borda)_0_3px,transparent_3px_6px)]"],
                ["sem-planilha", "bg-erro"],
              ];
              return (
                <li key={l.id} className="grid grid-cols-[minmax(0,7.5rem)_1fr_2.75rem] items-center gap-2 text-[12.5px] sm:grid-cols-[minmax(0,11rem)_1fr_2.75rem]">
                  <span className="truncate" title={l.nome}>
                    {l.nome}
                  </span>
                  <span className="flex h-4 gap-0.5 overflow-hidden bg-superficie-2" aria-label={partes.map(([s]) => `${conta(s)} ${ROTULO[s]}`).join(", ")}>
                    {partes.map(([s, cor]) => (conta(s) ? <i key={s} className={`block ${cor}`} style={{ flex: conta(s) }} title={`${conta(s)} ${ROTULO[s]}`} /> : null))}
                  </span>
                  <span className="text-right text-suave tabular-nums">
                    {l.concluidas}/{l.total}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="flex flex-wrap gap-x-3 text-[12px] text-suave">
            <span><i className="mr-1 inline-block size-3 bg-ok align-middle" />concluída</span>
            <span><i className="mr-1 inline-block size-3 bg-atencao align-middle" />em andamento</span>
            <span><i className="mr-1 inline-block size-3 border border-dashed border-borda align-middle" />a fazer</span>
            <span><i className="mr-1 inline-block size-3 bg-erro align-middle" />sem planilha</span>
          </p>
        </section>
      </div>
    </>
  );
}
