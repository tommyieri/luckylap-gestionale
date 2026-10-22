import Link from "next/link";
import { PanelActions, WorkspacePanel } from "../../../../components/workspace-panel";

/** Codice negozio sconosciuto, dentro il guscio. */
export default function ShopNotFound() {
  return (
    <WorkspacePanel
      title="Negozio non trovato."
      description="Il codice non corrisponde a nessun negozio in conto vendita, oppure la pagina non esiste."
    >
      <PanelActions>
        <Link href="/consignment" prefetch={false} className="button button-primary">
          Apri l’elenco dei negozi
        </Link>
      </PanelActions>
    </WorkspacePanel>
  );
}
