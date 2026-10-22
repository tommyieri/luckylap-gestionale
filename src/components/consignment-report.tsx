"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ChevronRight } from "lucide-react";
import { consignmentAmount, consignmentMoney as money } from "../lib/consignment/model";
import { romeInputToIso, romeTimeInput } from "../lib/sales/model";
import {
  PAYMENT_METHODS,
  bpsLabel,
  momentLabel,
  monthLabel,
  optionalField,
  paymentMethodLabel,
  parseShopCommand,
  piecesLabel,
  quantityField,
  romeToday,
  type PaymentMethod,
} from "../lib/consignment/shop-model";
import {
  beforeCountColumn,
  reportDraft,
  reportFormRows,
  reportMonthAllowed,
  reportOverview,
  type ReportEntry,
  type ShopPage,
  type ShopPayment,
  type ShopReport,
} from "../lib/consignment/shop-read";
import {
  consignmentCountHref,
  consignmentOrderHref,
  shopPaymentFinanceHref,
} from "../lib/consignment/links";
import { FormMessage, useShopCommands, type FormNotice } from "./consignment-pending";
import roadbook from "./roadbook.module.css";
import styles from "./consignment-shop.module.css";

/** Riferimento stabile: un modulo che si apre viene portato in vista una volta sola. */
const revealOnMount = (element: HTMLElement | null) =>
  element?.scrollIntoView?.({ block: "nearest" });

/*
 * Resoconto del mese (docs/consignment.md, «Resoconto mensile»). Senza
 * resoconto: modulo con i totali dal vivo e la barra ferma in basso. Registrato:
 * riepilogo con i quattro numeri, righe a prezzo bloccato, fattura, pagamenti
 * (solo con Finance aperta) e versioni. «Modifica» riapre il modulo con il motivo.
 */

/** 8499 → «84,99», per i campi in euro. */
export const centsInput = (cents: number) =>
  `${Math.trunc(cents / 100)},${String(cents % 100).padStart(2, "0")}`;

type FieldEntry = { quantity: string; before: string };
export type ParsedReport =
  | { status: "ok"; entries: Record<string, ReportEntry> }
  | { status: "invalid"; invalid: Set<string> };
/** Campi del modulo → righe: vuoto vale 0, «prima della conta» non supera i venduti. */
export function reportEntries(fields: Record<string, FieldEntry>): ParsedReport {
  const entries: Record<string, ReportEntry> = {};
  const invalid = new Set<string>();
  for (const [itemId, field] of Object.entries(fields)) {
    const quantity = quantityField(field.quantity, 0),
      beforeCount = quantityField(field.before, 0);
    if (quantity === null || beforeCount === null || beforeCount > quantity) invalid.add(itemId);
    else entries[itemId] = { quantity, beforeCount };
  }
  return invalid.size ? { status: "invalid", invalid } : { status: "ok", entries };
}

