"use client";

import { useRouter } from "next/navigation";

/** "← Voltar": volta à página de onde a pessoa veio (mapa, lista do trimestre ou painel); aberto numa aba nova, vai para `href`. */
export function BotaoVoltar({ href }: { href: string }) {
  const router = useRouter();
  return (
    <a
      href={href}
      onClick={(e) => {
        // A navegação interna do Next não muda o document.referrer; o histórico da aba é o que diz se há para onde voltar.
        if (history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
      className="w-fit text-[13.5px] text-suave hover:underline"
    >
      ← Voltar
    </a>
  );
}
