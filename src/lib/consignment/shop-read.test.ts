import { describe, expect, it } from "vitest";
import {
  beforeCountColumn,
  countDraft,
  incomingByItem,
  orderLinesFromReport,
  orderProgress,
  reportDraft,
  reportFormRows,
  reportMonthRows,
  reportOverview,
  shopHistory,
  shopPageFromRows,
  shopQuantity,
  shopReminders,
  shopsFromRows,
  shopStockGrid,
  suggestedReportMonth,
  type ShopPageRows,
} from "./shop-read";
import { item, shopListRows, shopPageRows, sid, sx } from "./shop-fixtures";

const page = (rows: ShopPageRows = shopPageRows()) =>
  shopPageFromRows(rows, "2026-10-22T10:00:00Z");
const uncounted = () => page(shopPageRows("NEG02"));
type Row = Record<string, unknown>;
const edit = (mutate: (rows: ShopPageRows) => void, code = "NEG01") => {
  const rows = shopPageRows(code);
  mutate(rows);
  return rows;
};
const gt3BluM = item("GT3RS", "Blu", "M");

describe("lettura della pagina del negozio", () => {
  it("tiene solo le T-shirt, nell'ordine del Magazzino, con il prezzo del catalogo", () => {
    const p = page();
    expect(p.items).toHaveLength(24);
    expect(p.items.map((i) => i.label).slice(0, 7)).toEqual([
      "GT3RS Blu XS",
      "GT3RS Blu S",
      "GT3RS Blu M",
      "GT3RS Blu L",
      "GT3RS Blu XL",
      "GT3RS Blu XXL",
      "GT3RS Bianco XS",
    ]);
    expect(p.items.some((i) => i.id === sid(124))).toBe(false);
    expect(p.items.find((i) => i.label === "964 Bianco XXL")?.catalog).toBeNull();
    expect(p.items.find((i) => i.id === gt3BluM)?.catalog).toMatchObject({ priceCents: 4500 });
    expect(p.items.find((i) => i.id === gt3BluM)?.costCents).toBe(1320);
    expect(p.shop).toMatchObject({
      code: "NEG01",
      brandShareBps: 6000,
      markupCents: 1000,
      migrated: true,
    });
    expect(p.warehouses.map((w) => w.code)).toEqual(["MAG01"]);
    expect(p.payments).toHaveLength(2);
  });
  it("senza Finance non porta pagamenti", () => {
    expect(page(shopPageRows("NEG01", false)).payments).toBeNull();
  });
  it.each<[string, (rows: ShopPageRows) => void]>([
    ["riga del resoconto mancante", (r) => r.reportLines.pop()],
    ["versione mancante", (r) => r.reportRevisions.splice(1, 1)],
    ["riga di un resoconto sconosciuto", (r) => ((r.reportLines[0] as Row).report_id = sid(999))],
    ["riga d'ordine orfana", (r) => ((r.orderLines[0] as Row).order_id = sid(999))],
    ["ordine senza righe", (r) => r.orderLines.splice(0, 1)],
    ["pagamento mancante", (r) => r.payments!.splice(0, 1)],
    ["storico del pagamento mancante", (r) => r.paymentRevisions!.splice(2, 1)],
    ["saldo di un'altra sede", (r) => ((r.availability[0] as Row).location_id = sx.shop2)],
    ["saldo doppio", (r) => r.availability.push(r.availability[0])],
    ["saldo incoerente", (r) => ((r.availability[0] as Row).available = 3)],
    ["conte mancanti con il negozio contato", (r) => r.counts.splice(0, 2)],
    ["catalogo doppio", (r) => r.catalog.push(r.catalog[0])],
    ["articolo senza variante", (r) => r.variants.splice(0, 1)],
    ["prezzo bloccato alterato", (r) => ((r.reportLines[0] as Row).brand_cents = 9901)],
    [
      "quota della riga diversa dal resoconto",
      (r) => ((r.reportLines[0] as Row).brand_share_bps = 5000),
    ],
    ["stato del pagamento incoerente", (r) => ((r.reports[0] as Row).payment_state = "paid")],
    ["consegna di un ordine sconosciuto", (r) => ((r.shipments[0] as Row).order_id = sid(999))],
    ["ordine aperto senza residuo", (r) => ((r.orders[1] as Row).status = "delivered")],
    ["resoconto di un'altra sede", (r) => ((r.reports[0] as Row).location_id = sx.shop2)],
  ])("rifiuta una lettura troncata o orfana: %s", (_, mutate) => {
    expect(() => page(edit(mutate))).toThrow("Lettura conto vendita non completa");
  });
  it("le note si misurano in caratteri, come nel database", () => {
    expect(() => page(edit((r) => ((r.counts[0] as Row).note = "🏁".repeat(500))))).not.toThrow();
    expect(() => page(edit((r) => ((r.counts[0] as Row).note = "🏁".repeat(501))))).toThrow();
  });
  it("un nome vuoto nel profilo non blocca la pagina", () => {
    const p = page(edit((r) => ((r.profiles[0] as Row).display_name = " ")));
    expect(p.counts.at(-1)?.author).toBe("Un membro del team");
  });
  it("rifiuta una sede che non è un negozio", () => {
    expect(() => page(edit((r) => ((r.shop as Row).location_id = sx.central)))).toThrow();
  });
});

