import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LuckyLap · Gestionale", template: "%s · LuckyLap" },
  description: "La base operativa di LuckyLap. Inventario, appuntamenti e attività.",
  robots: { index: false, follow: false },
  /* Sulla schermata Home di iPhone il nome è «LuckyLap», non il titolo della pagina aperta. */
  appleWebApp: { capable: true, title: "LuckyLap", statusBarStyle: "default" },
};

/* `viewportFit: "cover"` rende disponibili env(safe-area-inset-*) per fascia e barra in basso. */
export const viewport: Viewport = { themeColor: "#1d4b07", viewportFit: "cover" };

/*
 * `data-scroll-behavior="smooth"`: Next 16 toglie lo scorrimento morbido solo durante i cambi
 * di pagina, così la nuova pagina parte subito dalla cima; le ancore nella stessa pagina restano morbide.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
