import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadInventory } from "../inventory";
import type { InventoryItem } from "../types";
import { previewMagadzinoAvailability } from "./tshirt-fixtures";
import {
  MAGADZINO_CODE,
  TSHIRT_LINES,
  countTshirtLines,
  sizeList,
  tshirtCountText,
  tshirtInitials,
  tshirtLineForModel,
  tshirtLineHint,
  tshirtTileLabel,
  type MagadzinoAvailability,
  type TshirtLineCount,
} from "./tshirt-lines";

const PUBLIC = join(__dirname, "..", "..", "..", "public");
const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

const item = (
  model: string,
  color: string,
  size: string,
  overrides: Partial<InventoryItem> = {},
): InventoryItem => ({
  id: `SYN-${model}-${color}-${size}`,
  sku: `SYN-${model}-${color}-${size}`,
  model,
  category: "T-shirt",
  color,
  size,
  centralQuantity: null,
  consignmentQuantity: null,
  totalQuantity: null,
  targetQuantity: null,
  unitCost: null,
  webPrice: null,
  active: true,
  sourceCell: "Sintetico",
  ...overrides,
});
const stock = (
  target: InventoryItem,
  onHand: number | null,
  reserved = 0,
  locationCode = MAGADZINO_CODE,
): MagadzinoAvailability => ({ stockItemId: target.id, locationCode, onHand, reserved });

/** Una riga per taglia di un colore, con [fisico, riservato] da XS a XXL. */
function run(model: string, color: string, values: [number | null, number][]) {
  const items = values.map((_, index) => item(model, color, SIZES[index]));
  const rows = values.map(([onHand, reserved], index) => stock(items[index], onHand, reserved));
  return { items, rows };
}
const countOf = (counts: TshirtLineCount[], name: string) =>
  counts.find((count) => count.line.name === name)!;

describe("mappa delle magliette", () => {
  it("sei grafiche nell'ordine voluto, ognuna col suo modello del catalogo", () => {
    expect(TSHIRT_LINES.map((line) => [line.name, line.model])).toEqual([
      ["964", "964"],
      ["GT3RS", "GT3RS"],
      ["Project’88", "SENNA"],
      ["F40", "F40"],
      ["512TR", "TESTAROSSA"],
      ["300SL", "SL"],
    ]);
    expect(TSHIRT_LINES.map((line) => line.colors.map((color) => color.catalog).join("+"))).toEqual(
      ["Bianco+Blu", "Bianco+Blu", "Bianco", "Bianco", "Bianco", "Azzurro"],
    );
    expect(new Set(TSHIRT_LINES.map((line) => line.key)).size).toBe(6);
  });

  it("modelli e colori esistono come T-shirt nel catalogo dell'inventario", () => {
    const { items } = loadInventory();
    for (const line of TSHIRT_LINES) {
      const colors = new Set(
        items
          .filter((entry) => entry.model === line.model && entry.category === "T-shirt")
          .map((entry) => entry.color),
      );
      expect([...colors].sort(), line.name).toEqual(
        line.colors.map((color) => color.catalog).sort(),
      );
    }
  });

  it("ogni icona esiste in public/tshirt-icons ed è elencata nelle fonti", () => {
    const sources = readFileSync(join(PUBLIC, "tshirt-icons", "SOURCES.txt"), "utf8");
    for (const line of TSHIRT_LINES) {
      expect(line.icon, line.name).not.toBeNull();
      for (const path of [line.icon!.small, line.icon!.large]) {
        expect(path).toMatch(/^\/tshirt-icons\/[\w-]+-(96|192)\.webp$/);
        expect(existsSync(join(PUBLIC, path)), path).toBe(true);
        expect(sources).toContain(path.split("/").pop());
      }
    }
  });

  it("riconosce il modello senza badare a maiuscole e spazi; cappellini e altri nomi no", () => {
    expect(tshirtLineForModel(" senna ")?.name).toBe("Project’88");
    expect(tshirtLineForModel("Cappellino 964")).toBeNull();
    expect(tshirtLineForModel("Sticker F40")).toBeNull();
  });
});

