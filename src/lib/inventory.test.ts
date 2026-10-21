import { describe, expect, it } from "vitest";
import { normalizeInventory, loadInventory, type InventorySnapshot } from "./inventory";

function fixture(): InventorySnapshot {
  return {
    source: {
      title: "Inventario autorizzato.xlsx",
      url: "https://example.test/source",
      extracted_at_utc: "2026-10-21T10:00:00Z",
      quantity_mode: "saved_excel_cached_values_without_recalculation",
    },
    products: [{ model: "GT3RS", category: "T-shirt" }],
    variants: [{ sku: "LL-TS-GT3-XS", active_source_value: "Si" }],
    inventory: [{
      sku: "LL-TS-GT3-XS", model: "GT3RS", color: "Blu", size: "XS",
      stocks: [{ location_code: "MAG01", quantity: 2, source_cell: "E6" }, { location_code: "NEG01", quantity: 0, source_cell: "F6" }],
      network_quantity: 2, central_target_quantity: 3, unit_cost_eur: 13.2,
      list_price_eur: 40, source: { sheet: "Assortimento", row: 6, range: "A6:V6" },
    }],
  };
}

describe("inventario autorevole Excel", () => {
  it("mantiene separati centrale, conto vendita e totale salvato", () => {
    const { items } = normalizeInventory(fixture());
    expect(items[0]).toMatchObject({ centralQuantity: 2, consignmentQuantity: 0, totalQuantity: 2, unitCost: 13.2, webPrice: 40, sourceCell: "Assortimento!A6:V6" });
  });
  it("conserva i mancanti senza trasformarli in zeri né derivare il totale", () => {
    const input = fixture();
    input.inventory[0].stocks[0].quantity = null;
    input.inventory[0].network_quantity = null;
    input.inventory[0].unit_cost_eur = null;
    const { items } = normalizeInventory(input);
    expect(items[0].centralQuantity).toBeNull();
    expect(items[0].consignmentQuantity).toBe(0);
    expect(items[0].totalQuantity).toBeNull();
    expect(items[0].unitCost).toBeNull();
  });
  it("rifiuta SKU duplicati invece di duplicare giacenze", () => {
    const input = fixture();
    input.inventory.push({ ...input.inventory[0] });
    expect(() => normalizeInventory(input)).toThrow(/SKU duplicato/);
  });
  it("rifiuta righe senza SKU invece di perderne la provenienza", () => {
    const input = fixture();
    input.inventory[0].sku = " ";
    expect(() => normalizeInventory(input)).toThrow(/SKU mancante/);
  });
  it("carica solo i 51 SKU trascritti senza sticker o vendite Shopify", () => {
    const result = loadInventory();
    expect(result.items).toHaveLength(51);
    expect(new Set(result.items.map((item) => item.model)).size).toBe(9);
    expect(result.sourceMeta.title).toBe("LuckyLap_Gestione_inventario.xlsx");
    expect(result.items.find((item) => item.sku === "LL-TS-GT3-NB-XS")).toMatchObject({ centralQuantity: 2, consignmentQuantity: 0 });
    expect(result.items.some((item) => item.sku.startsWith("LL-STK"))).toBe(false);
  });
});
