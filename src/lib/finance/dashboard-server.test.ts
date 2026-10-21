import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock("../finance-work/server", () => ({ financeWorkAccess: mocks.access }));
import { readDashboardSettlements } from "./dashboard-server";

beforeEach(() => mocks.access.mockReset());
describe("Finance dashboard settlement access", () => {
  it.each(["signed-out", "denied", "area-locked", "unavailable"])(
    "does not query settlements for %s",
    async (status) => {
      mocks.access.mockResolvedValue({ status });
      const from = vi.fn();
      await expect(readDashboardSettlements({ from } as never)).rejects.toThrow(/non disponibile/);
      expect(from).not.toHaveBeenCalled();
    },
  );
  it("uses the caller-scoped client only after a fresh Finance grant, failing closed on incomplete data", async () => {
    mocks.access.mockResolvedValue({ status: "authorized" });
    const range = vi.fn().mockResolvedValue({ data: [], count: 0, error: null });
    const select = vi.fn(() => ({ order: () => ({ range }) }));
    const from = vi.fn(() => ({ select }));
    const client = { from } as never;
    expect(await readDashboardSettlements(client)).toEqual([]);
    expect(mocks.access).toHaveBeenCalledWith(client);
    expect(from).toHaveBeenCalledWith("consignment_settlements");
    expect(select).toHaveBeenCalledWith("id,sale_id,amount_cents,occurred_at,method,reference", {
      count: "exact",
    });
    range.mockResolvedValue({ data: [], count: 1, error: null });
    await expect(readDashboardSettlements(client)).rejects.toThrow();
  });
});
