import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../app/consignment/actions", () => ({
  runShopCommand: vi.fn(),
  runConsignmentCommand: vi.fn(),
}));

import { ConsignmentShops, lastReportLabel } from "./consignment-shops";
import { shopListRows } from "../lib/consignment/shop-fixtures";
import { shopsFromRows, type ShopList, type ShopSide } from "../lib/consignment/shop-read";

const NOW = "2026-10-22T10:00:00.000Z";
const list = () => shopsFromRows(shopListRows(), NOW, NOW);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const render = (l: ShopList, canFinance: boolean, preview = false, side: ShopSide = "sales") =>
  renderToStaticMarkup(
    <ConsignmentShops list={l} side={side} canFinance={canFinance} preview={preview} />,
  );

describe("elenco dei negozi", () => {
  it("Vendite: una riga per negozio con condizioni e ultimo resoconto, verso le vendite", () => {
    const html = render(list(), true);
    const t = text(html);
    expect(html).toContain(">Conto vendita</h1>");
    expect(t).toContain("Le vendite dei negozi: il resoconto di fine mese");
    expect(t).toContain("Negozio sintetico");
    expect(t).toContain("Prezzo sito + 10 € · LuckyLap 60%");
    expect(t).toContain("Settembre · 4 pezzi · Pagata in parte");
    expect(t).not.toContain("ordine da consegnare");
    expect(t).not.toMatch(/8 magliette/);
    // Il secondo negozio non è mai stato contato: «—» e la casella ambra, mai «0».
    expect(t).toContain("Secondo negozio sintetico");
    expect(t).toContain("da contare");
    expect(t).toContain("Prima la conta in Magazzino › Conto vendita");
    expect(html).toContain('href="/consignment/NEG01"');
    expect(html).toContain('href="/consignment/NEG02"');
    expect(html).not.toContain('href="/stock/conto-vendita/NEG01"');
  });

  it("Vendite: il mese da registrare va in ambra nella colonna di controllo", () => {
    const later = shopsFromRows(shopListRows(), "2026-11-05T10:00:00Z", NOW);
    const t = text(render(later, true));
    expect(t).toContain("ott da fare");
    expect(t).toContain("Ottobre da registrare");
  });

  it("Magazzino: magliette in negozio o «da contare» e ordini, verso il magazzino del negozio", () => {
    const html = render(list(), true, false, "stock");
    const t = text(html);
    expect(html).toContain(">Conto vendita</h1>");
    expect(t).toContain("consegne dal Magadzino");
    expect(t).toMatch(/8 magliette/);
    expect(t).toContain("1 ordine da consegnare");
    expect(t).toContain("Da contare in negozio");
    expect(t).not.toMatch(/Secondo negozio sintetico, 0/);
    expect(t).not.toContain("Pagata in parte");
    expect(html).toContain('href="/stock/conto-vendita/NEG01"');
    expect(html).toContain('href="/stock/conto-vendita/NEG02"');
    expect(html).not.toContain('href="/consignment/NEG01"');
  });

  it("i negozi chiusi stanno in un elenco comprimibile", () => {
    const html = render(list(), true);
    const details = html.slice(html.indexOf("<details"));
    expect(details).toContain("Negozi chiusi");
    expect(details).toContain("Negozio sintetico chiuso");
    expect(html.slice(0, html.indexOf("<details"))).not.toContain("Negozio sintetico chiuso");
  });

  it.each<ShopSide>(["stock", "sales"])(
    "%s: «Nuovo negozio» solo con Finance aperta; senza, una riga di testo",
    (side) => {
      expect(render(list(), true, false, side)).toContain('href="/stock/conto-vendita/nuovo"');
      const closed = render(list(), false, false, side);
      expect(closed).not.toContain('href="/stock/conto-vendita/nuovo"');
      expect(text(closed)).toContain("Per aggiungere un negozio apri Finance");
      expect(closed).toContain('href="/auth/area/finance"');
    },
  );

  it("stato vuoto: «Nessun negozio in conto vendita.»", () => {
    const empty = { ...list(), shops: [], closed: [] };
    const withFinance = text(render(empty, true));
    expect(withFinance).toContain("Nessun negozio in conto vendita.");
    expect(withFinance).toContain("Nuovo negozio");
    const without = text(render(empty, false));
    expect(without).toContain("Nessun negozio in conto vendita.");
    expect(without).not.toContain("Nuovo negozio");
  });

  it("in anteprima dice che i dati sono sintetici", () => {
    expect(text(render(list(), true, true))).toContain(
      "Anteprima locale: dati sintetici, salvataggio disattivato.",
    );
    expect(text(render(list(), true))).not.toContain("Anteprima locale");
  });

  it("un mese finito senza resoconto è in ambra, prima dell'ultimo resoconto", () => {
    const row = list().shops.find((s) => s.code === "NEG01")!;
    expect(lastReportLabel({ ...row, missingMonths: ["2026-09"] })).toEqual({
      text: "Settembre da registrare",
      late: true,
    });
    expect(lastReportLabel({ ...row, missingMonths: ["2026-08", "2026-09"] })?.text).toBe(
      "2 resoconti da registrare",
    );
    expect(lastReportLabel({ ...row, lastReport: null, missingMonths: [] })).toBeNull();
  });
});
