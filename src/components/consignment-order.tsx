"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { romeInputToIso, romeTimeInput } from "../lib/sales/model";
import {
  calendarDay,
  momentLabel,
  optionalField,
  parseShopCommand,
  quantityField,
  romeToday,
  tshirtsLabel,
  type ItemLine,
} from "../lib/consignment/shop-model";
import {
  orderProgress,
  shopQuantity,
  shopStockGrid,
  type OrderProgressLine,
  type ShopOrder,
  type ShopPage,
} from "../lib/consignment/shop-read";
import { consignmentOrderHref } from "../lib/consignment/links";
import { ConsignmentStockGrid } from "./consignment-stock-grid";
import { FormMessage, useShopCommands, type FormNotice } from "./consignment-pending";
import roadbook from "./roadbook.module.css";
import styles from "./consignment-shop.module.css";

/** Riferimento stabile: un modulo che si apre viene portato in vista una volta sola. */
const revealOnMount = (element: HTMLElement | null) =>
  element?.scrollIntoView?.({ block: "nearest" });

/*
 * Ordini del negozio (docs/consignment.md, «Ordini»): nuovo ordine, consegna
 * anche parziale, modifica finché è aperto, chiusura con motivo. Gli ordini non
 * riservano il magazzino: «In magazzino» è la disponibilità di adesso e la
 * consegna la ricontrolla. Qui c'è anche «Riporta in magazzino» del negozio.
 */

export type LineFields =
  { status: "ok"; lines: ItemLine[] } | { status: "invalid"; invalid: Set<string> };
/** Campi di una griglia → righe con almeno un pezzo, ordinate per articolo. */
export function lineFields(
  values: Record<string, string>,
  max?: (itemId: string) => number,
): LineFields {
  const lines: ItemLine[] = [];
  const invalid = new Set<string>();
  for (const [itemId, value] of Object.entries(values)) {
    const quantity = quantityField(value, 0);
    if (quantity === null || (max && quantity > max(itemId))) invalid.add(itemId);
    else if (quantity > 0) lines.push({ stock_item_id: itemId, quantity });
  }
  if (invalid.size) return { status: "invalid", invalid };
  return {
    status: "ok",
    lines: lines.sort((a, b) => (a.stock_item_id < b.stock_item_id ? -1 : 1)),
  };
}

