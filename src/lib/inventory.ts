import snapshot from "../../data/inventory-source.json";
import type { InventoryItem, InventorySourceMeta } from "./types";

export type InventorySnapshot = {
  source: { title: string; url: string; extracted_at_utc: string; quantity_mode: string };
  products: { model: string; category: string }[];
  variants: { sku: string; active_source_value: string | null }[];
  inventory: {
    sku: string; model: string; color: string; size: string;
    stocks: { location_code: string; quantity: number | null; source_cell: string }[];
    network_quantity: number | null;
    central_target_quantity: number | null;
    unit_cost_eur: number | null;
    list_price_eur: number | null;
    source: { sheet: string; row: number; range: string };
  }[];
};

export function normalizeInventory(source: InventorySnapshot): { items: InventoryItem[]; sourceMeta: InventorySourceMeta } {
  const products = new Map(source.products.map((product) => [product.model, product]));
  const variants = new Map(source.variants.map((variant) => [variant.sku, variant]));
  const seen = new Set<string>();
  const items = source.inventory.map((row): InventoryItem => {
    if (!row.sku.trim()) throw new Error(`SKU mancante in ${row.source.sheet}, riga ${row.source.row}`);
    if (seen.has(row.sku)) throw new Error(`SKU duplicato: ${row.sku}`);
    seen.add(row.sku);
    const active = variants.get(row.sku)?.active_source_value?.trim().toLowerCase();
    return {
      id: row.sku, sku: row.sku, model: row.model,
      category: products.get(row.model)?.category ?? "Da classificare",
      color: row.color, size: row.size,
      centralQuantity: row.stocks.find((stock) => stock.location_code === "MAG01")?.quantity ?? null,
      consignmentQuantity: row.stocks.find((stock) => stock.location_code === "NEG01")?.quantity ?? null,
      totalQuantity: row.network_quantity,
      targetQuantity: row.central_target_quantity,
      unitCost: row.unit_cost_eur, webPrice: row.list_price_eur,
      active: active === "si" || active === "sì",
      sourceCell: `${row.source.sheet}!${row.source.range}`,
    };
  });
  return {
    items,
    sourceMeta: {
      title: source.source.title, url: source.source.url,
      importedAt: source.source.extracted_at_utc,
      quantityStatus: source.source.quantity_mode === "saved_excel_cached_values_without_recalculation" ? "cached" : "unavailable",
      notes: ["Quantità salvate nell’Excel, trascritte senza ricalcolo.", "Inventario di riferimento indicato dal founder. Shopify non utilizzato.", "Le quantità sono una lettura del file: le modifiche multiutente richiedono l’attivazione del database."],
    },
  };
}

export function loadInventory() {
  return normalizeInventory(snapshot);
}
