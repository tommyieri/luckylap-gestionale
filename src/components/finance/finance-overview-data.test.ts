import { describe, expect, it } from "vitest";
import type { FinanceDashboard, FinanceMovement } from "../../lib/finance/dashboard";
import { financeWorkspaceSummary, parseFinanceView } from "../../lib/finance/workspace";
import type { RevisedMovement } from "../../lib/finance-revisions/projection";
import { financeBalanceTrends, financeOverviewSchedules } from "./finance-overview-data";

const reportDate = "2026-11-13";
function movement(
  id: string,
  date: string,
  cents: bigint,
  fields: Partial<RevisedMovement<FinanceMovement>> = {},
): RevisedMovement<FinanceMovement> {
  return {
    id,
    source: "manual",
    sourceId: id,
    date,
    cents,
    account: "Conto A",
    targetAccount: null,
    category: "Sintetica",
    description: "Operazione sintetica",
    pending: false,
    future: date > reportDate,
    transfer: false,
    allocationNote: null,
    ...fields,
  };
}

const dashboard: FinanceDashboard = {
  reportDate,
  years: [2026],
  movements: [
    movement("opening", "2026-09-05", 15000n),
    movement("late", "2026-10-02", -900n, { pending: true }),
    movement("transfer", "2026-11-04", -2500n, { transfer: true, targetAccount: "Conto B" }),
    movement("unassigned", "2026-11-06", -1000n, { account: null }),
    movement("removed", "2026-11-08", -60000n, {
      revision: {
        version: 1,
        id: "archiviato",
        deleted: true,
        actorId: "fixture",
        occurredAt: reportDate,
      },
    }),
    movement("posted", "2026-11-09", -400n),
    movement("future", "2026-11-14", 7000n),
    movement("pending", "2026-11-15", -5000n, { pending: true }),
    movement("expected", "2026-11-17", 8100n, { pending: true, expectedPayment: true }),
  ],
  accounts: [
    { name: "Conto A", posted: 12100n, pending: -5900n, future: 7000n, count: 6 },
    { name: "Conto B", posted: 2500n, pending: 0n, future: 0n, count: 1 },
  ],
};

describe("panoramica saldi per conto", () => {
  it("somma lo storico e le due gambe, mostra il previsto oltre il consuntivo", () => {
    const view = parseFinanceView({}, reportDate);
    const summary = financeWorkspaceSummary(dashboard, view);
    const trends = financeBalanceTrends(dashboard, view, summary);
    const [first, second] = trends;
    expect(first.opening).toBe(15000n);
    expect(first.closing + second.closing).toBe(summary.closing);
    expect(first.points.find((point) => point.date === reportDate)).toEqual({
      date: reportDate,
      posted: 12100n,
      planned: null,
    });
    expect(first.points.find((point) => point.date === "2026-11-14")).toEqual({
      date: "2026-11-14",
      posted: null,
      planned: 19100n,
    });
    expect(first.points.at(-1)?.planned).toBe(27200n);
    expect(second.points.find((point) => point.date === "2026-11-04")?.posted).toBe(2500n);
  });

  it("filtra il conto e include i sospesi arretrati nel riepilogo", () => {
    const view = parseFinanceView({ conto: "Conto B" }, reportDate);
    const summary = financeWorkspaceSummary(dashboard, view);
    expect(financeBalanceTrends(dashboard, view, summary).map((trend) => trend.name)).toEqual([
      "Conto B",
    ]);
    expect(financeOverviewSchedules(dashboard, view)).toEqual({ planned: [], pending: [] });
    const schedules = financeOverviewSchedules(dashboard, { ...view, account: "" });
    expect(schedules.pending.map((row) => row.id)).toEqual(["pending", "late"]);
    expect(schedules.planned.map((row) => row.id)).toEqual(["future", "expected"]);
  });
});
