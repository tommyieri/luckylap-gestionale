import { describe, expect, it } from "vitest";
import {
  bySize,
  destinationLabel,
  parseRestockCommand,
  parseRestockLines,
  restockAttemptSummary,
  restockHref,
  restockPending,
  restockPendingKey,
  shopShortName,
  stateSince,
  stateStep,
  STATE_LABEL,
} from "./model";

const op = "95000000-0000-4000-8000-000000000001";
const order = "95000000-0000-4000-8000-000000000002";
const product = "95000000-0000-4000-8000-000000000003";
const shop = "95000000-0000-4000-8000-000000000004";
const line = (over: Record<string, unknown> = {}) => ({
  destination: "warehouse",
  product_id: product,
  color: "Blu",
  size: "M",
  quantity: 2,
  ...over,
});
const command = (kind: string, payload: Record<string, unknown>, extra = {}) => ({
  operationId: op,
  kind,
  payload: { schema_version: 1, ...payload },
  ...extra,
});

describe("stati e testi", () => {
  it("cinque passi nell'ordine voluto, con le parole di Tommi", () => {
    expect(Object.values(STATE_LABEL)).toEqual([
      "Discussione su cosa riordinare",
      "Ordine magliette a Marco",
      "Dal ricamatore",
      "Da Antonella",
      "In mano nostra",
    ]);
    expect(stateStep("quality")).toBe(4);
    expect(stateSince("quality", "2026-10-23T08:00:00Z")).toBe("Da Antonella dal 23 ottobre");
    // All'ora di Roma: le 23:30 UTC del 22 sono già il 23.
    expect(stateSince("supplier", "2026-10-22T23:30:00Z")).toBe("Ordinate a Marco dal 23 ottobre");
  });

  it("per LCM: iniziali del negozio quando il nome ha almeno tre parole", () => {
    expect(shopShortName("Libreria Concessionaria Milano")).toBe("LCM");
    expect(shopShortName("Negozio Milano")).toBe("Negozio Milano");
    expect(destinationLabel("shop", "Libreria Concessionaria Milano")).toBe("Per LCM");
    expect(destinationLabel("shop", null)).toBe("Per il negozio");
    expect(destinationLabel("warehouse", "x")).toBe("Per noi");
    expect(destinationLabel("customer", "x")).toBe("Per il cliente");
  });

  it("taglie in ordine, le altre in fondo", () => {
    expect(["XXXL", "M", "UNICA", "XS", "ZZ", "XXL"].sort(bySize)).toEqual([
      "XS",
      "M",
      "XXL",
      "XXXL",
      "UNICA",
      "ZZ",
    ]);
    expect(restockHref()).toBe("/stock/riassortimento");
    expect(restockHref(order.toUpperCase())).toBe(`/stock/riassortimento/${order}`);
    expect(restockHref("non-un-id")).toBe("/stock/riassortimento");
  });
});

