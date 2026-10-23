import { stockRecord as record, stockUuid as uuid } from "../stock/model";
import {
  bySize,
  CUSTOMER_EXTRA_SIZES,
  isDestination,
  isRestockState,
  SIZE_PATTERN,
  shopShortName,
  type Destination,
  type RestockLineInput,
  type RestockState,
} from "./model";

/*
 * Letture pure del riassortimento: righe del database → riordini per le pagine.
 * Una riga incompleta, orfana o doppia fa fallire tutto, come il conto vendita:
 * meglio nessun numero che numeri sbagliati.
 */

function fail(): never {
  throw Error("Lettura del riassortimento non completa. Ricarica la pagina.");
}
const obj = (v: unknown) => record(v) ?? fail(),
  id = (v: unknown) => (uuid(v) ? v.toLowerCase() : fail()),
  str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : fail()),
  text = (v: unknown) => (typeof v === "string" ? v : fail()),
  bool = (v: unknown) => (typeof v === "boolean" ? v : fail()),
  date = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : fail());
const int = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail();
const nullable = <T>(v: unknown, parse: (v: unknown) => T): T | null =>
  v === null ? null : parse(v);
const unique = (values: string[]) => {
  if (new Set(values).size !== values.length) fail();
};
const state = (v: unknown): RestockState => (isRestockState(v) ? v : fail());

export const WAREHOUSE_TYPE = "Magazzino";
export const SHOP_TYPE = "Negozio Conto Vendita";

export type RestockPlace = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  type: string;
};
export type RestockShop = {
  locationId: string;
  code: string;
  name: string;
  active: boolean;
  /** Taglie del negozio; `null` = tutte. */
  sizes: string[] | null;
  /** «LCM» per «Libreria Concessionaria Milano». */
  shortName: string;
};
export type RestockLine = {
  id: string;
  destination: Destination;
  productId: string;
  color: string;
  size: string;
  /** Variante del catalogo; `null` solo per il cliente in una taglia non a catalogo. */
  itemId: string | null;
  quantity: number;
};
export type RestockEvent = {
  id: string;
  from: RestockState | null;
  to: RestockState;
  note: string;
  at: string;
  by: string;
};
export type RestockArrival = {
  id: string;
  at: string;
  by: string;
  locationId: string;
  previousState: RestockState;
  pieces: number;
  warehousePieces: number;
  shopPieces: number;
  customerPieces: number;
  undoneAt: string | null;
  undoneBy: string | null;
};
export type RestockShopOrder = {
  id: string;
  number: number;
  status: "open" | "delivered" | "closed";
  shopCode: string;
  requested: number;
  delivered: number;
  /** Consegnate per variante. */
  deliveredByItem: Record<string, number>;
};
export type RestockTotals = { warehouse: number; shop: number; customer: number; total: number };
export type RestockOrder = {
  id: string;
  title: string;
  notes: string;
  state: RestockState;
  stateChangedAt: string;
  stateChangedBy: string;
  warehouse: RestockPlace;
  shop: RestockShop | null;
  shopDone: { at: string; by: string } | null;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  lines: RestockLine[];
  events: RestockEvent[];
  arrivals: RestockArrival[];
  /** L'arrivo in corso (non annullato), se il riordine è in mano nostra. */
  arrival: RestockArrival | null;
  shopOrders: RestockShopOrder[];
  totals: RestockTotals;
};

export type RestockCoreRows = {
  settings: unknown;
  orders: unknown[];
  lines: unknown[];
  events: unknown[];
  arrivals: unknown[];
  shopOrders: unknown[];
  shopOrderLines: unknown[];
  locations: unknown[];
  shops: unknown[];
  profiles: unknown[];
};
export type RestockData = {
  stockEnabled: boolean;
  orders: RestockOrder[];
  /** Negozi attivi del conto vendita, per la destinazione «per il negozio». */
  shops: RestockShop[];
};

function placesFrom(rows: unknown[]): RestockPlace[] {
  const places = rows.map((raw) => {
    const r = obj(raw);
    return {
      id: id(r.id),
      code: str(r.code),
      name: str(r.name),
      active: bool(r.active),
      type: str(r.location_type),
    };
  });
  unique(places.map((p) => p.id));
  return places;
}
function sizesFrom(v: unknown): string[] | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) || v.length < 1 || v.length > 20) fail();
  return v.map((size) => (typeof size === "string" && SIZE_PATTERN.test(size) ? size : fail()));
}
export function totalsOf(lines: readonly Pick<RestockLine, "destination" | "quantity">[]) {
  const totals: RestockTotals = { warehouse: 0, shop: 0, customer: 0, total: 0 };
  for (const line of lines) {
    totals[line.destination] += line.quantity;
    totals.total += line.quantity;
  }
  return totals;
}

