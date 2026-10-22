import {
  shopPageFromRows,
  shopsFromRows,
  type ShopList,
  type ShopListRows,
  type ShopPage,
  type ShopPageRows,
} from "./shop-read";
import { shopCode } from "./links";

/*
 * Dati sintetici del conto vendita, per i test e per l'anteprima locale
 * (§1.5): «Negozio sintetico», `synthetic.myshopify.com`, nessun dato reale.
 * Righe nella forma del database, così passano dalle stesse letture.
 */

export const sid = (n: number) => `94000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const sx = {
  user: sid(1),
  colleague: sid(2),
  operation: sid(9),
  central: sid(10),
  shop: sid(11),
  shop2: sid(12),
  closedShop: sid(13),
  external: sid(14),
  september: sid(300),
  closedReport: sid(301),
  payment: sid(400),
  voidedPayment: sid(401),
  closedPayment: sid(402),
  firstCount: sid(500),
  correction: sid(501),
  deliveredOrder: sid(600),
  openOrder: sid(601),
  domain: "synthetic.myshopify.com",
  startedAt: "2026-08-31T22:00:00+00:00",
  observedAt: "2026-10-01T08:00:00+00:00",
};

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const RANGES = [
  { model: "GT3RS", product: sid(20), color: "Blu", code: "BLU", price: 4500 },
  { model: "GT3RS", product: sid(20), color: "Bianco", code: "BIA", price: 4500 },
  { model: "964", product: sid(21), color: "Bianco", code: "BIA", price: 4999 },
  { model: "F40", product: sid(22), color: "Rosso", code: "ROS", price: 5500 },
];
/** T-shirt sintetiche: `item("GT3RS", "Blu", "M")` → id. */
export function item(model: string, color: string, size: string): string {
  const range = RANGES.findIndex((r) => r.model === model && r.color === color),
    index = SIZES.indexOf(size);
  if (range < 0 || index < 0) throw Error("Maglietta sintetica sconosciuta.");
  return sid(100 + range * 6 + index);
}
export const cap = sid(124);
const tshirts = RANGES.flatMap((range, r) =>
  SIZES.map((size, s) => ({
    id: sid(100 + r * 6 + s),
    sku: `SYN-${range.model}-${range.code}-${size}`,
    model: range.model,
    product: range.product,
    color: range.color,
    size,
    price: range.price,
    gid: `gid://shopify/ProductVariant/${1000 + r * 6 + s}`,
    // F40 Rosso XXL è disattivata; 964 Bianco XXL non ha prezzo nel catalogo.
    active: !(range.model === "F40" && size === "XXL"),
    priced:
      !(range.model === "964" && size === "XXL") && !(range.model === "F40" && size === "XXL"),
  })),
);

const settings = () => ({
  stock_adjustments_enabled: true,
  manual_sales_enabled: true,
  sales_started_at: sx.startedAt,
});
const locations = () => [
  {
    id: sx.central,
    code: "MAG01",
    name: "Magazzino sintetico",
    active: true,
    location_type: "Magazzino",
  },
  {
    id: sx.shop,
    code: "NEG01",
    name: "Negozio sintetico",
    active: true,
    location_type: "Negozio Conto Vendita",
  },
  {
    id: sx.shop2,
    code: "NEG02",
    name: "Secondo negozio sintetico",
    active: true,
    location_type: "Negozio Conto Vendita",
  },
  {
    id: sx.closedShop,
    code: "NEG03",
    name: "Negozio sintetico chiuso",
    active: false,
    location_type: "Negozio Conto Vendita",
  },
  {
    id: sx.external,
    code: "FORN",
    name: "Fornitore sintetico",
    active: true,
    location_type: "Esterno",
  },
];
const shops = () => [
  {
    location_id: sx.shop,
    supply_location_id: sx.central,
    brand_share_bps: 6000,
    markup_cents: 1000,
    first_counted_at: "2026-09-02T09:00:00+00:00",
    note: "",
    version: 1,
    created_by: null,
    created_at: "2026-08-20T10:00:00+00:00",
  },
  {
    location_id: sx.shop2,
    supply_location_id: sx.central,
    brand_share_bps: 5500,
    markup_cents: 500,
    first_counted_at: null,
    note: "Condizioni sintetiche",
    version: 1,
    created_by: sx.user,
    created_at: "2026-10-15T10:00:00+00:00",
  },
  {
    location_id: sx.closedShop,
    supply_location_id: sx.central,
    brand_share_bps: 6000,
    markup_cents: 1000,
    first_counted_at: "2026-09-03T09:00:00+00:00",
    note: "",
    version: 3,
    created_by: sx.user,
    created_at: "2026-09-01T10:00:00+00:00",
  },
];

