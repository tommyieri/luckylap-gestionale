import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), sensitive: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.member }));
vi.mock("../auth/sensitive-access", () => ({ verifiedSensitiveAccess: mocks.sensitive }));
import { consignmentFinanceFromRows, readConsignmentFinance } from "./finance";
import { consignmentSaleRow, cs } from "./fixtures";
const financeSale = () => ({
  ...consignmentSaleRow(),
  shop: { code: "SHOP", name: "Synthetic shop" },
});
const member = {
  userId: cs.user,
  displayName: "Synthetic",
  role: "finance" as const,
  financeAccess: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.member.mockResolvedValue({ status: "member", member });
  mocks.sensitive.mockResolvedValue(false);
});
describe("isolated Finance credit projection", () => {
  it("denied or locked users make zero table queries", async () => {
    const client = { from: vi.fn() };
    expect((await readConsignmentFinance(client as never, member)).status).toBe("denied");
    expect(client.from).not.toHaveBeenCalled();
    mocks.member.mockResolvedValue({ status: "signed-out" });
    expect((await readConsignmentFinance(client as never, member)).status).toBe("signed-out");
    expect(client.from).not.toHaveBeenCalled();
  });
  it("rejects a mismatching supplied identity rather than trusting caller roles", async () => {
    mocks.sensitive.mockResolvedValue(true);
    const client = { from: vi.fn() };
    expect(
      (await readConsignmentFinance(client as never, { ...member, userId: cs.sale })).status,
    ).toBe("denied");
    expect(client.from).not.toHaveBeenCalled();
  });
  it("keeps gross retail sale, 60% claim, received cash and remaining credit distinct", () => {
    const snapshot = consignmentFinanceFromRows(
      [financeSale()],
      [{ id: cs.settlement, sale_id: cs.sale, amount_cents: 1000 }],
    );
    expect(snapshot.rows[0]).toMatchObject({
      grossCents: 5001,
      brandClaimCents: 3001,
      shopShareCents: 2000,
      settledCents: 1000,
      remainingCents: 2001,
      shopLabel: "Synthetic shop",
    });
    expect(consignmentFinanceFromRows([financeSale()], []).rows[0].settledCents).toBe(0);
  });
  it("refuses overpayment and orphaned payment rows", () => {
    expect(() =>
      consignmentFinanceFromRows(
        [financeSale()],
        [{ id: cs.settlement, sale_id: cs.sale, amount_cents: 3002 }],
      ),
    ).toThrow(/completa/);
    expect(() =>
      consignmentFinanceFromRows([], [{ id: cs.settlement, sale_id: cs.sale, amount_cents: 1 }]),
    ).toThrow(/completa/);
  });
  it("reads exactly the two RLS tables after the fresh password gate", async () => {
    mocks.sensitive.mockResolvedValue(true);
    const calls: string[] = [];
    const replies = [
      { data: [financeSale()], count: 1, error: null },
      { data: [], count: 0, error: null },
    ];
    const client = {
      from: vi.fn((name: string) => {
        calls.push(name);
        const reply = replies.shift()!;
        const q: Record<string, unknown> = {};
        for (const k of ["select", "order", "limit", "gt"]) q[k] = () => q;
        q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(reply).then(resolve);
        return q;
      }),
    };
    const result = await readConsignmentFinance(client as never, member);
    expect(result.status).toBe("ready");
    expect(mocks.sensitive).toHaveBeenCalledWith(client, member, "finance");
    expect(calls).toEqual(["consignment_sales", "consignment_settlements"]);
  });
});
