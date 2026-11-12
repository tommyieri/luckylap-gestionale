import type { Metadata } from "next";
import { AccessPanel } from "@/components/access-panel";
import { PartnerWorkspace } from "@/components/partner/partner-workspace";
import { RefreshButton } from "@/components/refresh-button";
import { PanelActions, WorkspacePanel } from "@/components/workspace-panel";
import { requireMember } from "@/lib/auth/current-member";
import type {
  PartnerAssistantInactive,
  PartnerAssistantSendStatus,
  PartnerAssistantStatus,
} from "@/lib/partner/assistant";
import { partnerAssistantMailConfig } from "@/lib/partner-assistant/mail-config";
import {
  partnerAssistantFixture,
  partnerFixtureDetail,
  partnerLocalPreview,
} from "@/lib/partner/fixtures";
import type { PartnerDatabaseEstimate } from "@/lib/partner/database";
import { addDays } from "@/lib/partner/dates";
import { loadPartnerEmailProgram } from "@/lib/partner/email-program-server";
import { isPartnerCo } from "@/lib/partner/model";
import { partnerToday } from "@/lib/partner/periods";
import {
  loadPartnerAssistantSend,
  loadPartnerAssistantStatus,
  loadPartnerDetail,
  loadPartnerWorkspace,
} from "@/lib/partner/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Partner" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Primo valore di ogni parametro, solo testi brevi: il resto lo decide parsePartnerView. */
function firstParams(params: Record<string, string | string[] | undefined>) {
  const query: Record<string, string> = {};
  for (const key of [
    "periodo",
    "sezione",
    "stato",
    "chi",
    "q",
    "co",
    "vista",
    "fase",
    "lavoro",
    "paese",
    "priorita",
    "formato",
    "sottotipo",
    "ordine",
    "mese",
    "calendario",
    "storico",
  ]) {
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
 * Filtri e viste condividono una lettura compatta. Il dettaglio iniziale serve i link diretti;
 * le aperture durante la navigazione usano la lettura puntuale /partner/scheda.
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
          assistant={preview.assistant}
          // In anteprima si vede tutto con le fixture: i comandi restano spenti.
          send={partnerAssistantFixture(preview.today).send}
          mailConfigured
          founder
          today={preview.today}
          memberId={preview.memberId}
          defaultOwnerId={preview.memberId}
          estimates={
            preview.workspace.work?.jobs
              .filter((job) => job.status === "pronta" && job.draftId)
              .map((job, index) => ({
                partnerId: job.partnerId,
                day: addDays(preview.today, index + 1),
              })) ?? []
          }
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
  const today = partnerToday();
  // Il simulatore usa la coda intera. L'elenco può apparire prima delle stime.
  const forecast: Promise<PartnerDatabaseEstimate[] | null> = loadPartnerEmailProgram(
    current.supabase,
    addDays(today, -30),
    90,
  )
    .then(({ forecast }) =>
      forecast.items.flatMap((item) =>
        item.state === "prevista" && item.estimatedDay
          ? [{ partnerId: item.partnerId, day: item.estimatedDay }]
          : [],
      ),
    )
    .catch(() => null);
  let loaded: [
    Awaited<ReturnType<typeof loadPartnerWorkspace>>,
    Awaited<ReturnType<typeof loadPartnerDetail>>,
    PartnerAssistantStatus | PartnerAssistantInactive | null,
    PartnerAssistantSendStatus | null,
  ];
  try {
    loaded = await Promise.all([
      loadPartnerWorkspace(current.supabase, { compact: true }),
      co
        ? loadPartnerDetail(current.supabase, co, { latestReply: true }).catch(() => null)
        : Promise.resolve(null),
      // Catch proprio: senza lo stato dell'assistente la striscia lo dice e la pagina resta;
      // senza le sue migrazioni lo stato è «non attivo» e la striscia non c'è.
      loadPartnerAssistantStatus(current.supabase).catch(() => null),
      // Lo stesso per l'invio: senza, in «Prova» e «Invio» la striscia lo dice in ambra.
      loadPartnerAssistantSend(current.supabase).catch(() => null),
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
  const [workspace, detail, assistant, send] = loaded;
  return (
    <PartnerWorkspace
      workspace={workspace}
      detail={detail}
      assistant={assistant}
      send={send}
      mailConfigured={partnerAssistantMailConfig() !== null}
      founder={current.member.role === "founder"}
      today={today}
      forecast={forecast}
      defaultOwnerId={workspace.defaultOwnerId}
      memberId={current.member.userId}
      preview={false}
      query={query}
    />
  );
}
