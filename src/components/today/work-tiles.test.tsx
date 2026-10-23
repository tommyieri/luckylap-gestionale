import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PartnerWorkTile, PreparationTile } from "./work-tiles";
import { loadPartnerWorkTile, loadPreparationTile } from "../../lib/today/work-server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../lib/today/server", () => ({ loadAgendaTile: vi.fn(), loadStockTile: vi.fn() }));
vi.mock("../../app/(workspace)/partner/actions", () => ({ recordPartnerActivity: vi.fn() }));
vi.mock("../../lib/today/work-server", () => ({
  loadPartnerWorkTile: vi.fn(),
  loadPreparationTile: vi.fn(),
}));
const db = {} as never;
const me = "00000000-0000-4000-8000-000000000009";
const partnerId = "00000000-0000-4000-8000-000000000042";
describe("Oggi link operativi", () => {
  it("keeps Partner and order failures isolated with visible recovery", async () => {
    vi.mocked(loadPartnerWorkTile).mockResolvedValue({ status: "error" });
    vi.mocked(loadPreparationTile).mockResolvedValue({
      status: "ok",
      data: { orderCount: 0, quantity: 0, orders: [] },
    });
    expect(
      renderToStaticMarkup(await PartnerWorkTile({ supabase: db, now: new Date(), userId: me })),
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
    const html = renderToStaticMarkup(
      await PartnerWorkTile({ supabase: db, now: new Date(), userId: me }),
    );
    expect(html).toContain("9 contatti");
    expect(html).toContain("/partner?co=42#lead-42");
    expect(html).toContain("Prime otto");
    expect(html).toContain("/team/partner");
  });
  it("ogni sollecito ha «Ha risposto», dopo il link della riga", async () => {
    vi.mocked(loadPartnerWorkTile).mockResolvedValue({
      status: "ok",
      data: {
        contactCount: 0,
        contacts: [],
        reminderCount: 2,
        reminders: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            co: 42,
            title: "Sollecito · Partner sintetico",
            dueAt: "2026-10-20T22:00:00.000Z",
            partnerId,
          },
          {
            id: "00000000-0000-4000-8000-000000000002",
            co: 43,
            title: "Sollecito · Senza contatto letto",
            dueAt: "2026-10-21T22:00:00.000Z",
            partnerId: null,
          },
        ],
      },
    });
    const html = renderToStaticMarkup(
      await PartnerWorkTile({ supabase: db, now: new Date(), userId: me }),
    );
    expect(html.match(/>Ha risposto</g)).toHaveLength(1);
    expect(html).toContain("CO 42</span></button>");
    expect(html.indexOf("Sollecito · Partner sintetico")).toBeLessThan(html.indexOf("Ha risposto"));
    expect(html).toContain("2 solleciti in scadenza o in ritardo");
  });
});