describe("giacenza del negozio", () => {
  it("prima della prima conta ogni cella è sconosciuta, anche con un saldo a 0", () => {
    const p = uncounted(),
      grid = shopStockGrid(p);
    expect(p.shopStock[item("GT3RS", "Blu", "S")]).toBe(0);
    expect(shopQuantity(p, item("GT3RS", "Blu", "S"))).toBeNull();
    expect(grid.counted).toBe(false);
    expect(grid.total).toBeNull();
    expect(
      grid.groups.flatMap((g) => g.rows.flatMap((r) => r.cells.map((c) => c.quantity))),
    ).toEqual(Array(24).fill(null));
  });
  it("dopo la conta lo zero è noto e un saldo mancante vale 0", () => {
    const p = page(),
      grid = shopStockGrid(p);
    expect(p.shopStock[item("GT3RS", "Bianco", "XS")]).toBeNull();
    expect(shopQuantity(p, item("GT3RS", "Bianco", "XS"))).toBe(0);
    expect(grid.total).toBe(8);
    const blu = grid.groups[0].rows[0];
    expect(grid.groups.map((g) => g.model)).toEqual(["GT3RS", "964", "F40"]);
    expect(grid.groups[0].rows.map((r) => r.color)).toEqual(["Blu", "Bianco"]);
    expect(grid.sizes).toEqual(["XS", "S", "M", "L", "XL", "XXL"]);
    expect(blu.cells.map((c) => c.quantity)).toEqual([0, 0, 5, 2, 0, 0]);
  });
  it("mostra «in arrivo» dagli ordini aperti", () => {
    const p = page();
    expect(incomingByItem(p.orders)).toEqual({
      [gt3BluM]: 2,
      [item("F40", "Rosso", "L")]: 3,
    });
    const cell = shopStockGrid(p).groups[0].rows[0].cells[2];
    expect(cell).toMatchObject({ size: "M", quantity: 5, incoming: 2 });
  });
  it("due varianti con modello, colore e taglia uguali vanno su righe distinte", () => {
    const twin = item("GT3RS", "Bianco", "M");
    const rows = shopStockGrid(
      page(
        edit(
          (r) => ((r.variants.find((v) => (v as Row).stock_item_id === twin) as Row).color = "Blu"),
        ),
      ),
    ).groups[0].rows;
    expect(rows.map((r) => r.color)).toEqual(["Blu", "Blu", "Bianco"]);
    expect(rows[1].cells.filter((c) => c.item).map((c) => c.size)).toEqual(["M"]);
  });
  it("nasconde le T-shirt disattivate, salvo se sono ancora in negozio", () => {
    const f40xxl = item("F40", "Rosso", "XXL");
    const hidden = shopStockGrid(page()).groups[2].rows[0].cells[5];
    expect(hidden.item).toBeNull();
    const shown = shopStockGrid(
      page(
        edit((r) => {
          const row = r.availability.find(
            (a) => (a as Row).stock_item_id === f40xxl && (a as Row).location_id === sx.shop,
          ) as Row;
          row.on_hand = 1;
          row.available = 1;
        }),
      ),
    ).groups[2].rows[0].cells[5];
    expect(shown).toMatchObject({ quantity: 1 });
    expect(shown.item?.id).toBe(f40xxl);
  });
});

