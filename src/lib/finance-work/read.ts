import { isUuid, record, safeInteger } from "../sales/model";
import {
  calendarDay,
  type FinanceWorkSnapshot,
  type FinanceVoid,
  type ManualEntry,
  type SalesFact,
  type DeclaredPayment,
  type FinanceOrder,
  type ObservedRefund,
  type ShopifyFinancials,
  type ShopifyTransactionObservation,
} from "./model";
export type WorkRows = {
  entries: unknown[];
  voids: unknown[];
  facts: unknown[];
  payments: unknown[];
  orders: unknown[];
  refunds: unknown[];
  shopifyFinancials: unknown[];
  shopifyTransactions: unknown[];
};
function fail(): never {
  throw new Error("Lettura Finance non completa.");
}
const obj = (v: unknown) => record(v) ?? fail();
const id = (v: unknown) => (isUuid(v) ? v : fail());
const str = (v: unknown) => (typeof v === "string" ? v : fail());
const optional = (v: unknown) => (v === null ? null : str(v));
const cents = (v: unknown, max = 9000000000000000) => (safeInteger(v, 0, max) ? v : fail());
const date = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : fail());
const choice = <T extends string>(v: unknown, allowed: readonly T[]): T =>
  typeof v === "string" && allowed.includes(v as T) ? (v as T) : fail();
function unique(values: string[]) {
  if (new Set(values).size !== values.length) fail();
}
const transactionGid = (v: unknown) =>
  typeof v === "string" && /^gid:\/\/shopify\/OrderTransaction\/[1-9]\d{0,19}$/.test(v)
    ? v
    : fail();
