import Link from "next/link";
import { addDays, instantTime, longDay, romeDay } from "../../lib/partner/dates";
import { partnerHref } from "../../lib/partner/links";
import {
  PARTNER_SEND_PLAN_UNREADABLE,
  partnerSendPlanReasonLabel,
  type PartnerSendPlan,
  type PartnerSendPlanSlot,
} from "../../lib/partner/send-plan";
import styles from "./partner.module.css";

const STATUS: Record<PartnerSendPlanSlot["status"], string> = {
  scheduled: "Programmato · ancora da controllare",
  sending: "Invio in corso",
  sent: "Inviato",
  uncertain: "Invio incerto · controlla",
  skipped: "Saltato",
  expired: "Orario superato · da ripianificare",
};
const localClock = (at: string, timezone: string) => {
  try {
    return new Intl.DateTimeFormat("it-IT", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(at));
  } catch {
    return "Ora locale da verificare";
  }
};

/** Mostra soltanto gli orari del piano SQL, senza calcolare o assegnare altri posti. */
export function PartnerSendPlanPanel({
  plan,
  today,
  preview = false,
}: {
  plan: PartnerSendPlan | null;
  today: string;
  preview?: boolean;
}) {
  return (
    <section className={styles.dataSection} aria-labelledby="partner-piano-invii">
      <h2 id="partner-piano-invii">Piano d'invio del giorno</h2>
      <nav className={styles.dataLine} aria-label="Giorno del piano">
        <Link
          href={`/partner/email?giorno=${today}`}
          aria-current={plan?.day === today ? "date" : undefined}
        >
          Oggi
        </Link>
        {" · "}
        <Link
          href={`/partner/email?giorno=${addDays(today, 1)}`}
          aria-current={plan?.day === addDays(today, 1) ? "date" : undefined}
        >
          Domani
        </Link>
      </nav>
      <p className={styles.dataLine}>
        Prime email e solleciti, distribuiti fra le 9:00 e le 16:00 locali. Limiti giornalieri
        calcolati sull'ora di Roma: 6 prime email, al massimo 3 Club e 3 altri, più 6 solleciti.
      </p>
      {preview ? (
        <p className={styles.hint}>Anteprima locale: gli orari reali non sono disponibili.</p>
      ) : plan === null ? (
        <p className={styles.noteAmber} role="status">
          {PARTNER_SEND_PLAN_UNREADABLE}
        </p>
      ) : (
        <>
          <p className={styles.dataLine}>
            {longDay(plan.day, today)} · Roma.{" "}
            {plan.mode !== "invio" &&
              "Invio non attivo: gli orari indicati non fanno partire email."}
          </p>
          {plan.slots.length === 0 ? (
            <p className={styles.hint}>
              Nessun invio programmato per questo giorno. Le bozze in coda possono essere ancora da
              programmare.
            </p>
          ) : (
            <ul
              className={styles.assistantReview}
              aria-label="Orari delle prime email e dei solleciti"
            >
              {plan.slots.map((slot) => (
                <li key={slot.id}>
                  <Link
                    className={styles.reviewName}
                    href={partnerHref({ co: slot.co })}
                    prefetch={false}
                  >
                    CO {slot.co} · {slot.name}
                  </Link>
                  <p>
                    {slot.kind === "primo" ? "Prima email" : "Sollecito"} · {STATUS[slot.status]}
                  </p>
                  <p>
                    <time dateTime={slot.plannedAt}>
                      {localClock(slot.plannedAt, slot.timezone)} locale
                    </time>{" "}
                    · {longDay(slot.localDay, today)}
                  </p>
                  <p className={styles.hint}>
                    {instantTime(slot.plannedAt)} a Roma ·{" "}
                    {longDay(romeDay(new Date(slot.plannedAt)), today)}. Orario utile fino alle{" "}
                    {localClock(slot.expiresAt, slot.timezone)} locale.
                  </p>
                  {slot.reason && (
                    <p className={styles.noteAmber}>{partnerSendPlanReasonLabel(slot.reason)}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className={styles.hint}>
            Ultima lettura: {longDay(romeDay(new Date(plan.generatedAt)), today)} alle{" "}
            {instantTime(plan.generatedAt)} a Roma. Il piano non sostituisce i controlli prima
            dell'invio.
          </p>
        </>
      )}
      <p className={styles.hint}>
        Gli invii con lo stesso orario locale sono distribuiti a intervalli regolari tra le 9 e poco
        prima delle 16. Con una sola mail si usa il centro della fascia. A giornata iniziata si usa
        il tempo rimasto. Un invio saltato non fa accelerare quelli successivi.
      </p>
    </section>
  );
}
