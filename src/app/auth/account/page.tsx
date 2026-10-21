import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { SensitiveAreaLockForm } from "@/components/auth-sensitive-area-form";
import styles from "@/components/auth.module.css";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { verifiedMember } from "@/lib/auth/server";
import { isSensitiveAreaEligible, type SensitiveArea } from "@/lib/auth/model";
import { verifiedSensitiveAccess } from "@/lib/auth/sensitive-access";
import { signOut } from "../actions";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  try { getSupabasePublicConfig(); } catch { return <AuthShell title="Accesso da configurare." description="Il workspace condiviso deve essere collegato prima di usare il tuo account." />; }
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase);
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status !== "member") return <AuthShell title="Account non abilitato." description="Il tuo account non ha un’abilitazione attiva al team. Rivolgiti a Tommi."><div className={styles.actions}><form action={signOut}><button className="button button-secondary">Esci</button></form></div></AuthShell>;
  const areas = (["finance", "audit"] as SensitiveArea[]).filter(area => isSensitiveAreaEligible(access.member, area));
  const states = await Promise.all(areas.map(async area => ({ area, unlocked: await verifiedSensitiveAccess(supabase, access.member, area).catch(() => null) })));
  return <AuthShell title={`Il tuo account, ${access.member.displayName}.`} description="Entri con la tua email e la password del workspace condivisa dal team. Le attività restano associate al tuo account.">{states.map(({area,unlocked}) => <section key={area} className={styles.status}><strong>{area === "finance" ? "Finance" : "Controllo CEO"}</strong><p>{unlocked === null ? "Verifica dello stato non disponibile. Riprova tra poco." : unlocked ? "Aperta in questa sessione, fino a 8 ore. Puoi chiuderla prima di lasciare il dispositivo." : area === "finance" ? "Area chiusa." : "Serve la password CEO scelta da Tommi."}</p><div className={styles.actions}><Link href={`/auth/area/${area}`} className="button button-secondary">{unlocked ? "Gestisci accesso" : "Apri l’area"}</Link>{unlocked && <Link href={area === "finance" ? "/finance" : "/audit"} className="button button-primary">Vai all’area</Link>}</div>{unlocked && <SensitiveAreaLockForm area={area} />}</section>)}<div className={styles.actions}><Link href="/auth/password" className="button button-secondary">Imposta password del tuo account</Link><Link href="/" className="button button-secondary">Torna al workspace</Link><form action={signOut}><button className="button button-secondary">Esci</button></form></div></AuthShell>;
}
