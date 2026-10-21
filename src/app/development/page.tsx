import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "../../components/auth-shell";
import { DevelopmentView } from "../../components/development-view";
import { verifiedMember } from "../../lib/auth/server";
import { getSupabasePublicConfig } from "../../lib/supabase/config";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { loadDevelopment } from "../../lib/development/server";
import shared from "../../components/team-workspace.module.css";
export const dynamic = "force-dynamic";
function State({ title, description }: { title: string; description: string }) {
  return (
    <AuthShell title={title} description={description}>
      <div className={shared.accessActions}>
        <Link href="/" className="button button-secondary">
          Torna al workspace
        </Link>
      </div>
    </AuthShell>
  );
}
export default async function DevelopmentPage() {
  try {
    getSupabasePublicConfig();
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
      displayName={access.member.displayName}
      operationId={randomUUID()}
    />
  );
}