const availability = (
  stock_item_id: string,
  location_id: string,
  on_hand: number | null,
  reserved = 0,
) => ({
  stock_item_id,
  location_id,
  on_hand,
  reserved,
  available: on_hand === null ? null : on_hand - reserved,
});
/** In negozio: GT3RS Blu M 5, GT3RS Blu L 2, 964 Bianco L 1; GT3RS Bianco XS senza saldo (vale 0). */
const shopStock = () =>
  tshirts
    .filter((t) => t.id !== item("GT3RS", "Bianco", "XS"))
    .map((t) =>
      availability(
        t.id,
        sx.shop,
        t.id === item("GT3RS", "Blu", "M")
          ? 5
          : t.id === item("GT3RS", "Blu", "L")
            ? 2
            : t.id === item("964", "Bianco", "L")
              ? 1
              : 0,
      ),
    );
/** Magazzino: GT3RS Blu M 2 con 1 riservata, F40 Rosso L esaurita, il resto 10; più un cappellino. */
const centralStock = () => [
  ...tshirts.map((t) =>
    t.id === item("GT3RS", "Blu", "M")
      ? availability(t.id, sx.central, 2, 1)
      : availability(t.id, sx.central, t.id === item("F40", "Rosso", "L") ? 0 : 10),
  ),
  availability(cap, sx.central, 7),
];

