import type { Metadata } from "next";
import { AccessPanel } from "@/components/access-panel";
import { PartnerWorkspace } from "@/components/partner/partner-workspace";
import { RefreshButton } from "@/components/refresh-button";
import { PanelActions, WorkspacePanel } from "@/components/workspace-panel";
import { requireMember } from "@/lib/auth/current-member";
import { partnerFixtureDetail, partnerLocalPreview } from "@/lib/partner/fixtures";
import { isPartnerCo, type PartnerDetail } from "@/lib/partner/model";
import { partnerToday } from "@/lib/partner/periods";
import { loadPartnerDetail, loadPartnerWorkspace } from "@/lib/partner/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Partner" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Primo valore di ogni parametro, solo testi brevi: il resto lo decide parsePartnerView. */
function firstParams(params: Record<string, string | string[] | undefined>) {
  const query: Record<string, string> = {};
  for (const key of ["periodo", "sezione", "stato", "chi", "q", "co", "vista"]) {
    const value = params[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string" && first.length <= 200) query[key] = first;
  }
  return query;
}

function coFrom(query: Record<string, string>): number | null {
  if (!/^[1-9][0-9]{0,4}$/.test(query.co ?? "")) return null;
  const co = Number(query.co);
  return isPartnerCo(co) ? co : null;
}

/**
 * Partner (spec 02 §5): il roadbook dei contatti dentro il guscio. Filtri, periodo e sezione
 * lavorano nel browser; `co` nell'indirizzo apre i dettagli, letti qui dal server.
 */
export default async function PartnerPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, current] = await Promise.all([searchParams, requireMember()]);
  const query = firstParams(params);
  const co = coFrom(query);
  if (current.status === "preview") {
    const preview = partnerLocalPreview();
    if (preview)
      return (
        <PartnerWorkspace
          workspace={preview.workspace}
          detail={co ? partnerFixtureDetail(co, preview.today) : null}
          today={preview.today}
          memberId={preview.memberId}
          preview
          query={query}
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
            "I contatti Partner stanno nel database condiviso: servono la configurazione e l’accesso al team.",
        }}
      />
    );
  let loaded: [Awaited<ReturnType<typeof loadPartnerWorkspace>>, PartnerDetail | null];
  try {
    loaded = await Promise.all([
      loadPartnerWorkspace(current.supabase),
      co ? loadPartnerDetail(current.supabase, co) : Promise.resolve(null),
    ]);
  } catch {
    return (
      <WorkspacePanel
        title="Partner non disponibile."
        description="Ricarica la pagina tra poco; nessun dato parziale viene mostrato."
        tone="warning"
      >
        <PanelActions>
          <RefreshButton label="Ricarica" />
        </PanelActions>
      </WorkspacePanel>
    );
  }
  const [workspace, detail] = loaded;
  return (
    <PartnerWorkspace
      workspace={workspace}
      detail={detail}
      today={partnerToday()}
      memberId={current.member.userId}
      preview={false}
      query={query}
    />
  );
}