const requestedFormat = new Intl.DateTimeFormat("it-IT", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const dayText = (day: string) => requestedFormat.format(new Date(`${day}T12:00:00Z`));

/** Ordine nuovo o in modifica: data della richiesta, nota, griglia dei pezzi richiesti. */
function OrderEditor({
  page,
  order,
  prefill,
  now,
  onCancel,
}: {
  page: ShopPage;
  order: ShopOrder | null;
  prefill: ItemLine[] | null;
  now: string;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const commands = useShopCommands();
  const initial = order
    ? order.lines.map((l) => ({ stock_item_id: l.itemId, quantity: l.quantity }))
    : (prefill ?? []);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.map((l) => [l.stock_item_id, String(l.quantity)])),
  );
  const [requestedOn, setRequestedOn] = useState(order?.requestedOn ?? romeToday(now));
  const [note, setNote] = useState(order?.note ?? "");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);
  const [message, setMessage] = useState<FormNotice | null>(null);
  const grid = shopStockGrid(page);
  const delivered = (itemId: string) =>
    order?.lines.find((l) => l.itemId === itemId)?.delivered ?? 0;
  const parsed = lineFields(values);
  const draftOrder: ShopOrder | null =
    parsed.status === "ok"
      ? {
          ...(order ?? {
            id: "",
            number: 0,
            requestedOn,
            note,
            status: "open",
            closeReason: null,
            version: 1,
            createdAt: now,
            updatedAt: now,
            author: "",
          }),
          lines: parsed.lines.map((l) => ({
            id: l.stock_item_id,
            itemId: l.stock_item_id,
            quantity: l.quantity,
            delivered: delivered(l.stock_item_id),
            cancelled: 0,
            remaining: Math.max(0, l.quantity - delivered(l.stock_item_id)),
          })),
        }
      : null;
  const live = draftOrder ? orderProgress(page, draftOrder) : null;
  const pieces = parsed.status === "ok" ? parsed.lines.reduce((s, l) => s + l.quantity, 0) : 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHighlight(null);
    if (parsed.status === "invalid") {
      setInvalid(parsed.invalid);
      return setMessage({ tone: "error", text: "Scrivi numeri interi nelle caselle evidenziate." });
    }
    const below = (order?.lines ?? []).filter(
      (l) =>
        l.delivered > 0 &&
        (parsed.lines.find((p) => p.stock_item_id === l.itemId)?.quantity ?? 0) < l.delivered,
    );
    if (below.length) {
      setInvalid(new Set(below.map((l) => l.itemId)));
      return setMessage({
        tone: "error",
        text: "Non puoi scendere sotto le magliette già consegnate.",
      });
    }
    setInvalid(new Set());
    if (!parsed.lines.length)
      return setMessage({ tone: "error", text: "Scrivi almeno una maglietta da consegnare." });
    if (!calendarDay(requestedOn) || requestedOn > romeToday(now))
      return setMessage({
        tone: "error",
        text: "La data della richiesta non può essere nel futuro.",
      });
    const command = parseShopCommand({
      operationId: crypto.randomUUID(),
      kind: "save_consignment_order",
      payload: {
        schema_version: 1,
        order_id: order?.id ?? null,
        expected_version: order?.version ?? null,
        location_id: page.shop.locationId,
        requested_on: requestedOn,
        note,
        lines: parsed.lines,
      },
    });
    if (!command)
      return setMessage({
        tone: "error",
        text: "Controlla i dati: fino a 200 magliette diverse e una nota di al massimo 1000 caratteri.",
      });
    setMessage(null);
    const result = await commands.send(command);
    if (!result) return;
    if (result.status === "success") {
      if (!order && result.target.orderNumber) {
        commands.flash(result.message);
        router.push(consignmentOrderHref(page.shop.code, result.target.orderNumber));
      } else {
        commands.announce(result.message);
        onCancel?.();
      }
      return;
    }
    setMessage({ tone: "error", text: result.message });
    if (result.status === "rejected") setHighlight(result.itemId ?? null);
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <p className={styles.sectionNote}>
        {order
          ? "Modifica le quantità richieste. Una taglia non può scendere sotto le magliette già consegnate."
          : prefill?.length
            ? "Ordine già compilato con le magliette vendute nel mese: cambia quello che serve."
            : "Scrivi quante magliette chiede il negozio per taglia. L’ordine non blocca il magazzino: la consegna controlla le magliette disponibili."}
      </p>
      <fieldset className={styles.fieldset}>
        <legend className="sr-only">Magliette richieste</legend>
        <ConsignmentStockGrid
          grid={grid}
          label="Magliette richieste dal negozio"
          highlight={highlight}
          input={{
            values,
            verb: "richieste",
            invalid,
            editable: (cell) =>
              (cell.item?.active ?? false) || (cell.item ? cell.item.id in values : false),
            onChange: (itemId, value) => setValues((v) => ({ ...v, [itemId]: value })),
          }}
          note={(cell) =>
            cell.item && delivered(cell.item.id) > 0
              ? `consegnate ${delivered(cell.item.id)}`
              : null
          }
        />
        <div className={styles.fields}>
          <label className={styles.field}>
            <span>Data della richiesta</span>
            <input
              type="date"
              value={requestedOn}
              max={romeToday(now)}
              onChange={(e) => setRequestedOn(e.target.value)}
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Nota (facoltativa)</span>
            <textarea
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>
      </fieldset>
      <div className={styles.actionBar}>
        {message && (
          <div className={styles.barMessage}>
            <FormMessage message={message} />
          </div>
        )}
        <p className={styles.barSummary}>
          <span className="num">{tshirtsLabel(pieces)}</span>
          {live && live.remaining > 0 && (
            <>
              {" "}
              · In magazzino <span className="num">{live.ready}</span>
              {live.missing > 0 && (
                <>
                  {" "}
                  ·{" "}
                  <span className={styles.late}>
                    Mancano <span className="num">{live.missing}</span>
                  </span>
                </>
              )}
            </>
          )}
        </p>
        <div className={styles.barActions}>
          {onCancel && (
            <button type="button" className="button button-secondary" onClick={onCancel}>
              Annulla
            </button>
          )}
          <button
            type="submit"
            className="button button-primary"
            disabled={!page.shop.active || commands.locked}
          >
            {commands.sending ? "Salvataggio…" : order ? "Salva l’ordine" : "Salva ordine"}
          </button>
        </div>
      </div>
    </form>
  );
}

