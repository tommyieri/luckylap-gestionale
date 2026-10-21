import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { PasswordForm } from "@/components/auth-password-form";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readPasswordAccess } from "@/lib/auth/invitation-server";
import styles from "@/components/auth.module.css";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function PasswordPage() {
  try { getSupabasePublicConfig(); } catch { return <AuthShell title="Accesso in preparazione." description="Il collegamento al workspace deve essere completato prima di impostare la password." />; }
  const supabase = await createSupabaseServerClient();
  const access = await readPasswordAccess(supabase);
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status === "mfa-required") return <AuthShell title="Verifica prima la tua identità." description="Questo account usa un’app di autenticazione. Verifica la sessione, poi torna qui per impostare la password."><Link href="/auth/account" className={`button button-primary ${styles.actions}`}>Verifica la sessione</Link></AuthShell>;
  if (access.status !== "ready") return <AuthShell title="Accesso non disponibile." description="Serve un account LuckyLap attivo. Riprova tra poco oppure chiedi a Tommi di verificare l’abilitazione."><Link href="/auth/login" className={styles.help}>Torna all’accesso</Link></AuthShell>;
  return <AuthShell title="Scegli la tua password." description={`Stai impostando la password di ${access.member.displayName}. Dopo il salvataggio accederai di nuovo con email e nuova password.`}><PasswordForm /></AuthShell>;
}
