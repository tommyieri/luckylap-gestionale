import { describe, expect, it } from "vitest";
import type { RevisedMovement } from "../finance-revisions/projection";
import type { FinanceMovement } from "./dashboard";
import { financeBudgetActuals, financeBudgetMonthRange } from "./budgets";

const base: FinanceMovement = {
  source: "manual",
  sourceId: "sintetico",
  id: "sintetico",
  date: "2028-02-03",
  cents: -1201n,
  account: null,
  targetAccount: null,
  category: "Categoria sintetica",
  description: "Movimento sintetico",
  pending: false,
  transfer: false,
  future: false,
  allocationNote: null,
};

describe("budget mensile Finance", () => {
  it("valida i mesi e conserva i confini del calendario", () => {
    expect(financeBudgetMonthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(financeBudgetMonthRange("2027-02")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(financeBudgetMonthRange("9999-12")).toEqual({ from: "9999-12-01", to: "9999-12-31" });
    expect(financeBudgetMonthRange("0000-10")).toBeNull();
    expect(financeBudgetMonthRange("2028-2")).toBeNull();
  });

  it("somma le sole spese valutate nei budget, anche senza conto e a centesimi esatti", () => {
    const largeCents = 900719925474099312345n;
    const rows: RevisedMovement<FinanceMovement>[] = [
      base,
      { ...base, category: "", cents: -largeCents, evaluateStatistics: false },
      { ...base, date: "2028-03-01" },
      { ...base, cents: 1100n },
      { ...base, evaluateBudgets: false },
      { ...base, transfer: true, targetAccount: "Conto sintetico" },
      { ...base, pending: true },
      { ...base, future: true },
      {
        ...base,
        revision: {
          version: 1,
          id: "rev",
          deleted: true,
          actorId: "demo",
          occurredAt: "2028-02-06",
        },
      },
    ];
    expect(financeBudgetActuals(rows, "2028-02")).toEqual({
      total: largeCents + 1201n,
      byCategory: new Map([
        ["Categoria sintetica", 1201n],
        ["Senza categoria", largeCents],
      ]),
    });
  });
});
