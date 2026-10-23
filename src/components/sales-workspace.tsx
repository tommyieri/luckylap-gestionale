"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { VerifiedMember } from "@/lib/auth/model";
import {
  money,
  moneyInput,
  quantityLabel,
  isExternalSalesOrder,
  salesChannelLabel,
  salesOrderLabel,
  type SalesOrder,
  type SalesSnapshot,
} from "@/lib/sales/model";
import {
  newSalePayload,
  paymentPayload,
  productionPayload,
  quantityCommandPayload,
} from "@/lib/sales/forms";
import { SalesCommandForm } from "./sales-command-form";
import { NewSaleFields, PaymentMethodField, SaleTimeField } from "./sales-new-sale";
import { SalesPendingRecovery } from "./sales-pending-recovery";
import { salesAttemptNames, type SalesAttemptNames } from "../lib/sales/attempt";
import {
  listenForSalesOrderLinks,
  salesOrderDestination,
  SALES_ORDER_PAGE_SIZE,
} from "../lib/sales/navigation";
import styles from "./sales-workspace.module.css";

const observedPaymentLabel: Record<string, string> = {
  unpaid: "Da incassare su Shopify",
  partially_paid: "Incasso parziale Shopify",
  paid: "Incasso osservato su Shopify",
  partially_refunded: "Rimborso parziale Shopify",
  refunded: "Rimborsata su Shopify",
};
const declaredPaymentLabel: Record<string, string> = {
  unpaid: "Da incassare",
  partially_paid: "Incasso parziale dichiarato",
  paid: "Incasso dichiarato",
  partially_refunded: "Rimborso parziale dichiarato",
  refunded: "Rimborso dichiarato",
};
const remainingToCollect = (order: SalesOrder): number | null =>
  typeof order.effectiveAmountDueCents === "number"
    ? order.effectiveAmountDueCents
    : isExternalSalesOrder(order)
      ? null
      : ["paid", "refunded"].includes(order.paymentState)
        ? 0
        : order.totalCents - order.cancelledCents;
function hasCollectionDue(order: SalesOrder): boolean {
  if (order.orderState === "cancelled") return false;
  const amount = remainingToCollect(order);
  return amount === null
    ? !order.paymentCorrected &&
        ["unpaid", "partially_paid"].includes(order.sourcePaymentState ?? order.paymentState)
    : amount > 0;
}
const fulfillmentLabel: Record<string, string> = {
  unfulfilled: "Da preparare",
  partial: "Consegna parziale",
  fulfilled: "Consegnata",
  cancelled: "Annullata",
};
function date(value: string) {
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(new Date(value));
}

