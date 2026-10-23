import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { executeSalesCommand, readSalesWorkspace } from "./server";
import { syntheticId, syntheticRows, syntheticSale } from "./fixtures";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T18:00:00Z"));
});
afterEach(() => vi.useRealTimers());
function fixture({
  member = true,
  role = "logistics",
  enabled = true,
  settingsError = false,
} = {}) {
  const rows = syntheticRows();
  rows.settings = [
    { manual_sales_enabled: enabled, sales_started_at: enabled ? "2026-10-21T00:00:00Z" : null },
  ];
  const tables: Record<string, unknown[]> = {
    app_settings: rows.settings,
    stock_items: rows.items,
    product_variants: rows.variants,
    stock_locations: rows.locations,
    operational_stock_availability: rows.availability,
    sales_orders: rows.orders,
    sales_order_lines: rows.lines,
    stock_reservations: rows.reservations,
    production_requirements: rows.requirements,
  };
  const auth = {
    getUser: vi.fn().mockResolvedValue({
      data: { user: { id: syntheticId(10), user_metadata: { role: "founder" } } },
      error: null,
    }),
  };
  const from = vi.fn((table: string) => {
    const data =
      table === "memberships"
        ? member
          ? { user_id: syntheticId(10), role, active: true, finance_access: false }
          : null
        : table === "profiles"
          ? { user_id: syntheticId(10), display_name: "Synthetic team" }
          : null;
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
      single: vi.fn().mockResolvedValue({
        data: settingsError ? null : (tables[table]?.[0] ?? null),
        error: settingsError ? { message: "private settings error" } : null,
      }),
      range: vi.fn((start: number, end: number) =>
        Promise.resolve({
          data: tables[table]?.slice(start, end + 1) ?? null,
          count: tables[table]?.length ?? null,
          error: null,
        }),
      ),
    };
  });
  const rpc = vi.fn().mockImplementation(async (_name, args) =>
    _name === "read_sales_effective_payments"
      ? {
          error: null,
          data: args.p_order_ids.map((id: string) => ({
            order_id: id,
            source_kind: "manual_declaration",
            source_payment_state: "paid",
            payment_state: "partially_paid",
            amount_due_cents: "2500",
            refund_due_cents: "0",
            corrected: true,
          })),
        }
      : {
          error: null,
          data: { order_id: syntheticId(3), operation_id: args.p_operation_id, replayed: false },
        },
  );
  return { client: { auth, from, rpc } as unknown as SupabaseClient, auth, from, rpc };
}
describe("caller-scoped sales reads and writes", () => {
  it("verifies Auth/membership and reads complete operating data without selecting Finance tables", async () => {
    const f = fixture();
    const result = await readSalesWorkspace(f.client);
    expect(result.status).toBe("ready");
    expect(f.auth.getUser).toHaveBeenCalledTimes(2);
    expect(
      f.from.mock.calls.every(
        (call) =>
          ![
            "order_payments",
            "commercial_facts",
            "finance_entries",
            "finance_import_transactions",
            "shopify_refund_observations",
            "shopify_order_financials",
            "shopify_transaction_observations",
          ].includes(call[0]),
      ),
    ).toBe(true);
    expect(f.rpc).toHaveBeenCalledOnce();
    expect(f.rpc.mock.calls[0][0]).toBe("read_sales_effective_payments");
    if (result.status === "ready")
      expect(result.snapshot.orders[0]).toMatchObject({
        paymentState: "partially_paid",
        effectiveAmountDueCents: 2500,
        paymentCorrected: true,
        sourcePaymentState: "paid",
      });
  });
  it("does not run a command for a missing membership despite founder metadata", async () => {
    const f = fixture({ member: false });
    expect((await executeSalesCommand(f.client, syntheticSale())).status).toBe("rejected");
    expect(f.rpc).not.toHaveBeenCalled();
    expect((await readSalesWorkspace(f.client)).status).toBe("denied");
  });
  it("blocks a fresh submit while disabled without contacting an RPC", async () => {
    const f = fixture({ enabled: false });
    expect(await executeSalesCommand(f.client, syntheticSale())).toMatchObject({
      status: "rejected",
      code: "sales_disabled",
    });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("passes the frozen UUID/payload unchanged to one transaction and supports receipt recovery with the flag off", async () => {
    const f = fixture({ enabled: false }),
      command = { ...syntheticSale(), retry: true };
    f.rpc.mockResolvedValue({
      error: null,
      data: { order_id: syntheticId(3), operation_id: command.operationId, replayed: true },
    });
    expect(await executeSalesCommand(f.client, command)).toMatchObject({
      status: "success",
      replayed: true,
    });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("register_manual_sale", {
      p_operation_id: command.operationId,
      p_payload: command.payload,
    });
  });
  it("limits production completion using the current DB role", async () => {
    const f = fixture();
    expect(
      await executeSalesCommand(f.client, {
        operationId: syntheticId(90),
        kind: "complete_production",
        payload: {
          requirement_id: syntheticId(6),
          quantity: 1,
          occurred_at: "2026-10-21T08:00:00Z",
          reason: "Synthetic checked production",
        },
      }),
    ).toMatchObject({ status: "rejected", code: "production_permission_required" });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("lets the database distinguish external production while manual registrations are closed", async () => {
    const f = fixture({ role: "production", enabled: false });
    const command = {
      operationId: syntheticId(90),
      kind: "complete_production",
      payload: {
        requirement_id: syntheticId(6),
        quantity: 1,
        occurred_at: "2026-10-21T08:00:00Z",
        reason: "Synthetic checked production",
      },
    };
    expect((await executeSalesCommand(f.client, command)).status).toBe("success");
    expect(f.rpc).toHaveBeenCalledWith("complete_production", {
      p_operation_id: command.operationId,
      p_payload: command.payload,
    });
    f.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "sales_disabled" } });
    expect(await executeSalesCommand(f.client, command)).toMatchObject({
      status: "rejected",
      code: "sales_disabled",
    });
  });
  it("explains the database's ban on manual commands against Shopify source orders", async () => {
    const f = fixture();
    f.rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "external_order_managed_by_shopify" },
    });
    expect(await executeSalesCommand(f.client, syntheticSale())).toMatchObject({
      status: "rejected",
      code: "external_order_managed_by_shopify",
    });
  });
  it("maps only known database rejections and preserves uncertainty on unknown/network failures", async () => {
    const f = fixture();
    f.rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "insufficient_ready_stock" },
    });
    expect(await executeSalesCommand(f.client, syntheticSale())).toMatchObject({
      status: "rejected",
      code: "insufficient_ready_stock",
    });
    f.rpc.mockResolvedValue({ data: null, error: { code: "500", message: "private-db-detail" } });
    const unknown = await executeSalesCommand(f.client, syntheticSale());
    expect(unknown.status).toBe("uncertain");
    expect(JSON.stringify(unknown)).not.toContain("private-db-detail");
    f.rpc.mockRejectedValue(new Error("network private detail"));
    expect((await executeSalesCommand(f.client, syntheticSale())).status).toBe("uncertain");
  });
  it("requires a complete response matching the submitted operation", async () => {
    const f = fixture();
    f.rpc.mockResolvedValue({
      error: null,
      data: { order_id: syntheticId(3), operation_id: syntheticId(999), replayed: false },
    });
    expect((await executeSalesCommand(f.client, syntheticSale())).status).toBe("uncertain");
  });
  it("never discards an uncertain original after authorization is revoked before its receipt can be checked", async () => {
    const f = fixture({ member: false });
    expect((await executeSalesCommand(f.client, { ...syntheticSale(), retry: true })).status).toBe(
      "uncertain",
    );
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("keeps retries uncertain for database guards that precede the receipt lookup", async () => {
    const f = fixture();
    for (const message of [
      "membership_required",
      "production_permission_required",
      "invalid_payload",
    ]) {
      f.rpc.mockResolvedValue({ data: null, error: { code: "42501", message } });
      expect(
        (await executeSalesCommand(f.client, { ...syntheticSale(), retry: true })).status,
      ).toBe("uncertain");
    }
  });
  it("keeps the original pending command when settings cannot be read during recovery", async () => {
    const f = fixture({ settingsError: true });
    expect((await executeSalesCommand(f.client, { ...syntheticSale(), retry: true })).status).toBe(
      "uncertain",
    );
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
