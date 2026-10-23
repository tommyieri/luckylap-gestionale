import Link from "next/link";
import { PanelActions, WorkspacePanel } from "../../../../../components/workspace-panel";

/** Riordine sconosciuto, dentro il guscio. */
export default function RestockNotFound() {
  return (
    <WorkspacePanel
      title="Riordine non trovato."
      description="Il riordine non esiste o il link non è completo."
    >
      <PanelActions>
        <Link href="/stock/riassortimento" prefetch={false} className="button button-primary">
          Apri l’elenco dei riordini
        </Link>
      </PanelActions>
    </WorkspacePanel>
  );
}
