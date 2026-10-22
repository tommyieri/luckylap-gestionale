import { stockRecord as record, stockUuid as uuid } from "../stock/model";
import { romeInputToIso } from "../sales/model";
import { localReportDate } from "../finance/model";
import { consignmentDate, consignmentMoney, MAX_CENTS } from "./model";

/*
 * Conto vendita semplice (docs/consignment.md): tipi, calcolo delle righe del
 * resoconto, lettura dei dieci comandi e chiavi del tentativo in sospeso.
 * Funzioni pure, senza React né Supabase: le usano server, pagine e anteprima.
 */

export const SHOP_COMMAND_KINDS = [
  "save_consignment_shop",
  "count_consignment_stock",
  "save_consignment_report",
  "set_consignment_invoice",
  "record_consignment_payment",
  "update_consignment_payment",
  "save_consignment_order",
  "ship_consignment_order",
  "close_consignment_order",
  "return_consignment_stock",
] as const;
export type ShopCommandKind = (typeof SHOP_COMMAND_KINDS)[number];
/** Nuovo negozio, fattura e pagamenti: solo con Finance aperta (decisione 34). */
export const FINANCE_SHOP_COMMANDS: readonly ShopCommandKind[] = [
  "save_consignment_shop",
  "set_consignment_invoice",
  "record_consignment_payment",
  "update_consignment_payment",
];
export const isFinanceShopCommand = (kind: ShopCommandKind) => FINANCE_SHOP_COMMANDS.includes(kind);

export const MAX_LINES = 200;
export const MAX_QUANTITY = 100_000;
export const MAX_WEB_PRICE_CENTS = 99_999_999_999_999;
export const MAX_MARKUP_CENTS = 100_000_000;
export const SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

export type PaymentMethod = "bank_transfer" | "cash" | "other";
export const PAYMENT_METHODS: readonly PaymentMethod[] = ["bank_transfer", "cash", "other"];
export type PaymentState = "nothing_due" | "unpaid" | "partial" | "paid" | "overpaid";
export const PAYMENT_STATES: readonly PaymentState[] = [
  "nothing_due",
  "unpaid",
  "partial",
  "paid",
  "overpaid",
];
export type OrderStatus = "open" | "delivered" | "closed";

export type ShopPayload = {
  schema_version: 1;
  location_id: string | null;
  expected_version: number | null;
  name: string;
  brand_share_bps: number;
  markup_cents: number;
  supply_location_id: string;
  note: string;
  active: boolean;
};
export type CountLine = {
  stock_item_id: string;
  quantity: number;
  expected_quantity: number | null;
};
export type CountPayload = {
  schema_version: 1;
  location_id: string;
  counted_at: string;
  note: string;
  lines: CountLine[];
};
export type ReportPrice = {
  shop_domain: string;
  variant_gid: string;
  expected_web_price_cents: number;
  expected_catalog_observed_at: string;
};
export type ReportLine = {
  stock_item_id: string;
  quantity: number;
  before_count_quantity: number;
  price: ReportPrice | null;
};
export type ReportPayload = {
  schema_version: 1;
  location_id: string;
  period_month: string;
  expected_revision: number | null;
  reason: string | null;
  lines: ReportLine[];
};
export type InvoicePayload = {
  schema_version: 1;
  report_id: string;
  expected_revision: number;
  invoice_number: string | null;
  invoice_date: string | null;
};
export type PaymentPayload = {
  schema_version: 1;
  report_id: string;
  amount_cents: number;
  paid_at: string;
  method: PaymentMethod;
  account_label: string | null;
  reference: string | null;
};
export type PaymentUpdatePayload = {
  schema_version: 1;
  payment_id: string;
  expected_version: number;
  amount_cents: number;
  paid_at: string;
  method: PaymentMethod;
  account_label: string | null;
  reference: string | null;
  voided: boolean;
  reason: string;
};
export type ItemLine = { stock_item_id: string; quantity: number };
export type OrderPayload = {
  schema_version: 1;
  order_id: string | null;
  expected_version: number | null;
  location_id: string;
  requested_on: string;
  note: string;
  lines: ItemLine[];
};
export type ShipPayload = {
  schema_version: 1;
  order_id: string;
  expected_version: number;
  occurred_at: string;
  lines: ItemLine[];
};
export type ClosePayload = {
  schema_version: 1;
  order_id: string;
  expected_version: number;
  reason: string;
};
export type ReturnPayload = {
  schema_version: 1;
  location_id: string;
  occurred_at: string;
  reason: string;
  lines: ItemLine[];
};
export type ShopCommand = (
  | { kind: "save_consignment_shop"; payload: ShopPayload }
  | { kind: "count_consignment_stock"; payload: CountPayload }
  | { kind: "save_consignment_report"; payload: ReportPayload }
  | { kind: "set_consignment_invoice"; payload: InvoicePayload }
  | { kind: "record_consignment_payment"; payload: PaymentPayload }
  | { kind: "update_consignment_payment"; payload: PaymentUpdatePayload }
  | { kind: "save_consignment_order"; payload: OrderPayload }
  | { kind: "ship_consignment_order"; payload: ShipPayload }
  | { kind: "close_consignment_order"; payload: ClosePayload }
  | { kind: "return_consignment_stock"; payload: ReturnPayload }
) & { operationId: string; retry?: boolean };