describe("conta", () => {
  it("la prima conta comprende tutte le T-shirt attive, un campo vuoto vale 0", () => {
    const draft = countDraft(uncounted(), { [gt3BluM]: 4 })!;
    expect(draft.lines).toHaveLength(23);
    expect(draft).toMatchObject({ pieces: 4, variants: 1, zeros: 22 });
    expect(draft.lines.find((l) => l.stock_item_id === gt3BluM)?.expected_quantity).toBeNull();
    expect(
      draft.lines.find((l) => l.stock_item_id === item("GT3RS", "Blu", "S"))?.expected_quantity,
    ).toBe(0);
    expect(draft.lines.map((l) => l.stock_item_id)).toEqual(
      [...draft.lines.map((l) => l.stock_item_id)].sort(),
    );
  });
  it("una correzione invia solo le varianti toccate, con la quantità letta", () => {
    expect(countDraft(page(), { [gt3BluM]: 3 })?.lines).toEqual([
      { stock_item_id: gt3BluM, quantity: 3, expected_quantity: 5 },
    ]);
    expect(countDraft(page(), {})).toBeNull();
    expect(countDraft(page(), { [gt3BluM]: null })).toBeNull();
    expect(countDraft(page(), { [gt3BluM]: -1 })).toBeNull();
    expect(countDraft(page(), { [sid(999)]: 1 })).toBeNull();
  });
});

