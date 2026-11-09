"use client";
import {
  OrderLink,
  ShopifyMoneySections,
  FactSection,
} from "./finance/finance-source-observations";
import { useState, type ReactNode } from "react";
import { salesChannelLabel } from "@/lib/sales/model";
import {
  centsLabel,
  financeEntryForm,
  type FinanceWorkSnapshot,
  type ManualEntry,
} from "@/lib/finance-work/model";
import {
  FinanceWorkForm,
  FinanceWorkRecovery,
  FinanceAccountCategoryFields,
} from "./finance-work-form";
import styles from "./finance-work.module.css";
import type { FinanceRevisionRecord } from "../lib/finance-revisions/model";
import { FinanceMovementActions } from "./finance-movement-actions";
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
  revisionHeads = [],
}: {
  snapshot: FinanceWorkSnapshot;
  userId: string;
  /** Non più mostrato qui: il nome del membro sta nel menu del guscio. */
  displayName: string;
  today: string;
  readOnly?: boolean;
  /** Pannello «Conto vendita · da incassare», reso dalla pagina sul server. */
  consignment?: ReactNode;
  revisionHeads?: FinanceRevisionRecord[];
}) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(0);
  const declaredPayments = snapshot.payments
    .filter((p) => p.source === "manual_declaration")
    .map((payment) => ({
      payment,
      head: revisionHeads.find(
        (row) => row.sourceKind === "payment" && row.sourceId === payment.id,
      ),
    }));
  const sales = snapshot.facts.filter((f) => f.kind === "sale_observed"),
    cancellations = snapshot.facts.filter((f) => f.kind === "sale_cancellation_observed");
  const entries = snapshot.entries.map((entry) => {
    const head = revisionHeads.find(
      (row) => row.sourceKind === "manual" && row.sourceId === entry.id,
    );
    const values = head?.values;
    return {
      ...entry,
      ...(values
        ? {
            date: values.date,
            type: values.direction,
            cents: values.amountCents,
            description: values.description,
            account: values.account,
            category: values.category,
          }
        : {}),
      deleted: head?.deleted ?? entry.void !== null,
      pending: values?.pending ?? false,
      revisionVersion: head?.version ?? 0,
    };
  });
  const filtered = entries.filter(
    (entry) =>
      (filter === "all" ||
        (filter === "voided" && entry.deleted) ||
        (filter === "active" && !entry.deleted)) &&
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
      <FinanceWorkRecovery userId={userId} activeScopes={["record"]} />
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
          <strong>{entries.filter((entry) => !entry.deleted).length}</strong>
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
          Importi attuali, con le correzioni Finance. Se un incasso è stato corretto, sotto resta il
          valore dichiarato in Vendite. Un incasso si annulla in Vendite, non da qui.
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
                  <th>Importo</th>
                  <th>Correzioni</th>
                </tr>
              </thead>
              <tbody>
                {declaredPayments.map(({ payment, head }) => (
                  <tr key={payment.id}>
                    <td>{timestamp(payment.occurredAt)}</td>
                    <td>
                      <OrderLink id={payment.orderId} snapshot={snapshot} />
                    </td>
                    <td>
                      {methods[payment.method]}
                      <small>{payment.reference || "Riferimento non fornito"}</small>
                    </td>
                    <td className={styles.amount}>
                      <EffectiveAmount declaredCents={payment.cents} head={head} />
                    </td>
                    <td>
                      <FinanceMovementActions
                        source="payment"
                        sourceId={payment.id}
                        readOnly={readOnly}
                        deleted={head?.deleted}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ShopifyMoneySections snapshot={snapshot} readOnly={readOnly} />
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
              Le date future sono promemoria, non movimenti avvenuti. Ogni voce si corregge dal suo
              storico, conservando la fonte e le versioni precedenti.
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
              <option value="active">Attive</option>
              <option value="voided">Eliminate · recuperabili</option>
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
/** Importo effettivo dell'ultima versione; il dichiarato resta sotto se è diverso. */
export function EffectiveAmount({
  declaredCents,
  head,
}: {
  declaredCents: number;
  head?: FinanceRevisionRecord;
}) {
  if (head?.deleted)
    return (
      <>
        Escluso
        <small>Dichiarato {centsLabel(declaredCents)} · fuori dai saldi</small>
      </>
    );
  const values = head?.values;
  const cents = values?.amountCents ?? declaredCents;
  const expense = values?.direction === "expense";
  return (
    <>
      {centsLabel(expense ? -cents : cents)}
      {(cents !== declaredCents || expense) && (
        <small>
          Dichiarato {centsLabel(declaredCents)} · corretto in Finance
          {expense ? ", come uscita" : ""}
        </small>
      )}
    </>
  );
}
function ManualEntryCard({
  entry,
  userId,
  readOnly,
}: {
  entry: ManualEntry & { deleted: boolean; pending: boolean; revisionVersion: number };
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
          <span className={styles.badge}>
            {entry.deleted ? "Eliminata" : entry.pending ? "Pending" : "Attiva"}
            {entry.revisionVersion > 0
              ? ` · Versione ${entry.revisionVersion}`
              : " · Fonte originale"}
          </span>
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
            <strong>Annullamento della fonte originale il {timestamp(entry.void.createdAt)}</strong>
            <p>{entry.void.reason}</p>
            <p>L’importo originale è conservato; l’annullo non esegue un movimento bancario.</p>
          </div>
        )}
        <FinanceMovementActions
          source="manual"
          sourceId={entry.id}
          readOnly={readOnly}
          deleted={entry.deleted}
        />
      </div>
    </details>
  );
}