/** Dati della ricevuta già verificati dal server, per rileggere o aprire la pagina giusta. */
export type ShopTarget = {
  locationId?: string;
  code?: string;
  reportId?: string;
  revision?: number;
  orderId?: string;
  orderNumber?: number;
  orderStatus?: OrderStatus;
  paymentId?: string;
  version?: number;
  pieces?: number;
};
export type ShopResult =
  | {
      status: "success";
      kind: ShopCommandKind;
      operationId: string;
      replayed: boolean;
      message: string;
      target: ShopTarget;
    }
  | { status: "rejected"; code: string; message: string; itemId?: string }
  | { status: "uncertain"; message: string };

// ---------------------------------------------------------------------------
// Validazione: stesse regole delle funzioni SQL (private.sale_integer,
// private.consignment_text, private.consignment_note, private.consignment_day).

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
const codePoints = (value: string) => Array.from(value).length;
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
/** Testo rifilato, lungo da `min` a `max` caratteri, senza caratteri di controllo. */
function cleanText(v: unknown, min: number, max: number): string | null {
  if (typeof v !== "string") return null;
  const text = v.trim();
  const length = codePoints(text);
  return length >= min && length <= max && !CONTROL.test(text) ? text : null;
}
/** Nota libera: può essere vuota e andare a capo, nessun altro carattere di controllo. */
function cleanNote(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const note = v.replace(/\r\n/g, "\n").replace(/^[ \n]+|[ \n]+$/g, "");
  return codePoints(note) <= max && !CONTROL_EXCEPT_NEWLINE.test(note) ? note : null;
}
const optionalText = (v: unknown, min: number, max: number): string | null | undefined =>
  v === null ? null : (cleanText(v, min, max) ?? undefined);
const lowerUuid = (v: unknown): string | null => (uuid(v) ? v.toLowerCase() : null);
const exact = (p: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(p).length === keys.length && keys.every((k) => Object.hasOwn(p, k));
const SHOP_DOMAIN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/;
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/[1-9][0-9]{0,19}$/;

/** Giorno di calendario «AAAA-MM-GG» esistente. */
export function calendarDay(v: unknown): v is string {
  if (typeof v !== "string" || !/^2\d{3}-\d{2}-\d{2}$/.test(v)) return false;
  const [year, month, day] = v.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === v;
}
/** Mese del resoconto «AAAA-MM», oppure `null`. */
export function periodMonth(v: unknown): string | null {
  return typeof v === "string" && /^2\d{3}-(0[1-9]|1[0-2])$/.test(v) ? v : null;
}

/**
 * Righe con UUID minuscoli, ordinate per articolo (l'ordine dei lock nel
 * database) e senza doppioni. Tra 1 (o `min`) e 200.
 */
function parseLines<T extends { stock_item_id: string }>(
  value: unknown,
  min: number,
  line: (row: Record<string, unknown>, item: string) => T | null,
): T[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > MAX_LINES) return null;
  const lines: T[] = [];
  for (const raw of value) {
    const row = record(raw),
      item = lowerUuid(row?.stock_item_id);
    if (!row || !item) return null;
    const parsed = line(row, item);
    if (!parsed) return null;
    lines.push(parsed);
  }
  lines.sort((a, b) => (a.stock_item_id < b.stock_item_id ? -1 : 1));
  for (let i = 1; i < lines.length; i++)
    if (lines[i].stock_item_id === lines[i - 1].stock_item_id) return null;
  return lines;
}
const itemLines = (value: unknown) =>
  parseLines<ItemLine>(value, 1, (row, item) =>
    exact(row, ["stock_item_id", "quantity"]) && integer(row.quantity, 1, MAX_QUANTITY)
      ? { stock_item_id: item, quantity: row.quantity }
      : null,
  );