describe("resoconto mensile", () => {
  it("riepilogo con i quattro numeri, la fattura e il pagamento", () => {
    const p = page(),
      overview = reportOverview(p, p.reports[0]);
    expect(overview).toMatchObject({
      title: "settembre 2026",
      pieces: 4,
      grossCents: 22499,
      shopCents: 9000,
      brandCents: 13499,
      shopShareLabel: "Quota negozio (40%)",
      brandShareLabel: "Da fatturare al negozio (60%)",
      invoiceLabel: "Fattura n. 12 del 3 ottobre 2026",
      paymentLabel: "Pagata in parte: 50,00 € su 134,99 €",
      paidCents: 5000,
      remainingCents: 8499,
      overpaidCents: 0,
    });
    expect(overview.invoice?.outdated).toBe(false);
    expect(
      overview.lines.map((l) => [l.label, l.quantity, l.unitShopPriceCents, l.brandCents]),
    ).toEqual([
      ["GT3RS Blu M", 3, 5500, 9900],
      ["964 Bianco L", 1, 5999, 3599],
    ]);
    expect(overview.history[1].label).toMatch(
      /^Versione 2 · Collega sintetica · .+ · Il negozio ha corretto una taglia$/,
    );
    expect(overview.history[0].label).toMatch(/Fattura n\. 12 segnata$/);
    expect(overview.history[2].label).toMatch(/Prima registrazione$/);
  });
  it("senza Finance mostra lo stato ma non gli importi pagati", () => {
    const p = page(shopPageRows("NEG01", false)),
      overview = reportOverview(p, p.reports[0]);
    expect(overview).toMatchObject({
      paymentLabel: "Pagata in parte",
      paidCents: null,
      payments: null,
    });
  });
  it("colonna «Prima della conta» solo con una conta dall'inizio del mese in poi", () => {
    const p = page();
    expect(beforeCountColumn(p, "2026-09")).toBe(true);
    expect(beforeCountColumn(p, "2026-10")).toBe(true);
    expect(beforeCountColumn(p, "2026-11")).toBe(false);
    const early = page(
      edit((r) => {
        r.counts.splice(1, 1);
      }),
    );
    expect(beforeCountColumn(early, "2026-10")).toBe(false);
  });
  it("mesi: in corso, da registrare e registrati; il pulsante propone il mese precedente", () => {
    const p = page();
    expect(
      reportMonthRows(p, "2026-11-05T10:00:00Z").map((r) => [
        r.month,
        r.current,
        r.missing,
        !!r.report,
      ]),
    ).toEqual([
      ["2026-11", true, false, false],
      ["2026-10", false, true, false],
      ["2026-09", false, false, true],
    ]);
    expect(suggestedReportMonth(p, "2026-11-05T10:00:00Z")).toBe("2026-10");
    expect(suggestedReportMonth(p, "2026-10-22T10:00:00Z")).toBeNull();
    expect(suggestedReportMonth(p, "2026-09-10T10:00:00Z")).toBeNull();
  });
  it("modulo: varianti in negozio o già nel resoconto; senza prezzo la riga è spenta", () => {
    const p = page();
    expect(reportFormRows(p, "2026-10").map((r) => r.item.label)).toEqual([
      "GT3RS Blu M",
      "GT3RS Blu L",
      "964 Bianco L",
    ]);
    const all = reportFormRows(p, "2026-10", true);
    expect(all).toHaveLength(23);
    expect(all.find((r) => r.item.label === "964 Bianco XXL")).toMatchObject({
      disabled: true,
      price: null,
    });
    expect(all.find((r) => r.item.id === gt3BluM)?.price).toEqual({
      webPriceCents: 4500,
      unitShopPriceCents: 5500,
      locked: false,
    });
    const september = reportFormRows(
      page(
        edit((r) => {
          for (const a of r.availability as Row[])
            if (a.location_id === sx.shop) Object.assign(a, { on_hand: 0, available: 0 });
        }),
      ),
      "2026-09",
    );
    expect(september.map((r) => [r.item.label, r.price?.locked])).toEqual([
      ["GT3RS Blu M", true],
      ["964 Bianco L", true],
    ]);
  });
  it("il prezzo resta bloccato nelle righe già presenti; le nuove usano il catalogo letto", () => {
    const p = page(
      edit((r) => {
        for (const c of r.catalog as Row[]) if (c.stock_item_id === gt3BluM) c.price_cents = 4800;
      }),
    );
    const edited = reportDraft(p, "2026-09", {
      [gt3BluM]: { quantity: 2, beforeCount: 0 },
      [item("GT3RS", "Blu", "L")]: { quantity: 1, beforeCount: 1 },
    });
    expect(edited).toEqual({
      status: "ok",
      lines: [
        { stock_item_id: gt3BluM, quantity: 2, before_count_quantity: 0, price: null },
        {
          stock_item_id: item("GT3RS", "Blu", "L"),
          quantity: 1,
          before_count_quantity: 1,
          price: {
            shop_domain: sx.domain,
            variant_gid: "gid://shopify/ProductVariant/1003",
            expected_web_price_cents: 4500,
            expected_catalog_observed_at: sx.observedAt,
          },
        },
      ],
      totals: { pieces: 3, grossCents: 16500, brandCents: 9900, shopCents: 6600 },
    });
    const created = reportDraft(p, "2026-10", { [gt3BluM]: { quantity: 1, beforeCount: 0 } });
    expect(created.status === "ok" && created.totals).toEqual({
      pieces: 1,
      grossCents: 5800,
      brandCents: 3480,
      shopCents: 2320,
    });
  });
  it("una variante a 0 non si invia; prezzo mancante e valori non validi si fermano", () => {
    const p = page();
    expect(reportDraft(p, "2026-10", { [gt3BluM]: { quantity: 0, beforeCount: 0 } })).toEqual({
      status: "ok",
      lines: [],
      totals: { pieces: 0, grossCents: 0, brandCents: 0, shopCents: 0 },
    });
    const xxl = item("964", "Bianco", "XXL");
    expect(reportDraft(p, "2026-10", { [xxl]: { quantity: 1, beforeCount: 0 } })).toEqual({
      status: "missing_price",
      itemId: xxl,
    });
    expect(reportDraft(p, "2026-10", { [gt3BluM]: { quantity: 1, beforeCount: 2 } }).status).toBe(
      "invalid",
    );
    expect(reportDraft(p, "2026-10", { [gt3BluM]: { quantity: 1.5, beforeCount: 0 } }).status).toBe(
      "invalid",
    );
  });
});

