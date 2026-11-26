import "server-only";
import { packlinkIssueLabel, type PacklinkSyncStatus } from "../lib/packlink/status-model";
import styles from "./shopify-sync-health.module.css";
const date = (value: string) =>
  new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(new Date(value));

export function PacklinkSyncHealth({
  status,
  now = Date.now(),
}: {
  status: PacklinkSyncStatus;
  now?: number;
}) {
  if (status.status !== "ready")
    return (
      <section className={styles.section} aria-label="Stato Packlink">
        <div className={styles.heading}>
          <h2>Collegamento Packlink</h2>
          <span>Stato non disponibile</span>
        </div>
        <p className={styles.caption}>
          Non è stato possibile verificare l’ultima lettura dei costi Packlink. Ricarica la pagina
          per riprovare.
        </p>
      </section>
    );
  const s = status.snapshot;
  const lastCompletedOrAttempt = s.lastSuccessAt ?? s.lastAttemptAt;
  const stale = Boolean(
    s.enabled && lastCompletedOrAttempt && now - Date.parse(lastCompletedOrAttempt) > 45 * 60000,
  );
  const attention = s.enabled && (s.outcome === "review" || s.outcome === "retry" || stale);
  const badge = !s.configured
    ? "Da collegare"
    : !s.enabled
      ? "In pausa"
      : attention
        ? "Richiede attenzione"
        : s.outcome === "running"
          ? "Lettura in corso"
          : s.lastSuccessAt
            ? "Attivo"
            : "In attesa della prima lettura";
  return (
    <section className={styles.section} aria-labelledby="packlink-sync-title">
      <div className={styles.heading}>
        <h2 id="packlink-sync-title">Collegamento Packlink</h2>
        <span>{badge}</span>
      </div>
      <p className={styles.caption}>
        {!s.configured
          ? "Il collegamento automatico dei costi Packlink deve ancora essere configurato."
          : !s.enabled
            ? "La lettura automatica è in pausa. Le voci già acquisite restano in Finance."
            : "Il gestionale legge automaticamente le transazioni Packlink ogni 15 minuti. Spese e rimborsi compaiono in Spedizioni, ciascuno una sola volta."}
      </p>
      <p className={styles.updated}>
        Ultima lettura completata:{" "}
        <strong>
          {s.lastSuccessAt ? `${date(s.lastSuccessAt)} (ora di Roma)` : "non ancora disponibile"}
        </strong>
      </p>
      {s.enabled && s.lastSuccessAt && s.outcome === "applied" && (
        <p className={styles.caption}>
          Nuove voci nell’ultima lettura: {s.counts.inserted}. Voci già presenti:{" "}
          {s.counts.replayed}.
        </p>
      )}
      {attention && (
        <p className={styles.reviewHelp}>
          {stale
            ? "Non risulta una lettura completata negli ultimi 45 minuti. Verifica il collegamento automatico."
            : packlinkIssueLabel(s.reason)}
        </p>
      )}
    </section>
  );
}