export type DeliveryShortfall = {
  /** Righe con più magliette di quelle libere in magazzino: «GT3RS Blu M (1 su 2)». */
  short: { itemId: string; text: string }[];
  missing: number;
  /** Gli stessi campi con le righe corte abbassate a quelle in magazzino. */
  inStock: Record<string, string>;
  inStockPieces: number;
};
/**
 * Consegna scritta contro la disponibilità di adesso (`null` vale 0, come in
 * `orderProgress`). Il database ricontrolla comunque: qui serve solo ad
 * avvisare prima dell'invio, perché se ne manca una non si registra niente.
 */
export function deliveryShortfall(
  lines: readonly OrderProgressLine[],
  values: Record<string, string>,
): DeliveryShortfall {
  const short: DeliveryShortfall["short"] = [];
  const inStock = { ...values };
  let missing = 0,
    inStockPieces = 0;
  for (const line of lines) {
    const typed = quantityField(values[line.itemId] ?? "", 0);
    if (typed === null) continue;
    const free = Math.max(0, line.available ?? 0);
    if (typed > free) {
      short.push({ itemId: line.itemId, text: `${line.label} (${free} su ${typed})` });
      missing += typed - free;
      inStock[line.itemId] = String(free);
    }
    inStockPieces += Math.min(typed, free);
  }
  return { short, missing, inStock, inStockPieces };
}

/**
 * «Consegnato»: già compilato con tutto il residuo, modificabile per una
 * consegna parziale. Se il magazzino non basta lo dice prima dell'invio e
 * propone di consegnare solo quelle che ci sono.
 */
