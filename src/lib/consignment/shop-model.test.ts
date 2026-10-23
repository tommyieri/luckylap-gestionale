import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { consignmentSplit } from "./model";
import {
  addMonths,
  bpsLabel,
  calendarDay,
  dayLabel,
  euroShort,
  isFinanceShopCommand,
  monthLabel,
  monthName,
  monthShort,
  monthsBetween,
  parseShopCommand,
  paymentStateFor,
  percentToBps,
  periodMonth,
  piecesLabel,
  quantityField,
  reportStatusLabel,
  romeMonth,
  romeMonthBounds,
  shopAttemptSummary,
  shopCommandItems,
  shopPending,
  shopPendingKey,
  shopSplit,
  shopTermsLabel,
  shopTotals,
  tshirtsLabel,
  SHOP_COMMAND_KINDS,
} from "./shop-model";
import { item, shopCommands, sid, sx } from "./shop-fixtures";

type Command = { operationId: string; kind: string; payload: Record<string, unknown> };
const builders = Object.values(shopCommands) as (() => Command)[];
const withPayload = (build: () => Command, over: Record<string, unknown>) => {
  const command = build();
  return { ...command, payload: { ...command.payload, ...over } };
};
const line = (id: string, quantity = 1) => ({ stock_item_id: id, quantity });

describe("shopSplit", () => {
  it("con 6000 punti base e 10 € coincide con consignmentSplit", () => {
    for (const web of [0, 1, 99, 4001, 4500, 4999, 5001, 12345, 999999])
      for (const quantity of [1, 2, 3, 7, 13, 100, 99999]) {
        const split = shopSplit(web, quantity, 6000, 1000),
          old = consignmentSplit(web, quantity);
        expect(
          split && {
            unitShopPriceCents: split.unitShopPriceCents,
            grossCents: split.grossCents,
            brandClaimCents: split.brandCents,
            shopShareCents: split.shopCents,
          },
        ).toEqual(old);
      }
  });
  it("50,01 × 2 dà 60,01 a LuckyLap e 40,01 al negozio", () => {
    expect(shopSplit(4001, 2, 6000, 1000)).toEqual({
      unitShopPriceCents: 5001,
      grossCents: 10002,
      brandCents: 6001,
      shopCents: 4001,
    });
  });
  it("il mezzo centesimo si arrotonda per eccesso, sul totale della riga", () => {
    // 50% di 50,01 € = 25,005 € → 25,01 €.
    expect(shopSplit(4001, 1, 5000, 1000)).toMatchObject({ brandCents: 2501, shopCents: 2500 });
    // 25% di 10,02 € = 2,505 € → 2,51 €; tre pezzi: 7,515 € → 7,52 €, non 3 × 2,51 €.
    expect(shopSplit(2, 1, 2500, 1000)).toMatchObject({ brandCents: 251, shopCents: 751 });
    expect(shopSplit(2, 3, 2500, 1000)).toMatchObject({ grossCents: 3006, brandCents: 752 });
  });
  it("esempio della spec: 224,99 € di incasso, 134,99 € da fatturare", () => {
    const lines = [
      { quantity: 3, ...shopSplit(4500, 3, 6000, 1000)! },
      { quantity: 1, ...shopSplit(4999, 1, 6000, 1000)! },
    ];
    expect(shopTotals(lines)).toEqual({
      pieces: 4,
      grossCents: 22499,
      brandCents: 13499,
      shopCents: 9000,
    });
  });
  it("altre quote e maggiorazioni", () => {
    expect(shopSplit(4500, 2, 5500, 500)).toEqual({
      unitShopPriceCents: 5000,
      grossCents: 10000,
      brandCents: 5500,
      shopCents: 4500,
    });
    expect(shopSplit(4500, 1, 0, 0)).toMatchObject({ brandCents: 0, shopCents: 4500 });
    expect(shopSplit(4500, 1, 10000, 0)).toMatchObject({ brandCents: 4500, shopCents: 0 });
  });
  it("limite di 9e15 centesimi per riga e per totale", () => {
    expect(shopSplit(89_999_999_000, 100_000, 6000, 1000)?.grossCents).toBe(9e15);
    expect(shopSplit(89_999_999_001, 100_000, 6000, 1000)).toBeNull();
    expect(consignmentSplit(89_999_999_001, 100_000)).toBeNull();
    expect(shopSplit(99_999_999_999_999, 100_000, 6000, 1000)).toBeNull();
    const big = { quantity: 1, grossCents: 5e15, brandCents: 3e15, shopCents: 2e15 };
    expect(shopTotals([big, big])).toBeNull();
  });
  it.each([
    [-1, 1, 6000, 1000],
    [1.5, 1, 6000, 1000],
    [100, 0, 6000, 1000],
    [100, 100001, 6000, 1000],
    [100, 1, 10001, 1000],
    [100, 1, 6000, 100_000_001],
    [100, 1, -1, 1000],
  ])("rifiuta valori fuori dai limiti (%s, %s, %s, %s)", (web, quantity, bps, markup) =>
    expect(shopSplit(web, quantity, bps, markup)).toBeNull(),
  );
});

