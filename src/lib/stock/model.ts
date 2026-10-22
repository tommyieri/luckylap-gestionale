export type StockItem = {
  id: string;
  sku: string;
  name: string;
  kind: "product" | "packaging";
  active: boolean;
};
export type StockLocation = { id: string; code: string; name: string; active: boolean };
/**
 * Le rettifiche valgono solo per le sedi di questo tipo (06 R7). La merce del
 * negozio si conta e si cambia da Conto vendita; il database rifiuta comunque le
 * rettifiche sulle sedi «Negozio Conto Vendita» (`shop_location`).
 */
export const ADJUSTABLE_LOCATION_TYPE = "Magazzino";
export type StockAvailability = {
  itemId: string;
  locationId: string;
  onHand: number | null;
  reserved: number;
  available: number | null;
};
export type StockSnapshot = {
  enabled: boolean;
  loadedAt: string;
  items: StockItem[];
  locations: StockLocation[];
  availability: StockAvailability[];
};
export type StockAdjustment = {
  operationId: string;
  itemId: string;
  locationId: string;
  delta: number;
  reason: string;
  retry?: boolean;
};
export type StockAdjustmentResult =
  | {
      status: "success";
      movementId: string;
      operationId: string;
      replayed: boolean;
      message: string;
    }
  | { status: "rejected"; code: string; message: string }
  | { status: "uncertain"; message: string };
export const stockUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const stockRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
export function parseStockAdjustment(value: unknown): StockAdjustment | null {
  const row = stockRecord(value);
  if (
    !row ||
    Object.keys(row).some(
      (key) => !["operationId", "itemId", "locationId", "delta", "reason", "retry"].includes(key),
    ) ||
    !stockUuid(row.operationId) ||
    !stockUuid(row.itemId) ||
    !stockUuid(row.locationId) ||
    typeof row.delta !== "number" ||
    !Number.isSafeInteger(row.delta) ||
    row.delta === 0 ||
    Math.abs(row.delta) > 1_000_000_000 ||
    typeof row.reason !== "string" ||
    row.reason.trim().length < 3 ||
    row.reason.trim().length > 500 ||
    (row.retry !== undefined && typeof row.retry !== "boolean")
  )
    return null;
  return {
    operationId: row.operationId.toLowerCase(),
    itemId: row.itemId.toLowerCase(),
    locationId: row.locationId.toLowerCase(),
    delta: row.delta,
    reason: row.reason.trim(),
    ...(row.retry === undefined ? {} : { retry: row.retry }),
  };
}
export function stockQuantity(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "Da verificare"
    : new Intl.NumberFormat("it-IT").format(value);
}
export function stockFormDelta(
  direction: FormDataEntryValue | null,
  amount: FormDataEntryValue | null,
): number | null {
  if (
    (direction !== "add" && direction !== "remove") ||
    typeof amount !== "string" ||
    !/^[1-9][0-9]{0,9}$/.test(amount)
  )
    return null;
  const quantity = Number(amount);
  if (quantity > 1_000_000_000) return null;
  return direction === "add" ? quantity : -quantity;
}
