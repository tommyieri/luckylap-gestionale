import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../app/consignment/actions", () => ({
  runShopCommand: vi.fn(),
  runConsignmentCommand: vi.fn(),
}));

import { ConsignmentOrder, lineFields, ReturnStockForm } from "./consignment-order";
import { item, shopPageRows } from "../lib/consignment/shop-fixtures";
import { orderLinesFromReport, shopPageFromRows } from "../lib/consignment/shop-read";

const NOW = "2026-10-22T10:00:00.000Z";
const page = () => shopPageFromRows(shopPageRows("NEG01"), NOW);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("righe di una griglia", () => {
  it("solo le taglie con pezzi, ordinate; vuoto vale 0; oltre il massimo è un errore", () => {
    const [a, b] = [item("GT3RS", "Blu", "M"), item("964", "Bianco", "L")].sort().reverse();
    expect(lineFields({ [a]: "2", [b]: "1", x: "" })).toEqual({
      status: "ok",
      lines: [
        { stock_item_id: b, quantity: 1 },
        { stock_item_id: a, quantity: 2 },
      ].sort((p, q) => (p.stock_item_id < q.stock_item_id ? -1 : 1)),
    });
    expect(lineFields({ [a]: "3" }, () => 2)).toEqual({ status: "invalid", invalid: new Set([a]) });
    expect(lineFields({ [a]: "due" })).toEqual({ status: "invalid", invalid: new Set([a]) });
  });
});

describe("ordine del negozio", () => {
  it("ordine aperto: richieste, consegnate, da consegnare, in magazzino; mancanze in ambra", () => {
    const p = page();
    const order = p.orders.find((o) => o.number === 2)!;
    const html = renderToStaticMarkup(<ConsignmentOrder page={p} order={order} now={NOW} />);
    const t = text(html);
    expect(t).toContain("Da preparare: 5 · In magazzino: 1 · Mancano: 4");
    expect(t).toContain("GT3RS Blu M");
    expect(t).toContain("F40 Rosso L");
    // Le due righe hanno mancanze: entrambe ambra.
    expect(html.match(/<tr class="[^"]*rowShort/g)).toHaveLength(2);
    for (const action of ["Consegnato", "Modifica ordine", "Chiudi ordine"])
      expect(t).toContain(action);
    expect(t).toContain("Consegne");
  });

  it("ordine consegnato tutto: segno «fatto», nessuna azione", () => {
    const p = page();
    const order = p.orders.find((o) => o.number === 1)!;
    const t = text(renderToStaticMarkup(<ConsignmentOrder page={p} order={order} now={NOW} />));
    expect(t).toContain("fatto");
    expect(t).toContain("Consegnato tutto");
    expect(t).not.toContain("Modifica ordine");
    expect(t).not.toContain("Mancano");
  });

  it("nuovo ordine dalle magliette vendute nel mese, con le mancanze dal vivo", () => {
    const p = page();
    const prefill = orderLinesFromReport(p.reports.find((r) => r.month === "2026-09")!);
    const html = renderToStaticMarkup(
      <ConsignmentOrder page={p} order={null} prefill={prefill} now={NOW} />,
    );
    const t = text(html);
    expect(t).toContain("Ordine già compilato con le magliette vendute nel mese");
    expect(t).toContain("4 magliette · In magazzino 2 · Mancano 2");
    expect(html).toMatch(
      /aria-label="GT3RS Blu M, richieste"[^>]*value="3"|value="3"[^>]*aria-label="GT3RS Blu M, richieste"/,
    );
    expect(t).toContain("Salva ordine");
  });
});

describe("magliette riportate in magazzino", () => {
  it("azione secondaria chiusa finché non si apre", () => {
    const t = text(renderToStaticMarkup(<ReturnStockForm page={page()} now={NOW} />));
    expect(t).toContain("Riporta in magazzino");
    expect(t).not.toContain("Perché le riporti?");
  });
});