/** Riordini con righe, storico, arrivi e ordini del negozio legati. */
export function restockDataFromRows(rows: RestockCoreRows): RestockData {
  const settings = obj(rows.settings);
  const stockEnabled = bool(settings.stock_adjustments_enabled);
  const places = placesFrom(rows.locations);
  const place = (v: unknown) => places.find((p) => p.id === id(v)) ?? fail();
  const names = new Map<string, string>();
  for (const raw of rows.profiles) {
    const r = obj(raw);
    names.set(id(r.user_id), text(r.display_name).trim() || "Un membro del team");
  }
  const person = (v: unknown) => names.get(id(v)) ?? "Un membro del team";
  const shops = rows.shops.map((raw): RestockShop => {
    const r = obj(raw),
      location = place(r.location_id);
    if (location.type !== SHOP_TYPE) fail();
    return {
      locationId: location.id,
      code: location.code,
      name: location.name,
      active: location.active,
      sizes: sizesFrom(r.sizes),
      shortName: shopShortName(location.name),
    };
  });
  unique(shops.map((s) => s.locationId));

  const lines = new Map<string, RestockLine[]>();
  const events = new Map<string, RestockEvent[]>();
  const arrivals = new Map<string, RestockArrival[]>();
  const shopOrders = new Map<string, RestockShopOrder[]>();
  const orderHeads = rows.orders.map((raw) => {
    const r = obj(raw),
      orderId = id(r.id);
    lines.set(orderId, []);
    events.set(orderId, []);
    arrivals.set(orderId, []);
    shopOrders.set(orderId, []);
    return { r, orderId };
  });
  unique(orderHeads.map((o) => o.orderId));
  const of = <T>(map: Map<string, T[]>, v: unknown) => map.get(id(v)) ?? fail();

  for (const raw of rows.lines) {
    const r = obj(raw);
    if (!isDestination(r.destination)) fail();
    const line: RestockLine = {
      id: id(r.id),
      destination: r.destination,
      productId: id(r.product_id),
      color: str(r.color),
      size: typeof r.size === "string" && SIZE_PATTERN.test(r.size) ? r.size : fail(),
      itemId: nullable(r.stock_item_id, id),
      quantity: int(r.quantity, 1, 100_000),
    };
    if (line.destination !== "customer" && line.itemId === null) fail();
    of(lines, r.order_id).push(line);
  }
  for (const raw of rows.events) {
    const r = obj(raw);
    of(events, r.order_id).push({
      id: id(r.id),
      from: nullable(r.from_state, state),
      to: state(r.to_state),
      note: text(r.note),
      at: date(r.created_at),
      by: person(r.created_by),
    });
  }
  for (const raw of rows.arrivals) {
    const r = obj(raw);
    const arrival: RestockArrival = {
      id: id(r.id),
      at: date(r.created_at),
      by: person(r.created_by),
      locationId: place(r.location_id).id,
      previousState: state(r.previous_state),
      pieces: int(r.pieces),
      warehousePieces: int(r.warehouse_pieces),
      shopPieces: int(r.shop_pieces),
      customerPieces: int(r.customer_pieces),
      undoneAt: nullable(r.undone_at, date),
      undoneBy: nullable(r.undone_by, person),
    };
    if (arrival.pieces !== arrival.warehousePieces + arrival.shopPieces) fail();
    if ((arrival.undoneAt === null) !== (arrival.undoneBy === null)) fail();
    of(arrivals, r.order_id).push(arrival);
  }
  const consignmentLines = new Map<
    string,
    { requested: number; delivered: number; byItem: Record<string, number> }
  >();
  for (const raw of rows.shopOrderLines) {
    const r = obj(raw),
      orderId = id(r.order_id),
      itemId = id(r.stock_item_id),
      sum = consignmentLines.get(orderId) ?? { requested: 0, delivered: 0, byItem: {} },
      delivered = int(r.delivered_quantity);
    sum.requested += int(r.quantity, 1);
    sum.delivered += delivered;
    sum.byItem[itemId] = (sum.byItem[itemId] ?? 0) + delivered;
    consignmentLines.set(orderId, sum);
  }
  for (const raw of rows.shopOrders) {
    const r = obj(raw),
      orderId = id(r.id),
      status = r.status;
    if (status !== "open" && status !== "delivered" && status !== "closed") fail();
    const sum = consignmentLines.get(orderId) ?? fail();
    of(shopOrders, r.restock_order_id).push({
      id: orderId,
      number: int(r.order_number, 1, 1_000_000),
      status,
      shopCode: place(r.location_id).code,
      requested: sum.requested,
      delivered: sum.delivered,
      deliveredByItem: sum.byItem,
    });
  }

  const orders = orderHeads.map(({ r, orderId }): RestockOrder => {
    const orderLines = lines.get(orderId)!,
      orderEvents = events.get(orderId)!.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
      orderArrivals = arrivals.get(orderId)!.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
      shopId = nullable(r.shop_location_id, id),
      shop = shopId === null ? null : (shops.find((s) => s.locationId === shopId) ?? fail()),
      warehouse = place(r.warehouse_location_id),
      orderState = state(r.state),
      doneAt = nullable(r.shop_done_at, date),
      open = orderArrivals.filter((a) => a.undoneAt === null);
    unique(orderLines.map((l) => `${l.destination}|${l.productId}|${l.color}|${l.size}`));
    if (warehouse.type !== WAREHOUSE_TYPE || orderEvents.length === 0) fail();
    if (open.length > 1 || (orderState === "in_hand") !== (open.length === 1)) fail();
    if (doneAt !== null && orderState !== "in_hand") fail();
    if (shop === null && orderLines.some((l) => l.destination === "shop")) fail();
    return {
      id: orderId,
      title: str(r.title),
      notes: text(r.notes),
      state: orderState,
      stateChangedAt: date(r.state_changed_at),
      stateChangedBy: person(r.state_changed_by),
      warehouse,
      shop,
      shopDone: doneAt === null ? null : { at: doneAt, by: person(r.shop_done_by) },
      version: int(r.version, 1),
      createdAt: date(r.created_at),
      createdBy: person(r.created_by),
      updatedAt: date(r.updated_at),
      lines: orderLines,
      events: orderEvents,
      arrivals: orderArrivals,
      arrival: open[0] ?? null,
      shopOrders: shopOrders.get(orderId)!.sort((a, b) => a.number - b.number),
      totals: totalsOf(orderLines),
    };
  });
  orders.sort(
    (a, b) => Date.parse(b.stateChangedAt) - Date.parse(a.stateChangedAt) || (a.id < b.id ? -1 : 1),
  );
  return { stockEnabled, orders, shops: shops.filter((s) => s.active) };
}

