import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PasswordForm } from "@/components/auth-password-form";
import { PanelActions, WorkspacePanel } from "@/components/workspace-panel";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readPasswordAccess } from "@/lib/auth/invitation-server";
import styles from "@/components/auth.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Password", robots: { index: false, follow: false } };

export default async function PasswordPage() {
  try {
    getSupabasePublicConfig();
  } catch {
    return (
      <WorkspacePanel
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
      <WorkspacePanel
        title="Verifica prima la tua identità."
        description="Questo account ha già una verifica aggiuntiva configurata. Completala per modificare la password."
      >
        <PanelActions>
          <Link href="/auth/verify" className="button button-primary" prefetch={false}>
            Verifica questo account
          </Link>
        </PanelActions>
      </WorkspacePanel>
    );
  if (access.status !== "ready")
    return (
      <WorkspacePanel
        title="Accesso non disponibile."
        description="Serve un account LuckyLap attivo. Riprova tra poco oppure chiedi a Tommi di verificare l’abilitazione."
      >
        <Link href="/auth/login" className={styles.help} prefetch={false}>
          Torna all’accesso
        </Link>
      </WorkspacePanel>
    );
  return (
    <WorkspacePanel
      title="Imposta la password del workspace."
      description={`Stai impostando la password dell’account di ${access.member.displayName}. Usa quella concordata con Tommi; dopo il salvataggio accederai di nuovo con la tua email.`}
    >
      <PasswordForm />
    </WorkspacePanel>
  );
}
