import { stockRecord as record, stockUuid as uuid, type StockAvailability } from "../stock/model";
import { orderInventoryItems } from "../inventory-order";
import type { InventoryItem } from "../types";
import { consignmentAmount, consignmentDate, consignmentMoney, MAX_CENTS } from "./model";
import type { CatalogPrice } from "./model";
import {
  MAX_LINES,
  PAYMENT_METHODS,
  PAYMENT_STATES,
  SIZES,
  addMonths,
  bpsLabel,
  calendarDay,
  dayLabel,
  monthLabel,
  monthShort,
  monthsBetween,
  momentLabel,
  ordersToDeliverLabel,
  paymentStateFor,
  paymentFinanceFromDatabase,
  postedShopPaymentCents,
  paymentStateLabel,
  reportStatusLabel,
  romeMonth,
  romeMonthBounds,
  shopSplit,
  shopTotals,
  tshirtsLabel,
  type CountLine,
  type ItemLine,
  type OrderStatus,
  type PaymentMethod,
  type PaymentState,
  type PaymentFinanceMetadata,
  type ReportLine,
  type ShopTotals,
} from "./shop-model";
import { consignmentCountHref, consignmentOrderHref, consignmentShopHref } from "./links";
import { localReportDate } from "../finance/model";

/*
 * Letture pure del conto vendita: righe del database → istantanee per le pagine.
 * Una riga incompleta, orfana o una lettura troncata fa fallire tutto, come
 * `consignmentFromRows`: meglio nessun numero che numeri sbagliati.
 */

function fail(): never {
  throw Error("Lettura conto vendita non completa. Ricarica la pagina.");
}
const obj = (v: unknown) => record(v) ?? fail(),
  id = (v: unknown) => (uuid(v) ? v.toLowerCase() : fail()),
  str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : fail()),
  text = (v: unknown) => (typeof v === "string" ? v : fail()),
  bool = (v: unknown) => (typeof v === "boolean" ? v : fail()),
  date = (v: unknown) => (consignmentDate(v) ? v : fail()),
  day = (v: unknown) => (calendarDay(v) ? v : fail());
const int = (v: unknown, min = 0, max = MAX_CENTS) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail();
const nullable = <T>(v: unknown, parse: (v: unknown) => T): T | null =>
  v === null ? null : parse(v);
const unique = (values: string[]) => {
  if (new Set(values).size !== values.length) fail();
};
const byTimeDesc = (a: string, b: string) => Date.parse(b) - Date.parse(a);
/** Testo libero lungo al massimo `max` caratteri (come `char_length`). */
const note = (v: unknown, max: number) => {
  const value = text(v);
  return Array.from(value).length <= max ? value : fail();
};

export const SHOP_TYPE = "Negozio Conto Vendita";
export const WAREHOUSE_TYPE = "Magazzino";

export type ShopSettings = {
  stockEnabled: boolean;
  salesEnabled: boolean;
  startedAt: string | null;
};
export type ShopLocation = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  type: string;
};
export type ShopConfig = {
  locationId: string;
  code: string;
  name: string;
  active: boolean;
  supply: ShopLocation | null;
  brandShareBps: number;
  markupCents: number;
  /** `null` finché il negozio non è mai stato contato: la griglia mostra «—». */
  firstCountedAt: string | null;
  note: string;
  version: number;
  /** Riga creata dalla migrazione per un negozio già esistente. */
  migrated: boolean;
  createdAt: string;
};
export type ShopItem = {
  id: string;
  sku: string;
  name: string;
  model: string;
  color: string;
  size: string;
  active: boolean;
  costCents: number | null;
  catalog: CatalogPrice | null;
  /** «GT3RS Blu M». */
  label: string;
};
export type ShopCount = {
  id: string;
  countedAt: string;
  fullCount: boolean;
  pieces: number;
  note: string;
  author: string;
};
export type ShopReportLine = {
  id: string;
  itemId: string;
  sku: string;
  quantity: number;
  beforeCountQuantity: number;
  shopDomain: string;
  variantGid: string;
  catalogObservedAt: string;
  webPriceCents: number;
  markupCents: number;
  brandShareBps: number;
  unitShopPriceCents: number;
  grossCents: number;
  brandCents: number;
  shopCents: number;
  costCents: number | null;
  pricedAt: string;
};
export type ShopRevision = {
  id: string;
  revision: number;
  kind: "lines" | "invoice";
  reason: string | null;
  createdAt: string;
  author: string;
  pieces: number;
  brandCents: number;
  invoiceNumber: string | null;
};
export type ShopInvoice = { number: string; date: string; revision: number };
export type ShopReport = {
  id: string;
  month: string;
  revision: number;
  brandShareBps: number;
  markupCents: number;
  pieces: number;
  grossCents: number;
  brandCents: number;
  shopCents: number;
  invoice: ShopInvoice | null;
  paymentState: PaymentState;
  createdAt: string;
  updatedAt: string;
  lines: ShopReportLine[];
  /** Dalla prima all'ultima. */
  revisions: ShopRevision[];
};
export type ShopOrderLine = {
  id: string;
  itemId: string;
  quantity: number;
  delivered: number;
  cancelled: number;
  remaining: number;
};
export type ShopOrder = {
  id: string;
  number: number;
  requestedOn: string;
  note: string;
  status: OrderStatus;
  closeReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  author: string;
  lines: ShopOrderLine[];
};
export type ShopShipment = {
  id: string;
  direction: "to_shop" | "to_warehouse";
  orderId: string | null;
  occurredAt: string;
  reason: string;
  pieces: number;
  author: string;
};
export type ShopPaymentRevision = {
  id: string;
  version: number;
  reason: string | null;
  createdAt: string;
  author: string;
  amountCents: number;
  paidAt: string;
  method: PaymentMethod;
  voided: boolean;
  finance?: PaymentFinanceMetadata;
  accountLabel?: string | null;
  reference?: string | null;
};
export type ShopPayment = {
  id: string;
  reportId: string;
  amountCents: number;
  paidAt: string;
  method: PaymentMethod;
  accountLabel: string | null;
  reference: string | null;
  voided: boolean;
  finance?: PaymentFinanceMetadata;
  version: number;
  /** Dalla prima all'ultima. */
  revisions: ShopPaymentRevision[];
};
export type ShopPage = {
  loadedAt: string;
  settings: ShopSettings;
  shop: ShopConfig;
  /** Magazzini attivi, per scegliere quello di partenza. */
  warehouses: ShopLocation[];
  /** T-shirt nell'ordine del Magazzino (modello, colore, taglia). */
  items: ShopItem[];
  /** Saldo del negozio così com'è nel database (`null` = nessun saldo noto). */
  shopStock: Record<string, number | null>;
  /** Disponibilità del magazzino di partenza. */
  supplyStock: Record<string, StockAvailability>;
  counts: ShopCount[];
  reports: ShopReport[];
  orders: ShopOrder[];
  shipments: ShopShipment[];
  /** `null` senza Finance aperta: gli importi pagati sono riservati. */
  payments: ShopPayment[] | null;
};

