import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { WorkspacePanel, PanelActions } from "@/components/workspace-panel";
import { FinanceRevisionEditor } from "@/components/finance-revision-editor";
import { SensitiveAreaSessionBar } from "@/components/auth-sensitive-area-form";
import { verifiedMember } from "@/lib/auth/server";
import { isSensitiveAreaEligible } from "@/lib/auth/model";
import { verifiedSensitiveAccess } from "@/lib/auth/sensitive-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import {
  FINANCE_REVISION_SOURCES,
  revisionUuid,
  type FinanceRevisionSource,
} from "@/lib/finance-revisions/model";
import { loadFinanceRevisionHistory } from "@/lib/finance-revisions/server";
import { readTeamPages } from "@/lib/team/read";
import { isLocalPreviewEnabled } from "@/lib/runtime";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Movimento Finance" };
const panel = (title: string, description: string) => (
  <WorkspacePanel title={title} description={description}>
    <PanelActions>
      <Link href="/finance" prefetch={false} className="button button-secondary">
        Torna a Finance
      </Link>
    </PanelActions>
  </WorkspacePanel>
);
export default async function FinanceMovementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (isLocalPreviewEnabled())
    return panel(
      "Editor non disponibile nell’anteprima.",
      "Le modifiche richiedono il workspace condiviso e la sessione Finance.",
    );
  try {
    getSupabasePublicConfig();
  } catch {
    return panel(
      "Finance non disponibile.",
      "Il collegamento al workspace deve essere completato.",
    );
  }
  const db = await createSupabaseServerClient();
  const access = await verifiedMember(db).catch(() => ({ status: "unavailable" as const }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status === "unavailable")
    return panel("Verifica temporaneamente non disponibile.", "Riprova tra poco.");
  if (access.status !== "member" || !isSensitiveAreaEligible(access.member, "finance"))
    return panel("Accesso non disponibile.", "Il tuo account non ha accesso a questa sezione.");
  const unlocked = await verifiedSensitiveAccess(db, access.member, "finance").catch(() => null);
  if (unlocked === false) redirect("/auth/area/finance");
  if (unlocked === null)
    return panel(
      "Verifica temporaneamente non disponibile.",
      "Non riesco a verificare la sessione Finance. Riprova tra poco.",
    );
  const params = await searchParams;
  const kind = params.source_kind,
    id = params.source_id;
  if (
    typeof kind !== "string" ||
    !(FINANCE_REVISION_SOURCES as readonly string[]).includes(kind) ||
    !revisionUuid(id)
  )
    return panel(
      "Seleziona un movimento.",
      "Apri la correzione dal registro Finance per vedere la fonte e lo storico.",
    );
  try {
    const [history, profiles] = await Promise.all([
      loadFinanceRevisionHistory(db, { sourceKind: kind as FinanceRevisionSource, sourceId: id }),
      readTeamPages((after, limit) => {
        let q = db
          .from("profiles")
          .select("user_id,display_name", { count: "exact" })
          .order("user_id")
          .limit(limit);
        if (after) q = q.gt("user_id", after);
        return q;
      }, "user_id"),
    ]);
    const names: Record<string, string> = {};
    for (const raw of profiles) {
      const row = raw as Record<string, unknown>;
      if (
        typeof row.user_id !== "string" ||
        typeof row.display_name !== "string" ||
        row.display_name.length > 120
      )
        throw new Error("Profilo non disponibile");
      names[row.user_id] = row.display_name;
    }
    return (
      <>
        <SensitiveAreaSessionBar area="finance" />
        <FinanceRevisionEditor
          key={`${access.member.userId}:${kind}:${id}`}
          history={history}
          actorId={access.member.userId}
          names={names}
        />
      </>
    );
  } catch {
    return panel(
      "Movimento non disponibile.",
      "Non riesco a leggere la fonte e lo storico completo. Ricarica il registro Finance e riprova.",
    );
  }
}
