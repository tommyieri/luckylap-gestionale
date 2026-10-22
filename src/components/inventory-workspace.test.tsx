import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InventoryWorkspace } from "./inventory-workspace";
import type { InventoryItem, InventorySourceMeta } from "../lib/types";

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
    expect(t).toContain("Magazzino e negozi restano separati.");
  });
  it("dopo la conta mostra i pezzi dei negozi contati, anche 0", () => {
    const t = text([item("M", 3), item("L", 0)]);
    expect(t).toContain("In negozio 3 pezzi");
    expect(t).not.toContain("da contare");
  });
});