function reportPrice(value: unknown): ReportPrice | null | undefined {
  if (value === null) return null;
  const p = record(value);
  if (
    !p ||
    !exact(p, [
      "shop_domain",
      "variant_gid",
      "expected_web_price_cents",
      "expected_catalog_observed_at",
    ]) ||
    typeof p.shop_domain !== "string" ||
    !SHOP_DOMAIN.test(p.shop_domain) ||
    typeof p.variant_gid !== "string" ||
    !VARIANT_GID.test(p.variant_gid) ||
    !integer(p.expected_web_price_cents, 0, MAX_WEB_PRICE_CENTS) ||
    !consignmentDate(p.expected_catalog_observed_at)
  )
    return undefined;
  return {
    shop_domain: p.shop_domain,
    variant_gid: p.variant_gid,
    expected_web_price_cents: p.expected_web_price_cents,
    expected_catalog_observed_at: p.expected_catalog_observed_at,
  };
}

const PAYLOAD_KEYS: Record<ShopCommandKind, readonly string[]> = {
  save_consignment_shop: [
    "schema_version",
    "location_id",
    "expected_version",
    "name",
    "brand_share_bps",
    "markup_cents",
    "supply_location_id",
    "note",
    "active",
  ],
  count_consignment_stock: ["schema_version", "location_id", "counted_at", "note", "lines"],
  save_consignment_report: [
    "schema_version",
    "location_id",
    "period_month",
    "expected_revision",
    "reason",
    "lines",
  ],
  set_consignment_invoice: [
    "schema_version",
    "report_id",
    "expected_revision",
    "invoice_number",
    "invoice_date",
  ],
  record_consignment_payment: [
    "schema_version",
    "report_id",
    "amount_cents",
    "paid_at",
    "method",
    "account_label",
    "reference",
  ],
  update_consignment_payment: [
    "schema_version",
    "payment_id",
    "expected_version",
    "amount_cents",
    "paid_at",
    "method",
    "account_label",
    "reference",
    "voided",
    "reason",
  ],
  save_consignment_order: [
    "schema_version",
    "order_id",
    "expected_version",
    "location_id",
    "requested_on",
    "note",
    "lines",
  ],
  ship_consignment_order: [
    "schema_version",
    "order_id",
    "expected_version",
    "occurred_at",
    "lines",
  ],
  close_consignment_order: ["schema_version", "order_id", "expected_version", "reason"],
  return_consignment_stock: ["schema_version", "location_id", "occurred_at", "reason", "lines"],
};

