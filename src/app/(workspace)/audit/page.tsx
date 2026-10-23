import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuditView } from "@/components/audit-view";
import { SensitiveAreaSessionBar } from "@/components/auth-sensitive-area-form";
import { PanelActions, WorkspacePanel } from "@/components/workspace-panel";
import { isSensitiveAreaEligible } from "@/lib/auth/model";
import { verifiedSensitiveAccess } from "@/lib/auth/sensitive-access";
import { verifiedMember } from "@/lib/auth/server";
import { activityQueryFromSearch } from "@/lib/audit/feed-model";
import { loadActivityFeed } from "@/lib/audit/feed-server";
import { previewActivityFeed } from "@/lib/audit/fixtures";
import { isLocalPreviewEnabled } from "@/lib/runtime";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Controllo CEO" };

function AccessState({
  title,
  description,
  verify = false,
  restart = false,
}: {
  title: string;
  description: string;
  verify?: boolean;
  restart?: boolean;
}) {
  return (
    <WorkspacePanel title={title} description={description}>
      {(verify || restart) && (
        <PanelActions>
          {verify && (
            <Link className="button button-primary" href="/auth/account" prefetch={false}>
              Verifica il tuo account
            </Link>
          )}
          {restart && (
            <Link className="button button-primary" href="/audit" prefetch={false}>
              Apri le attività recenti
            </Link>
          )}
        </PanelActions>
      )}
    </WorkspacePanel>
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Anteprima locale: frasi sintetiche delle ultime 24 ore, nessuna chiamata a Supabase.
  if (isLocalPreviewEnabled()) {
    let previewQuery;
    try {
      previewQuery = activityQueryFromSearch(await searchParams);
    } catch {
      return (
        <AccessState
          title="Il collegamento alle attività non è valido."
          description="Apri le attività più recenti e seleziona di nuovo i filtri."
          restart
        />
      );
    }
    return (
      <AuditView
        snapshot={previewActivityFeed(new Date(), previewQuery)}
        query={previewQuery}
        preview
      />
    );
  }
  try {
    getSupabasePublicConfig();
  } catch {
    return (
      <AccessState
        title="Il controllo attende il collegamento."
        description="Le attività saranno disponibili dopo la configurazione del workspace e degli accessi del team."
      />
    );
  }
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase).catch(() => ({ status: "unavailable" as const }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status === "unavailable")
    return (
      <AccessState
        title="Verifica dell’accesso non disponibile."
        description="Non è stato possibile verificare l’accesso alle attività. Riprova tra poco."
      />
    );
  if (access.status !== "member" || !isSensitiveAreaEligible(access.member, "audit"))
    return (
      <AccessState
        title="Controllo riservato al team."
        description="Per leggere le attività servono un account del team attivo e la password CEO."
      />
    );
  const unlocked = await verifiedSensitiveAccess(supabase, access.member, "audit").catch(
    () => null,
  );
  if (unlocked === null)
    return (
      <AccessState
        title="Verifica della sessione non disponibile."
        description="Riprova dal tuo account prima di aprire le attività."
        verify
      />
    );
  if (!unlocked) redirect("/auth/area/audit");
  let query;
  try {
    query = activityQueryFromSearch(await searchParams);
  } catch {
    return (
      <AccessState
        title="Il collegamento alle attività non è valido."
        description="Apri le attività più recenti e seleziona di nuovo i filtri per riprendere la lettura."
        restart
      />
    );
  }
  const snapshot = await loadActivityFeed(supabase, access.member, unlocked, query).catch(
    () => null,
  );
  if (!snapshot)
    return (
      <AccessState
        title="Attività non disponibili."
        description="La lettura delle attività non è riuscita. Riapri la pagina tra poco; nessun contenuto parziale viene mostrato."
        restart
      />
    );
  return (
    <>
      <SensitiveAreaSessionBar area="audit" />
      <AuditView snapshot={snapshot} query={query} />
    </>
  );
}
