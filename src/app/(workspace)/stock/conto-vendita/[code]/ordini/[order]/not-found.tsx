import Link from "next/link";
import { PanelActions, WorkspacePanel } from "../../../../../../../components/workspace-panel";
import { SHOP_STOCK_HREF } from "../../../../../../../lib/consignment/links";

/** Numero d'ordine che il negozio non ha, o negozio sconosciuto. */
export default function OrderNotFound() {
  return (
    <WorkspacePanel
      title="Ordine non trovato."
      description="Il negozio non ha un ordine con questo numero, oppure il negozio non esiste."
    >
      <PanelActions>
        <Link href={SHOP_STOCK_HREF} prefetch={false} className="button button-primary">
          Apri l’elenco dei negozi
        </Link>
      </PanelActions>
    </WorkspacePanel>
  );
}
