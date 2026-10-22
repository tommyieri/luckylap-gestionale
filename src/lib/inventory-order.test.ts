import { describe, expect, it } from "vitest";
import { orderInventoryItems } from "./inventory-order";
import { loadInventory } from "./inventory";
import type { InventoryItem } from "./types";

const item = (
  model: string,
  colorCode: string,
  size: string,
  category = "T-shirt",
): InventoryItem => ({
  id: `${model}-${colorCode}-${size}`,
  sku: `LL-${category === "T-shirt" ? "TS" : "CAP"}-${model}-${colorCode}-${size}`,
  model,
  category,
  color: colorCode === "NB" ? "Blu" : colorCode === "WH" ? "Bianco" : colorCode,
  size,
  centralQuantity: 1,
  consignmentQuantity: 0,
  totalQuantity: 1,
  targetQuantity: null,
  unitCost: null,
  webPrice: null,
  active: true,
  sourceCell: "Synthetic",
});

describe("inventory display and export order", () => {
  it("puts T-shirts before caps, preserving model order within each category", () => {
    const cap = item("Cap", "NB", "UNICA", "Cappellino");
    const secondModel = item("964", "NB", "XS");
    const firstModel = item("GT3", "NB", "XS");
    expect(orderInventoryItems([cap, secondModel, firstModel]).map((row) => row.model)).toEqual([
      "964",
      "GT3",
      "Cap",
    ]);
  });
  it("keeps the blue NB block before white WH and sorts sizes XS through XXL in each block", () => {
    const rows = ["WH", "NB"].flatMap((color) =>
      ["L", "M", "S", "XL", "XS", "XXL"].map((size) => item("GT3", color, size)),
    );
    const ordered = orderInventoryItems(rows);
    expect(ordered.map((row) => row.sku)).toEqual(
      ["NB", "WH"].flatMap((color) =>
        ["XS", "S", "M", "L", "XL", "XXL"].map((size) => item("GT3", color, size).sku),
      ),
    );
  });
  it("keeps unfamiliar colors and sizes stable after the known sequence without mutating input", () => {
    const rows = [
      item("GT3", "RD", "CUSTOM"),
      item("GT3", "GN", "UNICA"),
      item("GT3", "NB", "M"),
      item("GT3", "RD", "XS"),
    ];
    const original = [...rows];
    expect(orderInventoryItems(rows).map((row) => `${row.color}-${row.size}`)).toEqual([
      "Blu-M",
      "RD-XS",
      "RD-CUSTOM",
      "GN-UNICA",
    ]);
    expect(rows).toEqual(original);
  });
});

it("orders every authorized SKU consistently, including SL, Testarossa and the two-color models", () => {
  const { items } = loadInventory();
  const ordered = orderInventoryItems([...items].sort((a, b) => a.sku.localeCompare(b.sku)));
  expect(ordered).toHaveLength(items.length);
  expect(new Set(ordered.map((row) => row.sku))).toEqual(new Set(items.map((row) => row.sku)));
  expect(ordered.findIndex((row) => row.category === "Cappellino")).toBeGreaterThan(
    ordered.findLastIndex((row) => row.category === "T-shirt"),
  );
  for (const model of ["SL", "TESTAROSSA"])
    expect(ordered.filter((row) => row.model === model).map((row) => row.size)).toEqual([
      "XS",
      "S",
      "M",
      "L",
      "XL",
      "XXL",
    ]);
  expect(
    ordered.filter((row) => row.model === "GT3RS").map((row) => `${row.color}-${row.size}`),
  ).toEqual(
    ["Blu", "Bianco"].flatMap((color) =>
      ["XS", "S", "M", "L", "XL", "XXL"].map((size) => `${color}-${size}`),
    ),
  );
});