export function shopSettingsFrom(raw: unknown): ShopSettings {
  const s = obj(raw),
    settings = {
      stockEnabled: bool(s.stock_adjustments_enabled),
      salesEnabled: bool(s.manual_sales_enabled),
      startedAt: nullable(s.sales_started_at, date),
    };
  if (settings.salesEnabled && !settings.startedAt) fail();
  return settings;
}
export function shopLocationsFrom(rows: unknown[]): ShopLocation[] {
  const locations = rows.map((v) => {
    const r = obj(v);
    return {
      id: id(r.id),
      code: str(r.code),
      name: str(r.name),
      active: bool(r.active),
      type: str(r.location_type),
    };
  });
  unique(locations.map((l) => l.id));
  unique(locations.map((l) => l.code));
  return locations;
}
export function shopConfigFrom(raw: unknown, locations: ShopLocation[]): ShopConfig {
  const r = obj(raw),
    location = locations.find((l) => l.id === id(r.location_id)) ?? fail(),
    supplyId = nullable(r.supply_location_id, id),
    supply = supplyId === null ? null : (locations.find((l) => l.id === supplyId) ?? fail());
  if (location.type !== SHOP_TYPE || (supply && supply.type !== WAREHOUSE_TYPE)) fail();
  return {
    locationId: location.id,
    code: location.code,
    name: location.name,
    active: location.active,
    supply,
    brandShareBps: int(r.brand_share_bps, 0, 10_000),
    markupCents: int(r.markup_cents, 0, 100_000_000),
    firstCountedAt: nullable(r.first_counted_at, date),
    note: note(r.note, 1000),
    version: int(r.version, 1),
    migrated: nullable(r.created_by, id) === null,
    createdAt: date(r.created_at),
  };
}

/** Primo mese che il negozio deve rendicontare: avvio delle vendite, o creazione del negozio se successiva. */
export function shopStartMonth(shop: ShopConfig, settings: ShopSettings): string | null {
  if (!settings.startedAt) return null;
  const sales = romeMonth(settings.startedAt),
    created = romeMonth(shop.createdAt);
  return shop.migrated || created < sales ? sales : created;
}
/** Mese ammesso dal database: dall'avvio delle vendite al mese corrente, a Roma. */
export function reportMonthAllowed(settings: ShopSettings, month: string, now: Date | string) {
  return (
    settings.startedAt !== null && month >= romeMonth(settings.startedAt) && month <= romeMonth(now)
  );
}

// ---------------------------------------------------------------------------
// Elenco dei negozi.

export type ShopListRows = {
  settings: unknown;
  shops: unknown[];
  locations: unknown[];
  /** `operational_stock_availability` delle sedi dei negozi. */
  availability: unknown[];
  reports: unknown[];
  /** Solo gli ordini aperti. */
  openOrders: unknown[];
};
export type ShopListRow = {
  locationId: string;
  code: string;
  name: string;
  active: boolean;
  brandShareBps: number;
  markupCents: number;
  /** `null` = da contare. */
  pieces: number | null;
  lastReport: { month: string; pieces: number; status: string } | null;
  /** Mesi finiti senza resoconto, dal più vecchio. Vuoto finché il negozio non è contato. */
  missingMonths: string[];
  openOrders: number;
  href: string;
};
export type ShopList = {
  loadedAt: string;
  settings: ShopSettings;
  shops: ShopListRow[];
  closed: ShopListRow[];
};
export type ReportHead = {
  id: string;
  locationId: string;
  month: string;
  revision: number;
  pieces: number;
  grossCents: number;
  brandCents: number;
  shopCents: number;
  invoice: ShopInvoice | null;
  paymentState: PaymentState;
};
/** Testata di un resoconto: totali coerenti, fattura completa o assente, stato del pagamento ammesso. */
export function reportHeadFrom(raw: unknown): ReportHead & { raw: Record<string, unknown> } {
  const r = obj(raw),
    period = day(r.period_month);
  if (!period.endsWith("-01")) fail();
  const head = {
    raw: r,
    id: id(r.id),
    locationId: id(r.location_id),
    month: period.slice(0, 7),
    revision: int(r.revision, 1, 100_000),
    pieces: int(r.pieces),
    grossCents: int(r.gross_cents),
    brandCents: int(r.brand_cents),
    shopCents: int(r.shop_cents),
    invoice:
      r.invoice_number === null && r.invoice_date === null && r.invoice_revision === null
        ? null
        : {
            number: str(r.invoice_number),
            date: day(r.invoice_date),
            revision: int(r.invoice_revision, 1, 100_000),
          },
    paymentState: PAYMENT_STATES.includes(r.payment_state as PaymentState)
      ? (r.payment_state as PaymentState)
      : fail(),
  };
  if (
    BigInt(head.brandCents) + BigInt(head.shopCents) !== BigInt(head.grossCents) ||
    (head.invoice && head.invoice.revision > head.revision) ||
    (head.brandCents === 0 && !["nothing_due", "overpaid", "unpaid"].includes(head.paymentState)) ||
    (head.brandCents > 0 && head.paymentState === "nothing_due")
  )
    fail();
  return head;
}

