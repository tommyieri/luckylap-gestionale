import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PartnerWorkLinks } from "@/components/partner-work-links";
import { PanelActions, WorkspacePanel } from "@/components/workspace-panel";
import { readPartnerWorkLinks } from "@/lib/work-links/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Partner nel Team" };

export default async function PartnerWorkPage() {
  try {
    getSupabasePublicConfig();
  } catch {
    return (
      <WorkspacePanel
        title="I collegamenti attendono il workspace."
        description="Gli appuntamenti e i prossimi passi Partner saranno disponibili dopo la configurazione dell’accesso condiviso."
      />
    );
  }
  const result = await readPartnerWorkLinks(await createSupabaseServerClient()).catch(() => null);
  if (result?.status === "signed-out") redirect("/auth/login");
  if (result && result.status !== "ready" && result.status !== "unavailable")
    return (
      <WorkspacePanel
        title="Il Team è riservato ai membri abilitati."
        description="Accedi con l’account autorizzato per collegare le schede Partner al lavoro condiviso."
      />
    );
  if (!result || result.status !== "ready")
    return (
      <WorkspacePanel
        title="Collegamenti Partner non disponibili."
        description="La lettura completa delle schede e dei collegamenti non è riuscita. Riprova tra poco."
      >
        <PanelActions>
          <Link className="button button-primary" href="/team/partner" prefetch={false}>
            Rileggi collegamenti
          </Link>
        </PanelActions>
      </WorkspacePanel>
    );
  return <PartnerWorkLinks snapshot={result.snapshot} member={result.member} />;
}