export function SalesWorkspace({
  snapshot,
  member,
  now,
  health,
}: {
  snapshot: SalesSnapshot;
  member: VerifiedMember;
  now: string;
  health?: ReactNode;
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(0);
  const [linkedOrder, setLinkedOrder] = useState<{ id: string } | null>(null);
  useEffect(
    () =>
      listenForSalesOrderLinks((hash) => {
        const destination = salesOrderDestination(snapshot.orders, hash);
        if (!destination) return;
        setSearch("");
        setFilter("all");
        setPage(destination.page);
        setLinkedOrder({ id: destination.orderId });
      }),
    [snapshot.orders],
  );
  const waiting = snapshot.requirements.filter(
    (row) => row.required > row.completed + row.cancelled,
  );
  const filtered = snapshot.orders.filter(
    (order) =>
      (filter !== "open" ||
        !["fulfilled", "cancelled"].includes(order.fulfillmentState) ||
        hasCollectionDue(order)) &&
      `${order.id} ${order.reference ?? ""} ${order.lines.map((line) => line.sku).join(" ")}`
        .toLocaleLowerCase("it")
        .includes(search.toLocaleLowerCase("it")),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / SALES_ORDER_PAGE_SIZE)),
    currentPage = Math.min(page, pageCount - 1);
  useEffect(() => {
    if (!linkedOrder) return;
    const target = document.getElementById(`order-${linkedOrder.id}`);
    if (target instanceof HTMLDetailsElement) {
      target.open = true;
      target.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, [linkedOrder, currentPage]);
  const activeAvailability = snapshot.availability;
  const ready = activeAvailability.some((row) => row.onHand === null)
    ? null
    : activeAvailability.reduce((sum, row) => sum + row.onHand!, 0);
  const reserved = activeAvailability.reduce((sum, row) => sum + row.reserved, 0),
    toProduce = waiting.reduce((sum, row) => sum + row.required - row.completed - row.cancelled, 0);
  const canProduce = member.role === "founder" || member.role === "production";
  // Un invio da verificare mostra articoli e ordini con i nomi della pagina (06 R4).
  const names = salesAttemptNames(snapshot);
  const activeScopes = [
    "new-sale",
    ...waiting.filter(() => canProduce).map((row) => `production:${row.id}`),
    ...snapshot.orders
      .filter((order) => !isExternalSalesOrder(order))
      .flatMap((order) => [
        ...(order.lines.some((line) => line.quantity > line.fulfilled + line.cancelled)
          ? [`fulfill:${order.id}`, `cancel:${order.id}`]
          : []),
        ...(hasCollectionDue(order) ? [`payment:${order.id}`] : []),
      ]),
  ];
  return (
    <div className={styles.main}>
      <div className={styles.heading}>
        <div>
          <h1>Vendite</h1>
          <p>Ogni vendita aggiorna magazzino, produzione e Finance.</p>
        </div>
        <a href="#new-sale" className="button button-primary">
          Nuova vendita
        </a>
      </div>
      {!snapshot.enabled ? (
        <div className={styles.notice} role="status">
          <strong>Nuove vendite manuali ancora disattivate</strong>
          <p>
            Le quantità iniziali provengono dal Drive. Prima dell’avvio Tommi deve confermare la
            conta e quali ordini sono già compresi: per ora puoi leggere e compilare le vendite
            manuali. La produzione degli ordini Shopify può proseguire per i ruoli abilitati. I
            tentativi già sospesi possono essere verificati.
          </p>
        </div>
      ) : (
        <div className={styles.info}>
          <strong>Registrazione condivisa attiva</strong>
          <p>
            Avvio: {snapshot.startedAt ? date(snapshot.startedAt) : "Da verificare"} · Europe/Rome.
            Non reinserire vendite anteriori o già comprese nell’inventario iniziale.
          </p>
        </div>
      )}
      <SalesPendingRecovery userId={member.userId} activeScopes={activeScopes} names={names} />
      <div className={styles.metrics}>
        <div>
          <span>Capi fisici pronti</span>
          <strong>{quantityLabel(ready)}</strong>
        </div>
        <div>
          <span>Capi già riservati</span>
          <strong>{reserved}</strong>
        </div>
        <div>
          <span>Disponibili fisicamente</span>
          <strong>{quantityLabel(ready === null ? null : ready - reserved)}</strong>
        </div>
        <div>
          <span>Capi da produrre</span>
          <strong>{toProduce}</strong>
        </div>
      </div>
      <p className={styles.help}>
        Le quantità Shopify rappresentano il vendibile commerciale e restano distinte dal pronto
        fisico. Shopify e Shopify POS non si registrano manualmente qui.
      </p>
      {health}
      <section id="new-sale" className={styles.section}>
        <div className={styles.sectionTitle}>
          <h2>Nuova vendita</h2>
          <span>Diretta · Etsy · Altri canali manuali</span>
        </div>
        <div className={styles.body}>
          <SalesCommandForm
            userId={member.userId}
            scope="new-sale"
            kind="register_manual_sale"
            enabled={snapshot.enabled}
            label="Registra vendita"
            build={(form) => newSalePayload(form, snapshot)}
            names={names}
          >
            <NewSaleFields snapshot={snapshot} now={now} />
          </SalesCommandForm>
        </div>
      </section>
      <section className={styles.section} aria-labelledby="sales-orders">
        <div className={styles.sectionTitle}>
          <h2 id="sales-orders">Ordini</h2>
          <span>{snapshot.orders.length} registrati nel gestionale</span>
        </div>
        <div className={styles.toolbar}>
          <label>
            Cerca ordine o SKU
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setLinkedOrder(null);
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder="Riferimento, SKU o codice ordine"
            />
          </label>
          <label>
            Visualizza
            <select
              value={filter}
              onChange={(event) => {
                setLinkedOrder(null);
                setFilter(event.target.value);
                setPage(0);
              }}
            >
              <option value="all">Tutti gli ordini</option>
              <option value="open">Da preparare o incassare</option>
            </select>
          </label>
        </div>
        {!filtered.length ? (
          <div className={styles.empty}>
            <h3>
              {snapshot.orders.length
                ? "Nessun ordine corrisponde alla ricerca."
                : "Il registro è pronto per i primi ordini."}
            </h3>
            <p>
              Le vendite manuali e gli ordini Shopify ricevuti e verificati compariranno in questo
              registro, ciascuno con la propria fonte.
            </p>
          </div>
        ) : (
          <div>
            {filtered
              .slice(currentPage * SALES_ORDER_PAGE_SIZE, (currentPage + 1) * SALES_ORDER_PAGE_SIZE)
              .map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  snapshot={snapshot}
                  member={member}
                  now={now}
                  names={names}
                  opened={linkedOrder?.id === order.id}
                />
              ))}
          </div>
        )}
        <div className={styles.pagination}>
          <span>
            {filtered.length} risultati · Pagina {currentPage + 1} di {pageCount}
          </span>
          <button
            className="button button-secondary button-small"
            disabled={currentPage === 0}
            onClick={() => {
              setLinkedOrder(null);
              setPage(currentPage - 1);
            }}
          >
            Precedente
          </button>
          <button
            className="button button-secondary button-small"
            disabled={currentPage + 1 >= pageCount}
            onClick={() => {
              setLinkedOrder(null);
              setPage(currentPage + 1);
            }}
          >
            Successiva
          </button>
        </div>
      </section>
      <section className={styles.section} aria-labelledby="sales-production">
        <div className={styles.sectionTitle}>
          <h2 id="sales-production">Produzione da completare</h2>
          <span>
            {toProduce} capi · {waiting.length} fabbisogni
          </span>
        </div>
        {!waiting.length ? (
          <div className={styles.empty}>
            <h3>Nessun fabbisogno aperto.</h3>
            <p>
              Gli ordini da preparare aprono un fabbisogno soltanto per i capi che non sono già
              pronti.
            </p>
          </div>
        ) : (
          waiting.map((requirement) => {
            const order = snapshot.orders.find((order) =>
              order.lines.some((line) => line.id === requirement.lineId),
            )!;
            const line = order.lines.find((line) => line.id === requirement.lineId)!;
            const remaining = requirement.required - requirement.completed - requirement.cancelled;
            return (
              <details key={requirement.id} className={styles.order}>
                <summary>
                  <div>
                    <strong>{line.sku}</strong>
                    <span>
                      {salesOrderLabel(order)} ·{" "}
                      {snapshot.locations.find((location) => location.id === line.locationId)?.name}
                    </span>
                  </div>
                  <span className={styles.badge}>{remaining} da produrre</span>
                </summary>
                <div className={styles.orderBody}>
                  <p className={styles.help}>
                    Fabbisogno iniziale {requirement.required} · Completati {requirement.completed}{" "}
                    · Annullati {requirement.cancelled}. Registrare soltanto capi prodotti e
                    verificati: ricevimento e riserva sull’ordine avvengono insieme.
                  </p>
                  {canProduce ? (
                    <SalesCommandForm
                      userId={member.userId}
                      scope={`production:${requirement.id}`}
                      kind="complete_production"
                      enabled={snapshot.enabled || isExternalSalesOrder(order)}
                      label="Registra capi pronti"
                      build={(form) => productionPayload(form, requirement.id)}
                      names={names}
                    >
                      <div className={styles.grid}>
                        <label>
                          Capi completati
                          <input
                            name="quantity"
                            type="number"
                            min={1}
                            max={remaining}
                            defaultValue={remaining}
                            required
                          />
                        </label>
                        <SaleTimeField now={now} />
                      </div>
                      <label>
                        Nota di ricevimento
                        <textarea name="reason" required minLength={3} maxLength={500} rows={2} />
                      </label>
                    </SalesCommandForm>
                  ) : (
                    <p className={styles.info}>
                      Tommi o Gabriele possono registrare i capi completati.
                    </p>
                  )}
                </div>
              </details>
            );
          })
        )}
      </section>
      <details className={styles.section}>
        <summary className={styles.sectionTitle}>
          <h2>Disponibilità per SKU e magazzino</h2>
          <span>Pronto fisico, riservato e disponibile</span>
        </summary>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Magazzino</th>
                <th>Pronto</th>
                <th>Riservato</th>
                <th>Disponibile</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.availability.map((row) => (
                <tr key={`${row.itemId}:${row.locationId}`}>
                  <td>{snapshot.items.find((item) => item.id === row.itemId)?.sku}</td>
                  <td>
                    {snapshot.locations.find((location) => location.id === row.locationId)?.name}
                  </td>
                  <td>{quantityLabel(row.onHand)}</td>
                  <td>{row.reserved}</td>
                  <td>{quantityLabel(row.available)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <footer className={styles.footer}>
        <span>LuckyLap · Vendite in EUR · Orari Europe/Rome</span>
        <span>I fatti osservati non equivalgono a contabilità approvata o saldo bancario.</span>
      </footer>
    </div>
  );
}

function OrderCard({
  order,
  snapshot,
  member,
  now,
  names,
  opened = false,
}: {
  order: SalesOrder;
  snapshot: SalesSnapshot;
  member: VerifiedMember;
  now: string;
  names: SalesAttemptNames;
  opened?: boolean;
}) {
  const pendingLines = order.lines.filter(
    (line) => line.quantity > line.fulfilled + line.cancelled,
  );
  const external = isExternalSalesOrder(order);
  const payable = !external && hasCollectionDue(order);
  return (
    <details id={`order-${order.id}`} className={styles.order} open={opened || undefined}>
      <summary>
        <div>
          <strong>{salesOrderLabel(order)}</strong>
          <span>
            {salesChannelLabel[order.channel]} · {date(order.occurredAt)} · {order.lines.length} SKU
          </span>
        </div>
        <div className={styles.orderSummary}>
          <span className={styles.badge}>{fulfillmentLabel[order.fulfillmentState]}</span>
          <span className={styles.badge}>
            {external && !order.paymentCorrected
              ? observedPaymentLabel[order.paymentState]
              : order.orderState === "cancelled"
                ? "Annullata"
                : declaredPaymentLabel[order.paymentState]}
          </span>
          <strong>{money(order.totalCents - order.cancelledCents)}</strong>
        </div>
      </summary>
      <div className={styles.orderBody}>
        {external && (
          <div className={styles.info}>
            <strong>Fonte: {salesChannelLabel[order.channel]} · Importazione automatica</strong>
            <p>
              Origine tecnica: sincronizzazione Shopify con account tecnico. Pagamenti, consegne e
              annulli seguono Shopify. Il team può completare la produzione secondo i propri ruoli.
              L’incasso osservato non conferma l’accredito bancario.
            </p>
            <p>Il totale ordine può includere spedizione e imposte oltre al valore dei capi.</p>
          </div>
        )}
        {order.paymentCorrected && (
          <div className={styles.notice}>
            <strong>Incassi rettificati in Finance</strong>
            <p>
              Da incassare: {money(remainingToCollect(order))}.{" "}
              {external &&
                `Stato osservato su Shopify: ${observedPaymentLabel[order.sourcePaymentState ?? ""] ?? "Da verificare"}.`}
            </p>
          </div>
        )}
        {order.cancelledCents > 0 && (
          <p className={styles.help}>
            Valore originario {money(order.totalCents)} · Annullato {money(order.cancelledCents)} ·
            Residuo {money(order.totalCents - order.cancelledCents)}
          </p>
        )}
        {order.refundDueCents > 0 && (
          <div className={styles.notice}>
            <strong>Da rimborsare: {money(order.refundDueCents)}</strong>
            <p>
              Il saldo dichiarato supera il valore attuale dell’ordine. Nessun rimborso o movimento
              di cassa è stato eseguito automaticamente.
            </p>
          </div>
        )}
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>SKU / magazzino</th>
                <th>Ordinate</th>
                <th>Riservate</th>
                <th>Da produrre</th>
                <th>Consegnate</th>
                <th>Annullate</th>
                <th>Valore / costo / margine iniziali</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => {
                const req = snapshot.requirements.find((row) => row.lineId === line.id),
                  margin =
                    line.costCents === null
                      ? null
                      : BigInt(line.totalCents) - BigInt(line.costCents) * BigInt(line.quantity);
                return (
                  <tr key={line.id}>
                    <td>
                      <strong>{line.sku}</strong>
                      <small>
                        {
                          snapshot.locations.find((location) => location.id === line.locationId)
                            ?.name
                        }
                      </small>
                    </td>
                    <td>{line.quantity}</td>
                    <td>{line.reserved}</td>
                    <td>{req ? req.required - req.completed - req.cancelled : 0}</td>
                    <td>{line.fulfilled}</td>
                    <td>{line.cancelled}</td>
                    <td>
                      <strong>{money(line.totalCents)}</strong>
                      <small>
                        Costo unitario {money(line.costCents)} · Margine capi {money(margin)}
                      </small>
                      <small>
                        Prezzo {money(line.priceCents)} · Sconto riga {money(line.discountCents)}
                      </small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className={styles.help}>
          Costi fotografati al momento della vendita. Il margine iniziale sui capi precede IVA,
          spedizioni e commissioni; non rappresenta l’utile.
        </p>
        {!external && pendingLines.length > 0 && (
          <div className={styles.lifecycle}>
            <details>
              <summary>Registra una consegna</summary>
              <SalesCommandForm
                userId={member.userId}
                scope={`fulfill:${order.id}`}
                kind="fulfill_order_lines"
                enabled={snapshot.enabled}
                label="Conferma uscita fisica"
                names={names}
                build={(form) =>
                  quantityCommandPayload(
                    form,
                    "fulfill_order_lines",
                    order.id,
                    pendingLines.map((line) => line.id),
                  )
                }
              >
                <p className={styles.help}>
                  Indica solo i capi che escono ora dal magazzino. Puoi consegnare parzialmente fino
                  alla quantità riservata.
                </p>
                <div className={styles.grid}>
                  {pendingLines.map((line) => (
                    <label key={line.id}>
                      {line.sku} · {line.reserved} riservati
                      <input
                        name={`quantity:${line.id}`}
                        type="number"
                        min={0}
                        max={line.reserved}
                        defaultValue={0}
                      />
                    </label>
                  ))}
                </div>
                <SaleTimeField now={now} />
                <label>
                  Causale consegna
                  <textarea name="reason" required minLength={3} maxLength={500} rows={2} />
                </label>
              </SalesCommandForm>
            </details>
            <details>
              <summary>Annulla capi non consegnati</summary>
              <SalesCommandForm
                userId={member.userId}
                scope={`cancel:${order.id}`}
                kind="cancel_unfulfilled_lines"
                enabled={snapshot.enabled}
                label="Conferma annullo"
                names={names}
                build={(form) =>
                  quantityCommandPayload(
                    form,
                    "cancel_unfulfilled_lines",
                    order.id,
                    pendingLines.map((line) => line.id),
                  )
                }
              >
                <p className={styles.help}>
                  L’annullo libera le riserve e riduce il fabbisogno ancora aperto. Un eventuale
                  rimborso rimane da eseguire separatamente.
                </p>
                <div className={styles.grid}>
                  {pendingLines.map((line) => (
                    <label key={line.id}>
                      {line.sku} · {line.quantity - line.fulfilled - line.cancelled} non consegnati
                      <input
                        name={`quantity:${line.id}`}
                        type="number"
                        min={0}
                        max={line.quantity - line.fulfilled - line.cancelled}
                        defaultValue={0}
                      />
                    </label>
                  ))}
                </div>
                <SaleTimeField now={now} />
                <label>
                  Motivo annullo
                  <textarea name="reason" required minLength={3} maxLength={500} rows={2} />
                </label>
              </SalesCommandForm>
            </details>
          </div>
        )}
        {payable && (
          <details className={styles.payment}>
            <summary>Registra il saldo da incassare</summary>
            <SalesCommandForm
              userId={member.userId}
              scope={`payment:${order.id}`}
              kind="record_manual_payment"
              enabled={snapshot.enabled}
              label="Dichiara incasso ricevuto"
              build={(form) => paymentPayload(form, order.id)}
              names={names}
            >
              <p className={styles.help}>
                Registra un incasso già avvenuto per l’intero saldo residuo. Non si esegue alcun
                addebito.
              </p>
              <div className={styles.grid}>
                <label>
                  Importo intero dovuto · €
                  <input name="amount" value={moneyInput(remainingToCollect(order))} readOnly />
                </label>
                <PaymentMethodField />
                <SaleTimeField now={now} />
                <label>
                  Riferimento incasso · facoltativo
                  <input name="reference" maxLength={240} />
                </label>
              </div>
            </SalesCommandForm>
          </details>
        )}
      </div>
    </details>
  );
}
