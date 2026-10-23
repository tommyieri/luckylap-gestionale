import { item, previewCatalogRows, sid, sx } from "../consignment/shop-fixtures";
import {
  restockCatalogFromRows,
  restockDataFromRows,
  incomingByItem,
  type RestockCoreRows,
  type RestockData,
  type RestockPage,
} from "./read";

/*
 * Dati sintetici del riassortimento, per i test e per l'anteprima locale: lo stesso catalogo
 * sintetico del conto vendita («Negozio sintetico», S–XL), nessun dato reale. Righe nella forma
 * del database, così passano dalle stesse letture delle pagine vere.
 */

export const rx = {
  discussion: sid(900),
  quality: sid(901),
  arrived: sid(902),
  delivered: sid(903),
  arrival: sid(910),
  oldArrival: sid(911),
  deliveredArrival: sid(912),
  shopOrder: sid(920),
  requirement: sid(930),
  saleLine: sid(931),
};
const GT3RS = sid(20),
  P964 = sid(21),
  F40 = sid(22);

const order = (over: Record<string, unknown> & { id: string; title: string; state: string }) => ({
  notes: "",
  state_changed_at: "2026-10-22T09:00:00+00:00",
  state_changed_by: sx.user,
  warehouse_location_id: sx.central,
  shop_location_id: sx.shop,
  shop_done_at: null,
  shop_done_by: null,
  version: 4,
  created_by: sx.user,
  created_at: "2026-10-20T09:00:00+00:00",
  updated_at: "2026-10-22T09:00:00+00:00",
  ...over,
});
let lineNumber = 940;
const line = (
  orderId: string,
  destination: "warehouse" | "shop" | "customer",
  productId: string,
  model: string,
  color: string,
  size: string,
  quantity: number,
) => ({
  id: sid(lineNumber++),
  order_id: orderId,
  destination,
  product_id: productId,
  color,
  size,
  stock_item_id: size === "XXXL" ? null : item(model, color, size),
  quantity,
});
const event = (
  n: number,
  orderId: string,
  from: string | null,
  to: string,
  at: string,
  note = "",
  by = sx.user,
) => ({
  id: sid(n),
  order_id: orderId,
  from_state: from,
  to_state: to,
  note,
  created_by: by,
  created_at: at,
});

