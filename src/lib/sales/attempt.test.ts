import { describe, expect, it } from "vitest";
import { salesAttemptSummary } from "./attempt";
import { syntheticId, syntheticSale } from "./fixtures";
import type { SalesCommand } from "./model";

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
});
