import Link from "next/link";
import { Ponto } from "@/components/classificacao";
import { painel } from "@/lib/avaliacoes";
import { classificar, formatarNota, formatarPeriodo, periodoEmAvaliacao } from "@/lib/scorecard";

function Diferenca({ d }: { d: number | null }) {
  if (d === null) return <span className="text-suave">—</span>;
  const v = Math.round(d * 10) / 10;
  if (v === 0) return <span className="text-suave">=</span>;
  const txt = Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 1 });
  return v > 0 ? <span className="text-ok">▲ {txt}</span> : <span className="text-erro">▼ {txt}</span>;
}

export default async function Painel() {
  const emAvaliacao = periodoEmAvaliacao();
  const p = await painel(emAvaliacao);
  const ref = p.referencia && formatarPeriodo(p.referencia);
  const ant = p.anterior && formatarPeriodo(p.anterior);
  return (
    <>
      <h1 className="text-2xl font-bold">Painel da carteira</h1>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
        <div className="col-span-2 grid gap-0.5 border border-borda bg-superficie px-3 py-2.5 md:col-span-1">
          <b className="text-2xl tabular-nums">{p.media === null ? "—" : formatarNota(p.media)}</b>
          <span className="text-[13px] text-suave">
            {p.media === null ? "nenhum trimestre com nota final ainda" : `média da carteira no ${ref} (${classificar(p.media)})`}
          </span>
        </div>
        <div className="grid gap-0.5 border border-borda bg-superficie px-3 py-2.5">
          <b className="text-2xl tabular-nums">{p.ativos}</b>
          <span className="text-[13px] text-suave">condomínios ativos</span>
        </div>
        <Link href={`/avaliacao?periodo=${formatarPeriodo(emAvaliacao)}`} className="grid gap-0.5 border border-borda bg-superficie px-3 py-2.5 hover:border-ouro">
          <b className={`text-2xl tabular-nums ${p.rascunhos ? "text-atencao" : ""}`}>{p.rascunhos}</b>
          <span className="text-[13px] text-suave">avaliações do {formatarPeriodo(emAvaliacao)} em rascunho</span>
        </Link>
      </div>

      <div className="overflow-x-auto border border-borda bg-superficie">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-marca text-left text-[12px] text-marca-texto">
              <th className="px-2.5 py-2">Condomínio</th>
              <th className="px-2.5 py-2 max-sm:hidden">Administradora</th>
              <th className="px-2.5 py-2 text-right">Nota {ref ?? ""}</th>
              <th className="px-2.5 py-2 whitespace-nowrap">vs {ant ?? "anterior"}</th>
              <th className="px-2.5 py-2 text-right">Sindicância</th>
              <th className="px-2.5 py-2 max-sm:hidden">Classificação</th>
            </tr>
          </thead>
          <tbody>
            {p.linhas.map((l) => (
              <tr key={l.id} className="border-t border-borda align-top hover:bg-superficie-2">
                <td className="px-2.5 py-2">
                  <Link href={`/avaliacao/${l.id}/${ref ?? formatarPeriodo(emAvaliacao)}`} className="font-bold hover:underline">
                    {l.nome}
                  </Link>
                  <span className="block text-[12.5px] text-suave sm:hidden">{l.administradora}</span>
                  <span className="block text-[12.5px] sm:hidden">
                    <Ponto c={l.nota === null ? null : classificar(l.nota)} />
                  </span>
                </td>
                <td className="px-2.5 py-2 max-sm:hidden">{l.administradora}</td>
                <td className="px-2.5 py-2 text-right tabular-nums">{formatarNota(l.nota)}</td>
                <td className="px-2.5 py-2 whitespace-nowrap tabular-nums">
                  <Diferenca d={l.diferenca} />
                </td>
                <td className="px-2.5 py-2 text-right tabular-nums">
                  <Link href={`/avaliacao/${l.id}/${ref ?? formatarPeriodo(emAvaliacao)}?tipo=SINDICANCIA`} className="hover:underline">
                    {formatarNota(l.sindicancia)}
                  </Link>
                </td>
                <td className="px-2.5 py-2 max-sm:hidden">
                  <Ponto c={l.nota === null ? null : classificar(l.nota)} />
                </td>
              </tr>
            ))}
            {!p.linhas.length && (
              <tr>
                <td colSpan={6} className="px-2.5 py-4 text-suave">
                  Nenhum condomínio ativo. Comece pelo <Link href="/cadastro" className="text-info underline">Cadastro</Link>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-suave">Os piores primeiro; sem nota final no {ref ?? "trimestre"} fica no topo. Clicar no condomínio abre a avaliação da Administradora; na nota da Sindicância, a da Sindicância do mesmo trimestre.</p>
    </>
  );
}
