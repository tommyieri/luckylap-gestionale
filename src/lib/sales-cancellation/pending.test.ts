import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/sales/model", () => import("../sales/model"));
import {
  clearSaleCancellation,
  preserveSaleCancellation,
  readPendingSaleCancellation,
  type PendingSaleCancellation,
} from "./pending";

const id = (n: number) => `89000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
const input: PendingSaleCancellation = {
  operationId: id(1),
  userId: id(2),
  orderId: id(3),
  expectedVersion: "b".repeat(64),
  reason: "Vendita sintetica inserita per prova",
  confirmStock: true,
};

describe("tentativi recuperabili di annullamento vendita", () => {
  it("conserva UUID e dati per persona/vendita e rifiuta nuovi invii finché manca l’esito", () => {
    const store = memory();
    preserveSaleCancellation(store, input);
    expect(readPendingSaleCancellation(store, id(2), id(3))).toEqual(input);
    expect(readPendingSaleCancellation(store, id(4), id(3))).toBeNull();
    expect(readPendingSaleCancellation(store, id(2), id(4))).toBeNull();
    expect(() => preserveSaleCancellation(store, { ...input, operationId: id(5) })).toThrow();
    expect(() =>
      preserveSaleCancellation(store, { ...input, reason: "Un altro motivo" }),
    ).toThrow();
    expect(() =>
      preserveSaleCancellation(store, { ...input, expectedVersion: "c".repeat(64) }),
    ).toThrow();
    expect(preserveSaleCancellation(store, input)).toEqual(input);
  });

  it("svuota solo il tentativo corrispondente all’esito definitivo", () => {
    const store = memory();
    preserveSaleCancellation(store, input);
    expect(() => clearSaleCancellation(store, { ...input, operationId: id(5) })).toThrow();
    expect(readPendingSaleCancellation(store, id(2), id(3))).toEqual(input);
    clearSaleCancellation(store, input);
    expect(readPendingSaleCancellation(store, id(2), id(3))).toBeNull();
  });

  it("si ferma su dati corrotti, di un’altra vendita o alterati", () => {
    const store = memory();
    preserveSaleCancellation(store, input);
    const [key] = store.values.keys();
    for (const raw of [
      "{",
      "x".repeat(4001),
      JSON.stringify({ ...input, orderId: id(5) }),
      JSON.stringify({ ...input, userId: id(5) }),
      JSON.stringify({ ...input, confirmStock: false }),
      JSON.stringify({ ...input, reason: "ab" }),
      JSON.stringify({ ...input, expectedVersion: "non valido" }),
      JSON.stringify({ ...input, retry: true }),
    ]) {
      store.setItem(key, raw);
      expect(() => readPendingSaleCancellation(store, id(2), id(3))).toThrow();
      expect(() => preserveSaleCancellation(store, input)).toThrow();
    }
  });

  it("propaga il blocco dello storage senza inventare un esito", () => {
    expect(() =>
      preserveSaleCancellation(
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
