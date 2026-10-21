import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LuckyLap · Gestionale",
  description: "La base operativa di LuckyLap. Inventario, appuntamenti e attività.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="it"><body>{children}</body></html>;
}
