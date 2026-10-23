import Link from "next/link";
import { PanelActions, WorkspacePanel } from "../../../../../components/workspace-panel";
import { SHOP_STOCK_HREF } from "../../../../../lib/consignment/links";

/** Codice negozio sconosciuto, dentro il guscio. */
export default function ShopStockNotFound() {
  return (
    <WorkspacePanel
      title="Negozio non trovato."
      description="Il codice non corrisponde a nessun negozio in conto vendita, oppure la pagina non esiste."
    >
      <PanelActions>
        <Link href={SHOP_STOCK_HREF} prefetch={false} className="button button-primary">
          Apri l’elenco dei negozi
        </Link>
      </PanelActions>
    </WorkspacePanel>
  );
}