export function ReportForm({
  page,
  month,
  report,
  now,
  onCancel,
  onSaved,
}: {
  page: ShopPage;
  month: string;
  report: ShopReport | null;
  now: string;
  onCancel?: () => void;
  onSaved: () => void;
}) {
  const commands = useShopCommands();
  const [fields, setFields] = useState<Record<string, FieldEntry>>(() =>
    Object.fromEntries(
      (report?.lines ?? []).map((l) => [
        l.itemId,
        {
          quantity: String(l.quantity),
          before: l.beforeCountQuantity ? String(l.beforeCountQuantity) : "",
        },
      ]),
    ),
  );
  const [showAll, setShowAll] = useState(false);
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);
  const [message, setMessage] = useState<FormNotice | null>(null);
  const rows = reportFormRows(page, month, showAll);
  const beforeColumn = beforeCountColumn(page, month);
  const parsed = reportEntries(fields);
  const draft = parsed.status === "ok" ? reportDraft(page, month, parsed.entries) : null;
  const totals = draft?.status === "ok" ? draft.totals : null;
  const shareBps = report ? report.brandShareBps : page.shop.brandShareBps;
  const allowed =
    page.shop.active &&
    page.settings.stockEnabled &&
    page.settings.salesEnabled &&
    reportMonthAllowed(page.settings, month, now);
  const set = (itemId: string, patch: Partial<FieldEntry>) => {
    setFields((f) => ({
      ...f,
      [itemId]: { ...(f[itemId] ?? { quantity: "", before: "" }), ...patch },
    }));
    setHighlight(null);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (parsed.status === "invalid") {
      setInvalid(parsed.invalid);
      setMessage({
        tone: "error",
        text: "Controlla le righe evidenziate: numeri interi, e «prima della conta» non più dei venduti.",
      });
      return;
    }
    setInvalid(new Set());
    if (!draft || draft.status !== "ok") {
      setHighlight(draft && "itemId" in draft ? (draft.itemId ?? null) : null);
      setMessage({
        tone: "error",
        text:
          draft?.status === "missing_price"
            ? "Per una maglietta manca il prezzo del sito: collega lo SKU al catalogo Shopify."
            : "Gli importi superano il limite ammesso. Controlla le quantità.",
      });
      return;
    }
    if (report && optionalField(reason) === null) {
      setMessage({
        tone: "error",
        text: "Scrivi perché correggi il resoconto (da 3 a 500 caratteri).",
      });
      return;
    }
    const command = parseShopCommand({
      operationId: crypto.randomUUID(),
      kind: "save_consignment_report",
      payload: {
        schema_version: 1,
        location_id: page.shop.locationId,
        period_month: month,
        expected_revision: report?.revision ?? null,
        reason: report ? reason : null,
        lines: draft.lines,
      },
    });
    if (!command) {
      setMessage({
        tone: "error",
        text: report
          ? "Il motivo deve avere da 3 a 500 caratteri, senza caratteri speciali."
          : "Controlla i dati inseriti.",
      });
      return;
    }
    setMessage(null);
    const result = await commands.send(command);
    if (!result) return;
    if (result.status === "success") {
      commands.announce(result.message);
      onSaved();
      return;
    }
    setMessage({ tone: "error", text: result.message });
    if (result.status === "rejected") setHighlight(result.itemId ?? null);
  }

  const pieces = totals?.pieces ?? 0;
  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {report ? (
        <p className={styles.sectionNote}>
          Correggi i pezzi venduti. I prezzi delle righe già registrate restano quelli della prima
          volta. La giacenza del negozio cambia solo della differenza.
        </p>
      ) : (
        <p className={styles.sectionNote}>
          Scrivi quante magliette ha venduto il negozio a {monthLabel(month)}, come nel messaggio
          del negozio. Al salvataggio la giacenza del negozio scende (la nostra no) e Finance vede
          subito l’importo da fatturare.
        </p>
      )}
      {beforeColumn && (
        <p className={styles.sectionNote}>
          «Prima della conta»: pezzi venduti prima della conta di questo mese. Vanno in fattura ma
          non scendono dalla giacenza, perché la conta li esclude già.
        </p>
      )}
      {!allowed && (
        <p className={styles.error} role="alert">
          {!page.shop.active
            ? "Il negozio è chiuso: riaprilo dalle impostazioni."
            : !page.settings.stockEnabled
              ? "Le modifiche al magazzino sono sospese."
              : !page.settings.salesEnabled
                ? "Le vendite non sono ancora attive nel gestionale."
                : "Questo mese non si può registrare: scegli un mese dall’avvio delle vendite a oggi."}
        </p>
      )}
      <div
        className={`${styles.lines} ${beforeColumn ? styles.linesBefore : ""}`}
        role="table"
        aria-label={`Vendite di ${monthLabel(month)}`}
      >
        <div className={`${styles.line} ${styles.lineHead}`} role="row">
          <span role="columnheader">Maglietta</span>
          <span role="columnheader">In negozio</span>
          <span role="columnheader">Venduti</span>
          {beforeColumn && <span role="columnheader">Prima della conta</span>}
          <span role="columnheader">Prezzo negozio</span>
        </div>
        {rows.length === 0 && (
          <p className={styles.empty}>
            Nessuna maglietta in negozio. Usa «Mostra tutte le varianti» se il negozio ne ha vendute
            altre.
          </p>
        )}
        {rows.map((row) => {
          const field = fields[row.item.id] ?? { quantity: "", before: "" };
          const q = quantityField(field.quantity, 0) ?? 0,
            b = quantityField(field.before, 0) ?? 0,
            previous = row.line ? row.line.quantity - row.line.beforeCountQuantity : 0,
            tooMany = q - b - previous > (row.inShop ?? 0);
          const marked =
            invalid.has(row.item.id) || highlight === row.item.id ? styles.lineMarked : "";
          return (
            <div
              key={row.item.id}
              role="row"
              className={`${styles.line} ${row.disabled ? styles.lineDisabled : ""} ${marked}`}
            >
              <span role="cell" className={styles.lineName}>
                {row.item.label}
                {row.disabled && (
                  <span className={styles.lineWarn}>
                    Prezzo del sito mancante: collega lo SKU al catalogo Shopify.
                  </span>
                )}
                {!row.disabled && tooMany && (
                  <span className={styles.lineWarn}>Più di quelle in negozio.</span>
                )}
              </span>
              <span role="cell" className={styles.lineStock}>
                <span className={styles.lineLabel} aria-hidden>
                  In negozio
                </span>
                <span className="num">{row.inShop ?? "—"}</span>
              </span>
              <span role="cell" className={`${styles.lineInput} ${styles.lineSold}`}>
                <span className={styles.lineLabel} aria-hidden>
                  Venduti
                </span>
                <input
                  className={styles.cellInput}
                  type="text"
                  size={4}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoComplete="off"
                  disabled={row.disabled || !allowed}
                  value={field.quantity}
                  aria-invalid={invalid.has(row.item.id) || undefined}
                  aria-label={`${row.item.label}, venduti`}
                  onChange={(e) => set(row.item.id, { quantity: e.target.value })}
                />
              </span>
              {beforeColumn && (
                <span role="cell" className={`${styles.lineInput} ${styles.lineBefore}`}>
                  <span className={styles.lineLabel} aria-hidden>
                    Prima della conta
                  </span>
                  <input
                    className={styles.cellInput}
                    type="text"
                    size={4}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoComplete="off"
                    disabled={row.disabled || !allowed}
                    value={field.before}
                    aria-invalid={invalid.has(row.item.id) || undefined}
                    aria-label={`${row.item.label}, venduti prima della conta`}
                    onChange={(e) => set(row.item.id, { before: e.target.value })}
                  />
                </span>
              )}
              <span role="cell" className={styles.linePrice}>
                <span className={styles.lineLabel} aria-hidden>
                  Prezzo negozio
                </span>
                <span className="num">{row.price ? money(row.price.unitShopPriceCents) : "—"}</span>
              </span>
            </div>
          );
        })}
      </div>
      <label className={styles.toggle}>
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        <span>Mostra tutte le varianti</span>
      </label>
      {report && (
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>Perché lo correggi?</span>
          <textarea
            rows={2}
            maxLength={500}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
      <div className={styles.actionBar}>
        {message && (
          <div className={styles.barMessage}>
            <FormMessage message={message} />
          </div>
        )}
        <p className={styles.barSummary}>
          {totals ? (
            <>
              <span className="num">{piecesLabel(totals.pieces)}</span> · Incasso negozio{" "}
              <span className="num">{money(totals.grossCents)}</span> · Da fatturare{" "}
              <span className="num">{money(totals.brandCents)}</span>
              <span className={styles.barNote}> · LuckyLap {bpsLabel(shareBps)}</span>
            </>
          ) : (
            "Controlla le righe evidenziate"
          )}
        </p>
        <div className={styles.barActions}>
          {onCancel && (
            <button
              type="button"
              className="button button-secondary"
              disabled={commands.sending}
              onClick={onCancel}
            >
              Annulla
            </button>
          )}
          <button
            type="submit"
            className="button button-primary"
            disabled={!allowed || commands.locked}
          >
            {commands.sending
              ? "Salvataggio…"
              : report
                ? "Salva la correzione"
                : pieces === 0
                  ? "Salva: nessuna vendita"
                  : "Salva resoconto"}
          </button>
        </div>
      </div>
    </form>
  );
}

