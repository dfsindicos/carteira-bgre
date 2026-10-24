// Volta à página inicial da VPS, com os blocos de escolha de sistema. Link simples, na mesma aba.
export function BotaoMenu({ className = "" }: { className?: string }) {
  return (
    <a
      href="https://gestaodfsindicos.tech"
      aria-label="Voltar ao menu de sistemas"
      title="Voltar ao menu de sistemas"
      className={`inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-borda bg-superficie px-2.5 text-sm font-bold text-titulo hover:bg-marca-suave ${className}`}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      <span className="hidden sm:inline">Menu</span>
    </a>
  );
}
