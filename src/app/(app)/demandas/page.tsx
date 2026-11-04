import Link from "next/link";
import { AbasDemandas, Etiqueta, PontoSituacao, botao, botaoPrimario, campo, eyebrow } from "@/components/demandas";
import { FiltrosRecolhiveis } from "@/components/demandas-cliente";
import {
  AGUARDANDO,
  INDICADORES,
  ROTULO_AGUARDANDO,
  ROTULO_SITUACAO,
  ROTULO_TODA_CARTEIRA,
  TODA_CARTEIRA,
  VISOES,
  nomeCondominio,
  listarDemandas,
  type Filtros,
  type Indicador,
  type Visao,
} from "@/lib/demandas";
import { FILTROS_ORIGEM, FILTROS_PRAZO, FILTROS_RESPOSTA, NINGUEM, ORDENS, SENTIDO_PADRAO, contarFiltros, type Ordem } from "@/lib/filtros-demandas";
import { CRITICIDADES, ROTULO_CRITICIDADE, diaHora, estaAberta } from "@/lib/prazos-demandas";

const COR_INDICADOR: Record<Indicador, string> = { abertas: "border-t-marca", sem: "border-t-erro", vencidas: "border-t-erro", semana: "border-t-atencao", noprazo: "border-t-ok" };
const CHAVES = ["vis", "cond", "resp", "kpi", "crit", "ag", "prazo", "resp1", "de", "ate", "origem", "q", "ord", "dir"] as const;
type Chave = (typeof CHAVES)[number];
const rotuloCampo = "grid min-w-0 gap-0.5 text-[12px] text-suave";

