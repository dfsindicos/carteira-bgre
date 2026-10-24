import { Cabecalho } from "@/components/cabecalho";
import { sessaoAtual } from "@/lib/sessao";

export const dynamic = "force-dynamic";

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const { nome } = await sessaoAtual();
  return (
    <div className="min-h-dvh">
      <Cabecalho nome={nome} />
      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-5">{children}</main>
    </div>
  );
}
