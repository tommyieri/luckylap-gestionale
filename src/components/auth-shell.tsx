import type { ReactNode } from "react";
import styles from "./auth.module.css";

export function AuthShell({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <main className="setup-page"><section className={`setup-panel ${styles.panel}`}><span className="wordmark">LuckyLap</span><span className={styles.eyebrow}>Workspace del team</span><h1>{title}</h1><p>{description}</p>{children}</section></main>;
}