const reportHead = (over: Record<string, unknown> & { location_id: string }) => ({
  revision: 1,
  brand_share_bps: 6000,
  markup_cents: 1000,
  invoice_number: null,
  invoice_date: null,
  invoice_revision: null,
  created_at: "2026-10-01T09:00:00+00:00",
  updated_at: "2026-10-01T09:00:00+00:00",
  ...over,
});
const reports = () => [
  reportHead({
    id: sx.september,
    location_id: sx.shop,
    period_month: "2026-09-01",
    revision: 3,
    pieces: 4,
    gross_cents: 22499,
    brand_cents: 13499,
    shop_cents: 9000,
    invoice_number: "12",
    invoice_date: "2026-10-03",
    invoice_revision: 3,
    payment_state: "partial",
    updated_at: "2026-10-03T09:00:00+00:00",
  }),
  reportHead({
    id: sx.closedReport,
    location_id: sx.closedShop,
    period_month: "2026-09-01",
    pieces: 1,
    gross_cents: 5500,
    brand_cents: 3300,
    shop_cents: 2200,
    invoice_number: "9",
    invoice_date: "2026-10-02",
    invoice_revision: 1,
    payment_state: "paid",
  }),
];
const reportLine = (
  n: number,
  report: string,
  location: string,
  itemId: string,
  quantity: number,
  gross: number,
  brand: number,
) => {
  const t = tshirts.find((x) => x.id === itemId)!;
  return {
    id: sid(n),
    report_id: report,
    location_id: location,
    stock_item_id: itemId,
    sku_snapshot: t.sku,
    quantity,
    before_count_quantity: 0,
    shop_domain: sx.domain,
    variant_gid: t.gid,
    catalog_observed_at: sx.observedAt,
    web_price_cents: t.price,
    markup_cents: 1000,
    brand_share_bps: 6000,
    unit_shop_price_cents: t.price + 1000,
    gross_cents: gross,
    brand_cents: brand,
    shop_cents: gross - brand,
    unit_cost_cents: 1320,
    priced_at: "2026-10-01T09:00:00+00:00",
  };
};
/** Settembre: GT3RS Blu M 3 × 55,00 € e 964 Bianco L 1 × 59,99 € → 224,99 €, da fatturare 134,99 €. */
const reportLines = () => [
  reportLine(310, sx.september, sx.shop, item("GT3RS", "Blu", "M"), 3, 16500, 9900),
  reportLine(311, sx.september, sx.shop, item("964", "Bianco", "L"), 1, 5999, 3599),
  reportLine(312, sx.closedReport, sx.closedShop, item("GT3RS", "Bianco", "S"), 1, 5500, 3300),
];
const snapshot = (pieces: number, brand: number, invoice: string | null) => ({
  period_month: "2026-09",
  pieces,
  brand_cents: brand,
  invoice: invoice === null ? null : { number: invoice, date: "2026-10-03", revision: 3 },
  lines: [],
});
const reportRevisions = () => [
  {
    id: sid(320),
    report_id: sx.september,
    location_id: sx.shop,
    revision: 1,
    change_kind: "lines",
    reason: null,
    snapshot: snapshot(3, 10199, null),
    created_by: sx.user,
    created_at: "2026-10-01T09:00:00+00:00",
  },
  {
    id: sid(321),
    report_id: sx.september,
    location_id: sx.shop,
    revision: 2,
    change_kind: "lines",
    reason: "Il negozio ha corretto una taglia",
    snapshot: snapshot(4, 13499, null),
    created_by: sx.colleague,
    created_at: "2026-10-02T09:00:00+00:00",
  },
  {
    id: sid(322),
    report_id: sx.september,
    location_id: sx.shop,
    revision: 3,
    change_kind: "invoice",
    reason: null,
    snapshot: snapshot(4, 13499, "12"),
    created_by: sx.user,
    created_at: "2026-10-03T09:00:00+00:00",
  },
  {
    id: sid(323),
    report_id: sx.closedReport,
    location_id: sx.closedShop,
    revision: 1,
    change_kind: "lines",
    reason: null,
    snapshot: snapshot(1, 3300, null),
    created_by: sx.user,
    created_at: "2026-10-01T09:00:00+00:00",
  },
];
const payment = (
  id: string,
  report: string,
  location: string,
  amount: number,
  method: string,
  account: string | null,
  voided: boolean,
  version: number,
) => ({
  id,
  report_id: report,
  location_id: location,
  amount_cents: amount,
  paid_at: "2026-10-10T08:00:00+00:00",
  method,
  account_label: account,
  reference: account ? "Bonifico sintetico" : null,
  voided,
  version,
});
const payments = () => [
  payment(sx.payment, sx.september, sx.shop, 5000, "bank_transfer", "Conto sintetico", false, 1),
  payment(sx.voidedPayment, sx.september, sx.shop, 2000, "cash", null, true, 2),
  payment(sx.closedPayment, sx.closedReport, sx.closedShop, 3300, "cash", null, false, 1),
];
const paymentRevision = (
  n: number,
  paymentId: string,
  location: string,
  version: number,
  reason: string | null,
  amount: number,
  method: string,
  voided: boolean,
) => ({
  id: sid(n),
  payment_id: paymentId,
  location_id: location,
  version,
  reason,
  snapshot: {
    report_id: sx.september,
    amount_cents: amount,
    paid_at: "2026-10-10T08:00:00+00:00",
    method,
    account_label: null,
    reference: null,
    voided,
  },
  created_by: sx.user,
  created_at: "2026-10-10T08:05:00+00:00",
});
const paymentRevisions = () => [
  paymentRevision(410, sx.payment, sx.shop, 1, null, 5000, "bank_transfer", false),
  paymentRevision(411, sx.voidedPayment, sx.shop, 1, null, 2000, "cash", false),
  paymentRevision(412, sx.voidedPayment, sx.shop, 2, "Registrato due volte", 2000, "cash", true),
  paymentRevision(413, sx.closedPayment, sx.closedShop, 1, null, 3300, "cash", false),
];
const counts = () => [
  {
    id: sx.firstCount,
    location_id: sx.shop,
    counted_at: "2026-09-02T09:00:00+00:00",
    full_count: true,
    pieces: 20,
    note: "",
    created_by: sx.user,
  },
  {
    id: sx.correction,
    location_id: sx.shop,
    counted_at: "2026-10-10T09:00:00+00:00",
    full_count: false,
    pieces: 2,
    note: "Taglia L ricontata",
    created_by: sx.colleague,
  },
  {
    id: sid(502),
    location_id: sx.closedShop,
    counted_at: "2026-09-03T09:00:00+00:00",
    full_count: true,
    pieces: 1,
    note: "",
    created_by: sx.user,
  },
];
const orders = () => [
  {
    id: sx.deliveredOrder,
    location_id: sx.shop,
    order_number: 1,
    requested_on: "2026-09-15",
    note: "",
    status: "delivered",
    close_reason: null,
    version: 2,
    created_by: sx.user,
    created_at: "2026-09-15T09:00:00+00:00",
    updated_at: "2026-09-20T09:00:00+00:00",
  },
  {
    id: sx.openOrder,
    location_id: sx.shop,
    order_number: 2,
    requested_on: "2026-10-14",
    note: "Richiesta sintetica via messaggio",
    status: "open",
    close_reason: null,
    version: 2,
    created_by: sx.colleague,
    created_at: "2026-10-14T09:00:00+00:00",
    updated_at: "2026-10-16T09:00:00+00:00",
  },
];
const orderLine = (
  n: number,
  order: string,
  itemId: string,
  quantity: number,
  delivered: number,
) => ({
  id: sid(n),
  order_id: order,
  location_id: sx.shop,
  stock_item_id: itemId,
  quantity,
  delivered_quantity: delivered,
  cancelled_quantity: 0,
});
const orderLines = () => [
  orderLine(610, sx.deliveredOrder, item("GT3RS", "Blu", "M"), 4, 4),
  orderLine(611, sx.openOrder, item("GT3RS", "Blu", "M"), 3, 1),
  orderLine(612, sx.openOrder, item("F40", "Rosso", "L"), 3, 0),
];
const shipments = () => [
  {
    id: sid(700),
    location_id: sx.shop,
    direction: "to_shop",
    order_id: sx.deliveredOrder,
    occurred_at: "2026-09-20T09:00:00+00:00",
    reason: "Consegna al negozio, ordine n. 1",
    pieces: 4,
    created_by: sx.user,
  },
  {
    id: sid(701),
    location_id: sx.shop,
    direction: "to_shop",
    order_id: sx.openOrder,
    occurred_at: "2026-10-16T09:00:00+00:00",
    reason: "Consegna al negozio, ordine n. 2",
    pieces: 1,
    created_by: sx.colleague,
  },
  {
    id: sid(702),
    location_id: sx.shop,
    direction: "to_warehouse",
    order_id: null,
    occurred_at: "2026-10-18T09:00:00+00:00",
    reason: "Fine stagione sintetica",
    pieces: 2,
    created_by: sx.user,
  },
];
const profiles = () => [
  { user_id: sx.user, display_name: "Socio sintetico" },
  { user_id: sx.colleague, display_name: "Collega sintetica" },
];

