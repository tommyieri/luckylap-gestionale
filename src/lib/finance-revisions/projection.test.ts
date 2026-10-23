import { describe, expect, it } from "vitest";
import {
  applyFinanceRevisions,
  revisedAccountBalances,
  type RevisableMovement,
} from "./projection";
import type { FinanceRevisionOriginal, FinanceRevisionRecord } from "./model";
const id = (n: number) => `85000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const movement = (overrides: Partial<RevisableMovement> = {}): RevisableMovement => ({
  id: `payment:${id(1)}`,
  source: "payment",
  sourceId: id(1),
  date: "2026-03-17",
  cents: 10000n,
  account: "Cash",
  targetAccount: null,
  category: "Vendite",
  description: "Synthetic observed payment",
  pending: false,
  future: false,
  transfer: false,
  allocationNote: null,
  ...overrides,
});
const head = (overrides: Partial<FinanceRevisionRecord> = {}): FinanceRevisionRecord => ({
  id: id(2),
  operationId: id(3),
  sourceKind: "payment",
  sourceId: id(1),
  version: 1,
  previousVersion: 0,
  action: "update",
  restoredFromVersion: null,
  values: {
    date: "2026-03-17",
    direction: "income",
    amountCents: 5000,
    account: "Cash",
    targetAccount: null,
    category: "Vendite",
    description: "Synthetic corrected declaration",
    pending: false,
  },
  deleted: false,
  reason: "Synthetic reason",
  createdBy: id(4),
  createdAt: "2026-03-17T12:00:00.123456Z",
  ...overrides,
});
describe("single effective Finance movement projection", () => {
  it("replaces value once while preserving original data and a later source replay", () => {
    const original = movement(),
      revised = applyFinanceRevisions([original], [head()], "2026-10-22");
    expect(revisedAccountBalances(revised.active)[0].posted).toBe(5000n);
    expect(original.cents).toBe(10000n);
    expect(
      applyFinanceRevisions(
        [movement({ description: "New external observation detail" })],
        [head()],
        "2026-10-22",
      ).active[0].cents,
    ).toBe(5000n);
    expect(
      applyFinanceRevisions(
        [movement(), movement({ id: `payment:${id(8)}`, sourceId: id(8), cents: 1000n })],
        [head()],
        "2026-10-22",
      ).active.reduce((sum, row) => sum + row.cents, 0n),
    ).toBe(6000n);
  });
  it("deletes recoverably and restores a manual original omitted by the old void filter", () => {
    const gone = applyFinanceRevisions(
      [movement()],
      [head({ action: "delete", deleted: true })],
      "2026-10-22",
    );
    expect(gone.active).toHaveLength(0);
    expect(gone.deleted).toHaveLength(1);
    const revision = head({ sourceKind: "manual", action: "restore", restoredFromVersion: 0 });
    const original: FinanceRevisionOriginal = {
      sourceKind: "manual",
      sourceId: id(1),
      values: revision.values,
      deleted: true,
      orderId: null,
    };
    expect(applyFinanceRevisions([], [revision], "2026-10-22", [original]).active[0]).toMatchObject(
      { source: "manual", cents: 5000n },
    );
    expect(() => applyFinanceRevisions([], [revision], "2026-10-22")).toThrow(/Fonte originale/);
  });
  it("merges loaded account aliases without rewriting snapshots or custom account names", () => {
    const revision = head({ values: { ...head().values, account: "cash" } }),
      original = movement(),
      other = movement({ id: `payment:${id(7)}`, sourceId: id(7), cents: 100n }),
      projected = applyFinanceRevisions([original, other], [revision], "2026-10-22");
    expect(projected.active[0].account).toBe("Cash");
    expect(revisedAccountBalances(projected.active)).toEqual([
      { name: "Cash", posted: 5100n, pending: 0n, future: 0n, count: 2 },
    ]);
    expect(revision.values.account).toBe("cash");
    expect(original.account).toBe("Cash");
    expect(
      revisedAccountBalances([
        movement({ account: "revolut business", targetAccount: "cash", cents: -10n }),
        movement({ account: "Revolut Business", cents: 11n }),
        movement({ account: "Custom bank" }),
        movement({ account: "custom bank" }),
      ]).map(({ name, posted }) => [name, posted]),
    ).toEqual([
      ["Revolut Business", 1n],
      ["Cash", 10n],
      ["Custom bank", 10000n],
      ["custom bank", 10000n],
    ]);
  });
  it("preserves the P3 shop_payment identity without a second overlay or duplicate", () => {
    const shop = movement({ id: `shop-payment:${id(9)}`, source: "shop_payment", sourceId: id(9) });
    expect(applyFinanceRevisions([shop], [], "2026-10-22").active).toEqual([shop]);
  });
  it("keeps pending/future transfers separate and exact beyond floating-point aggregates", () => {
    const first = movement({
      id: `budgetflow:${id(1)}`,
      source: "budgetflow",
      cents: 9_000_000_000_000_000n,
    });
    const second = movement({
      id: `budgetflow:${id(5)}`,
      source: "budgetflow",
      sourceId: id(5),
      cents: 9_000_000_000_000_000n,
    });
    expect(revisedAccountBalances([first, second])[0].posted).toBe(18_000_000_000_000_000n);
    const pending = head({
      sourceKind: "budgetflow",
      values: {
        ...head().values,
        direction: "expense",
        amountCents: 101,
        targetAccount: "Test bank",
        pending: true,
        date: "2099-01-01",
      },
    });
    const projected = applyFinanceRevisions([first], [pending], "2026-10-22").active;
    expect(revisedAccountBalances(projected).map((row) => row.posted)).toEqual([0n, 0n]);
    expect(revisedAccountBalances(projected).map((row) => row.pending)).toEqual([-101n, 101n]);
  });
  it("rejects duplicated heads and sources instead of inflating the balance", () => {
    expect(() => applyFinanceRevisions([movement()], [head(), head()], "2026-10-22")).toThrow(
      /duplicate/,
    );
    expect(() => applyFinanceRevisions([movement(), movement()], [], "2026-10-22")).toThrow(
      /duplicato/,
    );
  });
});
