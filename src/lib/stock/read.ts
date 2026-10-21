import { stockRecord, stockUuid, type StockSnapshot } from "./model";

export type StockRows = { settings: unknown; items: unknown[]; locations: unknown[]; availability: unknown[] };
const fail = (): never => { throw new Error("La lettura delle scorte non è completa. Ricarica la pagina."); };
const object = (value: unknown) => stockRecord(value) ?? fail();
const id = (value: unknown) => stockUuid(value) ? value.toLowerCase() : fail();
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max ? value : fail();
const bool = (value: unknown) => typeof value === "boolean" ? value : fail();
const quantity = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fail();
const maybeQuantity = (value: unknown) => value === null ? null : quantity(value);
function unique(keys: string[]) { if (new Set(keys).size !== keys.length) fail(); }

export function stockSnapshotFromRows(rows: StockRows, loadedAt = new Date().toISOString()): StockSnapshot {
  const enabled = bool(object(rows.settings).stock_adjustments_enabled);
  const items = rows.items.map(value => {
    const row = object(value);
    if (row.kind !== "product" && row.kind !== "packaging") fail();
    return { id: id(row.id), sku: text(row.sku, 120), name: text(row.name, 240), kind: row.kind as "product" | "packaging", active: bool(row.active) };
  });
  const locations = rows.locations.map(value => { const row = object(value); return { id: id(row.id), code: text(row.code, 120), name: text(row.name, 240), active: bool(row.active) }; });
  unique(items.map(item => item.id)); unique(items.map(item => item.sku)); unique(locations.map(location => location.id));
  const itemIds = new Set(items.map(item => item.id)), locationIds = new Set(locations.map(location => location.id));
  const availability = rows.availability.map(value => {
    const row = object(value);
    const result = { itemId: id(row.stock_item_id), locationId: id(row.location_id), onHand: maybeQuantity(row.on_hand), reserved: quantity(row.reserved), available: maybeQuantity(row.available) };
    if (!itemIds.has(result.itemId) || !locationIds.has(result.locationId)
      || (result.onHand === null ? result.available !== null || result.reserved !== 0 : result.available !== result.onHand - result.reserved)) fail();
    return result;
  });
  unique(availability.map(row => `${row.itemId}:${row.locationId}`));
  items.sort((a, b) => a.sku.localeCompare(b.sku, "it"));
  locations.sort((a, b) => a.code.localeCompare(b.code, "it"));
  return { enabled, loadedAt, items, locations, availability };
}
