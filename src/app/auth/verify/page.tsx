import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { ExistingTotpForm } from "@/components/auth-mfa-forms";
import styles from "@/components/auth.module.css";
import { verifiedMember } from "@/lib/auth/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export default async function ExistingVerificationPage() {
  try {
    getSupabasePublicConfig();
  } catch {
    return (
      <AuthShell
        title="Accesso da configurare."
        description="Il workspace deve essere collegato prima di usare questa funzione."
      />
    );
  }
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase);
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status !== "member")
    return (
      <AuthShell title="Account non abilitato." description="Serve un account LuckyLap attivo." />
    );
  const [level, factors] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  if (level.error || factors.error || !level.data || !factors.data)
    return (
      <AuthShell
        title="Verifica non disponibile."
        description="Riprova tra poco prima di modificare la password."
      />
    );
  const configured = factors.data.totp
    .filter((factor) => factor.status === "verified")
    .map((factor) => ({ id: factor.id, name: factor.friendly_name || "Verifica esistente" }));
  if (
    level.data.currentLevel === "aal2" ||
    (configured.length === 0 && level.data.nextLevel !== "aal2")
  )
    redirect("/auth/password");
  if (configured.length === 0)
    return (
      <AuthShell
        title="Verifica esistente non disponibile."
        description="Questo account richiede una verifica già configurata, ma il fattore non è disponibile. Rivolgiti a Tommi prima di modificare la password."
      />
    );
  return (
    <AuthShell
      title="Verifica questo account."
      description="Questo account aveva già una verifica aggiuntiva configurata. Serve per modificarne la password; le aree Finance e CEO usano le proprie password."
    >
      <ExistingTotpForm factors={configured} />
      <div className={styles.actions}>
        <Link href="/auth/account" className="button button-secondary">
          Il tuo account
        </Link>
      </div>
    </AuthShell>
  );
}
