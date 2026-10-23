import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DevelopmentView } from "../../../components/development-view";
import { WorkspacePanel } from "../../../components/workspace-panel";
import { verifiedMember } from "../../../lib/auth/server";
import { getSupabasePublicConfig } from "../../../lib/supabase/config";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { loadDevelopment } from "../../../lib/development/server";
import {
  PREVIEW_DEVELOPMENT_USER,
  previewDevelopmentMembers,
  previewDevelopmentPhotos,
  previewDevelopmentProjects,
} from "../../../lib/development/fixtures";
import { isLocalPreviewEnabled } from "../../../lib/runtime";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nuovi prodotti" };
function State({ title, description }: { title: string; description: string }) {
  return <WorkspacePanel title={title} description={description} />;
}
export default async function DevelopmentPage() {
  // Anteprima locale (00-sequenza §1.5): dati e immagini sintetici, nessuna chiamata a Supabase.
  if (isLocalPreviewEnabled())
    return (
      <DevelopmentView
        projects={previewDevelopmentProjects()}
        members={previewDevelopmentMembers()}
        photos={previewDevelopmentPhotos()}
        displayName="Anteprima"
        userId={PREVIEW_DEVELOPMENT_USER}
        config={{ url: "http://127.0.0.1:54321", publishableKey: "anteprima-locale" }}
        operationId={randomUUID()}
        preview
      />
    );
  let config;
  try {
    config = getSupabasePublicConfig();
  } catch {
    return (
      <State
        title="Lo sviluppo attende il collegamento."
        description="Le schede condivise saranno disponibili dopo la configurazione del workspace."
      />
    );
  }
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase).catch(() => ({ status: "unavailable" as const }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status !== "member")
    return (
      <State
        title="Lo sviluppo è riservato al team."
        description="Accedi con un account abilitato. Se la verifica non è disponibile, riprova tra poco."
      />
    );
  const snapshot = await loadDevelopment(supabase).catch(() => null);
  if (!snapshot)
    return (
      <State
        title="Schede prodotto non disponibili."
        description="La lettura completa non è riuscita. Ricarica tra poco; nessuna scheda parziale viene mostrata."
      />
    );
  return (
    <DevelopmentView
      projects={snapshot.projects}
      members={snapshot.members}
      photos={snapshot.photos}
      displayName={access.member.displayName}
      userId={access.member.userId}
      config={config}
      operationId={randomUUID()}
    />
  );
}
