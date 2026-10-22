import Link from "next/link";
import { PanelActions, WorkspacePanel } from "../../../../../../components/workspace-panel";

/** Numero d'ordine che il negozio non ha, o negozio sconosciuto. */
export default function OrderNotFound() {
  return (
    <WorkspacePanel
      title="Ordine non trovato."
      description="Il negozio non ha un ordine con questo numero, oppure il negozio non esiste."
    >
      <PanelActions>
        <Link href="/consignment" prefetch={false} className="button button-primary">
          Apri l’elenco dei negozi
        </Link>
      </PanelActions>
    </WorkspacePanel>
  );
}
