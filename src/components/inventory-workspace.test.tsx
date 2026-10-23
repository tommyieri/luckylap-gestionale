import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InventoryWorkspace } from "./inventory-workspace";
import type { InventoryItem, InventorySourceMeta } from "../lib/types";
import { countTshirtLines } from "../lib/inventory/tshirt-lines";

const meta: InventorySourceMeta = {
  title: "Inventario sintetico",
  url: "https://example.test/inventario",
  importedAt: "2026-10-21T10:00:00Z",
  quantityStatus: "cached",
  notes: [],
};
const item = (id: string, shop: number | null): InventoryItem => ({
  id,
  sku: `SYN-GT3RS-BLU-${id}`,
  model: "GT3RS",
  category: "T-shirt",
  color: "Blu",
  size: id,
  centralQuantity: 4,
  consignmentQuantity: shop,
  totalQuantity: shop === null ? null : 4 + shop,
  targetQuantity: null,
  unitCost: null,
  webPrice: null,
  active: true,
  sourceCell: "Sintetico",
});
const text = (items: InventoryItem[]) =>
  renderToStaticMarkup(<InventoryWorkspace items={items} sourceMeta={meta} shared />)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

describe("colonna «In negozio» del Magazzino", () => {
  it("«—» finché nessun negozio è contato, mai «LCM»", () => {
    const t = text([item("M", null), item("L", null)]);
    expect(t).toContain("In negozio — da contare");
    expect(t).toContain("In negozio");
    expect(t).not.toContain("LCM");
    expect(t).toContain("Magadzino e negozi restano separati.");
  });
  it("la nota porta al magazzino dei negozi, in Magazzino › Conto vendita", () => {
    const html = renderToStaticMarkup(
      <InventoryWorkspace items={[item("M", null)]} sourceMeta={meta} shared />,
    );
    expect(html).toMatch(/<a href="\/stock\/conto-vendita">Conto vendita<\/a>/);
  });
  it("dopo la conta mostra i pezzi dei negozi contati, anche 0", () => {
    const t = text([item("M", 3), item("L", 0)]);
    expect(t).toContain("In negozio 3 pezzi");
    expect(t).not.toContain("da contare");
  });
});

describe("Giacenze con «Magliette disponibili» e filtro modello", () => {
  const tee = (id: string, model: string): InventoryItem => ({ ...item(id, null), model });
  const rows = [tee("M", "964"), tee("L", "964"), tee("S", "SENNA")];
  const render = (model: string | null) =>
    renderToStaticMarkup(
      <InventoryWorkspace
        items={rows}
        sourceMeta={meta}
        shared
        model={model}
        tshirts={{ lines: countTshirtLines(rows, []), preview: false }}
      />,
    );

  it("i riquadri stanno sopra la tabella", () => {
    const markup = render(null);
    expect(markup.indexOf("Magliette disponibili")).toBeGreaterThan(-1);
    expect(markup.indexOf("Magliette disponibili")).toBeLessThan(markup.indexOf("<table"));
  });

  it("?modello= mostra solo quel modello, con il filtro da togliere nella barra", () => {
    const markup = render("SENNA");
    const t = markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(markup).toContain("SYN-GT3RS-BLU-S");
    expect(markup).not.toContain("SYN-GT3RS-BLU-M");
    expect(t).toContain("1 variante su 3");
    expect(markup).toContain('aria-label="Togli il filtro Project’88: mostra tutti i prodotti"');
    expect(markup).toMatch(/<a [^>]*href="\/stock"[^>]*aria-current="true"/);
  });

  it("senza filtro la tabella mostra tutto e nessun riquadro è attivo", () => {
    const markup = render(null);
    expect(markup).not.toContain("Togli il filtro");
    expect(markup).not.toContain('aria-current="true"');
    expect(markup).toContain("SYN-GT3RS-BLU-M");
  });
});
