import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSalePayload, quantityCommandPayload } from "./forms";
import { salesSnapshotFromRows } from "./read";
import { syntheticId, syntheticRows } from "./fixtures";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-21T18:00:00Z")); });
afterEach(() => vi.useRealTimers());
function form() {
  const f = new FormData();
  for (const [key, value] of Object.entries({ itemId: syntheticId(1), quantity: "2", unitPrice: "40,01", discount: "1,00", channel: "direct", locationId: syntheticId(2), occurredAt: "2026-10-21T10:00:00", mode: "prepare", reason: "Synthetic agreed discount", paymentState: "paid", method: "cash" })) f.set(key, value);
  return f;
}
describe("sales form commands", () => {
  it("creates an exact total/row discount, cash method and explicit Rome timestamp", () => {
    const payload = newSalePayload(form(), salesSnapshotFromRows(syntheticRows()));
    expect(payload.lines).toEqual([{ stock_item_id: syntheticId(1), quantity: 2, unit_price_cents: 4001, discount_cents: 100 }]);
    expect(payload.payment).toEqual({ status: "paid", method: "cash", amount_cents: 7902, occurred_at: "2026-10-21T08:00:00.000Z" });
    expect(payload.channel).toBe("direct");
  });
  it("rejects discounts without a reason, duplicate SKUs, unknown locations and Shopify POS", () => {
    const snapshot = salesSnapshotFromRows(syntheticRows());
    for (const mutate of [
      (f: FormData) => f.set("reason", ""),
      (f: FormData) => { f.append("itemId", syntheticId(1)); f.append("quantity", "1"); f.append("unitPrice", "40,01"); f.append("discount", "0"); },
      (f: FormData) => f.set("locationId", syntheticId(999)),
      (f: FormData) => f.set("channel", "shopify_pos"),
    ]) { const f = form(); mutate(f); expect(() => newSalePayload(f, snapshot)).toThrow(); }
  });
  it("selects only positive lifecycle quantities and requires a reason", () => {
    const f = new FormData(); f.set("occurredAt", "2026-10-21T10:00:00"); f.set("reason", "Synthetic physical dispatch"); f.set(`quantity:${syntheticId(5)}`, "1"); f.set(`quantity:${syntheticId(7)}`, "0");
    expect(quantityCommandPayload(f, "fulfill_order_lines", syntheticId(3), [syntheticId(5), syntheticId(7)]).lines).toEqual([{ order_line_id: syntheticId(5), quantity: 1 }]);
    f.set(`quantity:${syntheticId(5)}`, "0");
    expect(() => quantityCommandPayload(f, "fulfill_order_lines", syntheticId(3), [syntheticId(5)])).toThrow();
  });
});
