import { CartaoEntrada } from "@/components/cartao-entrada";

export default async function Entrar({ searchParams }: { searchParams: Promise<{ next?: string; erro?: string }> }) {
  const { next, erro } = await searchParams;
  return (
    <CartaoEntrada titulo="Carteira BGRE" subtitulo="Avaliação trimestral dos condomínios da carteira BGRE">
      <a
        href={`/api/auth/microsoft?next=${encodeURIComponent(next ?? "/")}`}
        className="flex h-12 w-full items-center justify-center gap-3 rounded-md bg-marca px-4 text-base font-bold text-marca-texto hover:bg-marca/90"
      >
        <span aria-hidden="true" className="grid grid-cols-2 gap-0.5">
          <span className="size-2 bg-[#f25022]" />
          <span className="size-2 bg-[#7fba00]" />
          <span className="size-2 bg-[#00a4ef]" />
          <span className="size-2 bg-[#ffb900]" />
        </span>
        Entrar com a conta Microsoft
      </a>
      {erro === "acesso" && (
        <p role="alert" className="text-sm text-erro">
          Esta conta não tem acesso à Carteira BGRE. O sistema é só da equipe da DF Síndicos.
        </p>
      )}
      {erro === "microsoft" && (
        <p role="alert" className="text-sm text-erro">
          Não foi possível entrar com a Microsoft. Tente de novo; só contas da DF Síndicos têm acesso.
        </p>
      )}
    </CartaoEntrada>
  );
}
