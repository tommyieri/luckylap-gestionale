import type { InventoryItem } from "../types";

/*
 * «Magliette disponibili» in Magazzino › Giacenze (`/stock`): le sei grafiche, nell'ordine
 * voluto da Tommi, con il modello del catalogo (`products.model`) e i colori in vendita.
 * Solo T-shirt: cappellini e sticker restano fuori anche se portano lo stesso nome.
 * Un colore o una grafica nuovi si aggiungono qui, non nei componenti.
 */

/** Il Magadzino: le magliette disponibili si contano solo in questa sede. */
export const MAGADZINO_CODE = "MAG01";

export type TshirtSwatch = "white" | "navy" | "sky";
export type TshirtColor = {
  /** Colore del catalogo (`product_variants.color`). */
  catalog: string;
  /** Il colore detto della maglietta, in minuscolo: «bianca», «blu», «azzurra». */
  label: string;
  swatch: TshirtSwatch;
};
export type TshirtLine = {
  /** Chiave stabile, anche per i file in `public/tshirt-icons/`. */
  key: string;
  /** Nome della grafica come lo dice il team. */
  name: string;
  /** Modello nel catalogo (`products.model`), quello del filtro `?modello=`. */
  model: string;
  colors: readonly TshirtColor[];
  /** Icona quadrata 96 e 192 px; `null`: iniziali sul colore della maglietta. */
  icon: { small: string; large: string } | null;
};

const BIANCA: TshirtColor = { catalog: "Bianco", label: "bianca", swatch: "white" };
const BLU: TshirtColor = { catalog: "Blu", label: "blu", swatch: "navy" };
const AZZURRA: TshirtColor = { catalog: "Azzurro", label: "azzurra", swatch: "sky" };
const icon = (key: string) => ({
  small: `/tshirt-icons/${key}-96.webp`,
  large: `/tshirt-icons/${key}-192.webp`,
});

export const TSHIRT_LINES: readonly TshirtLine[] = [
  { key: "964", name: "964", model: "964", colors: [BIANCA, BLU], icon: icon("964") },
  { key: "gt3rs", name: "GT3RS", model: "GT3RS", colors: [BIANCA, BLU], icon: icon("gt3rs") },
  {
    key: "project-88",
    name: "Project’88",
    model: "SENNA",
    colors: [BIANCA],
    icon: icon("project-88"),
  },
  { key: "f40", name: "F40", model: "F40", colors: [BIANCA], icon: icon("f40") },
  { key: "512tr", name: "512TR", model: "TESTAROSSA", colors: [BIANCA], icon: icon("512tr") },
  { key: "300sl", name: "300SL", model: "SL", colors: [AZZURRA], icon: icon("300sl") },
];

/** Una riga di `operational_stock_availability` con il codice della sua sede. */
export type MagadzinoAvailability = {
  stockItemId: string;
  locationCode: string;
  /** Fisico; `null` finché la quantità è da verificare. */
  onHand: number | null;
  /** Già promesso agli ordini. */
  reserved: number;
};

export type TshirtColorCount = {
  color: TshirtColor;
  /** Varianti attive di questo colore nel catalogo. */
  variants: number;
  /** Disponibile (fisico meno riservato), tutte le taglie; `null` se una taglia è da verificare. */
  available: number | null;
  /** Taglie con disponibile a zero, da XS a XXL. */
  zeroSizes: string[];
};
export type TshirtLineState = "available" | "empty" | "unknown" | "missing";
export type TshirtLineCount = {
  line: TshirtLine;
  /** Somma dei colori; `null` se manca un dato (mai zero al posto di «da verificare»). */
  available: number | null;
  colors: TshirtColorCount[];
  state: TshirtLineState;
};

export const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL"] as const;
const sameText = (a: string, b: string) =>
  a.trim().toLocaleUpperCase("it") === b.trim().toLocaleUpperCase("it");
export const isTshirtCategory = (category: string) => /^t[\s-]?shirt/i.test(category.trim());
const sizeRank = (size: string) => {
  const rank = SIZE_ORDER.indexOf(size.trim().toUpperCase() as (typeof SIZE_ORDER)[number]);
  return rank < 0 ? SIZE_ORDER.length : rank;
};
const bySize = (a: string, b: string) => sizeRank(a) - sizeRank(b) || a.localeCompare(b, "it");
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** La grafica di un modello del catalogo, se è una delle sei. */
export function tshirtLineForModel(model: string): TshirtLine | null {
  return TSHIRT_LINES.find((line) => sameText(line.model, model)) ?? null;
}

/**
 * Pezzi da vendere nel Magadzino per ogni grafica: varianti attive di categoria T-shirt,
 * colori della mappa, tutte le taglie; disponibile = fisico − riservato, solo `MAG01`.
 * Una variante senza riga nel Magadzino o con fisico `null` rende il totale «da verificare».
 */
