"use client";
import Link from "next/link";
import { salesChannelLabel, salesOrderLabel } from "../../lib/sales/model";
import { centsLabel, type FinanceWorkSnapshot, type SalesFact } from "../../lib/finance-work/model";
import { FinanceMovementActions } from "../finance-movement-actions";
import styles from "../finance-work.module.css";
const short = (value: string) => value.slice(0, 8).toUpperCase();
const timestamp = (value: string) =>
  new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));

export function FinanceSourceObservations({
  snapshot,
  readOnly = false,
}: {
  snapshot: FinanceWorkSnapshot;
  readOnly?: boolean;
}) {
  return (
    <>
      <FactSection
        title="Vendite osservate"
        description="Valore originario degli ordini, distinto dai movimenti di denaro."
        facts={snapshot.facts.filter((f) => f.kind === "sale_observed")}
        snapshot={snapshot}
      />
      <ShopifyMoneySections snapshot={snapshot} readOnly={readOnly} />
      <FactSection
        title="Annulli commerciali"
        description="L’annullo non esegue un rimborso e non prova un reso fisico."
        facts={snapshot.facts.filter((f) => f.kind === "sale_cancellation_observed")}
        snapshot={snapshot}
      />
    </>
  );
}

export function OrderLink({ id, snapshot }: { id: string; snapshot: FinanceWorkSnapshot }) {
  const order = snapshot.orders.find((order) => order.id === id);
  return (
    <Link href={`/sales#order-${id}`}>
      {order ? salesOrderLabel(order) : `Ordine ${short(id)}`}
    </Link>
  );
}
export function ShopifyMoneySections({
  snapshot,
  readOnly,
}: {
  snapshot: FinanceWorkSnapshot;
  readOnly: boolean;
}) {
  const received = snapshot.payments.filter((p) => p.source === "shopify_observation");
  const amount = (value: number | null) => (value === null ? "Da verificare" : centsLabel(value));
  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2>Incassi Shopify osservati</h2>
          <span>{received.length} operazioni riuscite</span>
        </div>
        <p className={styles.caption}>
          Capture e vendite confermate dalla fonte Shopify. Sono distinte dalle dichiarazioni del
          team e non provano l’accredito sul conto. Ogni operazione compare una sola volta in questa
          tabella.
        </p>
        {received.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Data · Europe/Rome</th>
                  <th>Ordine / fonte</th>
                  <th>Riferimento tecnico</th>
                  <th>Importo osservato</th>
                  <th>Correzioni</th>
                </tr>
              </thead>
              <tbody>
                {received.map((p) => (
                  <tr key={p.id}>
                    <td>{timestamp(p.occurredAt)}</td>
                    <td>
                      <OrderLink id={p.orderId} snapshot={snapshot} />
                      <small>
                        {
                          salesChannelLabel[
                            snapshot.orders.find((o) => o.id === p.orderId)?.channel ?? ""
                          ]
                        }{" "}
                        · Account tecnico
                      </small>
                    </td>
                    <td>{p.reference}</td>
                    <td className={styles.amount}>{centsLabel(p.cents)}</td>
                    <td>
                      <FinanceMovementActions
                        source="payment"
                        sourceId={p.id}
                        readOnly={readOnly}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>Nessun incasso Shopify verificato è stato registrato.</p>
        )}
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2>Rimborsi Shopify osservati</h2>
          <span>{snapshot.refunds.length} operazioni riuscite</span>
        </div>
        <p className={styles.caption}>
          Rimborsi confermati dalla fonte, separati da annulli commerciali e accrediti bancari. Un
          rimborso Shopify non registra un rientro fisico delle magliette.
        </p>
        {snapshot.refunds.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Data · Europe/Rome</th>
                  <th>Ordine</th>
                  <th>Riferimento tecnico</th>
                  <th>Importo rimborsato</th>
                  <th>Correzioni</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.refunds.map((r) => (
                  <tr key={r.id}>
                    <td>{timestamp(r.occurredAt)}</td>
                    <td>
                      <OrderLink id={r.orderId} snapshot={snapshot} />
                    </td>
                    <td>{r.transactionGid}</td>
                    <td className={styles.amount}>{centsLabel(r.cents)}</td>
                    <td>
                      <FinanceMovementActions source="refund" sourceId={r.id} readOnly={readOnly} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>Nessun rimborso Shopify verificato è stato registrato.</p>
        )}
      </section>
      <details className={styles.section}>
        <summary className={styles.sectionHeading}>
          <h2>Dettagli della fonte Shopify</h2>
          <span>Transazioni e valori fiscali osservati</span>
        </summary>
        <div className={styles.body}>
          <p className={styles.help}>
            Questo registro descrive le stesse operazioni mostrate sopra: non sono ulteriori
            incassi. AUTHORIZATION e VOID non sono incassi. I valori fiscali sono osservazioni della
            fonte da verificare, senza contabilizzazione o saldo bancario automatico.
          </p>
          {snapshot.shopifyTransactions.length ? (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Ordine / transazione</th>
                    <th>Tipo / stato</th>
                    <th>Gateway / parent</th>
                    <th>Data della fonte</th>
                    <th>Importo</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.shopifyTransactions.map((t) => (
                    <tr key={`${t.orderId}:${t.transactionGid}`}>
                      <td>
                        <OrderLink id={t.orderId} snapshot={snapshot} />
                        <small>{t.transactionGid}</small>
                      </td>
                      <td>
                        {t.kind}
                        <small>{t.status}</small>
                      </td>
                      <td>
                        {t.gateway ?? "Non fornito"}
                        <small>{t.parentGid ?? "Nessuna transazione parent"}</small>
                      </td>
                      <td>{t.processedAt ? timestamp(t.processedAt) : "Da verificare"}</td>
                      <td className={styles.amount}>{centsLabel(t.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.empty}>Nessuna transazione Shopify disponibile.</p>
          )}
          {snapshot.shopifyFinancials.map((f) => (
            <div key={f.orderId}>
              <h3>
                <OrderLink id={f.orderId} snapshot={snapshot} />
              </h3>
              <p className={styles.help}>
                Imposte {f.taxesIncluded ? "incluse nei prezzi" : "escluse dai prezzi"} secondo
                Shopify · Osservato {timestamp(f.observedAt)} · Fonte aggiornata{" "}
                {timestamp(f.sourceUpdatedAt)}
              </p>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Valore della fonte</th>
                      <th>Originale</th>
                      <th>Corrente</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Totale ordine</td>
                      <td>{amount(f.totals.originalTotalCents)}</td>
                      <td>{amount(f.totals.currentTotalCents)}</td>
                    </tr>
                    <tr>
                      <td>Subtotale</td>
                      <td>{amount(f.totals.originalSubtotalCents)}</td>
                      <td>{amount(f.totals.currentSubtotalCents)}</td>
                    </tr>
                    <tr>
                      <td>Spedizione</td>
                      <td>{amount(f.totals.totalShippingPriceCents)}</td>
                      <td>{amount(f.totals.currentShippingPriceCents)}</td>
                    </tr>
                    <tr>
                      <td>Imposte</td>
                      <td>{amount(f.totals.originalTaxCents)}</td>
                      <td>{amount(f.totals.currentTaxCents)}</td>
                    </tr>
                    <tr>
                      <td>Sconti totali originali</td>
                      <td>{amount(f.totals.totalDiscountCents)}</td>
                      <td>—</td>
                    </tr>
                    <tr>
                      <td>Sconto ordine originale</td>
                      <td>{amount(f.totals.orderDiscountCents)}</td>
                      <td>—</td>
                    </tr>
                    <tr>
                      <td>Ricevuto prima dei rimborsi</td>
                      <td>—</td>
                      <td>{amount(f.totals.totalReceivedCents)}</td>
                    </tr>
                    <tr>
                      <td>Rimborsato cumulativo</td>
                      <td>—</td>
                      <td>{amount(f.totals.totalRefundedCents)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
export function FactSection({
  title,
  description,
  facts,
  snapshot,
}: {
  title: string;
  description: string;
  facts: SalesFact[];
  snapshot: FinanceWorkSnapshot;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <h2>{title}</h2>
        <span>{facts.length} fatti collegati</span>
      </div>
      <p className={styles.caption}>{description}</p>
      {!facts.length ? (
        <p className={styles.empty}>Nessun fatto di questo tipo è stato registrato.</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data · Europe/Rome</th>
                <th>Ordine / fonte</th>
                <th>Stato</th>
                <th>Valore osservato</th>
              </tr>
            </thead>
            <tbody>
              {facts.map((fact) => (
                <tr key={fact.id}>
                  <td>{timestamp(fact.occurredAt)}</td>
                  <td>
                    <OrderLink id={fact.orderId} snapshot={snapshot} />
                    <small>
                      {fact.source === "shopify_observation"
                        ? "Shopify · Importazione automatica"
                        : "Dichiarazione manuale"}{" "}
                      ·{" "}
                      {
                        salesChannelLabel[
                          snapshot.orders.find((order) => order.id === fact.orderId)?.channel ?? ""
                        ]
                      }
                    </small>
                    {fact.kind === "sale_cancellation_observed" &&
                      (snapshot.orders.find((order) => order.id === fact.orderId)?.refundDueCents ??
                        0) > 0 && (
                        <small>
                          Rimborso dovuto sull’ordine:{" "}
                          {centsLabel(
                            snapshot.orders.find((order) => order.id === fact.orderId)!
                              .refundDueCents,
                          )}{" "}
                          · Da gestire
                        </small>
                      )}
                  </td>
                  <td>
                    <span className={styles.badge}>Osservato, da classificare</span>
                  </td>
                  <td className={styles.amount}>{centsLabel(fact.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