describe("comandi", () => {
  it("righe ordinate, senza doppioni, taglie maiuscole, quantità da 1 a 100.000", () => {
    const lines = parseRestockLines([
      line({ destination: "shop", size: "S" }),
      line({ product_id: product.toUpperCase() }),
      line({ destination: "customer", size: "XXXL" }),
    ]);
    expect(lines?.map((l) => `${l.destination}:${l.size}`)).toEqual([
      "customer:XXXL",
      "shop:S",
      "warehouse:M",
    ]);
    expect(lines?.[2].product_id).toBe(product);
    for (const wrong of [
      [line(), line()],
      [line({ size: "m" })],
      [line({ quantity: 0 })],
      [line({ quantity: 100_001 })],
      [line({ destination: "negozio" })],
      [{ ...line(), extra: 1 }],
      Array.from({ length: 601 }, (_, i) => line({ size: `S${i}` })),
    ])
      expect(parseRestockLines(wrong)).toBeNull();
    expect(parseRestockLines([])).toEqual([]);
  });

  it("ogni comando con le sue chiavi esatte", () => {
    const valid = [
      command("save_restock_order", {
        order_id: null,
        expected_version: null,
        title: "  Riordine di novembre ",
        notes: "Nota\r\nsu due righe",
        shop_location_id: shop,
      }),
      command("set_restock_lines", { order_id: order, expected_version: 3, lines: [line()] }),
      command("move_restock_order", {
        order_id: order,
        expected_version: 3,
        state: "embroiderer",
        note: "",
      }),
      command("receive_restock_order", {
        order_id: order,
        expected_version: 3,
        expected_pieces: 81,
        note: "",
      }),
      command("undo_restock_arrival", { order_id: order, expected_version: 4, note: "" }),
      command("set_restock_shop_done", { order_id: order, expected_version: 4, done: true }),
    ];
    for (const value of valid) expect(parseRestockCommand(value)).not.toBeNull();
    const saved = parseRestockCommand(valid[0])!;
    expect(saved.payload).toMatchObject({
      title: "Riordine di novembre",
      notes: "Nota\nsu due righe",
    });
    expect(parseRestockCommand({ ...valid[1], retry: true })?.retry).toBe(true);
    for (const wrong of [
      { ...valid[0], payload: { ...valid[0].payload, title: "ab" } },
      { ...valid[0], payload: { ...valid[0].payload, expected_version: 1 } },
      { ...valid[2], payload: { ...valid[2].payload, state: "in_hand" } },
      { ...valid[3], payload: { ...valid[3].payload, expected_pieces: -1 } },
      { ...valid[5], payload: { ...valid[5].payload, done: "sì" } },
      { ...valid[4], payload: { ...valid[4].payload, extra: 1 } },
      { ...valid[4], payload: { ...valid[4].payload, schema_version: 2 } },
      { ...valid[4], kind: "delete_restock_order" },
      { ...valid[4], operationId: "x" },
      { ...valid[4], other: true },
    ])
      expect(parseRestockCommand(wrong)).toBeNull();
  });
});

describe("tentativi conservati", () => {
  const storage = (value: string | null) => ({ getItem: () => value });
  it("chiave per persona, lettura del tentativo, errore se non si legge", () => {
    expect(restockPendingKey("u1")).toBe("luckylap.restock.pending:u1");
    expect(restockPending(storage(null), "u1")).toBeNull();
    const move = command("move_restock_order", {
      order_id: order,
      expected_version: 2,
      state: "quality",
      note: "",
    });
    expect(restockPending(storage(JSON.stringify(move)), "u1")?.kind).toBe("move_restock_order");
    expect(() => restockPending(storage("{"), "u1")).toThrow();
    expect(() => restockPending(storage(JSON.stringify({ kind: "x" })), "u1")).toThrow();
  });

  it("riepilogo leggibile, mai il codice tecnico", () => {
    const title = (id: string) => (id === order ? "Riordine di novembre" : null);
    const receive = parseRestockCommand(
      command("receive_restock_order", {
        order_id: order,
        expected_version: 3,
        expected_pieces: 81,
        note: "",
      }),
    )!;
    expect(restockAttemptSummary(receive, title)).toEqual({
      title: "Arrivo in magazzino da verificare",
      lines: ["Riordine «Riordine di novembre»", "Da caricare: 81 pezzi"],
    });
    const move = parseRestockCommand(
      command("move_restock_order", {
        order_id: order,
        expected_version: 2,
        state: "quality",
        note: "",
      }),
    )!;
    expect(restockAttemptSummary(move, () => null).lines).toEqual([
      "Riordine non più nell’elenco",
      "Nuovo stato: Da Antonella",
    ]);
    for (const value of [
      command("save_restock_order", {
        order_id: null,
        expected_version: null,
        title: "Nuovo",
        notes: "",
        shop_location_id: null,
      }),
      command("set_restock_lines", { order_id: order, expected_version: 3, lines: [line()] }),
      command("undo_restock_arrival", { order_id: order, expected_version: 4, note: "" }),
      command("set_restock_shop_done", { order_id: order, expected_version: 4, done: false }),
    ]) {
      const summary = restockAttemptSummary(parseRestockCommand(value)!, title);
      expect(JSON.stringify(summary)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
      expect(summary.title).toMatch(/da verificare$/);
    }
  });
});
