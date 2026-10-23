import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ member: vi.fn() }));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.member }));
import {
  applyEffectiveSalesPayments,
  effectiveSalesPaymentFromDatabase,
  readEffectiveSalesPayments,
} from "./sales-projection";
const id = (n: number) => `88000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = {
  order_id: id(1),
  source_kind: "manual_declaration",
  source_payment_state: "paid",
  payment_state: "partially_paid",
  amount_due_cents: "5000",
  refund_due_cents: "0",
  corrected: true,
};
beforeEach(() => mocks.member.mockReset().mockResolvedValue({ status: "member" }));
describe("one operational payment projection for Sales", () => {
  it("preserves canonical external status without corrections and leaves the internal residual unknown", () => {
    const summary = effectiveSalesPaymentFromDatabase({
      ...row,
      source_kind: "shopify_canonical",
      source_payment_state: "paid",
      payment_state: "paid",
      amount_due_cents: null,
      refund_due_cents: "700",
      corrected: false,
    })!;
    expect(summary.amountDueCents).toBeNull();
    const projected = applyEffectiveSalesPayments(
      [{ id: id(1), paymentState: "paid", refundDueCents: 700 }],
      [summary],
    )[0];
    expect(projected).toMatchObject({
      paymentState: "paid",
      refundDueCents: 700,
      effectiveAmountDueCents: null,
      paymentCorrected: false,
    });
    expect(effectiveSalesPaymentFromDatabase({ ...row, amount_due_cents: null })).toBeNull();
  });
  it("accepts only the safe operational DTO, exact cents and an explicit source state", () => {
    const summary = effectiveSalesPaymentFromDatabase(row)!;
    expect(summary.amountDueCents).toBe(5000n);
    expect(effectiveSalesPaymentFromDatabase({ ...row, account: "Private account" })).toBeNull();
    expect(effectiveSalesPaymentFromDatabase({ ...row, amount_due_cents: 5000 })).toBeNull();
    expect(
      effectiveSalesPaymentFromDatabase({ ...row, amount_due_cents: "9000000000000001" }),
    ).toBeNull();
    const projected = applyEffectiveSalesPayments(
      [{ id: id(1), paymentState: "paid", refundDueCents: 0 }],
      [summary],
    )[0];
    expect(projected).toMatchObject({
      paymentState: "partially_paid",
      sourcePaymentState: "paid",
      effectiveAmountDueCents: 5000,
      paymentCorrected: true,
    });
  });
  it("loads complete batches after current membership and rejects missing orders", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: [row], error: null }) };
    expect(await readEffectiveSalesPayments(client as never, [id(1)])).toHaveLength(1);
    client.rpc.mockResolvedValue({ data: [], error: null });
    await expect(readEffectiveSalesPayments(client as never, [id(1)])).rejects.toThrow();
    mocks.member.mockResolvedValue({ status: "signed-out" });
    client.rpc.mockClear();
    await expect(readEffectiveSalesPayments(client as never, [id(1)])).rejects.toThrow();
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("refuses duplicate/missing summaries rather than leaving Sales on raw payment status", () => {
    const summary = effectiveSalesPaymentFromDatabase(row)!;
    expect(() =>
      applyEffectiveSalesPayments([{ id: id(1), paymentState: "paid", refundDueCents: 0 }], []),
    ).toThrow();
    expect(() =>
      applyEffectiveSalesPayments(
        [{ id: id(2), paymentState: "paid", refundDueCents: 0 }],
        [summary],
      ),
    ).toThrow();
  });
});
