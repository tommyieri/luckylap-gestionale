import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FinanceImportsView } from "@/components/finance-imports-view";
import {
  ConsignmentMonthlyFinance,
  FinancePreviewNotice,
} from "@/components/consignment-monthly-finance";
import { PanelActions, WorkspacePanel } from "@/components/workspace-panel";
import { isSensitiveAreaEligible } from "@/lib/auth/model";
import { verifiedSensitiveAccess } from "@/lib/auth/sensitive-access";
import { verifiedMember } from "@/lib/auth/server";
import { loadFinanceImports } from "@/lib/finance/server";
import { readFinanceWork } from "@/lib/finance-work/server";
import { readDashboardSettlements } from "@/lib/finance/dashboard-server";
import { localReportDate } from "@/lib/finance/model";
import {
  dashboardShopPaymentsFromRows,
  monthlyFinanceFromRows,
  readConsignmentMonthlyFinance,
} from "@/lib/consignment/shop-finance";
import { shopFinanceRows } from "@/lib/consignment/shop-fixtures";
import { isLocalPreviewEnabled } from "@/lib/runtime";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Finance" };

function AccessState({
  title,
  description,
  account = false,
}: {
  title: string;
  description: string;
  account?: boolean;
}) {
  return (
    <WorkspacePanel title={title} description={description}>
      {account && (
        <PanelActions>
          <Link className="button button-primary" href="/auth/account" prefetch={false}>
            Verifica il tuo account
          </Link>
        </PanelActions>
      )}
    </WorkspacePanel>
  );
}

/**
 * Anteprima locale (00-sequenza §1.5): nessuna lettura, nessuna fonte importata,
 * solo i resoconti e i pagamenti sintetici del conto vendita.
 */
function FinancePreview() {
  const reportDate = localReportDate(new Date())!;
  const { reports, payments, locations } = shopFinanceRows();
  return (
    <>
      <FinancePreviewNotice />
      <FinanceImportsView
        snapshot={{ batches: [], transactions: [] }}
        shopPayments={dashboardShopPaymentsFromRows(payments, reports, locations)}
        consignment={
          <ConsignmentMonthlyFinance
            snapshot={monthlyFinanceFromRows(reports, payments, locations)}
          />
        }
        reportDate={reportDate}
        displayName="Anteprima locale"
      />
    </>
  );
}

export default async function FinancePage() {
  if (isLocalPreviewEnabled()) return <FinancePreview />;
  try {
    getSupabasePublicConfig();
  } catch {
    return (
      <AccessState
        title="Finance in attesa del collegamento."
        description="L’area riservata sarà disponibile dopo la configurazione del workspace condiviso. I file ricevuti restano in revisione; qui non viene caricato alcun dato locale."
      />
    );
  }
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase).catch(() => ({ status: "unavailable" as const }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status === "unavailable")
    return (
      <AccessState
        title="Verifica temporaneamente non disponibile."
        description="Non è stato possibile verificare il tuo accesso a Finance. Riprova tra poco."
      />
    );
  if (access.status !== "member" || !isSensitiveAreaEligible(access.member, "finance"))
    return (
      <AccessState
        title="Finance è riservata."
        description="Il tuo account non ha accesso a questa sezione. Puoi tornare al workspace."
      />
    );
  const unlocked = await verifiedSensitiveAccess(supabase, access.member, "finance").catch(
    () => null,
  );
  if (unlocked === null)
    return (
      <AccessState
        title="Verifica temporaneamente non disponibile."
        description="Non è stato possibile verificare la sessione. Riprova tra poco."
        account
      />
    );
  if (!unlocked) redirect("/auth/area/finance");

  // No preview/staging imports, service key, cached rows or client-side bypass.
  // All reads use this user's session and the database Finance RLS policies.
  // The consignment panel and the shop payments in the balances share one read.
  const [snapshot, work, settlements, consignment] = await Promise.all([
    loadFinanceImports(supabase).catch(() => null),
    readFinanceWork(supabase).catch(() => null),
    readDashboardSettlements(supabase).catch(() => null),
    readConsignmentMonthlyFinance(supabase, access.member).catch(() => null),
  ]);
  const reportDate = localReportDate(new Date());
  if (
    !snapshot ||
    !reportDate ||
    work?.status !== "ready" ||
    !settlements ||
    consignment?.status !== "ready"
  )
    return (
      <AccessState
        title="Importazioni non disponibili."
        description="La lettura completa dei movimenti non è riuscita. Nessun dato parziale viene mostrato: ricarica la pagina tra poco."
      />
    );
  return (
    <FinanceImportsView
      snapshot={snapshot}
      workSnapshot={work.snapshot}
      settlements={settlements}
      shopPayments={consignment.shopPayments}
      consignment={<ConsignmentMonthlyFinance snapshot={consignment.snapshot} />}
      reportDate={reportDate}
      displayName={access.member.displayName}
    />
  );
}
