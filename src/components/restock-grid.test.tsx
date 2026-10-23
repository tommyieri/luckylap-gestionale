import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../app/(workspace)/stock/riassortimento/actions", () => ({ runRestockCommand: vi.fn() }));

import {
  editableCell,
  linesFromValues,
  piecesBySize,
  RestockLinesEditor,
  RestockLinesView,
  underTarget,
} from "./restock-grid";
import { previewRestockPage, rx } from "../lib/restock/fixtures";
import { restockGrid } from "../lib/restock/read";
import { item, sid } from "../lib/consignment/shop-fixtures";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const page = (id: string) => previewRestockPage(id)!;

describe("quantità in lettura", () => {
  it("una tabella per gruppo: modello e colore, una riga per destinazione, solo le taglie usate", () => {
    const p = page(rx.quality);
    const html = renderToStaticMarkup(<RestockLinesView catalog={p.catalog} order={p.order} />);
    const t = text(html);
    expect(t).toContain("T-shirt");
    expect(t).toContain("GT3RS Blu");
    expect(t).toContain("964 Bianco");
    expect(html).toContain(">XXXL<");
    // La riga del negozio si chiama col nome corto; il cliente «Cliente».
    expect(t).toContain("Negozio sintetico");
    expect(t).toContain("Cliente");
    expect(t).toContain("Noi = per il Magazzino sintetico");
    expect(t).not.toContain("Altri prodotti");
  });

  it("senza quantità spiega come partire", () => {
    const p = page(rx.discussion);
    const t = text(
      renderToStaticMarkup(
        <RestockLinesView catalog={p.catalog} order={{ ...p.order, lines: [] }} />,
      ),
    );
    expect(t).toContain("Ancora nessuna quantità.");
  });
});

describe("modifica delle quantità", () => {
  it("righe dai campi: solo le celle con pezzi; un campo non valido è segnalato", () => {
    const product = sid(20);
    expect(
      linesFromValues({
        [`warehouse|${product}|Blu|M`]: "3",
        [`shop|${product}|Blu|S`]: "",
        [`customer|${product}|Blu|XXXL`]: " 1 ",
      }),
    ).toEqual({
      lines: [
        { destination: "warehouse", product_id: product, color: "Blu", size: "M", quantity: 3 },
        { destination: "customer", product_id: product, color: "Blu", size: "XXXL", quantity: 1 },
      ],
      invalid: [],
    });
    expect(linesFromValues({ [`warehouse|${product}|Blu|M`]: "tre" }).invalid).toHaveLength(1);
    expect(linesFromValues({ [`warehouse|${product}|Blu|M`]: "1000000" }).invalid).toHaveLength(1);
  });

  it("per il negozio solo le sue taglie; XXXL solo per il cliente; varianti spente mai", () => {
    const p = page(rx.discussion);
    const groups = restockGrid(p.catalog, p.order.lines);
    const blu = groups[0].rows.find((r) => r.model === "GT3RS" && r.color === "Blu")!;
    const cell = (size: string) => blu.cells.find((c) => c.size === size)!;
    const sizes = p.order.shop!.sizes;
    expect(editableCell("shop", blu, cell("S"), sizes)).toBe(true);
    expect(editableCell("shop", blu, cell("XS"), sizes)).toBe(false);
    expect(editableCell("shop", blu, cell("XXL"), sizes)).toBe(false);
    expect(editableCell("warehouse", blu, cell("XXXL"), sizes)).toBe(false);
    expect(editableCell("customer", blu, cell("XXXL"), sizes)).toBe(true);
    const rosso = groups[0].rows.find((r) => r.model === "F40")!;
    const off = rosso.cells.find((c) => c.size === "XXL")!;
    expect(editableCell("warehouse", rosso, off, sizes)).toBe(false);
    const cap = groups[1].rows[0];
    expect(editableCell("shop", cap, cap.cells[0], sizes)).toBe(false);
    expect(editableCell("warehouse", cap, cap.cells[0], sizes)).toBe(true);
  });

  it("in «Discussione»: giacenza e obiettivo in ogni casella, sotto l'obiettivo in ambra, «Proponi quantità»", () => {
    const p = page(rx.discussion);
    const html = renderToStaticMarkup(
      <RestockLinesEditor
        catalog={p.catalog}
        order={p.order}
        incoming={p.incoming}
        onDone={() => {}}
      />,
    );
    const t = text(html);
    expect(t).toContain("Proponi quantità");
    expect(t).toContain("Salva quantità");
    expect(t).toContain("Per noi 3");
    expect(t).toContain("Per Negozio sintetico 2");
    expect(t).toContain("Per il cliente 1");
    expect(html).toContain('aria-label="GT3RS Blu M, per noi"');
    expect(html.match(/_cellLow_/g)?.length ?? 0).toBeGreaterThan(0);
    expect(t).toContain("+3 in arrivo");
    expect(t).toContain("2 da produrre");
    expect(t).toContain("sotto l’obiettivo");
    const groups = restockGrid(p.catalog, p.order.lines);
    const bianco = groups[0].rows.find((r) => r.model === "GT3RS" && r.color === "Bianco")!;
    expect(
      underTarget(
        bianco.cells.find((c) => c.size === "S")!,
        p.incoming,
      ),
    ).toBe(true);
    expect(
      underTarget(
        bianco.cells.find((c) => c.size === "L")!,
        p.incoming,
      ),
    ).toBe(false);
  });

  it("fuori da «Discussione» niente proposta", () => {
    const p = page(rx.quality);
    const t = text(
      renderToStaticMarkup(
        <RestockLinesEditor
          catalog={p.catalog}
          order={p.order}
          incoming={p.incoming}
          onDone={() => {}}
        />,
      ),
    );
    expect(t).not.toContain("Proponi quantità");
  });

  it("pezzi per taglia in testo, per destinazione", () => {
    const p = page(rx.arrived);
    expect(piecesBySize(p.order.lines, "shop", p.catalog)).toEqual([
      { label: "GT3RS Blu", sizes: [{ size: "S", quantity: 1 }], total: 1 },
      { label: "F40 Rosso", sizes: [{ size: "M", quantity: 2 }], total: 2 },
    ]);
    expect(item("F40", "Rosso", "M")).toBeTruthy();
  });
});
