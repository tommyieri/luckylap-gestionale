"use client";

import { PanelActions, WorkspacePanel } from "../../components/workspace-panel";
import styles from "../../components/workspace-shell.module.css";
import { errorDigest } from "../../lib/error-digest";

/** Errore dentro il guscio: il menu resta visibile. Mai `error.message`. */
export default function WorkspaceError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = errorDigest(error);
  return (
    <WorkspacePanel
      title="Qualcosa non ha funzionato."
      description="La pagina non si è caricata. Se stavi salvando qualcosa, controlla prima che non sia già presente, poi riprova."
      tone="warning"
    >
      <PanelActions>
        <button type="button" className="button button-primary" onClick={() => retry()}>
          Riprova
        </button>
      </PanelActions>
      {digest && <p className={styles.panelCode}>Codice per Tommi: {digest}</p>}
    </WorkspacePanel>
  );
}