describe("parseShopCommand", () => {
  it("accetta i dieci comandi esatti", () => {
    expect(builders).toHaveLength(10);
    expect(new Set(builders.map((b) => b().kind))).toEqual(new Set(SHOP_COMMAND_KINDS));
    for (const build of builders) expect(parseShopCommand(build())).toEqual(build());
  });
  it("solo negozi, fatture e pagamenti chiedono Finance", () => {
    expect(SHOP_COMMAND_KINDS.filter(isFinanceShopCommand)).toEqual([
      "save_consignment_shop",
      "set_consignment_invoice",
      "record_consignment_payment",
      "update_consignment_payment",
    ]);
  });
  it.each(builders.map((b) => [b().kind, b] as const))(
    "%s: rifiuta chiavi in più, versione dello schema e tipo sconosciuto",
    (_, build) => {
      expect(parseShopCommand({ ...build(), extra: true })).toBeNull();
      expect(parseShopCommand(withPayload(build, { extra: 1 }))).toBeNull();
      expect(parseShopCommand(withPayload(build, { schema_version: 2 }))).toBeNull();
      expect(parseShopCommand({ ...build(), kind: "transfer_consignment_stock" })).toBeNull();
      expect(parseShopCommand({ ...build(), operationId: "non-un-uuid" })).toBeNull();
      expect(parseShopCommand({ ...build(), retry: "sì" })).toBeNull();
      expect(parseShopCommand({ ...build(), retry: true })).toMatchObject({ retry: true });
      const { payload } = build();
      const missing = { ...payload };
      delete missing[Object.keys(payload)[1]];
      expect(parseShopCommand({ ...build(), payload: missing })).toBeNull();
    },
  );
  it("UUID in minuscolo e righe ordinate per articolo", () => {
    const a = item("GT3RS", "Blu", "M"),
      b = item("GT3RS", "Blu", "S");
    const parsed = parseShopCommand({
      ...withPayload(shopCommands.order, {
        location_id: sx.shop.toUpperCase(),
        lines: [line(a.toUpperCase(), 2), line(b, 1)],
      }),
      operationId: sx.operation.toUpperCase(),
    });
    expect(parsed?.operationId).toBe(sx.operation);
    expect(parsed?.payload).toMatchObject({
      location_id: sx.shop,
      lines: [line(b, 1), line(a, 2)].sort((x, y) => (x.stock_item_id < y.stock_item_id ? -1 : 1)),
    });
    expect(parsed && shopCommandItems(parsed)).toHaveLength(2);
  });
  it("righe doppie (anche in maiuscolo), 201 righe e righe vuote rifiutate", () => {
    const a = item("GT3RS", "Blu", "M");
    expect(
      parseShopCommand(
        withPayload(shopCommands.order, { lines: [line(a), line(a.toUpperCase())] }),
      ),
    ).toBeNull();
    const many = (n: number) => Array.from({ length: n }, (_, i) => line(sid(1000 + i)));
    expect(parseShopCommand(withPayload(shopCommands.order, { lines: many(200) }))).not.toBeNull();
    expect(parseShopCommand(withPayload(shopCommands.order, { lines: many(201) }))).toBeNull();
    expect(parseShopCommand(withPayload(shopCommands.order, { lines: [] }))).toBeNull();
    expect(parseShopCommand(withPayload(shopCommands.count, { lines: [] }))).toBeNull();
    expect(parseShopCommand(withPayload(shopCommands.report, { lines: [] }))).toMatchObject({
      payload: { lines: [] },
    });
  });
  it.each([0, -1, 1.5, 100001, "2", null])("quantità d'ordine non valida: %s", (quantity) =>
    expect(
      parseShopCommand(
        withPayload(shopCommands.order, { lines: [{ stock_item_id: sid(1), quantity }] }),
      ),
    ).toBeNull(),
  );
  it("la conta ammette 0 e una quantità letta sconosciuta", () => {
    const lines = [{ stock_item_id: sid(1), quantity: 0, expected_quantity: null }];
    expect(parseShopCommand(withPayload(shopCommands.count, { lines }))).not.toBeNull();
    for (const bad of [
      [{ stock_item_id: sid(1), quantity: 100001, expected_quantity: null }],
      [{ stock_item_id: sid(1), quantity: 1, expected_quantity: -1 }],
      [{ stock_item_id: sid(1), quantity: 1 }],
    ])
      expect(parseShopCommand(withPayload(shopCommands.count, { lines: bad }))).toBeNull();
  });
  it.each(["2026-1", "2026-13", "2026-00", "1999-10", "2026-10-01", 202610])(
    "mese non valido: %s",
    (period_month) =>
      expect(parseShopCommand(withPayload(shopCommands.report, { period_month }))).toBeNull(),
  );
  it("prezzo obbligatorio alla creazione, vietato con 0 pezzi, facoltativo in modifica", () => {
    const report = shopCommands.report(),
      [first] = report.payload.lines;
    const lines = (over: Record<string, unknown>) => [{ ...first, ...over }];
    expect(
      parseShopCommand(withPayload(shopCommands.report, { lines: lines({ price: null }) })),
    ).toBeNull();
    expect(
      parseShopCommand(withPayload(shopCommands.report, { lines: lines({ quantity: 0 }) })),
    ).toBeNull();
    expect(
      parseShopCommand(
        withPayload(shopCommands.report, { lines: lines({ quantity: 0, price: null }) }),
      ),
    ).not.toBeNull();
    const edit = { expected_revision: 1, reason: "Il negozio ha corretto" };
    expect(
      parseShopCommand(
        withPayload(shopCommands.report, { ...edit, lines: lines({ price: null }) }),
      ),
    ).not.toBeNull();
    expect(
      parseShopCommand(withPayload(shopCommands.report, { ...edit, lines: lines({}) })),
    ).not.toBeNull();
  });
  it.each([
    { shop_domain: "synthetic.example.test" },
    { variant_gid: "gid://shopify/Product/1" },
    { expected_web_price_cents: -1 },
    { expected_catalog_observed_at: "2026-10-01" },
    { extra: true },
  ])("prezzo malformato rifiutato: %o", (over) => {
    const report = shopCommands.report(),
      [first] = report.payload.lines;
    expect(
      parseShopCommand(
        withPayload(shopCommands.report, {
          lines: [{ ...first, price: { ...first.price, ...over } }],
        }),
      ),
    ).toBeNull();
  });
  it("«prima della conta» non supera i venduti; il motivo serve in modifica", () => {
    const report = shopCommands.report(),
      [first] = report.payload.lines;
    expect(
      parseShopCommand(
        withPayload(shopCommands.report, { lines: [{ ...first, before_count_quantity: 3 }] }),
      ),
    ).toBeNull();
    expect(
      parseShopCommand(
        withPayload(shopCommands.report, { lines: [{ ...first, before_count_quantity: 2 }] }),
      ),
    ).not.toBeNull();
    expect(parseShopCommand(withPayload(shopCommands.report, { expected_revision: 2 }))).toBeNull();
    expect(
      parseShopCommand(withPayload(shopCommands.report, { expected_revision: 2, reason: "  no " })),
    ).toBeNull();
    expect(
      parseShopCommand(
        withPayload(shopCommands.report, { expected_revision: 2, reason: " Giusto " }),
      ),
    ).toMatchObject({ payload: { reason: "Giusto" } });
  });
  it("negozio: creazione senza versione e solo attivo; magazzino diverso dal negozio", () => {
    expect(parseShopCommand(withPayload(shopCommands.shop, { expected_version: 1 }))).toBeNull();
    expect(parseShopCommand(withPayload(shopCommands.shop, { active: false }))).toBeNull();
    expect(
      parseShopCommand(
        withPayload(shopCommands.shop, {
          location_id: sx.shop,
          expected_version: 2,
          active: false,
        }),
      ),
    ).not.toBeNull();
    expect(
      parseShopCommand(
        withPayload(shopCommands.shop, {
          location_id: sx.shop,
          expected_version: 2,
          supply_location_id: sx.shop,
        }),
      ),
    ).toBeNull();
    for (const over of [
      { brand_share_bps: 10001 },
      { markup_cents: 100_000_001 },
      { name: "  ab " },
    ])
      expect(parseShopCommand(withPayload(shopCommands.shop, over))).toBeNull();
  });
  it("note: a capo ammesso, \\r\\n normalizzato, altri caratteri di controllo no", () => {
    expect(
      parseShopCommand(withPayload(shopCommands.shop, { note: "\n Riga uno\r\nRiga due \n" }))
        ?.payload,
    ).toMatchObject({ note: "Riga uno\nRiga due" });
    expect(parseShopCommand(withPayload(shopCommands.shop, { note: "a\tb" }))).toBeNull();
    expect(parseShopCommand(withPayload(shopCommands.shop, { note: "x".repeat(1001) }))).toBeNull();
  });
  it("fattura: numero e data insieme, giorno esistente; si può togliere", () => {
    expect(
      parseShopCommand(
        withPayload(shopCommands.invoice, { invoice_number: null, invoice_date: null }),
      ),
    ).not.toBeNull();
    expect(parseShopCommand(withPayload(shopCommands.invoice, { invoice_date: null }))).toBeNull();
    expect(
      parseShopCommand(withPayload(shopCommands.invoice, { invoice_number: null })),
    ).toBeNull();
    expect(
      parseShopCommand(withPayload(shopCommands.invoice, { invoice_date: "2026-02-30" })),
    ).toBeNull();
    expect(
      parseShopCommand(withPayload(shopCommands.invoice, { invoice_number: "x".repeat(61) })),
    ).toBeNull();
  });
  it("pagamenti: metodo, importo, conto facoltativo, annullo con motivo", () => {
    for (const over of [
      { method: "card" },
      { amount_cents: 0 },
      { amount_cents: 9e15 + 1 },
      { account_label: "" },
      { reference: " " },
      { paid_at: "2026-10-21" },
    ])
      expect(parseShopCommand(withPayload(shopCommands.payment, over))).toBeNull();
    expect(
      parseShopCommand(withPayload(shopCommands.payment, { account_label: null, method: "cash" })),
    ).not.toBeNull();
    expect(
      parseShopCommand(withPayload(shopCommands.paymentUpdate, { voided: true })),
    ).not.toBeNull();
    expect(
      parseShopCommand(withPayload(shopCommands.paymentUpdate, { voided: "true" })),
    ).toBeNull();
    expect(parseShopCommand(withPayload(shopCommands.paymentUpdate, { reason: "ok" }))).toBeNull();
  });
  it("ordini: nuovo senza versione, modifica con versione, giorno valido", () => {
    expect(parseShopCommand(withPayload(shopCommands.order, { expected_version: 1 }))).toBeNull();
    expect(
      parseShopCommand(
        withPayload(shopCommands.order, { order_id: sx.openOrder, expected_version: 2 }),
      ),
    ).not.toBeNull();
    expect(
      parseShopCommand(withPayload(shopCommands.order, { requested_on: "21/10/2026" })),
    ).toBeNull();
    expect(parseShopCommand(withPayload(shopCommands.close, { reason: "" }))).toBeNull();
    expect(parseShopCommand(withPayload(shopCommands.ship, { expected_version: 0 }))).toBeNull();
  });
  it("ordine nuovo da un riordine: chiave facoltativa restock_order_id, solo per gli ordini nuovi", () => {
    const restock = "95000000-0000-4000-8000-000000000902";
    const linked = parseShopCommand(
      withPayload(shopCommands.order, { restock_order_id: restock.toUpperCase() }),
    );
    expect(linked?.payload).toMatchObject({ restock_order_id: restock });
    // Senza la chiave il comando resta quello di prima, senza chiavi in più.
    expect(Object.keys(parseShopCommand(shopCommands.order())!.payload)).not.toContain(
      "restock_order_id",
    );
    expect(parseShopCommand(withPayload(shopCommands.order, { restock_order_id: "x" }))).toBeNull();
    expect(
      parseShopCommand(withPayload(shopCommands.order, { restock_order_id: null })),
    ).toBeNull();
    expect(
      parseShopCommand(
        withPayload(shopCommands.order, {
          order_id: sx.openOrder,
          expected_version: 2,
          restock_order_id: restock,
        }),
      ),
    ).toBeNull();
    expect(
      parseShopCommand(withPayload(shopCommands.ship, { restock_order_id: restock })),
    ).toBeNull();
  });
  it("istanti con fuso e date al cambio dell'ora", () => {
    expect(
      parseShopCommand(
        withPayload(shopCommands.count, { counted_at: "2026-10-25T02:30:00+01:00" }),
      ),
    ).not.toBeNull();
    expect(
      parseShopCommand(withPayload(shopCommands.count, { counted_at: "2026-10-25T02:30:00" })),
    ).toBeNull();
  });
});

