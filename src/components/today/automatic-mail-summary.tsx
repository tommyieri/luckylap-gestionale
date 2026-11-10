import Link from "next/link";
import type {
  AutomaticMailCounts,
  AutomaticMailDay,
  AutomaticMailRow,
} from "../../lib/today/automatic-mail-model";
import styles from "./today.module.css";

const plannedCount = (counts: AutomaticMailCounts) =>
  counts.sent + counts.sending + counts.scheduled + counts.uncertain;
const emailCount = (count: number) => `${count} email`;
const sentCount = (count: number) => `${count} ${count === 1 ? "inviata" : "inviate"}`;
const shortDay = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const statusLabel: Record<AutomaticMailRow["status"], string> = {
  sent: "Inviata",
  sending: "Invio in corso",
  scheduled: "Programmata",
  skipped: "Saltata",
  uncertain: "Esito da verificare",
};

function MailRow({ row, day }: { row: AutomaticMailRow; day: string }) {
  const when = row.sentAt ?? row.plannedAt;
  return (
    <li className={styles.mailRecipient}>
      <div className={styles.mailRecipientHead}>
        <Link href={row.href} prefetch={false}>
          {row.name} <span className={styles.mailCode}>· CO {row.co}</span>
        </Link>
        <span className={styles.mailRecipientStatus}>{statusLabel[row.status]}</span>
      </div>
      <p className={styles.mailRecipientMeta}>
        {row.localTime && row.localDay && when ? (
          <>
            <time dateTime={when}>
              {row.localDay !== day &&
                `${shortDay.format(new Date(`${row.localDay}T12:00:00Z`))} · `}
              {row.localTime}
            </time>{" "}
            ora del destinatario · {row.timezone}
          </>
        ) : (
          "Orario locale non disponibile."
        )}
        {row.reasonLabel && <> · {row.reasonLabel}</>}
      </p>
    </li>
  );
}

/** Un’unica attività automatica: destinatari e orari si aprono soltanto quando servono. */
export function AutomaticMailSummary({ data }: { data: AutomaticMailDay }) {
  const planned = plannedCount(data.totals);
  const problems = data.totals.skipped + data.totals.uncertain;
  const hasRows = data.groups.some((group) => group.rows.length > 0);
  return (
    <>
      <div className={styles.mailOverview}>
        <p className={styles.mailHeadline}>
          <strong>
            {planned > 0 ? emailCount(planned) : "Nessuna email"} nel programma di oggi
          </strong>
          {planned > 0 && <span>{sentCount(data.totals.sent)}</span>}
        </p>
        <p className={styles.mailState} role={data.state === "unreadable" ? "status" : undefined}>
          {data.state === "automatic"
            ? "Le invia il gestionale, tra le 9 e le 16 del destinatario."
            : data.stateLabel}
        </p>
        <ul className={styles.mailGroups} aria-label="Invii del giorno per tipo">
          {data.groups.map((group) => (
            <li key={group.key}>
              <span>{group.label}</span>
              <span>
                <strong>{plannedCount(group.counts)}</strong>
                {group.counts.sent > 0 && <> · {sentCount(group.counts.sent)}</>}
              </span>
            </li>
          ))}
        </ul>
        {data.followupMode !== "invio" && (
          <p className={styles.mailNotice}>
            {data.followupMode === "unknown"
              ? "Stato dei solleciti da verificare."
              : "I solleciti automatici non sono attivi."}
          </p>
        )}
        {problems > 0 && (
          <p className={styles.mailNotice}>
            {problems === 1 ? "Un invio da verificare" : `${problems} invii da verificare`}: apri i
            dettagli.
          </p>
        )}
      </div>
      {hasRows && (
        <details className={styles.disclosure}>
          <summary className={styles.disclosureTitle}>Vedi destinatari e orari</summary>
          <div className={styles.disclosureBody}>
            {data.groups
              .filter((group) => group.rows.length > 0)
              .map((group) => (
                <div key={group.key} className={styles.mailDetailGroup}>
                  <h3>{group.label}</h3>
                  <ul>
                    {group.rows.map((row) => (
                      <MailRow key={row.id} row={row} day={data.day} />
                    ))}
                  </ul>
                </div>
              ))}
            <p className={styles.more}>
              Limiti sul giorno di Roma: 3 prime email agli altri contatti, 3 ai Club e fino a 6
              solleciti aggiuntivi. Il calendario ricontrolla la posta prima dell’invio.
            </p>
          </div>
        </details>
      )}
    </>
  );
}
