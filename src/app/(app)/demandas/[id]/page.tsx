import Link from "next/link";
import { notFound } from "next/navigation";
import { acaoAndamentoDemanda, acaoArquivarDemanda, acaoPrimeiraResposta } from "@/app/acoes";
import { BotaoVoltar } from "@/components/botao-voltar";
import { Etiqueta, PontoSituacao, botao, botaoPrimario, campo, eyebrow } from "@/components/demandas";
import { BotaoSituacao, CampoDemanda } from "@/components/demandas-cliente";
import { FormularioLinha } from "@/components/formulario-linha";
import { AGUARDANDO, ROTULO_AGUARDANDO, ROTULO_SITUACAO, ROTULO_TODA_CARTEIRA, TODA_CARTEIRA, carregarDemanda, nomeCondominio } from "@/lib/demandas";
import { CRITICIDADES, ROTULO_CRITICIDADE, diaHora, diaMes, estaAberta, paraDataHoraSP } from "@/lib/prazos-demandas";

const COR_EVENTO = { RECEBIDA: "bg-atencao", ENVIADA_DF: "bg-ok", NOTA: "bg-info", LOG: "bg-suave" } as const;
const ORIGEM_PRAZO = { email: "lido no e-mail", sla: "pelo SLA", combinado: "combinado com a BGRE", "a-combinar": "" } as const;

