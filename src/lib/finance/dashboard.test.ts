import { describe, expect, it } from "vitest";
import type { FinanceSnapshot, FinanceTransaction } from "./model";
import type { FinanceWorkSnapshot, ManualEntry } from "../finance-work/model";
import { buildFinanceDashboard, financeAccountSeries, financeCategoryTotals, financeCentsLabel, financeMonthTotal, sourceAmountCents } from "./dashboard";
import { dashboardSettlementsFromRows } from "./settlements";

const today = "2026-06-15";
const work = (): FinanceWorkSnapshot => ({ entries: [], facts: [], payments: [], orders: [], refunds: [], shopifyFinancials: [], shopifyTransactions: [] });
const row = (id: string, amount: string, overrides: Partial<FinanceTransaction> = {}): FinanceTransaction => ({ id, batchId: "synthetic-batch", sourceRow: 2, occurredAt: "2026-06-10T10:00:00Z", sourceDate: "2026-06-10", sourceTimestamp: "2026-06-10T10:00:00Z", sourceAmount: amount, formattedAmount: "synthetic", account: "Revolut Business", targetAccount: null, category: "Vendite", payee: "Synthetic", folder: "", tags: "", notes: "", pending: false, ...overrides });
const imports = (...transactions: FinanceTransaction[]): FinanceSnapshot => ({ batches: [], transactions });
const entry = (overrides: Partial<ManualEntry> = {}): ManualEntry => ({ id: "manual-one", date: "2026-06-10", type: "expense", cents: 501, description: "Synthetic entry", account: "Cash", category: "Software", source: "manual_declaration", createdAt: "2026-06-10T10:00:00Z", createdBy: "synthetic-user", void: null, ...overrides });

