"use client";

import Link from "next/link";
import { PanelActions, WorkspacePanel } from "../../../components/workspace-panel";
import styles from "../../../components/workspace-shell.module.css";
import { errorDigest } from "../../../lib/error-digest";

/** Lettura non riuscita: nessun numero parziale, solo «Riprova». Mai `error.message`. */
export default function ConsignmentError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = errorDigest(error);
  return (
    <WorkspacePanel
      title="Non riesco a leggere il conto vendita."
      description="Non mostro dati parziali. Se stavi salvando qualcosa, controlla prima che non sia già presente, poi riprova."
      tone="warning"
    >
      <PanelActions>
        <button type="button" className="button button-primary" onClick={() => retry()}>
          Riprova
        </button>
        <Link href="/" prefetch={false} className="button button-secondary">
          Vai a Oggi
        </Link>
      </PanelActions>
      {digest && <p className={styles.panelCode}>Codice per Tommi: {digest}</p>}
    </WorkspacePanel>
  );
}
