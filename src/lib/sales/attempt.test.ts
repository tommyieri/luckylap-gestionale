import { describe, expect, it } from "vitest";
import { salesAttemptNames, salesAttemptSummary } from "./attempt";
import { externalSyntheticRows, syntheticId, syntheticRows, syntheticSale } from "./fixtures";
import type { SalesCommand } from "./model";
import { salesSnapshotFromRows } from "./read";

const sale = syntheticSale() as SalesCommand;
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("riepilogo di un invio delle Vendite da verificare", () => {
  it("una vendita: canale con la sua etichetta, righe in capi ed euro, mai codici", () => {
    const summary = salesAttemptSummary(sale);
    expect(summary).toEqual({
      title: "Vendita da verificare",
      lines: ["Canale: Diretta", "Riga 1: 2 capi a 40,01 €", "Da incassare"],
      occurredAt: "2026-10-21T08:00:00Z",
    });
    expect(JSON.stringify(summary.lines)).not.toMatch(uuid);
    expect(JSON.stringify(summary.lines)).not.toMatch(/direct|4001|unpaid/);
  });

  it("usa i nomi della pagina quando ci sono, con sconto e incasso", () => {
    const paid = {
      ...sale,
      payload: {
        ...sale.payload,
        channel: "etsy",
        external_reference: " ETSY-SINTETICO-7 ",
        lines: [
          {
            stock_item_id: syntheticId(1),
            quantity: 1,
            unit_price_cents: 4500,
            discount_cents: 500,
          },
        ],
        payment: {
          status: "paid",
          method: "bank_transfer",
          amount_cents: 4000,
          occurred_at: "2026-10-21T08:00:00Z",
        },
      },
    };
    expect(
      salesAttemptSummary(paid, { item: (id) => (id === syntheticId(1) ? "GT3 Blu M" : null) })
        .lines,
    ).toEqual([
      "Canale: Etsy",
      "Riferimento dell’ordine: ETSY-SINTETICO-7",
      "GT3 Blu M: 1 capo a 45,00 €, sconto 5,00 €",
      "Pagata: 40,00 € in bonifico",
    ]);
  });

  it("consegne, annulli, capi prodotti e incassi", () => {
    const order = syntheticId(3);
    const fulfil: SalesCommand = {
      operationId: syntheticId(91),
      kind: "fulfill_order_lines",
      payload: {
        order_id: order,
        lines: [{ order_line_id: syntheticId(5), quantity: 3 }],
        occurred_at: "2026-10-21T08:00:00Z",
        reason: "Consegna sintetica",
      },
    };
    expect(salesAttemptSummary(fulfil)).toMatchObject({
      title: "Consegna da verificare",
      lines: ["Ordine 80000000", "Riga 1: 3 capi", "Motivo: Consegna sintetica"],
    });
    expect(
      salesAttemptSummary(
        { ...fulfil, kind: "cancel_unfulfilled_lines" },
        { order: () => "Ordine Shopify 1001", orderLine: () => "F40 Rosso L" },
      ).lines,
    ).toEqual(["Ordine Shopify 1001", "F40 Rosso L: 3 capi", "Motivo: Consegna sintetica"]);
    expect(
      salesAttemptSummary({
        operationId: syntheticId(92),
        kind: "complete_production",
        payload: {
          requirement_id: syntheticId(6),
          quantity: 4,
          occurred_at: "2026-10-21T08:00:00Z",
          reason: "Lotto sintetico",
        },
      }),
    ).toMatchObject({
      title: "Capi prodotti da verificare",
      lines: ["Prodotti: 4 capi", "Motivo: Lotto sintetico"],
    });
    expect(
      salesAttemptSummary({
        operationId: syntheticId(93),
        kind: "record_manual_payment",
        payload: {
          order_id: order,
          amount_cents: 1250,
          method: "cash",
          occurred_at: "2026-10-21T08:00:00Z",
        },
      }),
    ).toMatchObject({
      title: "Incasso da verificare",
      lines: ["Ordine 80000000", "Incasso: 12,50 € in contanti"],
    });
  });

  it("i capi prodotti dicono articolo e ordine, se la pagina li conosce", () => {
    const production: SalesCommand = {
      operationId: syntheticId(94),
      kind: "complete_production",
      payload: {
        requirement_id: syntheticId(6),
        quantity: 1,
        occurred_at: "2026-10-21T08:00:00Z",
        reason: "Lotto sintetico",
      },
    };
    expect(
      salesAttemptSummary(production, { requirement: () => "F40 Rosso L, Ordine Shopify 1001" })
        .lines,
    ).toEqual(["F40 Rosso L, Ordine Shopify 1001", "Prodotti: 1 capo", "Motivo: Lotto sintetico"]);
    expect(salesAttemptSummary(production, { requirement: () => null }).lines).toEqual([
      "Prodotti: 1 capo",
      "Motivo: Lotto sintetico",
    ]);
  });
});

