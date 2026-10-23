import { describe, expect, it } from "vitest";
import type { InventoryItem } from "../types";
import {
  filterInventoryItems,
  isPlainClick,
  parseModelParam,
  stockModelHref,
  type InventoryFilters,
} from "./model-filter";

const item = (
  model: string,
  size: string,
  centralQuantity: number | null,
  category = "T-shirt",
): InventoryItem => ({
  id: `SYN-${model}-${size}`,
  sku: `SYN-${model}-${size}`,
  model,
  category,
  color: "Bianco",
  size,
  centralQuantity,
  consignmentQuantity: null,
  totalQuantity: null,
  targetQuantity: null,
  unitCost: null,
  webPrice: null,
  active: true,
  sourceCell: "Sintetico",
});
const items = [
  item("964", "M", 3),
  item("964", "L", 0),
  item("SENNA", "M", null),
  item("Cappellino 964", "UNICA", 5, "Cappellino"),
];
const all: InventoryFilters = { search: "", category: "all", stock: "all", model: null };
const skus = (filters: Partial<InventoryFilters>) =>
  filterInventoryItems(items, { ...all, ...filters }).map((entry) => entry.sku);

describe("filtro modello di Giacenze", () => {
  it("legge ?modello= una volta sola, ripulito, e scarta i valori vuoti o troppo lunghi", () => {
    expect(parseModelParam("964")).toBe("964");
    expect(parseModelParam(["  SENNA ", "F40"])).toBe("SENNA");
    expect(parseModelParam(undefined)).toBeNull();
    expect(parseModelParam("   ")).toBeNull();
    expect(parseModelParam("x".repeat(121))).toBeNull();
  });

  it("indirizzo con e senza il filtro", () => {
    expect(stockModelHref("964")).toBe("/stock?modello=964");
    expect(stockModelHref("Cappellino 964")).toBe("/stock?modello=Cappellino%20964");
    expect(stockModelHref(null)).toBe("/stock");
  });

  it("solo il modello scelto, senza badare alle maiuscole; «964» non prende il cappellino", () => {
    expect(skus({ model: "964" })).toEqual(["SYN-964-M", "SYN-964-L"]);
    expect(skus({ model: "senna" })).toEqual(["SYN-SENNA-M"]);
    expect(skus({ model: "NESSUNO" })).toEqual([]);
    expect(skus({})).toHaveLength(4);
  });

  it("si combina con ricerca, categoria e disponibilità", () => {
    expect(skus({ model: "964", stock: "empty" })).toEqual(["SYN-964-L"]);
    expect(skus({ model: "964", stock: "available" })).toEqual(["SYN-964-M"]);
    expect(skus({ stock: "unknown" })).toEqual(["SYN-SENNA-M"]);
    expect(skus({ search: "unica" })).toEqual(["SYN-Cappellino 964-UNICA"]);
    expect(skus({ model: "964", category: "Cappellino" })).toEqual([]);
  });

  it("filtra nel browser solo i clic normali: Cmd, Ctrl, Maiusc e Alt aprono il link", () => {
    const click = {
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
    };
    expect(isPlainClick(click)).toBe(true);
    expect(isPlainClick({ ...click, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...click, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...click, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...click, altKey: true })).toBe(false);
    expect(isPlainClick({ ...click, button: 1 })).toBe(false);
    expect(isPlainClick({ ...click, defaultPrevented: true })).toBe(false);
  });
});
