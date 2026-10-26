import type { NextConfig } from "next";

const emProducao = process.env.NODE_ENV === "production";

// Em desenvolvimento o Next precisa de eval e websocket; em produção a política é fechada.
// 'unsafe-inline' em script/estilo é exigência da hidratação do Next sem nonce; o resto limita origens, frames e formulários.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${emProducao ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${emProducao ? "" : " ws: wss:"}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const config: NextConfig = {
  // Imagem enxuta (server.js + dependências mínimas) para o contêiner da VPS.
  output: "standalone",
  poweredByHeader: false,
  // O painel do Flash Report é o HTML do artefato (public/flash.html), com os dados em /flash/dados.js.
  async rewrites() {
    return [{ source: "/flash", destination: "/flash.html" }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // O navegador ignora o HSTS em http (desenvolvimento local); em https passa a exigir https por um ano.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default config;