describe("nomi dai dati della pagina delle Vendite", () => {
  const rows = () => {
    const value = syntheticRows();
    Object.assign(value.orders[0] as Record<string, unknown>, {
      external_reference: "VENDITA-SINTETICA-7",
    });
    return value;
  };
  const article = "Synthetic tee · Synthetic · M";

  it("articolo con il suo nome, ordine come nell'elenco, riga e capi da produrre", () => {
    const names = salesAttemptNames(salesSnapshotFromRows(rows()));
    expect(names.item?.(syntheticId(1))).toBe(article);
    expect(names.order?.(syntheticId(3))).toBe("VENDITA-SINTETICA-7");
    expect(names.orderLine?.(syntheticId(5))).toBe(article);
    expect(names.requirement?.(syntheticId(6))).toBe(`${article}, VENDITA-SINTETICA-7`);
    const shopify = salesAttemptNames(salesSnapshotFromRows(externalSyntheticRows()));
    expect(shopify.order?.(syntheticId(3))).toBe("Ordine Shopify 100");
    expect(shopify.requirement?.(syntheticId(6))).toBe(`${article}, Ordine Shopify 100`);
  });

  it("un id che la pagina non conosce lascia il nome di riserva", () => {
    const names = salesAttemptNames(salesSnapshotFromRows(rows()));
    for (const lookup of [names.item, names.order, names.orderLine, names.requirement])
      expect(lookup?.(syntheticId(99))).toBeNull();
    expect(
      salesAttemptSummary(
        {
          operationId: syntheticId(95),
          kind: "fulfill_order_lines",
          payload: {
            order_id: syntheticId(99),
            lines: [{ order_line_id: syntheticId(98), quantity: 1 }],
            occurred_at: "2026-10-21T08:00:00Z",
            reason: "Consegna sintetica",
          },
        },
        names,
      ).lines,
    ).toEqual(["Ordine 80000000", "Riga 1: 1 capo", "Motivo: Consegna sintetica"]);
  });

  it("con i nomi della pagina una vendita, una consegna e un incasso non hanno codici", () => {
    const names = salesAttemptNames(salesSnapshotFromRows(rows()));
    const summaries = [
      salesAttemptSummary(sale, names),
      salesAttemptSummary(
        {
          operationId: syntheticId(96),
          kind: "cancel_unfulfilled_lines",
          payload: {
            order_id: syntheticId(3),
            lines: [{ order_line_id: syntheticId(5), quantity: 1 }],
            occurred_at: "2026-10-21T08:00:00Z",
            reason: "Annullo sintetico",
          },
        },
        names,
      ),
      salesAttemptSummary(
        {
          operationId: syntheticId(97),
          kind: "record_manual_payment",
          payload: {
            order_id: syntheticId(3),
            amount_cents: 8002,
            method: "cash",
            occurred_at: "2026-10-21T08:00:00Z",
          },
        },
        names,
      ),
    ];
    expect(summaries.map((summary) => summary.lines)).toEqual([
      ["Canale: Diretta", `${article}: 2 capi a 40,01\u00a0€`, "Da incassare"],
      ["VENDITA-SINTETICA-7", `${article}: 1 capo`, "Motivo: Annullo sintetico"],
      ["VENDITA-SINTETICA-7", "Incasso: 80,02\u00a0€ in contanti"],
    ]);
    const text = JSON.stringify(summaries.map((summary) => summary.lines));
    expect(text).not.toMatch(uuid);
    expect(text).not.toMatch(/Riga \d|Ordine 8000/);
  });
});
