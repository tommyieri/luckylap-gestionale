import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../app/consignment/actions", () => ({
  runShopCommand: vi.fn(),
  runConsignmentCommand: vi.fn(),
}));

import {
  ConsignmentShopSales,
  ConsignmentShopStock,
  monthAbbrev,
  SHOP_SIDE_TITLE,
  ShopFrame,
  ShopStockSummary,
} from "./consignment-shop";
import {
  countEntries,
  countSummary,
  ConsignmentCountForm,
  revealConfirm,
} from "./consignment-count-form";
import { item, shopPageRows } from "../lib/consignment/shop-fixtures";
import { countDraft, shopPageFromRows } from "../lib/consignment/shop-read";

const NOW = "2026-10-22T10:00:00.000Z";
const page = (code = "NEG01", finance = true) => shopPageFromRows(shopPageRows(code, finance), NOW);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const renderStock = (code = "NEG01") =>
  renderToStaticMarkup(
    <ShopFrame
      page={page(code)}
      side="stock"
      userId="u"
      preview={false}
      title={SHOP_SIDE_TITLE.stock}
    >
      <ConsignmentShopStock page={page(code)} now={NOW} />
    </ShopFrame>,
  );
const renderSales = (code = "NEG01", canFinance = true) =>
  renderToStaticMarkup(
    <ShopFrame
      page={page(code, canFinance)}
      side="sales"
      userId="u"
      preview={false}
      title={SHOP_SIDE_TITLE.sales}
    >
      <ConsignmentShopSales page={page(code, canFinance)} canFinance={canFinance} now={NOW} />
    </ShopFrame>,
  );

describe("magazzino del negozio (Magazzino › Conto vendita)", () => {
  it("negozio contato: tutta la griglia S–XL, conta, ordini con mancanze, storico delle magliette", () => {
    const html = renderStock();
    const t = text(html);
    expect(html).toContain(">Magazzino del negozio</h1>");
    expect(t).toContain(
      "Negozio sintetico · NEG01 · Taglie S–XL · Consegne dal Magazzino sintetico",
    );
    expect(t).toContain("In negozio");
    expect(t).toContain("8 magliette");
    expect(t).toContain("Correggi la conta");
    expect(html).toContain('href="/stock/conto-vendita/NEG01/conta"');
    expect(t).toContain("+2 in arrivo");
    // Ogni T-shirt attiva nelle taglie del negozio: S, M, L, XL, niente XS e XXL.
    expect(html).toContain('aria-label="Magliette in negozio da Negozio sintetico"');
    expect(t).not.toMatch(/\bXXL\b/);
    expect(t).toContain("Ordine n. 2");
    expect(t).toContain("Da preparare: 5 · In magazzino: 1 · Mancano: 4");
    expect(t).toContain("1 ordine da consegnare.");
    expect(html).toContain('href="/stock/conto-vendita/NEG01/ordini/nuovo"');
    expect(html).toContain('href="/stock/conto-vendita/NEG01/ordini/2"');
    expect(t).toContain("Storico");
    expect(t).toContain("Conta in negozio: 20 magliette");
    expect(t).toContain("Riportate in magazzino: 2 magliette");
    expect(t).not.toContain("fattura n. 12 segnata");
    expect(html).toContain('href="/stock/conto-vendita/NEG01/impostazioni"');
    expect(html).toContain('href="/consignment/NEG01"');
    // Il resoconto mensile non sta qui.
    expect(t).not.toContain("Resoconto mensile");
    expect(t).not.toContain("Registra le vendite di");
    expect(t).not.toContain("Da fatturare");
  });

  it("negozio da contare: ogni casella «—», «Conta in negozio» principale, avviso ambra", () => {
    const html = renderStock("NEG02");
    const t = text(html);
    expect(t).toContain("Il negozio non è ancora stato contato.");
    expect(t).toContain("Da contare");
    expect(html).toMatch(
      /class="button button-primary" href="\/stock\/conto-vendita\/NEG02\/conta"/,
    );
    expect(t).toContain("Conta in negozio");
    expect(t).toContain("Finché non conti il negozio ogni casella mostra «—»");
    // Nessuna cella a «0» prima della conta: tutte «—» da contare.
    const cells = html.match(/<span class="[^"]*cellValue[^"]*">[^<]*/g) ?? [];
    expect(cells.length).toBeGreaterThan(20);
    expect(cells.every((cell) => cell.endsWith("—"))).toBe(true);
    expect(t).not.toContain("Resoconto di");
  });

  it("modifiche al magazzino sospese: l'avviso e la conta spenta", () => {
    const p = page();
    p.settings = { ...p.settings, stockEnabled: false };
    const html = renderToStaticMarkup(<ConsignmentShopStock page={p} now={NOW} />);
    expect(text(html)).toContain("Le modifiche al magazzino sono sospese.");
    expect(html).toMatch(
      /<button type="button" class="button button-secondary" disabled="">Correggi la conta/,
    );
  });
});

