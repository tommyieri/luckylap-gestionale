import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "../../components/auth-shell";
import { TeamWorkspace } from "../../components/team-workspace";
import styles from "../../components/team-workspace.module.css";
import { verifiedMember } from "../../lib/auth/server";
import { getSupabasePublicConfig } from "../../lib/supabase/config";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { loadTeamWorkspace } from "../../lib/team/server";

export const dynamic = "force-dynamic";

function AccessState({ title, description, reload = false }: { title: string; description: string; reload?: boolean }) {
  return <AuthShell title={title} description={description}><div className={styles.accessActions}>{reload && <Link className="button button-primary" href="/team">Ricarica il team</Link>}<Link className="button button-secondary" href="/">Torna al workspace</Link></div></AuthShell>;
}

export default async function TeamPage() {
  try { getSupabasePublicConfig(); } catch { return <AccessState title="Il team attende il collegamento." description="Il calendario, le attività e le note condivise saranno disponibili dopo la configurazione del workspace. Gli appunti locali restano nel browser e non vengono importati automaticamente." />; }
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase).catch(() => ({ status: "unavailable" as const }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status === "unavailable") return <AccessState title="Verifica dell’accesso non disponibile." description="Non è stato possibile verificare il tuo account. Ricarica la pagina tra poco." reload />;
  if (access.status !== "member") return <AccessState title="Il team è riservato ai membri abilitati." description="Accedi con l’account autorizzato per leggere e aggiornare il lavoro condiviso di LuckyLap." />;
  const snapshot = await loadTeamWorkspace(supabase).catch(() => null);
  if (!snapshot) return <AccessState title="Il team non è disponibile." description="Non è stato possibile leggere completamente calendario, attività e note. Ricarica la pagina tra poco; nessun dato parziale viene mostrato." reload />;
  return <TeamWorkspace snapshot={snapshot} displayName={access.member.displayName} loadedAt={new Date().toISOString()} />;
}
