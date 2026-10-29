import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), sensitive: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.verify }));
vi.mock("../auth/sensitive-access", () => ({ verifiedSensitiveAccess: mocks.sensitive }));
import {
  executeShopCommand,
  readConsignmentShop,
  readConsignmentShops,
  readNewShopForm,
  SHOP_MESSAGES,
} from "./shop-server";
import { parseShopCommand } from "./shop-model";
import { item, shopCommands, shopListRows, shopPageRows, sid, sx } from "./shop-fixtures";

type Row = Record<string, unknown>;
type Reply = { data: unknown; error: unknown };
/** PostgREST in memoria: filtri `eq`, `not is null`, cursore `gt`, ordine, limite e conteggio esatto. */
function fakeDb(tables: Record<string, Row[]>, rpcReply: Reply = { data: null, error: null }) {
  const calls: string[] = [];
  const db = {
    rpc: vi.fn().mockImplementation(async (name: string, args: { p_report_ids?: string[] }) =>
      name === "read_consignment_payment_states"
        ? {
            data: (tables.consignment_reports ?? [])
              .filter((r) => args.p_report_ids?.includes(r.id as string))
              .map((r) => ({ report_id: r.id, payment_state: r.payment_state })),
            error: null,
          }
        : rpcReply,
    ),
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
        not: (c: string) => (filters.push((r) => r[c] !== null), q),
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
/** Tutte le tabelle sintetiche dei tre negozi. */
function fixtureTables(): Record<string, Row[]> {
  const pages = ["NEG01", "NEG02", "NEG03"].map((code) => shopPageRows(code));
  const union = (key: keyof (typeof pages)[number]) => {
    const seen = new Map<string, Row>();
    for (const p of pages)
      for (const r of (p[key] ?? []) as Row[])
        seen.set(JSON.stringify([r.id, r.stock_item_id, r.location_id, r.user_id]), r);
    return [...seen.values()];
  };
  const list = shopListRows();
  return {
    app_settings: [{ id: true, ...(list.settings as Row) }],
    stock_locations: list.locations as Row[],
    consignment_shops: list.shops as Row[],
    stock_items: pages[0].items as Row[],
    product_variants: pages[0].variants as Row[],
    products: pages[0].products as Row[],
    shopify_catalog_variants: pages[0].catalog as Row[],
    operational_stock_availability: union("availability"),
    consignment_counts: union("counts"),
    consignment_reports: union("reports"),
    consignment_report_lines: union("reportLines"),
    consignment_report_revisions: union("reportRevisions"),
    consignment_orders: union("orders"),
    consignment_order_lines: union("orderLines"),
    consignment_shipments: union("shipments"),
    profiles: pages[0].profiles as Row[],
    consignment_report_payments: union("payments"),
    consignment_payment_revisions: union("paymentRevisions"),
  };
}
const member = {
  userId: sx.user,
  displayName: "Socio sintetico",
  role: "founder" as const,
  financeAccess: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue({ status: "member", member });
  mocks.sensitive.mockResolvedValue(true);
});

const op = sx.operation;
const receipts: Record<string, Row> = {
  save_consignment_shop: { location_id: sid(15), code: "NEG04", version: 1 },
  count_consignment_stock: { count_id: op, location_id: sx.shop, pieces: 4, full_count: false },
  save_consignment_report: { report_id: op, revision: 1 },
  set_consignment_invoice: { report_id: sx.september, revision: 4 },
  record_consignment_payment: { payment_id: op, report_id: sx.september },
  update_consignment_payment: { payment_id: sx.payment, report_id: sx.september, version: 2 },
  save_consignment_order: { order_id: op, order_number: 3, status: "open", version: 1 },
  ship_consignment_order: { shipment_id: op, order_id: sx.openOrder, status: "open", version: 3 },
  close_consignment_order: { order_id: sx.openOrder, status: "closed", version: 3 },
  return_consignment_stock: { shipment_id: op, location_id: sx.shop },
};
const builders = Object.values(shopCommands) as (() => { kind: string; payload: Row })[];
const reply = (kind: string, over: Row = {}): Reply => ({
  data: { operation_id: op, ...receipts[kind], replayed: false, ...over },
  error: null,
});
const reject = (message: string, code = "22023", details: unknown = ""): Reply => ({
  data: null,
  error: { code, message, details },
});

describe("comandi del conto vendita", () => {
  it("verifica la membership prima di leggere il comando o chiamare il database", async () => {
    const { db } = fakeDb({});
    mocks.verify.mockResolvedValue({ status: "denied" });
    expect(await executeShopCommand(db as never, null)).toMatchObject({
      status: "rejected",
      code: "membership_required",
    });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });
  it.each(builders.map((b) => [b().kind, b] as const))(
    "%s arriva alla RPC con il payload letto e una ricevuta coerente",
    async (kind, build) => {
      const { db } = fakeDb({}, reply(kind));
      const result = await executeShopCommand(db as never, build());
      expect(result).toMatchObject({ status: "success", kind, operationId: op, replayed: false });
      expect(db.rpc).toHaveBeenCalledWith(kind, {
        p_operation_id: op,
        p_payload: parseShopCommand(build())!.payload,
      });
    },
  );
  it("messaggi di conferma leggibili", async () => {
    const message = async (kind: string, build: () => unknown, over: Row = {}) => {
      const { db } = fakeDb({}, reply(kind, over));
      const result = await executeShopCommand(db as never, build());
      return result.status === "success" ? result.message : result.status;
    };
    expect(await message("save_consignment_shop", shopCommands.shop)).toBe("Negozio NEG04 creato.");
    expect(await message("count_consignment_stock", shopCommands.count)).toBe(
      "Conta salvata: 4 magliette contate.",
    );
    expect(await message("save_consignment_order", shopCommands.order)).toBe(
      "Ordine n. 3 salvato.",
    );
    expect(
      await message("ship_consignment_order", shopCommands.ship, { status: "delivered" }),
    ).toBe("Consegna registrata: l’ordine è consegnato tutto.");
    expect(await message("save_consignment_report", shopCommands.report, { replayed: true })).toBe(
      "Operazione già registrata: conferma recuperata senza duplicare niente.",
    );
  });
  it("negozi, fatture e pagamenti chiedono Finance aperta prima della RPC", async () => {
    mocks.sensitive.mockResolvedValue(false);
    for (const build of [
      shopCommands.shop,
      shopCommands.invoice,
      shopCommands.payment,
      shopCommands.paymentUpdate,
    ]) {
      const { db } = fakeDb({}, reply(build().kind));
      expect(await executeShopCommand(db as never, build())).toMatchObject({
        status: "rejected",
        code: "finance_access_required",
      });
      expect(db.rpc).not.toHaveBeenCalled();
    }
    mocks.sensitive.mockClear();
    for (const build of [
      shopCommands.count,
      shopCommands.report,
      shopCommands.order,
      shopCommands.ship,
    ]) {
      const { db } = fakeDb({}, reply(build().kind));
      expect((await executeShopCommand(db as never, build())).status).toBe("success");
    }
    expect(mocks.sensitive).not.toHaveBeenCalled();
  });
  it.each([
    "membership_required",
    "finance_access_required",
    "invalid_payload",
    "invalid_date",
    "invalid_period",
    "stock_mutations_disabled",
    "sales_disabled",
  ])("nella verifica dello stesso invio, %s resta incerto", async (message) => {
    const { db } = fakeDb(
      {},
      reject(
        message,
        message.endsWith("_required") || message.endsWith("disabled") ? "42501" : "22023",
      ),
    );
    expect(
      (await executeShopCommand(db as never, { ...shopCommands.count(), retry: true })).status,
    ).toBe("uncertain");
  });
  it("nella verifica, accesso e Finance non confermati restano incerti", async () => {
    const { db } = fakeDb({}, reply("record_consignment_payment"));
    mocks.verify.mockResolvedValueOnce({ status: "signed-out" });
    expect(
      (await executeShopCommand(db as never, { ...shopCommands.payment(), retry: true })).status,
    ).toBe("uncertain");
    mocks.sensitive.mockResolvedValueOnce(false);
    expect(
      (await executeShopCommand(db as never, { ...shopCommands.payment(), retry: true })).status,
    ).toBe("uncertain");
    expect(
      (
        await executeShopCommand(db as never, {
          ...shopCommands.payment(),
          payload: {},
          retry: true,
        })
      ).status,
    ).toBe("uncertain");
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("ogni codice del database ha il suo messaggio, senza dettagli tecnici", async () => {
    const codes = [
      "membership_required",
      "finance_access_required",
      "stock_mutations_disabled",
      "sales_disabled",
      "invalid_payload",
      "invalid_date",
      "invalid_period",
      "invalid_location",
      "invalid_tshirt",
      "idempotency_conflict",
      "stale_version",
      "stock_changed",
      "full_count_required",
      "shop_not_counted",
      "report_exists",
      "unmatched_catalog",
      "catalog_changed",
      "before_count_not_allowed",
      "insufficient_shop_stock",
      "insufficient_stock",
      "unknown_stock",
      "reserved_stock_conflict",
      "exceeds_order",
      "below_delivered",
      "order_not_open",
      "payment_exceeds_invoice",
      "effective_payment_limit",
      "payment_not_found",
      "report_not_found",
      "shop_not_empty",
      "size_not_in_shop",
      "restock_not_ready",
      "restock_deleted",
    ];
    expect(Object.keys(SHOP_MESSAGES).sort()).toEqual([...codes].sort());
    for (const code of codes) {
      const { db } = fakeDb(
        {},
        reject(code, code === "report_exists" ? "23505" : "22023", "diagnostica privata"),
      );
      const result = await executeShopCommand(db as never, shopCommands.order());
      expect(result).toEqual({ status: "rejected", code, message: SHOP_MESSAGES[code](null) });
      expect(SHOP_MESSAGES[code](null)).not.toMatch(/diagnostica|[{}_]/);
    }
  });
  it("codice sconosciuto o SQLSTATE inatteso: esito incerto", async () => {
    for (const error of [
      { code: "22023", message: "unexpected_code" },
      { code: "40001", message: "stale_version" },
      { code: "XX000", message: "internal" },
    ]) {
      const { db } = fakeDb({}, { data: null, error });
      expect((await executeShopCommand(db as never, shopCommands.order())).status).toBe(
        "uncertain",
      );
    }
  });
  it("lo SKU compare solo se è una T-shirt nota; la riga si evidenzia solo se è nell'invio", async () => {
    const tables = fixtureTables();
    const run = async (details: unknown, code = "insufficient_stock") => {
      const { db, calls } = fakeDb(tables, reject(code, "22023", details));
      return { result: await executeShopCommand(db as never, shopCommands.ship()), calls };
    };
    expect((await run("SYN-GT3RS-BLU-M")).result).toEqual({
      status: "rejected",
      code: "insufficient_stock",
      message:
        "Per SYN-GT3RS-BLU-M non ci sono abbastanza magliette libere in magazzino. Nessuna consegna registrata.",
      itemId: item("GT3RS", "Blu", "M"),
    });
    const other = (await run("SYN-F40-ROS-L")).result;
    expect(other).toMatchObject({ message: expect.stringContaining("SYN-F40-ROS-L") });
    expect(other).not.toHaveProperty("itemId");
    for (const unknown of ["SYN-NON-ESISTE", "<b>x</b>", 42]) {
      const { result } = await run(unknown);
      expect(result).toEqual({
        status: "rejected",
        code: "insufficient_stock",
        message: SHOP_MESSAGES.insufficient_stock(null),
      });
    }
    expect((await run("<b>x</b>")).calls).not.toContain("stock_items");
    expect((await run("SYN-GT3RS-BLU-M", "stale_version")).calls).not.toContain("stock_items");
  });
  it.each<[string, () => unknown, Row]>([
    ["operazione diversa", shopCommands.count, { operation_id: sid(77) }],
    ["replayed mancante", shopCommands.count, { replayed: undefined }],
    ["conta di un altro negozio", shopCommands.count, { location_id: sx.shop2 }],
    ["fattura di un altro resoconto", shopCommands.invoice, { report_id: sid(77) }],
    ["pagamento con id diverso", shopCommands.payment, { payment_id: sid(77) }],
    ["ordine chiuso ancora aperto", shopCommands.close, { status: "open" }],
    ["nuovo resoconto con id diverso", shopCommands.report, { report_id: sid(77) }],
    ["codice del negozio non valido", shopCommands.shop, { code: "../x" }],
    ["consegna di un altro ordine", shopCommands.ship, { order_id: sx.deliveredOrder }],
  ])("ricevuta incoerente (%s): esito incerto", async (_, build, over) => {
    const kind = (build() as { kind: string }).kind;
    const { db } = fakeDb({}, reply(kind, over));
    expect((await executeShopCommand(db as never, build())).status).toBe("uncertain");
  });
  it("errore prima dell'invio: nessun invio; dopo l'invio: incerto", async () => {
    const { db } = fakeDb({});
    mocks.verify.mockRejectedValueOnce(Error("rete"));
    expect(await executeShopCommand(db as never, shopCommands.count())).toMatchObject({
      status: "rejected",
      code: "unavailable",
    });
    db.rpc.mockRejectedValueOnce(Error("rete"));
    expect((await executeShopCommand(db as never, shopCommands.count())).status).toBe("uncertain");
  });
  it("un comando non valido non arriva al database", async () => {
    const { db } = fakeDb({});
    expect(
      await executeShopCommand(db as never, {
        ...shopCommands.order(),
        payload: { schema_version: 1 },
      }),
    ).toMatchObject({ status: "rejected", code: "invalid_payload" });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("letture del conto vendita", () => {
  it("un codice non valido o sconosciuto dà «non trovato»", async () => {
    const { db } = fakeDb(fixtureTables());
    expect(await readConsignmentShop(db as never, member, "neg-01")).toEqual({
      status: "not_found",
    });
    expect(db.from).not.toHaveBeenCalled();
    expect(await readConsignmentShop(db as never, member, "NEG09")).toEqual({
      status: "not_found",
    });
    expect(await readConsignmentShop(db as never, member, "MAG01")).toEqual({
      status: "not_found",
    });
  });
  it("senza Finance non legge pagamenti né il loro storico", async () => {
    mocks.sensitive.mockResolvedValue(false);
    const { db, calls } = fakeDb(fixtureTables());
    const read = await readConsignmentShop(db as never, member, "neg01");
    expect(read.status === "ready" && read.page.payments).toBeNull();
    expect(read).toMatchObject({ canFinance: false });
    expect(calls).not.toContain("consignment_report_payments");
    expect(calls).not.toContain("consignment_payment_revisions");
  });
  it("con Finance aperta legge la pagina completa", async () => {
    const { db, calls } = fakeDb(fixtureTables());
    const read = await readConsignmentShop(db as never, member, "NEG01");
    expect(read.status).toBe("ready");
    if (read.status !== "ready") return;
    expect(read.canFinance).toBe(true);
    expect(read.page.payments).toHaveLength(2);
    expect(read.page.reports.map((r) => r.month)).toEqual(["2026-09"]);
    expect(read.page.items).toHaveLength(24);
    expect(read.page.supplyStock[item("GT3RS", "Blu", "M")]).toMatchObject({ available: 1 });
    expect(calls.filter((t) => t === "shopify_catalog_variants")).toHaveLength(1);
  });
  it("una verifica di Finance non disponibile vale «chiusa»", async () => {
    mocks.sensitive.mockRejectedValue(Error("rete"));
    const { db, calls } = fakeDb(fixtureTables());
    expect(await readConsignmentShop(db as never, member, "NEG01")).toMatchObject({
      status: "ready",
      canFinance: false,
    });
    expect(calls).not.toContain("consignment_report_payments");
  });
  it("una lettura troncata fa fallire tutta la pagina", async () => {
    const tables = fixtureTables();
    tables.consignment_report_lines = tables.consignment_report_lines.filter(
      (r) => r.id !== sid(310),
    );
    const { db } = fakeDb(tables);
    await expect(readConsignmentShop(db as never, member, "NEG01")).rejects.toThrow(
      "Lettura conto vendita non completa",
    );
  });
  it("elenco dei negozi", async () => {
    mocks.sensitive.mockResolvedValue(false);
    const { db, calls } = fakeDb(fixtureTables());
    const read = await readConsignmentShops(db as never, member, new Date("2026-11-05T10:00:00Z"));
    expect(read.canFinance).toBe(false);
    expect(read.list.shops.map((s) => [s.code, s.pieces, s.openOrders])).toEqual([
      ["NEG01", 8, 1],
      ["NEG02", null, 0],
    ]);
    expect(read.list.closed.map((s) => s.code)).toEqual(["NEG03"]);
    expect(calls).not.toContain("consignment_report_payments");
  });
  it("modulo del nuovo negozio: Finance e soli magazzini attivi", async () => {
    const { db, calls } = fakeDb(fixtureTables());
    const read = await readNewShopForm(db as never, member);
    expect(read.canFinance).toBe(true);
    expect(read.warehouses.map((w) => w.code)).toEqual(["MAG01"]);
    expect(calls).toEqual(["stock_locations"]);
    mocks.sensitive.mockRejectedValue(Error("rete"));
    expect((await readNewShopForm(db as never, member)).canFinance).toBe(false);
  });
});
