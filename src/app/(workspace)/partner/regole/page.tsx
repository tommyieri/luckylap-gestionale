import type { Metadata } from "next";
import { AccessPanel } from "@/components/access-panel";
import { PartnerRulesView } from "@/components/partner/partner-rules";
import { RefreshButton } from "@/components/refresh-button";
import { PanelActions, WorkspacePanel } from "@/components/workspace-panel";
import { requireMember } from "@/lib/auth/current-member";
import { partnerFixtureRules } from "@/lib/partner/fixtures";
import { partnerToday } from "@/lib/partner/periods";
import type { PartnerRules } from "@/lib/partner/read";
import { loadPartnerRules } from "@/lib/partner/server";
import { isLocalPreviewEnabled } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Regole per scrivere" };

/** Regole per scrivere i messaggi: CONTESTO.md dell'ultimo import (spec 02 §5.9). */
export default async function PartnerRulesPage() {
  const current = await requireMember();
  const today = partnerToday();
  if (current.status === "preview" && isLocalPreviewEnabled())
    return <PartnerRulesView rules={partnerFixtureRules(today)} today={today} preview />;
  if (current.status !== "member")
    return (
      <AccessPanel
        status={current.status === "preview" ? "unconfigured" : current.status}
        setup={{
          title: "Partner da collegare.",
          description:
            "Le regole arrivano con l’import della ricerca nel database condiviso: servono la configurazione e l’accesso al team.",
        }}
      />
    );
  let rules: PartnerRules | null;
  try {
    rules = await loadPartnerRules(current.supabase);
  } catch {
    return (
      <WorkspacePanel
        title="Regole non disponibili."
        description="Ricarica la pagina tra poco; nessun dato parziale viene mostrato."
        tone="warning"
      >
        <PanelActions>
          <RefreshButton label="Ricarica" />
        </PanelActions>
      </WorkspacePanel>
    );
  }
  return <PartnerRulesView rules={rules} today={today} preview={false} />;
}
