import { describe, expect, it } from "vitest";
import { inventoryFromDatabase } from "./inventory-model";

const fixture = () => ({
  products: [{ id: "p1", model: "GT3", category: "T-shirt" }],
  items: [
    {
      id: "s1",
      sku: "LL-TS-GT3-NB-XS",
      kind: "product",
      unit_cost_eur: "13.20",
      list_price_eur: "40.00",
      active: true,
      source: {
        inventory: { sheet: "Assortimento", range: "A6:V6" },
        document: {
          title: "LuckyLap_Gestione_inventario.xlsx",
          url: "https://docs.google.com/spreadsheets/d/test/edit",
          extracted_at_utc: "2026-10-21T10:28:39.328453+00:00",
          quantity_mode: "saved_excel_cached_values_without_recalculation",
        },
      },
    },
  ],
  variants: [
    {
      stock_item_id: "s1",
      product_id: "p1",
      color: "Nero",
      size: "XS",
      central_target_quantity: 5,
    },
  ],
  balances: [
    { stock_item_id: "s1", location_id: "l1", quantity: "0" },
    { stock_item_id: "s1", location_id: "l2", quantity: null },
  ],
  locations: [
    { id: "l1", code: "MAG01", location_type: "Magazzino", active: true },
    { id: "l2", code: "NEG01", location_type: "Negozio Conto Vendita", active: true },
  ],
  shops: [{ location_id: "l2", first_counted_at: null as string | null }],
});

describe("authenticated database inventory mapping", () => {
  it("preserves zero, unknown quantities and source provenance", () => {
    const result = inventoryFromDatabase(fixture());
    expect(result.items[0]).toMatchObject({
      centralQuantity: 0,
      consignmentQuantity: null,
      totalQuantity: null,
      unitCost: 13.2,
      webPrice: 40,
      sourceCell: "Assortimento!A6:V6",
    });
    expect(result.sourceMeta.importedAt).toBe("2026-10-21T10:28:39.328453+00:00");
  });
  it("«In negozio» resta sconosciuto finché nessun negozio attivo è contato", () => {
    const known = fixture();
    known.balances[1].quantity = "3";
    expect(inventoryFromDatabase(known).items[0].consignmentQuantity).toBeNull();
    expect(inventoryFromDatabase({ ...known, shops: [] }).items[0].consignmentQuantity).toBeNull();
    const closed = fixture();
    closed.shops[0].first_counted_at = "2026-10-21T10:00:00+00:00";
    closed.locations[1].active = false;
    expect(inventoryFromDatabase(closed).items[0]).toMatchObject({
      consignmentQuantity: null,
      totalQuantity: null,
    });
  });
  it("dopo la prima conta somma i negozi attivi contati; un saldo assente vale 0", () => {
    const counted = fixture();
    counted.shops[0].first_counted_at = "2026-10-21T10:00:00+00:00";
    counted.balances[1].quantity = "3";
    expect(inventoryFromDatabase(counted).items[0]).toMatchObject({
      centralQuantity: 0,
      consignmentQuantity: 3,
      totalQuantity: 3,
    });
    // Secondo negozio contato senza riga di saldo, terzo negozio non ancora contato.
    counted.locations.push(
      { id: "l3", code: "NEG02", location_type: "Negozio Conto Vendita", active: true },
      { id: "l4", code: "NEG03", location_type: "Negozio Conto Vendita", active: true },
    );
    counted.balances.push({ stock_item_id: "s1", location_id: "l4", quantity: "7" });
    counted.shops.push(
      { location_id: "l3", first_counted_at: "2026-10-22T10:00:00Z" },
      { location_id: "l4", first_counted_at: null },
    );
    expect(inventoryFromDatabase(counted).items[0].consignmentQuantity).toBe(3);
    counted.balances[1].quantity = null as unknown as string;
    expect(inventoryFromDatabase(counted).items[0].consignmentQuantity).toBe(0);
  });
  it("rifiuta negozi orfani, doppi o con una data di conta non valida", () => {
    const orphan = fixture();
    orphan.shops.push({ location_id: "l9", first_counted_at: null });
    expect(() => inventoryFromDatabase(orphan)).toThrow();
    const warehouse = fixture();
    warehouse.shops.push({ location_id: "l1", first_counted_at: null });
    expect(() => inventoryFromDatabase(warehouse)).toThrow();
    const twice = fixture();
    twice.shops.push({ location_id: "l2", first_counted_at: null });
    expect(() => inventoryFromDatabase(twice)).toThrow();
    const date = fixture();
    date.shops[0].first_counted_at = "ieri";
    expect(() => inventoryFromDatabase(date)).toThrow();
    const location = fixture();
    delete (location.locations[0] as { active?: boolean }).active;
    expect(() => inventoryFromDatabase(location)).toThrow();
  });
  it("rejects missing provenance and incomplete relations rather than loading a local fallback", () => {
    const noSource = fixture();
    delete (noSource.items[0].source as { document?: unknown }).document;
    expect(() => inventoryFromDatabase(noSource)).toThrow();
    expect(() => inventoryFromDatabase({ ...fixture(), products: [] })).toThrow();
    expect(() => inventoryFromDatabase({ ...fixture(), variants: [] })).toThrow();
    expect(() => inventoryFromDatabase({ ...fixture(), items: [] })).toThrow();
  });
  it("rejects unsafe quantities and mixed import provenance", () => {
    const invalid = fixture();
    invalid.balances[0].quantity = "9007199254740992";
    expect(() => inventoryFromDatabase(invalid)).toThrow();
    const inconsistent = fixture();
    inconsistent.items.push({
      ...inconsistent.items[0],
      id: "s2",
      sku: "SECOND",
      source: {
        ...inconsistent.items[0].source,
        document: {
          ...inconsistent.items[0].source.document,
          extracted_at_utc: "2026-10-20T10:00:00Z",
        },
      },
    });
    expect(() => inventoryFromDatabase(inconsistent)).toThrow();
  });
});
