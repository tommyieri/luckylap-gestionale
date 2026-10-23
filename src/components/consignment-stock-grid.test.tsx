import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsignmentStockGrid, quantityText } from "./consignment-stock-grid";
import { item, shopPageRows } from "../lib/consignment/shop-fixtures";
import { shopPageFromRows, shopStockGrid } from "../lib/consignment/shop-read";

const page = (code = "NEG01") => shopPageFromRows(shopPageRows(code), "2026-10-22T10:00:00.000Z");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

function inputs(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(inputs);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  if (element.type === "input") return [element];
  return inputs(element.props.children);
}

describe("griglia delle magliette", () => {
  it("«—» finché il negozio non è contato, «0» dopo la prima conta", () => {
    const uncounted = renderToStaticMarkup(
      <ConsignmentStockGrid grid={shopStockGrid(page("NEG02"))} label="Magliette" />,
    );
    expect(uncounted).toContain("—");
    expect(text(uncounted)).toContain("da contare");
    expect(uncounted).not.toMatch(/>0</);
    const counted = renderToStaticMarkup(
      <ConsignmentStockGrid grid={shopStockGrid(page())} label="Magliette" />,
    );
    expect(counted).not.toContain("—");
    expect(counted).toMatch(/>0</);
    expect(counted).toMatch(/>5</);
    expect(quantityText(null)).toBe("—");
    expect(quantityText(0)).toBe("0");
    expect(quantityText(12000)).toBe("12.000");
  });

  it("gruppi per modello nell'ordine del Magazzino, una riga per colore, sei taglie", () => {
    // Un negozio con tutte le taglie: sei colonne.
    const all = page();
    const grid = shopStockGrid({ ...all, shop: { ...all.shop, sizes: null } });
    expect(grid.groups.map((g) => g.model)).toEqual(["GT3RS", "964", "F40"]);
    expect(grid.groups[0].rows.map((r) => r.color)).toEqual(["Blu", "Bianco"]);
    const html = renderToStaticMarkup(<ConsignmentStockGrid grid={grid} label="Magliette" />);
    expect(html).toContain('aria-label="GT3RS Blu"');
    for (const size of ["XS", "S", "M", "L", "XL", "XXL"]) expect(html).toContain(`>${size}<`);
    // F40 Rosso XXL non è attiva e non è in negozio: casella vuota.
    expect(html).toMatch(/aria-hidden="true"/);
  });

  it("negozio con le sue taglie: solo S, M, L, XL", () => {
    const html = renderToStaticMarkup(
      <ConsignmentStockGrid grid={shopStockGrid(page())} label="Magliette" />,
    );
    for (const size of ["S", "M", "L", "XL"]) expect(html).toContain(`>${size}<`);
    for (const size of ["XS", "XXL"]) expect(html).not.toContain(`>${size}<`);
    expect(html).toContain("--sizes:4");
  });

  it("le magliette in arrivo dagli ordini aperti", () => {
    const html = renderToStaticMarkup(
      <ConsignmentStockGrid
        grid={shopStockGrid(page())}
        label="Magliette"
        note={(cell) => (cell.incoming > 0 ? `+${cell.incoming} in arrivo` : null)}
      />,
    );
    expect(text(html)).toContain("+2 in arrivo");
    expect(text(html)).toContain("+3 in arrivo");
  });

  it("campi numerici a 16 px con etichetta «GT3RS Blu M, venduti»", () => {
    const onChange = vi.fn();
    const tree = ConsignmentStockGrid({
      grid: shopStockGrid(page()),
      label: "Vendite",
      input: {
        values: { [item("GT3RS", "Blu", "M")]: "3" },
        verb: "venduti",
        onChange,
        invalid: new Set([item("GT3RS", "Blu", "L")]),
      },
    });
    const fields = inputs(tree);
    const medium = fields.find((f) => f.props["aria-label"] === "GT3RS Blu M, venduti")!;
    expect(medium.props).toMatchObject({
      type: "text",
      inputMode: "numeric",
      pattern: "[0-9]*",
      value: "3",
    });
    const large = fields.find((f) => f.props["aria-label"] === "GT3RS Blu L, venduti")!;
    expect(large.props["aria-invalid"]).toBe(true);
    (medium.props.onChange as (e: unknown) => void)({ target: { value: "4" } });
    expect(onChange).toHaveBeenCalledWith(item("GT3RS", "Blu", "M"), "4");
  });

  it("solo le caselle ammesse hanno il campo", () => {
    const tree = ConsignmentStockGrid({
      grid: shopStockGrid(page()),
      label: "Riporta",
      input: {
        values: {},
        verb: "da riportare",
        onChange: vi.fn(),
        editable: (cell) => (cell.quantity ?? 0) > 0,
      },
    });
    expect(inputs(tree).map((f) => f.props["aria-label"])).toEqual([
      "GT3RS Blu M, da riportare",
      "GT3RS Blu L, da riportare",
      "964 Bianco L, da riportare",
    ]);
  });
});
