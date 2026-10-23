import {
  euroCents,
  isUuid,
  record,
  safeInteger,
  type SalesSnapshot,
  type SalesOrder,
  type SalesLine,
} from "./model";

type PageResult = { data: unknown[] | null; count: number | null; error: unknown };
function fail(): never {
  throw new Error("Lettura vendite non completa. Ricarica la pagina.");
}
export async function readSalesPages(
  read: (from: number, to: number) => PromiseLike<PageResult>,
  size = 200,
): Promise<unknown[]> {
  if (!Number.isInteger(size) || size < 1 || size > 1000) fail();
  const rows: unknown[] = [];
  let expected: number | null = null;
  do {
    const page = await read(rows.length, rows.length + size - 1);
    if (
      page.error ||
      !Array.isArray(page.data) ||
      !safeInteger(page.count, 0, 100000) ||
      (expected !== null && expected !== page.count)
    )
      fail();
    expected = page.count;
    if (page.data!.length !== Math.min(size, expected! - rows.length)) fail();
    rows.push(...page.data!);
  } while (rows.length < expected!);
  return rows;
}

export type SalesRows = {
  settings: unknown[];
  items: unknown[];
  variants: unknown[];
  locations: unknown[];
  availability: unknown[];
  orders: unknown[];
  lines: unknown[];
  reservations: unknown[];
  requirements: unknown[];
};
const obj = (v: unknown) => record(v) ?? fail();
const id = (v: unknown) => (isUuid(v) ? v : fail());
const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : fail());
const int = (v: unknown) => (safeInteger(v) ? v : fail());
const maybeInt = (v: unknown) => (v === null ? null : int(v));
const choice = (v: unknown, values: string[]) =>
  typeof v === "string" && values.includes(v) ? v : fail();
const bool = (v: unknown) => (typeof v === "boolean" ? v : fail());
const date = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : fail());
const cents = (v: unknown) =>
  v === null ? null : (euroCents(typeof v === "number" ? String(v) : v) ?? fail());
function unique(values: string[]) {
  if (new Set(values).size !== values.length) fail();
}

