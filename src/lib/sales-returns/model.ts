import { isUuid, record, safeInteger } from "../sales/model";
import { databaseInteger, versionDigest } from "../sales-cancellation/model";

export type SalesReturnSummary = { orderId: string; productQuantity: number; refundCents: number };
export type SaleReturnLineInput = { orderLineId: string; quantity: number };
export type SaleReturnPreviewInput = {
  userId: string;
  orderId: string;
  lines: SaleReturnLineInput[];
  reusableBoxes: number;
  reusableStickers: number;
  refundAccount: string;
};
export type SaleReturnInput = SaleReturnPreviewInput & {
  operationId: string;
  expectedVersion: string;
  occurredAt: string;
  reason: string;
  refundCompletedConfirmed: true;
  retry?: boolean;
};
export type SaleReturnPreview = {
  orderId: string;
  expectedVersion: string;
  lines: {
    orderLineId: string;
    sku: string;
    availableQuantity: number;
    selectedQuantity: number;
    refundCents: number;
  }[];
  productQuantity: number;
  boxQuantity: number;
  stickerQuantity: number;
  refundCents: number;
  refundableCents: number;
  remainingValueCents: number;
};
export type SaleReturnPreviewResult =
  | { status: "ready"; preview: SaleReturnPreview }
  | { status: "rejected"; code: string; message: string };
const baseKeys = [
  "userId",
  "orderId",
  "lines",
  "reusableBoxes",
  "reusableStickers",
  "refundAccount",
];
export function parseSaleReturnPreviewInput(
  value: unknown,
  allowCommandKeys = false,
): SaleReturnPreviewInput | null {
  const r = record(value);
  if (
    !r ||
    !isUuid(r.userId) ||
    !isUuid(r.orderId) ||
    !Array.isArray(r.lines) ||
    r.lines.length > 50 ||
    !safeInteger(r.reusableBoxes, 0, 5_000_000) ||
    !safeInteger(r.reusableStickers, 0, 5_000_000) ||
    typeof r.refundAccount !== "string" ||
    r.refundAccount.trim().length > 120 ||
    (r.lines.length > 0 && !r.refundAccount.trim()) ||
    (!allowCommandKeys && Object.keys(r).some((k) => !baseKeys.includes(k)))
  )
    return null;
  const lines: SaleReturnLineInput[] = [];
  for (const raw of r.lines) {
    const line = record(raw);
    if (
      !line ||
      Object.keys(line).sort().join(",") !== "orderLineId,quantity" ||
      !isUuid(line.orderLineId) ||
      !safeInteger(line.quantity, 1, 100_000) ||
      lines.some((l) => l.orderLineId === line.orderLineId)
    )
      return null;
    lines.push({ orderLineId: line.orderLineId, quantity: line.quantity });
  }
  return {
    userId: r.userId,
    orderId: r.orderId,
    lines,
    reusableBoxes: r.reusableBoxes,
    reusableStickers: r.reusableStickers,
    refundAccount: r.refundAccount.trim(),
  };
}
export function parseSaleReturnInput(value: unknown, now = new Date()): SaleReturnInput | null {
  const base = parseSaleReturnPreviewInput(value, true),
    r = record(value);
  if (
    !base ||
    !base.lines.length ||
    !r ||
    Object.keys(r).some(
      (k) =>
        ![
          ...baseKeys,
          "operationId",
          "expectedVersion",
          "occurredAt",
          "reason",
          "refundCompletedConfirmed",
          "retry",
        ].includes(k),
    ) ||
    !isUuid(r.operationId) ||
    !versionDigest(r.expectedVersion) ||
    r.refundCompletedConfirmed !== true ||
    typeof r.reason !== "string" ||
    r.reason.trim().length < 3 ||
    r.reason.trim().length > 500 ||
    typeof r.occurredAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.occurredAt) ||
    !Number.isFinite(Date.parse(r.occurredAt)) ||
    new Date(r.occurredAt).toISOString() !== r.occurredAt ||
    Date.parse(r.occurredAt) > now.getTime() ||
    (r.retry !== undefined && typeof r.retry !== "boolean")
  )
    return null;
  return {
    ...base,
    operationId: r.operationId,
    expectedVersion: r.expectedVersion,
    occurredAt: r.occurredAt,
    reason: r.reason.trim(),
    refundCompletedConfirmed: true,
    ...(r.retry === undefined ? {} : { retry: r.retry }),
  };
}
export function saleReturnPayload(input: SaleReturnPreviewInput) {
  return {
    schema_version: 1,
    order_id: input.orderId,
    lines: input.lines.map((l) => ({ order_line_id: l.orderLineId, quantity: l.quantity })),
    reusable_boxes: input.reusableBoxes,
    reusable_stickers: input.reusableStickers,
    refund_account: input.refundAccount,
  };
}
export function saleReturnPreviewFromDatabase(value: unknown): SaleReturnPreview | null {
  const r = record(value);
  if (
    !r ||
    !isUuid(r.order_id) ||
    !versionDigest(r.expected_version) ||
    !Array.isArray(r.lines) ||
    r.lines.length > 50
  )
    return null;
  const lines: SaleReturnPreview["lines"] = [];
  for (const raw of r.lines) {
    const l = record(raw),
      available = databaseInteger(l?.available_quantity, 100_000),
      selected = databaseInteger(l?.selected_quantity, 100_000),
      refund = databaseInteger(l?.refund_cents);
    if (
      !l ||
      !isUuid(l.order_line_id) ||
      typeof l.sku !== "string" ||
      !l.sku ||
      available === null ||
      selected === null ||
      selected > available ||
      refund === null ||
      lines.some((line) => line.orderLineId === l.order_line_id)
    )
      return null;
    lines.push({
      orderLineId: l.order_line_id,
      sku: l.sku,
      availableQuantity: available,
      selectedQuantity: selected,
      refundCents: refund,
    });
  }
  const productQuantity = databaseInteger(r.product_quantity, 5_000_000),
    boxQuantity = databaseInteger(r.box_quantity, 5_000_000),
    stickerQuantity = databaseInteger(r.sticker_quantity, 5_000_000),
    refundCents = databaseInteger(r.refund_cents),
    refundableCents = databaseInteger(r.refundable_cents),
    remainingValueCents = databaseInteger(r.remaining_value_cents);
  if (
    productQuantity === null ||
    boxQuantity === null ||
    stickerQuantity === null ||
    refundCents === null ||
    refundableCents === null ||
    remainingValueCents === null ||
    lines.reduce((n, l) => n + l.selectedQuantity, 0) !== productQuantity ||
    lines.reduce((n, l) => n + l.refundCents, 0) !== refundCents
  )
    return null;
  return {
    orderId: r.order_id,
    expectedVersion: r.expected_version,
    lines,
    productQuantity,
    boxQuantity,
    stickerQuantity,
    refundCents,
    refundableCents,
    remainingValueCents,
  };
}
