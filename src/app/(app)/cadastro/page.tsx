import { acaoSalvarAdministradora, acaoSalvarCondominio } from "@/app/acoes";
import { FormularioLinha } from "@/components/formulario-linha";
import { listarCadastro } from "@/lib/cadastro";

const campo = "w-full border border-borda bg-superficie px-2 py-1.5 text-[14px] text-texto";
const rotulo = "grid min-w-0 gap-0.5 text-[12px] text-suave";

export default async function Cadastro() {
  const [administradoras, condominios] = await listarCadastro();

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

  const camposCond = (c?: { id: string; nome: string; administradoraId: string; ativo: boolean }) => (
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
      <label className="flex items-center gap-1.5 py-1.5 text-[14px]">
        <input type="checkbox" name="ativo" defaultChecked={c?.ativo ?? true} className="size-4" />
        Ativo
      </label>
    </>
  );

  return (
    <>
      <h1 className="text-2xl font-bold">Cadastro</h1>

      <section className="grid gap-2">
        <h2 className="text-lg font-bold">Administradoras</h2>
        <ul className="grid gap-2">
          {administradoras.map((a) => (
            <li key={a.id} className="border border-borda bg-superficie px-3 py-2.5">
              <FormularioLinha acao={acaoSalvarAdministradora}>{camposAdm(a)}</FormularioLinha>
              <span className="text-[12px] text-suave">
                {a._count.condominios} {a._count.condominios === 1 ? "condomínio" : "condomínios"}
              </span>
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
        <p className="text-[13px] text-suave">Não há exclusão: quem sai da carteira fica inativo e o histórico das avaliações continua.</p>
        <ul className="grid gap-2">
          {condominios.map((c) => (
            <li key={c.id} className={`border border-borda px-3 py-2.5 ${c.ativo ? "bg-superficie" : "bg-superficie-2"}`}>
              <FormularioLinha acao={acaoSalvarCondominio}>{camposCond(c)}</FormularioLinha>
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
    </>
  );
}
