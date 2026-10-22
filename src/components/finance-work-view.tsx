"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { salesChannelLabel, salesOrderLabel } from "@/lib/sales/model";
import {
  centsLabel,
  financeEntryForm,
  type FinanceWorkSnapshot,
  type ManualEntry,
  type SalesFact,
} from "@/lib/finance-work/model";
import {
  FinanceWorkForm,
  FinanceWorkRecovery,
  FinanceAccountCategoryFields,
} from "./finance-work-form";
import styles from "./finance-work.module.css";
const short = (value: string) => value.slice(0, 8).toUpperCase();
const timestamp = (value: string) =>
  new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
const day = (value: string) => value.split("-").reverse().join("/");
const methods: Record<string, string> = {
  cash: "Contanti",
  bank_transfer: "Bonifico",
  external_card: "Carta esterna a Shopify",
  other: "Altro",
};

export function FinanceWorkView({
  snapshot,
  userId,
  today,
  readOnly = false,
  consignment,
}: {
  snapshot: FinanceWorkSnapshot;
  userId: string;
  /** Non più mostrato qui: il nome del membro sta nel menu del guscio. */
  displayName: string;
  today: string;
  readOnly?: boolean;
  /** Pannello «Conto vendita · da incassare», reso dalla pagina sul server. */
  consignment?: ReactNode;
}) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(0);
  const declaredPayments = snapshot.payments.filter((p) => p.source === "manual_declaration");
  const sales = snapshot.facts.filter((f) => f.kind === "sale_observed"),
    cancellations = snapshot.facts.filter((f) => f.kind === "sale_cancellation_observed");
  const filtered = snapshot.entries.filter(
    (entry) =>
      (filter === "all" ||
        (filter === "voided" && entry.void !== null) ||
        (filter === "active" && entry.void === null)) &&
      `${entry.description} ${entry.account ?? ""} ${entry.category ?? ""}`
        .toLocaleLowerCase("it")
        .includes(query.toLocaleLowerCase("it")),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 20)),
    current = Math.min(page, pages - 1),
    visible = filtered.slice(current * 20, current * 20 + 20);
  return (
    <div className={styles.main}>
      <div className={styles.heading}>
        <h1>Registrazioni</h1>
        <p>
          Le vendite alimentano questi fatti automaticamente. Le dichiarazioni manuali restano
          distinte dalle fonti importate.
        </p>
      </div>
      <div className={styles.notice}>
        <strong>Prima di aggiungere una voce, verifica che non esista già.</strong>
        <p>
          Una vendita, il suo incasso e l’accredito su conto rappresentano fasi diverse. Non sommare
          queste tabelle tra loro e non ricopiare automaticamente righe BudgetFlow, COGS o PDF. Le
          voci qui sono dichiarazioni operative da classificare, senza contabilizzazione fiscale,
          IVA o saldi bancari automatici.
        </p>
      </div>
      <FinanceWorkRecovery
        userId={userId}
        activeScopes={["record", ...visible.map((entry) => `void:${entry.id}`)]}
      />
      <div className={styles.metrics}>
        <div>
          <span>Vendite osservate</span>
          <strong>{sales.length}</strong>
        </div>
        <div>
          <span>Incassi dichiarati</span>
          <strong>{declaredPayments.length}</strong>
        </div>
        <div>
          <span>Annulli commerciali</span>
          <strong>{cancellations.length}</strong>
        </div>
        <div>
          <span>Voci manuali attive</span>
          <strong>{snapshot.entries.filter((entry) => !entry.void).length}</strong>
        </div>
      </div>
      <FactSection
        title="Vendite osservate"
        description="Valore originario degli ordini. Gli annulli sono riportati nella propria tabella; un incasso non è una seconda vendita."
        facts={sales}
        snapshot={snapshot}
      />
      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2>Incassi dichiarati</h2>
          <span>{declaredPayments.length} dichiarazioni</span>
        </div>
        <p className={styles.caption}>
          Pagamenti dichiarati dai collaboratori, senza verifica del gateway o dell’accredito
          bancario. Il fatto Finance collegato non viene mostrato come secondo incasso.
        </p>
        {!declaredPayments.length ? (
          <p className={styles.empty}>Nessun incasso dichiarato dagli ordini.</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Data · Europe/Rome</th>
                  <th>Ordine</th>
                  <th>Metodo / riferimento</th>
                  <th>Importo dichiarato</th>
                </tr>
              </thead>
              <tbody>
                {declaredPayments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{timestamp(payment.occurredAt)}</td>
                    <td>
                      <OrderLink id={payment.orderId} snapshot={snapshot} />
                    </td>
                    <td>
                      {methods[payment.method]}
                      <small>{payment.reference || "Riferimento non fornito"}</small>
                    </td>
                    <td className={styles.amount}>{centsLabel(payment.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ShopifyMoneySections snapshot={snapshot} />
      <FactSection
        title="Annulli commerciali"
        description="Valore annullato sull’ordine. L’annullo non esegue un rimborso e non prova che sia avvenuto un reso fisico."
        facts={cancellations}
        snapshot={snapshot}
      />
      {consignment}
      <section id="new-finance-entry" className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2>Nuova voce manuale</h2>
          <span>EUR · Da classificare</span>
        </div>
        <div className={styles.body}>
          <FinanceWorkForm
            userId={userId}
            scope="record"
            kind="record_finance_entry"
            label="Registra dichiarazione manuale"
            disabled={readOnly}
            build={financeEntryForm}
          >
            <div className={styles.grid}>
              <label>
                Data del movimento · Europe/Rome
                <input name="date" type="date" required defaultValue={today} />
              </label>
              <label>
                Tipo
                <select name="type" defaultValue="expense">
                  <option value="expense">Uscita</option>
                  <option value="income">Entrata</option>
                </select>
              </label>
              <label>
                Importo positivo · €
                <input name="amount" inputMode="decimal" placeholder="0,00" required />
              </label>
              <FinanceAccountCategoryFields
                accounts={snapshot.entries.map((entry) => entry.account ?? "")}
              />
            </div>
            <label>
              Descrizione
              <textarea name="description" required minLength={3} maxLength={2000} rows={3} />
            </label>
            <label className={styles.checkbox}>
              <input name="confirmed" type="checkbox" required />
              <span>
                Ho verificato BudgetFlow e i fatti delle vendite: questa voce non duplica
                un’operazione già registrata.
              </span>
            </label>
            <p className={styles.help}>
              Le date future sono promemoria, non movimenti avvenuti. Per correggere una voce,
              annullala con una causale e registra quella corretta: l’originale resta consultabile.
            </p>
          </FinanceWorkForm>
        </div>
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <h2>Registro manuale</h2>
          <span>{snapshot.entries.length} voci conservate</span>
        </div>
        <div className={styles.toolbar}>
          <label>
            Cerca nel registro
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder="Descrizione, conto o categoria"
            />
          </label>
          <label>
            Stato
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(0);
              }}
            >
              <option value="all">Tutte le voci</option>
              <option value="active">Non annullate</option>
              <option value="voided">Annullate</option>
            </select>
          </label>
        </div>
        {visible.length ? (
          visible.map((entry) => (
            <ManualEntryCard key={entry.id} entry={entry} userId={userId} readOnly={readOnly} />
          ))
        ) : (
          <p className={styles.empty}>
            Nessuna voce manuale corrisponde ai filtri. Le fonti BudgetFlow rimangono nella loro
            sezione.
          </p>
        )}
        <div className={styles.pagination}>
          <span>
            {filtered.length} risultati · Pagina {current + 1} di {pages}
          </span>
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Precedente
          </button>
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={current + 1 >= pages}
            onClick={() => setPage(current + 1)}
          >
            Successiva
          </button>
        </div>
      </section>
      <footer className={styles.footer}>
        <span>LuckyLap Finance · Fonte dichiarata dall’utente</span>
        <span>Nessun saldo o utile ricavato dalla somma delle fonti.</span>
      </footer>
    </div>
  );
}
function OrderLink({ id, snapshot }: { id: string; snapshot: FinanceWorkSnapshot }) {
  const order = snapshot.orders.find((order) => order.id === id);
  return (
    <Link href={`/sales#order-${id}`}>
      {order ? salesOrderLabel(order) : `Ordine ${short(id)}`}
    </Link>
  );
}
function ShopifyMoneySections({ snapshot }: { snapshot: FinanceWorkSnapshot }) {
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
function FactSection({
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
function ManualEntryCard({
  entry,
  userId,
  readOnly,
}: {
  entry: ManualEntry;
  userId: string;
  readOnly: boolean;
}) {
  return (
    <details className={styles.entry}>
      <summary>
        <div>
          <strong>{entry.description || "Voce precedente senza descrizione"}</strong>
          <span>
            {day(entry.date)} · {entry.type === "income" ? "Entrata" : "Uscita"} ·{" "}
            {entry.account || "Conto non indicato"}
          </span>
        </div>
        <div className={styles.entrySummary}>
          <span className={styles.badge}>{entry.void ? "Annullata" : "Da classificare"}</span>
          <strong>{centsLabel(entry.cents)}</strong>
        </div>
      </summary>
      <div className={styles.body}>
        <dl className={styles.facts}>
          <div>
            <dt>Fonte</dt>
            <dd>
              {entry.source === "manual_declaration"
                ? "Dichiarazione manuale"
                : "Voce precedente, origine non classificata"}
            </dd>
          </div>
          <div>
            <dt>Categoria dichiarata</dt>
            <dd>{entry.category || "Non indicata"}</dd>
          </div>
          <div>
            <dt>Inserita il</dt>
            <dd>{timestamp(entry.createdAt)}</dd>
          </div>
          <div>
            <dt>Contabilizzazione</dt>
            <dd>Non eseguita · Da classificare</dd>
          </div>
        </dl>
        {entry.void && (
          <div className={styles.notice}>
            <strong>Annullata il {timestamp(entry.void.createdAt)}</strong>
            <p>{entry.void.reason}</p>
            <p>L’importo originale è conservato; l’annullo non esegue un movimento bancario.</p>
          </div>
        )}
        <FinanceWorkForm
          userId={userId}
          scope={`void:${entry.id}`}
          kind="void_finance_entry"
          disabled={entry.void !== null || readOnly}
          label="Annulla questa dichiarazione"
          build={(form) => ({ schema_version: 1, entry_id: entry.id, reason: form.get("reason") })}
        >
          <label>
            Causale di annullamento
            <textarea name="reason" minLength={3} maxLength={500} rows={2} required />
          </label>
          <p className={styles.help}>
            L’annullamento conserva questa voce. Registra poi separatamente la dichiarazione
            corretta, dopo aver verificato le altre fonti.
          </p>
        </FinanceWorkForm>
      </div>
    </details>
  );
}