function InvoiceForm({ report, now }: { report: ShopReport; now: string }) {
  const commands = useShopCommands();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState(report.invoice?.number ?? "");
  const [date, setDate] = useState(report.invoice?.date ?? romeToday(now));
  const [message, setMessage] = useState<FormNotice | null>(null);
  async function save(remove: boolean) {
    const command = parseShopCommand({
      operationId: crypto.randomUUID(),
      kind: "set_consignment_invoice",
      payload: {
        schema_version: 1,
        report_id: report.id,
        expected_revision: report.revision,
        invoice_number: remove ? null : number,
        invoice_date: remove ? null : date,
      },
    });
    if (!command) {
      setMessage({
        tone: "error",
        text: "Scrivi il numero della fattura (fino a 60 caratteri) e una data valida.",
      });
      return;
    }
    const result = await commands.send(command);
    if (!result) return;
    setMessage({ tone: result.status === "success" ? "success" : "error", text: result.message });
    if (result.status === "success") setOpen(false);
  }
  if (!open)
    return (
      <div className={styles.actions}>
        <button
          type="button"
          className={`button ${report.invoice ? "button-secondary" : "button-primary"}`}
          disabled={!commands.canOpen}
          onClick={() => {
            setOpen(true);
            setMessage(null);
          }}
        >
          {report.invoice ? "Correggi la fattura" : "Segna fattura emessa"}
        </button>
        <FormMessage message={message} />
      </div>
    );
  return (
    <form
      ref={revealOnMount}
      className={styles.subform}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Numero della fattura</span>
          <input
            value={number}
            maxLength={60}
            autoComplete="off"
            onChange={(e) => setNumber(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Data della fattura</span>
          <input
            type="date"
            value={date}
            min={`${report.month}-01`}
            max={romeToday(now)}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>
      <div className={styles.actions}>
        <button type="submit" className="button button-primary" disabled={commands.locked}>
          {commands.sending ? "Salvataggio…" : "Salva la fattura"}
        </button>
        {report.invoice && (
          <button
            type="button"
            className="button button-secondary"
            disabled={commands.locked}
            onClick={() => void save(true)}
          >
            Togli la fattura
          </button>
        )}
        <button type="button" className="button button-secondary" onClick={() => setOpen(false)}>
          Annulla
        </button>
      </div>
      <FormMessage message={message} />
    </form>
  );
}

type PaymentFields = {
  amount: string;
  paidAt: string;
  method: PaymentMethod | "";
  account: string;
  reference: string;
};
function PaymentFieldset({
  fields,
  onChange,
}: {
  fields: PaymentFields;
  onChange: (patch: Partial<PaymentFields>) => void;
}) {
  return (
    <div className={styles.fields}>
      <label className={styles.field}>
        <span>Importo ricevuto (€)</span>
        <input
          inputMode="decimal"
          autoComplete="off"
          maxLength={17}
          value={fields.amount}
          onChange={(e) => onChange({ amount: e.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span>Data e ora · ora di Roma</span>
        <input
          type="datetime-local"
          value={fields.paidAt}
          onChange={(e) => onChange({ paidAt: e.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span>Metodo</span>
        <select
          value={fields.method}
          onChange={(e) => onChange({ method: e.target.value as PaymentMethod })}
        >
          <option value="" disabled>
            Scegli il metodo
          </option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {paymentMethodLabel[m]}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>Conto (facoltativo)</span>
        <input
          autoComplete="off"
          maxLength={120}
          value={fields.account}
          onChange={(e) => onChange({ account: e.target.value })}
        />
      </label>
      <label className={`${styles.field} ${styles.fieldWide}`}>
        <span>Riferimento (facoltativo)</span>
        <input
          autoComplete="off"
          maxLength={240}
          value={fields.reference}
          onChange={(e) => onChange({ reference: e.target.value })}
        />
      </label>
    </div>
  );
}
const paymentPayload = (fields: PaymentFields) => ({
  amount_cents: consignmentAmount(fields.amount),
  paid_at: romeInputToIso(fields.paidAt),
  method: fields.method,
  account_label: optionalField(fields.account),
  reference: optionalField(fields.reference),
});
const PAYMENT_INVALID =
  "Controlla importo (al massimo due decimali), data, metodo e testi del pagamento.";

function PaymentForm({
  report,
  remaining,
  now,
}: {
  report: ShopReport;
  remaining: number;
  now: string;
}) {
  const commands = useShopCommands();
  const blank = (): PaymentFields => ({
    amount: centsInput(remaining),
    paidAt: romeTimeInput(now).slice(0, 16),
    method: "",
    account: "",
    reference: "",
  });
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<PaymentFields>(blank);
  const [message, setMessage] = useState<FormNotice | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const command = parseShopCommand({
      operationId: crypto.randomUUID(),
      kind: "record_consignment_payment",
      payload: { schema_version: 1, report_id: report.id, ...paymentPayload(fields) },
    });
    if (!command) return setMessage({ tone: "error", text: PAYMENT_INVALID });
    const result = await commands.send(command);
    if (!result) return;
    if (result.status === "success") {
      commands.announce(result.message);
      setMessage(null);
      setOpen(false);
      setFields(blank());
    } else setMessage({ tone: "error", text: result.message });
  }
  if (!open)
    return (
      <div className={styles.actions}>
        <button
          type="button"
          className="button button-primary"
          disabled={!commands.canOpen}
          onClick={() => {
            setFields(blank());
            setOpen(true);
            setMessage(null);
          }}
        >
          Registra pagamento
        </button>
        <FormMessage message={message} />
      </div>
    );
  return (
    <form ref={revealOnMount} className={styles.subform} onSubmit={submit} noValidate>
      <PaymentFieldset fields={fields} onChange={(p) => setFields((f) => ({ ...f, ...p }))} />
      <div className={styles.actions}>
        <button type="submit" className="button button-primary" disabled={commands.locked}>
          {commands.sending ? "Salvataggio…" : "Registra pagamento"}
        </button>
        <button type="button" className="button button-secondary" onClick={() => setOpen(false)}>
          Annulla
        </button>
      </div>
      <FormMessage message={message} />
    </form>
  );
}

function PaymentRow({ payment }: { payment: ShopPayment }) {
  const commands = useShopCommands();
  const current = (): PaymentFields => ({
    amount: centsInput(payment.amountCents),
    paidAt: romeTimeInput(payment.paidAt).slice(0, 16),
    method: payment.method,
    account: payment.accountLabel ?? "",
    reference: payment.reference ?? "",
  });
  const [mode, setMode] = useState<"view" | "edit" | "void">("view");
  const [fields, setFields] = useState<PaymentFields>(current);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<FormNotice | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const command = parseShopCommand({
      operationId: crypto.randomUUID(),
      kind: "update_consignment_payment",
      payload: {
        schema_version: 1,
        payment_id: payment.id,
        expected_version: payment.version,
        ...paymentPayload(mode === "void" ? current() : fields),
        voided: mode === "void",
        reason,
      },
    });
    if (!command)
      return setMessage({
        tone: "error",
        text:
          optionalField(reason) === null
            ? "Scrivi il motivo (da 3 a 500 caratteri)."
            : PAYMENT_INVALID,
      });
    const result = await commands.send(command);
    if (!result) return;
    setMessage({ tone: result.status === "success" ? "success" : "error", text: result.message });
    if (result.status === "success") {
      setMode("view");
      setReason("");
    }
  }
  return (
    <li className={`${styles.payment} ${payment.voided ? styles.paymentVoided : ""}`}>
      <div className={styles.paymentHead}>
        <span className={styles.paymentAmount}>{money(payment.amountCents)}</span>
        <span className={styles.paymentMeta}>
          <span className="num">{momentLabel(payment.paidAt)}</span> ·{" "}
          {paymentMethodLabel[payment.method]}
          {payment.accountLabel && <> · {payment.accountLabel}</>}
          {payment.reference && <> · {payment.reference}</>}
          {payment.voided && <> · Annullato</>}
        </span>
      </div>
      {!payment.voided && mode === "view" && (
        <div className={styles.actions}>
          <button
            type="button"
            className="button button-secondary"
            disabled={!commands.canOpen}
            onClick={() => {
              setFields(current());
              setMode("edit");
              setMessage(null);
            }}
          >
            Modifica
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={!commands.canOpen}
            onClick={() => {
              setMode("void");
              setMessage(null);
            }}
          >
            Annulla il pagamento
          </button>
          <Link
            href={shopPaymentFinanceHref(payment.id)}
            prefetch={false}
            className={styles.inlineLink}
          >
            Vedi in Finance
          </Link>
        </div>
      )}
      {mode !== "view" && (
        <form ref={revealOnMount} className={styles.subform} onSubmit={submit} noValidate>
          {mode === "edit" && (
            <PaymentFieldset fields={fields} onChange={(p) => setFields((f) => ({ ...f, ...p }))} />
          )}
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>{mode === "void" ? "Perché lo annulli?" : "Perché lo modifichi?"}</span>
            <textarea
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <button type="submit" className="button button-primary" disabled={commands.locked}>
              {commands.sending
                ? "Salvataggio…"
                : mode === "void"
                  ? "Annulla il pagamento"
                  : "Salva la modifica"}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setMode("view")}
            >
              Torna indietro
            </button>
          </div>
        </form>
      )}
      <FormMessage message={message} />
      {payment.revisions.length > 1 && (
        <details className={styles.foldSmall}>
          <summary>
            <ChevronRight size={16} strokeWidth={2} className={styles.foldIcon} aria-hidden />
            Storico del pagamento
          </summary>
          <ol className={styles.versions}>
            {[...payment.revisions].reverse().map((r) => (
              <li key={r.id}>
                Versione {r.version} · {r.author} ·{" "}
                <span className="num">{momentLabel(r.createdAt)}</span> · {money(r.amountCents)}
                {r.voided ? " · annullato" : ""}
                {r.reason ? ` · ${r.reason}` : " · prima registrazione"}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

function ReportSummary({
  page,
  report,
  canFinance,
  now,
  onEdit,
}: {
  page: ShopPage;
  report: ShopReport;
  canFinance: boolean;
  now: string;
  onEdit: () => void;
}) {
  const commands = useShopCommands();
  const overview = reportOverview(page, report);
  const editable =
    page.shop.active &&
    page.settings.stockEnabled &&
    page.settings.salesEnabled &&
    reportMonthAllowed(page.settings, report.month, now);
  const showBefore = report.lines.some((l) => l.beforeCountQuantity > 0);
  const done = report.paymentState === "paid" || report.paymentState === "nothing_due";
  return (
    <div className={styles.summary}>
      <div className={styles.figures}>
        <div className={styles.figure}>
          <span className="label">Pezzi venduti</span>
          <span className={styles.figureValue}>{overview.pieces}</span>
        </div>
        <div className={styles.figure}>
          <span className="label">Incasso del negozio</span>
          <span className={styles.figureValue}>{money(overview.grossCents)}</span>
        </div>
        <div className={styles.figure}>
          <span className="label">{overview.shopShareLabel}</span>
          <span className={styles.figureValue}>{money(overview.shopCents)}</span>
        </div>
        <div className={`${styles.figure} ${styles.figureMain}`}>
          <span className="label">{overview.brandShareLabel}</span>
          <span className={styles.figureValue}>{money(overview.brandCents)}</span>
        </div>
      </div>

      <div className={styles.summaryActions}>
        <button
          type="button"
          className="button button-secondary"
          disabled={!editable || !commands.canOpen}
          onClick={onEdit}
        >
          Modifica
        </button>
        {report.pieces > 0 && page.shop.active && (
          <Link
            href={consignmentOrderHref(page.shop.code, "nuovo", report.month)}
            prefetch={false}
            className={styles.inlineLink}
          >
            Prepara un ordine con le stesse magliette
          </Link>
        )}
      </div>

      {overview.lines.length ? (
        <table className={styles.table}>
          <caption className="sr-only">Righe del resoconto di {overview.title}</caption>
          <thead>
            <tr>
              <th scope="col">Maglietta</th>
              <th scope="col">Pezzi</th>
              {showBefore && <th scope="col">Prima della conta</th>}
              <th scope="col">Prezzo sito</th>
              <th scope="col">Prezzo negozio</th>
              <th scope="col">Incasso</th>
              <th scope="col">Quota LuckyLap</th>
            </tr>
          </thead>
          <tbody>
            {overview.lines.map((line) => (
              <tr key={line.id}>
                <th scope="row">{line.label}</th>
                <td data-label="Pezzi">{line.quantity}</td>
                {showBefore && <td data-label="Prima della conta">{line.beforeCountQuantity}</td>}
                <td data-label="Prezzo sito">{money(line.webPriceCents)}</td>
                <td data-label="Prezzo negozio">{money(line.unitShopPriceCents)}</td>
                <td data-label="Incasso">{money(line.grossCents)}</td>
                <td data-label="Quota LuckyLap">{money(line.brandCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Totale</th>
              <td data-label="Pezzi">{overview.pieces}</td>
              {showBefore && <td data-label="Prima della conta" />}
              <td data-label="Prezzo sito" />
              <td data-label="Prezzo negozio" />
              <td data-label="Incasso">{money(overview.grossCents)}</td>
              <td data-label="Quota LuckyLap">{money(overview.brandCents)}</td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <p className={styles.empty}>Nessuna vendita nel mese: niente da fatturare.</p>
      )}

      <section className={styles.section} aria-labelledby="fattura-pagamenti">
        <h2 id="fattura-pagamenti" className={styles.sectionTitle}>
          Fattura e pagamenti
        </h2>
        <dl className={styles.status}>
          <div>
            <dt>Fattura</dt>
            <dd>{overview.invoiceLabel}</dd>
          </div>
          <div>
            <dt>Pagamento</dt>
            <dd className={done ? styles.done : undefined}>
              {done && report.paymentState === "paid" && (
                <span className={`${roadbook.box} ${roadbook.isDone}`}>fatto</span>
              )}{" "}
              {overview.paymentLabel}
            </dd>
          </div>
        </dl>
        {overview.invoice?.outdated && (
          <p className={styles.warning}>
            Resoconto modificato dopo la fattura n. {overview.invoice.number}: controlla se serve
            una nota di credito.
          </p>
        )}
        {overview.overpaidCents !== null && overview.overpaidCents > 0 && (
          <p className={styles.warning}>
            Il negozio ha pagato {money(overview.overpaidCents)} in più del dovuto.
          </p>
        )}
        {canFinance ? (
          <>
            {(report.brandCents > 0 || report.invoice) && <InvoiceForm report={report} now={now} />}
            {overview.payments && overview.payments.length > 0 && (
              <ul className={styles.payments} aria-label="Pagamenti ricevuti">
                {overview.payments.map((p) => (
                  <PaymentRow key={`${p.id}:${p.version}`} payment={p} />
                ))}
              </ul>
            )}
            {(overview.remainingCents ?? 0) > 0 && (
              <PaymentForm report={report} remaining={overview.remainingCents!} now={now} />
            )}
          </>
        ) : (
          <p className={styles.muted}>
            Fattura e pagamenti si registrano con Finance sbloccata:{" "}
            <Link href="/auth/area/finance">apri Finance</Link>.
          </p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="versioni">
        <h2 id="versioni" className={styles.sectionTitle}>
          Versioni
        </h2>
        <ol className={styles.versions}>
          {overview.history.map((h) => (
            <li key={h.revision}>{h.label}</li>
          ))}
        </ol>
      </section>
      <p className={styles.footnote}>
        Importi commerciali. Il trattamento IVA va verificato a parte.
      </p>
    </div>
  );
}

export function ConsignmentReport({
  page,
  month,
  canFinance,
  now,
}: {
  page: ShopPage;
  month: string;
  canFinance: boolean;
  now: string;
}) {
  const report = page.reports.find((r) => r.month === month) ?? null;
  const [editing, setEditing] = useState(false);
  if (page.shop.firstCountedAt === null && !report)
    return (
      <div className={styles.emptyState}>
        <p className={styles.emptyTitle}>Prima conta le magliette in negozio.</p>
        <p className={styles.muted}>
          Il resoconto parte dalla giacenza contata: senza conta non si sa da dove scalare i pezzi
          venduti.
        </p>
        <Link
          href={consignmentCountHref(page.shop.code)}
          prefetch={false}
          className="button button-primary"
        >
          Conta in negozio
        </Link>
      </div>
    );
  if (!report || editing)
    return (
      <ReportForm
        key={report ? `edit-${report.revision}` : "new"}
        page={page}
        month={month}
        report={report}
        now={now}
        onCancel={report ? () => setEditing(false) : undefined}
        onSaved={() => setEditing(false)}
      />
    );
  return (
    <ReportSummary
      page={page}
      report={report}
      canFinance={canFinance}
      now={now}
      onEdit={() => setEditing(true)}
    />
  );
}
