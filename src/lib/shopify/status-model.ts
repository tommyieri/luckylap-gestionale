export type ShopifySyncSnapshot = {
  configured: boolean;
  enabled: boolean;
  counters: {
    pending: number;
    retry: number;
    processing: number;
    review: number;
    applied: number;
    ignored: number;
    lastAppliedAt: string | null;
  };
  reviews: { orderGid: string; reason: string; observedAt: string }[];
};
export type ShopifySyncStatus =
  { status: "ready"; snapshot: ShopifySyncSnapshot } | { status: "unavailable" };
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const keys = (row: Record<string, unknown>, expected: string[]) =>
  Object.keys(row).length === expected.length &&
  Object.keys(row).every((key) => expected.includes(key));
const timestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 64 &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
const orderGid = (value: unknown): value is string =>
  typeof value === "string" && /^gid:\/\/shopify\/Order\/[1-9]\d{0,19}$/.test(value);
const counterKeys = ["pending", "retry", "processing", "review", "applied", "ignored"] as const;

/** Reject expanded or partial RPC replies instead of exposing private metadata. */
export function shopifySyncSnapshotFrom(
  value: unknown,
  runtimeEnabled: boolean,
): ShopifySyncSnapshot | null {
  const row = record(value),
    counts = record(row?.counters);
  if (
    !row ||
    !counts ||
    !keys(row, ["configured", "enabled", "counters", "reviews"]) ||
    typeof row.configured !== "boolean" ||
    typeof row.enabled !== "boolean" ||
    (!row.configured && row.enabled) ||
    !keys(counts, [...counterKeys, "lastAppliedAt"]) ||
    !Array.isArray(row.reviews) ||
    row.reviews.length > 20
  )
    return null;
  if (
    counterKeys.some(
      (key) =>
        typeof counts[key] !== "number" ||
        !Number.isSafeInteger(counts[key]) ||
        counts[key] < 0 ||
        counts[key] > 1_000_000_000,
    ) ||
    (counts.lastAppliedAt !== null && !timestamp(counts.lastAppliedAt))
  )
    return null;
  const reviews: ShopifySyncSnapshot["reviews"] = [];
  for (const value of row.reviews) {
    const r = record(value);
    if (
      !r ||
      !keys(r, ["orderGid", "reason", "observedAt"]) ||
      !orderGid(r.orderGid) ||
      typeof r.reason !== "string" ||
      !/^[a-z][a-z0-9_]{0,79}$/.test(r.reason) ||
      !timestamp(r.observedAt)
    )
      return null;
    reviews.push({ orderGid: r.orderGid, reason: r.reason, observedAt: r.observedAt });
  }
  if (reviews.length > (counts.review as number)) return null;
  return {
    configured: row.configured,
    enabled: row.enabled && runtimeEnabled === true,
    counters: {
      pending: counts.pending as number,
      retry: counts.retry as number,
      processing: counts.processing as number,
      review: counts.review as number,
      applied: counts.applied as number,
      ignored: counts.ignored as number,
      lastAppliedAt: counts.lastAppliedAt as string | null,
    },
    reviews,
  };
}
export function shopifyReviewHref(shopDomain: unknown, gid: string): string | null {
  if (
    typeof shopDomain !== "string" ||
    !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(shopDomain) ||
    !orderGid(gid)
  )
    return null;
  return `https://${shopDomain}/admin/orders/${gid.split("/").at(-1)}`;
}
const reasonGroups: [string[], string][] = [
  [
    ["unmapped_sku", "inactive_physical_sku", "physical_mapping_changed"],
    "Uno SKU richiede il collegamento al prodotto fisico.",
  ],
  [
    [
      "unknown_physical_stock",
      "unknown_stock",
      "physical_fulfillment_shortage",
      "insufficient_stock",
      "reserved_stock_conflict",
    ],
    "La disponibilità fisica richiede una verifica.",
  ],
  [
    [
      "online_location_required",
      "pos_location_required",
      "fulfillment_location_required",
      "fulfillment_location_mismatch",
      "invalid_sales_location",
    ],
    "Il collegamento dell’ordine a Magadzino richiede una verifica.",
  ],
  [
    [
      "shop_configuration_required",
      "shop_mismatch",
      "token_access_denied",
      "access_denied",
      "token_invalid_response",
    ],
    "Il collegamento Shopify richiede una verifica degli accessi.",
  ],
  [
    [
      "unsupported_currency",
      "unsupported_order_source",
      "gift_card_tender",
      "test_transaction",
      "unsupported_success_transaction",
    ],
    "Questa operazione richiede una verifica prima di essere registrata.",
  ],
  [
    [
      "original_order_changed",
      "same_version_changed",
      "committed_source_effect_disappeared",
      "fulfilled_cancellation_requires_review",
      "unfulfilled_reduction_requires_review",
    ],
    "L’ordine è cambiato e richiede una verifica delle operazioni già registrate.",
  ],
  [
    [
      "observed_payment_mismatch",
      "refund_totals_mismatch",
      "refund_parent_mismatch",
      "missing_transaction_time",
      "unreconciled_order_totals",
      "unreconciled_line_discounts",
    ],
    "Gli importi o i pagamenti dell’ordine richiedono una verifica.",
  ],
  [
    [
      "count_incomplete",
      "pagination_incomplete",
      "read_limit",
      "invalid_response",
      "invalid_canonical",
      "invalid_shape",
      "duplicate_source_id",
      "foreign_reference",
      "canonical_identity_mismatch",
    ],
    "Non è stato possibile verificare tutti i dati dell’ordine.",
  ],
];
export const shopifyReviewLabel = (reason: string) =>
  reasonGroups.find(([codes]) => codes.includes(reason))?.[1] ??
  "L’aggiornamento richiede una verifica prima di applicare altre operazioni.";
