import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  execute: vi.fn(),
  generic: vi.fn(),
  cache: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.cache }));
vi.mock("../../../lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("../../../lib/auth/server", () => ({ verifiedMember: mocks.member }));
vi.mock("../../../lib/finance-revisions/shop-payment-server", () => ({
  executeShopPaymentFinanceCommand: mocks.execute,
}));
vi.mock("../../../lib/finance-revisions/server", () => ({ executeFinanceRevision: mocks.generic }));
import { reviseShopPayment } from "./actions";
import { reviseMovement } from "../movimento/actions";
const id = "91000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cache.mockReset();
  mocks.member.mockResolvedValue({ status: "member", member: { userId: id } });
});
describe("azioni Finance dei due registri", () => {
  it("nega un cambio di account prima di invocare qualsiasi comando", async () => {
    mocks.member.mockResolvedValue({ status: "member", member: { userId: "altro account" } });
    expect(await reviseShopPayment(id, {})).toMatchObject({ status: "uncertain" });
    expect(await reviseMovement(id, {})).toMatchObject({ status: "uncertain" });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.generic).not.toHaveBeenCalled();
  });
  it("preserva la ricevuta P3 e invalida anche le viste dinamiche se una cache fallisce", async () => {
    const result = {
      status: "success",
      kind: "update_consignment_payment",
      operationId: id,
      replayed: false,
      message: "Confermato",
      target: { paymentId: id, version: 2 },
    };
    mocks.execute.mockResolvedValue(result);
    mocks.cache.mockImplementationOnce(() => {
      throw Error("cache down");
    });
    expect(await reviseShopPayment(id, { frozen: "comando sintetico" })).toBe(result);
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({}, { frozen: "comando sintetico" });
    expect(mocks.cache).toHaveBeenCalledWith("/consignment/[code]/resoconto/[month]", "page");
    expect(mocks.cache).toHaveBeenCalledWith("/audit");
    expect(mocks.cache).toHaveBeenCalledWith("/sales");
  });
  it("preserva anche la ricevuta del registro revisioni e aggiorna Oggi, Sales e conto vendita", async () => {
    const result = { status: "success", receipt: { operationId: id }, message: "Confermato" };
    mocks.generic.mockResolvedValue(result);
    mocks.cache.mockImplementationOnce(() => {
      throw Error("cache down");
    });
    expect(await reviseMovement(id, {})).toBe(result);
    expect(mocks.cache).toHaveBeenCalledWith("/");
    expect(mocks.cache).toHaveBeenCalledWith("/sales");
    expect(mocks.cache).toHaveBeenCalledWith("/consignment/[code]", "page");
  });
});
