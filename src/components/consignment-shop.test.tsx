import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../app/consignment/actions", () => ({
  runShopCommand: vi.fn(),
  runConsignmentCommand: vi.fn(),
}));

import { ConsignmentShop, monthAbbrev, ShopFrame } from "./consignment-shop";
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
const render = (code = "NEG01", canFinance = true) =>
  renderToStaticMarkup(
    <ShopFrame page={page(code, canFinance)} userId="u" preview={false} title="Negozio">
      <ConsignmentShop page={page(code, canFinance)} canFinance={canFinance} now={NOW} />
    </ShopFrame>,
  );

describe("pagina del negozio", () => {
  it("negozio contato: giacenza, mesi con «ora», ordini con mancanze, storico, impostazioni", () => {
    const html = render();
    const t = text(html);
    expect(t).toContain("In negozio ora");
    expect(t).toContain("8 magliette");
    expect(t).toContain("Correggi la conta");
    expect(t).toContain("+2 in arrivo");
    expect(t).toContain("Ottobre 2026");
    expect(t).toContain("ora");
    expect(t).toContain("Settembre 2026");
    expect(t).toContain("4 pezzi · Incasso negozio 224,99 € · Da fatturare 134,99 €");
    expect(t).toContain("Ordine n. 2");
    expect(t).toContain("Da preparare: 5 · In magazzino: 1 · Mancano: 4");
    expect(t).toContain("1 ordine da consegnare.");
    expect(t).toContain("Storico");
    expect(t).toContain("Conta in negozio: 20 magliette");
    expect(html).toContain('href="/consignment/NEG01/impostazioni"');
    expect(html).toContain('href="/consignment/NEG01/resoconto/2026-09"');
    expect(html).toContain('href="/consignment/NEG01/ordini/nuovo"');
  });

  it("negozio da contare: «—», avviso ambra e «Conta in negozio»; resoconto spiegato", () => {
    const t = text(render("NEG02"));
    expect(t).toContain("Il negozio non è ancora stato contato.");
    expect(t).toContain("Da contare");
    expect(t).toContain("Conta in negozio");
    expect(t).toContain("—");
    expect(t).toContain("Il resoconto si registra dopo la prima conta");
    expect(t).not.toContain("Registra il resoconto di");
  });

  it("modifiche al magazzino sospese: l'avviso e la conta spenta", () => {
    const p = page();
    p.settings = { ...p.settings, stockEnabled: false };
    const html = renderToStaticMarkup(<ConsignmentShop page={p} canFinance now={NOW} />);
    expect(text(html)).toContain("Le modifiche al magazzino sono sospese.");
    expect(html).toMatch(
      /<button type="button" class="button button-secondary" disabled="">Correggi la conta/,
    );
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