function parsePayload(kind: ShopCommandKind, p: Record<string, unknown>) {
  switch (kind) {
    case "save_consignment_shop": {
      const location = p.location_id === null ? null : lowerUuid(p.location_id),
        version =
          p.expected_version === null
            ? null
            : integer(p.expected_version, 1, MAX_CENTS)
              ? p.expected_version
              : undefined,
        name = cleanText(p.name, 3, 120),
        supply = lowerUuid(p.supply_location_id),
        note = cleanNote(p.note, 1000);
      if (
        (p.location_id !== null && location === null) ||
        version === undefined ||
        (location === null) !== (version === null) ||
        name === null ||
        !integer(p.brand_share_bps, 0, 10_000) ||
        !integer(p.markup_cents, 0, MAX_MARKUP_CENTS) ||
        supply === null ||
        supply === location ||
        note === null ||
        typeof p.active !== "boolean" ||
        (location === null && !p.active)
      )
        return null;
      return {
        schema_version: 1,
        location_id: location,
        expected_version: version,
        name,
        brand_share_bps: p.brand_share_bps,
        markup_cents: p.markup_cents,
        supply_location_id: supply,
        note,
        active: p.active,
      } satisfies ShopPayload;
    }
    case "count_consignment_stock": {
      const location = lowerUuid(p.location_id),
        note = cleanNote(p.note, 500),
        lines = parseLines<CountLine>(p.lines, 1, (row, item) =>
          exact(row, ["stock_item_id", "quantity", "expected_quantity"]) &&
          integer(row.quantity, 0, MAX_QUANTITY) &&
          (row.expected_quantity === null || integer(row.expected_quantity, 0, 1_000_000_000))
            ? {
                stock_item_id: item,
                quantity: row.quantity,
                expected_quantity: row.expected_quantity as number | null,
              }
            : null,
        );
      if (!location || !consignmentDate(p.counted_at) || note === null || !lines) return null;
      return {
        schema_version: 1,
        location_id: location,
        counted_at: p.counted_at,
        note,
        lines,
      } satisfies CountPayload;
    }
    case "save_consignment_report": {
      const location = lowerUuid(p.location_id),
        month = periodMonth(p.period_month),
        revision =
          p.expected_revision === null
            ? null
            : integer(p.expected_revision, 1, 100_000)
              ? p.expected_revision
              : undefined,
        reason = optionalText(p.reason, 3, 500),
        lines = parseLines<ReportLine>(p.lines, 0, (row, item) => {
          if (
            !exact(row, ["stock_item_id", "quantity", "before_count_quantity", "price"]) ||
            !integer(row.quantity, 0, MAX_QUANTITY) ||
            !integer(row.before_count_quantity, 0, row.quantity)
          )
            return null;
          const price = reportPrice(row.price);
          // Un prezzo solo per le righe con pezzi; alla creazione ogni riga con pezzi lo porta.
          if (
            price === undefined ||
            (price !== null && row.quantity === 0) ||
            (price === null && row.quantity > 0 && p.expected_revision === null)
          )
            return null;
          return {
            stock_item_id: item,
            quantity: row.quantity,
            before_count_quantity: row.before_count_quantity,
            price,
          };
        });
      if (
        !location ||
        !month ||
        revision === undefined ||
        reason === undefined ||
        (revision !== null && reason === null) ||
        !lines
      )
        return null;
      return {
        schema_version: 1,
        location_id: location,
        period_month: month,
        expected_revision: revision,
        reason,
        lines,
      } satisfies ReportPayload;
    }
    case "set_consignment_invoice": {
      const report = lowerUuid(p.report_id),
        number = optionalText(p.invoice_number, 1, 60),
        date =
          p.invoice_date === null ? null : calendarDay(p.invoice_date) ? p.invoice_date : undefined;
      if (
        !report ||
        !integer(p.expected_revision, 1, 100_000) ||
        number === undefined ||
        date === undefined ||
        (number === null) !== (date === null)
      )
        return null;
      return {
        schema_version: 1,
        report_id: report,
        expected_revision: p.expected_revision,
        invoice_number: number,
        invoice_date: date,
      } satisfies InvoicePayload;
    }
    case "record_consignment_payment":
    case "update_consignment_payment": {
      const account = optionalText(p.account_label, 1, 120),
        reference = optionalText(p.reference, 1, 240);
      if (
        !integer(p.amount_cents, 1, MAX_CENTS) ||
        !consignmentDate(p.paid_at) ||
        !PAYMENT_METHODS.includes(p.method as PaymentMethod) ||
        account === undefined ||
        reference === undefined
      )
        return null;
      const common = {
        amount_cents: p.amount_cents,
        paid_at: p.paid_at,
        method: p.method as PaymentMethod,
        account_label: account,
        reference,
      };
      if (kind === "record_consignment_payment") {
        const report = lowerUuid(p.report_id);
        return report
          ? ({ schema_version: 1, report_id: report, ...common } satisfies PaymentPayload)
          : null;
      }
      const payment = lowerUuid(p.payment_id),
        reason = cleanText(p.reason, 3, 500);
      if (
        !payment ||
        !integer(p.expected_version, 1, MAX_CENTS) ||
        typeof p.voided !== "boolean" ||
        reason === null
      )
        return null;
      return {
        schema_version: 1,
        payment_id: payment,
        expected_version: p.expected_version,
        ...common,
        voided: p.voided,
        reason,
      } satisfies PaymentUpdatePayload;
    }
    case "save_consignment_order": {
      const order = p.order_id === null ? null : lowerUuid(p.order_id),
        version =
          p.expected_version === null
            ? null
            : integer(p.expected_version, 1, MAX_CENTS)
              ? p.expected_version
              : undefined,
        location = lowerUuid(p.location_id),
        note = cleanNote(p.note, 1000),
        lines = itemLines(p.lines);
      if (
        (p.order_id !== null && order === null) ||
        version === undefined ||
        (order === null) !== (version === null) ||
        !location ||
        !calendarDay(p.requested_on) ||
        note === null ||
        !lines
      )
        return null;
      return {
        schema_version: 1,
        order_id: order,
        expected_version: version,
        location_id: location,
        requested_on: p.requested_on,
        note,
        lines,
      } satisfies OrderPayload;
    }
    case "ship_consignment_order": {
      const order = lowerUuid(p.order_id),
        lines = itemLines(p.lines);
      if (
        !order ||
        !integer(p.expected_version, 1, MAX_CENTS) ||
        !consignmentDate(p.occurred_at) ||
        !lines
      )
        return null;
      return {
        schema_version: 1,
        order_id: order,
        expected_version: p.expected_version,
        occurred_at: p.occurred_at,
        lines,
      } satisfies ShipPayload;
    }
    case "close_consignment_order": {
      const order = lowerUuid(p.order_id),
        reason = cleanText(p.reason, 3, 500);
      if (!order || !integer(p.expected_version, 1, MAX_CENTS) || reason === null) return null;
      return {
        schema_version: 1,
        order_id: order,
        expected_version: p.expected_version,
        reason,
      } satisfies ClosePayload;
    }
    case "return_consignment_stock": {
      const location = lowerUuid(p.location_id),
        reason = cleanText(p.reason, 3, 500),
        lines = itemLines(p.lines);
      if (!location || !consignmentDate(p.occurred_at) || reason === null || !lines) return null;
      return {
        schema_version: 1,
        location_id: location,
        occurred_at: p.occurred_at,
        reason,
        lines,
      } satisfies ReturnPayload;
    }
  }
}

