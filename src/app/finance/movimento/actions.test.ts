import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  member: vi.fn(),
  execute: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("../../../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("../../../lib/auth/server", () => ({ verifiedMember: mocks.member }));
vi.mock("../../../lib/finance-revisions/server", () => ({ executeFinanceRevision: mocks.execute }));
import { reviseMovement } from "./actions";
const actor = "90000000-0000-4000-8000-000000000001",
  other = "90000000-0000-4000-8000-000000000002";
const db = {},
  command = { operationId: "90000000-0000-4000-8000-000000000003", retry: true };
beforeEach(() => {
  mocks.client.mockReset().mockResolvedValue(db);
  mocks.member.mockReset().mockResolvedValue({ status: "member", member: { userId: actor } });
  mocks.execute
    .mockReset()
    .mockResolvedValue({ status: "uncertain", message: "Synthetic pending" });
  mocks.revalidate.mockReset();
});
describe("revision action identity and recovery", () => {
  it.each([false, true])(
    "rejects a shared-browser account switch before touching a frozen attempt, retry=%s",
    async (retry) => {
      mocks.member.mockResolvedValue({ status: "member", member: { userId: other } });
      expect((await reviseMovement(actor, { ...command, retry })).status).toBe("uncertain");
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );
  it.each(["signed-out", "denied", "unavailable"])("does not mutate for %s", async (status) => {
    mocks.member.mockResolvedValue({ status });
    expect((await reviseMovement(actor, command)).status).toBe("uncertain");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("keeps frozen payload exact and delegates fresh Finance authorization to the core", async () => {
    await reviseMovement(actor, command);
    expect(mocks.client).toHaveBeenCalledWith({ writable: true });
    expect(mocks.member).toHaveBeenCalledWith(db);
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(db, command);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("invalidates linked views only after a successful receipt", async () => {
    mocks.execute.mockResolvedValue({
      status: "success",
      receipt: {},
      message: "Synthetic success",
    });
    expect((await reviseMovement(actor, command)).status).toBe("success");
    expect(mocks.revalidate.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining([
        "/finance",
        "/finance/work",
        "/finance/movimento",
        "/sales",
        "/audit",
        "/",
      ]),
    );
    mocks.execute.mockResolvedValue({
      status: "rejected",
      code: "finance_revision_conflict",
      message: "Synthetic conflict",
    });
    mocks.revalidate.mockClear();
    expect((await reviseMovement(actor, command)).status).toBe("rejected");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("hides private failures and preserves a confirmed receipt after a cache failure", async () => {
    mocks.execute.mockRejectedValue(new Error("Private backend values"));
    const result = await reviseMovement(actor, command);
    expect(result.status).toBe("uncertain");
    expect(JSON.stringify(result)).not.toContain("Private backend values");
    mocks.execute.mockResolvedValue({
      status: "success",
      receipt: {},
      message: "Synthetic success",
    });
    mocks.revalidate.mockImplementation(() => {
      throw new Error("Private cache details");
    });
    const afterCommit = await reviseMovement(actor, command);
    expect(afterCommit.status).toBe("success");
    expect(JSON.stringify(afterCommit)).not.toContain("Private cache details");
  });
});
