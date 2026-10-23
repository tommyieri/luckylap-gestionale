"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviseMovement } from "../app/finance/movimento/actions";
import {
  parseFinanceRevisionCommand,
  type FinanceRevisionCommand,
  type FinanceRevisionHistory,
  type FinanceRevisionValues,
} from "../lib/finance-revisions/model";
import {
  acknowledgeFinanceRevision,
  preserveFinanceRevision,
  readPendingFinanceRevision,
} from "../lib/finance-revisions/pending";
import { euroCents, money, moneyInput } from "../lib/sales/model";
import { formatRomeDate, formatRomeDateTime } from "../lib/team/model";
import { FINANCE_CATEGORY_GROUPS } from "../lib/finance/categories";
import { PendingAttempt } from "./pending-attempt";
import styles from "./finance-revision-editor.module.css";
export function FinanceRevisionEditor({
  history,
  actorId,
  names,
}: {
  history: FinanceRevisionHistory;
  actorId: string;
  names: Record<string, string>;
}) {
  const router = useRouter();
  const latest = history.revisions.at(-1);
  const current = latest?.values ?? history.original.values;
  const deleted = latest?.deleted ?? history.original.deleted;
  const version = latest?.version ?? 0;
  const [busy, start] = useTransition();
  const [attempt, setAttempt] = useState<FinanceRevisionCommand | null>(null);
  const [broken, setBroken] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const reason = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      setAttempt(readPendingFinanceRevision(sessionStorage, actorId));
    } catch {
      setBroken(true);
      setMessage(
        "Il tentativo conservato non è leggibile. Controlla lo storico prima di liberare il modulo.",
      );
    }
    setReady(true);
  }, [actorId]);
  const otherContext = Boolean(
    attempt &&
    (attempt.payload.source_kind !== history.original.sourceKind ||
      attempt.payload.source_id !== history.original.sourceId),
  );
  function send(command: FinanceRevisionCommand, retry = false) {
    start(async () => {
      let frozen: FinanceRevisionCommand;
      try {
        frozen = preserveFinanceRevision(sessionStorage, actorId, command);
        setAttempt(frozen);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Non riesco a conservare l’invio.");
        return;
      }
      try {
        const result = await reviseMovement(actorId, {
          ...frozen,
          ...(retry ? { retry: true } : {}),
        });
        setMessage(result.message);
        if (result.status === "success") {
          acknowledgeFinanceRevision(sessionStorage, actorId, result.receipt);
          setAttempt(null);
          setBlocked(false);
          setConfirmDelete(false);
          router.refresh();
        } else if (result.status === "rejected") setBlocked(true);
      } catch {
        setMessage(
          "Esito non confermato. Verifica lo stesso invio prima di modificare altri dati.",
        );
      }
    });
  }
  function submit(
    action: "update" | "delete" | "restore",
    form?: FormData,
    restoreVersion?: number,
  ) {
    if (attempt || busy || !ready) return;
    const payload: Record<string, unknown> = {
      schema_version: 1,
      source_kind: history.original.sourceKind,
      source_id: history.original.sourceId,
      expected_version: version,
      action,
      reason: reason.current?.value ?? "",
    };
    if (action === "update" && form) {
      const amount = euroCents(form.get("amount"));
      if (amount === null) {
        setMessage("Inserisci un importo in euro, con al massimo due decimali.");
        return;
      }
      payload.values = {
        date: form.get("date"),
        direction: form.get("direction"),
        amount_cents: amount,
        account: String(form.get("account") ?? "").trim() || null,
        target_account: String(form.get("targetAccount") ?? "").trim() || null,
        category: String(form.get("category") ?? "").trim() || null,
        description: form.get("description"),
        pending: form.get("pending") === "on",
      };
    }
    if (action === "restore") payload.restore_version = restoreVersion;
    const command = parseFinanceRevisionCommand({ operationId: crypto.randomUUID(), payload });
    if (!command) {
      setMessage("Controlla i campi e inserisci una motivazione di almeno tre caratteri.");
      reason.current?.focus();
      return;
    }
    send(command);
  }
  const rows = [
    {
      version: 0,
      values: history.original.values,
      deleted: history.original.deleted,
      actor: "Fonte originale",
      at: null as string | null,
      reason: "Valori acquisiti dalla fonte.",
    },
    ...history.revisions.map((r) => ({
      version: r.version,
      values: r.values,
      deleted: r.deleted,
      actor: names[r.createdBy] ?? "Membro del team",
      at: r.createdAt,
      reason: r.reason,
    })),
  ].reverse();
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <Link href="/finance" prefetch={false}>
            ← Finance
          </Link>
          <h1>Movimento Finance</h1>
          <p>
            {deleted ? "Eliminato dalla vista attiva" : "Versione attiva"} ·{" "}
            {version === 0 ? "fonte originale" : `versione ${version}`}
          </p>
        </div>
      </header>
      {history.original.orderId && (
        <p className={styles.notice}>
          L’importo corretto aggiorna anche il saldo dichiarato dell’ordine.{" "}
          <Link href={`/sales#order-${history.original.orderId}`} prefetch={false}>
            Apri la vendita
          </Link>
        </p>
      )}
      {otherContext && attempt && (
        <p className={styles.notice}>
          L’invio da verificare appartiene a un altro movimento.{" "}
          <Link
            href={`/finance/movimento?source_kind=${attempt.payload.source_kind}&source_id=${attempt.payload.source_id}`}
            prefetch={false}
          >
            Apri il movimento dell’invio conservato
          </Link>{" "}
          per verificarlo.
        </p>
      )}
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
      {(attempt || broken) && (
        <PendingAttempt
          title="Correzione da verificare"
          lines={
            attempt
              ? [
                  `Movimento: ${attempt.payload.source_kind}`,
                  `Azione: ${attempt.payload.action === "delete" ? "Elimina" : attempt.payload.action === "restore" ? "Ripristina" : "Correggi"}`,
                  `Versione letta: ${attempt.payload.expected_version}`,
                  ...(attempt.payload.action === "update"
                    ? [
                        `Data: ${attempt.payload.values.date}`,
                        `Importo: ${money(attempt.payload.values.amount_cents)}`,
                        `Descrizione: ${attempt.payload.values.description}`,
                      ]
                    : []),
                ]
              : ["Tentativo non leggibile"]
          }
          operationId={attempt?.operationId ?? "Non disponibile"}
          pending={busy}
          blocked={blocked || broken || otherContext}
          onRetry={() => attempt && !otherContext && send(attempt, true)}
          onReread={() => router.refresh()}
          onDiscard={
            blocked || broken
              ? () => {
                  sessionStorage.removeItem(`luckylap.finance-revisions.pending:${actorId}`);
                  setAttempt(null);
                  setBroken(false);
                  setBlocked(false);
                  router.refresh();
                }
              : undefined
          }
        />
      )}
      <section aria-labelledby="edit-title" className={styles.section}>
        <h2 id="edit-title">Correggi i dati</h2>
        <form
          key={`${version}:${history.original.sourceId}`}
          action={(form) => submit("update", form)}
        >
          <fieldset
            disabled={!ready || busy || Boolean(attempt) || broken || deleted}
            className={styles.fields}
          >
            <label>
              Data
              <input type="date" name="date" defaultValue={current.date} required />
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
                defaultValue={current.account ?? ""}
                maxLength={240}
                placeholder="Da attribuire"
              />
            </label>
            {history.original.sourceKind === "budgetflow" && (
              <label>
                Conto di destinazione, per trasferimenti
                <input
                  name="targetAccount"
                  defaultValue={current.targetAccount ?? ""}
                  maxLength={240}
                />
              </label>
            )}
            <label>
              Categoria
              <input
                name="category"
                list="finance-categories"
                defaultValue={current.category ?? ""}
                maxLength={240}
              />
              <datalist id="finance-categories">
                {FINANCE_CATEGORY_GROUPS.flatMap((g) => g.categories).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
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
              <input type="checkbox" name="pending" defaultChecked={current.pending} />
              Pending / da confermare
            </label>
          </fieldset>
          <label className={styles.reason}>
            Motivazione della correzione
            <input
              ref={reason}
              name="reason"
              minLength={3}
              maxLength={500}
              required
              disabled={busy || Boolean(attempt) || broken}
              placeholder="Spiega il motivo al team"
            />
          </label>
          <div className={styles.actions}>
            <button
              type="submit"
              className="button button-primary"
              disabled={!ready || busy || Boolean(attempt) || broken || deleted}
            >
              {busy ? "Salvataggio…" : "Salva correzione"}
            </button>
            {!deleted && (
              <button
                type="button"
                className="button button-secondary"
                disabled={!ready || busy || Boolean(attempt) || broken}
                onClick={() => setConfirmDelete(true)}
              >
                Elimina movimento
              </button>
            )}
          </div>
        </form>
        {confirmDelete && (
          <div className={styles.notice} role="group" aria-label="Conferma eliminazione">
            <p>
              Eliminare questo movimento dalla vista attiva? Potrai ripristinarlo dallo storico.
              Indica prima la motivazione.
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className="button button-primary"
                disabled={busy || Boolean(attempt)}
                onClick={() => submit("delete")}
              >
                Conferma eliminazione
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setConfirmDelete(false)}
              >
                Annulla
              </button>
            </div>
          </div>
        )}
      </section>
      <section aria-labelledby="history-title" className={styles.section}>
        <h2 id="history-title">Storico delle versioni</h2>
        <p>Ogni ripristino crea una nuova versione e conserva le precedenti.</p>
        <ol className={styles.history}>
          {rows.map((row) => (
            <li key={row.version}>
              <div className={styles.versionHead}>
                <h3>
                  {row.version === 0 ? "Fonte originale" : `Versione ${row.version}`}
                  {row.version === version ? " · attuale" : ""}
                  {row.deleted ? " · eliminata" : ""}
                </h3>
                {(row.version !== version || deleted) && (
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={!ready || busy || Boolean(attempt) || broken}
                    onClick={() => submit("restore", undefined, row.version)}
                  >
                    Ripristina {row.version === 0 ? "fonte originale" : `versione ${row.version}`}
                  </button>
                )}
              </div>
              <p>
                {row.actor}
                {row.at && ` · ${formatRomeDateTime(row.at)}`}
              </p>
              <VersionSummary values={row.values} />
              <p>{row.reason}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
function VersionSummary({ values }: { values: FinanceRevisionValues }) {
  return (
    <p>
      {formatRomeDate(`${values.date}T12:00Z`)} · {money(values.amountCents)} ·{" "}
      {values.direction === "income" ? "Entrata" : "Uscita"} ·{" "}
      {values.account ?? "Conto da attribuire"}
      {values.targetAccount && ` → ${values.targetAccount}`}
      {values.category && ` · ${values.category}`}
      {values.pending && " · Pending"}
      <br />
      {values.description}
    </p>
  );
}
