import { signOut } from "../app/auth/actions";
import { RefreshButton } from "./refresh-button";
import { PanelActions, WorkspacePanel } from "./workspace-panel";

/**
 * Stati di accesso comuni alle pagine nuove che usano `requireMember()`
 * (Oggi, Magazzino, Partner): configurazione mancante, account non abilitato,
 * verifica non riuscita. «Esci» resta solo nello stato «Account non abilitato».
 */
export function AccessPanel({
  status,
  setup,
  unavailableTitle = "Verifica temporaneamente non disponibile.",
}: {
  status: "unconfigured" | "denied" | "unavailable";
  setup: { title: string; description: string };
  unavailableTitle?: string;
}) {
  if (status === "unconfigured")
    return <WorkspacePanel title={setup.title} description={setup.description} />;
  if (status === "denied")
    return (
      <WorkspacePanel
        title="Account non abilitato."
        description="Serve un’abilitazione attiva al team LuckyLap. Rivolgiti a Tommi per verificare il tuo accesso."
        tone="warning"
      >
        <PanelActions>
          <form action={signOut}>
            <button className="button button-secondary">Esci</button>
          </form>
        </PanelActions>
      </WorkspacePanel>
    );
  return (
    <WorkspacePanel
      title={unavailableTitle}
      description="Non è stato possibile verificare l’accesso al team. Riprova tra poco."
      tone="warning"
    >
      <PanelActions>
        <RefreshButton />
      </PanelActions>
    </WorkspacePanel>
  );
}
