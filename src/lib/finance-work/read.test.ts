import { describe, expect, it } from "vitest";
import { financeWorkFromRows } from "./read";
import { workId, workRows, shopifyWorkRows } from "./fixtures";
const packlinkRow = (n = 1) => ({
  id: workId(100 + n),
  connection_id: workId(100),
  shop_domain: "synthetic.myshopify.com",
  provider_transaction_id: `SYN-TX-${n}`,
  provider_type: "LABELS_ORDER",
  kind: "shipping_charge",
  amount_cents: 731,
  currency: "EUR",
  occurred_at: "2026-06-10T23:30:00.123456Z",
  shipment_references: ["SYN_SHIPMENT_1"],
  shopify_order_gid: null,
  source_digest: "a".repeat(64),
  observed_at: "2026-06-11T08:00:00Z",
});
describe("lettura Packlink minima e completa", () => {
  it("conserva spesa e rimborso come osservazioni senza dati cliente né mutazioni", () => {
    const rows = {
      ...workRows(),
      packlinkTransactions: [
        packlinkRow(),
        {
          ...packlinkRow(2),
          provider_type: "REFUND",
          kind: "shipping_refund",
          shopify_order_gid: "gid://shopify/Order/200",
        },
      ],
    };
    const original = structuredClone(rows);
    expect(financeWorkFromRows(rows).packlinkTransactions).toMatchObject([
      {
        providerType: "LABELS_ORDER",
        kind: "shipping_charge",
        cents: 731,
        currency: "EUR",
        shopDomain: "synthetic.myshopify.com",
        shopifyOrderGid: null,
        occurredAt: "2026-06-10T23:30:00.123456Z",
      },
      {
        providerType: "REFUND",
        kind: "shipping_refund",
        shopifyOrderGid: "gid://shopify/Order/200",
      },
    ]);
    expect(rows).toEqual(original);
    expect(financeWorkFromRows(workRows()).packlinkTransactions).toEqual([]);
  });
  it.each([
    { amount_cents: 0 },
    { amount_cents: -1 },
    { amount_cents: 1.2 },
    { amount_cents: "731" },
    { currency: "USD" },
    { provider_type: "REFUND" },
    { kind: "unknown" },
    { provider_transaction_id: "x".repeat(121) },
    { provider_transaction_id: "" },
    { shipment_references: ["x".repeat(101)] },
    { shipment_references: ["SYN", "SYN"] },
    { shipment_references: Array.from({ length: 21 }, (_, n) => `SYN_${n}`) },
    { shipment_references: ["invalid@example.test"] },
    { shipment_references: null },
    { connection_id: "not-a-uuid" },
    { shop_domain: "https://synthetic.myshopify.com" },
    { shopify_order_gid: "gid://shopify/Product/200" },
    { shopify_order_gid: "gid://shopify/Order/18446744073709551616" },
    { source_digest: "not-a-digest" },
    { occurred_at: "2026-02-30T10:00:00Z" },
    { occurred_at: "2026-06-10" },
    { occurred_at: "2026-06-10T24:00:00Z" },
    { observed_at: "not-a-date" },
    { customer_email: "synthetic@example.test" },
  ])("rifiuta la riga Packlink incompleta o alterata %j", (change) => {
    expect(() =>
      financeWorkFromRows({
        ...workRows(),
        packlinkTransactions: [{ ...packlinkRow(), ...change }],
      }),
    ).toThrow("Lettura Finance non completa.");
  });
  it("rifiuta identità duplicate anche su UUID differenti e campi mancanti", () => {
    const first = packlinkRow();
    expect(() =>
      financeWorkFromRows({
        ...workRows(),
        packlinkTransactions: [first, { ...first, id: workId(999) }],
      }),
    ).toThrow();
    const { observed_at: _removed, ...missing } = first;
    expect(() => financeWorkFromRows({ ...workRows(), packlinkTransactions: [missing] })).toThrow();
  });
});
describe("Finance facts remain distinct", () => {
  it("links sale/payment/cancellation without converting them to manual entries or double counting an incasso", () => {
    const rows = workRows(),
      original = structuredClone(rows),
      snapshot = financeWorkFromRows(rows);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.payments).toHaveLength(1);
    expect(snapshot.facts).toHaveLength(3);
    expect(snapshot.facts.find((f) => f.kind === "payment_reported")?.paymentId).toBe(
      snapshot.payments[0].id,
    );
    expect(rows).toEqual(original);
  });
  it("marks a void while preserving the original declared value", () => {
    const rows = workRows();
    rows.voids.push({
      id: workId(7),
      finance_entry_id: workId(1),
      reason: "Synthetic correction",
      created_at: "2026-10-21T13:00:00Z",
      created_by: workId(10),
    });
    const entry = financeWorkFromRows(rows).entries[0];
    expect(entry.cents).toBe(1234);
    expect(entry.void?.reason).toBe("Synthetic correction");
  });
  it("keeps two Shopify captures, a financial refund and authorization/void apart from manual declarations", () => {
    const snapshot = financeWorkFromRows(shopifyWorkRows());
    expect(snapshot.payments.filter((p) => p.source === "manual_declaration")).toHaveLength(1);
    expect(
      snapshot.payments
        .filter((p) => p.source === "shopify_observation")
        .map((p) => p.cents)
        .sort(),
    ).toEqual([4000, 6000]);
    expect(snapshot.refunds[0].cents).toBe(1000);
    expect(snapshot.shopifyTransactions).toHaveLength(5);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.shopifyFinancials[0].totals.originalTaxCents).toBeNull();
    expect(snapshot.orders.find((o) => o.source === "shopify_canonical")?.channel).toBe(
      "shopify_pos",
    );
  });
  it("refuses source mismatches, missing financial snapshots, orphan refunds and captures without their single observation", () => {
    for (const change of [
      (r: ReturnType<typeof shopifyWorkRows>) => {
        (r.payments[1] as Record<string, unknown>).source_kind = "manual_declaration";
      },
      (r: ReturnType<typeof shopifyWorkRows>) => {
        r.shopifyFinancials = [];
      },
      (r: ReturnType<typeof shopifyWorkRows>) => {
        r.refunds = [];
      },
      (r: ReturnType<typeof shopifyWorkRows>) => {
        (r.shopifyTransactions[1] as Record<string, unknown>).kind = "AUTHORIZATION";
      },
      (r: ReturnType<typeof shopifyWorkRows>) => {
        r.payments.splice(1, 1);
        r.facts = r.facts.filter((f) => (f as Record<string, unknown>).payment_id !== workId(22));
      },
      (r: ReturnType<typeof shopifyWorkRows>) => {
        (
          r.facts.find(
            (f) => (f as Record<string, unknown>).fact_kind === "refund_observed",
          ) as Record<string, unknown>
        ).amount_cents = 1;
      },
    ]) {
      const rows = shopifyWorkRows();
      change(rows);
      expect(() => financeWorkFromRows(rows)).toThrow("Lettura Finance non completa.");
    }
  });
  it("refuses orphan/mismatched payment facts, truncated sale facts, voids and altered cancellation totals", () => {
    for (const change of [
      (r: ReturnType<typeof workRows>) => {
        r.payments = [];
      },
      (r: ReturnType<typeof workRows>) => {
        r.facts.shift();
      },
      (r: ReturnType<typeof workRows>) => {
        (r.orders[0] as Record<string, unknown>).cancelled_cents = 1;
      },
      (r: ReturnType<typeof workRows>) => {
        r.voids.push({
          id: workId(7),
          finance_entry_id: workId(999),
          reason: "Synthetic",
          created_at: "2026-10-21T13:00:00Z",
          created_by: workId(10),
        });
      },
    ]) {
      const rows = workRows();
      change(rows);
      expect(() => financeWorkFromRows(rows)).toThrow("Lettura Finance non completa.");
    }
  });
});