describe("vendite del negozio (Vendite › Conto vendita)", () => {
  it("negozio contato: riepilogo breve delle magliette, mesi con «ora», fattura e pagamento", () => {
    const html = renderSales();
    const t = text(html);
    expect(html).toContain(">Vendite del negozio</h1>");
    expect(t).toContain("Negozio sintetico · NEG01 · Prezzo sito + 10 € · LuckyLap 60%");
    expect(t).toContain("Resoconto mensile");
    expect(t).toContain("A inizio mese il negozio manda su WhatsApp i pezzi venduti: scrivili qui");
    expect(t).toContain("8 magliette in negozio");
    expect(t).toContain("Vedi magazzino del negozio");
    expect(html).toContain('href="/stock/conto-vendita/NEG01"');
    expect(t).toContain("Ottobre 2026");
    expect(t).toContain("ora");
    expect(t).toContain("Settembre 2026");
    expect(t).toContain("4 pezzi · Incasso negozio 224,99 € · Da fatturare 134,99 €");
    expect(t).toContain("Fattura n. 12");
    expect(t).toContain("Pagata in parte");
    expect(html).toContain('href="/consignment/NEG01/resoconto/2026-09"');
    expect(t).toContain("fattura n. 12 segnata");
    // Mai la griglia delle magliette, la conta o gli ordini.
    expect(html).not.toContain("Magliette in negozio da Negozio sintetico");
    expect(t).not.toContain("Correggi la conta");
    expect(t).not.toContain("Nuovo ordine");
    expect(t).not.toContain("Ordine n. 2");
    expect(t).not.toContain("1 ordine da consegnare.");
    expect(t).not.toContain("Conta in negozio: 20 magliette");
    expect(html).toContain('href="/stock/conto-vendita/NEG01/impostazioni"');
  });

  it("mese precedente da registrare: «Registra le vendite di <mese>» grande e in cima", () => {
    const p = page();
    const later = "2026-11-05T10:00:00.000Z";
    const html = renderToStaticMarkup(<ConsignmentShopSales page={p} canFinance now={later} />);
    expect(html).toMatch(
      /class="button button-primary [^"]*entryButton[^"]*" href="\/consignment\/NEG01\/resoconto\/2026-10"/,
    );
    expect(text(html)).toContain("Registra le vendite di ottobre");
    expect(text(html)).toContain("Resoconto di ottobre da registrare.");
    expect(html.indexOf("Registra le vendite di")).toBeLessThan(html.indexOf("Mesi del negozio"));
  });

  it("mese precedente già registrato: il mese in corso resta a portata, in secondo piano", () => {
    const html = renderSales();
    expect(text(html)).toContain("Il mese scorso è registrato");
    expect(html).toMatch(
      /class="button button-secondary [^"]*entryButton[^"]*" href="\/consignment\/NEG01\/resoconto\/2026-10"/,
    );
    expect(text(html)).toContain("Registra le vendite di ottobre");
  });

  it("anche il mese in corso registrato: nessun pulsante, si sceglie il mese dall'elenco", () => {
    const p = page();
    p.reports = [{ ...p.reports[0], month: "2026-10" }, ...p.reports];
    const t = text(renderToStaticMarkup(<ConsignmentShopSales page={p} canFinance now={NOW} />));
    expect(t).not.toContain("Registra le vendite di");
    expect(t).toContain("Nessun mese da registrare adesso. Per un altro mese tocca la sua riga");
  });

  it("negozio da contare: spiega che si conta prima, in Magazzino › Conto vendita", () => {
    const html = renderSales("NEG02");
    const t = text(html);
    expect(t).toContain("Prima conta le magliette in negozio.");
    expect(t).toContain("La conta si fa in Magazzino › Conto vendita.");
    expect(html).toContain('href="/stock/conto-vendita/NEG02/conta"');
    expect(t).not.toContain("In negozio: da contare");
    expect(t).not.toContain("Registra le vendite di");
    // L'avviso della conta sta solo nel magazzino del negozio.
    expect(t).not.toContain("Il negozio non è ancora stato contato.");
  });

  it("senza Finance: stato visibile, fattura e pagamenti con Finance sbloccata", () => {
    const html = renderSales("NEG01", false);
    const t = text(html);
    expect(t).toContain("Fattura e pagamenti si registrano con Finance sbloccata");
    expect(html).toContain('href="/auth/area/finance"');
    expect(t).toContain("Pagata in parte");
  });

  it("riepilogo delle magliette: una riga in sola lettura, mai «0» prima della conta", () => {
    const counted = renderToStaticMarkup(<ShopStockSummary page={page()} />);
    expect(text(counted)).toContain("8 magliette in negozio");
    expect(counted).toContain('href="/stock/conto-vendita/NEG01"');
    expect(counted).not.toContain("<input");
    const uncounted = text(renderToStaticMarkup(<ShopStockSummary page={page("NEG02")} />));
    expect(uncounted).toContain("In negozio: da contare");
    expect(uncounted).not.toMatch(/\b0 magliette/);
  });

  it("mese del resoconto in breve per la colonna di controllo", () => {
    expect(monthAbbrev("2026-10")).toBe("ott");
    expect(monthAbbrev("2026-09")).toBe("set");
  });
});

