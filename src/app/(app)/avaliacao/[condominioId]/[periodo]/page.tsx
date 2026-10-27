import Link from "next/link";
import { notFound } from "next/navigation";
import { acaoAcompanhamento, acaoCriarAvaliacao } from "@/app/acoes";
import { AbasTipo } from "@/components/abas-tipo";
import { BotaoVoltar } from "@/components/botao-voltar";
import { BotaoStatus, CampoPrazo, Checklist } from "@/components/acoes-avaliacao";
import { Ponto, Situacao } from "@/components/classificacao";
import { FormularioLinha } from "@/components/formulario-linha";
import { TabelaAvaliacao } from "@/components/tabela-avaliacao";
import { carregarAvaliacao } from "@/lib/avaliacoes";
import { CONTRATADA_SINDICANCIA, MODELOS, classificar, formatarNota, formatarPeriodo, lerPeriodo, lerTipo, mesesDoPeriodo, periodoAnterior } from "@/lib/scorecard";

const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const dataBR = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

function Prazo({ ate, entregueEm }: { ate: Date | null; entregueEm: Date | null }) {
  if (entregueEm) return <span>entregue em {dataBR(entregueEm)}</span>;
  if (!ate) return null;
  const dias = Math.round((ate.getTime() - Date.parse(hojeSP())) / 86_400_000);
  if (dias < 0) return <b className="text-erro">atrasada há {-dias} {dias === -1 ? "dia" : "dias"}</b>;
  return <span className={dias <= 7 ? "font-bold text-atencao" : ""}>{dias === 0 ? "vence hoje" : `faltam ${dias} ${dias === 1 ? "dia" : "dias"}`}</span>;
}

