import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { executeFinanceWork, readFinanceWork } from "./server";
import { manualCommand, workId, workRows } from "./fixtures";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T18:00:00Z"));
});
afterEach(() => vi.useRealTimers());
function fixture({
  member = true,
  active = true,
  signedIn = true,
  role = "finance",
  aal = "aal1",
  finance = true,
  unlocked = true,
} = {}) {
  const rows = workRows(),
    tables: Record<string, unknown[]> = {
      finance_entries: rows.entries,
      finance_entry_voids: rows.voids,
      commercial_facts: rows.facts,
      order_payments: rows.payments,
      sales_orders: rows.orders,
      shopify_refund_observations: rows.refunds,
      shopify_order_financials: rows.shopifyFinancials,
      shopify_transaction_observations: rows.shopifyTransactions,
    };
  const auth = {
    getUser: vi.fn().mockResolvedValue({
      error: null,
      data: { user: signedIn ? { id: workId(10), user_metadata: { role: "founder" } } : null },
    }),
    mfa: {
      getAuthenticatorAssuranceLevel: vi
        .fn()
        .mockResolvedValue({ error: null, data: { currentLevel: aal, nextLevel: "aal2" } }),
    },
  };
  const from = vi.fn((table: string) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      error: null,
      data:
        table === "memberships"
          ? member
            ? { user_id: workId(10), role, active, finance_access: finance }
            : null
          : { user_id: workId(10), display_name: "Synthetic Finance" },
    }),
    range: vi.fn((start: number, end: number) =>
      Promise.resolve({
        error: null,
        count: tables[table]?.length ?? null,
        data: tables[table]?.slice(start, end + 1) ?? null,
      }),
    ),
  }));
  const rpc = vi.fn().mockImplementation(async (name, args) => ({
    error: null,
    data:
      name === "sensitive_area_status"
        ? unlocked
        : { operation_id: args.p_operation_id, entry_id: workId(1), replayed: false },
  }));
  return { client: { auth, from, rpc } as unknown as SupabaseClient, auth, from, rpc };
}
describe("Finance authorization and command receipts", () => {
  it.each([
    { member: false },
    { signedIn: false },
    { active: false },
    ...["founder", "production", "finance", "logistics", "consultant"].map((role) => ({
      role,
      finance: false,
      unlocked: false,
    })),
  ])(
    "does not query protected Finance or mutate without current membership and a fresh area grant",
    async (options) => {
      const f = fixture(options);
      expect((await readFinanceWork(f.client)).status).not.toBe("ready");
      expect(f.from.mock.calls.every((call) => ["profiles", "memberships"].includes(call[0]))).toBe(
        true,
      );
      expect((await executeFinanceWork(f.client, manualCommand())).status).toBe("rejected");
      expect(f.rpc.mock.calls.filter((call) => call[0] !== "sensitive_area_status")).toHaveLength(
        0,
      );
    },
  );
  it.each(["founder", "production", "finance", "logistics", "consultant"])(
    "allows %s to read and register only after checking its current Finance grant",
    async (role) => {
      const f = fixture({ role, finance: false });
      expect((await readFinanceWork(f.client)).status).toBe("ready");
      expect((await executeFinanceWork(f.client, manualCommand())).status).toBe("success");
      expect(f.rpc.mock.calls.filter(([name]) => name === "sensitive_area_status")).toHaveLength(2);
      expect(f.rpc).toHaveBeenCalledWith("sensitive_area_status", { p_area: "finance" });
      expect(f.rpc).toHaveBeenCalledWith("record_finance_entry", {
        p_operation_id: manualCommand().operationId,
        p_payload: manualCommand().payload,
      });
    },
  );
  it("rechecks a revoked grant for the next operation instead of trusting a successful read", async () => {
    const f = fixture({ role: "logistics", finance: false });
    expect((await readFinanceWork(f.client)).status).toBe("ready");
    f.rpc.mockResolvedValue({ data: false, error: null });
    expect((await executeFinanceWork(f.client, manualCommand())).status).toBe("rejected");
    expect(f.rpc.mock.calls.filter(([name]) => name === "record_finance_entry")).toHaveLength(0);
    expect(f.rpc.mock.calls.filter(([name]) => name === "sensitive_area_status")).toHaveLength(2);
  });
  it("reads sales facts/payments and manual sources only after current member and fresh area grant checks", async () => {
    const f = fixture(),
      result = await readFinanceWork(f.client);
    expect(result.status).toBe("ready");
    expect(f.auth.getUser).toHaveBeenCalledOnce();
    expect(f.from.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining([
        "commercial_facts",
        "order_payments",
        "finance_entries",
        "finance_entry_voids",
        "shopify_refund_observations",
        "shopify_order_financials",
        "shopify_transaction_observations",
      ]),
    );
    expect(f.from.mock.calls.some((call) => call[0] === "finance_import_transactions")).toBe(false);
  });
  it("sends exactly one validated command with the original UUID and payload", async () => {
    const f = fixture(),
      command = manualCommand();
    expect((await executeFinanceWork(f.client, command)).status).toBe("success");
    expect(f.rpc).toHaveBeenCalledWith("record_finance_entry", {
      p_operation_id: command.operationId,
      p_payload: command.payload,
    });
    expect(f.rpc.mock.calls.filter((call) => call[0] === "record_finance_entry")).toHaveLength(1);
  });
  it("keeps the original uncertain after area/access revocation rather than authorizing a fresh UUID", async () => {
    const f = fixture({ unlocked: false });
    expect((await executeFinanceWork(f.client, { ...manualCommand(), retry: true })).status).toBe(
      "uncertain",
    );
    expect(f.rpc.mock.calls.filter((call) => call[0] !== "sensitive_area_status")).toHaveLength(0);
  });
  it("sanitizes unknown backend errors and preserves uncertainty on pre-receipt guards", async () => {
    const f = fixture();
    f.rpc.mockImplementation(async (name) =>
      name === "sensitive_area_status"
        ? { data: true, error: null }
        : { data: null, error: { code: "500", message: "Private database payload" } },
    );
    const result = await executeFinanceWork(f.client, manualCommand());
    expect(result.status).toBe("uncertain");
    expect(JSON.stringify(result)).not.toContain("Private database payload");
    for (const message of [
      "finance_access_required",
      "invalid_finance_payload",
      "future_finance_entry",
    ]) {
      f.rpc.mockImplementation(async (name) =>
        name === "sensitive_area_status"
          ? { data: true, error: null }
          : { data: null, error: { code: "22023", message } },
      );
      expect((await executeFinanceWork(f.client, { ...manualCommand(), retry: true })).status).toBe(
        "uncertain",
      );
    }
  });
  it("accepts a replay and rejects mismatched operation receipts as uncertain", async () => {
    const f = fixture();
    f.rpc.mockImplementation(async (name) => ({
      error: null,
      data:
        name === "sensitive_area_status"
          ? true
          : { operation_id: manualCommand().operationId, entry_id: workId(1), replayed: true },
    }));
    expect(await executeFinanceWork(f.client, { ...manualCommand(), retry: true })).toMatchObject({
      status: "success",
      replayed: true,
    });
    f.rpc.mockImplementation(async (name) => ({
      error: null,
      data:
        name === "sensitive_area_status"
          ? true
          : { operation_id: workId(999), entry_id: workId(1), replayed: false },
    }));
    expect((await executeFinanceWork(f.client, manualCommand())).status).toBe("uncertain");
  });
});
