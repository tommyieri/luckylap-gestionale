import { stockRecord as record, stockUuid as uuid } from "../stock/model";
import {
  consignmentAmount,
  consignmentDate,
  consignmentSplit,
  MAX_CENTS,
  type ConsignmentSnapshot,
  type ConsignmentLocation,
  type ConsignmentSale,
} from "./model";
export type ConsignmentRows = {
  settings: unknown;
  items: unknown[];
  variants: unknown[];
  products: unknown[];
  locations: unknown[];
  availability: unknown[];
  catalog: unknown[];
  transfers: unknown[];
  sales: unknown[];
  settlements: unknown[] | null;
};
function fail(): never {
  throw Error("Lettura conto vendita non completa. Ricarica la pagina.");
}
const obj = (v: unknown) => record(v) ?? fail(),
  id = (v: unknown) => (uuid(v) ? v : fail()),
  str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : fail()),
  bool = (v: unknown) => (typeof v === "boolean" ? v : fail());
const int = (v: unknown, min = 0, max = MAX_CENTS) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail();
const date = (v: unknown) => (consignmentDate(v) ? v : fail());
const unique = (v: string[]) => {
  if (new Set(v).size !== v.length) fail();
};
const cost = (v: unknown) => (v === null ? null : (consignmentAmount(String(v)) ?? fail()));
export function consignmentFromRows(
  rows: ConsignmentRows,
  loadedAt = new Date().toISOString(),
): ConsignmentSnapshot {
  const settings = obj(rows.settings),
    stockEnabled = bool(settings.stock_adjustments_enabled),
    salesEnabled = bool(settings.manual_sales_enabled),
    startedAt = settings.sales_started_at === null ? null : date(settings.sales_started_at);
  if (salesEnabled && !startedAt) fail();
  const products = rows.products.map((v) => {
    const r = obj(v);
    return { id: id(r.id), category: str(r.category) };
  });
  unique(products.map((r) => r.id));
  const variants = rows.variants.map((v) => {
    const r = obj(v);
    return {
      itemId: id(r.stock_item_id),
      productId: id(r.product_id),
      color: str(r.color),
      size: str(r.size),
    };
  });
  unique(variants.map((r) => r.itemId));
  const allItems = rows.items.map((v) => {
    const r = obj(v),
      variant = variants.find((v) => v.itemId === r.id) ?? fail();
    if (r.kind !== "product" || !products.some((p) => p.id === variant.productId)) fail();
    return {
      id: id(r.id),
      sku: str(r.sku),
      name: str(r.name),
      active: bool(r.active),
      costCents: cost(r.unit_cost_eur),
      category: products.find((p) => p.id === variant.productId)!.category,
    };
  });
  unique(allItems.map((r) => r.id));
  unique(allItems.map((r) => r.sku));
  const catalog = rows.catalog.map((v) => {
    const r = obj(v);
    if (typeof r.product_type !== "string") fail();
    return {
      itemId: r.stock_item_id === null ? null : id(r.stock_item_id),
      sku: str(r.sku),
      shopDomain: str(r.shop_domain),
      variantGid: str(r.variant_gid),
      priceCents: int(r.price_cents, 0, 99999999999999),
      observedAt: date(r.observed_at),
      status: str(r.status),
      currency: str(r.currency_code),
      productType: r.product_type,
    };
  });
  unique(catalog.map((r) => `${r.shopDomain}:${r.variantGid}`));
  const items = allItems
    .filter((r) => r.category === "T-shirt")
    .map(({ category, ...r }) => {
      void category;
      const matches = catalog.filter(
        (c) =>
          c.itemId === r.id &&
          c.sku === r.sku &&
          c.status === "ACTIVE" &&
          c.currency === "EUR" &&
          c.productType === "T-shirt",
      );
      return {
        ...r,
        catalog:
          matches.length === 1
            ? {
                shopDomain: matches[0].shopDomain,
                variantGid: matches[0].variantGid,
                priceCents: matches[0].priceCents,
                observedAt: matches[0].observedAt,
              }
            : null,
      };
    });
  const locations = rows.locations
    .map((v) => {
      const r = obj(v);
      return {
        id: id(r.id),
        code: str(r.code),
        name: str(r.name),
        active: bool(r.active),
        type: str(r.location_type),
      };
    })
    .filter(
      (r): r is ConsignmentLocation => r.type === "Magazzino" || r.type === "Negozio Conto Vendita",
    );
  unique(locations.map((r) => r.id));
  const itemIds = new Set(items.map((r) => r.id)),
    locIds = new Set(locations.map((r) => r.id));
  const availability = rows.availability
    .map((v) => {
      const r = obj(v);
      return {
        itemId: id(r.stock_item_id),
        locationId: id(r.location_id),
        onHand: r.on_hand === null ? null : int(r.on_hand),
        reserved: int(r.reserved),
        available: r.available === null ? null : int(r.available),
      };
    })
    .filter((r) => itemIds.has(r.itemId) && locIds.has(r.locationId));
  unique(availability.map((r) => `${r.itemId}:${r.locationId}`));
  for (const r of availability)
    if (
      r.onHand === null
        ? r.available !== null || r.reserved !== 0
        : r.onHand - r.reserved !== r.available
    )
      fail();
  for (const item of items)
    for (const loc of locations)
      if (!availability.some((r) => r.itemId === item.id && r.locationId === loc.id))
        availability.push({
          itemId: item.id,
          locationId: loc.id,
          onHand: null,
          reserved: 0,
          available: null,
        });
  const transfers = rows.transfers.map((v) => {
    const r = obj(v),
      result = {
        id: id(r.id),
        itemId: id(r.stock_item_id),
        fromId: id(r.from_location_id),
        toId: id(r.to_location_id),
        quantity: int(r.quantity, 1, 100000),
        reason: str(r.reason),
        occurredAt: date(r.occurred_at),
      };
    if (
      !itemIds.has(result.itemId) ||
      !locIds.has(result.fromId) ||
      !locIds.has(result.toId) ||
      result.fromId === result.toId
    )
      fail();
    return result;
  });
  unique(transfers.map((r) => r.id));
  const sales: ConsignmentSale[] = rows.sales.map((v) => {
    const r = obj(v),
      result = {
        id: id(r.id),
        itemId: id(r.stock_item_id),
        locationId: id(r.location_id),
        sku: str(r.sku_snapshot),
        quantity: int(r.quantity, 1, 100000),
        webPriceCents: int(r.web_price_cents),
        unitShopPriceCents: int(r.unit_shop_price_cents),
        grossCents: int(r.gross_cents),
        brandClaimCents: int(r.brand_claim_cents),
        shopShareCents: int(r.shop_share_cents),
        costCents: r.unit_cost_cents === null ? null : int(r.unit_cost_cents),
        reference: str(r.external_reference),
        reason: str(r.reason),
        occurredAt: date(r.occurred_at),
      };
    const split = consignmentSplit(result.webPriceCents, result.quantity);
    if (
      !itemIds.has(result.itemId) ||
      !locIds.has(result.locationId) ||
      !split ||
      Object.entries(split).some(([key, value]) => result[key as keyof typeof split] !== value)
    )
      fail();
    return result;
  });
  unique(sales.map((r) => r.id));
  unique(sales.map((r) => `${r.locationId}:${r.reference}`));
  const settlements =
    rows.settlements === null
      ? null
      : rows.settlements.map((v) => {
          const r = obj(v),
            result = {
              id: id(r.id),
              saleId: id(r.sale_id),
              amountCents: int(r.amount_cents, 1),
              occurredAt: date(r.occurred_at),
              method: str(r.method),
              reference: str(r.reference),
            };
          if (
            !sales.some((s) => s.id === result.saleId) ||
            !["bank_transfer", "cash", "other"].includes(result.method)
          )
            fail();
          return result;
        });
  if (settlements) {
    unique(settlements.map((r) => r.id));
    for (const sale of sales)
      if (
        settlements
          .filter((r) => r.saleId === sale.id)
          .reduce((sum, r) => sum + BigInt(r.amountCents), 0n) > BigInt(sale.brandClaimCents)
      )
        fail();
  }
  items.sort((a, b) => a.sku.localeCompare(b.sku));
  locations.sort((a, b) => a.code.localeCompare(b.code));
  transfers.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  sales.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  return {
    stockEnabled,
    salesEnabled,
    startedAt,
    loadedAt,
    canSettle: settlements !== null,
    items,
    locations,
    availability,
    transfers,
    sales,
    settlements,
  };
}
type Page = { data: unknown[] | null; count: number | null; error: unknown };
/** Exact-count keyset pagination. Also supports a domain key within one SKU. */
export async function consignmentPages(
  read: (after: string | null, limit: number) => PromiseLike<Page>,
  key = "id",
): Promise<unknown[]> {
  const rows: unknown[] = [];
  let after: string | null = null,
    total: number | null = null;
  do {
    const p = await read(after, 200);
    if (
      p.error ||
      !Array.isArray(p.data) ||
      !Number.isSafeInteger(p.count) ||
      p.count === null ||
      p.count < 0 ||
      p.count > 100000 ||
      (total !== null && total - rows.length !== p.count)
    )
      fail();
    if (total === null) total = p.count;
    if (p.data.length !== Math.min(200, total - rows.length)) fail();
    for (const raw of p.data) {
      const row = obj(raw),
        cursor = str(row[key]);
      if (after !== null && cursor <= after) fail();
      after = cursor;
    }
    rows.push(...p.data);
  } while (rows.length < total);
  return rows;
}
