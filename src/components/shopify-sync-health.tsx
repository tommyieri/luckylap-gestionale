import "server-only";
import {
  groupShopifyReviews,
  shopifyReviewHref,
  shopifyReviewLabel,
  type ShopifySyncStatus,
} from "../lib/shopify/status-model";
import styles from "./shopify-sync-health.module.css";
const date = (value: string) =>
  new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(new Date(value));

export function ShopifySyncHealth({
  status,
  shopDomain = process.env.SHOPIFY_SHOP_DOMAIN,
}: {
  status: ShopifySyncStatus;
  shopDomain?: string;
}) {
  if (status.status !== "ready")
    return (
      <section className={styles.section} aria-label="Stato Shopify">
        <div className={styles.heading}>
          <h2>Collegamento Shopify</h2>
          <span>Stato non disponibile</span>
        </div>
        <p className={styles.caption}>
          Non è stato possibile verificare il collegamento. Le vendite già registrate restano
          consultabili; riprova ricaricando la pagina.
        </p>
      </section>
    );
  const { snapshot: s } = status;
  const reviews = groupShopifyReviews(s.reviews);
  return (
    <section className={styles.section} aria-labelledby="shopify-sync-title">
      <div className={styles.heading}>
        <h2 id="shopify-sync-title">Collegamento Shopify</h2>
        <span>
          {!s.configured
            ? "Da collegare"
            : !s.enabled
              ? "In pausa"
              : s.counters.review > 0
                ? "Richiede attenzione"
                : "Attivo"}
        </span>
      </div>
      <p className={styles.caption}>
        {!s.configured
          ? "Il collegamento degli ordini Shopify deve ancora essere completato."
          : s.enabled
            ? s.counters.review > 0
              ? "Alcuni aggiornamenti ricevuti da Shopify non sono stati applicati e richiedono una verifica prima di aggiornare ordini, disponibilità fisica e Finance."
              : "Gli aggiornamenti ricevuti da Shopify vengono verificati prima di aggiornare ordini, disponibilità fisica e Finance."
            : "La sincronizzazione degli ordini è in pausa. Le nuove notifiche restano in attesa della riattivazione."}{" "}
        L’inventario commerciale Shopify resta distinto dal pronto fisico di Magadzino.
      </p>
      <p className={styles.updated}>
        Ultimo aggiornamento:{" "}
        <strong>
          {s.counters.lastAppliedAt
            ? `${date(s.counters.lastAppliedAt)} (ora di Roma)`
            : "non ancora disponibile"}
        </strong>
      </p>
      {s.counters.review > 0 && (
        <div className={styles.reviews} role="group" aria-labelledby="shopify-review-title">
          <h3 id="shopify-review-title">Ordini da verificare</h3>
          <p className={styles.reviewHelp}>
            Gli aggiornamenti da verificare sono raggruppati per ordine. Se compare un caso, avvisa
            Tommi. Non registrare a mano lo stesso ordine.
          </p>
          <ul>
            {reviews.map((r) => {
              const href = shopifyReviewHref(shopDomain, r.orderGid);
              const reasons = [...new Set(r.reasons.map(shopifyReviewLabel))];
              return (
                <li key={r.orderGid}>
                  <div>
                    {reasons.map((reason) => (
                      <strong key={reason}>{reason}</strong>
                    ))}
                    <span>Ultima segnalazione: {date(r.observedAt)} (ora di Roma)</span>
                  </div>
                  {href && (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      Apri ordine su Shopify
                      <span className="sr-only"> · Si apre in una nuova scheda</span>
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
          {s.counters.review > s.reviews.length && (
            <p className={styles.reviewHelp}>
              Sono raggruppate le {s.reviews.length} notifiche più recenti. Altri ordini da
              verificare potrebbero non essere visibili.
            </p>
          )}
        </div>
      )}
      <details className={styles.technical}>
        <summary>Dettagli tecnici</summary>
        <dl className={styles.counts}>
          {[
            ["In attesa", s.counters.pending],
            ["In elaborazione", s.counters.processing],
            ["Da riprovare", s.counters.retry],
            ["Da verificare", s.counters.review],
            ["Notifiche gestite", s.counters.applied],
            ["Notifiche escluse", s.counters.ignored],
          ].map(([label, count]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.caption}>
          I conteggi riguardano gli aggiornamenti ricevuti da Shopify, non il numero di vendite.
        </p>
      </details>
    </section>
  );
}
