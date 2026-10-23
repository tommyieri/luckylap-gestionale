import {
  money,
  record,
  salesChannelLabel,
  salesOrderLabel,
  type SalesCommand,
  type SalesLine,
  type SalesSnapshot,
} from "./model";

/*
 * Riepilogo leggibile di un invio delle Vendite rimasto da verificare (docs: 06 R4). Mai UUID,
 * codici di canale o centesimi: il canale con la sua etichetta, l'ordine con il suo nome, le
 * quantità in capi. I nomi di articoli, ordini, righe e capi da produrre arrivano dalla pagina
 * (`salesAttemptNames`); senza nomi resta «Riga 1», «Riga 2».
 */

export type SalesAttemptNames = {
  item?: (stockItemId: string) => string | null;
  order?: (orderId: string) => string | null;
  orderLine?: (orderLineId: string) => string | null;
  /** Capi da produrre: articolo e ordine. */
  requirement?: (requirementId: string) => string | null;
};
export type SalesAttemptSummary = { title: string; lines: string[]; occurredAt?: string };

const TITLES: Record<SalesCommand["kind"], string> = {
  register_manual_sale: "Vendita da verificare",
  fulfill_order_lines: "Consegna da verificare",
  cancel_unfulfilled_lines: "Annullo da verificare",
  complete_production: "Capi prodotti da verificare",
  record_manual_payment: "Incasso da verificare",
};
const METHODS: Record<string, string> = {
  cash: "contanti",
  bank_transfer: "bonifico",
  external_card: "carta su POS esterno",
  other: "altro metodo",
};

export const tshirts = (quantity: unknown) =>
  typeof quantity === "number"
    ? `${quantity.toLocaleString("it-IT")} ${quantity === 1 ? "capo" : "capi"}`
    : "quantità non leggibile";
const cents = (value: unknown) =>
  typeof value === "number" ? money(value) : "importo non leggibile";
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function salesAttemptSummary(
  command: SalesCommand,
  names: SalesAttemptNames = {},
): SalesAttemptSummary {
  const p = command.payload;
  const lines: string[] = [];
  if (typeof p.channel === "string")
    lines.push(`Canale: ${salesChannelLabel[p.channel] ?? "altro canale"}`);
  if (text(p.external_reference))
    lines.push(`Riferimento dell’ordine: ${text(p.external_reference)}`);
  if (typeof p.order_id === "string")
    lines.push(names.order?.(p.order_id) ?? salesOrderLabel({ id: p.order_id, reference: null }));
  if (Array.isArray(p.lines))
    p.lines.forEach((raw, index) => {
      const line = record(raw);
      const id = text(line?.stock_item_id) || text(line?.order_line_id);
      const name =
        (line?.stock_item_id ? names.item?.(id) : names.orderLine?.(id)) ?? `Riga ${index + 1}`;
      const price =
        typeof line?.unit_price_cents === "number"
          ? ` a ${money(line.unit_price_cents)}${
              typeof line.discount_cents === "number" && line.discount_cents > 0
                ? `, sconto ${money(line.discount_cents)}`
                : ""
            }`
          : "";
      lines.push(`${name}: ${tshirts(line?.quantity)}${price}`);
    });
  if (command.kind === "complete_production") {
    const name = text(p.requirement_id) ? names.requirement?.(text(p.requirement_id)) : null;
    if (name) lines.push(name);
    lines.push(`Prodotti: ${tshirts(p.quantity)}`);
  }
  const payment = record(p.payment);
  if (payment?.status === "paid")
    lines.push(
      `Pagata: ${cents(payment.amount_cents)} in ${METHODS[String(payment.method)] ?? "altro metodo"}`,
    );
  else if (payment?.status === "unpaid") lines.push("Da incassare");
  if (command.kind === "record_manual_payment")
    lines.push(
      `Incasso: ${cents(p.amount_cents)} in ${METHODS[String(p.method)] ?? "altro metodo"}`,
    );
  if (text(p.reason)) lines.push(`Motivo: ${text(p.reason)}`);
  return {
    title: TITLES[command.kind],
    lines,
    occurredAt: typeof p.occurred_at === "string" ? p.occurred_at : undefined,
  };
}

/**
 * Nomi dai dati della pagina delle Vendite: l'articolo con il suo nome, l'ordine come
 * nell'elenco (`salesOrderLabel`), la riga con il suo articolo, i capi da produrre con
 * articolo e ordine. Un id che la pagina non conosce dà `null`: resta il nome di riserva.
 */
export function salesAttemptNames(
  snapshot: Pick<SalesSnapshot, "items" | "orders" | "requirements">,
): SalesAttemptNames {
  const items = new Map(snapshot.items.map((item) => [item.id, item.name.trim() || item.sku]));
  const orders = new Map(snapshot.orders.map((order) => [order.id, order]));
  const orderLines = new Map(
    snapshot.orders.flatMap((order) => order.lines.map((line) => [line.id, line] as const)),
  );
  const requirements = new Map(snapshot.requirements.map((row) => [row.id, row.lineId]));
  const lineName = (line: SalesLine) => items.get(line.itemId) ?? line.sku;
  const orderName = (orderId: string) => {
    const order = orders.get(orderId);
    return order ? salesOrderLabel(order) : null;
  };
  return {
    item: (id) => items.get(id) ?? null,
    order: orderName,
    orderLine: (id) => {
      const line = orderLines.get(id);
      return line ? lineName(line) : null;
    },
    requirement: (id) => {
      const line = orderLines.get(requirements.get(id) ?? "");
      if (!line) return null;
      const order = orderName(line.orderId);
      return order ? `${lineName(line)}, ${order}` : lineName(line);
    },
  };
}
