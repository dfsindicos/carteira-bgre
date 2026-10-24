import { NextResponse } from "next/server";
import { carregarAvaliacao } from "@/lib/avaliacoes";
import { planilhaBgre } from "@/lib/planilha";
import { formatarPeriodo, lerPeriodo } from "@/lib/scorecard";
import { sessaoAtual } from "@/lib/sessao";

export const dynamic = "force-dynamic";

const nomeDeArquivo = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** "Gerar planilha BGRE": .xlsx da avaliação do trimestre. */
export async function GET(_: Request, { params }: { params: Promise<{ condominioId: string; periodo: string }> }) {
  await sessaoAtual(); // o middleware já exige login; aqui confere de novo, por ser download de dado
  const { condominioId, periodo: texto } = await params;
  const periodo = lerPeriodo(texto);
  const dados = periodo && (await carregarAvaliacao(condominioId, periodo));
  if (!periodo || !dados?.avaliacao) return NextResponse.json({ erro: "Avaliação não encontrada." }, { status: 404 });
  const { condominio, avaliacao: a } = dados;
  const arquivo = await planilhaBgre({
    condominio: condominio.nome,
    contratada: condominio.administradora.nome,
    periodo,
    status: a.status,
    notas: a.notas,
    comentarios: a.comentarios,
  });
  return new NextResponse(new Uint8Array(arquivo), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="BGRE-${nomeDeArquivo(condominio.nome)}-${formatarPeriodo(periodo)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
