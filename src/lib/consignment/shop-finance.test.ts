import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), sensitive: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.verify }));
vi.mock("../auth/sensitive-access", () => ({ verifiedSensitiveAccess: mocks.sensitive }));
import {
  dashboardShopPaymentsFromRows,
  loadConsignmentToSettle,
  monthlyFinanceFromRows,
  readConsignmentMonthlyFinance,
} from "./shop-finance";
import { shopFinanceRows, sid, sx } from "./shop-fixtures";

type Row = Record<string, unknown>;
/** Lettura paginata in memoria: ordine, cursore `gt`, limite e conteggio esatto. */
function fakeDb(tables: Record<string, Row[]>) {
  const calls: string[] = [];
  const from = vi.fn((table: string) => {
    calls.push(table);
    let cursor: string | null = null,
      limit = Infinity;
    const run = () => {
      const rows = [...(tables[table] ?? [])]
        .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))
        .filter((r) => cursor === null || String(r.id) > cursor);
      return { data: rows.slice(0, limit), count: rows.length, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      gt: (_: string, v: string) => ((cursor = v), q),
      then: (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  });
  return { db: { from }, calls };
}
const member = {
  userId: sx.user,
  displayName: "Socio sintetico",
  role: "founder" as const,
  financeAccess: true,
};
const tables = () => {
  const rows = shopFinanceRows();
  return {
    consignment_reports: rows.reports as Row[],
    consignment_report_payments: rows.payments as Row[],
    stock_locations: rows.locations as Row[],
  };
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue({ status: "member", member });
  mocks.sensitive.mockResolvedValue(true);
});

describe("pannello «Conto vendita · da incassare»", () => {
  it("una riga per resoconto: da fatturare, incassato, residuo e stato", () => {
    const { reports, payments, locations } = shopFinanceRows();
    const finance = monthlyFinanceFromRows(reports, payments, locations, "2026-10-22T10:00:00Z");
    expect(
      finance.rows.map((r) => [
        r.code,
        r.monthLabel,
        r.pieces,
        r.grossCents,
        r.brandCents,
        r.paidCents,
        r.remainingCents,
        r.status,
        r.href,
      ]),
    ).toEqual([
      [
        "NEG01",
        "settembre 2026",
        4,
        22499,
        13499,
        5000,
        8499,
        "Pagata in parte",
        "/consignment/NEG01/resoconto/2026-09",
      ],
      [
        "NEG03",
        "settembre 2026",
        1,
        5500,
        3300,
        3300,
        0,
        "Pagata",
        "/consignment/NEG03/resoconto/2026-09",
      ],
    ]);
    expect(finance.toCollectCents).toBe(8499);
    expect(finance.rows[0].invoice).toEqual({ number: "12", date: "2026-10-03" });
  });
  it("pagamenti mancanti o di un altro resoconto fanno fallire la lettura", () => {
    const { reports, payments, locations } = shopFinanceRows();
    expect(() => monthlyFinanceFromRows(reports, payments.slice(1), locations)).toThrow();
    expect(() =>
      monthlyFinanceFromRows(
        reports,
        [{ ...payments[0], report_id: sid(999) }, ...payments.slice(1)],
        locations,
      ),
    ).toThrow();
    expect(() =>
      monthlyFinanceFromRows(
        reports,
        [{ ...payments[0], location_id: sx.shop2 }, ...payments.slice(1)],
        locations,
      ),
    ).toThrow();
    expect(() => monthlyFinanceFromRows(reports, [...payments, payments[0]], locations)).toThrow();
  });
});