describe("mesi a Roma", () => {
  it("limiti del mese ai cambi dell'ora", () => {
    expect(romeMonthBounds("2026-03")).toEqual({
      month: "2026-03",
      start: "2026-02-28T23:00:00.000Z",
      end: "2026-03-31T22:00:00.000Z",
    });
    expect(romeMonthBounds("2026-10")).toEqual({
      month: "2026-10",
      start: "2026-09-30T22:00:00.000Z",
      end: "2026-10-31T23:00:00.000Z",
    });
    expect(() => romeMonthBounds("2026-13")).toThrow();
  });
  it("il mese è quello di Roma, non del server", () => {
    expect(romeMonth("2026-10-31T22:59:59Z")).toBe("2026-10");
    expect(romeMonth("2026-10-31T23:00:00Z")).toBe("2026-11");
    expect(romeMonth("2026-09-30T22:00:00Z")).toBe("2026-10");
  });
  it("etichette e aritmetica dei mesi", () => {
    expect(monthLabel("2026-10")).toBe("ottobre 2026");
    expect(monthName("2026-09")).toBe("settembre");
    expect(monthShort("2026-12", "2027-01-10T10:00:00Z")).toBe("dicembre 2026");
    expect(monthShort("2026-12", "2026-12-10T10:00:00Z")).toBe("dicembre");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthsBetween("2026-11", "2027-02")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
    expect(monthsBetween("2026-11", "2026-10")).toEqual([]);
    expect(periodMonth("2026-10")).toBe("2026-10");
    expect(calendarDay("2026-02-29")).toBe(false);
    expect(calendarDay("2028-02-29")).toBe(true);
    expect(dayLabel("2026-11-03")).toBe("3 novembre 2026");
  });
});

