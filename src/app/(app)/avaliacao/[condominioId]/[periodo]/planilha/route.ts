import { NextResponse } from "next/server";
import { carregarAvaliacao } from "@/lib/avaliacoes";
import { carregarModelo, preencherModelo } from "@/lib/modelo-bgre";
import { planilhaBgre } from "@/lib/planilha";
import { CONTRATADA_SINDICANCIA, formatarPeriodo, lerPeriodo, lerTipo, mesesDoPeriodo } from "@/lib/scorecard";
import { sessaoAtual } from "@/lib/sessao";

export const dynamic = "force-dynamic";

const nomeDeArquivo = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** "Gerar planilha BGRE": .xlsx da avaliação do trimestre (?tipo=SINDICANCIA para a da Sindicância). */
export async function GET(req: Request, { params }: { params: Promise<{ condominioId: string; periodo: string }> }) {
  await sessaoAtual(); // o middleware já exige login; aqui confere de novo, por ser download de dado
  const { condominioId, periodo: texto } = await params;
  const periodo = lerPeriodo(texto);
  // lerTipo só aceita os dois valores conhecidos (qualquer outro = Administradora).
  const tipo = lerTipo(new URL(req.url).searchParams.get("tipo"));
  const dados = periodo && (await carregarAvaliacao(condominioId, periodo, tipo));
  if (!periodo || !dados?.avaliacao) return NextResponse.json({ erro: "Avaliação não encontrada." }, { status: 404 });
  const { condominio, avaliacao: a } = dados;
  const d = {
    tipo,
    condominio: condominio.nome,
    contratada: tipo === "SINDICANCIA" ? CONTRATADA_SINDICANCIA : condominio.administradora.nome,
    periodo,
    status: a.status,
    notas: a.notas,
    comentarios: a.comentarios,
  };
  // Com o modelo oficial da BGRE enviado no Cadastro, sai nele, com o nome de arquivo que a BGRE usa; sem, no formato da DF.
  const modelo = await carregarModelo(tipo);
  const arquivo = modelo ? await preencherModelo(modelo, { ...d, meses: mesesDoPeriodo(periodo) }) : await planilhaBgre(d);
  const nome = modelo
    ? `${condominio.nome} - ${formatarPeriodo(periodo)} - Planilha de Avaliação ${tipo === "SINDICANCIA" ? "Sindicância" : "Administração"}.xlsx`
    : `BGRE-${tipo === "SINDICANCIA" ? "Sindicancia-" : ""}${nomeDeArquivo(condominio.nome)}-${formatarPeriodo(periodo)}.xlsx`;
  return new NextResponse(new Uint8Array(arquivo), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeDeArquivo(nome)}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "Cache-Control": "no-store",
    },
  });
}
