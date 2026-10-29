import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../app/(workspace)/stock/riassortimento/actions", () => ({ runRestockCommand: vi.fn() }));

import { RestockList, totalsText } from "./restock-list";
import { previewRestockData, rx } from "../lib/restock/fixtures";
import { restockDataFromRows } from "../lib/restock/read";
import { restockCoreRows } from "../lib/restock/fixtures";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("elenco dei riordini", () => {
  it("righe roadbook: titolo, passo, da quando, totali per destinazione", () => {
    const html = renderToStaticMarkup(
      <RestockList data={previewRestockData()} userId="anteprima-locale" preview />,
    );
    const t = text(html);
    expect(html).toContain("<h1");
    expect(t).toContain("Riassortimento");
    expect(t).toContain("Nuovo riordine");
    // «In corso» all'inizio: i due riordini non ancora arrivati.
    expect(t).toContain("In corso 2");
    expect(t).toContain("Arrivati 2");
    expect(t).toContain("Eliminati 0");
    expect(t).toContain("Riordine sintetico di ottobre");
    expect(t).toContain("Da Antonella dal 21 ottobre");
    expect(t).toContain("In discussione dal 22 ottobre");
    expect(t).not.toContain("Pezzi arrivati da Antonella");
    expect(html).toContain(`href="/stock/riassortimento/${rx.quality}"`);
    expect(html).toContain('aria-label="Passo 4 di 5: Da Antonella"');
    expect(html).toContain('aria-pressed="true"');
    expect(t).toContain("Anteprima locale: dati sintetici, salvataggio disattivato.");
  });

  it("totali senza le destinazioni vuote, con il nome corto del negozio", () => {
    const data = previewRestockData();
    expect(totalsText(data.orders.find((o) => o.id === rx.quality)!)).toBe(
      "Per noi 22 · Per Negozio sintetico 9 · Per il cliente 2",
    );
    expect(
      totalsText({
        ...data.orders[0],
        state: "discussion",
        totals: { warehouse: 0, shop: 0, customer: 0, total: 0 },
      }),
    ).toBe("Nessuna quantità ancora");
    expect(
      totalsText({
        ...data.orders[0],
        state: "in_hand",
        totals: { warehouse: 0, shop: 0, customer: 0, total: 0 },
      }),
    ).toBe("Chiuso senza ulteriori capi da caricare");
  });

  it("nessun riordine: lo stato vuoto spiega come partire", () => {
    const rows = restockCoreRows();
    const empty = restockDataFromRows({
      ...rows,
      orders: [],
      lines: [],
      events: [],
      arrivals: [],
      shopOrders: [],
      shopOrderLines: [],
    });
    const t = text(renderToStaticMarkup(<RestockList data={empty} userId="u" />));
    expect(t).toContain("Nessun riordine in corso.");
    expect(t).toContain("Discussione su cosa riordinare");
  });

  it("gli eliminati hanno un filtro dedicato e non compaiono fra i riordini attivi o arrivati", () => {
    const data = previewRestockData();
    data.orders = data.orders.map((order) =>
      order.id === rx.quality || order.id === rx.arrived
        ? {
            ...order,
            deleted: {
              at: "2026-10-25T10:00:00Z",
              by: "Collega sintetico",
              note: "Riassortimento duplicato per prova",
            },
          }
        : order,
    );
    const html = renderToStaticMarkup(<RestockList data={data} userId="u" />);
    const t = text(html);
    expect(t).toContain("In corso 1");
    expect(t).toContain("Arrivati 1");
    expect(t).toContain("Eliminati 2");
    expect(t).not.toContain("Riordine sintetico di ottobre");
    expect(html).not.toContain(`href="/stock/riassortimento/${rx.quality}"`);
    expect(html).not.toContain(`href="/stock/riassortimento/${rx.arrived}"`);
  });
});
