import { acaoSalvarAdministradora, acaoSalvarCondominio, acaoSincronizarMestre } from "@/app/acoes";
import { FormularioLinha } from "@/components/formulario-linha";
import { ModelosBgre } from "@/components/modelos-bgre";
import { listarCadastro } from "@/lib/cadastro";
import { estadoDoMestre } from "@/lib/mestre";
import { listarModelos } from "@/lib/modelo-bgre";
import { formatarPeriodo } from "@/lib/scorecard";

const campo = "w-full border border-borda bg-superficie px-2 py-1.5 text-[14px] text-texto";
const rotulo = "grid min-w-0 gap-0.5 text-[12px] text-suave";
const quando = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const doMestre = <span className="text-[12px] font-bold text-info">Action Log</span>;

export default async function Cadastro() {
  const [[administradoras, condominios], modelos, mestre] = await Promise.all([listarCadastro(), listarModelos(), estadoDoMestre()]);
  const r = mestre.ultimaOk?.resumo;

  const camposAdm = (a?: { id: string; nome: string; emails: string }) => (
    <>
      {a && <input type="hidden" name="id" value={a.id} />}
      <label className={`${rotulo} flex-1 basis-48`}>
        Nome
        <input name="nome" defaultValue={a?.nome} required className={campo} />
      </label>
      <label className={`${rotulo} flex-[2] basis-64`}>
        E-mails do pedido de evidências (separados por vírgula)
        <input name="emails" defaultValue={a?.emails.split("\n").join(", ")} className={campo} />
      </label>
    </>
  );

  type Cond = { id: string; nome: string; administradoraId: string; ativo: boolean; avaliadoDesdeAno: number | null; avaliadoDesdeTrimestre: number | null };
  const camposCond = (c?: Cond) => (
    <>
      {c && <input type="hidden" name="id" value={c.id} />}
      <label className={`${rotulo} flex-[2] basis-56`}>
        Nome
        <input name="nome" defaultValue={c?.nome} required className={campo} />
      </label>
      <label className={`${rotulo} flex-1 basis-44`}>
        Administradora
        <select name="administradoraId" defaultValue={c?.administradoraId ?? ""} required className={campo}>
          <option value="" disabled>
            Escolha…
          </option>
          {administradoras.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nome}
            </option>
          ))}
        </select>
      </label>
      <label className={`${rotulo} w-28`}>
        Avaliado desde
        <input
          name="avaliadoDesde"
          placeholder="1T25"
          pattern="[1-4][Tt][0-9]{2}"
          title="Trimestre no formato 1T26"
          defaultValue={c?.avaliadoDesdeAno && c.avaliadoDesdeTrimestre ? formatarPeriodo({ ano: c.avaliadoDesdeAno, trimestre: c.avaliadoDesdeTrimestre }) : ""}
          className={campo}
        />
      </label>
      <label className="flex items-center gap-1.5 py-1.5 text-[14px]">
        <input type="checkbox" name="ativo" defaultChecked={c?.ativo ?? true} className="size-4" />
        Ativo
      </label>
    </>
  );

  return (
    <>
      <h1 className="text-2xl font-bold">Cadastro</h1>

      <section className="grid gap-2 border border-borda border-l-4 border-l-ouro bg-superficie p-4 text-[14px]" aria-label="Cadastro mestre">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <b className="text-titulo">Cadastro mestre: Action Log</b>
          <FormularioLinha acao={acaoSincronizarMestre} rotulo="Sincronizar agora">
            <></>
          </FormularioLinha>
        </div>
        <p className="text-suave">
          Os condomínios marcados com &quot;Carteira BGRE&quot; no Action Log entram aqui sozinhos, de hora em hora, com a administradora. Nome e
          administradora dos que têm a marca {doMestre} seguem o Action Log: para mudar, mude lá. Desligado ou arquivado lá fica inativo aqui, com as
          avaliações. Os e-mails do pedido de evidências e o &quot;avaliado desde&quot; continuam sendo daqui.
        </p>
        {mestre.ultima ? (
          <p>
            Última leitura: {quando(mestre.ultima.em)}{" "}
            {mestre.ultima.ok ? <span className="font-bold text-ok">ok</span> : <span className="font-bold text-erro">falhou ({mestre.ultima.erro})</span>}
            {!mestre.ultima.ok && mestre.ultimaOk && <> · a última que deu certo foi {quando(mestre.ultimaOk.em)}</>}
          </p>
        ) : (
          <p className="text-suave">Ainda não leu o Action Log.</p>
        )}
        {r && r.soAqui.length > 0 && (
          <p>
            <b>Só aqui, sem par no Action Log</b> ({r.soAqui.length}): {r.soAqui.join(", ")}. Se for o mesmo condomínio com outro nome, ponha este nome em
            &quot;outros nomes&quot; no Action Log; se não for mais da carteira, deixe inativo aqui.
          </p>
        )}
        {r && r.conflitos.length > 0 && <p className="text-erro">{r.conflitos.join(" · ")}</p>}
      </section>

      <section className="grid gap-2">
        <h2 className="text-lg font-bold">Administradoras</h2>
        <ul className="grid gap-2">
          {administradoras.map((a) => (
            <li key={a.id} className="border border-borda bg-superficie px-3 py-2.5">
              <FormularioLinha acao={acaoSalvarAdministradora}>{camposAdm(a)}</FormularioLinha>
              <span className="text-[12px] text-suave">
                {a._count.condominios} {a._count.condominios === 1 ? "condomínio" : "condomínios"}
              </span>
              {a.codigoMestre && <> · {doMestre}</>}
            </li>
          ))}
          <li className="border border-dashed border-ouro bg-ouro-suave px-3 py-2.5">
            <FormularioLinha acao={acaoSalvarAdministradora} limpar rotulo="Criar">
              {camposAdm()}
            </FormularioLinha>
          </li>
        </ul>
      </section>

      <section className="grid gap-2">
        <h2 className="text-lg font-bold">Condomínios</h2>
        <p className="text-[13px] text-suave">
          Não há exclusão: quem sai da carteira fica inativo e o histórico das avaliações continua. “Avaliado desde” é o primeiro trimestre avaliado
          pela BGRE (vazio = desde o 1T25); os anteriores aparecem como fora do período no mapa.
        </p>
        <ul className="grid gap-2">
          {condominios.map((c) => (
            <li key={c.id} className={`border border-borda px-3 py-2.5 ${c.ativo ? "bg-superficie" : "bg-superficie-2"}`}>
              <FormularioLinha acao={acaoSalvarCondominio}>{camposCond(c)}</FormularioLinha>
              {c.codigoMestre && doMestre}
            </li>
          ))}
          {administradoras.length ? (
            <li className="border border-dashed border-ouro bg-ouro-suave px-3 py-2.5">
              <FormularioLinha acao={acaoSalvarCondominio} limpar rotulo="Criar">
                {camposCond()}
              </FormularioLinha>
            </li>
          ) : (
            <li className="text-suave">Cadastre primeiro uma administradora.</li>
          )}
        </ul>
      </section>

      <section className="grid gap-2">
        <h2 className="text-lg font-bold">Modelos da BGRE</h2>
        <p className="text-[13px] text-suave">
          A planilha oficial da BGRE em .xlsx, uma da Administradora e uma da Sindicância (pode ser uma já preenchida de outro trimestre). Com o modelo
          aqui, “Gerar planilha BGRE” devolve o próprio arquivo da BGRE preenchido: cabeçalho, nota e comentário de cada item; o resto do arquivo
          (logo, fórmulas, abas) fica como veio, e as notas por bloco e a final saem das fórmulas dela ao abrir. Quando a BGRE mudar o modelo, envie o
          novo.
        </p>
        <ModelosBgre modelos={modelos.map((m) => ({ ...m, enviadoEm: m.enviadoEm.toISOString() }))} />
      </section>
    </>
  );
}