/** Uma demanda: dados editáveis, conversa e histórico, andamento, 1ª resposta, concluir e arquivar. */
export default async function DemandaPagina({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await carregarDemanda(id);
  if (!r) notFound();
  const { demanda: d } = r;
  const aberta = estaAberta(d);
  const arquivada = d.situacao === "ARQUIVADA";
  const dia = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "");

  return (
    <>
      <BotaoVoltar href="/demandas" />
      <div className="grid gap-1.5">
        <span className={eyebrow}>
          Demanda nº {d.numero} · {nomeCondominio(d) ?? "sem condomínio"}
        </span>
        <h1 className="text-2xl leading-tight font-bold">{d.titulo}</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <Etiqueta e={r.resposta} />
          <Etiqueta e={r.prazo} />
          <PontoSituacao situacao={d.situacao} rotulo={ROTULO_SITUACAO[d.situacao]} />
          {d.aguardando && aberta && <span className="text-[13px] text-suave">· aguardando {ROTULO_AGUARDANDO[d.aguardando]}</span>}
        </div>
        {arquivada && (
          <p className="border border-borda bg-superficie-2 px-3 py-2 text-[13.5px]">
            Arquivada em {d.arquivadaEm ? diaHora(d.arquivadaEm) : "—"}. Motivo: {d.motivoArquivo}
          </p>
        )}
      </div>

      <section aria-label="Análise" className="grid gap-2 border border-borda border-l-[3px] border-l-ouro bg-superficie p-4">
        <h2 className="text-[11px] font-bold tracking-widest uppercase">Análise</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="grid content-start gap-1 text-[12px] text-suave">
            Pedido (o que a BGRE pediu)
            <CampoDemanda id={d.id} campo="pedido" rotulo="Pedido" tipo="textarea" valor={d.pedido ?? ""} desabilitado={arquivada} />
          </label>
          <label className="grid content-start gap-1 text-[12px] text-suave">
            O que a DF faz
            <CampoDemanda id={d.id} campo="oQueFazer" rotulo="O que a DF faz" tipo="textarea" valor={d.oQueFazer ?? ""} desabilitado={arquivada} />
          </label>
          <label className="grid content-start gap-1 text-[12px] text-suave">
            Próximo passo
            <CampoDemanda id={d.id} campo="proximoPasso" rotulo="Próximo passo" tipo="textarea" valor={d.proximoPasso ?? ""} desabilitado={arquivada} />
          </label>
        </div>
        <p className="text-[12px] text-suave">A Triagem sugere; o que for editado aqui não é trocado por ela.</p>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-4">
          <section className="grid gap-2 border border-borda bg-superficie p-4">
            <h2 className="border-b-2 border-ouro pb-1 text-[11px] font-bold tracking-widest uppercase">Dados</h2>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-[13.5px]">
              <dt className="text-suave">Pedido por</dt>
              <dd className="[overflow-wrap:anywhere]">
                {d.remetenteNome || "—"} {d.remetenteEmail && <span className="text-suave">({d.remetenteEmail})</span>}
              </dd>
              <dt className="text-suave">Chegou</dt>
              <dd className="tabular-nums">
                {diaHora(d.chegadaEm)}{" "}
                <span className="text-[12px] text-suave">
                  ({d.origem === "MANUAL" ? `registrada à mão${d.canal ? `: ${d.canal.toLowerCase()}` : ""}` : d.origem === "PLANNER" ? "card antigo do Planner" : "envio do e-mail"})
                </span>
              </dd>
              <dt className="text-suave">1ª resposta</dt>
              <dd>
                {d.primeiraRespostaEm ? `${diaHora(d.primeiraRespostaEm)} · ${d.primeiraRespostaPor ?? ""}` : r.respostaAte ? `responder até ${diaHora(r.respostaAte)}` : "—"}
              </dd>
              <dt className="text-suave">Prazo</dt>
              <dd>
                {r.prazoEm.em ? (
                  <>
                    {diaMes(r.prazoEm.em)}{" "}
                    <span className="text-[12px] text-suave">
                      ({r.prazoEm.origem === "sla" ? `pelo SLA de ${ROTULO_CRITICIDADE[d.criticidade].toLowerCase()}` : ORIGEM_PRAZO[r.prazoEm.origem]})
                    </span>
                  </>
                ) : (
                  "a combinar com a BGRE"
                )}
              </dd>
              <dt className="text-suave">Criticidade</dt>
              <dd>
                <CampoDemanda id={d.id} campo="criticidade" rotulo="Criticidade" valor={d.criticidade} desabilitado={arquivada} opcoes={CRITICIDADES.map((c) => [c, ROTULO_CRITICIDADE[c]])} />
              </dd>
              <dt className="text-suave">Responsável</dt>
              <dd>
                <CampoDemanda id={d.id} campo="responsavel" rotulo="Responsável" valor={d.responsavel} desabilitado={arquivada} lista={r.responsaveis} />
              </dd>
              <dt className="text-suave">Situação</dt>
              <dd>
                {arquivada ? (
                  "Arquivada"
                ) : (
                  <CampoDemanda
                    id={d.id}
                    campo="situacao"
                    rotulo="Situação"
                    valor={d.situacao}
                    opcoes={(["ABERTA", "EM_ANDAMENTO", "AGUARDANDO", "REUNIAO", "CONCLUIDA"] as const).map((s) => [s, ROTULO_SITUACAO[s]])}
                  />
                )}
              </dd>
              <dt className="text-suave">Aguardando</dt>
              <dd>
                <CampoDemanda
                  id={d.id}
                  campo="aguardando"
                  rotulo="Aguardando quem"
                  valor={d.aguardando ?? ""}
                  desabilitado={arquivada}
                  opcoes={[["", "—"], ...AGUARDANDO.map((a): [string, string] => [a, ROTULO_AGUARDANDO[a]])]}
                />
              </dd>
              <dt className="text-suave">Condomínio</dt>
              <dd>
                <CampoDemanda
                  id={d.id}
                  campo="condominioId"
                  rotulo="Condomínio"
                  valor={d.todaCarteira ? TODA_CARTEIRA : (d.condominioId ?? "")}
                  desabilitado={arquivada}
                  opcoes={[["", "— sem condomínio —"], [TODA_CARTEIRA, ROTULO_TODA_CARTEIRA], ...r.condominios.map((c): [string, string] => [c.id, c.nome])]}
                />
              </dd>
              <dt className="text-suave">Prazo do e-mail</dt>
              <dd>
                <CampoDemanda id={d.id} campo="prazoEmail" rotulo="Prazo escrito no e-mail" tipo="date" valor={dia(d.prazoEmail)} desabilitado={arquivada} />
              </dd>
              <dt className="text-suave">Prazo combinado</dt>
              <dd>
                <CampoDemanda id={d.id} campo="prazoCombinado" rotulo="Prazo combinado com a BGRE" tipo="date" valor={dia(d.prazoCombinado)} desabilitado={arquivada} />
              </dd>
            </dl>
            {d.webLink && (
              <a href={d.webLink} target="_blank" rel="noopener noreferrer" className={`${botao} w-fit`}>
                Abrir e-mail no Outlook ↗
              </a>
            )}
          </section>

          <section className="grid gap-2 border border-borda bg-superficie p-4">
            <h2 className="border-b-2 border-ouro pb-1 text-[11px] font-bold tracking-widest uppercase">Conversa e histórico</h2>
            <ol className="grid gap-2.5">
              {r.eventos.map((e, i) => (
                <li key={i} className="grid grid-cols-[14px_minmax(0,1fr)] gap-2">
                  <span aria-hidden="true" className={`mt-1.5 size-2.5 rounded-full ${COR_EVENTO[e.tipo]}`} />
                  <div>
                    <div className="text-[12px] text-suave">
                      {diaHora(e.em)} · {e.quem}
                      {e.tipo === "ENVIADA_DF" && " · DF"}
                      {e.tipo === "NOTA" && " · andamento"}
                      {e.caixa && ` · caixa ${e.caixa}`}
                      {e.link && (
                        <>
                          {" · "}
                          <a href={e.link} target="_blank" rel="noopener noreferrer" className="underline">
                            e-mail
                          </a>
                        </>
                      )}
                    </div>
                    <div className={`text-[13.5px] whitespace-pre-line [overflow-wrap:anywhere] ${e.tipo === "LOG" ? "text-suave" : ""}`}>{e.texto}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="grid gap-4 lg:sticky lg:top-4">
          <section className="grid gap-2 border border-borda bg-superficie p-4">
            <h2 className="text-[15px] font-bold">Registrar andamento</h2>
            <FormularioLinha acao={acaoAndamentoDemanda} limpar rotulo="Gravar andamento">
              <input type="hidden" name="id" value={d.id} />
              <textarea
                name="texto"
                required
                aria-label="Andamento"
                placeholder="Ex.: liguei para a BGRE e combinei a entrega para sexta."
                className={`${campo} min-h-20 basis-full`}
              />
            </FormularioLinha>
          </section>

          {!d.primeiraRespostaEm && !arquivada && (
            <section className="grid gap-2 border border-borda bg-superficie p-4">
              <h2 className="text-[15px] font-bold">1ª resposta à mão</h2>
              <p className="text-[12.5px] text-suave">Para quem respondeu por telefone ou fora da conversa. Vazio = agora.</p>
              <FormularioLinha acao={acaoPrimeiraResposta} rotulo="Marcar 1ª resposta">
                <input type="hidden" name="id" value={d.id} />
                <input type="datetime-local" name="quando" aria-label="Quando foi a 1ª resposta" min={paraDataHoraSP(d.chegadaEm)} className={`${campo} flex-1 basis-44`} />
              </FormularioLinha>
            </section>
          )}

          <section className="grid gap-2 border border-borda bg-superficie p-4">
            <h2 className="text-[15px] font-bold">{aberta ? "Concluir ou arquivar" : "Reabrir"}</h2>
            {aberta ? (
              <>
                <BotaoSituacao id={d.id} acao="concluir" rotulo="Concluir demanda" confirmar="Marcar a demanda como concluída agora?" className={`${botaoPrimario} w-fit`} />
                <details className="grid gap-2">
                  <summary className="cursor-pointer text-[13px] text-suave">Não era demanda? Arquivar com motivo</summary>
                  <FormularioLinha acao={acaoArquivarDemanda} rotulo="Arquivar" className="mt-2">
                    <input type="hidden" name="id" value={d.id} />
                    <input name="motivo" required minLength={3} aria-label="Motivo do arquivamento" placeholder="Motivo (ex.: só informativo)" className={`${campo} flex-1 basis-48`} />
                  </FormularioLinha>
                </details>
              </>
            ) : (
              <BotaoSituacao id={d.id} acao="reabrir" rotulo="Reabrir demanda" confirmar="Reabrir a demanda (volta para Em andamento)?" className={`${botao} w-fit`} />
            )}
            {d.concluidaEm && <p className="text-[12.5px] text-suave">Concluída em {diaHora(d.concluidaEm)}.</p>}
          </section>

          <p className="text-[12.5px] text-suave">
            Prazos pela <Link href="/demandas/sla" className="underline">configuração de SLA</Link>. Toda mudança fica no histórico, com quem mudou e quando.
          </p>
        </aside>
      </div>
    </>
  );
}
