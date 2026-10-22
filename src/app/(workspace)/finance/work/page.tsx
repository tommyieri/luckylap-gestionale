import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WorkspacePanel } from "@/components/workspace-panel";
import { FinanceWorkView } from "@/components/finance-work-view";
import { ConsignmentMonthlyFinance } from "@/components/consignment-monthly-finance";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { readFinanceWork } from "@/lib/finance-work/server";
import { localReportDate } from "@/lib/finance/model";
import { readConsignmentFinance } from "@/lib/consignment/finance";
import { readConsignmentMonthlyFinance } from "@/lib/consignment/shop-finance";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Registrazioni" };
export default async function FinanceWorkPage() {
  try {
    getSupabasePublicConfig();
  } catch {
    return (
      <WorkspacePanel
        title="Finance da collegare."
        description="Il workspace deve essere configurato prima di accedere ai dati riservati."
      />
    );
  }
  const supabase = await createSupabaseServerClient();
  const access = await readFinanceWork(supabase).catch(() => ({ status: "unavailable" as const }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status === "area-locked") redirect("/auth/area/finance");
  if (access.status !== "ready")
    return (
      <WorkspacePanel
        title="Area Finance non disponibile."
        description="Non è stato possibile completare la lettura. Riprova tra poco."
      />
    );
  // Resoconti mensili e vendite del modulo precedente: tutto o niente.
  const unavailable = { status: "unavailable" as const };
  const [monthly, legacy] = await Promise.all([
    readConsignmentMonthlyFinance(supabase, access.member).catch(() => unavailable),
    readConsignmentFinance(supabase, access.member).catch(() => unavailable),
  ]);
  if (monthly.status !== "ready" || legacy.status !== "ready")
    return (
      <WorkspacePanel
        title="Lettura Finance non completa."
        description="Non è stato possibile leggere tutti i resoconti e i pagamenti del conto vendita. Riprova tra poco; nessun totale parziale viene mostrato."
      />
    );
  return (
    <FinanceWorkView
      snapshot={access.snapshot}
      consignment={
        <ConsignmentMonthlyFinance snapshot={monthly.snapshot} legacy={legacy.snapshot} />
      }
      userId={access.member.userId}
      displayName={access.member.displayName}
      today={localReportDate(new Date())!}
    />
  );
}
