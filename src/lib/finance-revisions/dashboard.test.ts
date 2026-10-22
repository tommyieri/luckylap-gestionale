import { describe, it, expect } from "vitest";
import { revisedFinanceDashboard } from "./dashboard";
import {
  financeAccountSeries,
  financeCategoryTotals,
  type FinanceMovement,
} from "../finance/dashboard";
import type { FinanceRevisionRecord } from "./model";
const id = "77000000-0000-4000-8000-000000000001";
const movement: FinanceMovement = {
  id: `manual:${id}`,
  source: "manual",
  sourceId: id,
  date: "2026-01-01",
  cents: 10000n,
  account: "Cash",
  targetAccount: null,
  category: "Others",
  description: "Synthetic",
  pending: false,
  future: false,
  transfer: false,
  allocationNote: null,
};
const revision: FinanceRevisionRecord = {
  id,
  operationId: id,
  sourceKind: "manual",
  sourceId: id,
  version: 1,
  previousVersion: 0,
  action: "update",
  restoredFromVersion: null,
  values: {
    date: "2025-12-31",
    direction: "income",
    amountCents: 5000,
    account: "Cash",
    targetAccount: null,
    category: "Vendite",
    description: "Synthetic correction",
    pending: false,
  },
  deleted: false,
  reason: "Synthetic reason",
  createdBy: id,
  createdAt: "2026-10-22T10:00Z",
};
describe("Finance usa la correzione prima dei grafici", () => {
  it("rebuilds years, balances and chart opening from one corrected movement", () => {
    const dashboard = revisedFinanceDashboard(
      { movements: [movement], accounts: [], years: [2026], reportDate: "2026-10-22" },
      [revision],
    );
    expect(dashboard.years).toEqual([2026, 2025]);
    expect(dashboard.accounts[0].posted).toBe(5000n);
    expect(financeAccountSeries(dashboard, 2026, ["Cash"])[0].months[0].posted).toBe(5000n);
    expect(
      financeCategoryTotals(dashboard, 2025, ["Cash"]).find((row) => row.category === "Vendite")
        ?.cents,
    ).toBe(5000n);
    expect(movement.cents).toBe(10000n);
  });
  it("deleted movement is recoverable and contributes zero to charts and categories", () => {
    const dashboard = revisedFinanceDashboard(
      { movements: [movement], accounts: [], years: [2026], reportDate: "2026-10-22" },
      [{ ...revision, action: "delete", deleted: true }],
    );
    expect(dashboard.movements).toHaveLength(0);
    expect(dashboard.accounts).toHaveLength(0);
    expect(dashboard.deletedMovements).toHaveLength(1);
    expect(
      financeCategoryTotals(dashboard, 2026, ["Cash"]).every(
        (row) => row.cents === 0n && row.count === 0,
      ),
    ).toBe(true);
  });
});
