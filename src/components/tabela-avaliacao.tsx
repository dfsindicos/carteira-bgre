"use client";

import { Fragment, useState } from "react";
import { acaoSalvarCampo } from "@/app/acoes";
import { Ponto } from "@/components/classificacao";
import { ESCALA, FONTES, MODELOS, calcular, classificar, esquemaNota, formatarNota, type Fonte, type Notas, type Tipo } from "@/lib/scorecard";

const COR_FONTE: Record<Fonte, string> = {
  al: "bg-info-suave text-info",
  ev: "bg-ouro-suave text-ouro",
  df: "bg-superficie-2 text-suave border border-borda",
};

type Estado = { salvando?: boolean; erro?: string };
const chave = (item: string, campo: "nota" | "comentario") => `${item}:${campo}`;
const textoNota = (v: number | null | undefined) => (typeof v === "number" ? String(v).replace(".", ",") : "");

/**
 * Tabela do Score Card. Cada nota e comentário grava sozinho ao sair do campo (server action por campo, como a grade
 * do Action Log); com erro, o que foi digitado fica no campo e a mensagem aparece embaixo. O resultado recalcula
 * enquanto se digita, com a mesma conta do servidor (src/lib/scorecard.ts).
 */
export function TabelaAvaliacao({
  tipo,
  avaliacaoId,
  notas,
  comentarios,
  bloqueada,
}: {
  tipo: Tipo;
  avaliacaoId: string;
  notas: Notas;
  comentarios: Record<string, string>;
  bloqueada: boolean;
}) {
  const GRUPOS = MODELOS[tipo].grupos;
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(GRUPOS.flatMap((g) => g.itens).flatMap((i) => [[chave(i.codigo, "nota"), textoNota(notas[i.codigo])], [chave(i.codigo, "comentario"), comentarios[i.codigo] ?? ""]])),
  );
  const [salvos, setSalvos] = useState(valores);
  const [estados, setEstados] = useState<Record<string, Estado>>({});

  const atuais: Notas = {};
  for (const g of GRUPOS)
    for (const i of g.itens) {
      const n = esquemaNota.safeParse(valores[chave(i.codigo, "nota")] ?? "");
      atuais[i.codigo] = n.success ? n.data : null;
    }
  const r = calcular(atuais, tipo);

  async function salvar(item: string, campo: "nota" | "comentario") {
    const k = chave(item, campo);
    const valor = valores[k] ?? "";
    if (valor === salvos[k] && !estados[k]?.erro) return;
    setEstados((e) => ({ ...e, [k]: { salvando: true } }));
    try {
      const resp = await acaoSalvarCampo({ avaliacaoId, item, campo, valor });
      if (resp.ok) {
        setSalvos((s) => ({ ...s, [k]: valor }));
        setEstados((e) => ({ ...e, [k]: {} }));
      } else setEstados((e) => ({ ...e, [k]: { erro: resp.erro } }));
    } catch {
      setEstados((e) => ({ ...e, [k]: { erro: "Não gravou: sem conexão com o servidor. Tente de novo." } }));
    }
  }

  const campo = (item: string, tipo: "nota" | "comentario", rotulo: string) => {
    const k = chave(item, tipo);
    const est = estados[k] ?? {};
    const props = {
      id: k,
      value: valores[k] ?? "",
      disabled: bloqueada,
      "aria-invalid": est.erro ? true : undefined,
      "aria-describedby": est.erro ? `${k}-erro` : undefined,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValores((v) => ({ ...v, [k]: e.target.value })),
      onBlur: () => salvar(item, tipo),
      className: `w-full border bg-superficie px-1.5 py-1 text-[14px] text-texto disabled:bg-superficie-2 disabled:text-suave ${est.erro ? "border-erro" : "border-borda"}`,
    };
    return (
      <>
        <label htmlFor={k} className="sr-only">
          {rotulo}
        </label>
        {tipo === "nota" ? (
          <input {...props} inputMode="decimal" autoComplete="off" className={`${props.className} text-right tabular-nums`} />
        ) : (
          <textarea {...props} rows={2} className={`${props.className} resize-y`} />
        )}
        {est.salvando && <span className="text-[12px] text-suave">gravando…</span>}
        {est.erro && (
          <span id={`${k}-erro`} role="alert" className="block text-[12px] text-erro">
            {est.erro}
          </span>
        )}
      </>
    );
  };

  return (
    <>
      <div className="overflow-x-auto border border-borda bg-superficie">
        <table className="w-full border-collapse text-[14px] max-sm:block">
          <thead className="max-sm:hidden">
            <tr className="bg-marca text-left text-[12px] text-marca-texto">
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Item</th>
              <th className="px-2 py-2">Fonte</th>
              <th className="w-24 px-2 py-2 text-right">Nota</th>
              <th className="px-2 py-2">Classificação</th>
              <th className="px-2 py-2">Comentário / evidência</th>
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {GRUPOS.map((g, gi) => (
              <Fragment key={g.nome}>
                <tr className="border-t border-borda bg-superficie-2 font-bold max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:gap-x-3 max-sm:px-2 max-sm:py-2">
                  <td colSpan={3} className="px-2 py-2 max-sm:col-span-2 max-sm:p-0">
                    {g.nome} · peso {Math.round(g.peso * 100)}%
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums max-sm:p-0 max-sm:text-left">{formatarNota(r.grupos[gi]!.media)}</td>
                  <td className="px-2 py-2 max-sm:p-0">
                    <Ponto c={r.grupos[gi]!.classificacao} />
                  </td>
                  <td className="max-sm:hidden" />
                </tr>
                {g.itens.map((it) => {
                  const nota = atuais[it.codigo];
                  return (
                    <tr
                      key={it.codigo}
                      className="border-t border-borda align-top max-sm:grid max-sm:grid-cols-[2.75rem_1fr_6rem] max-sm:gap-x-2 max-sm:gap-y-1.5 max-sm:px-2 max-sm:py-2.5"
                    >
                      <td className="px-2 py-2 tabular-nums max-sm:p-0">{it.codigo}</td>
                      <td className="px-2 py-2 max-sm:col-span-2 max-sm:p-0">{it.descricao}</td>
                      <td className="px-2 py-2 max-sm:col-start-2 max-sm:self-center max-sm:p-0">
                        <span className={`rounded-sm px-1.5 py-px text-[11.5px] font-bold whitespace-nowrap ${COR_FONTE[it.fonte]}`}>{FONTES[it.fonte]}</span>
                        {it.fonte === "al" && <span className="mt-1 block text-[11.5px] text-suave">preenchimento automático numa próxima entrega</span>}
                      </td>
                      <td className="px-2 py-1.5 max-sm:row-span-2 max-sm:p-0">{campo(it.codigo, "nota", `Nota do item ${it.codigo}`)}</td>
                      <td className="px-2 py-2 max-sm:col-start-2 max-sm:p-0">
                        <Ponto c={typeof nota === "number" ? classificar(nota) : null} />
                      </td>
                      <td className="min-w-56 px-2 py-1.5 max-sm:col-span-2 max-sm:col-start-2 max-sm:min-w-0 max-sm:p-0">
                        {campo(it.codigo, "comentario", `Comentário do item ${it.codigo}`)}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div aria-live="polite" className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-marca px-4 py-3.5 text-marca-texto">
        <span>Avaliação final</span>
        {r.final === null ? (
          <b className="text-xl">
            faltam {r.faltam} {r.faltam === 1 ? "nota" : "notas"}
          </b>
        ) : (
          <>
            <b className="text-[32px] leading-none tabular-nums">{formatarNota(r.final)}</b>
            <b>{r.classificacao}</b>
          </>
        )}
        <span className="text-[12.5px] opacity-85 sm:ml-auto">{ESCALA}</span>
      </div>
    </>
  );
}