describe("ordini", () => {
  it("da preparare, in magazzino e mancanti con le riserve del magazzino", () => {
    const p = page(),
      open = p.orders.find((o) => o.status === "open")!,
      progress = orderProgress(p, open);
    expect(
      progress.lines.map((l) => [l.label, l.remaining, l.available, l.ready, l.missing]),
    ).toEqual([
      ["GT3RS Blu M", 2, 1, 1, 1],
      ["F40 Rosso L", 3, 0, 0, 3],
    ]);
    expect(progress).toMatchObject({ remaining: 5, ready: 1, missing: 4, done: false });
    expect(
      orderProgress(
        p,
        p.orders.find((o) => o.status === "delivered")!,
      ).done,
    ).toBe(true);
  });
  it("prepara un ordine con le stesse magliette del resoconto", () => {
    const p = page();
    expect(orderLinesFromReport(p.reports[0])).toEqual(
      [
        { stock_item_id: gt3BluM, quantity: 3 },
        { stock_item_id: item("964", "Bianco", "L"), quantity: 1 },
      ].sort((a, b) => (a.stock_item_id < b.stock_item_id ? -1 : 1)),
    );
  });
});

describe("promemoria", () => {
  it("mese finito senza resoconto sì, mese in corso no", () => {
    const p = page();
    expect(shopReminders(p, "2026-10-22T10:00:00Z").map((r) => r.text)).toEqual([
      "1 ordine da consegnare.",
    ]);
    expect(shopReminders(p, "2026-11-05T10:00:00Z").map((r) => r.text)).toEqual([
      "Resoconto di ottobre da registrare.",
      "1 ordine da consegnare.",
    ]);
  });
  it("prima della conta nessun resoconto da registrare, solo la conta", () => {
    expect(shopReminders(uncounted(), "2026-12-05T10:00:00Z").map((r) => r.key)).toEqual(["count"]);
  });
  it("un negozio nuovo non deve i mesi prima della sua apertura", () => {
    const p = page(
      edit((r) => {
        Object.assign(r.shop as Row, {
          first_counted_at: "2026-10-16T09:00:00+00:00",
        });
        r.counts.push({
          id: sid(503),
          location_id: sx.shop2,
          counted_at: "2026-10-16T09:00:00+00:00",
          full_count: true,
          pieces: 0,
          note: "",
          created_by: sx.user,
        });
      }, "NEG02"),
    );
    expect(shopReminders(p, "2026-12-05T10:00:00Z").map((r) => r.text)).toEqual([
      "Resoconto di ottobre da registrare.",
      "Resoconto di novembre da registrare.",
    ]);
  });
  it("fattura da emettere, nota di credito e pagamento in più", () => {
    const p = page(
      edit((r) => {
        Object.assign(r.reports[0] as Row, {
          revision: 4,
          invoice_number: null,
          invoice_date: null,
          invoice_revision: null,
        });
        r.reportRevisions.push({
          ...(r.reportRevisions[1] as Row),
          id: sid(324),
          revision: 4,
          reason: "Correzione dopo la fattura",
        });
      }),
    );
    expect(shopReminders(p, "2026-10-22T10:00:00Z").map((r) => r.text)).toContain(
      "Fattura di settembre da emettere.",
    );
    const credit = page(
      edit((r) => {
        Object.assign(r.reports[0] as Row, { revision: 4 });
        r.reportRevisions.push({ ...(r.reportRevisions[1] as Row), id: sid(324), revision: 4 });
      }),
    );
    expect(shopReminders(credit, "2026-10-22T10:00:00Z").map((r) => r.text)).toContain(
      "Resoconto di settembre modificato dopo la fattura n. 12: controlla se serve una nota di credito.",
    );
    expect(reportOverview(credit, credit.reports[0]).invoice?.outdated).toBe(true);
    const overpaid = (finance: boolean) =>
      page(
        edit((r) => {
          (r.reports[0] as Row).payment_state = "overpaid";
          if (finance) {
            (r.payments![0] as Row).amount_cents = 14000;
            (r.paymentRevisions![0] as Row).snapshot = {
              ...((r.paymentRevisions![0] as Row).snapshot as Row),
              amount_cents: 14000,
            };
          } else {
            r.payments = null;
            r.paymentRevisions = null;
          }
        }),
      );
    expect(shopReminders(overpaid(true), "2026-10-22T10:00:00Z").map((r) => r.text)).toContain(
      "Per settembre il negozio ha pagato 5,01 € in più del dovuto.",
    );
    const blind = shopPageFromRows(
      (() => {
        const rows = shopPageRows("NEG01", false);
        (rows.reports[0] as Row).payment_state = "overpaid";
        return rows;
      })(),
    );
    expect(shopReminders(blind, "2026-10-22T10:00:00Z").map((r) => r.text)).toContain(
      "Per settembre il negozio ha pagato più del dovuto.",
    );
    expect(() => overpaid(false)).not.toThrow();
  });
});