function DeliveryForm({
  page,
  order,
  now,
  onDone,
}: {
  page: ShopPage;
  order: ShopOrder;
  now: string;
  onDone: () => void;
}) {
  const commands = useShopCommands();
  const progress = orderProgress(page, order);
  const open = progress.lines.filter((l) => l.remaining > 0);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(open.map((l) => [l.itemId, String(l.remaining)])),
  );
  const [occurredAt, setOccurredAt] = useState(romeTimeInput(now).slice(0, 16));
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);
  const [message, setMessage] = useState<FormNotice | null>(null);
  const remaining = (itemId: string) => open.find((l) => l.itemId === itemId)?.remaining ?? 0;
  const parsed = lineFields(values, remaining);
  const pieces = parsed.status === "ok" ? parsed.lines.reduce((s, l) => s + l.quantity, 0) : 0;
  const shortfall = deliveryShortfall(open, values);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHighlight(null);
    if (parsed.status === "invalid") {
      setInvalid(parsed.invalid);
      return setMessage({
        tone: "error",
        text: "Per ogni taglia consegna da 0 fino a quelle che restano nell’ordine.",
      });
    }
    setInvalid(new Set());
    if (!parsed.lines.length)
      return setMessage({ tone: "error", text: "Scrivi almeno una maglietta consegnata." });
    const command = parseShopCommand({
      operationId: crypto.randomUUID(),
      kind: "ship_consignment_order",
      payload: {
        schema_version: 1,
        order_id: order.id,
        expected_version: order.version,
        occurred_at: romeInputToIso(occurredAt),
        lines: parsed.lines,
      },
    });
    if (!command)
      return setMessage({ tone: "error", text: "Data e ora della consegna non valide." });
    setMessage(null);
    const result = await commands.send(command);
    if (!result) return;
    if (result.status === "success") {
      commands.announce(result.message);
      onDone();
      return;
    }
    setMessage({ tone: "error", text: result.message });
    if (result.status === "rejected") setHighlight(result.itemId ?? null);
  }

  return (
    <form
      ref={revealOnMount}
      className={styles.subform}
      onSubmit={submit}
      noValidate
      aria-label="Consegna al negozio"
    >
      <p className={styles.sectionNote}>
        Le magliette escono da {page.shop.supply?.name ?? "magazzino"} ed entrano in negozio. Se ne
        manca anche una, non si registra niente.
      </p>
      <ul className={styles.deliver}>
        {open.map((line) => (
          <li
            key={line.itemId}
            className={`${styles.deliverRow} ${line.missing > 0 ? styles.lineShort : ""} ${invalid.has(line.itemId) || highlight === line.itemId ? styles.lineMarked : ""}`}
          >
            <span className={styles.deliverName}>
              {line.label}
              <span className={styles.lineHint}>
                Da consegnare <span className="num">{line.remaining}</span> · In magazzino{" "}
                <span className="num">{line.available ?? "—"}</span>
              </span>
            </span>
            <input
              className={styles.cellInput}
              type="text"
              size={4}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="off"
              value={values[line.itemId] ?? ""}
              aria-invalid={invalid.has(line.itemId) || undefined}
              aria-label={`${line.label}, consegnate`}
              onChange={(e) => setValues((v) => ({ ...v, [line.itemId]: e.target.value }))}
            />
          </li>
        ))}
      </ul>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Data e ora della consegna · ora di Roma</span>
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </label>
      </div>
      {shortfall.short.length > 0 && (
        <div className={`${styles.warning} ${styles.shortfall}`} role="status">
          <p>
            Il magazzino non basta, mancano {tshirtsLabel(shortfall.missing)}:{" "}
            {shortfall.short.map((s) => s.text).join(", ")}. Così la consegna non si registra.
          </p>
          {shortfall.inStockPieces > 0 && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setValues(shortfall.inStock);
                setInvalid(new Set());
                setMessage(null);
              }}
            >
              Consegna solo quelle in magazzino
            </button>
          )}
        </div>
      )}
      <div className={styles.actions}>
        <button
          type="submit"
          className="button button-primary"
          disabled={commands.locked || !page.settings.stockEnabled}
        >
          {commands.sending ? "Salvataggio…" : `Registra la consegna di ${tshirtsLabel(pieces)}`}
        </button>
        <button type="button" className="button button-secondary" onClick={onDone}>
          Annulla
        </button>
      </div>
      <FormMessage message={message} />
    </form>
  );
}

function CloseForm({ order, onDone }: { order: ShopOrder; onDone: () => void }) {
  const commands = useShopCommands();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<FormNotice | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const command = parseShopCommand({
      operationId: crypto.randomUUID(),
      kind: "close_consignment_order",
      payload: {
        schema_version: 1,
        order_id: order.id,
        expected_version: order.version,
        reason,
      },
    });
    if (!command)
      return setMessage({ tone: "error", text: "Scrivi il motivo (da 3 a 500 caratteri)." });
    const result = await commands.send(command);
    if (!result) return;
    if (result.status === "success") {
      commands.announce(result.message);
      onDone();
    } else setMessage({ tone: "error", text: result.message });
  }
  return (
    <form
      ref={revealOnMount}
      className={styles.subform}
      onSubmit={submit}
      noValidate
      aria-label="Chiusura dell’ordine"
    >
      <p className={styles.sectionNote}>
        Le magliette non ancora consegnate escono dall’ordine. Quelle già consegnate restano in
        negozio.
      </p>
      <label className={`${styles.field} ${styles.fieldWide}`}>
        <span>Perché chiudi l’ordine?</span>
        <textarea
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className={styles.actions}>
        <button type="submit" className="button button-primary" disabled={commands.locked}>
          {commands.sending ? "Salvataggio…" : "Chiudi ordine"}
        </button>
        <button type="button" className="button button-secondary" onClick={onDone}>
          Annulla
        </button>
      </div>
      <FormMessage message={message} />
    </form>
  );
}

