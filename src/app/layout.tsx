import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Carteira BGRE · DF Síndicos",
  description: "Avaliação trimestral dos condomínios da carteira BGRE",
  icons: { icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/icon-df-192.png", type: "image/png", sizes: "192x192" }], apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f2a4a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
