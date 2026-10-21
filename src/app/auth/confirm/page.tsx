import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { InvitationForm } from "@/components/auth-invitation-form";
import { parseInvitation } from "@/lib/auth/invitation-model";
import styles from "@/components/auth.module.css";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const invitation = parseInvitation(query.token_hash, query.type);
  if (!invitation) return <AuthShell title="Questo link non è utilizzabile." description="Il collegamento è incompleto o non valido. Chiedi a Tommi un nuovo invito o link di recupero."><Link href="/auth/login" className={styles.help}>Torna all’accesso</Link></AuthShell>;
  const recovery = invitation.type === "recovery";
  // Rendering never exchanges the one-time token: mail scanners and prefetches
  // cannot consume it. Only the explicit form POST performs verification.
  return <AuthShell title={recovery ? "Reimposta la tua password." : "Entra nel team LuckyLap."} description={recovery ? "Conferma il recupero per scegliere una nuova password per il tuo account." : "Conferma l’invito ricevuto per scegliere la tua password personale."}><InvitationForm invitation={invitation} /><p className={styles.help}>Procedi soltanto se hai richiesto questo accesso. Il collegamento è personale e si usa una volta.</p></AuthShell>;
}
