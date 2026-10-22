import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import styles from "./workspace-shell.module.css";

/**
 * Pannello di stato dentro il guscio (errore, accesso negato, area chiusa).
 * Stessa firma di `AuthShell`, senza hook: lo usano pagine server ed `error.tsx`.
 * Nessun sopratitolo e nessun link indietro: il menu è sempre lì.
 */
export function WorkspacePanel({
  title,
  description,
  children,
  tone = "info",
}: {
  title: string;
  description: string;
  children?: ReactNode;
  tone?: "info" | "warning";
}) {
  return (
    <section className={`${styles.panel} ${tone === "warning" ? styles.panelWarning : ""}`}>
      <h1 className={styles.panelTitle}>
        {tone === "warning" && (
          <TriangleAlert className={styles.panelIcon} size={24} strokeWidth={1.8} aria-hidden />
        )}
        {title}
      </h1>
      {description && <p className={styles.panelText}>{description}</p>}
      {children}
    </section>
  );
}

/** Riga di pulsanti sotto il testo del pannello: a tutta larghezza sul telefono. */
export function PanelActions({ children }: { children: ReactNode }) {
  return <div className={styles.panelActions}>{children}</div>;
}
