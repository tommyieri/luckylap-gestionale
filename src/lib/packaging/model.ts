import { stockRecord, stockUuid, type StockAvailability, type StockLocation } from "../stock/model";

export type PackagingType = "box" | "sticker" | "other";
export type PackagingItem = {
  id: string;
  sku: string;
  name: string;
  active: boolean;
  packagingType: PackagingType;
  specifications: string | null;
  unitCostCents: number | null;
};
export type PackagingSnapshot = {
  enabled: boolean;
  loadedAt: string;
  items: PackagingItem[];
  locations: StockLocation[];
  availability: StockAvailability[];
};
export type PackagingCreatePayload = {
  schema_version: 1;
  sku: string;
  name: string;
  packaging_type: PackagingType;
  specifications: string | null;
  unit_cost_cents: number | null;
  location_id: string;
  initial_quantity: number | null;
};
export type PackagingCountPayload = {
  schema_version: 1;
  stock_item_id: string;
  location_id: string;
  quantity: number;
  reason: string;
};
export type PackagingCreateCommand = {
  operationId: string;
  payload: PackagingCreatePayload;
  retry?: boolean;
};
export type PackagingCountCommand = {
  operationId: string;
  payload: PackagingCountPayload;
  retry?: boolean;
};
export type PackagingCommand =
  | { kind: "create"; command: PackagingCreateCommand }
  | { kind: "count"; command: PackagingCountCommand };
export type PackagingResult =
  | {
      status: "success";
      operationId: string;
      stockItemId: string;
      movementId: string | null;
      replayed: boolean;
      message: string;
    }
  | { status: "rejected"; code: string; message: string }
  | { status: "uncertain"; message: string };

const exact = (row: Record<string, unknown>, keys: string[]) =>
  Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key));
const string = (value: unknown, min: number, max: number): value is string =>
  typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
const quantity = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
const balanceQuantity = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const cents = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 999_999_999_999;
const type = (value: unknown): value is PackagingType =>
  value === "box" || value === "sticker" || value === "other";
function envelope(value: unknown) {
  const row = stockRecord(value);
  if (
    !row ||
    !stockUuid(row.operationId) ||
    (row.retry !== undefined && typeof row.retry !== "boolean") ||
    Object.keys(row).some((key) => !["operationId", "payload", "retry"].includes(key))
  )
    return null;
  const payload = stockRecord(row.payload);
  return payload ? { row, payload } : null;
}
export function parsePackagingCreate(value: unknown): PackagingCreateCommand | null {
  const parsed = envelope(value);
  if (!parsed) return null;
  const { row, payload: p } = parsed;
  if (
    !exact(p, [
      "schema_version",
      "sku",
      "name",
      "packaging_type",
      "specifications",
      "unit_cost_cents",
      "location_id",
      "initial_quantity",
    ]) ||
    p.schema_version !== 1 ||
    !string(p.sku, 1, 120) ||
    !string(p.name, 1, 240) ||
    !type(p.packaging_type) ||
    !(p.specifications === null || string(p.specifications, 0, 2000)) ||
    !(p.unit_cost_cents === null || cents(p.unit_cost_cents)) ||
    !stockUuid(p.location_id) ||
    !(p.initial_quantity === null || quantity(p.initial_quantity))
  )
    return null;
  return {
    operationId: (row.operationId as string).toLowerCase(),
    payload: {
      schema_version: 1,
      sku: p.sku.trim(),
      name: p.name.trim(),
      packaging_type: p.packaging_type,
      specifications: p.specifications === null ? null : p.specifications.trim() || null,
      unit_cost_cents: p.unit_cost_cents,
      location_id: p.location_id.toLowerCase(),
      initial_quantity: p.initial_quantity,
    },
    ...(row.retry === undefined ? {} : { retry: row.retry as boolean }),
  };
}
export function parsePackagingCount(value: unknown): PackagingCountCommand | null {
  const parsed = envelope(value);
  if (!parsed) return null;
  const { row, payload: p } = parsed;
  if (
    !exact(p, ["schema_version", "stock_item_id", "location_id", "quantity", "reason"]) ||
    p.schema_version !== 1 ||
    !stockUuid(p.stock_item_id) ||
    !stockUuid(p.location_id) ||
    !quantity(p.quantity) ||
    !string(p.reason, 3, 500)
  )
    return null;
  return {
    operationId: (row.operationId as string).toLowerCase(),
    payload: {
      schema_version: 1,
      stock_item_id: p.stock_item_id.toLowerCase(),
      location_id: p.location_id.toLowerCase(),
      quantity: p.quantity,
      reason: p.reason.trim(),
    },
    ...(row.retry === undefined ? {} : { retry: row.retry as boolean }),
  };
}
export function parsePackagingCommand(value: unknown): PackagingCommand | null {
  const row = stockRecord(value);
  if (!row || !exact(row, ["kind", "command"])) return null;
  if (row.kind === "create") {
    const command = parsePackagingCreate(row.command);
    return command ? { kind: "create", command } : null;
  }
  if (row.kind === "count") {
    const command = parsePackagingCount(row.command);
    return command ? { kind: "count", command } : null;
  }
  return null;
}
/** Convert the written euro amount exactly; no floating-point multiplication. */
export function packagingCostInput(value: FormDataEntryValue | null): number | null | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return null;
  const match = /^(0|[1-9][0-9]{0,9})(?:[.,]([0-9]{1,2}))?$/.exec(raw);
  if (!match) return undefined;
  const result = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents(result) ? result : undefined;
}
export function packagingQuantityInput(
  value: FormDataEntryValue | null,
  required = false,
): number | null | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return required ? undefined : null;
  if (!/^(0|[1-9][0-9]{0,9})$/.test(raw)) return undefined;
  const result = Number(raw);
  return quantity(result) ? result : undefined;
}
export const packagingTypeLabel = (value: PackagingType) =>
  value === "box"
    ? "Scatola per T-shirt"
    : value === "sticker"
      ? "Adesivo per scatola"
      : "Altro materiale";