/** Righe dell'elenco dei negozi. */
export function shopListRows(): ShopListRows {
  return {
    settings: settings(),
    shops: shops(),
    locations: locations(),
    availability: [
      ...shopStock(),
      availability(item("GT3RS", "Blu", "S"), sx.shop2, 0),
      availability(item("GT3RS", "Blu", "S"), sx.closedShop, 0),
    ],
    reports: reports(),
    openOrders: orders()
      .filter((o) => o.status === "open")
      .map((o) => ({
        id: o.id,
        location_id: o.location_id,
        order_number: o.order_number,
        status: o.status,
      })),
  };
}

/** Righe della pagina di un negozio (`NEG01` contato, `NEG02` da contare). */
export function shopPageRows(code = "NEG01", finance = true): ShopPageRows {
  const location = locations().find((l) => l.code === code);
  if (!location) throw Error("Negozio sintetico sconosciuto.");
  const own = <T extends { location_id: unknown }>(rows: T[]) =>
    rows.filter((r) => r.location_id === location.id);
  return {
    settings: settings(),
    locations: locations(),
    shop: shops().find((s) => s.location_id === location.id)!,
    items: [
      ...tshirts.map((t) => ({
        id: t.id,
        sku: t.sku,
        name: `T-shirt ${t.model} ${t.color} ${t.size}`,
        kind: "product",
        active: t.active,
        unit_cost_eur: 13.2,
      })),
      {
        id: cap,
        sku: "SYN-CAP-UNICA",
        name: "Cappellino sintetico",
        kind: "product",
        active: true,
        unit_cost_eur: null,
      },
    ],
    variants: [
      ...tshirts.map((t) => ({
        stock_item_id: t.id,
        product_id: t.product,
        color: t.color,
        size: t.size,
      })),
      { stock_item_id: cap, product_id: sid(23), color: "Nero", size: "UNICA" },
    ],
    products: [
      { id: sid(20), model: "GT3RS", category: "T-shirt" },
      { id: sid(21), model: "964", category: "T-shirt" },
      { id: sid(22), model: "F40", category: "T-shirt" },
      { id: sid(23), model: "Cappellino sintetico", category: "Cappellino" },
    ],
    catalog: tshirts
      .filter((t) => t.priced)
      .map((t) => ({
        shop_domain: sx.domain,
        variant_gid: t.gid,
        stock_item_id: t.id,
        sku: t.sku,
        status: "ACTIVE",
        currency_code: "EUR",
        price_cents: t.price,
        observed_at: sx.observedAt,
        product_type: "T-shirt",
      })),
    availability: [
      ...(location.id === sx.shop
        ? shopStock()
        : [availability(item("GT3RS", "Blu", "S"), location.id, 0)]),
      ...centralStock(),
    ],
    counts: own(counts()),
    reports: own(reports()),
    reportLines: own(reportLines()),
    reportRevisions: own(reportRevisions()),
    orders: own(orders()),
    orderLines: own(orderLines()),
    shipments: own(shipments()),
    profiles: profiles(),
    payments: finance ? own(payments()) : null,
    paymentRevisions: finance ? own(paymentRevisions()) : null,
  };
}

