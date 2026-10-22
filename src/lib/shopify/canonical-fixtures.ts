// Synthetic API-shaped fixtures only. No merchant/customer data or credentials.
export const canonicalIds = {
  order: "gid://shopify/Order/100",
  line: "gid://shopify/LineItem/200",
  variant: "gid://shopify/ProductVariant/300",
  location: "gid://shopify/Location/400",
  fulfillment: "gid://shopify/Fulfillment/500",
  fulfillmentLine: "gid://shopify/FulfillmentLineItem/600",
  transaction: "gid://shopify/OrderTransaction/700",
  refund: "gid://shopify/Refund/800",
  refundLine: "gid://shopify/RefundLineItem/900",
};
export const canonicalMoney = (amount = "0.00", currencyCode = "EUR") => ({
  shopMoney: { amount, currencyCode },
});
export function canonicalRawFixture() {
  const at = "2026-10-21T11:00:00Z",
    id = canonicalIds;
  const line = {
    id: id.line,
    variant: { id: id.variant },
    sku: "SYNTHETIC-TEE",
    quantity: 2,
    currentQuantity: 1,
    isGiftCard: false,
    requiresShipping: true,
    originalUnitPriceSet: canonicalMoney("50.00"),
    discountedTotalSet: canonicalMoney("90.00"),
    totalDiscountSet: canonicalMoney("10.00"),
    discountAllocations: [{ allocatedAmountSet: canonicalMoney("10.00") }],
  };
  const fulfillment = {
    id: id.fulfillment,
    order: { id: id.order },
    status: "SUCCESS",
    location: { id: id.location },
    updatedAt: at,
    totalQuantity: 1,
    lines: [{ id: id.fulfillmentLine, lineItem: { id: id.line }, quantity: 1 as number | null }],
  };
  const refund = {
    id: id.refund,
    order: { id: id.order },
    createdAt: at as string | null,
    updatedAt: at,
    totalRefundedSet: canonicalMoney("10.00"),
    lines: [
      {
        id: id.refundLine as string | null,
        lineItem: { id: id.line },
        quantity: 1,
        restockType: "RETURN",
        restocked: true,
        location: { id: id.location } as { id: string } | null,
      },
    ],
  };
  const order = {
    id: id.order,
    sourceName: "web" as string | null,
    retailLocation: null as { id: string } | null,
    createdAt: at,
    updatedAt: at,
    cancelledAt: null as string | null,
    test: false,
    edited: false,
    currencyCode: "EUR",
    presentmentCurrencyCode: "EUR",
    taxesIncluded: true,
    discountCodes: [] as string[],
    totalPriceSet: canonicalMoney("100.00"),
    currentTotalPriceSet: canonicalMoney("90.00"),
    subtotalPriceSet: canonicalMoney("90.00") as ReturnType<typeof canonicalMoney> | null,
    currentSubtotalPriceSet: canonicalMoney("80.00"),
    totalShippingPriceSet: canonicalMoney("10.00"),
    currentShippingPriceSet: canonicalMoney("10.00"),
    totalTaxSet: canonicalMoney("16.39") as ReturnType<typeof canonicalMoney> | null,
    currentTotalTaxSet: canonicalMoney("14.75"),
    totalRefundedSet: canonicalMoney("10.00"),
    totalReceivedSet: canonicalMoney("100.00"),
    cartDiscountAmountSet: canonicalMoney() as ReturnType<typeof canonicalMoney> | null,
    totalDiscountsSet: canonicalMoney("10.00") as ReturnType<typeof canonicalMoney> | null,
    transactionsCount: { count: 1, precision: "EXACT" },
    transactions: [
      {
        id: id.transaction,
        kind: "SALE",
        status: "SUCCESS",
        amountSet: canonicalMoney("100.00"),
        processedAt: at as string | null,
        parentTransaction: null as { id: string } | null,
        test: false,
        gateway: "synthetic_gateway" as string | null,
      },
    ],
    fulfillmentsCount: { count: 1, precision: "EXACT" },
    fulfillments: [
      {
        id: fulfillment.id,
        status: fulfillment.status,
        location: fulfillment.location,
        updatedAt: fulfillment.updatedAt,
        totalQuantity: fulfillment.totalQuantity,
      },
    ],
    refunds: [
      {
        id: refund.id,
        createdAt: refund.createdAt,
        updatedAt: refund.updatedAt,
        totalRefundedSet: refund.totalRefundedSet,
      },
    ],
  };
  return { order, lines: [line], fulfillments: [fulfillment], refunds: [refund] };
}
export const canonicalConnection = (
  nodes: unknown[],
  hasNextPage = false,
  endCursor: string | null = nodes.length ? "synthetic-cursor" : null,
) => ({ nodes, pageInfo: { hasNextPage, endCursor } });
