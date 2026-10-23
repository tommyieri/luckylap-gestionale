import { describe, expect, it } from "vitest";
import { item, sx } from "../consignment/shop-fixtures";
import {
  previewRestockData,
  previewRestockPage,
  restockCatalogRows,
  restockCoreRows,
  rx,
} from "./fixtures";
import {
  incomingByItem,
  proposedQuantities,
  restockCatalogFromRows,
  restockDataFromRows,
  restockGrid,
  shopOrderPrefill,
  shopPart,
  totalsOf,
  type RestockCoreRows,
} from "./read";

type Row = Record<string, unknown>;
const edit = (mutate: (rows: RestockCoreRows) => void) => {
  const rows = restockCoreRows();
  mutate(rows);
  return rows;
};

describe("riordini dal database", () => {
  it("righe, totali per destinazione, storico, arrivo, negozio con le sue taglie", () => {
    const data = previewRestockData();
    expect(data.orders.map((o) => o.title)).toEqual([
      "Pezzi arrivati da Antonella",
      "Riordine di novembre",
      "Riordine sintetico di ottobre",
      "Riordine di settembre",
    ]);
    const october = data.orders.find((o) => o.id === rx.quality)!;
    expect(october.totals).toEqual({ warehouse: 22, shop: 9, customer: 2, total: 33 });
    expect(october.shop).toMatchObject({ code: "NEG01", sizes: ["S", "M", "L", "XL"] });
    expect(october.events.map((e) => e.to)).toEqual([
      "discussion",
      "supplier",
      "embroiderer",
      "quality",
    ]);
    expect(october.events[3]).toMatchObject({
      by: "Collega sintetica",
      note: "Etichette e cartellini da Antonella",
    });
    expect(october.arrival).toBeNull();
    const arrived = data.orders.find((o) => o.id === rx.arrived)!;
    expect(arrived.arrival).toMatchObject({ pieces: 8, warehousePieces: 5, shopPieces: 3 });
    expect(data.shops.map((s) => s.code)).toEqual(["NEG01", "NEG02"]);
    expect(totalsOf([])).toEqual({ warehouse: 0, shop: 0, customer: 0, total: 0 });
  });

  it("una riga incompleta, orfana o incoerente fa fallire tutta la lettura", () => {
    const broken: ((rows: RestockCoreRows) => void)[] = [
      (r) => ((r.lines[0] as Row).order_id = sx.user),
      (r) => ((r.lines[0] as Row).quantity = 0),
      (r) => ((r.lines[0] as Row).size = "m"),
      (r) => ((r.lines[0] as Row).stock_item_id = null),
      (r) => r.lines.push({ ...(r.lines[0] as Row), id: sx.operation }),
      (r) => ((r.orders[0] as Row).state = "lost"),
      // In mano nostra senza arrivo aperto, o un arrivo aperto senza «in mano nostra».
      (r) => ((r.arrivals[0] as Row).undone_at = "2026-10-23T09:00:00Z"),
      (r) => ((r.orders[2] as Row).state = "quality"),
      (r) => ((r.arrivals[0] as Row).pieces = 9),
      (r) => ((r.orders[0] as Row).shop_location_id = null),
      (r) => (r.events = r.events.filter((e) => (e as Row).order_id !== rx.discussion)),
      (r) => ((r.shopOrders[0] as Row).status = "lost"),
      (r) => (r.settings = {}),
    ];
    for (const mutate of broken) expect(() => restockDataFromRows(edit(mutate))).toThrow();
    expect(() => restockDataFromRows(restockCoreRows())).not.toThrow();
  });
});

describe("catalogo, griglia e proposta", () => {
  const page = previewRestockPage(rx.discussion)!;
  it("T-shirt prima, poi gli altri prodotti; colonne per taglia con la XXXL del cliente", () => {
    const groups = restockGrid(page.catalog, page.order.lines);
    expect(groups.map((g) => g.label)).toEqual(["T-shirt", "Altri prodotti"]);
    expect(groups[0].sizes).toEqual(["XS", "S", "M", "L", "XL", "XXL", "XXXL"]);
    expect(groups[0].rows.map((r) => `${r.model} ${r.color}`)).toEqual([
      "GT3RS Bianco",
      "GT3RS Blu",
      "964 Bianco",
      "F40 Rosso",
    ]);
    expect(groups[0].rows[0].cells.at(-1)).toEqual({ size: "XXXL", variant: null });
    expect(groups[1].sizes).toEqual(["UNICA"]);
  });

  it("giacenza e obiettivo del magazzino, capi da produrre", () => {
    const bianco = page.catalog.variants.find((v) => v.itemId === item("GT3RS", "Bianco", "S"))!;
    expect(bianco).toMatchObject({ onHand: 1, target: 3, toProduce: 2 });
    expect(() =>
      restockCatalogFromRows(
        {
          ...restockCatalogRows(),
          availability: [
            { ...(restockCatalogRows().availability[0] as Row), location_id: sx.shop },
          ],
        },
        sx.central,
      ),
    ).toThrow();
  });

  it("«Proponi quantità»: obiettivo meno giacenza e meno i pezzi già in arrivo", () => {
    const incoming = incomingByItem(page.data.orders, page.order.id);
    // Il riordine di ottobre porta 3 GT3RS Blu S e 4 M per noi.
    expect(incoming[item("GT3RS", "Blu", "S")]).toBe(3);
    const proposal = proposedQuantities(page.catalog, incoming);
    expect(proposal[item("GT3RS", "Blu", "XS")]).toBe(3);
    expect(proposal[item("GT3RS", "Blu", "S")]).toBeUndefined();
    expect(proposal[item("GT3RS", "Bianco", "S")]).toBe(2);
    expect(proposal[item("964", "Bianco", "L")]).toBeUndefined();
    // Le varianti disattivate non si propongono.
    expect(proposal[item("F40", "Rosso", "XXL")]).toBeUndefined();
    expect(Object.values(proposal).every((n) => n > 0)).toBe(true);
  });
});

describe("parte del negozio", () => {
  it("da consegnare, consegnate con l'ordine legato, segnate a mano, non ancora arrivate", () => {
    const data = previewRestockData();
    const byId = (id: string) => data.orders.find((o) => o.id === id)!;
    expect(shopPart(byId(rx.arrived))).toEqual({ pieces: 3, delivered: 0, status: "todo" });
    expect(shopPart(byId(rx.delivered))).toEqual({ pieces: 1, delivered: 1, status: "done" });
    expect(shopPart(byId(rx.quality)).status).toBe("waiting");
    const manual = restockDataFromRows(
      edit((r) => {
        const row = r.orders.find((o) => (o as Row).id === rx.arrived) as Row;
        row.shop_done_at = "2026-10-23T10:00:00Z";
        row.shop_done_by = sx.user;
      }),
    ).orders.find((o) => o.id === rx.arrived)!;
    expect(shopPart(manual).status).toBe("manual");
  });

  it("righe del nuovo ordine del negozio: per variante, meno le già consegnate", () => {
    const data = previewRestockData();
    const arrived = data.orders.find((o) => o.id === rx.arrived)!;
    expect(shopOrderPrefill(arrived)).toEqual(
      [
        { stock_item_id: item("F40", "Rosso", "M"), quantity: 2 },
        { stock_item_id: item("GT3RS", "Blu", "S"), quantity: 1 },
      ].sort((a, b) => (a.stock_item_id < b.stock_item_id ? -1 : 1)),
    );
    expect(shopOrderPrefill(data.orders.find((o) => o.id === rx.delivered)!)).toEqual([]);
  });
});
