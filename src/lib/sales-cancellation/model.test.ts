import { describe, expect, it } from "vitest";
import {
  databaseInteger,
  databaseSignedInteger,
  parseSaleCancellationInput,
  saleCancellationPreviewFromDatabase,
} from "./model";
const id = (n: number) => `95000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const command = {
  operationId: id(1),
  userId: id(2),
  orderId: id(3),
  expectedVersion: "a".repeat(64),
  reason: "  Prova sintetica da annullare  ",
  confirmStock: true,
};
const preview = {
  order_id: id(3),
  expected_version: "a".repeat(64),
  product_quantity: "2",
  box_quantity: 1,
  sticker_quantity: "0",
  payment_cents: "-543",
  already_cancelled: false,
};
describe("contratto annullo registrazione manuale", () => {
  it("normalizza solo il motivo e conserva identificatori, CAS e conferma", () => {
    expect(parseSaleCancellationInput(command)).toEqual({
      ...command,
      reason: command.reason.trim(),
    });
    expect(parseSaleCancellationInput({ ...command, retry: true })).toMatchObject({ retry: true });
  });
  it.each([
    { confirmStock: false },
    { confirmStock: "true" },
    { operationId: "invalid" },
    { userId: "invalid" },
    { orderId: "invalid" },
    { expectedVersion: "A".repeat(64) },
    { expectedVersion: "a".repeat(63) },
    { reason: "  x " },
    { reason: "x".repeat(501) },
    { retry: "true" },
    { amountCents: 123 },
  ])("rifiuta payload non valido %j", (patch) => {
    expect(parseSaleCancellationInput({ ...command, ...patch })).toBeNull();
  });
  it("legge il netto Finance con segno, zero e limiti senza perdere precisione", () => {
    expect(saleCancellationPreviewFromDatabase(preview)).toMatchObject({
      orderId: id(3),
      productQuantity: 2,
      boxQuantity: 1,
      stickerQuantity: 0,
      paymentCents: -543,
    });
    expect(databaseSignedInteger("-9000000000000000")).toBe(-9_000_000_000_000_000);
    expect(databaseSignedInteger("9000000000000000")).toBe(9_000_000_000_000_000);
    expect(databaseSignedInteger(0)).toBe(0);
    expect(databaseInteger("0")).toBe(0);
  });
  it.each([
    "9000000000000001",
    "-9000000000000001",
    "1.5",
    "1e3",
    " 10",
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rifiuta importo non intero o fuori limite %s", (value) => {
    expect(databaseSignedInteger(value)).toBeNull();
  });
  it.each([
    { product_quantity: 5_000_001 },
    { box_quantity: -1 },
    { sticker_quantity: 0.5 },
    { payment_cents: null },
    { already_cancelled: "false" },
    { order_id: "invalid" },
    { expected_version: "x".repeat(64) },
  ])("rifiuta preview incoerente %j", (patch) => {
    expect(saleCancellationPreviewFromDatabase({ ...preview, ...patch })).toBeNull();
  });
});
