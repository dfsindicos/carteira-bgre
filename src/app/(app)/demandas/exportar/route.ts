import { NextResponse } from "next/server";
import { listarDemandas } from "@/lib/demandas";
import { planilhaDemandas } from "@/lib/planilha-demandas";
import { dataSP } from "@/lib/avaliacoes";
import { sessaoAtual } from "@/lib/sessao";

export const dynamic = "force-dynamic";

/** "Exportar Excel": as demandas do filtro da página, na mesma ordem. */
export async function GET(req: Request) {
  await sessaoAtual(); // o middleware já exige login; aqui confere de novo, por ser download de dado
  // Os mesmos parâmetros da página (situação, filtros, busca e ordem): a planilha sai como a lista está na tela.
  const { linhas } = await listarDemandas(Object.fromEntries(new URL(req.url).searchParams));
  const nome = `Demandas-BGRE-${dataSP(new Date())}.xlsx`;
  return new NextResponse(new Uint8Array(await planilhaDemandas(linhas)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
