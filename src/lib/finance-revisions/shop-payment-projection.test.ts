import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildFinanceDashboard, type DashboardShopPayment } from "../finance/dashboard";
import {
  monthlyFinanceFromRows,
  dashboardShopPaymentsFromRows,
  deletedShopPaymentsFromRows,
} from "../consignment/shop-finance";
import { consignmentFinanceFromRows } from "../consignment/finance";
import { shopFinanceRows, sx } from "../consignment/shop-fixtures";
import { consignmentSaleRow } from "../consignment/fixtures";
const empty = {
  entries: [],
  facts: [],
  payments: [],
  orders: [],
  refunds: [],
  shopifyFinancials: [],
  shopifyTransactions: [],
};
describe("un solo pagamento effettivo per Finance e P3", () => {
  it("metadata direzione/data/pending entrano prima di saldi e categorie", () => {
    const payment: DashboardShopPayment = {
      id: sx.payment,
      reportId: sx.september,
      locationId: sx.shop,
      cents: 1500,
      paidAt: "2026-10-20T10:00Z",
      method: "cash",
      account: "Cash",
      allocationNote: null,
      reference: null,
      shopName: "Sintetico",
      month: "2026-09",
      monthLabel: "settembre 2026",
      href: "/consignment/NEG01",
      direction: "expense",
      category: "Others",
      description: "Spesa sintetica",
      pending: true,
    };
    const result = buildFinanceDashboard({ batches: [], transactions: [] }, empty, "2026-10-23", {
      shopPayments: [payment],
    });
    expect(result.movements[0]).toMatchObject({
      cents: -1500n,
      category: "Others",
      description: "Spesa sintetica",
      pending: true,
    });
    expect(result.accounts[0]).toMatchObject({ posted: 0n, pending: -1500n });
  });
  it("P3 espone netto negativo e pagamento eliminato recuperabile senza aggiungere il credito ai saldi", () => {
    const rows = shopFinanceRows();
    rows.payments = rows.payments.map((p) => ({
      ...p,
      finance_direction: "expense",
      finance_category: "Others",
      finance_description: "Rettifica sintetica",
      finance_pending: false,
    }));
    rows.reports = rows.reports.map((r) => ({ ...r, payment_state: "unpaid" }));
    const monthly = monthlyFinanceFromRows(
      rows.reports,
      rows.payments,
      rows.locations,
      "2026-10-23T10:00Z",
    );
    expect(monthly.rows[0]).toMatchObject({
      paidCents: -5000,
      remainingCents: 18499,
      overpaidCents: 0,
    });
    expect(
      dashboardShopPaymentsFromRows(rows.payments, rows.reports, rows.locations)[0],
    ).toMatchObject({ cents: 5000, direction: "expense" });
    expect(deletedShopPaymentsFromRows(rows.payments, rows.reports, rows.locations)).toHaveLength(
      1,
    );
  });
  it("lo storico legacy usa la stessa proiezione corretta anche sopra credito", () => {
    const sale = { ...consignmentSaleRow(), shop: { code: "SYN", name: "Negozio sintetico" } },
      claim = BigInt(sale.brand_claim_cents),
      net = claim + 100n;
    const snapshot = consignmentFinanceFromRows([sale], [], "2026-10-23T10:00Z", [
      {
        saleId: sale.id,
        claimCents: claim,
        netCents: net,
        amountDueCents: 0n,
        refundDueCents: 100n,
        corrected: true,
      },
    ]);
    expect(snapshot.rows[0]).toMatchObject({
      settledCents: Number(net),
      remainingCents: 0,
      overpaidCents: 100,
    });
  });
});