export function countTshirtLines(
  items: readonly InventoryItem[],
  availability: readonly MagadzinoAvailability[],
): TshirtLineCount[] {
  const available = new Map<string, number | null>();
  for (const row of availability) {
    if (row.locationCode !== MAGADZINO_CODE) continue;
    const key = row.stockItemId.toLowerCase();
    if (available.has(key)) throw new Error("Disponibilità del Magadzino duplicata.");
    // Il database non lascia mai il riservato sopra il fisico (guard_stock_reservation).
    available.set(key, row.onHand === null ? null : Math.max(0, row.onHand - row.reserved));
  }
  return TSHIRT_LINES.map((line) => {
    const variants = items.filter(
      (item) => item.active && isTshirtCategory(item.category) && sameText(item.model, line.model),
    );
    const colors = line.colors.map((color): TshirtColorCount => {
      const own = variants.filter((item) => sameText(item.color, color.catalog));
      const values = own.map((item) => ({
        size: item.size,
        available: available.get(item.id.toLowerCase()) ?? null,
      }));
      const known = values.every((value) => value.available !== null);
      return {
        color,
        variants: own.length,
        available: own.length && known ? sum(values.map((value) => value.available ?? 0)) : null,
        zeroSizes: values
          .filter((value) => value.available === 0)
          .map((value) => value.size)
          .sort(bySize),
      };
    });
    const sold = colors.filter((color) => color.variants > 0);
    const total =
      !sold.length || sold.some((color) => color.available === null)
        ? null
        : sum(sold.map((color) => color.available ?? 0));
    return {
      line,
      available: total,
      colors,
      state: !sold.length
        ? "missing"
        : total === null
          ? "unknown"
          : total === 0
            ? "empty"
            : "available",
    };
  });
}

/** «XS–L» per tre o più taglie di seguito, altrimenti «S, XL». */
export function sizeList(sizes: readonly string[]): string {
  const sorted = [...sizes].sort(bySize);
  const parts: string[] = [];
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (
      end + 1 < sorted.length &&
      sizeRank(sorted[end]) < SIZE_ORDER.length &&
      sizeRank(sorted[end + 1]) === sizeRank(sorted[end]) + 1
    )
      end++;
    if (end - start >= 2) parts.push(`${sorted[start]}–${sorted[end]}`);
    else parts.push(...sorted.slice(start, end + 1));
    start = end + 1;
  }
  return parts.join(", ");
}

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase("it") + text.slice(1);

/**
 * La riga piccola sotto il numero: «Esaurita», «Da verificare», oppure le taglie a zero
 * («Manca L», «Mancano XS–M», «Manca L blu», «Bianca esaurita · manca L blu»).
 */
export function tshirtLineHint(count: TshirtLineCount): string | null {
  if (count.state === "missing") return "Non trovata nel catalogo";
  if (count.state === "unknown") return "Da verificare";
  if (count.state === "empty") return "Esaurita";
  const sold = count.colors.filter((color) => color.variants > 0);
  const named = sold.length > 1;
  const soldOut: string[] = [];
  const missing: string[] = [];
  let sizes = 0;
  for (const color of sold) {
    if (color.available === 0) {
      soldOut.push(`${color.color.label} esaurita`);
      continue;
    }
    if (!color.zeroSizes.length) continue;
    sizes += color.zeroSizes.length;
    const list = sizeList(color.zeroSizes);
    missing.push(named ? `${list} ${color.color.label}` : list);
  }
  const parts = [...soldOut];
  if (missing.length) parts.push(`${sizes === 1 ? "manca" : "mancano"} ${missing.join(" · ")}`);
  return parts.length ? capitalize(parts.join(" · ")) : null;
}

const pieces = (value: number) => new Intl.NumberFormat("it-IT").format(value);

/** Numero grande del riquadro: «n.d.» se un dato manca, mai zero al suo posto. */
export function tshirtCountText(value: number | null): string {
  return value === null ? "n.d." : pieces(value);
}

/** Nome accessibile del riquadro: numero, colori, taglie a zero e cosa fa il tocco. */
export function tshirtTileLabel(count: TshirtLineCount, active: boolean): string {
  const total =
    count.available === null
      ? "quantità da verificare"
      : count.available === 1
        ? "1 disponibile"
        : `${pieces(count.available)} disponibili`;
  const sold = count.colors.filter((color) => color.variants > 0);
  const colors =
    sold.length > 1
      ? sold.map((color) => `${color.color.label} ${tshirtCountText(color.available)}`).join(", ")
      : null;
  // «Da verificare» è già nel totale.
  const hint = count.state === "unknown" ? null : tshirtLineHint(count);
  const action = active
    ? "Filtro attivo: tocca per vedere tutti i prodotti"
    : "Tocca per vederla nella tabella";
  return [`${count.line.name}: ${total}`, colors, hint, action].filter(Boolean).join(". ") + ".";
}

/** Iniziali per l'icona di riserva: «P8» per «Project’88», le prime tre lettere altrimenti. */
export function tshirtInitials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const initials =
    words.length > 1 ? words.map((word) => word[0]).join("") : (words[0] ?? "").slice(0, 3);
  return initials.toLocaleUpperCase("it");
}
