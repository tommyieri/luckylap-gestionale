import Link from "next/link";
import { PanelActions, WorkspacePanel } from "../../components/workspace-panel";

/** `notFound()` dentro il gruppo, per esempio `/auth/area/xyz`: la pagina resta nel guscio. */
export default function WorkspaceNotFound() {
  return (
    <WorkspacePanel title="Pagina non trovata." description="L’indirizzo non esiste o è cambiato.">
      <PanelActions>
        <Link href="/" prefetch={false} className="button button-primary">
          Vai a Oggi
        </Link>
      </PanelActions>
    </WorkspacePanel>
  );
}
