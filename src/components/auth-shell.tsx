import type { ReactNode } from "react";

/*
 * Stili solo in globals.css (`.setup-*`), nessun modulo CSS: le pagine radice not-found ed
 * error usano AuthShell, e Next precarica il CSS dei confini radice su ogni pagina.
 */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <main className="setup-page">
      <section className="setup-panel">
        <span className="wordmark">LuckyLap</span>
        <span className="setup-eyebrow">Workspace del team</span>
        <h1>{title}</h1>
        <p>{description}</p>
        {children}
      </section>
    </main>
  );
}
