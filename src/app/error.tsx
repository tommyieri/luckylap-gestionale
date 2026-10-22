"use client";

import Link from "next/link";
import { AuthShell } from "../components/auth-shell";
import { errorDigest } from "../lib/error-digest";

/** Errore fuori dal guscio (accesso, conferma invito). Mai `error.message`. */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = errorDigest(error);
  return (
    <AuthShell
      title="Qualcosa non ha funzionato."
      description="La pagina non si è caricata. Se stavi salvando qualcosa, controlla prima che non sia già presente, poi riprova."
    >
      <div className="setup-actions">
        <button type="button" className="button button-primary" onClick={() => retry()}>
          Riprova
        </button>
        <Link href="/" prefetch={false} className="button button-secondary">
          Vai a Oggi
        </Link>
      </div>
      {digest && <p className="setup-help">Codice per Tommi: {digest}</p>}
    </AuthShell>
  );
}