export function shopsFromRows(
  rows: ShopListRows,
  now: Date | string = new Date(),
  loadedAt = new Date().toISOString(),
): ShopList {
  const settings = shopSettingsFrom(rows.settings),
    locations = shopLocationsFrom(rows.locations),
    shops = rows.shops.map((raw) => shopConfigFrom(raw, locations));
  unique(shops.map((s) => s.locationId));
  const shopIds = new Set(shops.map((s) => s.locationId));
  const pieces = new Map<string, number>();
  const seen = new Set<string>();
  for (const raw of rows.availability) {
    const r = obj(raw),
      location = id(r.location_id),
      key = `${id(r.stock_item_id)}:${location}`;
    if (!shopIds.has(location) || seen.has(key)) fail();
    seen.add(key);
    const onHand = nullable(r.on_hand, (v) => int(v));
    if (onHand !== null) pieces.set(location, (pieces.get(location) ?? 0) + onHand);
  }
  const reports = rows.reports.map(reportHeadFrom);
  unique(reports.map((r) => r.id));
  unique(reports.map((r) => `${r.locationId}:${r.month}`));
  for (const r of reports) if (!shopIds.has(r.locationId)) fail();
  const openOrders = new Map<string, number>();
  const orderIds: string[] = [];
  for (const raw of rows.openOrders) {
    const r = obj(raw),
      location = id(r.location_id);
    orderIds.push(id(r.id));
    int(r.order_number, 1, 1_000_000);
    if (!shopIds.has(location) || r.status !== "open") fail();
    openOrders.set(location, (openOrders.get(location) ?? 0) + 1);
  }
  unique(orderIds);
  const current = romeMonth(now);
  const list = shops
    .map((shop): ShopListRow => {
      const own = reports
          .filter((r) => r.locationId === shop.locationId)
          .sort((a, b) => (a.month < b.month ? 1 : -1)),
        last = own[0] ?? null,
        start = shopStartMonth(shop, settings),
        counted = shop.firstCountedAt !== null;
      return {
        locationId: shop.locationId,
        code: shop.code,
        name: shop.name,
        active: shop.active,
        brandShareBps: shop.brandShareBps,
        markupCents: shop.markupCents,
        pieces: counted ? (pieces.get(shop.locationId) ?? 0) : null,
        lastReport: last
          ? {
              month: last.month,
              pieces: last.pieces,
              status: reportStatusLabel(last),
            }
          : null,
        missingMonths:
          counted && start
            ? monthsBetween(start, addMonths(current, -1)).filter(
                (m) => !own.some((r) => r.month === m),
              )
            : [],
        openOrders: openOrders.get(shop.locationId) ?? 0,
        href: consignmentShopHref(shop.code),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "it") || a.code.localeCompare(b.code));
  return {
    loadedAt,
    settings,
    shops: list.filter((s) => s.active),
    closed: list.filter((s) => !s.active),
  };
}

// ---------------------------------------------------------------------------
// Pagina del negozio.

export type ShopPageRows = {
  settings: unknown;
  locations: unknown[];
  /** La riga di `consignment_shops`. */
  shop: unknown;
  items: unknown[];
  variants: unknown[];
  products: unknown[];
  /** Varianti Shopify attive collegate a un articolo. */
  catalog: unknown[];
  /** `operational_stock_availability` del negozio e del magazzino di partenza. */
  availability: unknown[];
  counts: unknown[];
  reports: unknown[];
  reportLines: unknown[];
  reportRevisions: unknown[];
  orders: unknown[];
  orderLines: unknown[];
  shipments: unknown[];
  profiles: unknown[];
  payments: unknown[] | null;
  paymentRevisions: unknown[] | null;
};

const fillerItem = (item: Omit<ShopItem, "label" | "catalog" | "costCents">): InventoryItem => ({
  id: item.id,
  sku: item.sku,
  model: item.model,
  category: "T-shirt",
  color: item.color,
  size: item.size,
  centralQuantity: null,
  consignmentQuantity: null,
  totalQuantity: null,
  targetQuantity: null,
  unitCost: null,
  webPrice: null,
  active: item.active,
  sourceCell: "",
});

function itemsFrom(rows: ShopPageRows): ShopItem[] {
  const products = new Map<string, { model: string; category: string }>();
  for (const raw of rows.products) {
    const r = obj(raw),
      key = id(r.id);
    if (products.has(key)) fail();
    products.set(key, { model: str(r.model), category: str(r.category) });
  }
  const variants = new Map<string, { productId: string; color: string; size: string }>();
  for (const raw of rows.variants) {
    const r = obj(raw),
      key = id(r.stock_item_id);
    if (variants.has(key)) fail();
    variants.set(key, { productId: id(r.product_id), color: str(r.color), size: str(r.size) });
  }
  const catalog = rows.catalog.map((raw) => {
    const r = obj(raw);
    if (typeof r.product_type !== "string") fail();
    return {
      itemId: id(r.stock_item_id),
      sku: str(r.sku),
      shopDomain: str(r.shop_domain),
      variantGid: str(r.variant_gid),
      priceCents: int(r.price_cents, 0, 99_999_999_999_999),
      observedAt: date(r.observed_at),
      status: str(r.status),
      currency: str(r.currency_code),
      productType: r.product_type,
    };
  });
  unique(catalog.map((c) => `${c.shopDomain}:${c.variantGid}`));
  const items: ShopItem[] = [];
  const seenSku = new Set<string>();
  for (const raw of rows.items) {
    const r = obj(raw),
      itemId = id(r.id),
      variant = variants.get(itemId) ?? fail(),
      product = products.get(variant.productId) ?? fail(),
      sku = str(r.sku);
    if (r.kind !== "product" || seenSku.has(sku)) fail();
    seenSku.add(sku);
    if (product.category !== "T-shirt") continue;
    const matches = catalog.filter(
      (c) =>
        c.itemId === itemId &&
        c.sku === sku &&
        c.status === "ACTIVE" &&
        c.currency === "EUR" &&
        c.productType === "T-shirt",
    );
    items.push({
      id: itemId,
      sku,
      name: str(r.name),
      model: product.model,
      color: variant.color,
      size: variant.size,
      active: bool(r.active),
      costCents:
        r.unit_cost_eur === null ? null : (consignmentAmount(String(r.unit_cost_eur)) ?? fail()),
      catalog:
        matches.length === 1
          ? {
              shopDomain: matches[0].shopDomain,
              variantGid: matches[0].variantGid,
              priceCents: matches[0].priceCents,
              observedAt: matches[0].observedAt,
            }
          : null,
      label: `${product.model} ${variant.color} ${variant.size}`,
    });
  }
  unique(items.map((i) => i.id));
  const order = orderInventoryItems(items.map(fillerItem)).map((i) => i.id);
  return order.map((itemId) => items.find((i) => i.id === itemId)!);
}

export function shopPageFromRows(
  rows: ShopPageRows,
  loadedAt = new Date().toISOString(),
): ShopPage {
  const settings = shopSettingsFrom(rows.settings),
    locations = shopLocationsFrom(rows.locations),
    shop = shopConfigFrom(rows.shop, locations),
    items = itemsFrom(rows),
    itemIds = new Set(items.map((i) => i.id)),
    shopId = shop.locationId,
    supplyId = shop.supply?.id ?? null;
  const names = new Map<string, string>();
  for (const raw of rows.profiles) {
    const r = obj(raw);
    names.set(id(r.user_id), text(r.display_name).trim() || "Un membro del team");
  }
  const author = (v: unknown) => names.get(id(v)) ?? "Un membro del team";
  const ofShop = (v: unknown) => {
    if (id(v) !== shopId) fail();
  };

  const shopStock: Record<string, number | null> = {};
  const supplyStock: Record<string, StockAvailability> = {};
  for (const item of items) {
    shopStock[item.id] = null;
    if (supplyId)
      supplyStock[item.id] = {
        itemId: item.id,
        locationId: supplyId,
        onHand: null,
        reserved: 0,
        available: null,
      };
  }
  const seen = new Set<string>();
  for (const raw of rows.availability) {
    const r = obj(raw),
      itemId = id(r.stock_item_id),
      location = id(r.location_id),
      onHand = nullable(r.on_hand, (v) => int(v)),
      reserved = int(r.reserved),
      available = nullable(r.available, (v) => int(v, -MAX_CENTS));
    if (location !== shopId && location !== supplyId) fail();
    if (seen.has(`${itemId}:${location}`)) fail();
    seen.add(`${itemId}:${location}`);
    if (
      onHand === null
        ? available !== null || reserved !== 0
        : BigInt(onHand) - BigInt(reserved) !== BigInt(available ?? fail())
    )
      fail();
    if (!itemIds.has(itemId)) continue;
    if (location === shopId) shopStock[itemId] = onHand;
    else supplyStock[itemId] = { itemId, locationId: location, onHand, reserved, available };
  }

  const counts = rows.counts.map((raw): ShopCount => {
    const r = obj(raw);
    ofShop(r.location_id);
    return {
      id: id(r.id),
      countedAt: date(r.counted_at),
      fullCount: bool(r.full_count),
      pieces: int(r.pieces),
      note: note(r.note, 500),
      author: author(r.created_by),
    };
  });
  unique(counts.map((c) => c.id));
  if (shop.firstCountedAt === null ? counts.length > 0 : counts.length === 0) fail();

  const reportHeads = rows.reports.map(reportHeadFrom);
  unique(reportHeads.map((r) => r.id));
  unique(reportHeads.map((r) => r.month));
  const linesByReport = new Map<string, ShopReportLine[]>(reportHeads.map((r) => [r.id, []]));
  const lineIds: string[] = [];
  for (const raw of rows.reportLines) {
    const r = obj(raw);
    ofShop(r.location_id);
    const head = reportHeads.find((h) => h.id === id(r.report_id)) ?? fail(),
      line: ShopReportLine = {
        id: id(r.id),
        itemId: id(r.stock_item_id),
        sku: str(r.sku_snapshot),
        quantity: int(r.quantity, 1, 100_000),
        beforeCountQuantity: int(r.before_count_quantity),
        shopDomain: str(r.shop_domain),
        variantGid: str(r.variant_gid),
        catalogObservedAt: date(r.catalog_observed_at),
        webPriceCents: int(r.web_price_cents, 0, 99_999_999_999_999),
        markupCents: int(r.markup_cents, 0, 100_000_000),
        brandShareBps: int(r.brand_share_bps, 0, 10_000),
        unitShopPriceCents: int(r.unit_shop_price_cents),
        grossCents: int(r.gross_cents),
        brandCents: int(r.brand_cents),
        shopCents: int(r.shop_cents),
        costCents: nullable(r.unit_cost_cents, (v) => int(v)),
        pricedAt: date(r.priced_at),
      },
      split = shopSplit(line.webPriceCents, line.quantity, line.brandShareBps, line.markupCents);
    if (
      !itemIds.has(line.itemId) ||
      line.beforeCountQuantity > line.quantity ||
      line.brandShareBps !== int(head.raw.brand_share_bps, 0, 10_000) ||
      line.markupCents !== int(head.raw.markup_cents, 0, 100_000_000) ||
      !split ||
      split.unitShopPriceCents !== line.unitShopPriceCents ||
      split.grossCents !== line.grossCents ||
      split.brandCents !== line.brandCents ||
      split.shopCents !== line.shopCents
    )
      fail();
    lineIds.push(line.id);
    linesByReport.get(head.id)!.push(line);
  }
  unique(lineIds);
  const revisionsByReport = new Map<string, ShopRevision[]>(reportHeads.map((r) => [r.id, []]));
  const revisionIds: string[] = [];
  for (const raw of rows.reportRevisions) {
    const r = obj(raw);
    ofShop(r.location_id);
    const snapshot = obj(r.snapshot),
      invoice = nullable(snapshot.invoice, obj),
      revision: ShopRevision = {
        id: id(r.id),
        revision: int(r.revision, 1, 100_000),
        kind: r.change_kind === "lines" || r.change_kind === "invoice" ? r.change_kind : fail(),
        reason: nullable(r.reason, str),
        createdAt: date(r.created_at),
        author: author(r.created_by),
        pieces: int(snapshot.pieces),
        brandCents: int(snapshot.brand_cents),
        invoiceNumber: invoice ? str(invoice.number) : null,
      };
    revisionIds.push(revision.id);
    (revisionsByReport.get(id(r.report_id)) ?? fail()).push(revision);
  }
  unique(revisionIds);
  const reports = reportHeads.map(({ raw, locationId, ...head }): ShopReport => {
    if (locationId !== shopId) fail();
    const lines = linesByReport.get(head.id)!,
      revisions = revisionsByReport.get(head.id)!.sort((a, b) => a.revision - b.revision),
      totals = shopTotals(lines);
    unique(lines.map((l) => l.itemId));
    // Versioni complete 1…N e righe che danno esattamente i totali: niente letture troncate.
    if (
      !totals ||
      totals.pieces !== head.pieces ||
      totals.grossCents !== head.grossCents ||
      totals.brandCents !== head.brandCents ||
      totals.shopCents !== head.shopCents ||
      revisions.length !== head.revision ||
      revisions.some((r, index) => r.revision !== index + 1) ||
      revisions[0].kind !== "lines"
    )
      fail();
    return {
      ...head,
      brandShareBps: int(raw.brand_share_bps, 0, 10_000),
      markupCents: int(raw.markup_cents, 0, 100_000_000),
      createdAt: date(raw.created_at),
      updatedAt: date(raw.updated_at),
      lines: lines.sort(
        (a, b) =>
          items.findIndex((i) => i.id === a.itemId) - items.findIndex((i) => i.id === b.itemId),
      ),
      revisions,
    };
  });
  reports.sort((a, b) => (a.month < b.month ? 1 : -1));

  const orderLines = new Map<string, ShopOrderLine[]>();
  const orderLineIds: string[] = [];
  for (const raw of rows.orderLines) {
    const r = obj(raw);
    ofShop(r.location_id);
    const line = {
      id: id(r.id),
      itemId: id(r.stock_item_id),
      quantity: int(r.quantity, 1, 100_000),
      delivered: int(r.delivered_quantity),
      cancelled: int(r.cancelled_quantity),
      remaining: 0,
    };
    line.remaining = line.quantity - line.delivered - line.cancelled;
    if (line.remaining < 0 || !itemIds.has(line.itemId)) fail();
    orderLineIds.push(line.id);
    const orderId = id(r.order_id);
    orderLines.set(orderId, [...(orderLines.get(orderId) ?? []), line]);
  }
  unique(orderLineIds);
  const orders = rows.orders.map((raw): ShopOrder => {
    const r = obj(raw);
    ofShop(r.location_id);
    const orderId = id(r.id),
      lines = orderLines.get(orderId) ?? fail(),
      status: OrderStatus =
        r.status === "open" || r.status === "delivered" || r.status === "closed"
          ? r.status
          : fail(),
      remaining = lines.some((l) => l.remaining > 0);
    orderLines.delete(orderId);
    unique(lines.map((l) => l.itemId));
    if ((status === "open") !== remaining || (status === "closed") !== (r.close_reason !== null))
      fail();
    return {
      id: orderId,
      number: int(r.order_number, 1, 1_000_000),
      requestedOn: day(r.requested_on),
      note: note(r.note, 1000),
      status,
      closeReason: nullable(r.close_reason, str),
      version: int(r.version, 1),
      createdAt: date(r.created_at),
      updatedAt: date(r.updated_at),
      author: author(r.created_by),
      lines: lines.sort(
        (a, b) =>
          items.findIndex((i) => i.id === a.itemId) - items.findIndex((i) => i.id === b.itemId),
      ),
    };
  });
  if (orderLines.size > 0) fail();
  unique(orders.map((o) => o.id));
  unique(orders.map((o) => String(o.number)));
  orders.sort((a, b) => b.number - a.number);

  const shipments = rows.shipments.map((raw): ShopShipment => {
    const r = obj(raw);
    ofShop(r.location_id);
    const direction =
        r.direction === "to_shop" || r.direction === "to_warehouse" ? r.direction : fail(),
      orderId = nullable(r.order_id, id);
    if (
      (direction === "to_shop") !== (orderId !== null) ||
      (orderId !== null && !orders.some((o) => o.id === orderId))
    )
      fail();
    return {
      id: id(r.id),
      direction,
      orderId,
      occurredAt: date(r.occurred_at),
      reason: str(r.reason),
      pieces: int(r.pieces, 1),
      author: author(r.created_by),
    };
  });
  unique(shipments.map((s) => s.id));
  shipments.sort((a, b) => byTimeDesc(a.occurredAt, b.occurredAt));

  let payments: ShopPayment[] | null = null;
  if (rows.payments !== null) {
    if (rows.paymentRevisions === null) fail();
    const revisions = new Map<string, ShopPaymentRevision[]>();
    const revisionKeys: string[] = [];
    for (const raw of rows.paymentRevisions) {
      const r = obj(raw);
      ofShop(r.location_id);
      const snapshot = obj(r.snapshot),
        paymentId = id(r.payment_id),
        revision: ShopPaymentRevision = {
          id: id(r.id),
          version: int(r.version, 1),
          reason: nullable(r.reason, str),
          createdAt: date(r.created_at),
          author: author(r.created_by),
          amountCents: int(snapshot.amount_cents, 0),
          paidAt: date(snapshot.paid_at),
          method: PAYMENT_METHODS.includes(snapshot.method as PaymentMethod)
            ? (snapshot.method as PaymentMethod)
            : fail(),
          voided: bool(snapshot.voided),
          finance: paymentFinanceFromDatabase(snapshot) ?? fail(),
          accountLabel:
            snapshot.account_label === undefined ? null : nullable(snapshot.account_label, str),
          reference: snapshot.reference === undefined ? null : nullable(snapshot.reference, str),
        };
      if ((revision.version === 1) !== (revision.reason === null)) fail();
      revisionKeys.push(revision.id);
      revisions.set(paymentId, [...(revisions.get(paymentId) ?? []), revision]);
    }
    unique(revisionKeys);
    payments = rows.payments.map((raw): ShopPayment => {
      const r = obj(raw);
      ofShop(r.location_id);
      const paymentId = id(r.id),
        history = (revisions.get(paymentId) ?? fail()).sort((a, b) => a.version - b.version),
        payment: ShopPayment = {
          id: paymentId,
          reportId: id(r.report_id),
          amountCents: int(r.amount_cents, 0),
          paidAt: date(r.paid_at),
          method: PAYMENT_METHODS.includes(r.method as PaymentMethod)
            ? (r.method as PaymentMethod)
            : fail(),
          accountLabel: nullable(r.account_label, str),
          reference: nullable(r.reference, str),
          voided: bool(r.voided),
          finance: paymentFinanceFromDatabase(r) ?? fail(),
          version: int(r.version, 1),
          revisions: history,
        };
      revisions.delete(paymentId);
      if (
        !reports.some((rep) => rep.id === payment.reportId) ||
        history.length !== payment.version ||
        history.some((h, index) => h.version !== index + 1)
      )
        fail();
      return payment;
    });
    if (revisions.size > 0) fail();
    unique(payments.map((p) => p.id));
    for (const report of reports) {
      const paid = payments
        .filter((p) => p.reportId === report.id)
        .reduce(
          (sum, p) =>
            sum + postedShopPaymentCents(p, localReportDate(new Date(loadedAt)) ?? fail()),
          0n,
        );
      if (
        [paid, BigInt(report.brandCents) - paid].some(
          (n) => n > BigInt(MAX_CENTS) || n < -BigInt(MAX_CENTS),
        )
      )
        fail();
      if (paymentStateFor(paid, report.brandCents) !== report.paymentState) fail();
    }
    payments.sort(
      (a, b) => Date.parse(a.paidAt) - Date.parse(b.paidAt) || a.id.localeCompare(b.id),
    );
  }

  counts.sort((a, b) => byTimeDesc(a.countedAt, b.countedAt));
  return {
    loadedAt,
    settings,
    shop,
    warehouses: locations.filter((l) => l.type === WAREHOUSE_TYPE && l.active),
    items,
    shopStock,
    supplyStock,
    counts,
    reports,
    orders,
    shipments,
    payments,
  };
}

// ---------------------------------------------------------------------------
// Giacenza del negozio.

/** Quantità mostrata: `null` («—») finché il negozio non è contato; dopo, un saldo mancante vale 0. */
export function shopQuantity(page: Pick<ShopPage, "shop" | "shopStock">, itemId: string) {
  if (page.shop.firstCountedAt === null) return null;
  return page.shopStock[itemId] ?? 0;
}
/** Pezzi ancora da consegnare per articolo negli ordini aperti. */
export function incomingByItem(orders: readonly ShopOrder[]): Record<string, number> {
  const incoming: Record<string, number> = {};
  for (const order of orders)
    if (order.status === "open")
      for (const line of order.lines)
        if (line.remaining > 0)
          incoming[line.itemId] = (incoming[line.itemId] ?? 0) + line.remaining;
  return incoming;
}

export type GridCell = {
  size: string;
  item: ShopItem | null;
  /** `null` = da contare. */
  quantity: number | null;
  /** «+2 in arrivo» dagli ordini aperti. */
  incoming: number;
};
export type GridRow = { color: string; cells: GridCell[] };
export type GridGroup = { model: string; rows: GridRow[] };
export type StockGrid = {
  counted: boolean;
  /** Totale in negozio; `null` finché non è contato. */
  total: number | null;
  sizes: string[];
  groups: GridGroup[];
};
/**
 * Griglia per modello, colore e taglia (XS–XXL), nell'ordine del Magazzino.
 * Mostra le T-shirt attive e quelle disattivate che sono ancora in negozio o in arrivo.
 */
export function shopStockGrid(
  page: Pick<ShopPage, "shop" | "shopStock" | "items" | "orders">,
): StockGrid {
  const counted = page.shop.firstCountedAt !== null,
    incoming = incomingByItem(page.orders),
    visible = page.items.filter(
      (item) => item.active || (page.shopStock[item.id] ?? 0) > 0 || (incoming[item.id] ?? 0) > 0,
    );
  const sizes: string[] = [...SIZES];
  for (const item of visible) if (!sizes.includes(item.size)) sizes.push(item.size);
  const groups: GridGroup[] = [];
  for (const item of visible) {
    let group = groups.find((g) => g.model === item.model);
    if (!group) groups.push((group = { model: item.model, rows: [] }));
    // Due varianti con lo stesso modello, colore e taglia vanno su righe distinte.
    let row = group.rows.find(
      (r) => r.color === item.color && !r.cells.find((c) => c.size === item.size)!.item,
    );
    if (!row) {
      row = {
        color: item.color,
        cells: sizes.map((size) => ({ size, item: null, quantity: null, incoming: 0 })),
      };
      group.rows.push(row);
    }
    const cell = row.cells.find((c) => c.size === item.size)!;
    cell.item = item;
    cell.quantity = shopQuantity(page, item.id);
    cell.incoming = incoming[item.id] ?? 0;
  }
  return {
    counted,
    total: counted
      ? page.items.reduce((sum, item) => sum + (shopQuantity(page, item.id) ?? 0), 0)
      : null,
    sizes,
    groups,
  };
}

// ---------------------------------------------------------------------------
// Conta.

export type CountDraft = {
  lines: CountLine[];
  pieces: number;
  /** Varianti con almeno un pezzo. */
  variants: number;
  /** Varianti contate a 0. */
  zeros: number;
};
/**
 * Righe della conta con la quantità letta (`expected_quantity`), per far
 * rifiutare al database una conta superata da una consegna o da un resoconto.
 * Prima conta: tutte le T-shirt attive, un campo vuoto vale 0. Correzione: solo
 * le varianti in `entries`. `null` se un valore non è valido o non c'è nessuna riga.
 */
export function countDraft(
  page: Pick<ShopPage, "shop" | "shopStock" | "items">,
  entries: Record<string, number | null>,
): CountDraft | null {
  const first = page.shop.firstCountedAt === null,
    itemIds = first
      ? page.items.filter((i) => i.active).map((i) => i.id)
      : Object.keys(entries).filter((itemId) => page.items.some((i) => i.id === itemId));
  if (Object.keys(entries).some((itemId) => !page.items.some((i) => i.id === itemId))) return null;
  const lines: CountLine[] = [];
  for (const itemId of itemIds) {
    const quantity = entries[itemId] ?? (first ? 0 : null);
    if (quantity === null || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 100_000)
      return null;
    lines.push({
      stock_item_id: itemId,
      quantity,
      expected_quantity: page.shopStock[itemId] ?? null,
    });
  }
  if (lines.length < 1 || lines.length > MAX_LINES) return null;
  lines.sort((a, b) => (a.stock_item_id < b.stock_item_id ? -1 : 1));
  return {
    lines,
    pieces: lines.reduce((sum, l) => sum + l.quantity, 0),
    variants: lines.filter((l) => l.quantity > 0).length,
    zeros: lines.filter((l) => l.quantity === 0).length,
  };
}

// ---------------------------------------------------------------------------
// Resoconto mensile.

/**
 * Colonna «Prima della conta»: serve se il negozio è stato contato dall'inizio
 * del mese in poi (stessa regola del database), o se il resoconto la usa già.
 */
export function beforeCountColumn(
  page: Pick<ShopPage, "counts" | "reports">,
  month: string,
): boolean {
  const start = Date.parse(romeMonthBounds(month).start);
  return (
    page.reports.some((r) => r.month === month && r.lines.some((l) => l.beforeCountQuantity > 0)) ||
    page.counts.some((c) => Date.parse(c.countedAt) >= start)
  );
}

export type ReportMonthRow = {
  month: string;
  report: ShopReport | null;
  /** Mese in corso: fascia «ora». */
  current: boolean;
  /** Mese finito senza resoconto, con il negozio contato. */
  missing: boolean;
  /** Il database accetta un resoconto per questo mese. */
  allowed: boolean;
};
/** Mesi del negozio dal più recente: ogni mese dall'inizio, più quelli già registrati. */
export function reportMonthRows(
  page: Pick<ShopPage, "shop" | "settings" | "reports">,
  now: Date | string,
): ReportMonthRow[] {
  const current = romeMonth(now),
    start = shopStartMonth(page.shop, page.settings),
    months = new Set([
      ...(start && start <= current ? monthsBetween(start, current) : []),
      ...page.reports.map((r) => r.month),
    ]),
    counted = page.shop.firstCountedAt !== null;
  return [...months]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((month) => {
      const report = page.reports.find((r) => r.month === month) ?? null;
      return {
        month,
        report,
        current: month === current,
        missing: !report && counted && month < current && start !== null && month >= start,
        allowed: reportMonthAllowed(page.settings, month, now),
      };
    });
}
/** Mese proposto dal pulsante principale: il mese precedente, se ammesso e non ancora registrato. */
export function suggestedReportMonth(
  page: Pick<ShopPage, "settings" | "reports">,
  now: Date | string,
): string | null {
  const previous = addMonths(romeMonth(now), -1);
  return reportMonthAllowed(page.settings, previous, now) &&
    !page.reports.some((r) => r.month === previous)
    ? previous
    : null;
}

export type ReportFormRow = {
  item: ShopItem;
  /** Giacenza del negozio ora. */
  inShop: number | null;
  /** Riga già nel resoconto, con il prezzo bloccato. */
  line: ShopReportLine | null;
  /** Prezzo in negozio: bloccato per le righe esistenti, dal catalogo per le nuove. */
  price: { webPriceCents: number; unitShopPriceCents: number; locked: boolean } | null;
  /** Variante senza prezzo del sito: «collega lo SKU al catalogo Shopify». */
  disabled: boolean;
};
const reportTerms = (page: Pick<ShopPage, "shop">, report: ShopReport | null) =>
  report
    ? { bps: report.brandShareBps, markup: report.markupCents }
    : { bps: page.shop.brandShareBps, markup: page.shop.markupCents };
/**
 * Righe del modulo: varianti in negozio o già nel resoconto; con `showAll`
 * anche le altre T-shirt attive.
 */
export function reportFormRows(
  page: Pick<ShopPage, "shop" | "shopStock" | "items" | "reports">,
  month: string,
  showAll = false,
): ReportFormRow[] {
  const report = page.reports.find((r) => r.month === month) ?? null,
    terms = reportTerms(page, report);
  return page.items.flatMap((item) => {
    const line = report?.lines.find((l) => l.itemId === item.id) ?? null,
      inShop = shopQuantity(page, item.id);
    if (!line && !((inShop ?? 0) > 0) && !(showAll && item.active)) return [];
    const price = line
      ? {
          webPriceCents: line.webPriceCents,
          unitShopPriceCents: line.unitShopPriceCents,
          locked: true,
        }
      : item.catalog
        ? {
            webPriceCents: item.catalog.priceCents,
            unitShopPriceCents: item.catalog.priceCents + terms.markup,
            locked: false,
          }
        : null;
    return [{ item, inShop, line, price, disabled: price === null }];
  });
}

export type ReportEntry = { quantity: number; beforeCount: number };
export type ReportDraft =
  | { status: "ok"; lines: ReportLine[]; totals: ShopTotals }
  | { status: "missing_price" | "invalid" | "too_large"; itemId?: string };
/**
 * Righe del comando e totali dal vivo. Le varianti già nel resoconto non
 * portano il prezzo (resta bloccato); le nuove portano quello del catalogo
 * letto. Una variante a 0 non si invia: assente vuol dire 0.
 */
export function reportDraft(
  page: Pick<ShopPage, "shop" | "items" | "reports">,
  month: string,
  entries: Record<string, ReportEntry>,
): ReportDraft {
  const report = page.reports.find((r) => r.month === month) ?? null,
    terms = reportTerms(page, report),
    lines: ReportLine[] = [],
    splits: { quantity: number; grossCents: number; brandCents: number; shopCents: number }[] = [];
  for (const itemId of Object.keys(entries).sort()) {
    const { quantity, beforeCount } = entries[itemId];
    if (
      !Number.isSafeInteger(quantity) ||
      !Number.isSafeInteger(beforeCount) ||
      quantity < 0 ||
      quantity > 100_000 ||
      beforeCount < 0 ||
      beforeCount > quantity
    )
      return { status: "invalid", itemId };
    if (quantity === 0) continue;
    const existing = report?.lines.find((l) => l.itemId === itemId) ?? null,
      item = page.items.find((i) => i.id === itemId);
    if (!item) return { status: "invalid", itemId };
    if (!existing && !item.catalog) return { status: "missing_price", itemId };
    const split = existing
      ? shopSplit(existing.webPriceCents, quantity, existing.brandShareBps, existing.markupCents)
      : shopSplit(item.catalog!.priceCents, quantity, terms.bps, terms.markup);
    if (!split) return { status: "too_large", itemId };
    splits.push({ quantity, ...split });
    lines.push({
      stock_item_id: itemId,
      quantity,
      before_count_quantity: beforeCount,
      price: existing
        ? null
        : {
            shop_domain: item.catalog!.shopDomain,
            variant_gid: item.catalog!.variantGid,
            expected_web_price_cents: item.catalog!.priceCents,
            expected_catalog_observed_at: item.catalog!.observedAt,
          },
    });
  }
  const totals = shopTotals(splits);
  if (!totals) return { status: "too_large" };
  if (lines.length > MAX_LINES) return { status: "invalid" };
  return { status: "ok", lines, totals };
}

export type ReportOverview = {
  month: string;
  title: string;
  revision: number;
  pieces: number;
  grossCents: number;
  shopCents: number;
  brandCents: number;
  brandShareBps: number;
  /** «Quota negozio (40%)», «Da fatturare al negozio (60%)». */
  shopShareLabel: string;
  brandShareLabel: string;
  lines: (ShopReportLine & { label: string })[];
  invoice: (ShopInvoice & { label: string; outdated: boolean }) | null;
  invoiceLabel: string;
  paymentState: PaymentState;
  paymentLabel: string;
  /** Solo con Finance aperta. */
  paidCents: number | null;
  remainingCents: number | null;
  overpaidCents: number | null;
  payments: ShopPayment[] | null;
  history: { revision: number; label: string }[];
};
export function reportOverview(
  page: Pick<ShopPage, "items" | "payments"> & { loadedAt?: string },
  report: ShopReport,
): ReportOverview {
  const label = (itemId: string) => page.items.find((i) => i.id === itemId)?.label ?? "Maglietta";
  const payments = page.payments?.filter((p) => p.reportId === report.id) ?? null,
    paid =
      payments === null
        ? null
        : payments.reduce(
            (sum, p) =>
              sum +
              postedShopPaymentCents(
                p,
                localReportDate(new Date(page.loadedAt ?? Date.now())) ?? fail(),
              ),
            0n,
          ),
    due = BigInt(report.brandCents);
  const invoice = report.invoice
    ? {
        ...report.invoice,
        label: `Fattura n. ${report.invoice.number} del ${dayLabel(report.invoice.date)}`,
        outdated: report.revisions.some(
          (r) => r.kind === "lines" && r.revision > report.invoice!.revision,
        ),
      }
    : null;
  let paymentLabel = paymentStateLabel[report.paymentState];
  if (paid !== null && (report.paymentState === "partial" || report.paymentState === "overpaid"))
    paymentLabel = `${paymentLabel}: ${consignmentMoney(paid)} su ${consignmentMoney(due)}`;
  return {
    month: report.month,
    title: monthLabel(report.month),
    revision: report.revision,
    pieces: report.pieces,
    grossCents: report.grossCents,
    shopCents: report.shopCents,
    brandCents: report.brandCents,
    brandShareBps: report.brandShareBps,
    shopShareLabel: `Quota negozio (${bpsLabel(10_000 - report.brandShareBps)})`,
    brandShareLabel: `Da fatturare al negozio (${bpsLabel(report.brandShareBps)})`,
    lines: report.lines.map((l) => ({ ...l, label: label(l.itemId) })),
    invoice,
    invoiceLabel: invoice
      ? invoice.label
      : report.brandCents === 0
        ? "Niente da fatturare"
        : "Da emettere",
    paymentState: report.paymentState,
    paymentLabel,
    paidCents: paid === null ? null : Number(paid),
    remainingCents: paid === null ? null : Number(paid < due ? due - paid : 0n),
    overpaidCents: paid === null ? null : Number(paid > due ? paid - due : 0n),
    payments,
    history: [...report.revisions].reverse().map((r) => ({
      revision: r.revision,
      label: [
        `Versione ${r.revision}`,
        r.author,
        momentLabel(r.createdAt),
        r.kind === "invoice"
          ? r.invoiceNumber
            ? `Fattura n. ${r.invoiceNumber} segnata`
            : "Fattura tolta"
          : (r.reason ?? "Prima registrazione"),
      ].join(" · "),
    })),
  };
}

// ---------------------------------------------------------------------------
// Ordini.

export type OrderProgressLine = ShopOrderLine & {
  label: string;
  /** Libere nel magazzino di partenza; `null` se non verificate. */
  available: number | null;
  /** Pezzi preparabili ora. */
  ready: number;
  missing: number;
};
export type OrderProgress = {
  lines: OrderProgressLine[];
  /** «Da preparare: 6 · In magazzino: 4 · Mancano: 2». */
  remaining: number;
  ready: number;
  missing: number;
  done: boolean;
};
/** Gli ordini non riservano il magazzino: «in magazzino» è la disponibilità di adesso. */
export function orderProgress(
  page: Pick<ShopPage, "items" | "supplyStock">,
  order: ShopOrder,
): OrderProgress {
  const lines = order.lines.map((line): OrderProgressLine => {
    const available = page.supplyStock[line.itemId]?.available ?? null,
      ready = Math.min(line.remaining, Math.max(0, available ?? 0));
    return {
      ...line,
      label: page.items.find((i) => i.id === line.itemId)?.label ?? "Maglietta",
      available,
      ready,
      missing: line.remaining - ready,
    };
  });
  return {
    lines,
    remaining: lines.reduce((sum, l) => sum + l.remaining, 0),
    ready: lines.reduce((sum, l) => sum + l.ready, 0),
    missing: lines.reduce((sum, l) => sum + l.missing, 0),
    done: order.status !== "open",
  };
}
/** «Prepara un ordine con le stesse magliette»: i pezzi venduti nel mese. */
export function orderLinesFromReport(report: ShopReport): ItemLine[] {
  return report.lines
    .map((l) => ({ stock_item_id: l.itemId, quantity: l.quantity }))
    .sort((a, b) => (a.stock_item_id < b.stock_item_id ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Avvisi e storico.

export type ShopReminder = {
  key: string;
  tone: "warning" | "info";
  text: string;
  href: string | null;
};
/** Promemoria calcolati alla lettura, senza job pianificati. */
export function shopReminders(page: ShopPage, now: Date | string): ShopReminder[] {
  const reminders: ShopReminder[] = [];
  const code = page.shop.code;
  if (page.shop.firstCountedAt === null)
    reminders.push({
      key: "count",
      tone: "warning",
      text: "Il negozio non è ancora stato contato.",
      href: consignmentCountHref(code),
    });
  for (const row of [...reportMonthRows(page, now)].reverse())
    if (row.missing)
      reminders.push({
        key: `report:${row.month}`,
        tone: "warning",
        text: `Resoconto di ${monthShort(row.month, now)} da registrare.`,
        href: consignmentShopHref(code, row.month),
      });
  for (const report of [...page.reports].reverse()) {
    const name = monthShort(report.month, now),
      href = consignmentShopHref(code, report.month);
    if (!report.invoice && report.brandCents > 0)
      reminders.push({
        key: `invoice:${report.month}`,
        tone: "warning",
        text: `Fattura di ${name} da emettere.`,
        href,
      });
    if (
      report.invoice &&
      report.revisions.some((r) => r.kind === "lines" && r.revision > report.invoice!.revision)
    )
      reminders.push({
        key: `credit:${report.month}`,
        tone: "warning",
        text: `Resoconto di ${name} modificato dopo la fattura n. ${report.invoice.number}: controlla se serve una nota di credito.`,
        href,
      });
    if (report.paymentState === "overpaid") {
      const paid = page.payments
        ?.filter((p) => p.reportId === report.id)
        .reduce(
          (sum, p) => sum + postedShopPaymentCents(p, localReportDate(new Date(now)) ?? fail()),
          0n,
        );
      reminders.push({
        key: `overpaid:${report.month}`,
        tone: "warning",
        text:
          paid === undefined
            ? `Per ${name} il negozio ha pagato più del dovuto.`
            : `Per ${name} il negozio ha pagato ${consignmentMoney(paid - BigInt(report.brandCents))} in più del dovuto.`,
        href,
      });
    }
  }
  const open = page.orders.filter((o) => o.status === "open");
  if (open.length)
    reminders.push({
      key: "orders",
      tone: "info",
      text: `${ordersToDeliverLabel(open.length)}.`,
      href: open.length === 1 ? consignmentOrderHref(code, open[0].number) : null,
    });
  return reminders;
}

export type ShopHistoryEntry = {
  key: string;
  at: string;
  author: string;
  text: string;
  detail: string | null;
  href: string | null;
};
/** Conte, consegne, magliette riportate e versioni dei resoconti, dalla più recente. */
export function shopHistory(page: ShopPage): ShopHistoryEntry[] {
  const code = page.shop.code;
  const entries: ShopHistoryEntry[] = [
    ...page.counts.map((c) => ({
      key: `count:${c.id}`,
      at: c.countedAt,
      author: c.author,
      text: c.fullCount
        ? `Conta in negozio: ${tshirtsLabel(c.pieces)}`
        : `Correzione della conta: ${tshirtsLabel(c.pieces)} nelle varianti contate`,
      detail: c.note || null,
      href: null,
    })),
    ...page.shipments.map((s) => {
      const order = page.orders.find((o) => o.id === s.orderId);
      return {
        key: `shipment:${s.id}`,
        at: s.occurredAt,
        author: s.author,
        text:
          s.direction === "to_shop"
            ? `Consegna dell’ordine n. ${order?.number ?? "—"}: ${tshirtsLabel(s.pieces)}`
            : `Riportate in magazzino: ${tshirtsLabel(s.pieces)}`,
        detail: s.direction === "to_warehouse" ? s.reason : null,
        href: order ? consignmentOrderHref(code, order.number) : null,
      };
    }),
    ...page.reports.flatMap((report) =>
      report.revisions.map((r) => ({
        key: `revision:${r.id}`,
        at: r.createdAt,
        author: r.author,
        text:
          r.kind === "invoice"
            ? `Resoconto di ${monthLabel(report.month)}: ${r.invoiceNumber ? `fattura n. ${r.invoiceNumber} segnata` : "fattura tolta"}`
            : r.revision === 1
              ? `Resoconto di ${monthLabel(report.month)} registrato: ${r.pieces === 0 ? "nessuna vendita" : tshirtsLabel(r.pieces)}`
              : `Resoconto di ${monthLabel(report.month)} corretto (versione ${r.revision})`,
        detail: r.kind === "lines" ? r.reason : null,
        href: consignmentShopHref(code, report.month),
      })),
    ),
  ];
  return entries.sort((a, b) => byTimeDesc(a.at, b.at) || a.key.localeCompare(b.key));
}
