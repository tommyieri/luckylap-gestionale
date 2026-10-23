import { describe, expect, it } from "vitest";
import {
  parseSaleReturnInput,
  parseSaleReturnPreviewInput,
  saleReturnPayload,
  saleReturnPreviewFromDatabase,
} from "./model";
const id = (n: number) => `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = {
  userId: id(1),
  orderId: id(2),
  lines: [{ orderLineId: id(3), quantity: 2 }],
  reusableBoxes: 1,
  reusableStickers: 0,
  refundAccount: " Cash ",
};
const command = {
  ...base,
  operationId: id(4),
  expectedVersion: "b".repeat(64),
  occurredAt: "2026-03-17T10:00:00.000Z",
  reason: " Reso sintetico verificato ",
  refundCompletedConfirmed: true,
};
const now = new Date("2026-03-18T10:00:00.000Z");
const preview = {
  order_id: id(2),
  expected_version: "b".repeat(64),
  lines: [
    {
      order_line_id: id(3),
      sku: "SYN-RETURN",
      available_quantity: "3",
      selected_quantity: 2,
      refund_cents: "543",
    },
  ],
  product_quantity: 2,
  box_quantity: 1,
  sticker_quantity: 0,
  refund_cents: "543",
  refundable_cents: "900",
  remaining_value_cents: "900",
};
describe("contratto reso merce e rimborso contestuale", () => {
  it("distingue consultazione iniziale e comando con rimborso esplicitamente confermato", () => {
    expect(parseSaleReturnPreviewInput({ ...base, lines: [], refundAccount: "" })).toMatchObject({
      lines: [],
      refundAccount: "",
    });
    expect(parseSaleReturnInput({ ...command, lines: [] }, now)).toBeNull();
    expect(parseSaleReturnInput(command, now)).toEqual({
      ...command,
      reason: command.reason.trim(),
      refundAccount: "Cash",
    });
    expect(saleReturnPayload(parseSaleReturnPreviewInput(base)!)).toEqual({
      schema_version: 1,
      order_id: id(2),
      lines: [{ order_line_id: id(3), quantity: 2 }],
      reusable_boxes: 1,
      reusable_stickers: 0,
      refund_account: "Cash",
    });
  });
  it.each([
    { lines: [{ orderLineId: id(3), quantity: 0 }] },
    { lines: [{ orderLineId: id(3), quantity: 100_001 }] },
    {
      lines: [
        { orderLineId: id(3), quantity: 1 },
        { orderLineId: id(3), quantity: 1 },
      ],
    },
    { lines: [{ orderLineId: id(3), quantity: 1, refundCents: 543 }] },
    { lines: Array.from({ length: 51 }, (_, i) => ({ orderLineId: id(i + 10), quantity: 1 })) },
    { reusableBoxes: -1 },
    { reusableStickers: 1.5 },
    { reusableBoxes: 5_000_001 },
    { refundAccount: " " },
    { refundAccount: "x".repeat(121) },
    { other: "unexpected" },
  ])("rifiuta input non valido %j", (patch) => {
    expect(parseSaleReturnPreviewInput({ ...base, ...patch })).toBeNull();
  });
  it.each([
    { refundCompletedConfirmed: false },
    { refundCompletedConfirmed: "true" },
    { expectedVersion: "b".repeat(63) },
    { occurredAt: "2026-03-19T10:00:00.000Z" },
    { occurredAt: "2026-02-30T10:00:00.000Z" },
    { occurredAt: "2026-03-17T10:00:00+0000" },
    { reason: "  x " },
    { retry: "true" },
    { refundCents: 543 },
  ])("rifiuta comando incompleto o modificato %j", (patch) => {
    expect(parseSaleReturnInput({ ...command, ...patch }, now)).toBeNull();
  });
  it("verifica somme, quantità selezionate e precisione nel protocollo del database", () => {
    expect(saleReturnPreviewFromDatabase(preview)).toMatchObject({
      productQuantity: 2,
      boxQuantity: 1,
      refundCents: 543,
      lines: [{ orderLineId: id(3), selectedQuantity: 2, availableQuantity: 3 }],
    });
    for (const patch of [
      { product_quantity: 1 },
      { refund_cents: "542" },
      { lines: [{ ...preview.lines[0], selected_quantity: 4 }] },
      { lines: [preview.lines[0], preview.lines[0]] },
      { refund_cents: "9000000000000001" },
      { expected_version: "bad" },
    ])
      expect(saleReturnPreviewFromDatabase({ ...preview, ...patch })).toBeNull();
  });
});
