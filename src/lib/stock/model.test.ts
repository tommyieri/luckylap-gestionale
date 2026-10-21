import { describe, expect, it } from "vitest";
import { parseStockAdjustment, stockFormDelta, stockQuantity } from "./model";
import { stockSnapshotFromRows, type StockRows } from "./read";

const id = "00000000-0000-4000-8000-000000000001";
const location = "00000000-0000-4000-8000-000000000002";
const operation = "00000000-0000-4000-8000-000000000003";
const command = { operationId: operation, itemId: id, locationId: location, delta: -3, reason: "Synthetic count difference" };
const rows = (): StockRows => ({ settings: { stock_adjustments_enabled: false }, items: [{ id, sku: "SYNTHETIC", name: "Synthetic only", kind: "product", active: true }], locations: [{ id: location, code: "TEST", name: "Synthetic location", active: true }], availability: [{ stock_item_id: id, location_id: location, on_hand: 10, reserved: 2, available: 8 }] });

describe("stock adjustment boundary", () => {
  it("accepts only exact IDs, bounded nonzero delta and a trimmed reason", () => {
    expect(parseStockAdjustment({ ...command, reason: "  Synthetic count difference  " })).toEqual(command);
    expect(parseStockAdjustment({ ...command, delta: 1_000_000_000, retry: true })).toMatchObject({ delta: 1_000_000_000, retry: true });
    expect(parseStockAdjustment({ ...command, delta: -1_000_000_000 })).toMatchObject({ delta: -1_000_000_000 });
  });
  it.each([null, {}, { ...command, operationId: "not a uuid" }, { ...command, itemId: "SYNTHETIC" }, { ...command, locationId: "central" }, { ...command, delta: "3" }, { ...command, delta: 0 }, { ...command, delta: -0.5 }, { ...command, delta: 1_000_000_001 }, { ...command, reason: "ab" }, { ...command, reason: "x".repeat(501) }, { ...command, retry: "true" }, { ...command, quantity: 3 }, { ...command, actor_id: id }, { ...command, expected_quantity: 10 }])("rejects malformed or authority-bearing fields", value => expect(parseStockAdjustment(value)).toBeNull());
  it("converts form direction and integer text to a delta without absolute balances", () => {
    expect(stockFormDelta("add", "3")).toBe(3);
    expect(stockFormDelta("remove", "3")).toBe(-3);
    for (const value of ["0", "-3", "+3", "1.5", "1e3", "03", " 3 ", "1000000001"]) expect(stockFormDelta("add", value)).toBeNull();
  });
  it("keeps known zero separate from unknown quantities", () => {
    expect(stockQuantity(0)).toBe("0");
    expect(stockQuantity(null)).toBe("Da verificare");
    expect(stockQuantity(undefined)).toBe("Da verificare");
  });
});

describe("complete stock projection", () => {
  it("uses server on_hand, reserved and available as separate quantities", () => {
    expect(stockSnapshotFromRows(rows()).availability[0]).toEqual({ itemId: id, locationId: location, onHand: 10, reserved: 2, available: 8 });
  });
  it("allows an uncounted balance or missing balance without inventing zero", () => {
    const source = rows(); source.availability[0] = { stock_item_id: id, location_id: location, on_hand: null, reserved: 0, available: null };
    expect(stockSnapshotFromRows(source).availability[0].onHand).toBeNull();
    source.availability = [];
    expect(stockSnapshotFromRows(source).availability).toEqual([]);
  });
  it.each([
    (r: StockRows) => { r.items.push(r.items[0]); },
    (r: StockRows) => { r.availability.push(r.availability[0]); },
    (r: StockRows) => { (r.availability[0] as Record<string, unknown>).available = 9; },
    (r: StockRows) => { (r.availability[0] as Record<string, unknown>).reserved = 11; },
    (r: StockRows) => { (r.availability[0] as Record<string, unknown>).on_hand = null; },
    (r: StockRows) => { (r.availability[0] as Record<string, unknown>).stock_item_id = operation; },
    (r: StockRows) => { (r.availability[0] as Record<string, unknown>).on_hand = "10"; },
  ])("refuses inconsistent, duplicated or incomplete joined data", mutate => { const source = rows(); mutate(source); expect(() => stockSnapshotFromRows(source)).toThrow(/lettura/); });
});
