import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), createClient: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.verify }));
vi.mock("../supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { executePackagingCommand, readPackagingWorkspace } from "./server";
import { createPackagingMaterial, initializePackagingCount } from "../../app/packaging/actions";
const userId = "00000000-0000-4000-8000-000000000001", itemId = "00000000-0000-4000-8000-000000000002", locationId = "00000000-0000-4000-8000-000000000003", operationId = "00000000-0000-4000-8000-000000000004", movementId = "00000000-0000-4000-8000-000000000005";
const create = { operationId, payload: { schema_version: 1, sku: "SYN-BOX", name: "Synthetic box", packaging_type: "box", specifications: null, unit_cost_cents: null, location_id: locationId, initial_quantity: null } };
const count = { operationId, payload: { schema_version: 1, stock_item_id: itemId, location_id: locationId, quantity: 0, reason: "Synthetic count" } };
type Reply = { data: unknown; error: unknown; count?: number | null };
const receipt = { operation_id: operationId, stock_item_id: itemId, movement_id: null, replayed: false };
function db(replies: Reply[] = [], rpcReply: Reply = { data: receipt, error: null }) {
  const calls: { table: string; methods: { name: string; args: unknown[] }[] }[] = [];
  const client = { rpc: vi.fn().mockResolvedValue(rpcReply), from: vi.fn((table: string) => {
    const reply = replies.shift() ?? { data: null, error: { code: "UNEXPECTED" } };
    const call = { table, methods: [] as { name: string; args: unknown[] }[] }; calls.push(call);
    const query: Record<string, unknown> = {};
    for (const name of ["select", "eq", "order", "limit", "gt", "in"]) query[name] = (...args: unknown[]) => { call.methods.push({ name, args }); return query; };
    query.single = query.maybeSingle = async () => reply;
    query.then = (resolve: (value: Reply) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(reply).then(resolve, reject);
    return query;
  }) };
  mocks.createClient.mockResolvedValue(client); return { client, calls };
}
beforeEach(() => { vi.clearAllMocks(); mocks.verify.mockResolvedValue({ status: "member", member: { userId, displayName: "Synthetic member", role: "logistics", financeAccess: false } }); });
describe("packaging authenticated commands and stable receipts", () => {
  it("checks fresh membership before validation or any database access", async () => {
    const { client } = db(); mocks.verify.mockResolvedValue({ status: "denied" });
    expect(await executePackagingCommand(client as never, "create", null)).toMatchObject({ status: "rejected", code: "membership_required" });
    expect(mocks.verify).toHaveBeenCalledWith(client); expect(client.rpc).not.toHaveBeenCalled(); expect(client.from).not.toHaveBeenCalled();
  });
  it.each(["founder", "production", "logistics", "finance", "consultant"])("allows the active %s role without Finance queries", async role => {
    const { client, calls } = db(); mocks.verify.mockResolvedValue({ status: "member", member: { userId, role } });
    expect(await executePackagingCommand(client as never, "create", create)).toMatchObject({ status: "success", stockItemId: itemId, movementId: null });
    expect(client.rpc).toHaveBeenCalledWith("create_packaging_material", { p_operation_id: operationId, p_payload: create.payload }); expect(calls).toEqual([]);
  });
  it("lets the database recover an exact retry before its mutation flag, without a client-side flag precheck", async () => {
    const { client } = db([], { data: { ...receipt, movement_id: movementId, replayed: true }, error: null });
    expect(await executePackagingCommand(client as never, "count", { ...count, retry: true })).toMatchObject({ status: "success", replayed: true });
    expect(client.from).not.toHaveBeenCalled(); expect(client.rpc).toHaveBeenCalledWith("initialize_packaging_count", { p_operation_id: operationId, p_payload: count.payload });
  });
  it.each(["membership_required", "stock_mutations_disabled", "invalid_payload"])("preserves an unresolved retry when %s may precede receipt lookup", async message => {
    const { client } = db([], { data: null, error: { code: "42501", message } });
    expect(await executePackagingCommand(client as never, "create", { ...create, retry: true })).toMatchObject({ status: "uncertain" });
  });
  it.each([["42501", "stock_mutations_disabled"], ["23505", "sku_already_exists"], ["22023", "known_stock"], ["22023", "invalid_location"], ["22023", "idempotency_conflict"]])("maps definite %s %s safely", async (code, message) => {
    const { client } = db([], { data: null, error: { code, message, details: "Private SQL details" } });
    const result = await executePackagingCommand(client as never, "create", create); expect(result).toMatchObject({ status: "rejected", code: message }); expect(JSON.stringify(result)).not.toContain("Private SQL");
  });
  it("keeps unknown errors, bad receipts, changed operation IDs and count without movement uncertain", async () => {
    for (const data of [null, { ...receipt, operation_id: userId }, { ...receipt, stock_item_id: "invalid" }]) {
      const { client } = db([], { data, error: null }); expect((await executePackagingCommand(client as never, "create", create)).status).toBe("uncertain");
    }
    expect((await executePackagingCommand(db().client as never, "count", count)).status).toBe("uncertain");
    expect((await executePackagingCommand(db().client as never, "create", { ...create, payload: { ...create.payload, initial_quantity: 0 } })).status).toBe("uncertain");
  });
  it("invalid input and an unavailable initial identity never send a mutation", async () => {
    const { client } = db(); expect(await executePackagingCommand(client as never, "create", { ...create, role: "founder" })).toMatchObject({ status: "rejected", code: "invalid_payload" }); expect(client.rpc).not.toHaveBeenCalled();
    mocks.verify.mockRejectedValueOnce(new Error("Private")); expect((await executePackagingCommand(client as never, "create", create)).status).toBe("rejected");
    mocks.verify.mockResolvedValue({ status: "signed-out" }); expect((await executePackagingCommand(client as never, "create", { ...create, retry: true })).status).toBe("uncertain");
  });
  it("uses writable clients and revalidates packaging, stock and inventory only on success", async () => {
    db(); expect((await createPackagingMaterial(create)).status).toBe("success"); expect(mocks.createClient).toHaveBeenCalledWith({ writable: true });
    expect(mocks.revalidate.mock.calls.map(call => call[0])).toEqual(["/packaging", "/stock", "/"]);
    mocks.revalidate.mockImplementationOnce(() => { throw new Error("Rendering failed"); });
    db([], { data: { ...receipt, movement_id: movementId }, error: null }); expect((await initializePackagingCount(count)).status).toBe("success");
  });
});
describe("packaging reads never bypass current membership or silently truncate", () => {
  it("does not read any table when membership is denied", async () => { const { client } = db(); mocks.verify.mockResolvedValue({ status: "denied" }); expect((await readPackagingWorkspace(client as never)).status).toBe("denied"); expect(client.from).not.toHaveBeenCalled(); });
  it("joins complete paginated operational reads with no Finance queries and unknown balances", async () => {
    const { client, calls } = db([
      { data: { stock_adjustments_enabled: true }, error: null },
      { data: [{ id: itemId, sku: "SYN-BOX", name: "Synthetic box", kind: "packaging", active: true, unit_cost_eur: null }], count: 1, error: null },
      { data: [{ stock_item_id: itemId, packaging_type: "box", specifications: null }], count: 1, error: null },
      { data: [{ id: locationId, code: "TEST", name: "Synthetic location", active: true }], count: 1, error: null },
      { data: [], count: 0, error: null },
    ]);
    const result = await readPackagingWorkspace(client as never); expect(result.status).toBe("ready");
    expect(calls.map(call => call.table)).toEqual(["app_settings", "stock_items", "packaging_items", "stock_locations", "operational_stock_availability"]);
    expect(calls[1].methods).toContainEqual({ name: "eq", args: ["kind", "packaging"] });
    expect(calls[2].methods).toContainEqual({ name: "order", args: ["stock_item_id"] });
    if (result.status === "ready") expect(result.snapshot.availability[0].onHand).toBeNull();
  });
  it("refuses a truncated read", async () => {
    const { client } = db([{ data: { stock_adjustments_enabled: false }, error: null }, { data: [], count: 201, error: null }, { data: [], count: 0, error: null }, { data: [], count: 0, error: null }]);
    await expect(readPackagingWorkspace(client as never)).rejects.toThrow(/completa/);
  });
});