describe("conta in negozio", () => {
  it("prima conta: vuoto vale 0; correzione: un campo vuoto non è valido", () => {
    const first = page("NEG02"),
      counted = page();
    const m = item("GT3RS", "Blu", "M");
    expect(countEntries(first, { [m]: "" })).toEqual({ status: "ok", entries: { [m]: 0 } });
    expect(countEntries(counted, { [m]: "" })).toEqual({
      status: "invalid",
      invalid: new Set([m]),
    });
    expect(countEntries(counted, { [m]: "4" })).toEqual({ status: "ok", entries: { [m]: 4 } });
  });

  it("riepilogo prima di confermare", () => {
    const first = page("NEG02");
    const draft = countDraft(first, {
      [item("GT3RS", "Blu", "M")]: 5,
      [item("964", "Bianco", "L")]: 2,
    })!;
    expect(countSummary(first, draft)).toBe(
      "Hai contato 7 magliette in 2 varianti. Le altre 21 varianti risultano 0.",
    );
  });

  it("riepilogo della correzione: taglie che cambiano e totale del negozio prima e dopo", () => {
    // In negozio: GT3RS Blu M 5, GT3RS Blu L 2, 964 Bianco L 1 (8 magliette).
    const counted = page();
    const fix = (entries: Record<string, number>) =>
      countSummary(counted, countDraft(counted, entries)!);
    expect(fix({ [item("GT3RS", "Blu", "M")]: 4 })).toBe(
      "Cambi 1 taglia: GT3RS Blu M da 5 a 4. In negozio passano da 8 a 7 magliette.",
    );
    expect(
      fix({
        [item("F40", "Rosso", "M")]: 2,
        [item("GT3RS", "Blu", "M")]: 4,
        [item("964", "Bianco", "L")]: 1,
        [item("GT3RS", "Blu", "L")]: 0,
        [item("GT3RS", "Bianco", "XS")]: 1,
      }),
    ).toBe(
      "Cambi 4 taglie: GT3RS Blu M da 5 a 4, GT3RS Blu L da 2 a 0, GT3RS Bianco XS da 0 a 1 e un’altra. In negozio restano 8 magliette.",
    );
    expect(fix({ [item("964", "Bianco", "L")]: 1 })).toBe(
      "Nessuna taglia cambia. In negozio restano 8 magliette.",
    );
  });

  it("il riepilogo prende il focus e scorre in vista sopra la barra in basso", () => {
    const calls: unknown[][] = [];
    const element = {
      focus: (...args: unknown[]) => calls.push(["focus", ...args]),
      scrollIntoView: (...args: unknown[]) => calls.push(["scrollIntoView", ...args]),
    } as unknown as HTMLElement;
    revealConfirm(element);
    revealConfirm(null);
    expect(calls).toEqual([
      ["focus", { preventScroll: true }],
      ["scrollIntoView", { block: "nearest" }],
    ]);
  });

  it("correzione: caselle già compilate con la giacenza", () => {
    const html = renderToStaticMarkup(<ConsignmentCountForm page={page()} now={NOW} />);
    expect(html).toMatch(
      /aria-label="GT3RS Blu M, contate"[^>]*value="5"|value="5"[^>]*aria-label="GT3RS Blu M, contate"/,
    );
    expect(text(html)).toContain("0 varianti da correggere");
    const first = renderToStaticMarkup(<ConsignmentCountForm page={page("NEG02")} now={NOW} />);
    expect(text(first)).toContain("Le caselle vuote valgono 0");
    expect(text(first)).toContain("0 magliette in 0 varianti");
  });
});
