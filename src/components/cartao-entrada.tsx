import { BotaoMenu } from "./botao-menu";

// Tela de entrada padrão dos sistemas da DF (modelo B, decisão do usuário de 2026-10-22): cartão central com a logo,
// filete dourado e o nome do sistema. O mesmo desenho vale para Action Log, Aprovações e Vistorias.
export function CartaoEntrada({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center gap-5 px-4 py-6 sm:justify-center sm:py-10">
      <BotaoMenu className="-mb-1 self-end sm:absolute sm:top-4 sm:right-4 sm:mb-0" />
      <main className="w-full max-w-md rounded-xl border-t-4 border-ouro bg-superficie px-5 pt-7 pb-6 sm:px-9 sm:pt-10">
        {/* Logo completa: colorida no claro, branca no escuro (padrão visual da DF). */}
        <picture>
          <source srcSet="/logo-df-completa-branca.png" media="(prefers-color-scheme: dark)" />
          <img src="/logo-df-completa.png" alt="DF Síndicos Profissionais" width={170} height={108} className="mx-auto h-auto w-[150px] sm:w-[170px]" />
        </picture>
        <div className="my-6 h-px bg-borda" />
        <p className="text-center text-[11px] font-bold tracking-[0.16em] text-ouro uppercase">Acesso</p>
        <h1 className="mt-1 text-center text-2xl font-bold">{titulo}</h1>
        {subtitulo && <p className="mt-1 text-center text-sm text-suave">{subtitulo}</p>}
        {children && <div className="mt-6 flex flex-col gap-4">{children}</div>}
      </main>
      <p className="text-center text-xs text-suave">DF Síndicos Profissionais · Acesso restrito</p>
    </div>
  );
}
