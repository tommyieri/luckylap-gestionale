import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), createClient: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.verify }));
vi.mock("../supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { executeStockAdjustment, readStockWorkspace } from "./server";
import { adjustStock } from "../../app/stock/actions";

const userId = "00000000-0000-4000-8000-000000000001";
const itemId = "00000000-0000-4000-8000-000000000002";
const locationId = "00000000-0000-4000-8000-000000000003";
const operationId = "00000000-0000-4000-8000-000000000004";
const movementId = "00000000-0000-4000-8000-000000000005";
const command = { operationId, itemId, locationId, delta: -2, reason: "Synthetic count difference" };
type Reply = { data: unknown; error: unknown; count?: number | null };
function db(replies: Reply[] = [{ data: null, error: null }, { data: { stock_adjustments_enabled: true }, error: null }], rpcReply: Reply = { data: movementId, error: null }) {
  const calls: { table: string; methods: { name: string; args: unknown[] }[] }[] = [];
  const client = { rpc: vi.fn().mockResolvedValue(rpcReply), from: vi.fn((table: string) => {
    const reply = replies.shift() ?? { data: null, error: { code: "UNEXPECTED" } };
    const call = { table, methods: [] as { name: string; args: unknown[] }[] }; calls.push(call);
    const query: Record<string, unknown> = {};
    for (const name of ["select", "eq", "order", "limit", "gt"]) query[name] = (...args: unknown[]) => { call.methods.push({ name, args }); return query; };
    query.single = query.maybeSingle = async () => reply;
    query.then = (resolve: (value: Reply) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(reply).then(resolve, reject);
    return query;
  }) };
  mocks.createClient.mockResolvedValue(client);
  return { client, calls };
}
const existing = () => ({ id: movementId, operation_id: operationId, stock_item_id: itemId, location_id: locationId, quantity_delta: -2, kind: "adjustment", reason: command.reason, actor_id: userId });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue({ status: "member", member: { userId, displayName: "Synthetic member", role: "logistics", financeAccess: false } });
});