describe("storico", () => {
  it("conte, consegne, magliette riportate e versioni, dalla più recente", () => {
    const history = shopHistory(page());
    expect(history.map((h) => h.text)).toEqual([
      "Riportate in magazzino: 2 magliette",
      "Consegna dell’ordine n. 2: 1 maglietta",
      "Correzione della conta: 2 magliette nelle varianti contate",
      "Resoconto di settembre 2026: fattura n. 12 segnata",
      "Resoconto di settembre 2026 corretto (versione 2)",
      "Resoconto di settembre 2026 registrato: 3 magliette",
      "Consegna dell’ordine n. 1: 4 magliette",
      "Conta in negozio: 20 magliette",
    ]);
    expect(history[0].detail).toBe("Fine stagione sintetica");
    expect(history[1].href).toBe("/consignment/NEG01/ordini/2");
  });
});

describe("elenco dei negozi", () => {
  it("in negozio, ultimo resoconto, mesi da registrare e ordini aperti", () => {
    const list = shopsFromRows(shopListRows(), "2026-11-05T10:00:00Z");
    expect(
      list.shops.map((s) => [
        s.code,
        s.pieces,
        s.lastReport?.status ?? null,
        s.missingMonths,
        s.openOrders,
      ]),
    ).toEqual([
      ["NEG01", 8, "Pagata in parte", ["2026-10"], 1],
      ["NEG02", null, null, [], 0],
    ]);
    expect(list.closed.map((s) => [s.code, s.lastReport])).toEqual([
      ["NEG03", { month: "2026-09", pieces: 1, status: "Pagata" }],
    ]);
    expect(list.shops[0].href).toBe("/consignment/NEG01");
  });
  it.each<[string, (rows: ReturnType<typeof shopListRows>) => void]>([
    [
      "resoconto di un negozio sconosciuto",
      (r) => ((r.reports[0] as Row).location_id = sx.central),
    ],
    ["ordine non aperto", (r) => ((r.openOrders[0] as Row).status = "delivered")],
    [
      "saldo di una sede che non è un negozio",
      (r) => ((r.availability[0] as Row).location_id = sx.central),
    ],
    ["negozio senza sede", (r) => ((r.shops[0] as Row).location_id = sid(999))],
    ["totali incoerenti", (r) => ((r.reports[0] as Row).shop_cents = 1)],
  ])("rifiuta %s", (_, mutate) => {
    const rows = shopListRows();
    mutate(rows);
    expect(() => shopsFromRows(rows, "2026-11-05T10:00:00Z")).toThrow();
  });
});
