import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ member: vi.fn(), grant: vi.fn() }));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.member }));
vi.mock("../auth/sensitive-access", () => ({ verifiedSensitiveAccess: mocks.grant }));
import { executeFinanceRevision, loadFinanceRevisions, loadFinanceRevisionHistory } from "./server";
const id = (n: number) => `87000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const command = {
  operationId: id(1),
  payload: {
    schema_version: 1,
    source_kind: "manual",
    source_id: id(2),
    expected_version: 0,
    action: "delete",
    reason: "Synthetic deletion",
  },
};
const receipt = {
  operation_id: id(1),
  source_kind: "manual",
  source_id: id(2),
  revision_id: id(3),
  version: 1,
  replayed: false,
};
beforeEach(() => {
  mocks.member.mockReset().mockResolvedValue({
    status: "member",
    member: { userId: id(4), displayName: "Synthetic", role: "finance", financeAccess: true },
  });
  mocks.grant.mockReset().mockResolvedValue(true);
});
describe("Finance revision server authorization and frozen receipts", () => {
  it.each(["signed-out", "unavailable", "denied"])(
    "does not query or invoke mutations when %s",
    async (status) => {
      mocks.member.mockResolvedValue({ status });
      const client = { from: vi.fn(), rpc: vi.fn() };
      expect((await executeFinanceRevision(client as never, command)).status).toBe("rejected");
      await expect(loadFinanceRevisions(client as never)).rejects.toThrow();
      expect(client.from).not.toHaveBeenCalled();
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );
  it.each(["founder", "production", "finance", "logistics", "consultant"])(
    "does not read or mutate for %s without its current Finance grant",
    async (role) => {
      mocks.member.mockResolvedValue({
        status: "member",
        member: { userId: id(4), displayName: "Synthetic", role, financeAccess: false },
      });
      mocks.grant.mockResolvedValue(false);
      const client = { from: vi.fn(), rpc: vi.fn() };
      expect((await executeFinanceRevision(client as never, command)).status).toBe("rejected");
      await expect(loadFinanceRevisions(client as never)).rejects.toThrow();
      await expect(
        loadFinanceRevisionHistory(client as never, { sourceKind: "manual", sourceId: id(2) }),
      ).rejects.toThrow();
      expect(mocks.grant).toHaveBeenCalledTimes(3);
      expect(client.from).not.toHaveBeenCalled();
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );
  it.each(["founder", "production", "finance", "logistics", "consultant"])(
    "reads revision heads and sends the validated mutation for %s with a current grant",
    async (role) => {
      const member = { userId: id(4), displayName: "Synthetic", role, financeAccess: false };
      mocks.member.mockResolvedValue({ status: "member", member });
      const q = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
      };
      const client = {
        from: vi.fn(() => q),
        rpc: vi.fn().mockResolvedValue({ data: receipt, error: null }),
      };
      expect(await loadFinanceRevisions(client as never)).toEqual([]);
      expect((await executeFinanceRevision(client as never, command)).status).toBe("success");
      expect(mocks.grant).toHaveBeenCalledTimes(2);
      expect(mocks.grant).toHaveBeenCalledWith(client, member, "finance");
      expect(client.from).toHaveBeenCalledWith("finance_revision_current");
      expect(client.rpc).toHaveBeenCalledWith("revise_finance_movement", {
        p_operation_id: id(1),
        p_payload: command.payload,
      });
    },
  );
  it("rechecks the password grant, retaining uncertainty on a frozen retry", async () => {
    mocks.grant.mockResolvedValue(false);
    const client = { rpc: vi.fn() };
    expect((await executeFinanceRevision(client as never, command)).status).toBe("rejected");
    expect(
      (await executeFinanceRevision(client as never, { ...command, retry: true })).status,
    ).toBe("uncertain");
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("sends only the normalized frozen command and verifies the returned identity/version", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: receipt, error: null }) };
    expect(await executeFinanceRevision(client as never, command)).toMatchObject({
      status: "success",
      receipt: { operationId: id(1), version: 1 },
    });
    expect(client.rpc).toHaveBeenCalledWith("revise_finance_movement", {
      p_operation_id: id(1),
      p_payload: command.payload,
    });
    client.rpc.mockResolvedValue({ data: { ...receipt, version: 2 }, error: null });
    expect((await executeFinanceRevision(client as never, command)).status).toBe("uncertain");
  });
  it("returns known CAS conflict but sanitizes unknown backend payloads", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "22023", message: "finance_revision_conflict" },
      }),
    };
    expect(await executeFinanceRevision(client as never, command)).toMatchObject({
      status: "rejected",
      code: "finance_revision_conflict",
    });
    client.rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "Private raw database detail" },
    });
    const result = await executeFinanceRevision(client as never, command);
    expect(result.status).toBe("uncertain");
    expect(JSON.stringify(result)).not.toContain("Private raw database detail");
  });
  it("never sends the deletion of a sale payment or Shopify refund, and maps the database refusal", async () => {
    for (const source_kind of ["payment", "refund"]) {
      const client = { rpc: vi.fn() };
      const result = await executeFinanceRevision(client as never, {
        ...command,
        payload: { ...command.payload, source_kind },
      });
      expect(result).toMatchObject({
        status: "rejected",
        code: "finance_movement_delete_not_allowed",
      });
      expect(result.message).toContain("«Annulla registrazione» o «Registra reso»");
      expect(client.rpc).not.toHaveBeenCalled();
    }
    // A frozen retry still reaches the database, which answers with the same code.
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "22023", message: "finance_movement_delete_not_allowed" },
      }),
    };
    expect(
      await executeFinanceRevision(client as never, {
        ...command,
        retry: true,
        payload: { ...command.payload, source_kind: "payment" },
      }),
    ).toMatchObject({ status: "rejected", code: "finance_movement_delete_not_allowed" });
    expect(client.rpc).toHaveBeenCalledOnce();
    client.rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "sale_registration_cancelled" },
    });
    expect(
      await executeFinanceRevision(client as never, {
        ...command,
        payload: {
          ...command.payload,
          source_kind: "payment",
          action: "update",
          values: {
            date: "2026-03-17",
            direction: "income",
            amount_cents: 100,
            account: null,
            target_account: null,
            category: "Vendite",
            description: "Synthetic",
            pending: false,
          },
        },
      }),
    ).toMatchObject({ status: "rejected", code: "sale_registration_cancelled" });
  });
  it("rejects incomplete reads and invalid source requests before exposing history", async () => {
    const range = vi.fn().mockResolvedValue({ data: [], count: 1, error: null });
    const q = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range };
    const client = { from: vi.fn(() => q), rpc: vi.fn() };
    await expect(loadFinanceRevisions(client as never)).rejects.toThrow();
    await expect(
      loadFinanceRevisionHistory(client as never, { sourceKind: "manual", sourceId: "invalid" }),
    ).rejects.toThrow();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