/** Demandas da BGRE: indicadores, filtros, ordem e a tabela; cada linha abre a demanda (e volta com os mesmos filtros). */
export default async function Demandas({ searchParams }: { searchParams: Promise<Filtros> }) {
  const f = await searchParams;
  const r = await listarDemandas(f);
  const fl = r.filtros;
  // O estado da lista, só com o que vale (o padrão fica fora da URL).
  const atual: Partial<Record<Chave, string>> = {
    vis: r.vis === "abertas" ? undefined : r.vis,
    cond: typeof f.cond === "string" ? f.cond || undefined : undefined,
    resp: typeof f.resp === "string" ? f.resp || undefined : undefined,
    kpi: r.kpi ?? undefined,
    crit: fl.crit,
    ag: fl.ag,
    prazo: fl.prazo,
    resp1: fl.resp1,
    de: fl.de,
    ate: fl.ate,
    origem: fl.origem,
    q: fl.q,
    ord: fl.ord === "numero" ? undefined : fl.ord,
    dir: fl.dir === SENTIDO_PADRAO[fl.ord] ? undefined : fl.dir,
  };
  const consulta = (mudar: Partial<Record<Chave, string | undefined>> = {}) => {
    const p = new URLSearchParams();
    const tudo = { ...atual, ...mudar };
    for (const k of CHAVES) if (tudo[k]) p.set(k, tudo[k]!);
    return p.toString();
  };
  const url = (mudar: Partial<Record<Chave, string | undefined>> = {}) => {
    const q = consulta(mudar);
    return q ? `/demandas?${q}` : "/demandas";
  };
  const exportar = `/demandas/exportar${consulta() ? `?${consulta()}` : ""}`;
  const volta = consulta();
  const ativos = contarFiltros(fl) + [atual.cond, atual.resp, atual.kpi].filter(Boolean).length;
  const titulo = r.vis === "abertas" ? "Demandas em aberto" : `Demandas · ${VISOES[r.vis].toLowerCase()}`;

  /** Cabeçalho que ordena: clicar de novo inverte o sentido; a seta mostra o sentido atual. */
  const Ordena = ({ ord, children, className = "" }: { ord: Ordem; children: React.ReactNode; className?: string }) => {
    const ativo = fl.ord === ord;
    const dir = ativo ? (fl.dir === "asc" ? "desc" : "asc") : SENTIDO_PADRAO[ord];
    return (
      <th className={`px-2.5 py-2 ${className}`} aria-sort={ativo ? (fl.dir === "asc" ? "ascending" : "descending") : undefined}>
        <Link href={url({ ord: ord === "numero" ? undefined : ord, dir: dir === SENTIDO_PADRAO[ord] ? undefined : dir })} className="inline-flex items-center gap-1 hover:underline">
          {children}
          <span aria-hidden="true" className={ativo ? "text-ouro" : "opacity-60"}>
            {ativo ? (fl.dir === "asc" ? "▲" : "▼") : "⇅"}
          </span>
        </Link>
      </th>
    );
  };

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

      <div role="group" aria-label="Situação" className="flex w-fit max-w-full flex-wrap border border-borda bg-superficie">
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

      <FiltrosRecolhiveis rotulo={`Filtros e ordem${ativos ? ` (${ativos} ${ativos === 1 ? "ativo" : "ativos"})` : ""}`}>
        <form method="get" action="/demandas" className="grid gap-2.5 border border-borda bg-superficie p-3">
          {atual.vis && <input type="hidden" name="vis" value={atual.vis} />}
          {atual.kpi && <input type="hidden" name="kpi" value={atual.kpi} />}
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-6">
            <label className={`${rotuloCampo} col-span-2`}>
              Buscar (nº, título, pedido, o que fazer, remetente, assunto)
              <input type="search" name="q" defaultValue={fl.q ?? ""} placeholder="Ex.: 41 ou laudo gerador" className={campo} />
            </label>
            <label className={rotuloCampo}>
              Chegou de
              <input type="date" name="de" defaultValue={fl.de ?? ""} className={campo} />
            </label>
            <label className={rotuloCampo}>
              até
              <input type="date" name="ate" defaultValue={fl.ate ?? ""} className={campo} />
            </label>
            <label className={rotuloCampo}>
              Condomínio
              <select name="cond" defaultValue={atual.cond ?? ""} className={campo}>
                <option value="">Todos</option>
                <option value={TODA_CARTEIRA}>{ROTULO_TODA_CARTEIRA}</option>
                {r.condominios.map(([id, nome]) => (
                  <option key={id} value={id}>
                    {nome}
                  </option>
                ))}
                <option value="sem">Sem condomínio</option>
              </select>
            </label>
            <label className={rotuloCampo}>
              Responsável
              <select name="resp" defaultValue={atual.resp ?? ""} className={campo}>
                <option value="">Todos</option>
                {r.responsaveis.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
                <option value="sem">Sem responsável</option>
              </select>
            </label>
            <label className={rotuloCampo}>
              Criticidade
              <select name="crit" defaultValue={fl.crit ?? ""} className={campo}>
                <option value="">Todas</option>
                {CRITICIDADES.map((c) => (
                  <option key={c} value={c}>
                    {ROTULO_CRITICIDADE[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className={rotuloCampo}>
              Aguardando quem
              <select name="ag" defaultValue={fl.ag ?? ""} className={campo}>
                <option value="">Todos</option>
                {AGUARDANDO.map((a) => (
                  <option key={a} value={a}>
                    {ROTULO_AGUARDANDO[a]}
                  </option>
                ))}
                <option value={NINGUEM}>Ninguém</option>
              </select>
            </label>
            <label className={rotuloCampo}>
              Prazo
              <select name="prazo" defaultValue={fl.prazo ?? ""} className={campo}>
                <option value="">Todos</option>
                {Object.entries(FILTROS_PRAZO).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className={rotuloCampo}>
              1ª resposta
              <select name="resp1" defaultValue={fl.resp1 ?? ""} className={campo}>
                <option value="">Todas</option>
                {Object.entries(FILTROS_RESPOSTA).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className={rotuloCampo}>
              Origem
              <select name="origem" defaultValue={fl.origem ?? ""} className={campo}>
                <option value="">Todas</option>
                {Object.entries(FILTROS_ORIGEM).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className={rotuloCampo}>
              Ordenar por
              <select name="ord" defaultValue={fl.ord} className={campo}>
                {Object.entries(ORDENS).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className={rotuloCampo}>
              Sentido
              <select name="dir" defaultValue={atual.dir ?? ""} className={campo}>
                <option value="">Padrão do campo</option>
                <option value="asc">Crescente</option>
                <option value="desc">Decrescente</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={botaoPrimario}>Aplicar</button>
            <Link href={url({ cond: undefined, resp: undefined, kpi: undefined, crit: undefined, ag: undefined, prazo: undefined, resp1: undefined, de: undefined, ate: undefined, origem: undefined, q: undefined, ord: undefined, dir: undefined })} className={botao}>
              Limpar filtros
            </Link>
            <span className="text-[12px] text-suave">
              Padrão: Nº mais novo primeiro. Prazo: mais urgente primeiro, sem prazo no fim. Clicar em Nº, Chegou ou Prazo na tabela também ordena.
            </span>
          </div>
        </form>
      </FiltrosRecolhiveis>

      <p className="text-[12.5px] text-suave" role="status">
        {ativos ? `${r.linhas.length} de ${r.totalVisao}` : r.linhas.length} {(ativos ? r.totalVisao : r.linhas.length) === 1 ? "demanda" : "demandas"}
        {r.kpi && ` · ${INDICADORES[r.kpi].toLowerCase()}`} · ordem: {ORDENS[fl.ord].toLowerCase()} ({fl.dir === "asc" ? "crescente" : "decrescente"})
        {ativos > 0 && (
          <>
            {" · "}
            <Link href={url({ cond: undefined, resp: undefined, kpi: undefined, crit: undefined, ag: undefined, prazo: undefined, resp1: undefined, de: undefined, ate: undefined, origem: undefined, q: undefined })} className="underline">
              limpar filtros
            </Link>
          </>
        )}
      </p>

      <div className="overflow-x-auto border border-borda bg-superficie">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="bg-marca text-left text-[12.5px] text-marca-texto">
              <Ordena ord="numero">Nº</Ordena>
              <Ordena ord="titulo">Demanda</Ordena>
              <Ordena ord="condominio" className="max-md:hidden">
                Condomínio
              </Ordena>
              <Ordena ord="chegada" className="max-md:hidden">
                Chegou
              </Ordena>
              <Ordena ord="resposta" className="max-sm:hidden">
                1ª resposta
              </Ordena>
              <Ordena ord="prazo" className="max-sm:hidden">
                Prazo
              </Ordena>
              <Ordena ord="situacao" className="max-sm:hidden">
                Situação
              </Ordena>
            </tr>
          </thead>
          <tbody>
            {r.linhas.map((d) => (
              <tr key={d.id} className="border-t border-borda align-top hover:bg-superficie-2">
                <td className="px-2.5 py-2 tabular-nums">{d.numero}</td>
                <td className="min-w-40 px-2.5 py-2">
                  <Link href={`/demandas/${d.id}${volta ? `?volta=${encodeURIComponent(volta)}` : ""}`} className="font-bold hover:underline">
                    {d.titulo}
                  </Link>
                  {d.oQueFazer && (
                    <span className="block max-w-[52ch] truncate text-[12.5px]" title={d.oQueFazer}>
                      → {d.oQueFazer}
                    </span>
                  )}
                  <span className="block text-[12px] text-suave">
                    {d.remetenteNome || d.remetenteEmail || "—"} · <b>{ROTULO_CRITICIDADE[d.criticidade]}</b> ·{" "}
                    {d.responsavel ? d.responsavel : <b>sem responsável</b>}
                  </span>
                  <span className="block text-[12px] text-suave md:hidden">
                    {nomeCondominio(d) ?? "sem condomínio"} · chegou {diaHora(d.chegadaEm)}
                  </span>
                  {fl.ord === "movimento" && <span className="block text-[12px] text-suave">última movimentação {diaHora(d.ultimaMovimentacao)}</span>}
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] sm:hidden">
                    <Etiqueta e={d.resposta} />
                    <Etiqueta e={d.prazo} />
                    <PontoSituacao situacao={d.situacao} rotulo={ROTULO_SITUACAO[d.situacao]} />
                  </span>
                </td>
                <td className="px-2.5 py-2 max-md:hidden">{nomeCondominio(d) ?? <span className="text-suave">—</span>}</td>
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
