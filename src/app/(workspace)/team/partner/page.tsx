import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PartnerWorkLinks } from "@/components/partner-work-links";
import { PanelActions, WorkspacePanel } from "@/components/workspace-panel";
import { readPartnerWorkLinks } from "@/lib/work-links/server";
import { partnerWorkPreview } from "@/lib/work-links/preview";
import { isPartnerCo } from "@/lib/partner/model";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Partner nel Team" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** `?co=12` sceglie il contatto (blocco «Esito» della scheda Partner); altrimenti il primo. */
function coFrom(params: Record<string, string | string[] | undefined>): number | null {
  const value = Array.isArray(params.co) ? params.co[0] : params.co;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,4}$/.test(value)) return null;
  const co = Number(value);
  return isPartnerCo(co) ? co : null;
}

export default async function PartnerWorkPage({ searchParams }: { searchParams: SearchParams }) {
  const co = coFrom(await searchParams);
  const preview = partnerWorkPreview();
  if (preview)
    return (
      <PartnerWorkLinks
        key={co ?? "primo"}
        snapshot={preview.snapshot}
        member={preview.member}
        initialCo={co}
        preview
      />
    );
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
  return (
    <PartnerWorkLinks
      key={co ?? "primo"}
      snapshot={result.snapshot}
      member={result.member}
      initialCo={co}
    />
  );
}