/**
 * Legge un comando del conto vendita: chiavi esatte, UUID minuscoli, righe
 * ordinate e uniche, testi rifilati. Le date future, i mesi ammessi e tutto ciò
 * che dipende dal database restano controlli del database.
 */
export function parseShopCommand(value: unknown): ShopCommand | null {
  const row = record(value),
    p = record(row?.payload),
    operationId = lowerUuid(row?.operationId);
  if (
    !row ||
    !p ||
    !operationId ||
    Object.keys(row).some((k) => !["operationId", "kind", "payload", "retry"].includes(k)) ||
    (row.retry !== undefined && typeof row.retry !== "boolean") ||
    !SHOP_COMMAND_KINDS.includes(row.kind as ShopCommandKind)
  )
    return null;
  const kind = row.kind as ShopCommandKind;
  if (!exact(p, PAYLOAD_KEYS[kind]) || p.schema_version !== 1) return null;
  const payload = parsePayload(kind, p);
  if (!payload) return null;
  return {
    operationId,
    kind,
    payload,
    ...(row.retry === undefined ? {} : { retry: row.retry as boolean }),
  } as ShopCommand;
}

/** Righe toccate da un comando, per riconoscere lo SKU di un rifiuto. */
export function shopCommandItems(command: ShopCommand): string[] {
  return "lines" in command.payload ? command.payload.lines.map((l) => l.stock_item_id) : [];
}

// ---------------------------------------------------------------------------
// Calcolo (docs/consignment.md, «Regole di calcolo»).

export type ShopSplit = {
  unitShopPriceCents: number;
  grossCents: number;
  brandCents: number;
  shopCents: number;
};
/**
 * Una riga del resoconto: prezzo negozio = prezzo sito + maggiorazione; quota
 * LuckyLap arrotondata a metà per eccesso sul totale della riga, come
 * `consignmentSplit` (6000 punti base e 1000 centesimi danno lo stesso
 * risultato). `null` fuori dai limiti o oltre 9e15 centesimi.
 */