describe("pagamenti come movimenti Finance", () => {
  it("annullati esclusi; conto indicato; contanti senza conto in «Cash»", () => {
    const { reports, payments, locations } = shopFinanceRows();
    expect(dashboardShopPaymentsFromRows(payments, reports, locations)).toEqual([
      {
        id: sx.payment,
        reportId: sx.september,
        locationId: sx.shop,
        cents: 5000,
        paidAt: "2026-10-10T08:00:00+00:00",
        method: "bank_transfer",
        account: "Conto sintetico",
        allocationNote: null,
        reference: "Bonifico sintetico",
        shopName: "Negozio sintetico",
        month: "2026-09",
        monthLabel: "settembre 2026",
        href: "/consignment/NEG01/resoconto/2026-09",
      },
      {
        id: sx.closedPayment,
        reportId: sx.closedReport,
        locationId: sx.closedShop,
        cents: 3300,
        paidAt: "2026-10-10T08:00:00+00:00",
        method: "cash",
        account: "Cash",
        allocationNote: null,
        reference: null,
        shopName: "Negozio sintetico chiuso",
        month: "2026-09",
        monthLabel: "settembre 2026",
        href: "/consignment/NEG03/resoconto/2026-09",
      },
    ]);
  });
  it("bonifico senza conto da attribuire; nomi dei conti normalizzati", () => {
    const { reports, payments, locations } = shopFinanceRows();
    const [first, voided, closed] = payments;
    const result = dashboardShopPaymentsFromRows(
      [
        { ...first, account_label: null },
        voided,
        { ...closed, method: "other", account_label: "revolut business" },
      ],
      reports,
      locations,
    );
    expect(result.map((p) => [p.account, p.allocationNote])).toEqual([
      [null, "Conto dell’incasso conto vendita non attribuito."],
      ["Revolut Business", null],
    ]);
  });
  it("un resoconto senza pagamenti non produce nessun movimento: i crediti restano fuori dai saldi", () => {
    const { reports, locations } = shopFinanceRows();
    const unpaid = reports.map((r) => ({ ...r, payment_state: "unpaid" }));
    expect(dashboardShopPaymentsFromRows([], unpaid, locations)).toEqual([]);
    expect(monthlyFinanceFromRows(unpaid, [], locations).toCollectCents).toBe(13499 + 3300);
  });
});

describe("letture riservate a Finance", () => {
  it("nessuna query senza membership, con un'altra persona o con Finance chiusa", async () => {
    const { db } = fakeDb(tables());
    mocks.verify.mockResolvedValueOnce({ status: "signed-out" });
    expect(await readConsignmentMonthlyFinance(db as never, member)).toEqual({
      status: "signed-out",
    });
    mocks.verify.mockResolvedValueOnce({
      status: "member",
      member: { ...member, userId: sx.colleague },
    });
    expect(await readConsignmentMonthlyFinance(db as never, member)).toEqual({ status: "denied" });
    mocks.sensitive.mockResolvedValueOnce(false);
    expect(await loadConsignmentToSettle(db as never, member)).toEqual({ status: "denied" });
    expect(db.from).not.toHaveBeenCalled();
  });
  it("con Finance aperta: pannello e pagamenti con una sola lettura", async () => {
    const { db, calls } = fakeDb(tables());
    const read = await readConsignmentMonthlyFinance(db as never, member);
    expect(read.status).toBe("ready");
    if (read.status !== "ready") return;
    expect(read.snapshot.toCollectCents).toBe(8499);
    expect(read.shopPayments.map((p) => p.id)).toEqual([sx.payment, sx.closedPayment]);
    expect(calls.sort()).toEqual([
      "consignment_report_payments",
      "consignment_reports",
      "stock_locations",
    ]);
  });
  it("da regolare per Oggi: da fatturare o da incassare, prima i mesi più vecchi", async () => {
    const t = tables();
    t.consignment_reports.push({
      ...t.consignment_reports[0],
      id: sid(303),
      period_month: "2026-08-01",
      invoice_number: null,
      invoice_date: null,
      invoice_revision: null,
      payment_state: "unpaid",
    });
    const { db } = fakeDb(t);
    expect(await loadConsignmentToSettle(db as never, member)).toEqual({
      status: "ready",
      rows: [
        {
          locationId: sx.shop,
          code: "NEG01",
          shopName: "Negozio sintetico",
          month: "2026-08",
          monthLabel: "agosto 2026",
          toInvoiceCents: 13499,
          toCollectCents: 13499,
          state: "da_fatturare",
          href: "/consignment/NEG01/resoconto/2026-08",
        },
        {
          locationId: sx.shop,
          code: "NEG01",
          shopName: "Negozio sintetico",
          month: "2026-09",
          monthLabel: "settembre 2026",
          toInvoiceCents: 13499,
          toCollectCents: 8499,
          state: "da_incassare",
          href: "/consignment/NEG01/resoconto/2026-09",
        },
      ],
    });
  });
});
