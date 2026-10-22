import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { AccessPanel } from "@/components/access-panel";
import { PanelActions, WorkspacePanel } from "@/components/workspace-panel";
import { requireMember } from "@/lib/auth/current-member";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Partner" };

/**
 * Pagina provvisoria: la tappa Partner sostituisce tutta la cartella
 * `src/app/(workspace)/partner/` (docs: 01-layout §8.4). Nessuna lettura di dati.
 */
export default async function PartnerPage() {
  const current = await requireMember();
  if (current.status !== "member" && current.status !== "preview")
    return (
      <AccessPanel
        status={current.status}
        setup={{
          title: "Partner da collegare.",
          description:
            "Il progetto Partner sarà disponibile dopo la configurazione del workspace condiviso.",
        }}
      />
    );
  return (
    <WorkspacePanel
      title="Partner"
      description="Il progetto Partner entra nel gestionale con la sua tappa. Fino ad allora il roadbook resta online."
    >
      <PanelActions>
        <a
          href="https://tommyieri.github.io/luckylap-partner/"
          target="_blank"
          rel="noreferrer"
          className="button button-primary"
        >
          Apri il roadbook
          <ExternalLink size={16} strokeWidth={1.8} aria-hidden />
          <span className="sr-only">(si apre in una nuova scheda)</span>
        </a>
      </PanelActions>
    </WorkspacePanel>
  );
}