export function shopSplit(
  webPriceCents: number,
  quantity: number,
  brandShareBps: number,
  markupCents: number,
): ShopSplit | null {
  if (
    !integer(webPriceCents, 0, MAX_WEB_PRICE_CENTS) ||
    !integer(quantity, 1, MAX_QUANTITY) ||
    !integer(brandShareBps, 0, 10_000) ||
    !integer(markupCents, 0, MAX_MARKUP_CENTS)
  )
    return null;
  const unit = BigInt(webPriceCents) + BigInt(markupCents),
    gross = unit * BigInt(quantity);
  if (gross > BigInt(MAX_CENTS)) return null;
  const brand = (gross * BigInt(brandShareBps) + 5000n) / 10000n;
  return {
    unitShopPriceCents: Number(unit),
    grossCents: Number(gross),
    brandCents: Number(brand),
    shopCents: Number(gross - brand),
  };
}
export type ShopTotals = {
  pieces: number;
  grossCents: number;
  brandCents: number;
  shopCents: number;
};
/** Somma delle righe; `null` se il totale supera 9e15 centesimi. */
export function shopTotals(
  lines: readonly { quantity: number; grossCents: number; brandCents: number; shopCents: number }[],
): ShopTotals | null {
  let pieces = 0n,
    gross = 0n,
    brand = 0n,
    shop = 0n;
  for (const line of lines) {
    pieces += BigInt(line.quantity);
    gross += BigInt(line.grossCents);
    brand += BigInt(line.brandCents);
    shop += BigInt(line.shopCents);
  }
  if (gross > BigInt(MAX_CENTS)) return null;
  return {
    pieces: Number(pieces),
    grossCents: Number(gross),
    brandCents: Number(brand),
    shopCents: Number(shop),
  };
}

/** Stato del pagamento dai pagamenti non annullati, come `private.consignment_refresh_payment_state`. */
export function paymentStateFor(
  paidCents: number | bigint,
  dueCents: number | bigint,
): PaymentState {
  const paid = BigInt(paidCents),
    due = BigInt(dueCents);
  if (paid === 0n) return due === 0n ? "nothing_due" : "unpaid";
  return paid < due ? "partial" : paid === due ? "paid" : "overpaid";
}

// ---------------------------------------------------------------------------
// Mesi a Roma.

/** Mese di Roma «AAAA-MM» dell'istante. */
export function romeMonth(now: Date | string): string {
  const day = localReportDate(new Date(now));
  if (!day) throw new RangeError("Data non valida.");
  return day.slice(0, 7);
}
/** Giorno di Roma «AAAA-MM-GG» dell'istante. */
export function romeToday(now: Date | string): string {
  const day = localReportDate(new Date(now));
  if (!day) throw new RangeError("Data non valida.");
  return day;
}
export function addMonths(month: string, delta: number): string {
  if (!periodMonth(month) || !Number.isSafeInteger(delta)) throw new RangeError("Mese non valido.");
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1 + delta, 1)).toISOString().slice(0, 7);
}
/** Mesi da `from` a `to` compresi, in ordine. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from; month <= to && months.length < 1200; month = addMonths(month, 1))
    months.push(month);
  return months;
}
/**
 * Inizio del mese e del mese successivo a Roma, in UTC. La mezzanotte di Roma
 * non cade mai nel cambio dell'ora.
 */
export function romeMonthBounds(month: string): { month: string; start: string; end: string } {
  if (!periodMonth(month)) throw new RangeError("Mese non valido.");
  const start = romeInputToIso(`${month}-01T00:00`),
    end = romeInputToIso(`${addMonths(month, 1)}-01T00:00`);
  if (!start || !end) throw new RangeError("Mese non valido.");
  return { month, start, end };
}
const monthFormat = new Intl.DateTimeFormat("it-IT", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});
const monthNameFormat = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", month: "long" });
const monthDate = (month: string) => {
  if (!periodMonth(month)) throw new RangeError("Mese non valido.");
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1, 15));
};
/** «ottobre 2026». */
export const monthLabel = (month: string) => monthFormat.format(monthDate(month));
/** «ottobre». */
export const monthName = (month: string) => monthNameFormat.format(monthDate(month));
/** «ottobre» nell'anno di `now`, altrimenti «dicembre 2026». */
export const monthShort = (month: string, now: Date | string) =>
  month.slice(0, 4) === romeMonth(now).slice(0, 4) ? monthName(month) : monthLabel(month);