// ---------------------------------------------------------------------------
// Catalogo, giacenze del Magadzino e capi da produrre (per «Discussione»).

export type CatalogVariant = {
  itemId: string;
  productId: string;
  model: string;
  category: string;
  color: string;
  size: string;
  sku: string;
  active: boolean;
  /** Obiettivo nel magazzino centrale (product_variants.central_target_quantity). */
  target: number | null;
  /** Fisico nel Magadzino; `null` = da verificare. */
  onHand: number | null;
  available: number | null;
  /** Capi da produrre per le vendite già registrate. */
  toProduce: number;
};
export type RestockCatalog = { variants: CatalogVariant[] };
export type CatalogRows = {
  products: unknown[];
  variants: unknown[];
  items: unknown[];
  availability: unknown[];
  requirements: unknown[];
  requirementLines: unknown[];
};

const isTshirt = (category: string) => /^t[\s-]?shirt/i.test(category);
/** Catalogo dei prodotti con le quantità del magazzino del riordine. */
export function restockCatalogFromRows(rows: CatalogRows, warehouseId: string): RestockCatalog {
  const products = new Map<string, { model: string; category: string }>();
  for (const raw of rows.products) {
    const r = obj(raw);
    products.set(id(r.id), { model: str(r.model), category: str(r.category) });
  }
  const items = new Map<string, { sku: string; active: boolean }>();
  for (const raw of rows.items) {
    const r = obj(raw);
    items.set(id(r.id), { sku: str(r.sku), active: bool(r.active) });
  }
  const stock = new Map<string, { onHand: number | null; available: number | null }>();
  for (const raw of rows.availability) {
    const r = obj(raw);
    if (id(r.location_id) !== warehouseId) fail();
    const itemId = id(r.stock_item_id);
    if (stock.has(itemId)) fail();
    stock.set(itemId, {
      onHand: nullable(r.on_hand, (v) => int(v)),
      available: nullable(r.available, (v) => int(v, -Number.MAX_SAFE_INTEGER)),
    });
  }
  const lineItems = new Map<string, string>();
  for (const raw of rows.requirementLines) {
    const r = obj(raw);
    lineItems.set(id(r.id), id(r.stock_item_id));
  }
  const toProduce = new Map<string, number>();
  for (const raw of rows.requirements) {
    const r = obj(raw),
      remaining =
        int(r.required_quantity, 1) - int(r.completed_quantity) - int(r.cancelled_quantity);
    if (remaining < 0) fail();
    if (r.status !== "to_plan" && r.status !== "partially_ready") continue;
    const itemId = lineItems.get(id(r.order_line_id)) ?? fail();
    toProduce.set(itemId, (toProduce.get(itemId) ?? 0) + remaining);
  }
  const variants = rows.variants.flatMap((raw): CatalogVariant[] => {
    const r = obj(raw),
      itemId = id(r.stock_item_id),
      item = items.get(itemId),
      product = products.get(id(r.product_id)) ?? fail();
    if (!item) return []; // Solo prodotti (le varianti di packaging non sono qui).
    const quantities = stock.get(itemId) ?? { onHand: null, available: null };
    return [
      {
        itemId,
        productId: id(r.product_id),
        model: product.model,
        category: product.category,
        color: str(r.color),
        size: str(r.size),
        sku: item.sku,
        active: item.active,
        target: nullable(r.central_target_quantity, (v) => int(v)),
        onHand: quantities.onHand,
        available: quantities.available,
        toProduce: toProduce.get(itemId) ?? 0,
      },
    ];
  });
  unique(variants.map((v) => v.itemId));
  return { variants };
}

