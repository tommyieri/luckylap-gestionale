import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const access = vi.hoisted(() => vi.fn());
vi.mock("./server", () => ({ financeRevisionAccess: access }));
import {
  legacySettlementSummaryFromDatabase,
  readEffectiveLegacySettlements,
} from "./consignment-projection";
const row = {
  sale_id: "89000000-0000-4000-8000-000000000001",
  claim_cents: "6600",
  net_cents: "7100",
  amount_due_cents: "0",
  refund_due_cents: "500",
  corrected: true,
};
describe("legacy consignment effective collection", () => {
  it("preserves the claim and exposes overpayment separately from the remaining credit", () => {
    expect(legacySettlementSummaryFromDatabase(row)).toMatchObject({
      claimCents: 6600n,
      netCents: 7100n,
      amountDueCents: 0n,
      refundDueCents: 500n,
    });
    expect(legacySettlementSummaryFromDatabase({ ...row, amount_due_cents: "1" })).toBeNull();
    expect(
      legacySettlementSummaryFromDatabase({
        ...row,
        net_cents: "-100",
        amount_due_cents: "6700",
        refund_due_cents: "0",
      })?.netCents,
    ).toBe(-100n);
  });
  it("requires a fresh Finance grant before querying and refuses a partial response", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) };
    access.mockResolvedValue(false);
    await expect(readEffectiveLegacySettlements(client as never, [row.sale_id])).rejects.toThrow();
    expect(client.rpc).not.toHaveBeenCalled();
    access.mockResolvedValue(true);
    await expect(readEffectiveLegacySettlements(client as never, [row.sale_id])).rejects.toThrow();
    client.rpc.mockResolvedValue({ data: [row], error: null });
    expect(await readEffectiveLegacySettlements(client as never, [row.sale_id])).toHaveLength(1);
  });
});