const dayFormat = new Intl.DateTimeFormat("it-IT", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
});
/** «3 novembre 2026» da «2026-11-03». */
export function dayLabel(day: string): string {
  if (!calendarDay(day)) throw new RangeError("Giorno non valido.");
  return dayFormat.format(new Date(`${day}T12:00:00Z`));
}
const momentFormat = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** «3 nov 2026, 10:12», ora di Roma. */
export function momentLabel(value: string): string {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new RangeError("Data non valida.");
  return momentFormat.format(instant);
}

// ---------------------------------------------------------------------------
// Testi per l'interfaccia. Parole da non usare: vedi docs/consignment.md.

/** Avviso dell'anteprima locale (00-sequenza §1.5). */
export const PREVIEW_NOTICE = "Anteprima locale: dati sintetici, salvataggio disattivato.";

/** 6000 → «60%», 6050 → «60,5%». */
export function bpsLabel(bps: number): string {
  const whole = Math.trunc(bps / 100),
    fraction = String(bps % 100)
      .padStart(2, "0")
      .replace(/0+$/, "");
  return `${whole}${fraction ? `,${fraction}` : ""}%`;
}
/** «60», «60,5», «60.25» → punti base; `null` se non è una percentuale da 0 a 100. */
export function percentToBps(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(value.trim().replace(/%$/, "").trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}
/** 1000 → «10 €», 1050 → «10,50 €». */
export function euroShort(cents: number): string {
  const label = consignmentMoney(cents);
  return cents % 100 === 0 ? label.replace(/,00 €$/, " €") : label;
}
/** «Prezzo sito + 10 € · LuckyLap 60%». */
export const shopTermsLabel = (terms: { markupCents: number; brandShareBps: number }) =>
  `Prezzo sito + ${euroShort(terms.markupCents)} · LuckyLap ${bpsLabel(terms.brandShareBps)}`;
const count = (n: number, one: string, many: string) =>
  `${new Intl.NumberFormat("it-IT").format(n)} ${n === 1 ? one : many}`;
export const tshirtsLabel = (n: number) => count(n, "maglietta", "magliette");
export const piecesLabel = (n: number) => count(n, "pezzo", "pezzi");
export const variantsLabel = (n: number) => count(n, "variante", "varianti");
export const ordersToDeliverLabel = (n: number) => `${count(n, "ordine", "ordini")} da consegnare`;
export const paymentMethodLabel: Record<PaymentMethod, string> = {
  bank_transfer: "Bonifico",
  cash: "Contanti",
  other: "Altro",
};
export const paymentStateLabel: Record<PaymentState, string> = {
  nothing_due: "Niente da incassare",
  unpaid: "Da pagare",
  partial: "Pagata in parte",
  paid: "Pagata",
  overpaid: "Pagata più del dovuto",
};
/** Stato breve di un resoconto, visibile a tutti i membri: prima la fattura, poi il pagamento. */
export function reportStatusLabel(report: {
  brandCents: number;
  invoice: unknown | null;
  paymentState: PaymentState;
}): string {
  if (report.paymentState === "nothing_due") return "Niente da fatturare";
  if (report.invoice === null && report.paymentState === "unpaid") return "Da fatturare";
  return paymentStateLabel[report.paymentState];
}

// ---------------------------------------------------------------------------
// Campi dei moduli.

/** Quantità scritta in una cella: vuota → `empty`; altrimenti 0–100000; `null` se non valida. */
export function quantityField(value: unknown, empty: number | null): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "") return empty;
  if (!/^\d{1,6}$/.test(text)) return null;
  const n = Number(text);
  return n <= MAX_QUANTITY ? n : null;
}
/** Testo facoltativo di un modulo: vuoto → `null`. */
export const optionalField = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

// ---------------------------------------------------------------------------
// Tentativo in sospeso (sessionStorage).

export const shopPendingKey = (userId: string) => `luckylap.consignment.shop.pending:${userId}`;
/** Comando congelato prima dell'invio; lancia se il contenuto non è leggibile. */
export function shopPending(storage: Pick<Storage, "getItem">, userId: string): ShopCommand | null {
  const raw = storage.getItem(shopPendingKey(userId));
  if (!raw) return null;
  if (raw.length > 64000) throw Error("Invio non leggibile.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw Error("Invio non leggibile.");
  }
  const command = parseShopCommand(parsed);
  if (!command) throw Error("Invio non leggibile.");
  return command;
}

