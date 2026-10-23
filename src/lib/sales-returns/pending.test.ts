import { describe, expect, it } from "vitest";
import {
  clearSaleReturn,
  preserveSaleReturn,
  readPendingSaleReturn,
  type PendingSaleReturn,
} from "./pending";
const id = (n: number) => `88000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function memory() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
const input: PendingSaleReturn = {
  userId: id(1),
  orderId: id(2),
  operationId: id(3),
  lines: [{ orderLineId: id(4), quantity: 1 }],
  reusableBoxes: 0,
  reusableStickers: 0,
  refundAccount: "Conto demo",
  expectedVersion: "d".repeat(64),
  occurredAt: "2026-06-02T08:00:00.000Z",
  reason: "Reso sintetico",
  refundCompletedConfirmed: true,
};
describe("tentativi recuperabili di reso", () => {
  it("conserva un solo UUID/payload per persona e vendita, senza sostituire il reso incerto", () => {
    const store = memory();
    preserveSaleReturn(store, input);
    expect(readPendingSaleReturn(store, id(1), id(2))).toEqual(input);
    expect(readPendingSaleReturn(store, id(9), id(2))).toBeNull();
    expect(readPendingSaleReturn(store, id(1), id(9))).toBeNull();
    for (const patch of [
      { operationId: id(9) },
      { reusableBoxes: 1 },
      { refundAccount: "Altro conto demo" },
      { occurredAt: "2026-06-02T09:00:00.000Z" },
      { lines: [{ orderLineId: id(4), quantity: 2 }] },
    ])
      expect(() => preserveSaleReturn(store, { ...input, ...patch })).toThrow();
    expect(preserveSaleReturn(store, input)).toEqual(input);
  });
  it("svuota soltanto il tentativo corrispondente, non quello di un altro esito", () => {
    const store = memory();
    preserveSaleReturn(store, input);
    expect(() => clearSaleReturn(store, { ...input, operationId: id(9) })).toThrow();
    expect(readPendingSaleReturn(store, id(1), id(2))).toEqual(input);
    clearSaleReturn(store, input);
    expect(readPendingSaleReturn(store, id(1), id(2))).toBeNull();
  });
  it("si blocca su storage corrotto, contraffatto o non disponibile", () => {
    const store = memory();
    preserveSaleReturn(store, input);
    const [key] = store.values.keys();
    for (const raw of [
      "{",
      "x".repeat(20001),
      JSON.stringify({ ...input, userId: id(9) }),
      JSON.stringify({ ...input, refundCompletedConfirmed: false }),
      JSON.stringify({ ...input, retry: true }),
    ]) {
      store.setItem(key, raw);
      expect(() => readPendingSaleReturn(store, id(1), id(2))).toThrow();
      expect(() => preserveSaleReturn(store, input)).toThrow();
    }
    expect(() =>
      preserveSaleReturn(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error("quota sintetica");
          },
        },
        input,
      ),
    ).toThrow();
  });
});
