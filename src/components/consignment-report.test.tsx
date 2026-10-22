import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../app/consignment/actions", () => ({
  runShopCommand: vi.fn(),
  runConsignmentCommand: vi.fn(),
}));

import { centsInput, ConsignmentReport, ReportForm, reportEntries } from "./consignment-report";
import { item, shopPageRows, sx } from "../lib/consignment/shop-fixtures";
import { shopPageFromRows } from "../lib/consignment/shop-read";

const NOW = "2026-10-22T10:00:00.000Z";
const page = (code = "NEG01", finance = true) => shopPageFromRows(shopPageRows(code, finance), NOW);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const render = (month: string, canFinance = true, p = page("NEG01", canFinance)) =>
  renderToStaticMarkup(
    <ConsignmentReport page={p} month={month} canFinance={canFinance} now={NOW} />,
  );

describe("campi del resoconto", () => {
  it("vuoto vale 0; «prima della conta» non supera i venduti", () => {
    expect(
      reportEntries({ a: { quantity: "3", before: "" }, b: { quantity: "", before: "" } }),
    ).toEqual({
      status: "ok",
      entries: { a: { quantity: 3, beforeCount: 0 }, b: { quantity: 0, beforeCount: 0 } },
    });
    const bad = reportEntries({
      a: { quantity: "1", before: "2" },
      b: { quantity: "x", before: "" },
      c: { quantity: "2", before: "1" },
    });
    expect(bad).toEqual({ status: "invalid", invalid: new Set(["a", "b"]) });
    expect(centsInput(8499)).toBe("84,99");
    expect(centsInput(5)).toBe("0,05");
  });
});

describe("modulo del mese", () => {
  it("righe delle magliette in negozio, colonna «Prima della conta» dopo una conta del mese", () => {
    const html = render("2026-10");
    const t = text(html);
    // Introduzione di una frase; la spiegazione della colonna si apre a richiesta.
    expect(t).toContain(
      "Scrivi i pezzi venduti a ottobre 2026: la giacenza del negozio scende, la nostra no.",
    );
    expect(html).toMatch(/<details[^>]*><summary>.*Cosa va in «Prima della conta»<\/summary>/);
    expect(t).toContain("GT3RS Blu M");
    expect(t).toContain("GT3RS Blu L");
    expect(t).toContain("964 Bianco L");
    expect(t).toContain("Prima della conta");
    expect(t).toContain("55,00 €");
    expect(t).toContain("59,99 €");
    // Zero pezzi in tutto: il pulsante lo dice.
    expect(t).toContain("0 pezzi · Incasso negozio 0,00 € · Da fatturare 0,00 €");
    expect(t).toContain("Salva: nessuna vendita");
  });

  it("totali calcolati dal vivo dai campi; in modifica il motivo è obbligatorio", () => {
    const p = page();
    const report = p.reports.find((r) => r.month === "2026-09")!;
    const html = renderToStaticMarkup(
      <ReportForm page={p} month="2026-09" report={report} now={NOW} onSaved={vi.fn()} />,
    );
    const t = text(html);
    expect(t).toContain("4 pezzi · Incasso negozio 224,99 € · Da fatturare 134,99 €");
    expect(t).toContain("Perché lo correggi?");
    expect(t).toContain("Salva la correzione");
    expect(html).toContain('aria-label="GT3RS Blu M, venduti"');
    expect(html).toMatch(
      /aria-label="GT3RS Blu M, venduti"[^>]*value="3"|value="3"[^>]*aria-label="GT3RS Blu M, venduti"/,
    );
  });

  it("variante senza prezzo del sito: riga disattivata con la spiegazione", () => {
    const p = page();
    p.shopStock[item("964", "Bianco", "XXL")] = 2;
    const html = render("2026-10", true, p);
    expect(text(html)).toContain("Prezzo del sito mancante: collega lo SKU al catalogo Shopify.");
    expect(html).toMatch(
      /aria-label="964 Bianco XXL, venduti"[^>]*disabled|disabled[^>]*aria-label="964 Bianco XXL, venduti"/,
    );
  });

  it("negozio da contare: niente modulo, si conta prima", () => {
    const t = text(render("2026-10", true, page("NEG02")));
    expect(t).toContain("Prima conta le magliette in negozio.");
    expect(t).not.toContain("Salva resoconto");
  });

  it("i pulsanti restano spenti finché gli invii non sono pronti", () => {
    expect(render("2026-10")).toMatch(
      /<button type="submit" class="button button-primary" disabled/,
    );
  });
});

describe("riepilogo del mese", () => {
  it("quattro numeri, righe a prezzo bloccato, versioni e nota sull'IVA", () => {
    const t = text(render("2026-09"));
    for (const label of [
      "Pezzi venduti",
      "Incasso del negozio",
      "Quota negozio (40%)",
      "Da fatturare al negozio (60%)",
    ])
      expect(t).toContain(label);
    expect(t).toContain("224,99 €");
    expect(t).toContain("90,00 €");
    expect(t).toContain("134,99 €");
    expect(t).toContain("Fattura n. 12 del 3 ottobre 2026");
    expect(t).toContain("Pagata in parte: 50,00 € su 134,99 €");
    expect(t).toContain("Versione 2 · Collega sintetica");
    expect(t).toContain("Il negozio ha corretto una taglia");
    expect(t).toContain("Importi commerciali. Il trattamento IVA va verificato a parte.");
    expect(render("2026-09")).toContain('href="/consignment/NEG01/ordini/nuovo?da=2026-09"');
  });

  it("con Finance aperta: fattura, pagamenti con storico e link al movimento Finance", () => {
    const html = render("2026-09");
    const t = text(html);
    expect(t).toContain("Correggi la fattura");
    expect(t).toContain("Registra pagamento");
    expect(t).toContain("Annullato");
    expect(t).toContain("Storico del pagamento");
    expect(html).toContain(`href="/finance#movimento-shop_payment-${sx.payment}"`);
    expect(html).not.toContain(`movimento-shop_payment-${sx.voidedPayment}`);
  });

  it("senza Finance: solo lo stato, nessun importo pagato e il link per aprire Finance", () => {
    const html = render("2026-09", false);
    const t = text(html);
    expect(t).toContain("Fattura e pagamenti si registrano con Finance sbloccata");
    expect(html).toContain('href="/auth/area/finance"');
    expect(t).toContain("Pagata in parte");
    expect(t).not.toContain("50,00 €");
    expect(t).not.toContain("Registra pagamento");
    expect(t).not.toContain("Correggi la fattura");
  });
});
