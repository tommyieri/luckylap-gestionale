export const COMMAND_KINDS = [
  "register_manual_sale",
  "complete_production",
  "fulfill_order_lines",
  "cancel_unfulfilled_lines",
  "record_manual_payment",
] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];
export type SalesCommand = {
  operationId: string;
  kind: CommandKind;
  payload: Record<string, unknown>;
  retry?: boolean;
};
export type CommandResult =
  | { status: "success"; orderId: string; replayed: boolean; message: string }
  | { status: "rejected"; message: string; code: string }
  | { status: "uncertain"; message: string };
export type SalesItem = {
  id: string;
  sku: string;
  name: string;
  active: boolean;
  costCents: number | null;
  priceCents: number | null;
};
export type SalesLocation = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  type: string;
};
export type Availability = {
  itemId: string;
  locationId: string;
  onHand: number | null;
  reserved: number;
  available: number | null;
};
export type SalesSource = "manual_declaration" | "shopify_canonical";
export type SalesLine = {
  id: string;
  orderId: string;
  source: SalesSource;
  itemId: string;
  locationId: string;
  sku: string;
  quantity: number;
  fulfilled: number;
  cancelled: number;
  priceCents: number;
  discountCents: number;
  totalCents: number;
  cancelledCents: number;
  costCents: number | null;
  reserved: number;
};
export type SalesOrder = {
  id: string;
  operationId: string;
  source: SalesSource;
  channel: string;
  reference: string | null;
  occurredAt: string;
  totalCents: number;
  cancelledCents: number;
  refundDueCents: number;
  paymentState: string;
  fulfillmentState: string;
  orderState: string;
  lines: SalesLine[];
};
export type ProductionRequirement = {
  id: string;
  lineId: string;
  required: number;
  completed: number;
  cancelled: number;
  status: string;
};
export type SalesSnapshot = {
  enabled: boolean;
  startedAt: string | null;
  items: SalesItem[];
  locations: SalesLocation[];
  availability: Availability[];
  orders: SalesOrder[];
  requirements: ProductionRequirement[];
};

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
export const safeInteger = (value: unknown, min = 0, max = 9000000000000000): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
export function euroCents(value: unknown, max = 9000000000000000): number | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,13})(?:[,.]\d{1,2})?$/.test(value.trim()))
    return null;
  const [whole, fraction = ""] = value.trim().replace(",", ".").split(".");
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return result <= BigInt(max) ? Number(result) : null;
}
export function money(cents: number | bigint | null) {
  if (cents === null) return "Da verificare";
  const n = BigInt(cents),
    abs = n < 0n ? -n : n;
  return `${n < 0n ? "-" : ""}${new Intl.NumberFormat("it-IT").format(abs / 100n)},${String(abs % 100n).padStart(2, "0")}\u00a0€`;
}
export function moneyInput(cents: number | null) {
  return cents === null
    ? ""
    : `${BigInt(cents) / 100n},${String(BigInt(cents) % 100n).padStart(2, "0")}`;
}
export const quantityLabel = (value: number | null) =>
  value === null ? "Da verificare" : String(value);
export const isExternalSalesOrder = (order: Pick<SalesOrder, "source">) =>
  order.source === "shopify_canonical";
export const salesChannelLabel: Record<string, string> = {
  direct: "Diretta",
  etsy: "Etsy",
  manual_other: "Altro manuale",
  shopify_web: "Shopify · Online",
  shopify_pos: "Shopify POS",
};
export function salesOrderLabel(order: { id: string; reference: string | null }) {
  const gid = /^gid:\/\/shopify\/Order\/([1-9]\d*)$/.exec(order.reference ?? "");
  return gid
    ? `Ordine Shopify ${gid[1]}`
    : order.reference || `Ordine ${order.id.slice(0, 8).toUpperCase()}`;
}

function exactKeys(value: Record<string, unknown>, required: string[], allowed = required) {
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.includes(key))
  );
}
function text(value: unknown, min: number, max: number) {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}
function timestamp(value: unknown, now: Date) {
  if (typeof value !== "string") return false;
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (
    !m ||
    Number(m[2]) < 1 ||
    Number(m[2]) > 12 ||
    Number(m[3]) < 1 ||
    Number(m[3]) > new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate() ||
    Number(m[4]) > 23 ||
    Number(m[5]) > 59 ||
    Number(m[6]) > 59
  )
    return false;
  return Number.isFinite(Date.parse(value)) && Date.parse(value) <= now.getTime();
}

