import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConsignmentTile } from "./consignment-server";
import { verifiedMember } from "../auth/server";
import { verifiedSensitiveAccess } from "../auth/sensitive-access";
import { readConsignmentFinance } from "../consignment/finance";
import { loadConsignmentToSettle } from "../consignment/shop-finance";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("../auth/server", () => ({ verifiedMember: vi.fn() }));
vi.mock("../auth/sensitive-access", () => ({ verifiedSensitiveAccess: vi.fn() }));
vi.mock("../consignment/finance", () => ({ readConsignmentFinance: vi.fn() }));
vi.mock("../consignment/shop-finance", () => ({ loadConsignmentToSettle: vi.fn() }));
const db = {} as never;
const member = {
  userId: "member",
  displayName: "Membro sintetico",
  role: "finance" as const,
  financeAccess: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(verifiedMember).mockResolvedValue({ status: "member", member });
  vi.mocked(verifiedSensitiveAccess).mockResolvedValue(true);
  vi.mocked(readConsignmentFinance).mockResolvedValue({
    status: "ready",
    snapshot: { rows: [], loadedAt: "2026-10-20T10:00Z" },
  });
  vi.mocked(loadConsignmentToSettle).mockResolvedValue({ status: "ready", rows: [] });
});
describe("Oggi conto vendita", () => {
  it("does not read money for ineligible roles or changed identities", async () => {
    expect(await loadConsignmentTile(db, { ...member, role: "logistics" })).toEqual({
      status: "denied",
    });
    expect(verifiedMember).not.toHaveBeenCalled();
    vi.mocked(verifiedMember).mockResolvedValue({
      status: "member",
      member: { ...member, userId: "other" },
    });
    expect(await loadConsignmentTile(db, member)).toEqual({ status: "denied" });
    expect(loadConsignmentToSettle).not.toHaveBeenCalled();
    expect(readConsignmentFinance).not.toHaveBeenCalled();
  });
  it("shows a locked state without reading projections when the Finance grant expires", async () => {
    vi.mocked(verifiedSensitiveAccess).mockResolvedValue(false);
    expect(await loadConsignmentTile(db, member)).toEqual({ status: "locked" });
    expect(readConsignmentFinance).not.toHaveBeenCalled();
    expect(loadConsignmentToSettle).not.toHaveBeenCalled();
  });
  it("counts all monthly items, includes refunds, and limits only visible rows", async () => {
    vi.mocked(loadConsignmentToSettle).mockResolvedValue({
      status: "ready",
      rows: Array.from({ length: 9 }, (_, i) => ({
        locationId: `shop-${i}`,
        code: "NEG01",
        shopName: "Negozio sintetico",
        month: "2026-10",
        monthLabel: "Ottobre",
        toInvoiceCents: 0,
        toCollectCents: 0,
        toReturnCents: 350,
        state: "da_restituire",
        href: "/consignment/NEG01/resoconto/2026-10",
      })),
    });
    const result = await loadConsignmentTile(db, member);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw Error("Expected ready");
    expect(result.count).toBe(9);
    expect(result.rows).toHaveLength(8);
    expect(result.rows[0]).toMatchObject({
      amountCents: 350,
      state: "da_restituire",
      href: "/consignment/NEG01/resoconto/2026-10",
    });
  });
  it("does not display partial figures when one projection fails", async () => {
    vi.mocked(readConsignmentFinance).mockRejectedValue(new Error("offline"));
    expect(await loadConsignmentTile(db, member)).toEqual({ status: "error" });
    vi.mocked(readConsignmentFinance).mockResolvedValue({ status: "denied" });
    expect(await loadConsignmentTile(db, member)).toEqual({ status: "error" });
  });
});
