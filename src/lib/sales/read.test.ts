import { describe, expect, it } from "vitest";
import { readSalesPages, salesSnapshotFromRows } from "./read";
import { syntheticId, syntheticRows, externalSyntheticRows } from "./fixtures";

describe("complete sales reads", () => {
  it("reads all exact-count pages and refuses shortened data or changing counts", async () => {
    const rows = [1, 2, 3];
    const ranges: number[][] = [];
    expect(
      await readSalesPages(async (from, to) => {
        ranges.push([from, to]);
        return { data: rows.slice(from, to + 1), count: 3, error: null };
      }, 2),
    ).toEqual(rows);
    expect(ranges).toEqual([
      [0, 1],
      [2, 3],
    ]);
    await expect(
      readSalesPages(async () => ({ data: [], count: 2, error: null })),
    ).rejects.toThrow();
    await expect(
      readSalesPages(async () => ({ data: [], count: null, error: null })),
    ).rejects.toThrow();
    let n = 0;
    await expect(
      readSalesPages(async () => ({ data: [1, 2], count: ++n === 1 ? 3 : 4, error: null }), 2),
    ).rejects.toThrow();
  });
  it("connects reservation and production projections without converting unknown cost to zero", () => {
    const rows = syntheticRows();
    (rows.lines[0] as Record<string, unknown>).unit_cost_cents = null;
    const snapshot = salesSnapshotFromRows(rows);
    expect(snapshot.orders[0].lines[0].reserved).toBe(1);
    expect(snapshot.requirements[0].required).toBe(1);
    expect(snapshot.orders[0].lines[0].costCents).toBeNull();
    expect(snapshot.items[0].costCents).toBe(1320);
    expect(snapshot.enabled).toBe(false);
  });
  it("refuses orphan lines, missing requirements, wrong reservation sums and economic totals", () => {
    for (const mutate of [
      (rows: ReturnType<typeof syntheticRows>) => {
        rows.orders = [];
      },
      (rows: ReturnType<typeof syntheticRows>) => {
        rows.requirements = [];
      },
      (rows: ReturnType<typeof syntheticRows>) => {
        rows.reservations = [];
      },
      (rows: ReturnType<typeof syntheticRows>) => {
        (rows.orders[0] as Record<string, unknown>).total_cents = 1;
      },
    ]) {
      const rows = syntheticRows();
      mutate(rows);
      expect(() => salesSnapshotFromRows(rows)).toThrow("Lettura vendite non completa.");
    }
  });
  it("keeps packaging balances out of product totals while reading the shared stock view completely", () => {
    const rows = syntheticRows();
    rows.availability.push({
      stock_item_id: syntheticId(100),
      location_id: syntheticId(2),
      on_hand: 30,
      reserved: 0,
      available: 30,
    });
    const snapshot = salesSnapshotFromRows(rows);
    expect(snapshot.availability).toHaveLength(1);
    expect(snapshot.availability[0].onHand).toBe(5);
  });
  it.each(["shopify_web", "shopify_pos"])(
    "reads %s and extra order components while preserving original line economics",
    (channel) => {
      const snapshot = salesSnapshotFromRows(externalSyntheticRows(channel));
      expect(snapshot.orders[0]).toMatchObject({
        source: "shopify_canonical",
        channel,
        paymentState: "partially_paid",
        totalCents: 9002,
      });
      expect(snapshot.orders[0].lines[0].totalCents).toBe(8002);
    },
  );
  it("refuses mixed line/order provenance and Shopify payment states on manual orders", () => {
    const rows = externalSyntheticRows();
    (rows.lines[0] as Record<string, unknown>).source_kind = "manual_declaration";
    expect(() => salesSnapshotFromRows(rows)).toThrow();
    const manual = syntheticRows();
    (manual.orders[0] as Record<string, unknown>).payment_state = "partially_paid";
    expect(() => salesSnapshotFromRows(manual)).toThrow();
  });
  it("restricts the sale's physical locations and availability to warehouses and consignment shops", () => {
    const rows = syntheticRows();
    rows.locations.push({
      id: syntheticId(100),
      code: "FORN",
      name: "Synthetic external",
      active: true,
      location_type: "Esterno",
    });
    rows.availability.push({
      stock_item_id: syntheticId(1),
      location_id: syntheticId(100),
      on_hand: 999,
      reserved: 0,
      available: 999,
    });
    expect(salesSnapshotFromRows(rows).locations).toHaveLength(1);
    expect(salesSnapshotFromRows(rows).availability).toHaveLength(1);
  });
  it("still rejects an availability row pointing to a missing location", () => {
    const rows = syntheticRows();
    rows.availability.push({
      stock_item_id: syntheticId(1),
      location_id: syntheticId(999),
      on_hand: 1,
      reserved: 0,
      available: 1,
    });
    expect(() => salesSnapshotFromRows(rows)).toThrow();
  });
});
