import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "../../components/auth-shell";
import { AuditView } from "../../components/audit-view";
import styles from "../../components/team-workspace.module.css";
import { isSensitiveAreaEligible } from "../../lib/auth/model";
import { verifiedSensitiveAccess } from "../../lib/auth/sensitive-access";
import { verifiedMember } from "../../lib/auth/server";
import { auditCursorFromSearch, type AuditSearch } from "../../lib/audit/model";
import { loadAuditMetadata } from "../../lib/audit/server";
import { getSupabasePublicConfig } from "../../lib/supabase/config";
import { createSupabaseServerClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

function AccessState({ title, description, verify = false, restart = false }: { title: string; description: string; verify?: boolean; restart?: boolean }) {
  return <AuthShell title={title} description={description}><div className={styles.accessActions}>{verify && <Link className="button button-primary" href="/auth/account">Verifica il tuo account</Link>}{restart && <Link className="button button-primary" href="/audit">Apri il registro recente</Link>}<Link className="button button-secondary" href="/">Torna al workspace</Link></div></AuthShell>;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<AuditSearch> }) {
  try { getSupabasePublicConfig(); } catch { return <AccessState title="Il controllo attende il collegamento." description="Il registro riservato sarà disponibile dopo la configurazione del workspace e dell’account founder." />; }
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase).catch(() => ({ status: "unavailable" as const }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status === "unavailable") return <AccessState title="Verifica dell’accesso non disponibile." description="Non è stato possibile verificare l’accesso al registro. Riprova tra poco." />;
  if (access.status !== "member" || !isSensitiveAreaEligible(access.member, "audit")) return <AccessState title="Controllo riservato al founder." description="Il registro delle modifiche è accessibile esclusivamente all’account founder abilitato." />;
  const unlocked = await verifiedSensitiveAccess(supabase, access.member, "audit").catch(() => null);
  if (unlocked === null) return <AccessState title="Verifica della sessione non disponibile." description="Riprova dal tuo account prima di aprire il registro." verify />;
  if (!unlocked) redirect("/auth/area/audit");
  let cursor;
  try { cursor = auditCursorFromSearch(await searchParams); } catch { return <AccessState title="Il collegamento al registro non è valido." description="Apri la pagina delle modifiche più recenti per riprendere la lettura." restart />; }
  const snapshot = await loadAuditMetadata(supabase, access.member, unlocked, cursor).catch(() => null);
  if (!snapshot) return <AccessState title="Registro non disponibile." description="La lettura del registro non è riuscita. Riapri la pagina tra poco; nessun contenuto parziale viene mostrato." restart />;
  return <AuditView snapshot={snapshot} displayName={access.member.displayName} />;
}