export type AttemptSummary = { title: string; lines: string[]; occurredAt?: string };
/**
 * Riepilogo leggibile di un tentativo per `PendingAttempt`: nomi delle
 * magliette, quantità ed euro. Mai UUID, gid o centesimi.
 */
export function shopAttemptSummary(
  command: ShopCommand,
  itemLabel: (itemId: string) => string | null,
): AttemptSummary {
  const label = (id: string) => itemLabel(id) ?? "Maglietta";
  const listed = (lines: readonly { stock_item_id: string; quantity: number }[], verb: string) => {
    const shown = lines.slice(0, 8).map((l) => `${label(l.stock_item_id)} · ${l.quantity} ${verb}`);
    return lines.length > 8 ? [...shown, `e altre ${variantsLabel(lines.length - 8)}`] : shown;
  };
  switch (command.kind) {
    case "save_consignment_shop": {
      const p = command.payload;
      return {
        title:
          p.location_id === null ? "Nuovo negozio da verificare" : "Impostazioni da verificare",
        lines: [
          p.name,
          shopTermsLabel({ markupCents: p.markup_cents, brandShareBps: p.brand_share_bps }),
          p.active ? "Negozio attivo" : "Negozio chiuso",
        ],
      };
    }
    case "count_consignment_stock": {
      const p = command.payload,
        pieces = p.lines.reduce((sum, l) => sum + l.quantity, 0);
      return {
        title: "Conta da verificare",
        lines: [`${tshirtsLabel(pieces)} in ${variantsLabel(p.lines.length)}`],
        occurredAt: p.counted_at,
      };
    }
    case "save_consignment_report": {
      const p = command.payload,
        sold = p.lines.filter((l) => l.quantity > 0);
      return {
        title: `Resoconto di ${monthLabel(p.period_month)} da verificare`,
        lines: [
          ...(sold.length ? listed(sold, "venduti") : ["Nessuna vendita"]),
          ...(p.reason ? [`Motivo: ${p.reason}`] : []),
        ],
      };
    }
    case "set_consignment_invoice": {
      const p = command.payload;
      return {
        title: "Fattura da verificare",
        lines: [
          p.invoice_number === null || p.invoice_date === null
            ? "Fattura tolta dal resoconto"
            : `Fattura n. ${p.invoice_number} del ${dayLabel(p.invoice_date)}`,
        ],
      };
    }
    case "record_consignment_payment":
    case "update_consignment_payment": {
      const p = command.payload,
        voided = command.kind === "update_consignment_payment" && command.payload.voided;
      return {
        title:
          command.kind === "record_consignment_payment"
            ? "Pagamento da verificare"
            : voided
              ? "Annullo del pagamento da verificare"
              : "Modifica del pagamento da verificare",
        lines: [
          `${consignmentMoney(p.amount_cents)} · ${paymentMethodLabel[p.method]}`,
          ...(p.account_label ? [`Conto: ${p.account_label}`] : []),
          ...(command.kind === "update_consignment_payment"
            ? [`Motivo: ${command.payload.reason}`]
            : []),
        ],
        occurredAt: p.paid_at,
      };
    }
    case "save_consignment_order":
      return {
        title:
          command.payload.order_id === null
            ? "Nuovo ordine da verificare"
            : "Modifica dell’ordine da verificare",
        lines: listed(command.payload.lines, "richieste"),
      };
    case "ship_consignment_order":
      return {
        title: "Consegna da verificare",
        lines: listed(command.payload.lines, "consegnate"),
        occurredAt: command.payload.occurred_at,
      };
    case "close_consignment_order":
      return {
        title: "Chiusura dell’ordine da verificare",
        lines: [`Motivo: ${command.payload.reason}`],
      };
    case "return_consignment_stock":
      return {
        title: "Magliette riportate in magazzino: da verificare",
        lines: [...listed(command.payload.lines, "riportate"), `Motivo: ${command.payload.reason}`],
        occurredAt: command.payload.occurred_at,
      };
  }
}
