import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  create: vi.fn(),
  revalidate: vi.fn(),
  sensitive: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.verify }));
vi.mock("../supabase/server", () => ({ createSupabaseServerClient: mocks.create }));
vi.mock("../auth/sensitive-access", () => ({ verifiedSensitiveAccess: mocks.sensitive }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { executeConsignmentCommand, readConsignmentWorkspace } from "./server";
import { runConsignmentCommand } from "../../app/consignment/actions";
import { consignmentRows, cs, saleCommand, settlementCommand, transferCommand } from "./fixtures";
type Reply = { data: unknown; error: unknown; count?: number | null };
function client(
  replies: Reply[] = [],
  rpcReply: Reply = {
    data: { operation_id: cs.operation, transfer_id: cs.operation, replayed: false },
    error: null,
  },
) {
  const calls: string[] = [];
  const db = {
    rpc: vi.fn().mockResolvedValue(rpcReply),
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: vi
          .fn()
          .mockResolvedValue({ data: { currentLevel: "aal2" }, error: null }),
      },
    },
    from: vi.fn((name: string) => {
      calls.push(name);
      const reply = replies.shift() ?? { data: null, error: { code: "UNEXPECTED" } };
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "order", "limit", "gt"]) q[k] = () => q;
      q.single = async () => reply;
      q.then = (resolve: (r: Reply) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(reply).then(resolve, reject);
      return q;
    }),
  };
  mocks.create.mockResolvedValue(db);
  return { db, calls };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.sensitive.mockResolvedValue(false);
  mocks.verify.mockResolvedValue({
    status: "member",
    member: { userId: cs.user, displayName: "Synthetic", role: "consultant", financeAccess: false },
  });
});
describe("caller-scoped consignment actions", () => {
  it("checks current membership before invalid input or queries", async () => {
    const { db } = client();
    mocks.verify.mockResolvedValue({ status: "denied" });
    expect(await executeConsignmentCommand(db as never, null)).toMatchObject({
      status: "rejected",
      code: "membership_required",
    });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });
  it.each(["founder", "production", "logistics", "finance", "consultant"])(
    "allows active %s to transfer without Finance queries",
    async (role) => {
      const { db, calls } = client();
      mocks.verify.mockResolvedValue({ status: "member", member: { userId: cs.user, role } });
      expect(await executeConsignmentCommand(db as never, transferCommand())).toMatchObject({
        status: "success",
      });
      expect(db.rpc).toHaveBeenCalledWith("transfer_consignment_stock", {
        p_operation_id: cs.operation,
        p_payload: transferCommand().payload,
      });
      expect(calls).toEqual([]);
      expect(db.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
    },
  );
  it("never prechecks flags before exact retry recovery", async () => {
    const { db } = client([], {
      data: { operation_id: cs.operation, sale_id: cs.operation, replayed: true },
      error: null,
    });
    expect(
      await executeConsignmentCommand(db as never, { ...saleCommand(), retry: true }),
    ).toMatchObject({ status: "success", replayed: true });
    expect(db.from).not.toHaveBeenCalled();
  });
  it.each([
    "membership_required",
    "finance_access_required",
    "invalid_payload",
    "invalid_date",
    "stock_mutations_disabled",
    "sales_disabled",
  ])("keeps uncertain retry on early %s rejection", async (message) => {
    const { db } = client([], { data: null, error: { code: "42501", message } });
    expect(
      (await executeConsignmentCommand(db as never, { ...transferCommand(), retry: true })).status,
    ).toBe("uncertain");
  });
  it.each([
    "catalog_changed",
    "insufficient_stock",
    "duplicate_reference",
    "settlement_exceeds_claim",
  ])("returns safe definite database rejection %s", async (message) => {
    const { db } = client([], {
      data: null,
      error: { code: "22023", message, details: "private diagnostics" },
    });
    const result = await executeConsignmentCommand(db as never, transferCommand());
    expect(result).toMatchObject({ status: "rejected", code: message });
    expect(JSON.stringify(result)).not.toContain("diagnostics");
  });
  it("requires the verified Finance password gate before settlements", async () => {
    const { db } = client();
    expect(await executeConsignmentCommand(db as never, settlementCommand())).toMatchObject({
      status: "rejected",
      code: "finance_access_required",
    });
    expect(db.rpc).not.toHaveBeenCalled();
    mocks.verify.mockResolvedValue({
      status: "member",
      member: { userId: cs.user, role: "finance", financeAccess: true },
    });
    mocks.sensitive.mockResolvedValue(false);
    expect(
      (await executeConsignmentCommand(db as never, { ...settlementCommand(), retry: true }))
        .status,
    ).toBe("uncertain");
    expect(db.rpc).not.toHaveBeenCalled();
    mocks.sensitive.mockResolvedValue(true);
    db.rpc.mockResolvedValue({
      data: {
        operation_id: cs.operation,
        sale_id: cs.sale,
        settlement_id: cs.operation,
        replayed: false,
      },
      error: null,
    });
    expect((await executeConsignmentCommand(db as never, settlementCommand())).status).toBe(
      "success",
    );
  });
  it("does not trust malformed or mismatched receipts", async () => {
    for (const data of [
      null,
      { operation_id: cs.user, transfer_id: cs.operation, replayed: false },
      { operation_id: cs.operation, transfer_id: cs.sale, replayed: false },
      { operation_id: cs.operation, replayed: false },
    ]) {
      const { db } = client([], { data, error: null });
      expect((await executeConsignmentCommand(db as never, transferCommand())).status).toBe(
        "uncertain",
      );
    }
  });
  it("keeps confirmation when revalidation fails and updates all affected areas", async () => {
    client();
    expect((await runConsignmentCommand(transferCommand())).status).toBe("success");
    expect(mocks.create).toHaveBeenCalledWith({ writable: true });
    expect(mocks.revalidate.mock.calls.map((c) => c[0])).toEqual([
      "/consignment",
      "/stock",
      "/",
      "/finance/work",
      "/finance",
      "/audit",
      "/sales",
    ]);
    mocks.revalidate.mockImplementationOnce(() => {
      throw Error("Rendering");
    });
    expect((await runConsignmentCommand(transferCommand())).status).toBe("success");
  });
});
describe("RLS read boundary", () => {
  it("denied membership never reads operational or Finance data", async () => {
    const { db } = client();
    mocks.verify.mockResolvedValue({ status: "signed-out" });
    expect((await readConsignmentWorkspace(db as never)).status).toBe("signed-out");
    expect(db.from).not.toHaveBeenCalled();
  });
  it("ordinary member reads all operational projections with no settlements or MFA request", async () => {
    const rows = consignmentRows(),
      reply = (data: unknown[]): Reply => ({ data, count: data.length, error: null });
    const { db, calls } = client([
      { data: rows.settings, error: null },
      reply(rows.items),
      reply(rows.variants),
      reply(rows.products),
      reply(rows.locations),
      reply([]),
      reply([]),
      reply(rows.catalog),
      reply(rows.availability.slice(0, 1)),
      reply(rows.availability.slice(1)),
    ]);
    const result = await readConsignmentWorkspace(db as never);
    expect(result.status).toBe("ready");
    expect(calls).not.toContain("consignment_settlements");
    expect(db.auth.mfa.getAuthenticatorAssuranceLevel).not.toHaveBeenCalled();
  });
});
