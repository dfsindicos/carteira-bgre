import { acaoSalvarSla, acaoSlaPadrao } from "@/app/acoes";
import { AbasDemandas, eyebrow } from "@/components/demandas";
import { FormularioLinha } from "@/components/formulario-linha";
import { carregarSla, historicoSla } from "@/lib/demandas";
import { CRITICIDADES, ROTULO_CRITICIDADE, ROTULO_UNIDADE, UNIDADES, USO_CRITICIDADE, diaHora, type Regra } from "@/lib/prazos-demandas";

const numero = "w-16 border border-borda bg-superficie px-1.5 py-1 text-[14px] text-texto tabular-nums";
const unidade = "min-h-8 border border-borda bg-superficie px-1.5 text-[14px] text-texto";

/** Configuração de SLA das demandas: começa com o do Einstein, editável a qualquer momento, com histórico. */
export default async function ConfiguracaoSla() {
  const [cfg, historico] = await Promise.all([carregarSla(), historicoSla()]);
  const par = (c: string, p: "r" | "c", r: Regra, rot: string) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <input type="number" name={`${c}-${p}v`} min={1} max={999} step={1} required defaultValue={r.valor} aria-label={`${rot}: valor`} className={numero} />
      <select name={`${c}-${p}u`} defaultValue={r.unidade} aria-label={`${rot}: unidade`} className={unidade}>
        {UNIDADES.filter((u) => p === "c" || u !== "COMBINADO").map((u) => (
          <option key={u} value={u}>
            {ROTULO_UNIDADE[u]}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <>
      <div className="grid gap-1">
        <span className={eyebrow}>Carteira BGRE · Demandas recebidas da BGRE</span>
        <h1 className="text-2xl font-bold">Configuração de SLA</h1>
      </div>
      <AbasDemandas atual="sla" />
      <section className="grid gap-3 border border-borda bg-superficie p-4">
        <h2 className="text-lg font-bold">Prazos de atendimento das demandas da BGRE</h2>
        <p className="max-w-3xl text-[13px] text-suave">
          Começa com os prazos que a DF já usa no Einstein. Mudou aqui, vale para as demandas novas e para o cálculo das abertas; o histórico guarda quem
          mudou, quando e o valor anterior. Horas corridas contam o relógio direto; dias úteis pulam fins de semana (e feriados, se marcado) e mantêm o
          horário de chegada. Em “prazo combinado”, o número é o limite de referência (até N dias úteis) e a conclusão é a data combinada com a BGRE, anotada na demanda.
        </p>
        <FormularioLinha acao={acaoSalvarSla} rotulo="Salvar prazos" className="min-w-0 gap-3">
          <div className="w-full min-w-0 basis-full overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr className="bg-marca-suave text-left text-titulo">
                  <th className="border border-borda px-2.5 py-1.5">Criticidade</th>
                  <th className="border border-borda px-2.5 py-1.5">1ª resposta da DF</th>
                  <th className="border border-borda px-2.5 py-1.5">Conclusão</th>
                  <th className="border border-borda px-2.5 py-1.5 max-md:hidden">Quando usar</th>
                </tr>
              </thead>
              <tbody>
                {CRITICIDADES.map((c) => (
                  <tr key={c} className="align-middle">
                    <td className="border border-borda px-2.5 py-1.5 font-bold">{ROTULO_CRITICIDADE[c]}</td>
                    <td className="border border-borda px-2.5 py-1.5">{par(c, "r", cfg.regras[c].resposta, `${ROTULO_CRITICIDADE[c]}, 1ª resposta`)}</td>
                    <td className="border border-borda px-2.5 py-1.5">{par(c, "c", cfg.regras[c].conclusao, `${ROTULO_CRITICIDADE[c]}, conclusão`)}</td>
                    <td className="border border-borda px-2.5 py-1.5 text-[13px] text-suave max-md:hidden">{USO_CRITICIDADE[c]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="flex basis-full items-center gap-2 text-[13.5px]">
            <input type="checkbox" name="contarFeriados" defaultChecked={cfg.contarFeriados} className="size-4" />
            Contar feriados nacionais e de São Paulo como dia não útil
          </label>
          <label className="flex basis-full items-center gap-2 text-[13.5px]">
            <input type="checkbox" name="prazoEmailPrevalece" defaultChecked={cfg.prazoEmailPrevalece} className="size-4" />
            Prazo escrito no e-mail da BGRE prevalece sobre a conclusão do SLA
          </label>
        </FormularioLinha>
        <FormularioLinha acao={acaoSlaPadrao} rotulo="Voltar ao padrão do Einstein">
          <span className="text-[12.5px] text-suave">1 h/4 h, 4 h/1 du, 1 du/5 du, 2 du/combinado (até 10 du); feriados contam; prazo do e-mail prevalece.</span>
        </FormularioLinha>
      </section>
      <section className="grid gap-2 border border-borda bg-superficie p-4">
        <h2 className="border-b-2 border-ouro pb-1 text-[11px] font-bold tracking-widest uppercase">Histórico de alterações</h2>
        {historico.length ? (
          <ol className="grid gap-2">
            {historico.map((h) => (
              <li key={h.id} className="grid grid-cols-[14px_minmax(0,1fr)] gap-2">
                <span aria-hidden="true" className="mt-1.5 size-2.5 rounded-full bg-ouro" />
                <div>
                  <div className="text-[12px] text-suave">
                    {diaHora(h.em)} · {h.email}
                  </div>
                  <div className="text-[13.5px]">
                    {h.campo}
                    {h.antes !== null ? `: ${h.antes} → ${h.depois}` : h.depois ? ` (${h.depois})` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[13px] text-suave">Nenhuma alteração ainda: valem os prazos do Einstein (30/09/2026).</p>
        )}
      </section>
    </>
  );
}
