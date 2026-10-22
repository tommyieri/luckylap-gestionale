import type { InventoryItem, InventorySourceMeta } from "../types";

export type DatabaseInventoryRows = {
  products: unknown[];
  items: unknown[];
  variants: unknown[];
  balances: unknown[];
  locations: unknown[];
  /** `consignment_shops`: un negozio vale solo dopo la prima conta (`first_counted_at`). */
  shops: unknown[];
};
const SHOP_TYPE = "Negozio Conto Vendita";
type Row = Record<string, unknown>;
const row = (value: unknown): Row => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Inventario non completo.");
  return value as Row;
};
const text = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Riferimento inventario mancante.");
  return value;
};
const numeric = (value: unknown, integer = false): number | null => {
  if (value === null) return null;
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value)))
    throw new Error("Valore inventario non valido.");
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isSafeInteger(parsed)))
    throw new Error("Valore inventario non valido.");
  return parsed;
};
const uniqueIndex = (values: unknown[], key: string) => {
  const index = new Map<string, Row>();
  for (const value of values) {
    const parsed = row(value),
      id = text(parsed[key]);
    if (index.has(id)) throw new Error("Riferimento inventario duplicato.");
    index.set(id, parsed);
  }
  return index;
};

/** Never imports the local snapshot. Missing DB provenance prevents rendering. */
export function inventoryFromDatabase(data: DatabaseInventoryRows): {
  items: InventoryItem[];
  sourceMeta: InventorySourceMeta;
} {
  if (!data.items.length) throw new Error("Inventario non ancora importato.");
  const products = uniqueIndex(data.products, "id"),
    variants = uniqueIndex(data.variants, "stock_item_id"),
    locations = uniqueIndex(data.locations, "id");
  const seen = new Set<string>(),
    balanceIndex = new Map<string, number | null>();
  for (const value of data.balances) {
    const balance = row(value),
      key = `${text(balance.stock_item_id)}:${text(balance.location_id)}`;
    if (balanceIndex.has(key)) throw new Error("Giacenza duplicata.");
    balanceIndex.set(key, numeric(balance.quantity, true));
  }
  let document: { title: string; url: string; extractedAt: string; mode: string } | undefined;
  const codes = new Map<string, string>();
  for (const [id, location] of locations) {
    const code = text(location.code);
    text(location.location_type);
    if (codes.has(code)) throw new Error("Codice magazzino duplicato.");
    if (typeof location.active !== "boolean") throw new Error("Sede inventario non valida.");
    codes.set(code, id);
  }
  // «In negozio» (03-4): solo i negozi attivi già contati. Prima della prima conta
  // la giacenza del negozio è sconosciuta; dopo, un saldo assente vale 0, come
  // nella pagina del negozio.
  const countedShops: string[] = [];
  const shopIds = new Set<string>();
  for (const value of data.shops) {
    const shop = row(value),
      id = text(shop.location_id),
      location = locations.get(id),
      first = shop.first_counted_at;
    if (!location || location.location_type !== SHOP_TYPE || shopIds.has(id))
      throw new Error("Negozio inventario non valido.");
    if (first !== null && (typeof first !== "string" || !Number.isFinite(Date.parse(first))))
      throw new Error("Conta del negozio non valida.");
    shopIds.add(id);
    if (first !== null && location.active === true) countedShops.push(id);
  }
  const items = data.items.map((value): InventoryItem => {
    const item = row(value),
      id = text(item.id),
      sku = text(item.sku);
    if (item.kind !== "product" || seen.has(sku) || typeof item.active !== "boolean")
      throw new Error("Articolo inventario non valido.");
    seen.add(sku);
    const variant = variants.get(id);
    if (!variant) throw new Error("Variante inventario mancante.");
    const product = products.get(text(variant.product_id));
    if (!product) throw new Error("Prodotto inventario mancante.");
    const source = row(item.source),
      sourceDocument = row(source.document),
      cell = row(source.inventory);
    const metadata = {
      title: text(sourceDocument.title),
      url: text(sourceDocument.url),
      extractedAt: text(sourceDocument.extracted_at_utc),
      mode: text(sourceDocument.quantity_mode),
    };
    const parsedUrl = new URL(metadata.url);
    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.username ||
      parsedUrl.password ||
      !Number.isFinite(Date.parse(metadata.extractedAt))
    )
      throw new Error("Provenienza inventario non valida.");
    if (document && JSON.stringify(document) !== JSON.stringify(metadata))
      throw new Error("Importazioni inventario non coerenti.");
    document = metadata;
    const quantityFor = (code: string) => {
      const locationId = codes.get(code);
      return locationId ? (balanceIndex.get(`${id}:${locationId}`) ?? null) : null;
    };
    const centralQuantity = quantityFor("MAG01"),
      consignmentQuantity = countedShops.length
        ? countedShops.reduce((sum, shop) => sum + (balanceIndex.get(`${id}:${shop}`) ?? 0), 0)
        : null;
    return {
      id,
      sku,
      model: text(product.model),
      category: text(product.category),
      color: text(variant.color),
      size: text(variant.size),
      centralQuantity,
      consignmentQuantity,
      totalQuantity:
        centralQuantity === null || consignmentQuantity === null
          ? null
          : centralQuantity + consignmentQuantity,
      targetQuantity: numeric(variant.central_target_quantity, true),
      unitCost: numeric(item.unit_cost_eur),
      webPrice: numeric(item.list_price_eur),
      active: item.active,
      sourceCell: `${text(cell.sheet)}!${text(cell.range)}`,
    };
  });
  if (!document) throw new Error("Provenienza inventario mancante.");
  return {
    items,
    sourceMeta: {
      title: document.title,
      url: document.url,
      importedAt: document.extractedAt,
      quantityStatus:
        document.mode === "saved_excel_cached_values_without_recalculation"
          ? "cached"
          : "unavailable",
      notes: [
        "Fonte iniziale: inventario Excel indicato dal founder. Shopify non utilizzato.",
        "Le giacenze mostrate sono lette dal database con i permessi del tuo account.",
        "Il totale rete somma stock centrale e negozi già contati; un valore sconosciuto rimane da verificare.",
        "La data di lettura si riferisce all’estrazione del file originale, non a una conta fisica.",
      ],
    },
  };
}
