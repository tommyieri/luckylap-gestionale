import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.verify }));
import {
  executeRestockCommand,
  readRestockList,
  readRestockOrder,
  readRestockPage,
  RESTOCK_MESSAGES,
} from "./server";
import { restockCatalogRows, restockCoreRows, rx } from "./fixtures";
import { item, sx } from "../consignment/shop-fixtures";

type Row = Record<string, unknown>;
type Reply = { data: unknown; error: unknown };
/** PostgREST in memoria: `eq`, `in`, `not is null`, cursore `gt`, ordine, limite, conteggio esatto. */
function fakeDb(tables: Record<string, Row[]>, rpcReply: Reply = { data: null, error: null }) {
  const calls: string[] = [];
  const db = {
    rpc: vi.fn().mockResolvedValue(rpcReply),
    from: vi.fn((table: string) => {
      calls.push(table);
      const filters: ((r: Row) => boolean)[] = [];
      let order: string | null = null,
        limit = Infinity;
      const run = () => {
        if (!(table in tables)) return { data: null, count: null, error: { code: "42P01" } };
        const rows = tables[table].filter((r) => filters.every((f) => f(r)));
        if (order) rows.sort((a, b) => (String(a[order!]) < String(b[order!]) ? -1 : 1));
        return { data: rows.slice(0, limit), count: rows.length, error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
        not: (c: string) => (filters.push((r) => r[c] !== null && r[c] !== undefined), q),
        gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), q),
        order: (c: string) => ((order = c), q),
        limit: (n: number) => ((limit = n), q),
        single: async () => {
          const { data } = run();
          return data?.length
            ? { data: data[0], error: null }
            : { data: null, error: { code: "PGRST116" } };
        },
        maybeSingle: async () => {
          const { data, error } = run();
          return { data: data?.[0] ?? null, error };
        },
        then: (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(run()).then(resolve, reject),
      };
      return q;
    }),
  };
  return { db, calls };
}
function tables(): Record<string, Row[]> {
  const core = restockCoreRows(),
    catalog = restockCatalogRows();
  return {
    app_settings: [{ id: true, ...(core.settings as Row) }],
    restock_orders: core.orders as Row[],
    restock_lines: core.lines as Row[],
    restock_state_events: core.events as Row[],
    restock_arrivals: core.arrivals as Row[],
    consignment_orders: [
      ...(core.shopOrders as Row[]),
      {
        id: sx.openOrder,
        location_id: sx.shop,
        order_number: 3,
        status: "open",
        restock_order_id: null,
      },
    ],
    consignment_order_lines: core.shopOrderLines as Row[],
    stock_locations: core.locations as Row[],
    consignment_shops: core.shops as Row[],
    profiles: core.profiles as Row[],
    products: catalog.products as Row[],
    product_variants: catalog.variants as Row[],
    stock_items: (catalog.items as Row[]).map((r) => ({ ...r, kind: "product" })),
    operational_stock_availability: catalog.availability as Row[],
    production_requirements: catalog.requirements as Row[],
    sales_order_lines: catalog.requirementLines as Row[],
  };
}
const member = { status: "member", member: { userId: sx.user, displayName: "Socio sintetico" } };
const op = "95000000-0000-4000-8000-000000000001";
const move = (over: Row = {}) => ({
  operationId: op,
  kind: "move_restock_order",
  payload: {
    schema_version: 1,
    order_id: rx.quality,
    expected_version: 6,
    state: "embroiderer",
    note: "",
  },
  ...over,
});
const reject = (message: string, code = "22023", details: string | null = null): Reply => ({
  data: null,
  error: { code, message, details },
});

beforeEach(() => {
  mocks.verify.mockReset();
  mocks.verify.mockResolvedValue(member);
});

describe("letture", () => {
  it("elenco e pagina dal database, con il client della persona", async () => {
    const { db } = fakeDb(tables());
    const list = await readRestockList(db as never);
    expect(list.data.orders).toHaveLength(4);
    const read = await readRestockPage(db as never, rx.discussion.toUpperCase());
    expect(read.status).toBe("ready");
    if (read.status !== "ready") return;
    expect(read.page.order.id).toBe(rx.discussion);
    expect(
      read.page.catalog.variants.find((v) => v.itemId === item("GT3RS", "Bianco", "S"))?.toProduce,
    ).toBe(2);
    expect(read.page.incoming[item("GT3RS", "Blu", "M")]).toBe(4);
    expect(await readRestockPage(db as never, "non-un-id")).toEqual({ status: "not_found" });
    expect(await readRestockPage(db as never, sx.user)).toEqual({ status: "not_found" });
    expect((await readRestockOrder(db as never, rx.arrived))?.title).toBe(
      "Pezzi arrivati da Antonella",
    );
    expect(await readRestockOrder(db as never, "x")).toBeNull();
  });

  it("una tabella che non risponde fa fallire tutta la lettura", async () => {
    const broken = tables();
    delete broken.restock_arrivals;
    await expect(readRestockList(fakeDb(broken).db as never)).rejects.toThrow();
  });
});

