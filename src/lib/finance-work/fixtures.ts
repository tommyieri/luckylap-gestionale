// Synthetic fixtures only. Application routes never import this file.
import type { WorkRows } from "./read";
export const workId = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const manualCommand = () => ({
  operationId: workId(90),
  kind: "record_finance_entry",
  payload: {
    schema_version: 1,
    entry_date: "2026-10-21",
    entry_type: "expense",
    amount_cents: 1234,
    description: "Synthetic user-declared expense",
    not_duplicate_confirmed: true,
  },
});
export function workRows(): WorkRows {
  const at = "2026-10-21T12:00:00Z";
  return {
    entries: [
      {
        id: workId(1),
        entry_date: "2026-10-21",
        entry_type: "expense",
        amount_cents: 1234,
        description: "Synthetic user-declared expense",
        account_label: "Synthetic declared account",
        category: "Synthetic category",
        source_kind: "manual_declaration",
        review_status: "unclassified",
        created_at: at,
        created_by: workId(10),
      },
    ],
    voids: [],
    orders: [
      {
        id: workId(2),
        source_kind: "manual_declaration",
        channel: "direct",
        external_reference: "SYNTHETIC-ORDER-1",
        total_cents: 8002,
        cancelled_cents: 4001,
        refund_due_cents: 4001,
      },
    ],
    facts: [
      {
        id: workId(3),
        order_id: workId(2),
        payment_id: null,
        refund_id: null,
        fact_kind: "sale_observed",
        amount_cents: 8002,
        currency: "EUR",
        occurred_at: at,
        source_kind: "manual_declaration",
        review_status: "observed_unclassified",
      },
      {
        id: workId(4),
        order_id: workId(2),
        payment_id: workId(6),
        refund_id: null,
        fact_kind: "payment_reported",
        amount_cents: 8002,
        currency: "EUR",
        occurred_at: at,
        source_kind: "manual_declaration",
        review_status: "observed_unclassified",
      },
      {
        id: workId(5),
        order_id: workId(2),
        payment_id: null,
        refund_id: null,
        fact_kind: "sale_cancellation_observed",
        amount_cents: 4001,
        currency: "EUR",
        occurred_at: at,
        source_kind: "manual_declaration",
        review_status: "observed_unclassified",
      },
    ],
    payments: [
      {
        id: workId(6),
        order_id: workId(2),
        method: "cash",
        amount_cents: 8002,
        currency: "EUR",
        occurred_at: at,
        declared_reference: "Synthetic payment reference",
        source_kind: "manual_declaration",
      },
    ],
    refunds: [],
    shopifyFinancials: [],
    shopifyTransactions: [],
  };
}
export function shopifyWorkRows(): WorkRows {
  const rows = workRows(),
    at = "2026-10-21T12:00:00Z",
    orderId = workId(20),
    source_kind = "shopify_observation";
  const gid = (n: number) => `gid://shopify/OrderTransaction/${n}`;
  rows.orders.push({
    id: orderId,
    source_kind: "shopify_canonical",
    channel: "shopify_pos",
    external_reference: "gid://shopify/Order/100",
    total_cents: 10000,
    cancelled_cents: 0,
    refund_due_cents: 0,
  });
  rows.facts.push({
    id: workId(21),
    order_id: orderId,
    payment_id: null,
    refund_id: null,
    fact_kind: "sale_observed",
    amount_cents: 10000,
    currency: "EUR",
    occurred_at: at,
    source_kind,
    review_status: "observed_unclassified",
  });
  for (const [n, amount] of [
    [22, 4000],
    [23, 6000],
  ]) {
    rows.payments.push({
      id: workId(n),
      order_id: orderId,
      source_kind,
      method: "shopify_observed",
      amount_cents: amount,
      currency: "EUR",
      occurred_at: at,
      declared_reference: gid(n),
    });
    rows.facts.push({
      id: workId(n + 10),
      order_id: orderId,
      payment_id: workId(n),
      refund_id: null,
      fact_kind: "payment_reported",
      amount_cents: amount,
      currency: "EUR",
      occurred_at: at,
      source_kind,
      review_status: "observed_unclassified",
    });
  }
  rows.refunds.push({
    id: workId(25),
    order_id: orderId,
    transaction_gid: gid(25),
    amount_cents: 1000,
    occurred_at: at,
    source_kind,
  });
  rows.facts.push({
    id: workId(35),
    order_id: orderId,
    payment_id: null,
    refund_id: workId(25),
    fact_kind: "refund_observed",
    amount_cents: 1000,
    currency: "EUR",
    occurred_at: at,
    source_kind,
    review_status: "observed_unclassified",
  });
  const transaction = (
    n: number,
    kind: string,
    amount_cents: number,
    parent_gid: string | null,
  ) => ({
    order_id: orderId,
    transaction_gid: gid(n),
    kind,
    status: "SUCCESS",
    amount_cents,
    currency: "EUR",
    gateway: "synthetic_gateway",
    parent_gid,
    processed_at: at,
    source_updated_at: at,
    observed_at: at,
  });
  rows.shopifyTransactions.push(
    transaction(24, "AUTHORIZATION", 10000, null),
    transaction(22, "CAPTURE", 4000, gid(24)),
    transaction(23, "CAPTURE", 6000, gid(24)),
    transaction(25, "REFUND", 1000, gid(23)),
    transaction(26, "VOID", 0, gid(24)),
  );
  rows.shopifyFinancials.push({
    order_id: orderId,
    source_updated_at: at,
    observed_at: at,
    taxes_included: true,
    totals: {
      originalTotalCents: 10000,
      currentTotalCents: 9000,
      originalSubtotalCents: 9000,
      currentSubtotalCents: 8000,
      totalShippingPriceCents: 1000,
      currentShippingPriceCents: 1000,
      originalTaxCents: null,
      currentTaxCents: 1475,
      totalRefundedCents: 1000,
      totalReceivedCents: 10000,
      orderDiscountCents: null,
      totalDiscountCents: 0,
    },
  });
  return rows;
}