describe("Finance dashboard, exact movements rather than commercial totals", () => {
  it("keeps cents exact, including aggregates beyond Number.MAX_SAFE_INTEGER", () => {
    expect(sourceAmountCents("-0.01")).toBe(-1n);
    expect(sourceAmountCents("+1.2")).toBe(120n);
    expect(() => sourceAmountCents("0.001")).toThrow();
    const dashboard = buildFinanceDashboard(imports(row("a", "90000000000000.00"), row("b", "90000000000000.00"), row("c", "0.01")), work(), today);
    expect(dashboard.accounts[0].posted).toBe(18_000_000_000_000_001n);
    expect(financeCentsLabel(dashboard.accounts[0].posted)).toBe("180.000.000.000.000,01 €");
  });
  it("excludes pending and future rows independently from posted balances and categories", () => {
    const dashboard = buildFinanceDashboard(imports(row("a", "100.00"), row("b", "-7.01", { pending: true }), row("c", "-9.04", { sourceDate: "2026-07-01" }), row("d", "-2.02", { sourceDate: "2026-07-01", pending: true })), work(), today);
    expect(dashboard.accounts[0]).toMatchObject({ posted: 10_000n, pending: -903n, future: -904n });
    expect(financeCategoryTotals(dashboard, 2026, ["Revolut Business"]).find(c => c.category === "Vendite")).toMatchObject({ cents: 10_000n, count: 1 });
  });
  it("applies a single-row transfer to both accounts without creating income or a cost", () => {
    const dashboard = buildFinanceDashboard(imports(row("transfer", "-10.01", { account: "Cash", targetAccount: "Revolut Business" })), work(), today);
    expect(dashboard.accounts.find(a => a.name === "Cash")?.posted).toBe(-1001n);
    expect(dashboard.accounts.find(a => a.name === "Revolut Business")?.posted).toBe(1001n);
    expect(dashboard.accounts.reduce((sum, a) => sum + a.posted, 0n)).toBe(0n);
    expect(financeCategoryTotals(dashboard, 2026, dashboard.accounts.map(a => a.name)).every(c => c.cents === 0n && c.count === 0)).toBe(true);
    expect(financeAccountSeries(dashboard, 2026, ["Cash"])[0].months[5]).toMatchObject({ incoming: 0n, outgoing: 0n, net: -1001n });
  });
  it("carries earlier years into balances while restricting category flows to the selected year", () => {
    const dashboard = buildFinanceDashboard(imports(row("old", "10.01", { sourceDate: "2025-12-31" }), row("new", "2.01", { sourceDate: "2026-02-01" })), work(), today);
    const series = financeAccountSeries(dashboard, 2026, ["Revolut Business"]);
    expect(series[0].months[0].posted).toBe(1001n);
    expect(series[0].months[1].posted).toBe(1202n);
    expect(series[0].months[5].date).toBe(today);
    expect(series[0].months[6].posted).toBeNull();
    expect(financeCategoryTotals(dashboard, 2026, ["Revolut Business"]).find(c => c.category === "Vendite")?.cents).toBe(201n);
    expect(financeMonthTotal(series, 0)).toBe(1001n);
  });
  it("keeps a separate dated-future projection and never projects pending rows", () => {
    const dashboard = buildFinanceDashboard(imports(row("a", "100"), row("b", "-5.01", { sourceDate: "2026-06-20" }), row("c", "-6.02", { sourceDate: "2026-07-20" }), row("d", "-99", { pending: true })), work(), today);
    const series = financeAccountSeries(dashboard, 2026, ["Revolut Business"])[0];
    expect(series.months[5]).toMatchObject({ posted: 10_000n, planned: 9499n });
    expect(series.months[6]).toMatchObject({ posted: null, planned: 8897n });
    const nextYear = financeAccountSeries(dashboard, 2027, ["Revolut Business"])[0];
    expect(nextYear.months[0]).toMatchObject({ posted: null, planned: 8897n });
  });
  it("includes signed active manual declarations, excluding voids and unknown accounts from account totals", () => {
    const manual = work();
    manual.entries = [entry(), entry({ id: "income", type: "income", cents: 1000 }), entry({ id: "unknown", cents: 9999, account: null }), entry({ id: "void", cents: 8000, void: { id: "void-id", entryId: "void", reason: "Synthetic", createdAt: "2026-06-11T10:00:00Z", createdBy: "synthetic-user" } })];
    const dashboard = buildFinanceDashboard(imports(), manual, today);
    expect(dashboard.accounts).toEqual([{ name: "Cash", posted: 499n, pending: 0n, future: 0n, count: 2 }]);
    expect(dashboard.movements.filter(r => !r.account)).toHaveLength(1);
    expect(dashboard.movements.some(r => r.sourceId === "void")).toBe(false);
  });
  it("counts cash declarations once, never summing sale/payment facts or gateway transactions into balances", () => {
    const manual = work();
    manual.payments = [{ id: "cash", orderId: "order", source: "manual_declaration", cents: 101, method: "cash", occurredAt: "2026-06-10T10:00:00Z", reference: null }, { id: "online", orderId: "shopify-order", source: "shopify_observation", cents: 202, method: "shopify_observed", occurredAt: "2026-06-10T10:00:00Z", reference: "tx" }];
    manual.facts = ["sale_observed", "payment_reported", "sale_cancellation_observed"].map((kind, index) => ({ id: `fact-${index}`, orderId: "order", paymentId: kind === "payment_reported" ? "cash" : null, refundId: null, source: "manual_declaration", kind: kind as "sale_observed", cents: 101, occurredAt: "2026-06-10T10:00:00Z", reviewStatus: "observed_unclassified" }));
    manual.refunds = [{ id: "refund", orderId: "shopify-order", transactionGid: "refund-tx", cents: 33, occurredAt: "2026-06-10T10:00:00Z" }];
    manual.shopifyTransactions = [{ orderId: "shopify-order", transactionGid: "tx", kind: "CAPTURE", status: "SUCCESS", cents: 202, currency: "EUR", gateway: "Revolut Business", parentGid: null, processedAt: "2026-06-10T10:00:00Z", sourceUpdatedAt: "2026-06-10T10:00:00Z", observedAt: "2026-06-10T10:00:00Z" }];
    const dashboard = buildFinanceDashboard(imports(), manual, today);
    expect(dashboard.accounts).toEqual([{ name: "Cash", posted: 101n, pending: 0n, future: 0n, count: 1 }]);
    expect(dashboard.movements).toHaveLength(3);
    expect(dashboard.movements.filter(r => !r.account).map(r => r.cents)).toEqual([202n, -33n]);
  });
  it("uses actual settlements once, attributing only explicit cash to Cash", () => {
    const dashboard = buildFinanceDashboard(imports(), work(), today, [{ id: "cash", saleId: "sale", cents: 1001, occurredAt: "2026-06-10T10:00:00Z", method: "cash", reference: "SYN" }, { id: "bank", saleId: "sale", cents: 901, occurredAt: "2026-06-10T10:00:00Z", method: "bank_transfer", reference: "SYN-2" }]);
    expect(dashboard.accounts[0].posted).toBe(1001n);
    expect(dashboard.movements.filter(r => !r.account)).toHaveLength(1);
    expect(financeCategoryTotals(dashboard, 2026, ["Cash"]).find(c => c.category === "Vendite")?.cents).toBe(1001n);
  });
  it("uses the Europe/Rome day for live observations, including DST and UTC day boundaries", () => {
    const manual = work(); manual.payments = [{ id: "cash", orderId: "order", source: "manual_declaration", cents: 1, method: "cash", occurredAt: "2026-10-25T23:30:00Z", reference: null }];
    expect(buildFinanceDashboard(imports(), manual, "2026-10-25").movements[0]).toMatchObject({ date: "2026-10-26", future: true });
  });
  it("keeps all 13 requested categories, preserves unknown labels, and filters account totals", () => {
    const dashboard = buildFinanceDashboard(imports(row("a", "0.01", { category: "Custom source" }), row("b", "2.01", { account: "Cash" })), work(), today);
    const totals = financeCategoryTotals(dashboard, 2026, ["Revolut Business"]);
    expect(totals).toHaveLength(14);
    expect(totals.find(c => c.category === "Fund Raising")?.group).toBe("income");
    expect(totals.find(c => c.category === "Tasse & Contributi")?.group).toBe("fixed");
    expect(totals.find(c => c.category === "Custom source")).toMatchObject({ group: "unclassified", cents: 1n });
    expect(totals.find(c => c.category === "Vendite")?.cents).toBe(0n);
  });
  it("rejects duplicate identities instead of silently counting the same source twice", () => {
    expect(() => buildFinanceDashboard(imports(row("same", "1"), row("same", "1")), work(), today)).toThrow(/duplicati/);
  });
});

describe("settlement dashboard projection", () => {
  const settlement = { id: "30000000-0000-4000-8000-000000000001", sale_id: "30000000-0000-4000-8000-000000000002", amount_cents: 1001, occurred_at: "2026-06-10T10:00:00Z", method: "cash", reference: "SYN" };
  it("validates identities, dates, integer cents and explicit payment methods", () => {
    expect(dashboardSettlementsFromRows([settlement])[0]).toMatchObject({ cents: 1001, method: "cash" });
    for (const bad of [{ ...settlement, amount_cents: 1.01 }, { ...settlement, method: "revolut" }, { ...settlement, occurred_at: "invalid" }, { ...settlement, id: "bad" }]) expect(() => dashboardSettlementsFromRows([bad])).toThrow();
    expect(() => dashboardSettlementsFromRows([settlement, settlement])).toThrow(/duplicati/);
  });
});