describe("testi e campi", () => {
  it("condizioni del negozio", () => {
    expect(shopTermsLabel({ markupCents: 1000, brandShareBps: 6000 })).toBe(
      "Prezzo sito + 10 € · LuckyLap 60%",
    );
    expect(bpsLabel(6050)).toBe("60,5%");
    expect(bpsLabel(3333)).toBe("33,33%");
    expect(euroShort(1050)).toBe("10,50 €");
    expect(percentToBps("60")).toBe(6000);
    expect(percentToBps("60,5")).toBe(6050);
    expect(percentToBps("33.33 %")).toBe(3333);
    for (const bad of ["101", "-1", "60,555", "", "sessanta"]) expect(percentToBps(bad)).toBeNull();
  });
  it("pezzi, magliette e stato del resoconto", () => {
    expect(tshirtsLabel(1)).toBe("1 maglietta");
    expect(tshirtsLabel(12345)).toBe("12.345 magliette");
    expect(piecesLabel(12)).toBe("12 pezzi");
    expect(reportStatusLabel({ brandCents: 100, invoice: null, paymentState: "unpaid" })).toBe(
      "Da fatturare",
    );
    expect(reportStatusLabel({ brandCents: 100, invoice: {}, paymentState: "unpaid" })).toBe(
      "Da pagare",
    );
    expect(reportStatusLabel({ brandCents: 0, invoice: null, paymentState: "nothing_due" })).toBe(
      "Niente da fatturare",
    );
    expect(reportStatusLabel({ brandCents: 100, invoice: null, paymentState: "paid" })).toBe(
      "Pagata",
    );
  });
  it("stato del pagamento come il database", () => {
    expect(paymentStateFor(0, 0)).toBe("nothing_due");
    expect(paymentStateFor(0, 10)).toBe("unpaid");
    expect(paymentStateFor(5, 10)).toBe("partial");
    expect(paymentStateFor(10, 10)).toBe("paid");
    expect(paymentStateFor(11, 10)).toBe("overpaid");
    expect(paymentStateFor(1, 0)).toBe("overpaid");
  });
  it("celle numeriche", () => {
    expect(quantityField("", 0)).toBe(0);
    expect(quantityField("  ", null)).toBeNull();
    expect(quantityField(" 3 ", null)).toBe(3);
    for (const bad of ["1.5", "-1", "100001", "1e3", "tre"])
      expect(quantityField(bad, 0)).toBeNull();
  });
});

