import Link from "next/link";
import { PanelActions, WorkspacePanel } from "../../../../../../components/workspace-panel";

/** Mese scritto male nell'indirizzo («2026-13»), o negozio sconosciuto. */
export default function ReportNotFound() {
  return (
    <WorkspacePanel
      title="Resoconto non trovato."
      description="L’indirizzo deve indicare un negozio esistente e un mese nella forma 2026-10."
    >
      <PanelActions>
        <Link href="/consignment" prefetch={false} className="button button-primary">
          Apri l’elenco dei negozi
        </Link>
      </PanelActions>
    </WorkspacePanel>
  );
}
