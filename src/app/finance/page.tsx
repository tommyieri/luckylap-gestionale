import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { FinanceImportsView } from "@/components/finance-imports-view";
import styles from "@/components/finance.module.css";
import { isSensitiveAreaEligible } from "@/lib/auth/model";
import { verifiedSensitiveAccess } from "@/lib/auth/sensitive-access";
import { verifiedMember } from "@/lib/auth/server";
import { loadFinanceImports } from "@/lib/finance/server";
import { localReportDate } from "@/lib/finance/model";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function AccessState({ title, description, account = false }: { title: string; description: string; account?: boolean }) {
  return <AuthShell title={title} description={description}><div className={styles.accessActions}>{account && <Link className="button button-primary" href="/auth/account">Verifica il tuo account</Link>}<Link className="button button-secondary" href="/">Torna al workspace</Link></div></AuthShell>;
}

export default async function FinancePage() {
  try { getSupabasePublicConfig(); } catch {
    return <AccessState title="Finance in attesa del collegamento." description="L’area riservata sarà disponibile dopo la configurazione del workspace condiviso. I file ricevuti restano in revisione; qui non viene caricato alcun dato locale." />;
  }
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase).catch(() => ({ status: "unavailable" as const }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status === "unavailable") return <AccessState title="Verifica temporaneamente non disponibile." description="Non è stato possibile verificare il tuo accesso a Finance. Riprova tra poco." />;
  if (access.status !== "member" || !isSensitiveAreaEligible(access.member, "finance")) return <AccessState title="Finance è riservata." description="Questa sezione è accessibile al founder e ai membri di Produzione e Finance abilitati. I permessi si gestiscono dal workspace condiviso." />;
  const unlocked = await verifiedSensitiveAccess(supabase, access.member, "finance").catch(() => null);
  if (unlocked === null) return <AccessState title="Verifica temporaneamente non disponibile." description="Non è stato possibile verificare la sessione. Riprova tra poco." account />;
  if (!unlocked) redirect("/auth/area/finance");

  // No preview/staging imports, service key, cached rows or client-side bypass.
  // Both reads use this user's session and the database Finance RLS policies.
  const snapshot = await loadFinanceImports(supabase).catch(() => null);
  const reportDate = localReportDate(new Date());
  if (!snapshot || !reportDate) return <AccessState title="Importazioni non disponibili." description="La lettura completa dei movimenti non è riuscita. Nessun dato parziale viene mostrato: ricarica la pagina tra poco." />;
  return <FinanceImportsView snapshot={snapshot} reportDate={reportDate} displayName={access.member.displayName} />;
}
