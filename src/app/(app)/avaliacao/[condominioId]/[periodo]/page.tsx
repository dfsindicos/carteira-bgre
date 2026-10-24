import Link from "next/link";
import { notFound } from "next/navigation";
import { acaoCriarAvaliacao } from "@/app/acoes";
import { BotaoStatus, CampoPrazo } from "@/components/acoes-avaliacao";
import { Situacao } from "@/components/classificacao";
import { TabelaAvaliacao } from "@/components/tabela-avaliacao";
import { carregarAvaliacao } from "@/lib/avaliacoes";
import { formatarPeriodo, lerPeriodo, mesesDoPeriodo, periodoAnterior } from "@/lib/scorecard";

const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const dataBR = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

function Prazo({ ate, entregueEm }: { ate: Date | null; entregueEm: Date | null }) {
  if (entregueEm) return <span>entregue em {dataBR(entregueEm)}</span>;
  if (!ate) return null;
  const dias = Math.round((ate.getTime() - Date.parse(hojeSP())) / 86_400_000);
  if (dias < 0) return <b className="text-erro">atrasada há {-dias} {dias === -1 ? "dia" : "dias"}</b>;
  return <span className={dias <= 7 ? "font-bold text-atencao" : ""}>{dias === 0 ? "vence hoje" : `faltam ${dias} ${dias === 1 ? "dia" : "dias"}`}</span>;
}

export default async function PaginaAvaliacao({ params }: { params: Promise<{ condominioId: string; periodo: string }> }) {
  const { condominioId, periodo: texto } = await params;
  const periodo = lerPeriodo(texto);
  if (!periodo) notFound();
  const dados = await carregarAvaliacao(condominioId, periodo);
  if (!dados) notFound();
  const { condominio, avaliacao: a } = dados;
  const p = formatarPeriodo(periodo);
  const anterior = formatarPeriodo(periodoAnterior(periodo));
  const entregue = a?.status === "ENTREGUE";

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-xl font-bold sm:text-2xl">
            {condominio.nome} · {p} <span className="font-normal text-suave">({mesesDoPeriodo(periodo)})</span>
          </h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-suave">
            <span>Contratada: {condominio.administradora.nome}</span>
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
          <Link href={`/avaliacao/${condominio.id}/${anterior}`} className="border border-marca px-3 py-1.5 text-[13px] font-bold text-titulo">
            Ver {anterior}
          </Link>
          {a && <BotaoStatus avaliacaoId={a.id} entregue={entregue} />}
          {a && (
            <a href={`/avaliacao/${condominio.id}/${p}/planilha`} className="bg-marca px-3 py-1.5 text-[13px] font-bold text-marca-texto">
              Gerar planilha BGRE
            </a>
          )}
        </div>
      </div>

      {a ? (
        <>
          {entregue && <p className="border-l-4 border-ok bg-ok-suave px-3 py-2 text-[14px]">Avaliação entregue: para mudar uma nota, clique em Reabrir.</p>}
          <TabelaAvaliacao avaliacaoId={a.id} notas={a.notas} comentarios={a.comentarios} bloqueada={entregue} />
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
        </>
      ) : (
        <div className="grid justify-items-start gap-3 border border-borda bg-superficie p-4">
          <p>Ainda não há avaliação de {condominio.nome} no {p}.</p>
          <form action={acaoCriarAvaliacao}>
            <input type="hidden" name="condominioId" value={condominio.id} />
            <input type="hidden" name="periodo" value={p} />
            <button className="bg-marca px-3 py-1.5 text-[13px] font-bold text-marca-texto">Criar avaliação do {p}</button>
          </form>
        </div>
      )}
    </>
  );
}
