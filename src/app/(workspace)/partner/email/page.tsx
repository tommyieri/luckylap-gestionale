import type { Metadata } from "next";
import { AccessPanel } from "@/components/access-panel";
import { WorkspacePanel } from "@/components/workspace-panel";
import { PartnerEmailProgramView } from "@/components/partner/partner-email-program";
import { requireMember } from "@/lib/auth/current-member";
import { addDays } from "@/lib/partner/dates";
import { partnerToday } from "@/lib/partner/periods";
import { PARTNER_SECTIONS, type PartnerSection } from "@/lib/partner/model";
import { partnerEmailProgramFixture } from "@/lib/partner/email-program-fixtures";
import { forecastPartnerEmails } from "@/lib/partner/email-program";
import { loadPartnerEmailProgram } from "@/lib/partner/email-program-server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Calendario email · Partner" };

export default async function PartnerEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [current, params] = await Promise.all([requireMember(), searchParams]);
  const value = Array.isArray(params.sezione) ? params.sezione[0] : params.sezione;
  const initialSection: PartnerSection | "tutti" = PARTNER_SECTIONS.includes(
    value as PartnerSection,
  )
    ? (value as PartnerSection)
    : "tutti";
  const today = partnerToday();
  if (current.status === "preview") {
    const snapshot = partnerEmailProgramFixture(today);
    return (
      <PartnerEmailProgramView
        snapshot={snapshot}
        forecast={forecastPartnerEmails(snapshot)}
        founder
        preview
        initialSection={initialSection}
      />
    );
  }
  if (current.status !== "member")
    return (
      <AccessPanel
        status={current.status}
        setup={{
          title: "Calendario email da collegare.",
          description: "Accedi al team per leggere il programma e i testi dell'assistente.",
        }}
      />
    );
  try {
    const { snapshot, forecast } = await loadPartnerEmailProgram(
      current.supabase,
      addDays(today, -30),
      90,
    );
    return (
      <PartnerEmailProgramView
        snapshot={snapshot}
        forecast={forecast}
        founder={current.member.role === "founder"}
        preview={false}
        initialSection={initialSection}
      />
    );
  } catch {
    return (
      <WorkspacePanel
        title="Programma email non disponibile."
        description="Ricarica tra poco. Le previsioni richiedono una lettura completa della coda e del calendario; gli invii continuano secondo la modalità salvata."
        tone="warning"
      />
    );
  }
}
