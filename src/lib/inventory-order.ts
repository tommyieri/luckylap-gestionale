import type { InventoryItem } from "./types";

const sizes = ["XS", "S", "M", "L", "XL", "XXL"];
const categoryRank = (category: string) => /^t[\s-]?shirt/i.test(category) ? 0 : /^cappellin/i.test(category) ? 1 : 2;
const colorKey = (item: InventoryItem) => /(?:^|-)NB(?:-|$)/i.test(item.sku) ? "NB" : /(?:^|-)WH(?:-|$)/i.test(item.sku) ? "WH" : item.color;

/** One order for grouped rows, the flat view and their CSV export. */
export function orderInventoryItems(items: readonly InventoryItem[]): InventoryItem[] {
  const modelOrder = new Map<string, number>();
  const colorOrder = new Map<string, Map<string, number>>();
  for (const item of items) {
    const key = `${categoryRank(item.category)}:${item.model}`;
    if (!modelOrder.has(key)) modelOrder.set(key, modelOrder.size);
    const colors = colorOrder.get(key) ?? new Map<string, number>();
    const color = colorKey(item);
    if (!colors.has(color)) colors.set(color, color === "NB" ? 0 : color === "WH" ? 1 : colors.size + 2);
    colorOrder.set(key, colors);
  }
  const sizeRank = (size: string) => { const rank = sizes.indexOf(size.toUpperCase()); return rank < 0 ? sizes.length : rank; };
  return [...items].sort((a, b) => {
    const aKey = `${categoryRank(a.category)}:${a.model}`, bKey = `${categoryRank(b.category)}:${b.model}`;
    return categoryRank(a.category) - categoryRank(b.category)
      || modelOrder.get(aKey)! - modelOrder.get(bKey)!
      || colorOrder.get(aKey)!.get(colorKey(a))! - colorOrder.get(bKey)!.get(colorKey(b))!
      || sizeRank(a.size) - sizeRank(b.size);
  });
}