export const packagingCost = (value: number | null) =>
  value === null
    ? "Da inserire"
    : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value / 100);

export type PackagingRows = {
  settings: unknown;
  items: unknown[];
  packaging: unknown[];
  locations: unknown[];
  availability: unknown[];
};
const fail = (): never => {
  throw new Error("La lettura dei materiali non è completa. Ricarica la pagina.");
};
const record = (value: unknown) => stockRecord(value) ?? fail();
const id = (value: unknown) => (stockUuid(value) ? value.toLowerCase() : fail());
const text = (value: unknown, max: number) => (string(value, 1, max) ? value : fail());
const bool = (value: unknown) => (typeof value === "boolean" ? value : fail());
const unique = (values: string[]) => {
  if (new Set(values).size !== values.length) fail();
};
function databaseCost(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") return fail();
  const result = packagingCostInput(String(value));
  return result === undefined ? fail() : result;
}
export function packagingSnapshotFromRows(
  rows: PackagingRows,
  loadedAt = new Date().toISOString(),
): PackagingSnapshot {
  const enabled = bool(record(rows.settings).stock_adjustments_enabled);
  const metadata = rows.packaging.map((value) => {
    const row = record(value);
    if (
      !type(row.packaging_type) ||
      !(row.specifications === null || string(row.specifications, 0, 2000))
    )
      fail();
    return {
      id: id(row.stock_item_id),
      packagingType: row.packaging_type as PackagingType,
      specifications: row.specifications as string | null,
    };
  });
  unique(metadata.map((row) => row.id));
  const items = rows.items.map((value) => {
    const row = record(value);
    if (row.kind !== "packaging") fail();
    const key = id(row.id),
      extra = metadata.find((item) => item.id === key) ?? fail();
    return {
      id: key,
      sku: text(row.sku, 120),
      name: text(row.name, 240),
      active: bool(row.active),
      packagingType: extra.packagingType,
      specifications: extra.specifications,
      unitCostCents: databaseCost(row.unit_cost_eur),
    };
  });
  unique(items.map((row) => row.id));
  unique(items.map((row) => row.sku));
  if (items.length !== metadata.length) fail();
  const locations = rows.locations.map((value) => {
    const row = record(value);
    return {
      id: id(row.id),
      code: text(row.code, 120),
      name: text(row.name, 240),
      active: bool(row.active),
    };
  });
  unique(locations.map((row) => row.id));
  const itemIds = new Set(items.map((row) => row.id)),
    locationIds = new Set(locations.map((row) => row.id));
  const availability = rows.availability.map((value) => {
    const row = record(value);
    const itemId = id(row.stock_item_id),
      locationId = id(row.location_id);
    if (
      !itemIds.has(itemId) ||
      !locationIds.has(locationId) ||
      !(row.on_hand === null || balanceQuantity(row.on_hand)) ||
      !balanceQuantity(row.reserved) ||
      !(row.available === null || balanceQuantity(row.available)) ||
      (row.on_hand === null
        ? row.available !== null || row.reserved !== 0
        : row.available !== (row.on_hand as number) - (row.reserved as number))
    )
      fail();
    return {
      itemId,
      locationId,
      onHand: row.on_hand as number | null,
      reserved: row.reserved as number,
      available: row.available as number | null,
    };
  });
  unique(availability.map((row) => `${row.itemId}:${row.locationId}`));
  // A missing balance has never been counted. It remains unknown, never zero.
  for (const item of items)
    for (const location of locations)
      if (!availability.some((row) => row.itemId === item.id && row.locationId === location.id))
        availability.push({
          itemId: item.id,
          locationId: location.id,
          onHand: null,
          reserved: 0,
          available: null,
        });
  items.sort((a, b) => a.sku.localeCompare(b.sku, "it"));
  locations.sort((a, b) => a.code.localeCompare(b.code, "it"));
  return { enabled, loadedAt, items, locations, availability };
}
