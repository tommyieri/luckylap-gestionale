import { describe, expect, it } from "vitest";
import { packagingCostInput, packagingQuantityInput, packagingSnapshotFromRows, parsePackagingCommand, parsePackagingCount, parsePackagingCreate } from "./model";

const operationId = "00000000-0000-4000-8000-000000000001", itemId = "00000000-0000-4000-8000-000000000002", locationId = "00000000-0000-4000-8000-000000000003";
const create = { operationId, payload: { schema_version: 1, sku: "SYN-BOX", name: "Synthetic box", packaging_type: "box", specifications: null, unit_cost_cents: null, location_id: locationId, initial_quantity: null } };
const count = { operationId, payload: { schema_version: 1, stock_item_id: itemId, location_id: locationId, quantity: 0, reason: "Synthetic count" } };
describe("packaging exact inputs and immutable command shape", () => {
  it("preserves explicitly unknown cost/count and an explicitly counted zero", () => {
    expect(parsePackagingCreate(create)?.payload).toMatchObject({ initial_quantity: null, unit_cost_cents: null });
    expect(parsePackagingCreate({ ...create, payload: { ...create.payload, initial_quantity: 0, unit_cost_cents: 0 } })?.payload).toMatchObject({ initial_quantity: 0, unit_cost_cents: 0 });
    expect(parsePackagingCount(count)?.payload.quantity).toBe(0);
  });
  it.each([["0,29", 29], ["0.01", 1], ["1,2", 120], ["9999999999.99", 999999999999], ["", null], [" ", null], ["0", 0]])("converts %s euros exactly", (input, expected) => expect(packagingCostInput(String(input))).toBe(expected));
  it.each(["1.000,00", "1e3", "-1", ".5", "1.999", "NaN", "10000000000", "01.00", "1,23,4"])("rejects ambiguous or out-of-range money %s", input => expect(packagingCostInput(input)).toBeUndefined());
  it("distinguishes blank quantity from zero, requiring a deliberate count when initializing", () => {
    expect(packagingQuantityInput("")).toBeNull(); expect(packagingQuantityInput("0")).toBe(0); expect(packagingQuantityInput("", true)).toBeUndefined();
    for (const value of ["1.0", "1e3", "-1", "1000000001"]) expect(packagingQuantityInput(value)).toBeUndefined();
  });
  it("rejects unknown fields, roles and invalid command bounds", () => {
    expect(parsePackagingCreate({ ...create, actor_id: itemId })).toBeNull();
    expect(parsePackagingCreate({ ...create, payload: { ...create.payload, kind: "product" } })).toBeNull();
    for (const initial_quantity of [-1, 1.5, 1_000_000_001, NaN]) expect(parsePackagingCreate({ ...create, payload: { ...create.payload, initial_quantity } })).toBeNull();
    expect(parsePackagingCount({ ...count, payload: { ...count.payload, reason: " x " } })).toBeNull();
    expect(parsePackagingCommand({ kind: "create", command: create })).toMatchObject({ kind: "create", command: create });
    expect(parsePackagingCommand({ kind: "other", command: create })).toBeNull();
  });
});
describe("complete packaging join and physical count semantics", () => {
  const rows = () => ({ settings: { stock_adjustments_enabled: false }, items: [{ id: itemId, sku: "SYN-BOX", name: "Synthetic box", kind: "packaging", active: true, unit_cost_eur: "0.29" }], packaging: [{ stock_item_id: itemId, packaging_type: "box", specifications: null }], locations: [{ id: locationId, code: "TEST", name: "Synthetic location", active: true }], availability: [] as unknown[] });
  it("does not treat an absent balance as a counted zero", () => {
    const result = packagingSnapshotFromRows(rows()); expect(result.items[0].unitCostCents).toBe(29);
    expect(result.availability[0]).toEqual({ itemId, locationId, onHand: null, available: null, reserved: 0 });
    const known = rows(); known.availability = [{ stock_item_id: itemId, location_id: locationId, on_hand: 0, reserved: 0, available: 0 }];
    expect(packagingSnapshotFromRows(known).availability[0].onHand).toBe(0);
    known.availability = [{ stock_item_id: itemId, location_id: locationId, on_hand: 2_000_000_000, reserved: 0, available: 2_000_000_000 }];
    expect(packagingSnapshotFromRows(known).availability[0].onHand).toBe(2_000_000_000);
  });
  it("rejects missing/duplicate metadata, orphan balances and incoherent reservations", () => {
    const missing = rows(); missing.packaging = []; expect(() => packagingSnapshotFromRows(missing)).toThrow(/completa/);
    const duplicate = rows(); duplicate.packaging.push(duplicate.packaging[0]); expect(() => packagingSnapshotFromRows(duplicate)).toThrow(/completa/);
    for (const available of [0, -1, null]) {
      const bad = rows(); bad.availability = [{ stock_item_id: itemId, location_id: locationId, on_hand: 10, reserved: 2, available }];
      expect(() => packagingSnapshotFromRows(bad)).toThrow(/completa/);
    }
  });
});