const totalKeys = [
  "originalTotalCents",
  "currentTotalCents",
  "originalSubtotalCents",
  "currentSubtotalCents",
  "totalShippingPriceCents",
  "currentShippingPriceCents",
  "originalTaxCents",
  "currentTaxCents",
  "totalRefundedCents",
  "totalReceivedCents",
  "orderDiscountCents",
  "totalDiscountCents",
] as const;
function financialTotals(value: unknown): ShopifyFinancials["totals"] {
  const r = obj(value),
    nullable = [
      "originalSubtotalCents",
      "originalTaxCents",
      "orderDiscountCents",
      "totalDiscountCents",
    ];
  if (
    Object.keys(r).length !== totalKeys.length ||
    Object.keys(r).some((k) => !(totalKeys as readonly string[]).includes(k))
  )
    fail();
  return Object.fromEntries(
    totalKeys.map((key) => [key, r[key] === null && nullable.includes(key) ? null : cents(r[key])]),
  ) as ShopifyFinancials["totals"];
}
export function financeWorkFromRows(rows: WorkRows): FinanceWorkSnapshot {
  const voids: FinanceVoid[] = rows.voids.map((raw) => {
    const r = obj(raw);
    return {
      id: id(r.id),
      entryId: id(r.finance_entry_id),
      reason: str(r.reason),
      createdAt: date(r.created_at),
      createdBy: id(r.created_by),
    };
  });
  unique(voids.map((v) => v.id));
  unique(voids.map((v) => v.entryId));
  const entries: ManualEntry[] = rows.entries.map((raw) => {
    const r = obj(raw);
    if (!calendarDay(r.entry_date) || r.review_status !== "unclassified") fail();
    return {
      id: id(r.id),
      date: r.entry_date,
      type: choice(r.entry_type, ["income", "expense"]),
      cents: cents(r.amount_cents, 99999999999999),
      description: str(r.description),
      account: optional(r.account_label),
      category: optional(r.category),
      source: choice(r.source_kind, ["manual_declaration", "legacy_unclassified"]),
      createdAt: date(r.created_at),
      createdBy: id(r.created_by),
      void: voids.find((v) => v.entryId === r.id) ?? null,
    };
  });
  unique(entries.map((v) => v.id));
  if (
    entries.some((v) => v.cents <= 0) ||
    voids.some((v) => !entries.some((e) => e.id === v.entryId))
  )
    fail();
  const orders: FinanceOrder[] = rows.orders.map((raw) => {
    const r = obj(raw),
      source = choice(r.source_kind, ["manual_declaration", "shopify_canonical"]);
    return {
      id: id(r.id),
      source,
      channel: choice(
        r.channel,
        source === "shopify_canonical"
          ? ["shopify_web", "shopify_pos"]
          : ["direct", "etsy", "manual_other"],
      ),
      reference: optional(r.external_reference),
      totalCents: cents(r.total_cents),
      cancelledCents: cents(r.cancelled_cents),
      refundDueCents: cents(r.refund_due_cents),
    };
  });
  unique(orders.map((v) => v.id));
  if (orders.some((v) => v.cancelledCents > v.totalCents)) fail();
  const facts: SalesFact[] = rows.facts.map((raw) => {
    const r = obj(raw);
    if (r.currency !== "EUR" || r.review_status !== "observed_unclassified") fail();
    return {
      id: id(r.id),
      orderId: id(r.order_id),
      source: choice(r.source_kind, ["manual_declaration", "shopify_observation"]),
      paymentId: r.payment_id === null ? null : id(r.payment_id),
      refundId: r.refund_id === null ? null : id(r.refund_id),
      kind: choice(r.fact_kind, [
        "sale_observed",
        "payment_reported",
        "sale_cancellation_observed",
        "refund_observed",
      ]),
      cents: cents(r.amount_cents),
      occurredAt: date(r.occurred_at),
      reviewStatus: r.review_status,
    };
  });
  const payments: DeclaredPayment[] = rows.payments.map((raw) => {
    const r = obj(raw);
    if (r.currency !== "EUR") fail();
    const source = choice(r.source_kind, ["manual_declaration", "shopify_observation"]);
    return {
      id: id(r.id),
      orderId: id(r.order_id),
      source,
      cents: cents(r.amount_cents),
      method: choice(
        r.method,
        source === "shopify_observation"
          ? ["shopify_observed"]
          : ["cash", "bank_transfer", "external_card", "other"],
      ),
      occurredAt: date(r.occurred_at),
      reference: optional(r.declared_reference),
    };
  });
  const refunds: ObservedRefund[] = rows.refunds.map((raw) => {
    const r = obj(raw);
    if (r.source_kind !== "shopify_observation" || cents(r.amount_cents) < 1) fail();
    return {
      id: id(r.id),
      orderId: id(r.order_id),
      transactionGid: transactionGid(r.transaction_gid),
      cents: cents(r.amount_cents),
      occurredAt: date(r.occurred_at),
    };
  });
  const shopifyFinancials: ShopifyFinancials[] = rows.shopifyFinancials.map((raw) => {
    const r = obj(raw);
    if (typeof r.taxes_included !== "boolean") fail();
    return {
      orderId: id(r.order_id),
      sourceUpdatedAt: date(r.source_updated_at),
      observedAt: date(r.observed_at),
      taxesIncluded: r.taxes_included,
      totals: financialTotals(r.totals),
    };
  });
  const shopifyTransactions: ShopifyTransactionObservation[] = rows.shopifyTransactions.map(
    (raw) => {
      const r = obj(raw);
      if (r.currency !== "EUR") fail();
      return {
        orderId: id(r.order_id),
        transactionGid: transactionGid(r.transaction_gid),
        kind: choice(r.kind, [
          "AUTHORIZATION",
          "CAPTURE",
          "CHANGE",
          "EMV_AUTHORIZATION",
          "REFUND",
          "SALE",
          "SUGGESTED_REFUND",
          "VOID",
        ]),
        status: choice(r.status, [
          "AWAITING_RESPONSE",
          "ERROR",
          "FAILURE",
          "PENDING",
          "SUCCESS",
          "UNKNOWN",
        ]),
        cents: cents(r.amount_cents),
        currency: "EUR",
        gateway: optional(r.gateway),
        parentGid: r.parent_gid === null ? null : transactionGid(r.parent_gid),
        processedAt: r.processed_at === null ? null : date(r.processed_at),
        sourceUpdatedAt: date(r.source_updated_at),
        observedAt: date(r.observed_at),
      };
    },
  );
  unique(facts.map((v) => v.id));
  unique(payments.map((v) => v.id));
  unique(refunds.map((v) => v.id));
  unique(refunds.map((v) => `${v.orderId}:${v.transactionGid}`));
  unique(shopifyFinancials.map((v) => v.orderId));
  unique(shopifyTransactions.map((v) => `${v.orderId}:${v.transactionGid}`));
  const hasSource = (orderId: string, source: string) =>
    orders.some(
      (o) =>
        o.id === orderId &&
        (o.source === "shopify_canonical"
          ? source === "shopify_observation"
          : source === "manual_declaration"),
    );
  if (
    facts.some((f) => !hasSource(f.orderId, f.source)) ||
    payments.some((p) => !hasSource(p.orderId, p.source)) ||
    [...refunds, ...shopifyFinancials, ...shopifyTransactions].some(
      (r) => !hasSource(r.orderId, "shopify_observation"),
    )
  )
    fail();
  for (const f of facts) {
    if (f.kind === "payment_reported") {
      const p = payments.find((p) => p.id === f.paymentId);
      if (!p || p.orderId !== f.orderId || p.source !== f.source || p.cents !== f.cents) fail();
    } else if (f.paymentId !== null) fail();
    if (f.kind === "refund_observed") {
      const r = refunds.find((r) => r.id === f.refundId);
      if (
        !r ||
        f.source !== "shopify_observation" ||
        r.orderId !== f.orderId ||
        r.cents !== f.cents
      )
        fail();
    } else if (f.refundId !== null) fail();
  }
  for (const p of payments)
    if (facts.filter((f) => f.kind === "payment_reported" && f.paymentId === p.id).length !== 1)
      fail();
  for (const r of refunds)
    if (facts.filter((f) => f.kind === "refund_observed" && f.refundId === r.id).length !== 1)
      fail();
  for (const p of payments.filter((p) => p.source === "shopify_observation")) {
    const t = shopifyTransactions.find(
      (t) => t.orderId === p.orderId && t.transactionGid === p.reference,
    );
    if (
      !t ||
      t.status !== "SUCCESS" ||
      !["CAPTURE", "SALE"].includes(t.kind) ||
      t.cents !== p.cents
    )
      fail();
  }
  for (const r of refunds) {
    const t = shopifyTransactions.find(
      (t) => t.orderId === r.orderId && t.transactionGid === r.transactionGid,
    );
    if (!t || t.status !== "SUCCESS" || t.kind !== "REFUND" || t.cents !== r.cents) fail();
  }
  for (const t of shopifyTransactions.filter((t) => t.status === "SUCCESS" && t.cents > 0)) {
    if (
      ["SALE", "CAPTURE"].includes(t.kind) &&
      payments.filter(
        (p) =>
          p.orderId === t.orderId &&
          p.source === "shopify_observation" &&
          p.reference === t.transactionGid,
      ).length !== 1
    )
      fail();
    if (
      t.kind === "REFUND" &&
      refunds.filter((r) => r.orderId === t.orderId && r.transactionGid === t.transactionGid)
        .length !== 1
    )
      fail();
  }
  for (const o of orders) {
    const sale = facts.filter((f) => f.orderId === o.id && f.kind === "sale_observed");
    if (
      sale.length !== 1 ||
      sale[0].cents !== o.totalCents ||
      facts
        .filter((f) => f.orderId === o.id && f.kind === "sale_cancellation_observed")
        .reduce((sum, f) => sum + BigInt(f.cents), 0n) !== BigInt(o.cancelledCents) ||
      (o.source === "shopify_canonical" &&
        !shopifyFinancials.some(
          (r) => r.orderId === o.id && r.totals.originalTotalCents === o.totalCents,
        ))
    )
      fail();
  }
  entries.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  facts.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  payments.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  refunds.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  shopifyFinancials.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  shopifyTransactions.sort(
    (a, b) =>
      b.observedAt.localeCompare(a.observedAt) || a.transactionGid.localeCompare(b.transactionGid),
  );
  return { entries, facts, payments, orders, refunds, shopifyFinancials, shopifyTransactions };
}
