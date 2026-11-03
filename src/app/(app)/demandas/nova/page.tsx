import { acaoRegistrarDemanda } from "@/app/acoes";
import { BotaoVoltar } from "@/components/botao-voltar";
import { campo, eyebrow, rotulo } from "@/components/demandas";
import { FormularioLinha } from "@/components/formulario-linha";
import { prisma } from "@/lib/db";
import { CRITICIDADES, ROTULO_CRITICIDADE, paraDataHoraSP } from "@/lib/prazos-demandas";

/** "Registrar demanda" à mão: pedido por telefone, em reunião ou por WhatsApp. O horário de chegada é informado no ato. */
export default async function NovaDemanda() {
  const [condominios, responsaveis] = await Promise.all([
    prisma.condominio.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.demanda.findMany({ where: { responsavel: { not: "" } }, select: { responsavel: true }, distinct: ["responsavel"] }),
  ]);
  return (
    <>
      <BotaoVoltar href="/demandas" />
      <div className="grid gap-1">
        <span className={eyebrow}>Demandas da BGRE</span>
        <h1 className="text-2xl font-bold">Registrar demanda</h1>
        <p className="max-w-3xl text-[13px] text-suave">
          Para o que a BGRE pediu fora do e-mail (telefone, reunião, WhatsApp). O prazo do SLA conta a partir do horário em que o pedido chegou, que você
          informa aqui; o horário do registro não entra na conta.
        </p>
      </div>
      <section className="border border-borda bg-superficie p-4">
        <FormularioLinha acao={acaoRegistrarDemanda} rotulo="Registrar demanda" className="gap-3">
          <label className={`${rotulo} basis-full`}>
            O que a BGRE pediu
            <input name="titulo" required minLength={3} maxLength={300} className={campo} />
          </label>
          <label className={`${rotulo} flex-1 basis-56`}>
            Quem pediu (nome ou área da BGRE)
            <input name="remetenteNome" required maxLength={300} className={campo} />
          </label>
          <label className={`${rotulo} flex-1 basis-56`}>
            E-mail de quem pediu (opcional)
            <input name="remetenteEmail" type="email" className={campo} />
          </label>
          <label className={`${rotulo} basis-36`}>
            Canal
            <select name="canal" defaultValue="Telefone" className={campo}>
              {["Telefone", "Reunião", "WhatsApp", "E-mail", "Outro"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className={`${rotulo} basis-52`}>
            Chegou em (horário de Brasília)
            <input name="chegadaEm" type="datetime-local" required defaultValue={paraDataHoraSP(new Date())} className={campo} />
          </label>
          <label className={`${rotulo} basis-36`}>
            Criticidade
            <select name="criticidade" defaultValue="ORDINARIA" className={campo}>
              {CRITICIDADES.map((c) => (
                <option key={c} value={c}>
                  {ROTULO_CRITICIDADE[c]}
                </option>
              ))}
            </select>
          </label>
          <label className={`${rotulo} flex-1 basis-52`}>
            Condomínio (opcional)
            <select name="condominioId" defaultValue="" className={campo}>
              <option value="">— sem condomínio —</option>
              {condominios.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <label className={`${rotulo} basis-40`}>
            Prazo pedido pela BGRE
            <input name="prazoEmail" type="date" className={campo} />
          </label>
          <label className={`${rotulo} flex-1 basis-52`}>
            Responsável na DF
            <input name="responsavel" list="responsaveis" maxLength={300} className={campo} />
            <datalist id="responsaveis">
              {responsaveis.map((r) => (
                <option key={r.responsavel} value={r.responsavel} />
              ))}
            </datalist>
          </label>
          <label className={`${rotulo} basis-full`}>
            Detalhes do pedido
            <textarea name="descricao" maxLength={10_000} className={`${campo} min-h-24`} />
          </label>
          <label className={`${rotulo} basis-full`}>
            Link do e-mail no Outlook (opcional, https://…)
            <input name="webLink" type="url" pattern="https://.*" className={campo} />
          </label>
        </FormularioLinha>
      </section>
    </>
  );
}