/** Repeat the input boundary on the server. PostgreSQL remains the economic and stock authority. */
export function parseSalesCommand(value: unknown, now = new Date()): SalesCommand | null {
  const input = record(value),
    p = record(input?.payload);
  if (
    !input ||
    !p ||
    !exactKeys(
      input,
      ["operationId", "kind", "payload"],
      ["operationId", "kind", "payload", "retry"],
    ) ||
    !isUuid(input.operationId) ||
    !COMMAND_KINDS.includes(input.kind as CommandKind) ||
    (input.retry !== undefined && typeof input.retry !== "boolean")
  )
    return null;
  const kind = input.kind as CommandKind;
  if (kind === "register_manual_sale") {
    if (
      !exactKeys(
        p,
        [
          "schema_version",
          "channel",
          "occurred_at",
          "location_id",
          "lines",
          "fulfillment_mode",
          "payment",
        ],
        [
          "schema_version",
          "channel",
          "occurred_at",
          "location_id",
          "lines",
          "fulfillment_mode",
          "payment",
          "external_reference",
          "reason",
        ],
      ) ||
      p.schema_version !== 1 ||
      typeof p.channel !== "string" ||
      !["direct", "etsy", "manual_other"].includes(p.channel) ||
      typeof p.fulfillment_mode !== "string" ||
      !["prepare", "delivered_now"].includes(p.fulfillment_mode) ||
      !isUuid(p.location_id) ||
      !timestamp(p.occurred_at, now)
    )
      return null;
    if (
      p.external_reference !== undefined &&
      p.external_reference !== null &&
      !text(p.external_reference, 1, 240)
    )
      return null;
    if (p.channel === "etsy" && !text(p.external_reference, 1, 240)) return null;
    if (p.reason !== undefined && p.reason !== null && !text(p.reason, 3, 500)) return null;
    if (!Array.isArray(p.lines) || p.lines.length < 1 || p.lines.length > 50) return null;
    let total = 0;
    const seen = new Set<string>();
    for (const raw of p.lines) {
      const line = record(raw);
      if (
        !line ||
        !exactKeys(line, ["stock_item_id", "quantity", "unit_price_cents", "discount_cents"]) ||
        !isUuid(line.stock_item_id) ||
        seen.has(line.stock_item_id) ||
        !safeInteger(line.quantity, 1, 100000) ||
        !safeInteger(line.unit_price_cents, 0, 1000000000) ||
        !safeInteger(line.discount_cents, 0, line.quantity * line.unit_price_cents)
      )
        return null;
      seen.add(line.stock_item_id);
      total += line.quantity * line.unit_price_cents - line.discount_cents;
    }
    if (!safeInteger(total)) return null;
    const payment = record(p.payment);
    if (!payment) return null;
    if (payment.status === "unpaid") {
      if (!exactKeys(payment, ["status"])) return null;
    } else if (
      payment.status !== "paid" ||
      !exactKeys(
        payment,
        ["status", "method", "amount_cents", "occurred_at"],
        ["status", "method", "amount_cents", "occurred_at", "reference"],
      ) ||
      typeof payment.method !== "string" ||
      !["cash", "bank_transfer", "external_card", "other"].includes(payment.method) ||
      payment.amount_cents !== total ||
      !timestamp(payment.occurred_at, now) ||
      (payment.reference !== undefined &&
        payment.reference !== null &&
        !text(payment.reference, 1, 240))
    )
      return null;
  } else if (kind === "complete_production") {
    if (
      !exactKeys(p, ["requirement_id", "quantity", "occurred_at", "reason"]) ||
      !isUuid(p.requirement_id) ||
      !safeInteger(p.quantity, 1, 100000) ||
      !timestamp(p.occurred_at, now) ||
      !text(p.reason, 3, 500)
    )
      return null;
  } else if (kind === "record_manual_payment") {
    if (
      !exactKeys(
        p,
        ["order_id", "amount_cents", "method", "occurred_at"],
        ["order_id", "amount_cents", "method", "occurred_at", "reference"],
      ) ||
      !isUuid(p.order_id) ||
      !safeInteger(p.amount_cents) ||
      typeof p.method !== "string" ||
      !["cash", "bank_transfer", "external_card", "other"].includes(p.method) ||
      !timestamp(p.occurred_at, now) ||
      (p.reference !== undefined && p.reference !== null && !text(p.reference, 1, 240))
    )
      return null;
  } else {
    if (
      !exactKeys(p, ["order_id", "lines", "occurred_at", "reason"]) ||
      !isUuid(p.order_id) ||
      !timestamp(p.occurred_at, now) ||
      !text(p.reason, 3, 500) ||
      !Array.isArray(p.lines) ||
      p.lines.length < 1 ||
      p.lines.length > 50
    )
      return null;
    const seen = new Set<string>();
    for (const raw of p.lines) {
      const line = record(raw);
      if (
        !line ||
        !exactKeys(line, ["order_line_id", "quantity"]) ||
        !isUuid(line.order_line_id) ||
        seen.has(line.order_line_id) ||
        !safeInteger(line.quantity, 1, 100000)
      )
        return null;
      seen.add(line.order_line_id);
    }
  }
  return { operationId: input.operationId, kind, payload: p, retry: input.retry === true };
}

const romeFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
export function romeTimeInput(value: Date | string) {
  const parts = Object.fromEntries(
    romeFormatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
/** Reject DST gaps and ambiguous local times instead of guessing the device zone. */
export function romeInputToIso(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value))
    return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const base = Date.parse(`${normalized}Z`);
  if (!Number.isFinite(base)) return null;
  const offsets = new Set(
    [-86400000, 0, 86400000].map(
      (delta) => Date.parse(`${romeTimeInput(new Date(base + delta))}Z`) - (base + delta),
    ),
  );
  const matches = [...offsets]
    .map((offset) => new Date(base - offset))
    .filter((candidate) => romeTimeInput(candidate) === normalized);
  return matches.length === 1 ? matches[0].toISOString() : null;
}
