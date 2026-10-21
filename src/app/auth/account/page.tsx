import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { MfaForms } from "@/components/auth-mfa-forms";
import styles from "@/components/auth.module.css";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { verifiedMember } from "@/lib/auth/server";
import { signOut } from "../actions";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  try { getSupabasePublicConfig(); } catch { return <AuthShell title="Accesso da configurare." description="Il workspace condiviso deve essere collegato prima di usare il tuo account." />; }
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase);
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status !== "member") return <AuthShell title="Account non abilitato." description="Il tuo account non ha un’abilitazione attiva al team. Rivolgiti a Tommi."><div className={styles.actions}><form action={signOut}><button className="button button-secondary">Esci</button></form></div></AuthShell>;
  const [assurance, factors] = await Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), supabase.auth.mfa.listFactors()]);
  const verified = !assurance.error && assurance.data.currentLevel === "aal2";
  const configured = factors.data?.totp.filter(factor => factor.status === "verified").map(factor => ({ id: factor.id, name: factor.friendly_name || "App di autenticazione" })) ?? [];
  return <AuthShell title={`Il tuo account, ${access.member.displayName}.`} description="La verifica in due passaggi protegge l’accesso a Finance e al controllo del founder. I permessi dipendono sempre dal tuo ruolo nel team."><div className={styles.status}><strong>{verified ? "Sessione verificata in due passaggi" : "Verifica della sessione richiesta"}</strong><p>{verified ? "La verifica è attiva per questa sessione. Le aree riservate saranno disponibili quando i relativi moduli saranno attivati." : "Per le aree riservate servono password e codice temporaneo dell’app di autenticazione."}</p></div>{factors.error || assurance.error ? <p className={styles.error} role="alert">Verifica temporaneamente non disponibile. Riprova tra poco.</p> : !verified && <MfaForms factors={configured} />}<div className={styles.actions}><Link href="/auth/password" className="button button-secondary">Imposta password</Link><Link href="/" className="button button-secondary">Torna al workspace</Link><form action={signOut}><button className="button button-secondary">Esci</button></form></div></AuthShell>;
}
