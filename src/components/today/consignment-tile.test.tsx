import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsignmentTile } from "./consignment-tile";
import { loadConsignmentTile } from "../../lib/today/consignment-server";
vi.mock("../../lib/today/consignment-server", () => ({ loadConsignmentTile: vi.fn() }));
vi.mock("../../lib/today/server", () => ({ loadAgendaTile: vi.fn(), loadStockTile: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const member = {
  userId: "member",
  displayName: "Membro sintetico",
  role: "finance" as const,
  financeAccess: true,
};
const supabase = {} as never;
beforeEach(() => vi.resetAllMocks());
describe("Oggi Finance markup", () => {
  it.each(["founder", "production", "finance", "logistics", "consultant"] as const)(
    "contains neither heading nor Finance data for %s when current membership is denied by the loader",
    async (role) => {
      vi.mocked(loadConsignmentTile).mockResolvedValue({ status: "denied" });
      const current = { ...member, role, financeAccess: false };
      expect(renderToStaticMarkup(await ConsignmentTile({ supabase, member: current }))).toBe("");
      expect(loadConsignmentTile).toHaveBeenCalledExactlyOnceWith(supabase, current);
    },
  );
  it.each(["founder", "production", "finance", "logistics", "consultant"] as const)(
    "contains no money for %s while locked and has an actionable canonical link",
    async (role) => {
      vi.mocked(loadConsignmentTile).mockResolvedValue({ status: "locked" });
      const html = renderToStaticMarkup(
        await ConsignmentTile({ supabase, member: { ...member, role, financeAccess: false } }),
      );
      expect(html).toContain("Apri Finance per leggere");
      expect(html).toContain("/finance#conto-vendita-da-incassare");
      expect(html).not.toContain("€");
      expect(html).not.toContain("password");
    },
  );
  it.each(["founder", "production", "finance", "logistics", "consultant"] as const)(
    "shows the verified monetary tile for %s and links a posted excess for repayment",
    async (role) => {
      vi.mocked(loadConsignmentTile).mockResolvedValue({
        status: "ok",
        count: 9,
        rows: [
          {
            id: "r1",
            shopName: "Negozio sintetico",
            period: "Ottobre",
            href: "/consignment/NEG01/resoconto/2026-10",
            amountCents: 350,
            state: "da_restituire",
          },
        ],
      });
      const html = renderToStaticMarkup(
        await ConsignmentTile({ supabase, member: { ...member, role, financeAccess: false } }),
      );
      expect(html).toContain("Da restituire");
      expect(html).toContain("9 conti da regolare");
      expect(html).toContain("/consignment/NEG01/resoconto/2026-10");
      expect(html).toContain("Prime otto");
    },
  );
});