/** Righe del pannello Finance: tutti i resoconti, tutti i pagamenti, tutte le sedi. */
export function shopFinanceRows() {
  return {
    reports: reports(),
    payments: payments(),
    locations: locations(),
  };
}

/** Anteprima locale: elenco dei negozi sintetici. */
export const previewShopList = (now: Date = new Date()): ShopList =>
  shopsFromRows(shopListRows(), now, now.toISOString());
/** Anteprima locale: pagina di un negozio sintetico, `null` se il codice non esiste. */
export function previewShopPage(code: unknown): ShopPage | null {
  const wanted = shopCode(code);
  if (wanted !== "NEG01" && wanted !== "NEG02" && wanted !== "NEG03") return null;
  return shopPageFromRows(shopPageRows(wanted), new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Comandi sintetici, uno per tipo, già validi.

export const shopCommands = {
  shop: () => ({
    operationId: sx.operation,
    kind: "save_consignment_shop",
    payload: {
      schema_version: 1,
      location_id: null,
      expected_version: null,
      name: "Terzo negozio sintetico",
      brand_share_bps: 6000,
      markup_cents: 1000,
      supply_location_id: sx.central,
      note: "",
      active: true,
    },
  }),
  count: () => ({
    operationId: sx.operation,
    kind: "count_consignment_stock",
    payload: {
      schema_version: 1,
      location_id: sx.shop,
      counted_at: "2026-10-21T10:00:00.000Z",
      note: "",
      lines: [{ stock_item_id: item("GT3RS", "Blu", "M"), quantity: 4, expected_quantity: 5 }],
    },
  }),
  report: () => ({
    operationId: sx.operation,
    kind: "save_consignment_report",
    payload: {
      schema_version: 1,
      location_id: sx.shop,
      period_month: "2026-10",
      expected_revision: null,
      reason: null,
      lines: [
        {
          stock_item_id: item("GT3RS", "Blu", "M"),
          quantity: 2,
          before_count_quantity: 0,
          price: {
            shop_domain: sx.domain,
            variant_gid: "gid://shopify/ProductVariant/1002",
            expected_web_price_cents: 4500,
            expected_catalog_observed_at: sx.observedAt,
          },
        },
      ],
    },
  }),
  invoice: () => ({
    operationId: sx.operation,
    kind: "set_consignment_invoice",
    payload: {
      schema_version: 1,
      report_id: sx.september,
      expected_revision: 3,
      invoice_number: "13",
      invoice_date: "2026-10-20",
    },
  }),
  payment: () => ({
    operationId: sx.operation,
    kind: "record_consignment_payment",
    payload: {
      schema_version: 1,
      report_id: sx.september,
      amount_cents: 8499,
      paid_at: "2026-10-21T10:00:00.000Z",
      method: "bank_transfer",
      account_label: "Conto sintetico",
      reference: null,
    },
  }),
  paymentUpdate: () => ({
    operationId: sx.operation,
    kind: "update_consignment_payment",
    payload: {
      schema_version: 1,
      payment_id: sx.payment,
      expected_version: 1,
      amount_cents: 4000,
      paid_at: "2026-10-10T08:00:00.000Z",
      method: "bank_transfer",
      account_label: "Conto sintetico",
      reference: "Bonifico sintetico",
      voided: false,
      reason: "Importo corretto dal negozio",
    },
  }),
  order: () => ({
    operationId: sx.operation,
    kind: "save_consignment_order",
    payload: {
      schema_version: 1,
      order_id: null,
      expected_version: null,
      location_id: sx.shop,
      requested_on: "2026-10-21",
      note: "",
      lines: [{ stock_item_id: item("GT3RS", "Blu", "M"), quantity: 2 }],
    },
  }),
  ship: () => ({
    operationId: sx.operation,
    kind: "ship_consignment_order",
    payload: {
      schema_version: 1,
      order_id: sx.openOrder,
      expected_version: 2,
      occurred_at: "2026-10-21T10:00:00.000Z",
      lines: [{ stock_item_id: item("GT3RS", "Blu", "M"), quantity: 1 }],
    },
  }),
  close: () => ({
    operationId: sx.operation,
    kind: "close_consignment_order",
    payload: {
      schema_version: 1,
      order_id: sx.openOrder,
      expected_version: 2,
      reason: "Il negozio non le vuole più",
    },
  }),
  returned: () => ({
    operationId: sx.operation,
    kind: "return_consignment_stock",
    payload: {
      schema_version: 1,
      location_id: sx.shop,
      occurred_at: "2026-10-21T10:00:00.000Z",
      reason: "Fine stagione sintetica",
      lines: [{ stock_item_id: item("GT3RS", "Blu", "L"), quantity: 1 }],
    },
  }),
};