// ---------------------------------------------------------------------------
// Griglia: gruppi (T-shirt, poi gli altri prodotti), righe modello × colore, colonne per taglia.

export type GridCell = { size: string; variant: CatalogVariant | null };
export type GridRow = {
  key: string;
  productId: string;
  model: string;
  color: string;
  tshirt: boolean;
  cells: GridCell[];
};
export type GridGroup = { key: string; label: string; sizes: string[]; rows: GridRow[] };

/**
 * Righe della griglia: varianti attive del catalogo più ogni modello e colore già nelle righe del
 * riordine. Le T-shirt hanno anche le colonne per il cliente fuori catalogo (XXXL).
 */
export function restockGrid(
  catalog: RestockCatalog,
  lines: readonly Pick<RestockLine, "productId" | "color" | "size">[],
): GridGroup[] {
  const used = new Set(lines.map((l) => `${l.productId}|${l.color}`));
  const visible = catalog.variants.filter((v) => v.active || used.has(`${v.productId}|${v.color}`));
  const order = (a: CatalogVariant, b: CatalogVariant) =>
    Number(!isTshirt(a.category)) - Number(!isTshirt(b.category)) ||
    a.category.localeCompare(b.category, "it");
  const modelOrder = new Map<string, number>();
  for (const v of [...visible].sort(order))
    if (!modelOrder.has(v.productId)) modelOrder.set(v.productId, modelOrder.size);
  const groups: GridGroup[] = [];
  const rowsByKey = new Map<string, GridRow>();
  for (const v of [...visible].sort(
    (a, b) =>
      order(a, b) ||
      modelOrder.get(a.productId)! - modelOrder.get(b.productId)! ||
      a.color.localeCompare(b.color, "it") ||
      bySize(a.size, b.size),
  )) {
    const tshirt = isTshirt(v.category),
      groupKey = tshirt ? "tshirt" : "other";
    let group = groups.find((g) => g.key === groupKey);
    if (!group)
      groups.push(
        (group = {
          key: groupKey,
          label: tshirt ? "T-shirt" : "Altri prodotti",
          sizes: [],
          rows: [],
        }),
      );
    if (!group.sizes.includes(v.size)) group.sizes.push(v.size);
    const key = `${v.productId}|${v.color}`;
    let row = rowsByKey.get(key);
    if (!row) {
      row = { key, productId: v.productId, model: v.model, color: v.color, tshirt, cells: [] };
      rowsByKey.set(key, row);
      group.rows.push(row);
    }
    row.cells.push({ size: v.size, variant: v });
  }
  for (const group of groups) {
    if (group.key === "tshirt")
      for (const size of CUSTOMER_EXTRA_SIZES)
        if (!group.sizes.includes(size)) group.sizes.push(size);
    for (const line of lines) {
      const row = rowsByKey.get(`${line.productId}|${line.color}`);
      if (row && group.rows.includes(row) && !group.sizes.includes(line.size))
        group.sizes.push(line.size);
    }
    group.sizes.sort(bySize);
    for (const row of group.rows)
      row.cells = group.sizes.map(
        (size) => row.cells.find((c) => c.size === size) ?? { size, variant: null },
      );
  }
  return groups;
}

