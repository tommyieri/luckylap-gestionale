import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PartnerWorkTile, PreparationTile } from "./work-tiles";
import { loadPartnerWorkTile, loadPreparationTile } from "../../lib/today/work-server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../lib/today/server", () => ({ loadAgendaTile: vi.fn(), loadStockTile: vi.fn() }));
vi.mock("../../lib/today/work-server", () => ({
  loadPartnerWorkTile: vi.fn(),
  loadPreparationTile: vi.fn(),
}));
const db = {} as never;
describe("Oggi link operativi", () => {
  it("keeps Partner and order failures isolated with visible recovery", async () => {
    vi.mocked(loadPartnerWorkTile).mockResolvedValue({ status: "error" });
    vi.mocked(loadPreparationTile).mockResolvedValue({
      status: "ok",
      data: { orderCount: 0, quantity: 0, orders: [] },
    });
    expect(
      renderToStaticMarkup(await PartnerWorkTile({ supabase: db, now: new Date() })),
    ).toContain("Non riesco a leggere i contatti");
    expect(renderToStaticMarkup(await PreparationTile({ supabase: db }))).toContain(
      "Tutti gli ordini",
    );
  });
  it("shows canonical CO links and complete totals beyond preview slice", async () => {
    vi.mocked(loadPartnerWorkTile).mockResolvedValue({
      status: "ok",
      data: {
        contactCount: 9,
        contacts: [
          {
            id: "p",
            co: 42,
            name: "Partner sintetico",
            action: "Chiamare",
            dueOn: null,
            owner: "Produzione",
          },
        ],
        reminderCount: 0,
        reminders: [],
      },
    });
    const html = renderToStaticMarkup(await PartnerWorkTile({ supabase: db, now: new Date() }));
    expect(html).toContain("9 contatti");
    expect(html).toContain("/partner?co=42#lead-42");
    expect(html).toContain("Prime otto");
    expect(html).toContain("/team/partner");
  });
});