function OrderView({ page, order, now }: { page: ShopPage; order: ShopOrder; now: string }) {
  const commands = useShopCommands();
  const [mode, setMode] = useState<"view" | "deliver" | "edit" | "close">("view");
  const progress = orderProgress(page, order);
  const shipments = page.shipments.filter((s) => s.orderId === order.id);
  const isOpen = order.status === "open";
  if (mode === "edit")
    return (
      <OrderEditor
        page={page}
        order={order}
        prefill={null}
        now={now}
        onCancel={() => setMode("view")}
      />
    );
  return (
    <div className={styles.summary}>
      <dl className={styles.status}>
        <div>
          <dt>Stato</dt>
          <dd>
            {order.status === "delivered" ? (
              <>
                <span className={`${roadbook.box} ${roadbook.isDone}`}>fatto</span> Consegnato tutto
              </>
            ) : order.status === "closed" ? (
              <>Chiuso{order.closeReason ? `: ${order.closeReason}` : ""}</>
            ) : (
              "Da consegnare"
            )}
          </dd>
        </div>
        <div>
          <dt>Richiesto</dt>
          <dd>
            {dayText(order.requestedOn)} · {order.author}
          </dd>
        </div>
        {order.note && (
          <div>
            <dt>Nota</dt>
            <dd>{order.note}</dd>
          </div>
        )}
      </dl>
      {isOpen && (
        <p className={styles.progress}>
          Da preparare: <span className="num">{progress.remaining}</span> · In magazzino:{" "}
          <span className="num">{progress.ready}</span>
          {progress.missing > 0 && (
            <>
              {" "}
              ·{" "}
              <span className={styles.late}>
                Mancano: <span className="num">{progress.missing}</span>
              </span>
            </>
          )}
        </p>
      )}
      <table className={styles.table}>
        <caption className="sr-only">Righe dell’ordine n. {order.number}</caption>
        <thead>
          <tr>
            <th scope="col">Maglietta</th>
            <th scope="col">Richieste</th>
            <th scope="col">Consegnate</th>
            <th scope="col">Da consegnare</th>
            {isOpen && <th scope="col">In magazzino</th>}
            {isOpen && <th scope="col">Mancano</th>}
          </tr>
        </thead>
        <tbody>
          {progress.lines.map((line) => (
            <tr key={line.id} className={isOpen && line.missing > 0 ? styles.rowShort : undefined}>
              <th scope="row">{line.label}</th>
              <td data-label="Richieste">{line.quantity}</td>
              <td data-label="Consegnate">{line.delivered}</td>
              <td data-label="Da consegnare">{line.remaining}</td>
              {isOpen && <td data-label="In magazzino">{line.available ?? "—"}</td>}
              {isOpen && <td data-label="Mancano">{line.missing}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {isOpen && mode === "view" && (
        <div className={styles.actions}>
          <button
            type="button"
            className="button button-primary"
            disabled={!commands.canOpen || !page.settings.stockEnabled}
            onClick={() => setMode("deliver")}
          >
            Consegnato
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={!commands.canOpen}
            onClick={() => setMode("edit")}
          >
            Modifica ordine
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={!commands.canOpen}
            onClick={() => setMode("close")}
          >
            Chiudi ordine
          </button>
        </div>
      )}
      {isOpen && mode === "deliver" && (
        <DeliveryForm page={page} order={order} now={now} onDone={() => setMode("view")} />
      )}
      {isOpen && mode === "close" && <CloseForm order={order} onDone={() => setMode("view")} />}
      {shipments.length > 0 && (
        <section className={styles.section} aria-labelledby="consegne">
          <h2 id="consegne" className={styles.sectionTitle}>
            Consegne
          </h2>
          <ol className={styles.versions}>
            {shipments.map((s) => (
              <li key={s.id}>
                <span className="num">{momentLabel(s.occurredAt)}</span> · {tshirtsLabel(s.pieces)}{" "}
                · {s.author}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

export function ConsignmentOrder({
  page,
  order,
  prefill = null,
  now,
}: {
  page: ShopPage;
  order: ShopOrder | null;
  prefill?: ItemLine[] | null;
  now: string;
}) {
  if (!order) return <OrderEditor page={page} order={null} prefill={prefill} now={now} />;
  return <OrderView key={`${order.id}:${order.version}`} page={page} order={order} now={now} />;
}

/** «Riporta in magazzino»: azione secondaria dello storico, per esempio a fine stagione. */
export function ReturnStockForm({
  page,
  now,
  disabled = false,
}: {
  page: ShopPage;
  now: string;
  disabled?: boolean;
}) {
  const commands = useShopCommands();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [occurredAt, setOccurredAt] = useState(romeTimeInput(now).slice(0, 16));
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);
  const [message, setMessage] = useState<FormNotice | null>(null);
  const inShop = (itemId: string) => shopQuantity(page, itemId) ?? 0;
  const parsed = lineFields(values, inShop);
  const pieces = parsed.status === "ok" ? parsed.lines.reduce((s, l) => s + l.quantity, 0) : 0;
  const supply = page.shop.supply;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHighlight(null);
    if (parsed.status === "invalid") {
      setInvalid(parsed.invalid);
      return setMessage({
        tone: "error",
        text: "Per ogni taglia riporta da 0 fino a quelle che ci sono in negozio.",
      });
    }
    setInvalid(new Set());
    if (!parsed.lines.length)
      return setMessage({ tone: "error", text: "Scrivi almeno una maglietta da riportare." });
    const command = parseShopCommand({
      operationId: crypto.randomUUID(),
      kind: "return_consignment_stock",
      payload: {
        schema_version: 1,
        location_id: page.shop.locationId,
        occurred_at: romeInputToIso(occurredAt),
        reason,
        lines: parsed.lines,
      },
    });
    if (!command)
      return setMessage({
        tone: "error",
        text: "Scrivi il motivo (da 3 a 500 caratteri) e una data valida.",
      });
    setMessage(null);
    const result = await commands.send(command);
    if (!result) return;
    if (result.status === "success") {
      commands.announce(result.message);
      setOpen(false);
      setValues({});
      setReason("");
      return;
    }
    setMessage({ tone: "error", text: result.message });
    if (result.status === "rejected") setHighlight(result.itemId ?? null);
  }

  if (!open)
    return (
      <div className={styles.actions}>
        <button
          type="button"
          className="button button-secondary"
          disabled={disabled || !commands.canOpen || !supply}
          onClick={() => setOpen(true)}
        >
          Riporta in magazzino
        </button>
        {!supply && (
          <p className={styles.muted}>
            Scegli il magazzino di partenza nelle impostazioni del negozio.
          </p>
        )}
      </div>
    );
  return (
    <form
      ref={revealOnMount}
      className={styles.subform}
      onSubmit={submit}
      noValidate
      aria-label="Riporta in magazzino"
    >
      <p className={styles.sectionNote}>
        Le magliette escono dal negozio e tornano in {supply?.name ?? "magazzino"}. Non è una
        vendita e non consuma packaging.
      </p>
      <ConsignmentStockGrid
        grid={shopStockGrid(page)}
        label="Magliette da riportare in magazzino"
        highlight={highlight}
        input={{
          values,
          verb: "da riportare",
          invalid,
          editable: (cell) => (cell.item ? inShop(cell.item.id) > 0 : false),
          onChange: (itemId, value) => setValues((v) => ({ ...v, [itemId]: value })),
        }}
        note={(cell) =>
          cell.item && inShop(cell.item.id) > 0 ? `su ${inShop(cell.item.id)}` : null
        }
      />
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Data e ora · ora di Roma</span>
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>Perché le riporti?</span>
          <textarea
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      <div className={styles.actions}>
        <button
          type="submit"
          className="button button-primary"
          disabled={disabled || commands.locked}
        >
          {commands.sending ? "Salvataggio…" : `Riporta ${tshirtsLabel(pieces)}`}
        </button>
        <button type="button" className="button button-secondary" onClick={() => setOpen(false)}>
          Annulla
        </button>
      </div>
      <FormMessage message={message} />
    </form>
  );
}
