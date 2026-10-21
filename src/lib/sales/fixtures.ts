// Synthetic-only fixtures for tests; never loaded by the application routes.
import type { SalesRows } from "./read";
export const syntheticId = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const syntheticSale = () => ({ operationId: syntheticId(90), kind: "register_manual_sale", payload: { schema_version: 1, channel: "direct", occurred_at: "2026-10-21T08:00:00Z", location_id: syntheticId(2), lines: [{ stock_item_id: syntheticId(1), quantity: 2, unit_price_cents: 4001, discount_cents: 0 }], fulfillment_mode: "prepare", payment: { status: "unpaid" } } });
export function syntheticRows(): SalesRows {
  return {
    settings: [{ manual_sales_enabled: false, sales_started_at: null }],
    items: [{ id: syntheticId(1), sku: "SYNTHETIC-SKU-M", name: "Synthetic tee", active: true, unit_cost_eur: "13.20", list_price_eur: "40.01" }],
    variants: [{ stock_item_id: syntheticId(1), color: "Synthetic", size: "M" }],
    locations: [{ id: syntheticId(2), code: "TEST", name: "Synthetic warehouse", active: true,location_type:"Magazzino" }],
    availability: [{ stock_item_id: syntheticId(1), location_id: syntheticId(2), on_hand: 5, reserved: 1, available: 4 }],
    orders: [{ id: syntheticId(3), operation_id: syntheticId(4), source_kind:"manual_declaration",channel: "direct", external_reference: null, occurred_at: "2026-10-21T08:00:00Z", total_cents: 8002, cancelled_cents: 0, refund_due_cents: 0, payment_state: "unpaid", fulfillment_state: "unfulfilled", order_state: "confirmed" }],
    lines: [{ id: syntheticId(5), order_id: syntheticId(3), source_kind:"manual_declaration",stock_item_id: syntheticId(1), location_id: syntheticId(2), sku_snapshot: "SYNTHETIC-SKU-M", quantity: 2, fulfilled_quantity: 0, cancelled_quantity: 0, unit_price_cents: 4001, discount_cents: 0, line_total_cents: 8002, cancelled_amount_cents: 0, unit_cost_cents: 1320 }],
    reservations: [{ order_line_id: syntheticId(5), stock_item_id: syntheticId(1), location_id: syntheticId(2), reserved_quantity: 1 }],
    requirements: [{ id: syntheticId(6), order_line_id: syntheticId(5), required_quantity: 1, completed_quantity: 0, cancelled_quantity: 0, status: "to_plan" }],
  };
}
export function externalSyntheticRows(channel="shopify_web"):SalesRows{
 const rows=syntheticRows();Object.assign(rows.orders[0] as Record<string,unknown>,{source_kind:"shopify_canonical",channel,external_reference:"gid://shopify/Order/100",total_cents:9002,payment_state:"partially_paid"});Object.assign(rows.lines[0] as Record<string,unknown>,{source_kind:"shopify_canonical"});return rows;
}
