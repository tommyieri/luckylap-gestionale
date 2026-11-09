"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { reviseShopPayment } from "../app/finance/incasso/actions";
import {
  buildShopPaymentFinanceCommand,
  type ShopPaymentFinanceHistory,
} from "../lib/finance-revisions/shop-payment-model";
import {
  paymentMethodLabel,
  shopPendingKey,
  type ShopCommand,
} from "../lib/consignment/shop-model";
import { createShopSender, readStoredAttempt, type StoredAttempt } from "./consignment-pending";
import { euroCents, money, moneyInput } from "../lib/sales/model";
import { localReportDate } from "../lib/finance/model";
import { formatRomeDate, formatRomeDateTime } from "../lib/team/model";
import { PendingAttempt } from "./pending-attempt";
import { FinanceVersionChanges } from "./finance-revision-editor";
import type { FinanceRevisionValues } from "../lib/finance-revisions/model";
import styles from "./finance-revision-editor.module.css";

export function FinanceShopPaymentEditor({
  history,
  actorId,
  names,
  embedded = false,
  readOnly = false,
  onDirtyChange,
  onSaved,
}: {
  history: ShopPaymentFinanceHistory;
  actorId: string;
  names: Record<string, string>;
  embedded?: boolean;
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
}) {
  const router = useRouter(),
    current = history.current;
  const [attempt, setAttempt] = useState<StoredAttempt | null>(null),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, start] = useTransition();
  const [dirty, setDirty] = useState(false);
  const reason = useRef<HTMLInputElement>(null);
  useEffect(() => {
    onDirtyChange?.(dirty || busy || Boolean(attempt));
  }, [dirty, busy, attempt, onDirtyChange]);
  useEffect(() => {
    setDirty(false);
  }, [actorId, history.paymentId, history.version]);
  function markDirty() {
    setDirty(true);
    onDirtyChange?.(true);
  }
  const sender = useRef(
    createShopSender(
      shopPendingKey(actorId),
      () => sessionStorage,
      (command) => reviseShopPayment(actorId, command),
    ),
  );
  useEffect(() => {
    setAttempt(readStoredAttempt(sessionStorage, actorId));
    setReady(true);
  }, [actorId]);
  const command = attempt?.kind === "shop" ? attempt.command : null;
  const otherContext =
    !!attempt &&
    (attempt.kind !== "shop" ||
      command?.kind !== "update_consignment_payment" ||
      command.payload.payment_id !== history.paymentId);
  const locked = readOnly || !ready || busy || !!attempt;
  function send(value: ShopCommand, retry = false) {
    if (readOnly || sender.current.isBusy()) return;
    onDirtyChange?.(true);
    const existing = readStoredAttempt(sessionStorage, actorId);
    if (
      existing &&
      (existing.kind !== "shop" ||
        existing.command.operationId !== value.operationId ||
        JSON.stringify(existing.command.payload) !== JSON.stringify(value.payload))
    ) {
      setAttempt(existing);
      setMessage("Verifica il tentativo già conservato prima di correggere questo pagamento.");
      return;
    }
    start(async () => {
      const outcome = await sender.current.send({ ...value, ...(retry ? { retry: true } : {}) });
      if (!outcome) return;
      setMessage(outcome.result.message);
      if (outcome.kept)
        setAttempt({
          kind: "shop",
          command: value,
          blocked:
            outcome.result.status === "rejected" && outcome.result.code === "idempotency_conflict",
        });
      else setAttempt(null);
      if (outcome.result.status === "success") {
        setConfirmDelete(false);
        setDirty(false);
        onDirtyChange?.(outcome.kept);
        onSaved?.();
        router.refresh();
      }
    });
  }
  function submit(
    action: "update" | "delete" | "restore",
    form?: FormData,
    restoreVersion?: number,
  ) {
    if (locked || sender.current.isBusy()) return;
    const amount = form ? euroCents(form.get("amount")) : null;
    if (action === "update" && amount === null) {
      setMessage("Inserisci un importo positivo con al massimo due decimali.");
      return;
    }
    const next = buildShopPaymentFinanceCommand({
      history,
      action,
      operationId: crypto.randomUUID(),
      reason: reason.current?.value ?? "",
      restoreVersion,
      ...(action === "update" && form && amount !== null
        ? {
            values: {
              date: String(form.get("date") ?? ""),
              direction:
                form.get("direction") === "expense" ? ("expense" as const) : ("income" as const),
              amountCents: amount,
              account: String(form.get("account") ?? "").trim() || null,
              category: String(form.get("category") ?? "").trim() || null,
              description: String(form.get("description") ?? ""),
              pending: form.get("pending") === "on",
            },
          }
        : {}),
    });
    if (!next) {
      setMessage("Controlla data, importo, conto e motivazione di almeno tre caratteri.");
      reason.current?.focus();
      return;
    }
    send(next);
  }
  const versions = [
    ...new Map([...history.revisions, current].map((row) => [row.version, row])).values(),
  ].sort((a, b) => b.version - a.version);
  const byVersion = new Map(versions.map((row) => [row.version, row]));
  return (
    <div className={embedded ? styles.embedded : styles.page}>
      <header className={styles.head}>
        {!embedded && (
          <>
            <Link href="/finance" prefetch={false}>
              Finance
            </Link>
            <h1>Incasso conto vendita</h1>
          </>
        )}
        <p>
          {current.voided ? "Eliminato dalla vista attiva" : "Versione attiva"} · versione{" "}
          {history.version}
        </p>
      </header>
      <section className={styles.summary} aria-label="Riepilogo corrente">
        <h2>Riepilogo corrente</h2>
        <p>
          {formatRomeDate(current.paidAt)} · {money(current.amountCents)} ·{" "}
          {current.direction === "expense" ? "Uscita" : "Entrata"} ·{" "}
          {current.accountLabel ?? "Conto da attribuire"}
        </p>
        <p>{current.description}</p>
      </section>
      {readOnly && (
        <p className={styles.notice}>
          Sola lettura: le modifiche richiedono il workspace condiviso.
        </p>
      )}
      <p className={styles.notice}>
        Questo è lo stesso pagamento del resoconto. La correzione conserva importo, versione e
        storico in un solo registro.
      </p>
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
      {otherContext && (
        <p className={styles.notice}>
          Un invio del conto vendita attende verifica.{" "}
          <Link href="/consignment" prefetch={false}>
            Apri il conto vendita per verificarlo
          </Link>{" "}
          prima di continuare.
        </p>
      )}
      {attempt && !otherContext && (
        <PendingAttempt
          title="Correzione del pagamento da verificare"
          lines={
            command?.kind === "update_consignment_payment"
              ? [
                  `Importo: ${money(command.payload.amount_cents)}`,
                  command.payload.voided ? "Elimina dalla vista attiva" : "Aggiorna il pagamento",
                  `Versione letta: ${command.payload.expected_version}`,
                ]
              : ["Tentativo non leggibile"]
          }
          operationId={command?.operationId ?? "Non disponibile"}
          pending={busy}
          blocked={attempt.blocked}
          onRetry={() => {
            if (command) send(command, true);
          }}
          onReread={() => router.refresh()}
          onDiscard={
            !readOnly && attempt.blocked
              ? () => {
                  try {
                    sessionStorage.removeItem(shopPendingKey(actorId));
                    setAttempt(null);
                    router.refresh();
                  } catch {
                    setMessage(
                      "Il browser non consente di liberare il tentativo. Riprova senza cambiare account.",
                    );
                  }
                }
              : undefined
          }
        />
      )}
      <section className={styles.section} aria-labelledby="shop-payment-edit">
        <h2 id="shop-payment-edit">Correggi il pagamento</h2>
        <form
          key={`${history.paymentId}:${history.version}`}
          onChange={markDirty}
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            submit("update", new FormData(event.currentTarget));
          }}
        >
          <fieldset className={styles.fields} disabled={locked || current.voided}>
            <label>
              Data
              <input
                type="date"
                name="date"
                defaultValue={localReportDate(new Date(current.paidAt)) ?? ""}
                required
              />
            </label>
            <label>
              Tipo
              <select name="direction" defaultValue={current.direction}>
                <option value="income">Entrata</option>
                <option value="expense">Uscita</option>
              </select>
            </label>
            <label>
              Importo in euro
              <input
                name="amount"
                inputMode="decimal"
                defaultValue={moneyInput(current.amountCents)}
                required
              />
            </label>
            <label>
              Conto
              <input
                name="account"
                defaultValue={current.accountLabel ?? ""}
                maxLength={120}
                placeholder="Da attribuire"
              />
            </label>
            <label>
              Categoria
              <input name="category" defaultValue={current.category ?? ""} maxLength={240} />
            </label>
            <label className={styles.wide}>
              Descrizione
              <textarea
                name="description"
                defaultValue={current.description}
                maxLength={2000}
                rows={3}
              />
            </label>
            <label className={styles.check}>
              <input name="pending" type="checkbox" defaultChecked={current.pending} />
              Pending / da confermare
            </label>
          </fieldset>
          <p className={styles.notice}>
            Metodo: {paymentMethodLabel[current.method]} · Riferimento:{" "}
            {current.reference || "Non indicato"}
          </p>
          <label className={styles.reason}>
            Motivazione
            <input
              ref={reason}
              name="reason"
              required
              minLength={3}
              maxLength={500}
              disabled={locked}
              placeholder="Spiega il motivo al team"
            />
          </label>
          <div className={styles.actions}>
            <button
              type="submit"
              className="button button-primary"
              disabled={locked || current.voided}
            >
              Salva correzione
            </button>
            {!current.voided && (
              <button
                type="button"
                className="button button-secondary"
                disabled={locked}
                onClick={() => setConfirmDelete(true)}
              >
                Elimina pagamento
              </button>
            )}
          </div>
        </form>
        {confirmDelete && (
          <div className={styles.notice} role="group" aria-label="Conferma eliminazione">
            <p>
              Eliminare il pagamento dalla vista attiva? Potrai recuperarlo dallo storico. Indica
              prima la motivazione.
            </p>
            <div className={styles.actions}>
              <button
                className="button button-primary"
                disabled={locked}
                onClick={() => submit("delete")}
              >
                Conferma eliminazione
              </button>
              <button className="button button-secondary" onClick={() => setConfirmDelete(false)}>
                Annulla
              </button>
            </div>
          </div>
        )}
      </section>
      <details className={`${styles.section} ${styles.historyDisclosure}`}>
        <summary>Storico del pagamento</summary>
        <p>
          Ripristinare una versione crea una nuova versione nello stesso registro del resoconto.
        </p>
        <ol className={styles.history}>
          {versions.map((row) => {
            const previous = byVersion.get(row.version - 1);
            return (
              <li key={row.version}>
                <div className={styles.versionHead}>
                  <h3>
                    Versione {row.version}
                    {row.version === history.version ? " · attuale" : ""}
                    {row.voided ? " · eliminata" : ""}
                  </h3>
                  {(row.version !== history.version || current.voided) && (
                    <button
                      className="button button-secondary"
                      disabled={locked}
                      onClick={() => submit("restore", undefined, row.version)}
                    >
                      Ripristina versione {row.version}
                    </button>
                  )}
                </div>
                <p>
                  {names[row.createdBy] ?? "Membro del team"} · {formatRomeDateTime(row.createdAt)}
                </p>
                <FinanceVersionChanges
                  before={previous ? financeValues(previous) : null}
                  after={financeValues(row)}
                  wasDeleted={previous?.voided ?? false}
                  deleted={row.voided}
                />
                {previous && (
                  <ul className={styles.changes}>
                    {previous.method !== row.method && (
                      <li>
                        <strong>Metodo:</strong> {paymentMethodLabel[previous.method]} →{" "}
                        {paymentMethodLabel[row.method]}
                      </li>
                    )}
                    {previous.reference !== row.reference && (
                      <li>
                        <strong>Riferimento:</strong> {previous.reference || "Non indicato"} →{" "}
                        {row.reference || "Non indicato"}
                      </li>
                    )}
                    {previous.paidAt !== row.paidAt &&
                      financeValues(previous).date === financeValues(row).date && (
                        <li>
                          <strong>Data e ora:</strong> {formatRomeDateTime(previous.paidAt)} →{" "}
                          {formatRomeDateTime(row.paidAt)}
                        </li>
                      )}
                  </ul>
                )}
                {row.reason && <p>{row.reason}</p>}
                <details className={styles.fullVersion}>
                  <summary>Versione completa</summary>
                  <p>
                    {formatRomeDate(row.paidAt)} · {money(row.amountCents)} ·{" "}
                    {row.direction === "expense" ? "Uscita" : "Entrata"} ·{" "}
                    {row.accountLabel ?? "Conto da attribuire"}
                    {row.category && ` · ${row.category}`}
                    {row.pending && " · Pending"}
                  </p>
                  <p>{row.description}</p>
                  <p>
                    Metodo: {paymentMethodLabel[row.method]} · Riferimento:{" "}
                    {row.reference || "Non indicato"}
                  </p>
                </details>
              </li>
            );
          })}
        </ol>
      </details>
    </div>
  );
}

function financeValues(row: ShopPaymentFinanceHistory["current"]): FinanceRevisionValues {
  return {
    date: localReportDate(new Date(row.paidAt)) ?? "",
    direction: row.direction,
    amountCents: row.amountCents,
    account: row.accountLabel,
    targetAccount: null,
    category: row.category,
    description: row.description,
    pending: row.pending,
  };
}