function coreRows(): RestockCoreRows {
  lineNumber = 940;
  const catalog = previewCatalogRows();
  return {
    settings: { stock_adjustments_enabled: true },
    orders: [
      order({
        id: rx.discussion,
        title: "Riordine di novembre",
        state: "discussion",
        notes: "Da decidere entro venerdì: guardiamo le taglie sotto obiettivo.",
        state_changed_at: "2026-10-22T09:00:00+00:00",
        version: 2,
      }),
      order({
        id: rx.quality,
        title: "Riordine sintetico di ottobre",
        state: "quality",
        notes:
          "Le XXXL sono di un cliente: non vanno in magazzino. GT3RS Blu +1 su S-M-L per sicurezza.",
        state_changed_at: "2026-10-21T15:30:00+00:00",
        state_changed_by: sx.colleague,
        version: 6,
      }),
      order({
        id: rx.arrived,
        title: "Pezzi arrivati da Antonella",
        state: "in_hand",
        state_changed_at: "2026-10-23T08:15:00+00:00",
        version: 7,
      }),
      order({
        id: rx.delivered,
        title: "Riordine di settembre",
        state: "in_hand",
        state_changed_at: "2026-10-05T10:00:00+00:00",
        version: 5,
      }),
    ],
    lines: [
      line(rx.discussion, "warehouse", GT3RS, "GT3RS", "Blu", "M", 2),
      line(rx.discussion, "warehouse", GT3RS, "GT3RS", "Blu", "XL", 1),
      line(rx.discussion, "shop", GT3RS, "GT3RS", "Blu", "S", 2),
      line(rx.discussion, "customer", GT3RS, "GT3RS", "Bianco", "XXXL", 1),
      line(rx.quality, "warehouse", GT3RS, "GT3RS", "Blu", "S", 3),
      line(rx.quality, "warehouse", GT3RS, "GT3RS", "Blu", "M", 4),
      line(rx.quality, "warehouse", GT3RS, "GT3RS", "Blu", "L", 4),
      line(rx.quality, "warehouse", GT3RS, "GT3RS", "Bianco", "XS", 1),
      line(rx.quality, "warehouse", GT3RS, "GT3RS", "Bianco", "M", 2),
      line(rx.quality, "warehouse", P964, "964", "Bianco", "L", 3),
      line(rx.quality, "warehouse", F40, "F40", "Rosso", "L", 5),
      line(rx.quality, "shop", GT3RS, "GT3RS", "Bianco", "S", 2),
      line(rx.quality, "shop", GT3RS, "GT3RS", "Bianco", "M", 2),
      line(rx.quality, "shop", GT3RS, "GT3RS", "Bianco", "L", 2),
      line(rx.quality, "shop", GT3RS, "GT3RS", "Bianco", "XL", 2),
      line(rx.quality, "shop", P964, "964", "Bianco", "XL", 1),
      line(rx.quality, "customer", GT3RS, "GT3RS", "Blu", "XXXL", 1),
      line(rx.quality, "customer", P964, "964", "Bianco", "XXXL", 1),
      line(rx.arrived, "warehouse", F40, "F40", "Rosso", "M", 3),
      line(rx.arrived, "warehouse", P964, "964", "Bianco", "S", 2),
      line(rx.arrived, "shop", F40, "F40", "Rosso", "M", 2),
      line(rx.arrived, "shop", GT3RS, "GT3RS", "Blu", "S", 1),
      line(rx.delivered, "warehouse", GT3RS, "GT3RS", "Blu", "L", 2),
      line(rx.delivered, "shop", GT3RS, "GT3RS", "Blu", "M", 1),
    ],
    events: [
      event(960, rx.discussion, null, "discussion", "2026-10-22T09:00:00+00:00"),
      event(961, rx.quality, null, "discussion", "2026-10-10T09:00:00+00:00"),
      event(
        962,
        rx.quality,
        "discussion",
        "supplier",
        "2026-10-12T09:00:00+00:00",
        "Ordinate a Marco",
      ),
      event(963, rx.quality, "supplier", "embroiderer", "2026-10-17T11:00:00+00:00"),
      event(
        964,
        rx.quality,
        "embroiderer",
        "quality",
        "2026-10-21T15:30:00+00:00",
        "Etichette e cartellini da Antonella",
        sx.colleague,
      ),
      event(965, rx.arrived, null, "discussion", "2026-10-01T09:00:00+00:00"),
      event(966, rx.arrived, "discussion", "quality", "2026-10-15T09:00:00+00:00"),
      event(967, rx.arrived, "quality", "in_hand", "2026-10-23T08:15:00+00:00", "Contate tutte"),
      event(968, rx.delivered, null, "discussion", "2026-09-01T09:00:00+00:00"),
      event(969, rx.delivered, "discussion", "in_hand", "2026-10-05T10:00:00+00:00"),
    ],
    arrivals: [
      {
        id: rx.arrival,
        order_id: rx.arrived,
        location_id: sx.central,
        previous_state: "quality",
        pieces: 8,
        warehouse_pieces: 5,
        shop_pieces: 3,
        customer_pieces: 0,
        created_by: sx.user,
        created_at: "2026-10-23T08:15:00+00:00",
        undone_at: null,
        undone_by: null,
      },
      {
        id: rx.deliveredArrival,
        order_id: rx.delivered,
        location_id: sx.central,
        previous_state: "discussion",
        pieces: 3,
        warehouse_pieces: 2,
        shop_pieces: 1,
        customer_pieces: 0,
        created_by: sx.colleague,
        created_at: "2026-10-05T10:00:00+00:00",
        undone_at: null,
        undone_by: null,
      },
    ],
    shopOrders: [
      {
        id: rx.shopOrder,
        location_id: sx.shop,
        order_number: 2,
        status: "delivered",
        restock_order_id: rx.delivered,
      },
    ],
    shopOrderLines: [
      {
        id: sid(921),
        order_id: rx.shopOrder,
        stock_item_id: item("GT3RS", "Blu", "M"),
        quantity: 1,
        delivered_quantity: 1,
        cancelled_quantity: 0,
      },
    ],
    locations: catalog.locations,
    shops: catalog.shops,
    profiles: catalog.profiles,
  };
}

/** Giacenze sintetiche del magazzino: qualche taglia sotto l'obiettivo di 3. */
const STOCK_BY_SIZE: Record<string, number> = { XS: 0, S: 1, M: 2, L: 4, XL: 3, XXL: 1 };
function catalogRows() {
  const catalog = previewCatalogRows();
  const variants = catalog.variants as {
    stock_item_id: string;
    product_id: string;
    color: string;
    size: string;
  }[];
  const tshirtIds = new Set(variants.map((v) => v.stock_item_id));
  return {
    products: catalog.products,
    items: catalog.items,
    variants: variants.map((v) => ({
      ...v,
      central_target_quantity: v.size === "UNICA" ? null : 3,
    })),
    availability: catalog.central
      .filter((row) => tshirtIds.has(row.stock_item_id))
      .map((row) => {
        const variant = variants.find((v) => v.stock_item_id === row.stock_item_id)!;
        const onHand = variant.size === "UNICA" ? 7 : (STOCK_BY_SIZE[variant.size] ?? 2);
        return { ...row, on_hand: onHand, reserved: 0, available: onHand };
      }),
    requirements: [
      {
        id: rx.requirement,
        order_line_id: rx.saleLine,
        required_quantity: 2,
        completed_quantity: 0,
        cancelled_quantity: 0,
        status: "to_plan",
      },
    ],
    requirementLines: [{ id: rx.saleLine, stock_item_id: item("GT3RS", "Bianco", "S") }],
  };
}

/** Anteprima locale: tutti i riordini sintetici. */
export const previewRestockData = (): RestockData => restockDataFromRows(coreRows());
/** Anteprima locale: pagina di un riordine sintetico, `null` se non esiste. */
export function previewRestockPage(orderId: unknown): RestockPage | null {
  const data = previewRestockData();
  const found = data.orders.find((o) => o.id === orderId);
  if (!found) return null;
  return {
    data,
    order: found,
    catalog: restockCatalogFromRows(catalogRows(), found.warehouse.id),
    incoming: incomingByItem(data.orders, found.id),
  };
}
export { coreRows as restockCoreRows, catalogRows as restockCatalogRows };
