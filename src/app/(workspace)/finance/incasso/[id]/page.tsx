import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { WorkspacePanel, PanelActions } from "@/components/workspace-panel";
import { FinanceShopPaymentEditor } from "@/components/finance-shop-payment-editor";
import { verifiedMember } from "@/lib/auth/server";
import { isSensitiveAreaEligible } from "@/lib/auth/model";
import { verifiedSensitiveAccess } from "@/lib/auth/sensitive-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { revisionUuid } from "@/lib/finance-revisions/model";
import { loadShopPaymentFinanceHistory } from "@/lib/finance-revisions/shop-payment-server";
import { readTeamPages } from "@/lib/team/read";
import { isLocalPreviewEnabled } from "@/lib/runtime";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Incasso conto vendita" };
const panel = (title: string, description: string) => (
  <WorkspacePanel title={title} description={description}>
    <PanelActions>
      <Link href="/finance" prefetch={false} className="button button-secondary">
        Torna a Finance
      </Link>
    </PanelActions>
  </WorkspacePanel>
);
export default async function ShopPaymentPage({ params }: { params: Promise<{ id: string }> }) {
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
  const { id } = await params;
  if (!revisionUuid(id))
    return panel(
      "Seleziona un pagamento.",
      "Apri l’incasso dal registro Finance per leggere lo storico.",
    );
  try {
    const [history, profiles] = await Promise.all([
      loadShopPaymentFinanceHistory(db, id),
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
        !revisionUuid(row.user_id) ||
        typeof row.display_name !== "string" ||
        row.display_name.length > 120
      )
        throw new Error("Profilo non disponibile.");
      names[row.user_id] = row.display_name;
    }
    return (
      <FinanceShopPaymentEditor
        key={`${access.member.userId}:${id}`}
        history={history}
        actorId={access.member.userId}
        names={names}
      />
    );
  } catch {
    return panel(
      "Pagamento non disponibile.",
      "Non riesco a leggere il pagamento e lo storico completo. Riapri Finance e riprova.",
    );
  }
}