/** Quantità di una cella per destinazione. */
export function lineQuantity(
  lines: readonly RestockLine[] | readonly RestockLineInput[],
  destination: Destination,
  productId: string,
  color: string,
  size: string,
): number {
  for (const l of lines) {
    const product = "productId" in l ? l.productId : l.product_id;
    if (
      l.destination === destination &&
      product === productId &&
      l.color === color &&
      l.size === size
    )
      return l.quantity;
  }
  return 0;
}

/** Pezzi per noi già in arrivo con gli altri riordini non ancora in mano nostra. */
export function incomingByItem(orders: readonly RestockOrder[], exceptId: string) {
  const incoming: Record<string, number> = {};
  for (const order of orders)
    if (order.id !== exceptId && order.state !== "in_hand")
      for (const line of order.lines)
        if (line.destination === "warehouse" && line.itemId)
          incoming[line.itemId] = (incoming[line.itemId] ?? 0) + line.quantity;
  return incoming;
}

/**
 * «Proponi quantità»: per noi, obiettivo meno giacenza nel Magadzino meno i pezzi già in arrivo
 * con altri riordini, mai sotto zero. Le varianti senza obiettivo o da contare restano fuori.
 */
export function proposedQuantities(
  catalog: RestockCatalog,
  incoming: Record<string, number>,
): Record<string, number> {
  const proposal: Record<string, number> = {};
  for (const v of catalog.variants) {
    if (!v.active || v.target === null || v.onHand === null) continue;
    const missing = v.target - v.onHand - (incoming[v.itemId] ?? 0);
    if (missing > 0) proposal[v.itemId] = missing;
  }
  return proposal;
}

/** Pagina di un riordine: tutti i riordini, quello aperto, il catalogo e i pezzi in arrivo. */
export type RestockPage = {
  data: RestockData;
  order: RestockOrder;
  catalog: RestockCatalog;
  /** Pezzi per noi già in arrivo con gli altri riordini. */
  incoming: Record<string, number>;
};

export type ShopPart = {
  pieces: number;
  delivered: number;
  /**
   * `waiting`: non ancora in mano nostra; `todo`: da consegnare; `open`: ordine del negozio
   * aperto; `done`: consegnate; `manual`: segnate a mano.
   */
  status: "waiting" | "todo" | "open" | "done" | "manual";
};
/** La parte del negozio: pezzi, consegnati con gli ordini legati, stato. */
export function shopPart(order: RestockOrder): ShopPart {
  const pieces = order.totals.shop,
    delivered = order.shopOrders.reduce((sum, o) => sum + o.delivered, 0);
  const status: ShopPart["status"] =
    order.state !== "in_hand"
      ? "waiting"
      : order.shopDone
        ? "manual"
        : delivered >= pieces
          ? "done"
          : order.shopOrders.some((o) => o.status === "open")
            ? "open"
            : "todo";
  return { pieces, delivered, status };
}

/**
 * Righe per il negozio (variante e pezzi) ancora da consegnare, per il nuovo ordine del Conto
 * vendita: i pezzi per il negozio meno quelli già consegnati con gli ordini legati al riordine.
 */
export function shopOrderPrefill(
  order: RestockOrder,
): { stock_item_id: string; quantity: number }[] {
  const byItem = new Map<string, number>();
  for (const line of order.lines)
    if (line.destination === "shop" && line.itemId)
      byItem.set(line.itemId, (byItem.get(line.itemId) ?? 0) + line.quantity);
  for (const shopOrder of order.shopOrders)
    for (const [itemId, delivered] of Object.entries(shopOrder.deliveredByItem))
      if (byItem.has(itemId)) byItem.set(itemId, byItem.get(itemId)! - delivered);
  return [...byItem]
    .filter(([, quantity]) => quantity > 0)
    .map(([stock_item_id, quantity]) => ({ stock_item_id, quantity }))
    .sort((a, b) => (a.stock_item_id < b.stock_item_id ? -1 : 1));
}
