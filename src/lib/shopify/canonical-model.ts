import "server-only";

export const CANONICAL_MAX_CENTS = 9_000_000_000_000_000;
export type CanonicalLine = { id: string; variantId: string | null; sku: string | null; quantity: number; currentQuantity: number; isGiftCard: boolean; requiresShipping: boolean; originalUnitPriceCents: number; discountedTotalCents: number; lineDiscountCents: number; discountAllocationsCents: number[] };
export type CanonicalFulfillment = { id: string; status: string; locationId: string | null; updatedAt: string; totalQuantity: number; lines: { id: string; lineItemId: string; quantity: number | null }[] };
export type CanonicalTransaction = { id: string; kind: string; status: string; amountCents: number; currency: "EUR"; processedAt: string | null; parentId: string | null; test: boolean; gateway: string | null };
export type CanonicalRefund = { id: string; createdAt: string | null; updatedAt: string; totalRefundedCents: number; lines: { id: string | null; lineItemId: string; quantity: number; restockType: string; restocked: boolean; locationId: string | null }[] };
export type CanonicalShopifyOrder = {
  schemaVersion: 1; apiVersion: "2026-10"; shopDomain: string; orderId: string; sourceName: string | null; retailLocationId: string | null;
  createdAt: string; updatedAt: string; cancelledAt: string | null; test: boolean; edited: boolean; hasDiscountCodes: boolean;
  shopCurrency: "EUR"; presentmentCurrency: "EUR"; taxesIncluded: boolean;
  totals: { originalTotalCents: number; currentTotalCents: number; originalSubtotalCents: number | null; currentSubtotalCents: number; totalShippingPriceCents: number; currentShippingPriceCents: number; originalTaxCents: number | null; currentTaxCents: number; totalRefundedCents: number; totalReceivedCents: number; orderDiscountCents: number | null; totalDiscountCents: number | null };
  lines: CanonicalLine[]; fulfillments: CanonicalFulfillment[]; transactions: CanonicalTransaction[]; refunds: CanonicalRefund[];
};
export type CanonicalFailureCode = "configuration_required" | "invalid_order_id" | "version_mismatch" | "access_denied" | "throttled" | "network_unavailable" | "timeout" | "invalid_response" | "graphql_error" | "order_not_found" | "snapshot_changed" | "pagination_incomplete" | "read_limit" | "unsupported_currency" | "invalid_money" | "invalid_shape" | "duplicate_identity" | "foreign_reference" | "count_incomplete";
export type CanonicalReadResult = { status: "ready"; order: CanonicalShopifyOrder } | { status: "review" | "unavailable"; code: CanonicalFailureCode; message: string };
const messages: Record<CanonicalFailureCode, string> = {
  configuration_required: "La lettura canonica richiede lo shop configurato e una credenziale Admin dell’app sul server.",
  invalid_order_id: "Il riferimento dell’ordine non è valido.", version_mismatch: "La risposta usa una versione API diversa da quella verificata.",
  access_denied: "La credenziale dell’app non consente la lettura completa richiesta.", throttled: "Shopify limita temporaneamente le richieste. Il job resta da riprovare.",
  network_unavailable: "Il collegamento a Shopify non ha confermato la lettura.", timeout: "La lettura ha superato il tempo disponibile. Nessun ordine parziale viene restituito.",
  invalid_response: "La risposta Shopify non è completa o non è leggibile.", graphql_error: "Shopify non ha confermato tutti i campi richiesti.",
  order_not_found: "L’ordine non è disponibile con la credenziale corrente; può richiedere una revisione degli accessi o dello storico.",
  snapshot_changed: "L’ordine è cambiato durante la lettura. Occorre rileggere l’intero stato prima di applicare effetti.",
  pagination_incomplete: "Una pagina non è completa o il cursore non avanza. La lettura va verificata.", read_limit: "La lettura supera i limiti del reader e richiede una revisione.",
  unsupported_currency: "Il reader supporta soltanto importi in euro, senza conversioni implicite.", invalid_money: "Un importo non è rappresentabile esattamente in centesimi entro i limiti previsti.",
  invalid_shape: "I dati canonici non rispettano il formato verificato.", duplicate_identity: "La lettura contiene riferimenti duplicati.",
  foreign_reference: "Un dettaglio non corrisponde all’ordine o alle righe lette.", count_incomplete: "Il conteggio esatto non conferma che l’elenco sia completo.",
};
export class CanonicalReadError extends Error {
  constructor(public code: CanonicalFailureCode, public status: "review" | "unavailable" = "review") { super(messages[code]); }
}
export const canonicalFailure = (error: unknown): Exclude<CanonicalReadResult, { status: "ready" }> => error instanceof CanonicalReadError ? { status: error.status, code: error.code, message: error.message } : { status: "unavailable", code: "invalid_response", message: messages.invalid_response };
export function canonicalRecord(value: unknown): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new CanonicalReadError("invalid_shape"); return value as Record<string, unknown>; }
export function canonicalArray(value: unknown, max = 10000): unknown[] { if (!Array.isArray(value)) throw new CanonicalReadError("invalid_shape"); if (value.length > max) throw new CanonicalReadError("read_limit"); return value; }
export function canonicalGid(value: unknown, resource: string): string { if (typeof value !== "string" || !new RegExp(`^gid://shopify/${resource}/[1-9][0-9]{0,19}$`).test(value)) throw new CanonicalReadError("invalid_shape"); return value; }
export const canonicalShop = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(value);
const integer = (value: unknown, min = 0, max = 1_000_000_000): number => { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new CanonicalReadError("invalid_shape"); return value; };
const boolean = (value: unknown): boolean => { if (typeof value !== "boolean") throw new CanonicalReadError("invalid_shape"); return value; };
const nullableText = (value: unknown, max: number): string | null => { if (value === null) return null; if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new CanonicalReadError("invalid_shape"); return value; };
export function canonicalTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.length > 64) throw new CanonicalReadError("invalid_shape");
  const match = /^(\d{4})-(\d{2})-(\d{2})T([0-1]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,9}))?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  const calendar = match ? new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`) : null;
  if (!match || !calendar || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== `${match[1]}-${match[2]}-${match[3]}` || !Number.isFinite(Date.parse(value))) throw new CanonicalReadError("invalid_shape");
  const utc = new Date(value); if (utc.getUTCFullYear() < 0 || utc.getUTCFullYear() > 9999) throw new CanonicalReadError("invalid_shape");
  // Date truncates sub-millisecond digits. Preserve them so source revisions
  // differing inside one millisecond cannot collapse into the same snapshot.
  return `${utc.toISOString().slice(0, 19)}.${(match[7] ?? "").replace(/0+$/, "").padEnd(3, "0")}Z`;
}
const nullableTimestamp = (value: unknown) => value === null ? null : canonicalTimestamp(value);
const nullableLocation = (value: unknown) => value === null ? null : canonicalGid(canonicalRecord(value).id, "Location");
export function canonicalCents(value: unknown): number {
  if (typeof value !== "string" || value.length > 32) throw new CanonicalReadError("invalid_money");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value); if (!match) throw new CanonicalReadError("invalid_money");
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0")); if (cents > BigInt(CANONICAL_MAX_CENTS)) throw new CanonicalReadError("invalid_money"); return Number(cents);
}
const currency = (value: unknown): "EUR" => { if (value !== "EUR") throw new CanonicalReadError("unsupported_currency"); return "EUR"; };
const money = (value: unknown): number => { const m = canonicalRecord(canonicalRecord(value).shopMoney); currency(m.currencyCode); return canonicalCents(m.amount); };
const nullableMoney = (value: unknown) => value === null ? null : money(value);
const enumeration = (value: unknown, allowed: readonly string[]): string => { if (typeof value !== "string" || !allowed.includes(value)) throw new CanonicalReadError("invalid_shape"); return value; };
export function canonicalUnique(values: string[]) { if (new Set(values).size !== values.length) throw new CanonicalReadError("duplicate_identity"); }
export function canonicalExactCount(value: unknown, count: number) { const c = canonicalRecord(value); if (c.precision !== "EXACT" || integer(c.count, 0, 100000) !== count) throw new CanonicalReadError("count_incomplete"); }
/** Allowlist only. The input is assembled by the paginated reader, never persisted raw. */
export function normalizeCanonicalShopifyOrder(value: unknown, shopDomain: string): CanonicalReadResult {
  try {
    if (!canonicalShop(shopDomain)) throw new CanonicalReadError("configuration_required", "unavailable");
    const raw = canonicalRecord(value), order = canonicalRecord(raw.order), orderId = canonicalGid(order.id, "Order");
    const lines: CanonicalLine[] = canonicalArray(raw.lines).map(value => {
      const r = canonicalRecord(value), quantity = integer(r.quantity), currentQuantity = integer(r.currentQuantity); if (currentQuantity > quantity) throw new CanonicalReadError("invalid_shape");
      return { id: canonicalGid(r.id, "LineItem"), variantId: r.variant === null ? null : canonicalGid(canonicalRecord(r.variant).id, "ProductVariant"), sku: nullableText(r.sku, 120), quantity, currentQuantity, isGiftCard: boolean(r.isGiftCard), requiresShipping: boolean(r.requiresShipping), originalUnitPriceCents: money(r.originalUnitPriceSet), discountedTotalCents: money(r.discountedTotalSet), lineDiscountCents: money(r.totalDiscountSet), discountAllocationsCents: canonicalArray(r.discountAllocations, 1000).map(v => money(canonicalRecord(v).allocatedAmountSet)) };
    }); canonicalUnique(lines.map(r => r.id)); const lineIds = new Set(lines.map(r => r.id));
    const fulfillments: CanonicalFulfillment[] = canonicalArray(raw.fulfillments, 250).map(value => {
      const r = canonicalRecord(value); if (canonicalGid(canonicalRecord(r.order).id, "Order") !== orderId) throw new CanonicalReadError("foreign_reference");
      const result = { id: canonicalGid(r.id, "Fulfillment"), status: enumeration(r.status, ["CANCELLED", "ERROR", "FAILURE", "SUCCESS"]), locationId: nullableLocation(r.location), updatedAt: canonicalTimestamp(r.updatedAt), totalQuantity: integer(r.totalQuantity), lines: canonicalArray(r.lines).map(value => { const l = canonicalRecord(value), lineItemId = canonicalGid(canonicalRecord(l.lineItem).id, "LineItem"); if (!lineIds.has(lineItemId)) throw new CanonicalReadError("foreign_reference"); return { id: canonicalGid(l.id, "FulfillmentLineItem"), lineItemId, quantity: l.quantity === null ? null : integer(l.quantity) }; }) };
      canonicalUnique(result.lines.map(l => l.id)); if (result.lines.every(l => l.quantity !== null) && result.lines.reduce((sum, l) => sum + l.quantity!, 0) !== result.totalQuantity) throw new CanonicalReadError("invalid_shape"); result.lines.sort((a, b) => a.id.localeCompare(b.id)); return result;
    }); canonicalUnique(fulfillments.map(r => r.id)); canonicalExactCount(order.fulfillmentsCount, fulfillments.length);
    const fulfillmentIds = canonicalArray(order.fulfillments, 250).map(v => canonicalGid(canonicalRecord(v).id, "Fulfillment")); canonicalUnique(fulfillmentIds); if (fulfillmentIds.length !== fulfillments.length || fulfillmentIds.some(id => !fulfillments.some(r => r.id === id))) throw new CanonicalReadError("pagination_incomplete");
    const transactions: CanonicalTransaction[] = canonicalArray(order.transactions, 250).map(value => { const r = canonicalRecord(value); return { id: canonicalGid(r.id, "OrderTransaction"), kind: enumeration(r.kind, ["AUTHORIZATION", "CAPTURE", "CHANGE", "EMV_AUTHORIZATION", "REFUND", "SALE", "SUGGESTED_REFUND", "VOID"]), status: enumeration(r.status, ["AWAITING_RESPONSE", "ERROR", "FAILURE", "PENDING", "SUCCESS", "UNKNOWN"]), amountCents: money(r.amountSet), currency: "EUR", processedAt: nullableTimestamp(r.processedAt), parentId: r.parentTransaction === null ? null : canonicalGid(canonicalRecord(r.parentTransaction).id, "OrderTransaction"), test: boolean(r.test), gateway: nullableText(r.gateway, 240) }; }); canonicalUnique(transactions.map(r => r.id)); canonicalExactCount(order.transactionsCount, transactions.length);
    const transactionIds = new Set(transactions.map(r => r.id)); for (const r of transactions) if (r.parentId !== null && (r.parentId === r.id || !transactionIds.has(r.parentId))) throw new CanonicalReadError("foreign_reference");
    const refunds: CanonicalRefund[] = canonicalArray(raw.refunds, 249).map(value => { const r = canonicalRecord(value); if (canonicalGid(canonicalRecord(r.order).id, "Order") !== orderId) throw new CanonicalReadError("foreign_reference"); const result = { id: canonicalGid(r.id, "Refund"), createdAt: nullableTimestamp(r.createdAt), updatedAt: canonicalTimestamp(r.updatedAt), totalRefundedCents: money(r.totalRefundedSet), lines: canonicalArray(r.lines).map(value => { const l = canonicalRecord(value), lineItemId = canonicalGid(canonicalRecord(l.lineItem).id, "LineItem"); if (!lineIds.has(lineItemId)) throw new CanonicalReadError("foreign_reference"); return { id: l.id === null ? null : canonicalGid(l.id, "RefundLineItem"), lineItemId, quantity: integer(l.quantity), restockType: enumeration(l.restockType, ["CANCEL", "LEGACY_RESTOCK", "NO_RESTOCK", "RETURN"]), restocked: boolean(l.restocked), locationId: nullableLocation(l.location) }; }) }; canonicalUnique(result.lines.flatMap(l => l.id === null ? [] : [l.id])); result.lines.sort((a, b) => (a.id ?? a.lineItemId).localeCompare(b.id ?? b.lineItemId)); return result; }); canonicalUnique(refunds.map(r => r.id));
    const refundIds = canonicalArray(order.refunds, 249).map(v => canonicalGid(canonicalRecord(v).id, "Refund")); canonicalUnique(refundIds); if (refundIds.length !== refunds.length || refundIds.some(id => !refunds.some(r => r.id === id))) throw new CanonicalReadError("pagination_incomplete");
    const codes = canonicalArray(order.discountCodes, 1000); if (codes.some(v => typeof v !== "string" || v.length > 1024)) throw new CanonicalReadError("invalid_shape");
    const result: CanonicalShopifyOrder = { schemaVersion: 1, apiVersion: "2026-10", shopDomain, orderId, sourceName: nullableText(order.sourceName, 120), retailLocationId: nullableLocation(order.retailLocation), createdAt: canonicalTimestamp(order.createdAt), updatedAt: canonicalTimestamp(order.updatedAt), cancelledAt: nullableTimestamp(order.cancelledAt), test: boolean(order.test), edited: boolean(order.edited), hasDiscountCodes: codes.length > 0, shopCurrency: currency(order.currencyCode), presentmentCurrency: currency(order.presentmentCurrencyCode), taxesIncluded: boolean(order.taxesIncluded), totals: { originalTotalCents: money(order.totalPriceSet), currentTotalCents: money(order.currentTotalPriceSet), originalSubtotalCents: nullableMoney(order.subtotalPriceSet), currentSubtotalCents: money(order.currentSubtotalPriceSet), totalShippingPriceCents: money(order.totalShippingPriceSet), currentShippingPriceCents: money(order.currentShippingPriceSet), originalTaxCents: nullableMoney(order.totalTaxSet), currentTaxCents: money(order.currentTotalTaxSet), totalRefundedCents: money(order.totalRefundedSet), totalReceivedCents: money(order.totalReceivedSet), orderDiscountCents: nullableMoney(order.cartDiscountAmountSet), totalDiscountCents: nullableMoney(order.totalDiscountsSet) }, lines, fulfillments, transactions, refunds };
    for (const list of [lines, fulfillments, transactions, refunds]) list.sort((a, b) => a.id.localeCompare(b.id)); return { status: "ready", order: result };
  } catch (error) { return canonicalFailure(error); }
}