/** Cross-check related projections; refuse an incomplete/concurrently inconsistent read. */
export function salesSnapshotFromRows(rows: SalesRows): SalesSnapshot {
  if (rows.settings.length !== 1) fail();
  const settings = obj(rows.settings[0]);
  const enabled = bool(settings.manual_sales_enabled),
    startedAt = settings.sales_started_at === null ? null : date(settings.sales_started_at);
  if (enabled && !startedAt) fail();
  const variants = rows.variants.map((raw) => {
    const r = obj(raw);
    return { itemId: id(r.stock_item_id), color: str(r.color), size: str(r.size) };
  });
  unique(variants.map((r) => r.itemId));
  const items = rows.items.map((raw) => {
    const r = obj(raw);
    const variant = variants.find((v) => v.itemId === r.id);
    if (!variant) fail();
    const name = str(r.name),
      suffix = ` · ${variant.color} · ${variant.size}`;
    return {
      id: id(r.id),
      sku: str(r.sku),
      name: name.endsWith(suffix) ? name : `${name}${suffix}`,
      active: bool(r.active),
      costCents: cents(r.unit_cost_eur),
      priceCents: cents(r.list_price_eur),
    };
  });
  const allLocations = rows.locations.map((raw) => {
    const r = obj(raw);
    return {
      id: id(r.id),
      code: str(r.code),
      name: str(r.name),
      active: bool(r.active),
      type: str(r.location_type),
    };
  });
  unique(items.map((r) => r.id));
  unique(allLocations.map((r) => r.id));
  const locations = allLocations.filter((row) =>
      ["Magazzino", "Negozio Conto Vendita"].includes(row.type),
    ),
    allLocationIds = new Set(allLocations.map((row) => row.id));
  if (!items.length || !locations.length) fail();
  const itemIds = new Set(items.map((r) => r.id)),
    locationIds = new Set(locations.map((r) => r.id));
  // The shared stock view also contains packaging; this module totals products.
  const productAvailability = rows.availability
    .map((raw) => {
      const r = obj(raw);
      return {
        itemId: id(r.stock_item_id),
        locationId: id(r.location_id),
        onHand: maybeInt(r.on_hand),
        reserved: int(r.reserved),
        available: maybeInt(r.available),
      };
    })
    .filter((row) => itemIds.has(row.itemId));
  if (productAvailability.some((row) => !allLocationIds.has(row.locationId))) fail();
  const availability = productAvailability.filter((row) => locationIds.has(row.locationId));
  unique(availability.map((r) => `${r.itemId}:${r.locationId}`));
  for (const r of availability)
    if (
      !itemIds.has(r.itemId) ||
      !locationIds.has(r.locationId) ||
      (r.onHand === null
        ? r.available !== null || r.reserved !== 0
        : r.onHand - r.reserved !== r.available)
    )
      fail();
  const orders: SalesOrder[] = rows.orders.map((raw) => {
    const r = obj(raw),
      source = choice(r.source_kind, [
        "manual_declaration",
        "shopify_canonical",
      ]) as SalesOrder["source"];
    return {
      id: id(r.id),
      operationId: id(r.operation_id),
      source,
      channel: choice(
        r.channel,
        source === "shopify_canonical"
          ? ["shopify_web", "shopify_pos"]
          : ["direct", "etsy", "manual_other"],
      ),
      reference: r.external_reference === null ? null : str(r.external_reference),
      occurredAt: date(r.occurred_at),
      totalCents: int(r.total_cents),
      cancelledCents: int(r.cancelled_cents),
      refundDueCents: int(r.refund_due_cents),
      paymentState: choice(
        r.payment_state,
        source === "shopify_canonical"
          ? ["unpaid", "partially_paid", "paid", "partially_refunded", "refunded"]
          : ["paid", "unpaid", "partially_paid", "partially_refunded", "refunded"],
      ),
      fulfillmentState: choice(r.fulfillment_state, [
        "unfulfilled",
        "partial",
        "fulfilled",
        "cancelled",
        "partially_returned",
        "returned",
      ]),
      orderState: choice(r.order_state, [
        "confirmed",
        "partially_cancelled",
        "cancelled",
        "partially_returned",
        "returned",
      ]),
      lines: [],
    };
  });
  unique(orders.map((r) => r.id));
  unique(orders.map((r) => r.operationId));
  const lines: SalesLine[] = rows.lines.map((raw) => {
    const r = obj(raw);
    return {
      id: id(r.id),
      orderId: id(r.order_id),
      source: choice(r.source_kind, [
        "manual_declaration",
        "shopify_canonical",
      ]) as SalesLine["source"],
      itemId: id(r.stock_item_id),
      locationId: id(r.location_id),
      sku: str(r.sku_snapshot),
      quantity: int(r.quantity),
      fulfilled: int(r.fulfilled_quantity),
      cancelled: int(r.cancelled_quantity),
      priceCents: int(r.unit_price_cents),
      discountCents: int(r.discount_cents),
      totalCents: int(r.line_total_cents),
      cancelledCents: int(r.cancelled_amount_cents),
      costCents: maybeInt(r.unit_cost_cents),
      reserved: 0,
    };
  });
  unique(lines.map((r) => r.id));
  for (const line of lines) {
    const order = orders.find((r) => r.id === line.orderId);
    if (
      !order ||
      order.source !== line.source ||
      !itemIds.has(line.itemId) ||
      !locationIds.has(line.locationId) ||
      line.quantity < 1 ||
      line.fulfilled + line.cancelled > line.quantity ||
      BigInt(line.priceCents) * BigInt(line.quantity) - BigInt(line.discountCents) !==
        BigInt(line.totalCents) ||
      line.cancelledCents > line.totalCents
    )
      fail();
    order.lines.push(line);
  }
  const reservations = rows.reservations.map((raw) => {
    const r = obj(raw);
    return {
      lineId: id(r.order_line_id),
      itemId: id(r.stock_item_id),
      locationId: id(r.location_id),
      quantity: int(r.reserved_quantity),
    };
  });
  unique(reservations.map((r) => r.lineId));
  for (const r of reservations) {
    const line = lines.find((l) => l.id === r.lineId);
    if (
      !line ||
      line.itemId !== r.itemId ||
      line.locationId !== r.locationId ||
      r.quantity > line.quantity - line.fulfilled - line.cancelled
    )
      fail();
    line.reserved = r.quantity;
  }
  for (const a of availability)
    if (
      reservations
        .filter((r) => r.itemId === a.itemId && r.locationId === a.locationId)
        .reduce((sum, r) => sum + r.quantity, 0) !== a.reserved
    )
      fail();
  const requirements = rows.requirements.map((raw) => {
    const r = obj(raw);
    return {
      id: id(r.id),
      lineId: id(r.order_line_id),
      required: int(r.required_quantity),
      completed: int(r.completed_quantity),
      cancelled: int(r.cancelled_quantity),
      status: choice(r.status, ["to_plan", "partially_ready", "satisfied", "cancelled"]),
    };
  });
  unique(requirements.map((r) => r.id));
  unique(requirements.map((r) => r.lineId));
  for (const r of requirements)
    if (
      !lines.some((l) => l.id === r.lineId) ||
      r.required < 1 ||
      r.completed + r.cancelled > r.required
    )
      fail();
  for (const line of lines) {
    const requirement = requirements.find((r) => r.lineId === line.id);
    const deficit = requirement
      ? requirement.required - requirement.completed - requirement.cancelled
      : 0;
    if (line.reserved + deficit !== line.quantity - line.fulfilled - line.cancelled) fail();
  }
  for (const order of orders)
    if (
      !order.lines.length ||
      order.cancelledCents > order.totalCents ||
      (order.source === "manual_declaration" &&
        (order.lines.reduce((sum, l) => sum + BigInt(l.totalCents), 0n) !==
          BigInt(order.totalCents) ||
          order.lines.reduce((sum, l) => sum + BigInt(l.cancelledCents), 0n) !==
            BigInt(order.cancelledCents)))
    )
      fail();
  orders.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return { enabled, startedAt, items, locations, availability, orders, requirements };
}
