import type { Metadata } from "next";
import { AccessPanel } from "../../../components/access-panel";
import { GuideView } from "../../../components/guide-view";
import { requireMember } from "../../../lib/auth/current-member";
import { isSensitiveAreaEligible } from "../../../lib/auth/model";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Come si usa" };

/**
 * «Come si usa»: guida breve per il team, nel piede del menu e in «Altro». Il testo è
 * fisso; dal membro verificato dipende solo cosa dice di Finance e Controllo CEO.
 */
export default async function GuidePage() {
  const current = await requireMember();
  if (current.status === "preview")
    return <GuideView access={{ finance: true, ceo: true }} preview />;
  if (current.status !== "member")
    return (
      <AccessPanel
        status={current.status}
        setup={{
          title: "Guida da collegare.",
          description:
            "Il collegamento al workspace deve essere completato prima di accedere al gestionale.",
        }}
      />
    );
  return (
    <GuideView
      access={{
        finance: isSensitiveAreaEligible(current.member, "finance"),
        ceo: isSensitiveAreaEligible(current.member, "audit"),
      }}
    />
  );
}
