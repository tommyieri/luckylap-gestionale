import type { Metadata } from "next";
import { AccessPanel } from "../../../../components/access-panel";
import {
  PartnerAssistantView,
  type PartnerAssistantMailView,
} from "../../../../components/partner/partner-assistant-view";
import { RefreshButton } from "../../../../components/refresh-button";
import { PanelActions, WorkspacePanel } from "../../../../components/workspace-panel";
import { requireMember } from "../../../../lib/auth/current-member";
import {
  PARTNER_ASSISTANT_INACTIVE,
  type PartnerAssistantSendStatus,
} from "../../../../lib/partner/assistant";
import { partnerAssistantConfig } from "../../../../lib/partner-assistant/config";
import { partnerAssistantMailConfig } from "../../../../lib/partner-assistant/mail-config";
import { partnerAssistantFixture, partnerFixtureId } from "../../../../lib/partner/fixtures";
import { partnerToday } from "../../../../lib/partner/periods";
import {
  loadPartnerAssistantRules,
  loadPartnerAssistantSend,
  loadPartnerAssistantStatus,
  loadPartnerIdsByCo,
} from "../../../../lib/partner/server";
import { isLocalPreviewEnabled } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Assistente" };

/**
 * La posta dell'assistente vista da qui: solo esiti e il numero degli indirizzi di prova, mai i
 * valori. Il gruppo «assistente» la pagina lo calcola da sé (scelta 14 del piano): con quel gruppo
 * non valido il worker risponde 503 e non può scriverlo.
 */
function partnerAssistantMailView(): PartnerAssistantMailView {
  const config = partnerAssistantMailConfig();
  return {
    configured: config !== null,
    testRecipients: config?.testTo.length ?? 0,
    assistantConfigured: partnerAssistantConfig() !== null,
  };
}

/**
 * L'assistente Partner (specifica dell'assistente, «Interfaccia»): stato, modalità, prova, invii,
 * limite, coda, spesa, variabili e accessi, contatti passati a Tommi e regole in vigore. Si apre
 * dal piede di /partner.
 */
export default async function PartnerAssistantPage() {
  const current = await requireMember();
  const now = new Date();
  const today = partnerToday(now);
  if (current.status === "preview" && isLocalPreviewEnabled()) {
    const { status, rules, send } = partnerAssistantFixture(today);
    // Nelle righe sintetiche la scheda con il CO n ha l'id partnerFixtureId(n).
    const partnerIds = Object.fromEntries(
      status.toReview.map((item) => [item.co, partnerFixtureId(item.co)]),
    );
    return (
      <PartnerAssistantView
        status={status}
        send={send}
        // In anteprima si vede tutto con le fixture: i comandi restano spenti.
        founder
        mail={{
          configured: true,
          testRecipients: send.envTestCount ?? 0,
          assistantConfigured: true,
        }}
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
  let loaded:
    | Pick<Parameters<typeof PartnerAssistantView>[0], "status" | "send" | "rules" | "partnerIds">
    | typeof PARTNER_ASSISTANT_INACTIVE;
  try {
    // Le regole si leggono insieme allo stato; senza migrazioni non ci sono, e conta lo stato.
    // Lo stato dell'invio ha un catch proprio: senza, le sezioni dell'invio lo dicono e il resto
    // della pagina si vede.
    const [status, rules, send] = await Promise.all([
      loadPartnerAssistantStatus(current.supabase),
      loadPartnerAssistantRules(current.supabase).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      ),
      loadPartnerAssistantSend(current.supabase).catch(
        (): PartnerAssistantSendStatus | null => null,
      ),
    ]);
    if (status === PARTNER_ASSISTANT_INACTIVE) loaded = status;
    else {
      if ("error" in rules) throw rules.error;
      const partnerIds = await loadPartnerIdsByCo(
        current.supabase,
        status.toReview.map((item) => item.co),
      );
      loaded = { status, send, rules: rules.value, partnerIds };
    }
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
  if (loaded === PARTNER_ASSISTANT_INACTIVE)
    return (
      <WorkspacePanel
        title="Assistente non ancora attivo."
        description="L’assistente non è ancora installato nel database: lo attiva Tommi con il passo di avvio. Il resto di Partner funziona come sempre."
      />
    );
  return (
    <PartnerAssistantView
      {...loaded}
      founder={current.member.role === "founder"}
      mail={partnerAssistantMailView()}
      today={today}
      now={now.toISOString()}
      preview={false}
      userId={current.member.userId}
    />
  );
}
