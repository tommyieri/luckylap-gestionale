import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../app/consignment/actions", () => ({
  runShopCommand: vi.fn(),
  runConsignmentCommand: vi.fn(),
}));

import {
  ConsignmentOrder,
  deliveryShortfall,
  lineFields,
  ReturnStockForm,
} from "./consignment-order";
import { item, shopPageRows, sid } from "../lib/consignment/shop-fixtures";
import {
  orderLinesFromReport,
  orderProgress,
  shopPageFromRows,
} from "../lib/consignment/shop-read";

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

describe("ordine nato da un riordine", () => {
  it("già compilato con le magliette per il negozio, nota del riordine", () => {
    const p = page();
    const prefill = [{ stock_item_id: item("GT3RS", "Blu", "S"), quantity: 1 }];
    const html = renderToStaticMarkup(
      <ConsignmentOrder
        page={p}
        order={null}
        prefill={prefill}
        restock={{ id: sid(902), title: "Pezzi arrivati da Antonella" }}
        now={NOW}
      />,
    );
    const t = text(html);
    expect(t).toContain(
      "Ordine già compilato con le magliette per il negozio del riordine «Pezzi arrivati da Antonella».",
    );
    expect(html).toContain("Riordine «Pezzi arrivati da Antonella»");
    expect(html).toMatch(
      /aria-label="GT3RS Blu S, richieste"[^>]*value="1"|value="1"[^>]*aria-label="GT3RS Blu S, richieste"/,
    );
    // Il negozio tiene solo S–XL: nessuna casella XS o XXL.
    expect(html).not.toContain('aria-label="GT3RS Blu XS, richieste"');
  });

  it("arrivando dal riordine il modulo «Consegnato» è già aperto, finché non si è consegnato niente", () => {
    const p = page();
    const open = p.orders.find((o) => o.number === 2)!;
    const fresh = { ...open, lines: open.lines.map((l) => ({ ...l, delivered: 0 })) };
    const html = renderToStaticMarkup(
      <ConsignmentOrder page={p} order={fresh} startDelivery now={NOW} />,
    );
    expect(html).toContain('aria-label="Consegna al negozio"');
    const delivered = renderToStaticMarkup(
      <ConsignmentOrder page={p} order={open} startDelivery now={NOW} />,
    );
    expect(open.lines.some((l) => l.delivered > 0)).toBe(true);
    expect(delivered).not.toContain('aria-label="Consegna al negozio"');
  });
});

describe("consegna contro il magazzino di adesso", () => {
  it("residuo oltre il magazzino: avviso prima dell'invio e proposta di consegnare quelle che ci sono", () => {
    const p = page();
    const lines = orderProgress(
      p,
      p.orders.find((o) => o.number === 2)!,
    ).lines;
    const [m, l] = [item("GT3RS", "Blu", "M"), item("F40", "Rosso", "L")];
    // Residuo proposto dal modulo: GT3RS Blu M 2 (in magazzino 1), F40 Rosso L 3 (esaurita).
    expect(deliveryShortfall(lines, { [m]: "2", [l]: "3" })).toEqual({
      short: [
        { itemId: m, text: "GT3RS Blu M (1 su 2)" },
        { itemId: l, text: "F40 Rosso L (0 su 3)" },
      ],
      missing: 4,
      inStock: { [m]: "1", [l]: "0" },
      inStockPieces: 1,
    });
    expect(deliveryShortfall(lines, { [m]: "1", [l]: "" })).toMatchObject({
      short: [],
      missing: 0,
      inStockPieces: 1,
    });
    // Un campo scritto male lo segnala già il controllo del modulo.
    expect(deliveryShortfall(lines, { [m]: "due", [l]: "0" }).short).toEqual([]);
  });
});

describe("magliette riportate in magazzino", () => {
  it("azione secondaria chiusa finché non si apre", () => {
    const t = text(renderToStaticMarkup(<ReturnStockForm page={page()} now={NOW} />));
    expect(t).toContain("Riporta in magazzino");
    expect(t).not.toContain("Perché le riporti?");
  });
});