describe("tentativo in sospeso", () => {
  const storage = (value: string | null) => ({ getItem: () => value });
  it("chiave per persona e lettura del comando congelato", () => {
    expect(shopPendingKey(sx.user)).toBe(`luckylap.consignment.shop.pending:${sx.user}`);
    expect(shopPending(storage(null), sx.user)).toBeNull();
    expect(shopPending(storage(JSON.stringify(shopCommands.count())), sx.user)).toEqual(
      shopCommands.count(),
    );
    expect(() => shopPending(storage("{"), sx.user)).toThrow("Invio non leggibile.");
    expect(() => shopPending(storage(JSON.stringify({ kind: "x" })), sx.user)).toThrow(
      "Invio non leggibile.",
    );
  });
  it("riepilogo leggibile: nomi e euro, mai UUID, gid o centesimi", () => {
    const label = (id: string) => (id === item("GT3RS", "Blu", "M") ? "GT3RS Blu M" : null);
    for (const build of builders) {
      const summary = shopAttemptSummary(parseShopCommand(build())!, label),
        text = [summary.title, ...summary.lines].join("\n");
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|gid:\/\/|centesim|_cents/i);
      expect(summary.title).toMatch(/verificare$/);
    }
    const report = shopAttemptSummary(parseShopCommand(shopCommands.report())!, label);
    expect(report).toEqual({
      title: "Resoconto di ottobre 2026 da verificare",
      lines: ["GT3RS Blu M · 2 venduti"],
    });
    expect(shopAttemptSummary(parseShopCommand(shopCommands.payment())!, label).lines).toEqual([
      "84,99 € · Bonifico",
      "Conto: Conto sintetico",
    ]);
  });
});

describe("parole dell'interfaccia", () => {
  it("nessuna parola vietata nei moduli del conto vendita", () => {
    for (const file of [
      "shop-model.ts",
      "shop-read.ts",
      "shop-server.ts",
      "shop-finance.ts",
      "shop-fixtures.ts",
      "links.ts",
    ]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(
        /affido|rientro|vendita dichiarata|regolament|credito commerciale/i,
      );
    }
  });
});
