"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const MENU = [
  { href: "/", rotulo: "Painel" },
  { href: "/avaliacao", rotulo: "Avaliação trimestral" },
  { href: "/flash", rotulo: "Flash Report" },
  { href: "/cadastro", rotulo: "Cadastro" },
  { href: "/importar", rotulo: "Importar" },
];

/** Faixa azul-marinho do protótipo: nome do sistema, menu (ativo sublinhado em dourado), volta ao menu de sistemas e sair. */
export function Cabecalho({ nome }: { nome: string }) {
  const caminho = usePathname();
  const ativo = (href: string) => (href === "/" ? caminho === "/" : caminho.startsWith(href));
  return (
    <header className="bg-marca text-marca-texto">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
        <Link href="/" className="font-bold tracking-wide">
          CARTEIRA BGRE
        </Link>
        <nav aria-label="Menu" className="order-3 flex w-full flex-wrap gap-x-4 gap-y-1 text-[14px] sm:order-none sm:w-auto">
          {MENU.map((m) => {
            // O Flash Report é página estática (public/flash.html): navegação comum, sem o roteador do Next.
            const L = m.href === "/flash" ? "a" : Link;
            return (
              <L
                key={m.href}
                href={m.href}
                aria-current={ativo(m.href) ? "page" : undefined}
                className={`border-b-2 py-1 ${ativo(m.href) ? "border-ouro" : "border-transparent opacity-85 hover:opacity-100"}`}
              >
                {m.rotulo}
              </L>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-[13px]">
          <span className="hidden max-w-48 truncate opacity-80 md:inline" title={nome}>
            {nome}
          </span>
          <a href="https://gestaodfsindicos.tech" className="border border-white/50 px-2.5 py-1 hover:bg-white/10">
            ← Menu
          </a>
          <form action="/api/auth/sair" method="post">
            <button className="border border-white/50 px-2.5 py-1 hover:bg-white/10">Sair</button>
          </form>
        </div>
      </div>
    </header>
  );
}
