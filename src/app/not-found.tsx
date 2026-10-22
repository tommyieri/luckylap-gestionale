import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "../components/auth-shell";
import styles from "../components/auth.module.css";

export const metadata: Metadata = { title: { absolute: "Pagina non trovata · LuckyLap" } };

/** Indirizzi che non esistono: fuori dal guscio, perché la sessione non è verificata. */
export default function NotFound() {
  return (
    <AuthShell title="Pagina non trovata." description="L’indirizzo non esiste o è cambiato.">
      <div className={styles.actions}>
        <Link href="/" prefetch={false} className="button button-primary">
          Vai a Oggi
        </Link>
      </div>
    </AuthShell>
  );
}