describe("comandi", () => {
  it("membership prima della RPC; dati non validi senza RPC", async () => {
    mocks.verify.mockResolvedValue({ status: "denied" });
    const { db } = fakeDb({});
    expect(await executeRestockCommand(db as never, move())).toMatchObject({
      status: "rejected",
      code: "membership_required",
    });
    expect(await executeRestockCommand(db as never, { ...move(), retry: true })).toMatchObject({
      status: "uncertain",
    });
    mocks.verify.mockResolvedValue(member);
    expect(await executeRestockCommand(db as never, { kind: "x" })).toMatchObject({
      code: "invalid_payload",
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("successo: ricevuta coerente, messaggio in italiano; replay riconosciuto", async () => {
    const { db } = fakeDb(
      {},
      {
        data: {
          operation_id: op,
          order_id: rx.quality,
          state: "embroiderer",
          version: 7,
          replayed: false,
        },
        error: null,
      },
    );
    expect(await executeRestockCommand(db as never, move())).toEqual({
      status: "success",
      kind: "move_restock_order",
      operationId: op,
      replayed: false,
      message: "Riordine spostato a «Dal ricamatore».",
      target: { orderId: rx.quality, version: 7, state: "embroiderer" },
    });
    expect(db.rpc).toHaveBeenCalledWith("move_restock_order", {
      p_operation_id: op,
      p_payload: move().payload,
    });
    const replay = fakeDb(
      {},
      {
        data: {
          operation_id: op,
          order_id: rx.quality,
          state: "embroiderer",
          version: 7,
          replayed: true,
        },
        error: null,
      },
    );
    expect((await executeRestockCommand(replay.db as never, move())).status).toBe("success");
    // Ricevuta di un altro riordine o stato diverso: esito incerto.
    for (const data of [
      { operation_id: op, order_id: rx.arrived, state: "embroiderer", version: 7, replayed: false },
      { operation_id: op, order_id: rx.quality, state: "quality", version: 7, replayed: false },
      {
        operation_id: sx.user,
        order_id: rx.quality,
        state: "embroiderer",
        version: 7,
        replayed: false,
      },
    ])
      expect(
        (await executeRestockCommand(fakeDb({}, { data, error: null }).db as never, move())).status,
      ).toBe("uncertain");
  });

  it("arrivo: la ricevuta deve avere l'arrivo di questo invio", async () => {
    const receive = {
      operationId: op,
      kind: "receive_restock_order",
      payload: {
        schema_version: 1,
        order_id: rx.quality,
        expected_version: 6,
        expected_pieces: 31,
        note: "",
      },
    };
    const ok = fakeDb(
      {},
      {
        data: {
          operation_id: op,
          order_id: rx.quality,
          arrival_id: op,
          pieces: 31,
          state: "in_hand",
          version: 7,
          replayed: false,
        },
        error: null,
      },
    );
    expect(await executeRestockCommand(ok.db as never, receive)).toMatchObject({
      status: "success",
      message: "Arrivo registrato: 31 pezzi caricati in magazzino.",
      target: { state: "in_hand", pieces: 31 },
    });
    const other = fakeDb(
      {},
      {
        data: {
          operation_id: op,
          order_id: rx.quality,
          arrival_id: sx.user,
          pieces: 31,
          state: "in_hand",
          version: 7,
          replayed: false,
        },
        error: null,
      },
    );
    expect((await executeRestockCommand(other.db as never, receive)).status).toBe("uncertain");
  });

  it("ogni codice del database ha il suo messaggio, senza dettagli tecnici", async () => {
    for (const code of Object.keys(RESTOCK_MESSAGES)) {
      const sql =
        code === "title_taken"
          ? "23505"
          : ["membership_required", "stock_mutations_disabled"].includes(code)
            ? "42501"
            : "22023";
      const { db } = fakeDb({ stock_items: [] }, reject(code, sql, "diagnostica privata"));
      const result = await executeRestockCommand(db as never, move());
      expect(result).toEqual({ status: "rejected", code, message: RESTOCK_MESSAGES[code](null) });
      expect(RESTOCK_MESSAGES[code](null)).not.toMatch(/diagnostica|[{}_]/);
    }
    expect(
      (await executeRestockCommand(fakeDb({}, reject("boom")).db as never, move())).status,
    ).toBe("uncertain");
    expect(
      (
        await executeRestockCommand(
          fakeDb({}, reject("stale_version", "P0001")).db as never,
          move(),
        )
      ).status,
    ).toBe("uncertain");
  });

  it("lo SKU compare solo se è un articolo del gestionale; il numero dell'ordine del negozio", async () => {
    const known = item("GT3RS", "Blu", "XS");
    const rows = { stock_items: [{ id: known, sku: "SYN-GT3RS-BLU-XS" }] };
    expect(
      await executeRestockCommand(
        fakeDb(rows, reject("size_not_in_shop", "22023", "SYN-GT3RS-BLU-XS")).db as never,
        move(),
      ),
    ).toEqual({
      status: "rejected",
      code: "size_not_in_shop",
      message: "SYN-GT3RS-BLU-XS: il negozio non tiene questa taglia.",
      itemId: known,
    });
    expect(
      (
        await executeRestockCommand(
          fakeDb(rows, reject("size_not_in_shop", "22023", "<script>")).db as never,
          move(),
        )
      ).message,
    ).toBe("Il negozio non tiene una di queste taglie.");
    expect(
      (
        await executeRestockCommand(
          fakeDb({}, reject("shop_order_linked", "22023", "3")).db as never,
          move(),
        )
      ).message,
    ).toMatch(/^C’è l’ordine n\. 3 del negozio/);
    expect(
      (
        await executeRestockCommand(
          fakeDb({}, reject("shop_order_linked", "22023", "")).db as never,
          move(),
        )
      ).message,
    ).toMatch(/segnate come consegnate/);
  });

  it("in una verifica un rifiuto che può precedere la ricevuta resta incerto", async () => {
    for (const code of ["membership_required", "invalid_payload", "stock_mutations_disabled"])
      expect(
        (
          await executeRestockCommand(
            fakeDb({}, reject(code, code === "invalid_payload" ? "22023" : "42501")).db as never,
            { ...move(), retry: true },
          )
        ).status,
      ).toBe("uncertain");
    const lost = fakeDb({});
    lost.db.rpc.mockRejectedValue(Error("rete"));
    expect((await executeRestockCommand(lost.db as never, move())).status).toBe("uncertain");
  });
});
