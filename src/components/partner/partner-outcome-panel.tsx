import Link from "next/link";
import { partnerTeamWorkHref } from "../../lib/partner/links";
import type { PartnerSummary } from "../../lib/partner/model";
import styles from "./partner.module.css";

/**
 * «Esito» nella scheda (decisione 10, 05-7): con «Accordo fatto» l'accordo diventa lavoro del
 * team. Il link apre «Partner nel Team» con il contatto già scelto: lì si collegano l'evento in
 * calendario, il progetto per Produzione e l'attività di apertura del conto vendita.
 */
export function PartnerOutcomePanel({
  partner,
}: {
  partner: Pick<PartnerSummary, "co" | "stage">;
}) {
  if (partner.stage !== "chiuso") return null;
  return (
    <section
      className={`${styles.detailBlock} ${styles.outcome}`}
      aria-labelledby={`esito-${partner.co}`}
    >
      <h4 id={`esito-${partner.co}`}>Esito</h4>
      <p>
        Accordo fatto. Portalo nel lavoro del team: l’evento in calendario, il progetto per
        Produzione o l’apertura del conto vendita.
      </p>
      <Link
        href={partnerTeamWorkHref(partner)}
        prefetch={false}
        className={`${styles.act} ${styles.actPrimary} ${styles.outcomeLink}`}
      >
        Apri in Partner nel Team
      </Link>
    </section>
  );
}
