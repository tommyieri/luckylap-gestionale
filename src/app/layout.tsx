import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LuckyLap · Gestionale", template: "%s · LuckyLap" },
  description: "La base operativa di LuckyLap. Inventario, appuntamenti e attività.",
  robots: { index: false, follow: false },
};

/* `viewportFit: "cover"` rende disponibili env(safe-area-inset-*) per fascia e barra in basso. */
export const viewport: Viewport = { themeColor: "#1d4b07", viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
