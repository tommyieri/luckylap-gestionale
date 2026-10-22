import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../app/consignment/actions", () => ({
  runShopCommand: vi.fn(),
  runConsignmentCommand: vi.fn(),
}));

import { ConsignmentShops, lastReportLabel } from "./consignment-shops";
import { shopListRows } from "../lib/consignment/shop-fixtures";
import { shopsFromRows, type ShopList } from "../lib/consignment/shop-read";

const NOW = "2026-10-22T10:00:00.000Z";
const list = () => shopsFromRows(shopListRows(), NOW, NOW);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const render = (l: ShopList, canFinance: boolean, preview = false) =>
  renderToStaticMarkup(<ConsignmentShops list={l} canFinance={canFinance} preview={preview} />);

describe("elenco dei negozi", () => {
  it("una riga cliccabile per negozio: giacenza contata o «da contare», condizioni, ultimo resoconto", () => {
    const html = render(list(), true);
    const t = text(html);
    expect(t).toContain("Negozio sintetico");
    expect(t).toMatch(/8 magliette/);
    expect(t).toContain("Prezzo sito + 10 € · LuckyLap 60%");
    expect(t).toContain("Settembre · 4 pezzi · Pagata in parte");
    expect(t).toContain("1 ordine da consegnare");
    // Il secondo negozio non è mai stato contato: «—» e la casella ambra, mai «0».
    expect(t).toContain("Secondo negozio sintetico");
    expect(t).toContain("da contare");
    expect(t).not.toMatch(/Secondo negozio sintetico, 0/);
    expect(html).toContain('href="/consignment/NEG01"');
    expect(html).toContain('href="/consignment/NEG02"');
  });

  it("i negozi chiusi stanno in un elenco comprimibile", () => {
    const html = render(list(), true);
    const details = html.slice(html.indexOf("<details"));
    expect(details).toContain("Negozi chiusi");
    expect(details).toContain("Negozio sintetico chiuso");
    expect(html.slice(0, html.indexOf("<details"))).not.toContain("Negozio sintetico chiuso");
  });

  it("«Nuovo negozio» solo con Finance aperta; senza, una riga di testo", () => {
    expect(render(list(), true)).toContain('href="/consignment/nuovo"');
    const closed = render(list(), false);
    expect(closed).not.toContain('href="/consignment/nuovo"');
    expect(text(closed)).toContain("Per aggiungere un negozio apri Finance");
    expect(closed).toContain('href="/auth/area/finance"');
  });

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
