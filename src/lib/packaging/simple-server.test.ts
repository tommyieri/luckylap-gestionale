import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.verify }));
import { executeSimplePackagingCommand, readSimplePackagingWorkspace } from "./simple-server";
const item = "00000000-0000-4000-8000-000000000001", operationId = "00000000-0000-4000-8000-000000000002";
const command = { operationId, kind: "adjust", payload: { schema_version: 1, stock_item_id: item, expected_quantity: 100, quantity: 95, reason: "Synthetic count" } };
const receipt = { operation_id: operationId, stock_item_id: item, movement_id: item, remaining_deficit: 0, replayed: false };
const client = (data: unknown = receipt, error: unknown = null) => ({ rpc: vi.fn().mockResolvedValue({ data, error }), from: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); mocks.verify.mockResolvedValue({ status: "member", member: { userId: item, role: "consultant" } }); });
describe("simple packaging authorization and stable operations", () => {
  it("verifies membership before every write/read", async () => {
    const db = client(); mocks.verify.mockResolvedValue({ status: "denied" });
    expect(await executeSimplePackagingCommand(db as never, command)).toMatchObject({ status: "rejected", code: "membership_required" });
    expect((await readSimplePackagingWorkspace(db as never)).status).toBe("denied"); expect(db.rpc).not.toHaveBeenCalled(); expect(db.from).not.toHaveBeenCalled();
  });
  it("sends the expected quantity to the guarded RPC without a flag pre-read", async () => {
    const db = client(); expect(await executeSimplePackagingCommand(db as never, command)).toMatchObject({ status: "success" });
    expect(db.rpc).toHaveBeenCalledWith("adjust_packaging_quantity", { p_operation_id: operationId, p_payload: command.payload }); expect(db.from).not.toHaveBeenCalled();
  });
  it("returns a useful stale-count response without exposing SQL details", async () => {
    const db = client(null, { code: "22023", message: "packaging_quantity_changed", details: "Private SQL" });
    const result = await executeSimplePackagingCommand(db as never, command); expect(result).toMatchObject({ status: "rejected", code: "packaging_quantity_changed" }); expect(JSON.stringify(result)).not.toContain("Private SQL");
  });
  it("keeps an inconclusive retry frozen after membership, validation or flag failures", async () => {
    for (const message of ["stock_mutations_disabled", "membership_required", "invalid_payload"]) expect(await executeSimplePackagingCommand(client(null, { code: "42501", message }) as never, { ...command, retry: true })).toMatchObject({ status: "uncertain" });
    expect(await executeSimplePackagingCommand(client({ ...receipt, operation_id: item }) as never, command)).toMatchObject({ status: "uncertain" });
  });
  it("reconciles without arbitrary historical approval or actor fields", async () => {
    const db = client({ ...receipt, stock_item_id: null }); const value = { operationId, kind: "reconcile", payload: { schema_version: 1 } };
    expect(await executeSimplePackagingCommand(db as never, value)).toMatchObject({ status: "success" });
    expect(db.rpc).toHaveBeenCalledWith("reconcile_packaging_consumption", { p_operation_id: operationId, p_payload: value.payload });
    db.rpc.mockClear(); expect(await executeSimplePackagingCommand(db as never, { ...value, actor_id: item })).toMatchObject({ status: "rejected", code: "invalid_payload" }); expect(db.rpc).not.toHaveBeenCalled();
  });
});
