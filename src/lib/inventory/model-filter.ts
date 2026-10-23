import type { InventoryItem } from "../types";

/*
 * Filtri della tabella di Giacenze (`/stock`). Il modello sta anche nell'indirizzo,
 * `/stock?modello=964`: lo usano i riquadri «Magliette disponibili» e si può condividere.
 */

export const MODEL_PARAM = "modello";
export type StockFilter = "all" | "available" | "empty" | "unknown";
export type InventoryFilters = {
  search: string;
  /** «all» o una categoria del catalogo. */
  category: string;
  stock: StockFilter;
  /** Modello del catalogo (`products.model`); `null`: tutti. */
  model: string | null;
};

/** Il primo valore di `?modello=`, ripulito; `null` se manca o non è un nome plausibile. */
export function parseModelParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== "string") return null;
  const model = first.trim();
  return model.length > 0 && model.length <= 120 ? model : null;
}

/** Indirizzo di Giacenze con il filtro modello, oppure senza. */
export function stockModelHref(model: string | null): string {
  return model ? `/stock?${MODEL_PARAM}=${encodeURIComponent(model)}` : "/stock";
}

export const sameModel = (a: string, b: string) =>
  a.trim().toLocaleUpperCase("it") === b.trim().toLocaleUpperCase("it");

/** Ricerca, categoria, disponibilità nel Magadzino e modello: tutti insieme. */
export function filterInventoryItems(
  items: readonly InventoryItem[],
  filters: InventoryFilters,
): InventoryItem[] {
  const search = filters.search.toLocaleLowerCase("it");
  return items.filter(
    (item) =>
      `${item.sku} ${item.model} ${item.color} ${item.size}`
        .toLocaleLowerCase("it")
        .includes(search) &&
      (filters.category === "all" || item.category === filters.category) &&
      (filters.stock === "all" ||
        (filters.stock === "available" &&
          item.centralQuantity !== null &&
          item.centralQuantity > 0) ||
        (filters.stock === "empty" && item.centralQuantity === 0) ||
        (filters.stock === "unknown" && item.centralQuantity === null)) &&
      (filters.model === null || sameModel(item.model, filters.model)),
  );
}

/** Un clic normale: con Cmd, Ctrl, Maiusc o un altro tasto il link si apre come al solito. */
export function isPlainClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.defaultPrevented
  );
}
