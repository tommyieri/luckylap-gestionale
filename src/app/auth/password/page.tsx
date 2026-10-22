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
  try {
    getSupabasePublicConfig();
  } catch {
    return (
      <AuthShell
        title="Accesso in preparazione."
        description="Il collegamento al workspace deve essere completato prima di impostare la password."
      />
    );
  }
  const supabase = await createSupabaseServerClient();
  const access = await readPasswordAccess(supabase);
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status === "mfa-required")
    return (
      <AuthShell
        title="Verifica prima la tua identità."
        description="Questo account ha già una verifica aggiuntiva configurata. Completala per modificare la password."
      >
        <Link href="/auth/verify" className={`button button-primary ${styles.actions}`}>
          Verifica questo account
        </Link>
      </AuthShell>
    );
  if (access.status !== "ready")
    return (
      <AuthShell
        title="Accesso non disponibile."
        description="Serve un account LuckyLap attivo. Riprova tra poco oppure chiedi a Tommi di verificare l’abilitazione."
      >
        <Link href="/auth/login" className={styles.help}>
          Torna all’accesso
        </Link>
      </AuthShell>
    );
  return (
    <AuthShell
      title="Imposta la password del workspace."
      description={`Stai impostando la password dell’account di ${access.member.displayName}. Usa quella concordata con Tommi; dopo il salvataggio accederai di nuovo con la tua email.`}
    >
      <PasswordForm />
    </AuthShell>
  );
}
