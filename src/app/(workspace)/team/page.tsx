import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TeamWorkspace } from "@/components/team-workspace";
import { PanelActions, WorkspacePanel } from "@/components/workspace-panel";
import { verifiedMember } from "@/lib/auth/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { teamLocalPreview } from "@/lib/team/fixtures";
import { loadTeamWorkspace } from "@/lib/team/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Team" };

function AccessState({
  title,
  description,
  reload = false,
}: {
  title: string;
  description: string;
  reload?: boolean;
}) {
  return (
    <WorkspacePanel title={title} description={description}>
      {reload && (
        <PanelActions>
          <Link className="button button-primary" href="/team" prefetch={false}>
            Ricarica il team
          </Link>
        </PanelActions>
      )}
    </WorkspacePanel>
  );
}

export default async function TeamPage() {
  // Anteprima locale: dati sintetici, salvataggio disattivato, nessuna chiamata a Supabase.
  const preview = teamLocalPreview();
  if (preview)
    return (
      <TeamWorkspace
        snapshot={preview.snapshot}
        displayName="Anteprima locale"
        loadedAt={preview.loadedAt}
        preview
      />
    );
  try {
    getSupabasePublicConfig();
  } catch {
    return (
      <AccessState
        title="Il team attende il collegamento."
        description="Il calendario, le attività e le note condivise saranno disponibili dopo la configurazione del workspace. Gli appunti locali restano nel browser e non vengono importati automaticamente."
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
        description="Non è stato possibile verificare il tuo account. Ricarica la pagina tra poco."
        reload
      />
    );
  if (access.status !== "member")
    return (
      <AccessState
        title="Il team è riservato ai membri abilitati."
        description="Accedi con l’account autorizzato per leggere e aggiornare il lavoro condiviso di LuckyLap."
      />
    );
  const snapshot = await loadTeamWorkspace(supabase).catch(() => null);
  if (!snapshot)
    return (
      <AccessState
        title="Il team non è disponibile."
        description="Non è stato possibile leggere completamente calendario, attività e note. Ricarica la pagina tra poco; nessun dato parziale viene mostrato."
        reload
      />
    );
  return (
    <TeamWorkspace
      snapshot={snapshot}
      displayName={access.member.displayName}
      loadedAt={new Date().toISOString()}
    />
  );
}