describe("stock action authentication, authorization and idempotence", () => {
  it("checks current Auth/membership before malformed input and sends no unauthorised query", async () => {
    const { client } = db(); mocks.verify.mockResolvedValue({ status: "denied" });
    expect(await executeStockAdjustment(client as never, null)).toMatchObject({ status: "rejected", code: "membership_required" });
    expect(mocks.verify).toHaveBeenCalledWith(client); expect(client.from).not.toHaveBeenCalled(); expect(client.rpc).not.toHaveBeenCalled();
  });
  it.each(["founder", "production", "finance", "logistics", "consultant"])("allows the active %s member to send a delta RPC without a Finance query", async role => {
    const { client, calls } = db(); mocks.verify.mockResolvedValue({ status: "member", member: { userId, role, financeAccess: false } });
    expect(await executeStockAdjustment(client as never, command)).toMatchObject({ status: "success", movementId });
    expect(client.rpc).toHaveBeenCalledWith("adjust_stock", { p_operation_id: operationId, p_stock_item_id: itemId, p_location_id: locationId, p_quantity_delta: -2, p_reason: command.reason });
    expect(calls.map(call => call.table)).toEqual(["stock_movements", "app_settings"]);
  });
  it("rejects invalid fields without a database request after current membership verification", async () => {
    const { client } = db(); expect(await executeStockAdjustment(client as never, { ...command, actor_id: userId })).toMatchObject({ status: "rejected", code: "invalid_payload" });
    expect(client.from).not.toHaveBeenCalled(); expect(client.rpc).not.toHaveBeenCalled();
  });
  it("blocks a new write when disabled, while preserving an unresolved retry", async () => {
    for (const retry of [false, true]) {
      const { client } = db([{ data: null, error: null }, { data: { stock_adjustments_enabled: false }, error: null }]);
      expect(await executeStockAdjustment(client as never, { ...command, retry })).toMatchObject(retry ? { status: "uncertain" } : { status: "rejected", code: "disabled" });
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });
  it("recovers the exact immutable movement even if the write flag is now disabled", async () => {
    const { client, calls } = db([{ data: existing(), error: null }]);
    expect(await executeStockAdjustment(client as never, { ...command, retry: true })).toMatchObject({ status: "success", movementId, replayed: true });
    expect(calls).toHaveLength(1); expect(client.rpc).not.toHaveBeenCalled();
  });
  it.each(["actor_id", "quantity_delta", "stock_item_id", "reason"])("does not call a different saved movement a successful retry: %s", key => {
    const row = existing() as Record<string, unknown>; row[key] = key === "quantity_delta" ? 99 : "different";
    const { client } = db([{ data: row, error: null }]);
    return expect(executeStockAdjustment(client as never, { ...command, retry: true })).resolves.toMatchObject({ status: "rejected", code: "idempotency_conflict" });
  });
  it("never drops an unresolved attempt because identity or a pre-RPC read becomes unavailable", async () => {
    const { client } = db(); mocks.verify.mockResolvedValue({ status: "signed-out" });
    expect(await executeStockAdjustment(client as never, { ...command, retry: true })).toMatchObject({ status: "uncertain" });
    mocks.verify.mockRejectedValueOnce(new Error("Private network detail"));
    expect(await executeStockAdjustment(client as never, { ...command, retry: true })).toMatchObject({ status: "uncertain" });
    mocks.verify.mockResolvedValue({ status: "member", member: { userId } });
    const other = db([{ data: null, error: { message: "Private SQL detail" } }]);
    const result = await executeStockAdjustment(other.client as never, { ...command, retry: true });
    expect(result.status).toBe("uncertain"); expect(JSON.stringify(result)).not.toContain("Private");
  });
  it("preserves uncertainty if membership is revoked between lookup and RPC", async () => {
    const { client } = db(undefined, { data: null, error: { code: "42501", message: "Appartenenza LuckyLap richiesta." } });
    expect(await executeStockAdjustment(client as never, { ...command, retry: true })).toMatchObject({ status: "uncertain" });
  });
  it.each([
    ["22023", "reserved_stock_conflict", "reserved_stock_conflict"],
    ["22023", "Quantità sconosciuta: registrare prima una conta iniziale.", "unknown_stock"],
    ["22023", "Stock non inizializzato: serve una conta iniziale autorizzata.", "unknown_stock"],
    ["22023", "La rettifica produrrebbe una giacenza negativa.", "insufficient_stock"],
  ])("maps a definite database rejection without SQL diagnostics", async (code, message, expected) => {
    const { client } = db(undefined, { data: null, error: { code, message, details: "Sensitive SQL" } });
    const result = await executeStockAdjustment(client as never, command);
    expect(result).toMatchObject({ status: "rejected", code: expected }); expect(JSON.stringify(result)).not.toContain("Sensitive SQL");
  });
  it("treats an invalid response or unknown RPC error as uncertain", async () => {
    for (const reply of [{ data: null, error: { code: "NETWORK", message: "Private diagnostics" } }, { data: "not a uuid", error: null }]) {
      const { client } = db(undefined, reply); expect((await executeStockAdjustment(client as never, command)).status).toBe("uncertain");
    }
  });
  it("uses a writable session client and refreshes every affected operational route after confirmation", async () => {
    db(); expect((await adjustStock(command)).status).toBe("success");
    expect(mocks.createClient).toHaveBeenCalledWith({ writable: true }); expect(mocks.revalidate.mock.calls.map(call => call[0])).toEqual(["/stock", "/", "/sales"]);
  });
  it("does not replace a confirmed receipt with uncertainty when a cache refresh fails", async () => {
    db(); mocks.revalidate.mockImplementationOnce(() => { throw new Error("Rendering failed"); });
    expect((await adjustStock(command)).status).toBe("success");
  });
});

describe("stock keyset read boundary", () => {
  it("keeps each location in an exact-count item cursor and makes no Finance queries", async () => {
    const { client, calls } = db([
      { data: { stock_adjustments_enabled: false }, error: null },
      { data: [{ id: itemId, sku: "SYNTHETIC", name: "Synthetic only", kind: "product", active: true }], count: 1, error: null },
      { data: [{ id: locationId, code: "TEST", name: "Synthetic location", active: true }], count: 1, error: null },
      { data: [{ stock_item_id: itemId, location_id: locationId, on_hand: 2, reserved: 1, available: 1 }], count: 1, error: null },
    ]);
    const result = await readStockWorkspace(client as never);
    expect(result.status).toBe("ready"); expect(calls.map(call => call.table)).toEqual(["app_settings", "stock_items", "stock_locations", "operational_stock_availability"]);
    expect(calls[3].methods).toContainEqual({ name: "eq", args: ["location_id", locationId] }); expect(calls[3].methods).toContainEqual({ name: "order", args: ["stock_item_id"] });
  });
  it("rejects truncated pages instead of rendering a misleading complete inventory", async () => {
    const { client } = db([{ data: { stock_adjustments_enabled: false }, error: null }, { data: [], count: 1000, error: null }, { data: [], count: 0, error: null }]);
    await expect(readStockWorkspace(client as never)).rejects.toThrow(/completa/);
  });
});