export default async function PaginaAvaliacao({
  params,
  searchParams,
}: {
  params: Promise<{ condominioId: string; periodo: string }>;
  searchParams: Promise<{ tipo?: string }>;
}) {
  const { condominioId, periodo: texto } = await params;
  const tipo = lerTipo((await searchParams).tipo);
  const modelo = MODELOS[tipo];
  const periodo = lerPeriodo(texto);
  if (!periodo) notFound();
  const dados = await carregarAvaliacao(condominioId, periodo, tipo);
  if (!dados) notFound();
  const { condominio, avaliacao: a } = dados;
  const p = formatarPeriodo(periodo);
  const anterior = formatarPeriodo(periodoAnterior(periodo));
  const entregue = a?.status === "ENTREGUE";
  const q = `?tipo=${tipo}`;

  return (
    <>
      <BotaoVoltar href={`/avaliacao?tipo=${tipo}`} />
      <AbasTipo tipo={tipo} href={(t) => `/avaliacao/${condominio.id}/${p}?tipo=${t}`} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-xl font-bold sm:text-2xl">
            {condominio.nome} · {p} <span className="font-normal text-suave">({mesesDoPeriodo(periodo)})</span>
          </h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-suave">
            <span>Contratada: {tipo === "SINDICANCIA" ? CONTRATADA_SINDICANCIA : condominio.administradora.nome}</span>
            {a && (
              <>
                <span aria-hidden="true">·</span>
                <CampoPrazo avaliacaoId={a.id} valor={a.entregaAte?.toISOString().slice(0, 10) ?? ""} bloqueado={entregue} />
                <span aria-hidden="true">·</span>
                <Prazo ate={a.entregaAte} entregueEm={a.entregueEm} />
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Situacao status={a?.status ?? null} />
          <Link href={`/avaliacao/${condominio.id}/${anterior}${q}`} className="border border-marca px-3 py-1.5 text-[13px] font-bold text-titulo">
            Ver {anterior}
          </Link>
          {a && <BotaoStatus avaliacaoId={a.id} entregue={entregue} />}
          {a && (
            <a href={`/avaliacao/${condominio.id}/${p}/planilha${q}`} className="bg-marca px-3 py-1.5 text-[13px] font-bold text-marca-texto">
              Gerar planilha BGRE
            </a>
          )}
        </div>
      </div>

      {a ? (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Checklist
              avaliacaoId={a.id}
              titulo={`${modelo.nome} — ${condominio.nome} — ${p}`}
              passos={modelo.passos}
              marcas={a.passos.map((m) => m && { em: dataBR(m.em), por: m.por })}
            />
            <section className="grid gap-2" aria-labelledby="titulo-andamento">
              <h2 id="titulo-andamento" className="text-lg font-bold">
                Andamento{a.andamentoEm && <span className="text-[13px] font-normal text-suave"> · atualizado em {a.andamentoEm.toLocaleDateString("pt-BR", { timeZone: "UTC" })}</span>}
              </h2>
              {a.andamento.length > 0 && (
                <ul className="list-disc border border-borda bg-superficie py-2 pr-3 pl-7 text-[14px]">
                  {a.andamento.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
              {a.estimativa !== null && (
                <p className="flex flex-wrap items-center gap-2 text-[14px]">
                  Nota estimada <b className="tabular-nums">~{formatarNota(a.estimativa)}</b> <Ponto c={classificar(a.estimativa)} />
                </p>
              )}
              <FormularioLinha acao={acaoAcompanhamento} className="border border-borda bg-superficie p-3">
                <input type="hidden" name="avaliacaoId" value={a.id} />
                <label className="grid w-full gap-0.5 text-[12px] text-suave">
                  Anotações de andamento (uma por linha), por exemplo “Falta: SST de setembro (2.5)”
                  <textarea name="andamento" rows={4} defaultValue={a.andamento.join("\n")} className="w-full resize-y border border-borda bg-superficie px-2 py-1.5 text-[14px] text-texto" />
                </label>
                <label className="grid gap-0.5 text-[12px] text-suave">
                  Nota estimada (opcional)
                  <input
                    name="estimativa"
                    inputMode="decimal"
                    autoComplete="off"
                    defaultValue={a.estimativa === null ? "" : String(a.estimativa).replace(".", ",")}
                    className="w-28 border border-borda bg-superficie px-2 py-1.5 text-right text-[14px] text-texto tabular-nums"
                  />
                </label>
                <span className="basis-full text-[12px] text-suave">Item sem evidência conta como 100% nesta estimativa. Aparece no mapa como “~” enquanto não há nota final.</span>
              </FormularioLinha>
            </section>
          </div>
          {entregue && <p className="border-l-4 border-ok bg-ok-suave px-3 py-2 text-[14px]">Enviada à BGRE (passo 4): para mudar uma nota, clique em Reabrir.</p>}
          <TabelaAvaliacao tipo={tipo} avaliacaoId={a.id} notas={a.notas} comentarios={a.comentarios} bloqueada={entregue} />
          {tipo === "ADMINISTRADORA" && (
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-suave">
            <span>
              <span className="rounded-sm bg-info-suave px-1.5 font-bold text-info">Action Log</span> por enquanto digitado à mão; o preenchimento automático vem numa próxima entrega
            </span>
            <span>
              <span className="rounded-sm bg-ouro-suave px-1.5 font-bold text-ouro">Evidência</span> vem do arquivo enviado pela administradora
            </span>
            <span>
              <span className="rounded-sm border border-borda bg-superficie-2 px-1.5 font-bold">DF</span> nota da auditoria da DF
            </span>
          </p>
          )}
        </>
      ) : (
        <div className="grid justify-items-start gap-3 border border-borda bg-superficie p-4">
          <p>
            Ainda não há {modelo.nome.toLowerCase()} de {condominio.nome} no {p}.
          </p>
          <form action={acaoCriarAvaliacao}>
            <input type="hidden" name="tipo" value={tipo} />
            <input type="hidden" name="condominioId" value={condominio.id} />
            <input type="hidden" name="periodo" value={p} />
            <button className="bg-marca px-3 py-1.5 text-[13px] font-bold text-marca-texto">Criar avaliação do {p}</button>
          </form>
        </div>
      )}
    </>
  );
}
