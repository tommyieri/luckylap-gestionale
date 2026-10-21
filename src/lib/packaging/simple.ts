import { stockRecord, stockUuid } from "../stock/model";
export type SimplePackagingItem = {
  id: string;
  name: string;
  packagingType: "box" | "sticker";
  specifications: string | null;
  onHand: number | null;
  reserved: number;
  unreserved: number | null;
  deficit: number;
  reconcilable: number;
  historicalReview: number;
};
export type SimplePackagingSnapshot = {
  enabled: boolean;
  loadedAt: string;
  startedAt: string | null;
  locationName: string | null;
  items: SimplePackagingItem[];
  failures: number;
};
export type SimplePackagingCommand =
  | {
      operationId: string;
      kind: "adjust";
      payload: {
        schema_version: 1;
        stock_item_id: string;
        expected_quantity: number | null;
        quantity: number;
        reason: string;
      };
      retry?: boolean;
    }
  | { operationId: string; kind: "reconcile"; payload: { schema_version: 1 }; retry?: boolean };
export type SimplePackagingResult =
  | { status: "success"; replayed: boolean; remainingDeficit: number; message: string }
  | { status: "rejected"; code: string; message: string }
  | { status: "uncertain"; message: string };
const exact = (row: Record<string, unknown>, keys: string[]) =>
  keys.length === Object.keys(row).length && keys.every((key) => Object.hasOwn(row, key));
const quantity = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
export function parseSimplePackagingCommand(value: unknown): SimplePackagingCommand | null {
  const row = stockRecord(value),
    p = stockRecord(row?.payload);
  if (
    !row ||
    !p ||
    !stockUuid(row.operationId) ||
    Object.keys(row).some((key) => !["operationId", "kind", "payload", "retry"].includes(key)) ||
    (row.retry !== undefined && typeof row.retry !== "boolean")
  )
    return null;
  const base = {
    operationId: row.operationId.toLowerCase(),
    ...(row.retry === undefined ? {} : { retry: row.retry }),
  };
  if (row.kind === "reconcile" && exact(p, ["schema_version"]) && p.schema_version === 1)
    return { ...base, kind: "reconcile", payload: { schema_version: 1 } };
  if (
    row.kind !== "adjust" ||
    !exact(p, ["schema_version", "stock_item_id", "expected_quantity", "quantity", "reason"]) ||
    p.schema_version !== 1 ||
    !stockUuid(p.stock_item_id) ||
    !(p.expected_quantity === null || quantity(p.expected_quantity)) ||
    !quantity(p.quantity) ||
    typeof p.reason !== "string" ||
    p.reason.trim().length < 3 ||
    p.reason.trim().length > 500
  )
    return null;
  return {
    ...base,
    kind: "adjust",
    payload: {
      schema_version: 1,
      stock_item_id: p.stock_item_id.toLowerCase(),
      expected_quantity: p.expected_quantity,
      quantity: p.quantity,
      reason: p.reason.trim(),
    },
  };
}
export function simpleQuantityInput(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,9})$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return quantity(parsed) ? parsed : null;
}
const fail = (): never => {
  throw new Error("Lettura packaging incompleta. Rileggi i materiali.");
};
function integer(value: unknown, signed = false): number {
  if (typeof value === "string" && /^-?\d+$/.test(value)) value = Number(value);
  return typeof value === "number" && Number.isSafeInteger(value) && (signed || value >= 0)
    ? value
    : fail();
}
export function simplePackagingSnapshot(
  settings: unknown,
  configValue: unknown,
  rawRows: unknown[],
  locationName: string | null,
  loadedAt = new Date().toISOString(),
): SimplePackagingSnapshot {
  const setting = stockRecord(settings) ?? fail(),
    config = stockRecord(configValue) ?? fail();
  const enabled =
    typeof setting.stock_adjustments_enabled === "boolean"
      ? setting.stock_adjustments_enabled
      : fail();
  if (!(
    config.started_at === null ||
    (typeof config.started_at === "string" && Number.isFinite(Date.parse(config.started_at)))
  ))
    fail();
  const startedAt = config.started_at as string | null;
  if (startedAt === null) {
    if (rawRows.length) fail();
    return { enabled, loadedAt, startedAt, locationName: null, items: [], failures: 0 };
  }
  if (
    !stockUuid(config.location_id) ||
    !stockUuid(config.box_item_id) ||
    !stockUuid(config.sticker_item_id) ||
    config.box_item_id === config.sticker_item_id ||
    rawRows.length !== 2 ||
    !locationName
  )
    fail();
  let failures = 0;
  const items = rawRows.map((value) => {
    const row = stockRecord(value) ?? fail();
    if (
      !stockUuid(row.stock_item_id) ||
      row.location_id !== config.location_id ||
      row.started_at !== startedAt ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      !(row.specifications === null || typeof row.specifications === "string") ||
      (row.packaging_type !== "box" && row.packaging_type !== "sticker") ||
      row.stock_item_id !==
        (row.packaging_type === "box" ? config.box_item_id : config.sticker_item_id)
    )
      fail();
    const onHand = row.on_hand === null ? null : integer(row.on_hand),
      reserved = integer(row.reserved),
      unreserved = row.unreserved === null ? null : integer(row.unreserved, true);
    const deficit = integer(row.consumption_deficit),
      reconcilable = integer(row.reconcilable_deficit),
      historicalReview = integer(row.historical_review);
    if (
      (onHand === null ? unreserved !== null : unreserved !== onHand - reserved) ||
      deficit !== reconcilable + historicalReview
    )
      fail();
    failures = Math.max(failures, integer(row.automation_failures));
    return {
      id: row.stock_item_id as string,
      name: row.name as string,
      packagingType: row.packaging_type as "box" | "sticker",
      specifications: row.specifications as string | null,
      onHand,
      reserved,
      unreserved,
      deficit,
      reconcilable,
      historicalReview,
    };
  });
  if (
    new Set(items.map((item) => item.id)).size !== 2 ||
    new Set(items.map((item) => item.packagingType)).size !== 2
  )
    fail();
  items.sort((a, b) =>
    a.packagingType === b.packagingType ? 0 : a.packagingType === "box" ? -1 : 1,
  );
  return { enabled, loadedAt, startedAt, locationName, items, failures };
}
