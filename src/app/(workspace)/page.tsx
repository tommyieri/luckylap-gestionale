import type { Metadata } from "next";
import { AccessPanel } from "@/components/access-panel";
import { TodaySheet } from "@/components/today/today-sheet";
import { requireMember } from "@/lib/auth/current-member";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Oggi" };

/** Oggi è la home: il foglio del giorno. Senza sessione, `requireMember` porta al login. */
export default async function TodayPage() {
  const current = await requireMember();
  const now = new Date();
  if (current.status === "preview") return <TodaySheet access={current} now={now} />;
  if (current.status !== "member")
    return (
      <AccessPanel
        status={current.status}
        setup={{
          title: "Prepariamo il workspace condiviso.",
          description:
            "Il collegamento al workspace deve essere completato prima di accedere. Le scorte e i dati interni non vengono caricati su questa pagina.",
        }}
        unavailableTitle="Workspace temporaneamente non disponibile."
      />
    );
  return <TodaySheet access={current} now={now} />;
}
