import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { SensitiveAreaForm, SensitiveAreaLockForm } from "@/components/auth-sensitive-area-form";
import styles from "@/components/auth.module.css";
import { isSensitiveAreaEligible, sensitiveAreaFrom } from "@/lib/auth/model";
import { verifiedMember } from "@/lib/auth/server";
import { verifiedSensitiveAccess } from "@/lib/auth/sensitive-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function SensitiveAreaPage({ params }: { params: Promise<{ area: string }> }) {
  const area = sensitiveAreaFrom((await params).area);
  if (!area) notFound();
  try { getSupabasePublicConfig(); } catch { return <AuthShell title="Accesso da configurare." description="Il collegamento al workspace deve essere completato prima di aprire l’area." />; }
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase).catch(() => ({ status: "unavailable" as const }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status !== "member" || !isSensitiveAreaEligible(access.member, area)) return <AuthShell title="Area riservata." description="Il tuo account non è abilitato a questa area."><div className={styles.actions}><Link href="/" className="button button-secondary">Torna al workspace</Link></div></AuthShell>;
  const unlocked = await verifiedSensitiveAccess(supabase, access.member, area).catch(() => null);
  if (unlocked === null) return <AuthShell title="Verifica non disponibile." description="Non è stato possibile verificare questa sessione. Riprova tra poco."><div className={styles.actions}><Link href="/auth/account" className="button button-secondary">Il tuo account</Link></div></AuthShell>;
  const label = area === "finance" ? "Finance" : "Controllo CEO";
  return <AuthShell title={unlocked ? `${label} è aperta.` : `Apri ${label}.`} description={unlocked ? "L’area è aperta per questa sessione. Puoi chiuderla prima di lasciare il dispositivo." : area === "finance" ? "" : "Inserisci la password aggiuntiva dell’area. Il tuo accesso resta personale, con l’email del team."}>{unlocked ? <><div className={styles.actions}><Link href={area === "finance" ? "/finance" : "/audit"} className="button button-primary">Vai all’area</Link></div><SensitiveAreaLockForm area={area} /></> : <SensitiveAreaForm area={area} />}<div className={styles.actions}><Link href="/auth/account" className="button button-secondary">Il tuo account</Link><Link href="/" className="button button-secondary">Workspace</Link></div></AuthShell>;
}
