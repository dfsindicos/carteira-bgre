import { lerFlash } from "@/lib/flash";

export const dynamic = "force-dynamic";

// Os dados do painel (public/flash.html) como script, carregado antes do código do painel. Exige login (middleware).
export async function GET() {
  const dados = await lerFlash();
  // "<" escapado: nenhum texto fecha a tag <script> que carrega isto.
  const corpo = dados
    ? `const DATA = ${JSON.stringify(dados).replace(/</g, "\\u003c")};`
    : `document.body.innerHTML='<p style="padding:24px">Nenhum Flash Report gravado ainda. <a href="/importar">Importar o histórico</a> · <a href="/">Voltar</a></p>';throw new Error("sem dados");`;
  return new Response(corpo, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } });
}
