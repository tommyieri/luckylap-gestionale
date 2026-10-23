import { isUuid, record, safeInteger } from "../sales/model";

export type SaleCancellationPreview = {
  orderId: string;
  expectedVersion: string;
  productQuantity: number;
  boxQuantity: number;
  stickerQuantity: number;
  paymentCents: number;
  alreadyCancelled: boolean;
};
export type SaleCancellationPreviewResult =
  | { status: "ready"; preview: SaleCancellationPreview }
  | { status: "rejected"; code: string; message: string };
export type SaleCancellationInput = {
  operationId: string;
  userId: string;
  orderId: string;
  expectedVersion: string;
  reason: string;
  confirmStock: true;
  retry?: boolean;
};

export const versionDigest = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
export const databaseInteger = (value: unknown, max = 9_000_000_000_000_000): number | null => {
  if (safeInteger(value, 0, max)) return value;
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,15})$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= BigInt(max) ? Number(parsed) : null;
};
export const databaseSignedInteger = (value: unknown): number | null => {
  if (safeInteger(value, -9_000_000_000_000_000, 9_000_000_000_000_000)) return value;
  if (typeof value !== "string" || !/^-?(0|[1-9]\d{0,15})$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed >= -9_000_000_000_000_000n && parsed <= 9_000_000_000_000_000n
    ? Number(parsed)
    : null;
};
export function parseSaleCancellationInput(value: unknown): SaleCancellationInput | null {
  const row = record(value);
  if (
    !row ||
    !isUuid(row.operationId) ||
    !isUuid(row.userId) ||
    !isUuid(row.orderId) ||
    !versionDigest(row.expectedVersion) ||
    row.confirmStock !== true ||
    typeof row.reason !== "string" ||
    row.reason.trim().length < 3 ||
    row.reason.trim().length > 500 ||
    (row.retry !== undefined && typeof row.retry !== "boolean") ||
    Object.keys(row).some(
      (key) =>
        ![
          "operationId",
          "userId",
          "orderId",
          "expectedVersion",
          "reason",
          "confirmStock",
          "retry",
        ].includes(key),
    )
  )
    return null;
  return {
    operationId: row.operationId,
    userId: row.userId,
    orderId: row.orderId,
    expectedVersion: row.expectedVersion,
    reason: row.reason.trim(),
    confirmStock: true,
    ...(row.retry === undefined ? {} : { retry: row.retry }),
  };
}
export function saleCancellationPreviewFromDatabase(
  value: unknown,
): SaleCancellationPreview | null {
  const row = record(value);
  if (
    !row ||
    !isUuid(row.order_id) ||
    !versionDigest(row.expected_version) ||
    typeof row.already_cancelled !== "boolean"
  )
    return null;
  const productQuantity = databaseInteger(row.product_quantity, 5_000_000);
  const boxQuantity = databaseInteger(row.box_quantity, 5_000_000);
  const stickerQuantity = databaseInteger(row.sticker_quantity, 5_000_000);
  const paymentCents = databaseSignedInteger(row.payment_cents);
  if (
    productQuantity === null ||
    boxQuantity === null ||
    stickerQuantity === null ||
    paymentCents === null
  )
    return null;
  return {
    orderId: row.order_id,
    expectedVersion: row.expected_version,
    productQuantity,
    boxQuantity,
    stickerQuantity,
    paymentCents,
    alreadyCancelled: row.already_cancelled,
  };
}
