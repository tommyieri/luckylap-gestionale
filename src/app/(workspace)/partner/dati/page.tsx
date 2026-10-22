import type { Metadata } from "next";
import { AccessPanel } from "@/components/access-panel";
import { PartnerDataView } from "@/components/partner/partner-data-view";
import { RefreshButton } from "@/components/refresh-button";
import { PanelActions, WorkspacePanel } from "@/components/workspace-panel";
import { requireMember } from "@/lib/auth/current-member";
import { partnerFixtureData } from "@/lib/partner/fixtures";
import { partnerToday } from "@/lib/partner/periods";
import type { PartnerDataSnapshot } from "@/lib/partner/read";
import { loadPartnerData } from "@/lib/partner/server";
import { isLocalPreviewEnabled } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dati Partner" };

/** Dati, import e lookbook di Partner (spec 02 §5.8). */
export default async function PartnerDataPage() {
  const current = await requireMember();
  const today = partnerToday();
  if (current.status === "preview" && isLocalPreviewEnabled())
    return <PartnerDataView data={partnerFixtureData(today)} today={today} preview userId={null} />;
  if (current.status !== "member")
    return (
      <AccessPanel
        status={current.status === "preview" ? "unconfigured" : current.status}
        setup={{
          title: "Partner da collegare.",
          description:
            "I dati Partner stanno nel database condiviso: servono la configurazione e l’accesso al team.",
        }}
      />
    );
  let data: PartnerDataSnapshot;
  try {
    data = await loadPartnerData(current.supabase);
  } catch {
    return (
      <WorkspacePanel
        title="Dati Partner non disponibili."
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
    <PartnerDataView data={data} today={today} preview={false} userId={current.member.userId} />
  );
}