describe("conteggio delle magliette disponibili", () => {
  it("somma taglie e colori e toglie il riservato", () => {
    const white = run("964", "Bianco", [
      [3, 0],
      [5, 1],
      [6, 0],
      [4, 0],
      [2, 0],
      [1, 0],
    ]);
    const navy = run("964", "Blu", [
      [2, 0],
      [4, 0],
      [7, 2],
      [0, 0],
      [5, 0],
      [3, 3],
    ]);
    const counts = countTshirtLines([...white.items, ...navy.items], [...white.rows, ...navy.rows]);
    const line = countOf(counts, "964");
    expect(line.colors.map((color) => color.available)).toEqual([20, 16]);
    expect(line.available).toBe(36);
    expect(line.state).toBe("available");
    expect(line.colors[1].zeroSizes).toEqual(["L", "XXL"]);
    expect(tshirtLineHint(line)).toBe("Mancano L, XXL blu");
  });

  it("conta solo il Magadzino (MAG01), non i negozi né altri magazzini", () => {
    const tee = item("F40", "Bianco", "M");
    const counts = countTshirtLines(
      [tee],
      [stock(tee, 4), stock(tee, 9, 0, "NEG01"), stock(tee, 7, 0, "MAG02")],
    );
    expect(countOf(counts, "F40").available).toBe(4);
  });

  it("lascia fuori cappellini, sticker, varianti inattive e colori fuori mappa", () => {
    const tee = item("964", "Bianco", "M");
    const cap = item("964", "Blu", "UNICA", { category: "Cappellino" });
    const capName = item("Cappellino 964", "Blu", "UNICA", { category: "Cappellino" });
    const sticker = item("F40", "Bianco", "UNICA", { category: "Sticker" });
    const inactive = item("964", "Blu", "L", { active: false });
    const red = item("GT3RS", "Rosso", "M");
    const counts = countTshirtLines(
      [tee, cap, capName, sticker, inactive, red],
      [stock(tee, 2), stock(cap, 40), stock(capName, 40), stock(sticker, 30)]
        .concat(stock(inactive, 8))
        .concat(stock(red, 5)),
    );
    expect(countOf(counts, "964").available).toBe(2);
    expect(countOf(counts, "964").colors[1].variants).toBe(0);
    expect(countOf(counts, "F40").state).toBe("missing");
    expect(countOf(counts, "GT3RS").state).toBe("missing");
  });

  it("zero vero: «Esaurita»; fisico ignoto o riga mancante: «n.d.», mai zero", () => {
    const sold = run("TESTAROSSA", "Bianco", [
      [0, 0],
      [1, 1],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    const unknown = run("SL", "Azzurro", [
      [2, 0],
      [null, 0],
    ]);
    const noRow = item("SENNA", "Bianco", "M");
    const counts = countTshirtLines(
      [...sold.items, ...unknown.items, noRow],
      [...sold.rows, ...unknown.rows],
    );
    const empty = countOf(counts, "512TR");
    expect([empty.available, empty.state, tshirtLineHint(empty)]).toEqual([0, "empty", "Esaurita"]);
    expect(tshirtCountText(empty.available)).toBe("0");
    for (const name of ["300SL", "Project’88"]) {
      const line = countOf(counts, name);
      expect([line.available, line.state, tshirtLineHint(line)]).toEqual([
        null,
        "unknown",
        "Da verificare",
      ]);
      expect(tshirtCountText(line.available)).toBe("n.d.");
    }
  });

  it("restituisce sempre le sei grafiche, nell'ordine della mappa", () => {
    expect(countTshirtLines([], []).map((count) => [count.line.name, count.state])).toEqual(
      TSHIRT_LINES.map((line) => [line.name, "missing"]),
    );
  });

  it("rifiuta due righe del Magadzino per lo stesso articolo", () => {
    const tee = item("F40", "Bianco", "M");
    expect(() => countTshirtLines([tee], [stock(tee, 1), stock(tee, 2)])).toThrow(
      "Disponibilità del Magadzino duplicata.",
    );
  });
});

describe("riga delle taglie a zero", () => {
  it("raggruppa tre o più taglie di seguito", () => {
    expect(sizeList(["L", "XS", "M", "S"])).toBe("XS–L");
    expect(sizeList(["S", "M"])).toBe("S, M");
    expect(sizeList(["XS", "M", "L", "XL", "XXL"])).toBe("XS, M–XXL");
    expect(sizeList(["L"])).toBe("L");
  });

  it("«Manca L» con un colore, il colore quando sono due, «esaurita» per un colore finito", () => {
    const one = run("F40", "Bianco", [
      [1, 0],
      [2, 0],
      [3, 0],
      [0, 0],
      [4, 0],
      [5, 0],
    ]);
    expect(tshirtLineHint(countOf(countTshirtLines(one.items, one.rows), "F40"))).toBe("Manca L");
    const white = run("GT3RS", "Bianco", [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    const navy = run("GT3RS", "Blu", [
      [1, 0],
      [1, 0],
      [1, 0],
      [0, 0],
      [1, 0],
      [1, 0],
    ]);
    const both = countTshirtLines([...white.items, ...navy.items], [...white.rows, ...navy.rows]);
    expect(tshirtLineHint(countOf(both, "GT3RS"))).toBe("Bianca esaurita · manca L blu");
    const full = run("SL", "Azzurro", [
      [1, 0],
      [1, 0],
    ]);
    expect(tshirtLineHint(countOf(countTshirtLines(full.items, full.rows), "300SL"))).toBeNull();
  });

  it("nome accessibile del riquadro con numero, colori, taglie e azione", () => {
    const white = run("964", "Bianco", [[3, 0]]);
    const navy = run("964", "Blu", [[0, 0]]);
    const line = countOf(
      countTshirtLines([...white.items, ...navy.items], [...white.rows, ...navy.rows]),
      "964",
    );
    expect(tshirtTileLabel(line, false)).toBe(
      "964: 3 disponibili. bianca 3, blu 0. Blu esaurita. Tocca per vederla nella tabella.",
    );
    expect(tshirtTileLabel(line, true)).toContain("Filtro attivo");
  });

  it("iniziali dell'icona di riserva", () => {
    expect(TSHIRT_LINES.map((line) => tshirtInitials(line.name))).toEqual([
      "964",
      "GT3",
      "P8",
      "F40",
      "512",
      "300",
    ]);
  });
});

describe("anteprima locale", () => {
  it("numeri sintetici per tutte e sei, con una grafica a zero e pezzi riservati", () => {
    const { items } = loadInventory();
    const rows = previewMagadzinoAvailability(items);
    expect(rows.every((row) => row.locationCode === MAGADZINO_CODE)).toBe(true);
    expect(rows.some((row) => row.reserved > 0)).toBe(true);
    const counts = countTshirtLines(items, rows);
    expect(counts.every((count) => count.state !== "missing" && count.state !== "unknown")).toBe(
      true,
    );
    expect(counts.filter((count) => count.available === 0).map((count) => count.line.name)).toEqual(
      ["F40"],
    );
    // Solo T-shirt: i cappellini dello snapshot non hanno righe sintetiche.
    const ids = new Set(rows.map((row) => row.stockItemId));
    expect(items.filter((entry) => entry.category !== "T-shirt").some((e) => ids.has(e.id))).toBe(
      false,
    );
  });
});
