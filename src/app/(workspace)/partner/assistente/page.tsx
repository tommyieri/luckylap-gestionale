import type { Metadata } from "next";
import { AccessPanel } from "../../../../components/access-panel";
import { PartnerAssistantView } from "../../../../components/partner/partner-assistant-view";
import { RefreshButton } from "../../../../components/refresh-button";
import { PanelActions, WorkspacePanel } from "../../../../components/workspace-panel";
import { requireMember } from "../../../../lib/auth/current-member";
import { partnerAssistantFixture, partnerFixtureId } from "../../../../lib/partner/fixtures";
import { partnerToday } from "../../../../lib/partner/periods";
import {
  loadPartnerAssistantRules,
  loadPartnerAssistantStatus,
  loadPartnerIdsByCo,
} from "../../../../lib/partner/server";
import { isLocalPreviewEnabled } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Assistente" };

/**
 * L'assistente Partner (specifica dell'assistente, «Interfaccia»): stato, modalità, coda, spesa,
 * contatti passati a Tommi e regole in vigore. Si apre dal piede di /partner.
 */
export default async function PartnerAssistantPage() {
  const current = await requireMember();
  const now = new Date();
  const today = partnerToday(now);
  if (current.status === "preview" && isLocalPreviewEnabled()) {
    const { status, rules } = partnerAssistantFixture(today);
    // Nelle righe sintetiche la scheda con il CO n ha l'id partnerFixtureId(n).
    const partnerIds = Object.fromEntries(
      status.toReview.map((item) => [item.co, partnerFixtureId(item.co)]),
    );
    return (
      <PartnerAssistantView
        status={status}
        rules={rules}
        partnerIds={partnerIds}
        today={today}
        now={now.toISOString()}
        preview
        userId={null}
      />
    );
  }
  if (current.status !== "member")
    return (
      <AccessPanel
        status={current.status === "preview" ? "unconfigured" : current.status}
        setup={{
          title: "Partner da collegare.",
          description:
            "L’assistente Partner sta nel database condiviso: servono la configurazione e l’accesso al team.",
        }}
      />
    );
  let loaded: Pick<Parameters<typeof PartnerAssistantView>[0], "status" | "rules" | "partnerIds">;
  try {
    const [status, rules] = await Promise.all([
      loadPartnerAssistantStatus(current.supabase),
      loadPartnerAssistantRules(current.supabase),
    ]);
    const partnerIds = await loadPartnerIdsByCo(
      current.supabase,
      status.toReview.map((item) => item.co),
    );
    loaded = { status, rules, partnerIds };
  } catch {
    return (
      <WorkspacePanel
        title="Assistente non disponibile."
        description="Ricarica la pagina tra poco; nessun dato parziale viene mostrato."
        tone="warning"
      >
        <PanelActions>
          <RefreshButton label="Ricarica" />
        </PanelActions>
      </WorkspacePanel>
    );
  }
  return (
    <PartnerAssistantView
      {...loaded}
      today={today}
      now={now.toISOString()}
      preview={false}
      userId={current.member.userId}
    />
  );
}
