// test-db: pglite minimo 613
// Conto vendita semplice su PGlite: Auth simulato, solo dati sintetici, nessun cloud.
// Gruppi: migrazione, conta, resoconto, ordini e consegne, packaging, Finance,
// negozi, audit, RPC precedenti, rettifiche sul negozio (06 R7), permessi.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (!process.argv[2]?.startsWith("/")) throw Error("Pass absolute external PGlite dist/index.js");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const eq = (actual, expected, message = "Values must match") => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const ok = (value, message = "Expected truthy value") => {
  assert.ok(value, message);
  checks++;
};
const id = (n) => `93000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const roles = [
  "founder",
  "production",
  "finance",
  "logistics",
  "consultant",
  "outsider",
  "inactive",
];
const ids = Object.fromEntries(roles.map((role, index) => [role, id(index + 1)]));
const central = id(100),
  shop = id(101),
  shop3 = id(103),
  closedShop = id(105),
  external = id(106);
const tA = id(200),
  tB = id(201),
  tC = id(202),
  tD = id(203),
  tE = id(204),
  sticker = id(205);
const sku = {
  [tA]: "SYN-GT3-BLU-M",
  [tB]: "SYN-GT3-BLU-L",
  [tC]: "SYN-F40-ROS-M",
  [tD]: "SYN-F40-ROS-L",
  [tE]: "SYN-F40-ROS-XL",
  [sticker]: "SYN-ADESIVO",
};
const domain = "synthetic.myshopify.com";
const gid = {
  [tA]: "gid://shopify/ProductVariant/101",
  [tB]: "gid://shopify/ProductVariant/102",
  [tC]: "gid://shopify/ProductVariant/103",
  [tD]: "gid://shopify/ProductVariant/104",
};
const web = { [tA]: 4500, [tB]: 4999, [tC]: 3333, [tD]: 4510 };
const observedAt = {
  [tA]: "2026-01-15T10:00:00.000Z",
  [tB]: "2026-01-15T10:00:00.000Z",
  [tC]: "2026-01-15T10:00:00.000Z",
  [tD]: "2026-01-15T10:00:00.000Z",
};
const now = () => new Date().toISOString();
const tables = [
  "consignment_shops",
  "consignment_counts",
  "consignment_count_lines",
  "consignment_reports",
  "consignment_report_lines",
  "consignment_report_revisions",
  "consignment_report_movements",
  "consignment_orders",
  "consignment_order_lines",
  "consignment_shipments",
  "consignment_shipment_lines",
  "consignment_report_payments",
  "consignment_payment_revisions",
];
const financeTables = new Set(["consignment_report_payments", "consignment_payment_revisions"]);
const appendOnly = [
  "consignment_counts",
  "consignment_count_lines",
  "consignment_report_revisions",
  "consignment_report_movements",
  "consignment_shipments",
  "consignment_shipment_lines",
  "consignment_payment_revisions",
];
const commands = [
  "save_consignment_shop",
  "count_consignment_stock",
  "save_consignment_report",
  "set_consignment_invoice",
  "record_consignment_payment",
  "update_consignment_payment",
  "save_consignment_order",
  "ship_consignment_order",
  "close_consignment_order",
  "return_consignment_stock",
];

async function as(name, fn, aal = "aal1", role = "authenticated") {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: ids[name], aal, user_metadata: { role: "founder" } }),
    ]);
    await db.exec(`set local role ${role}`);
    const value = await fn();
    await db.exec("commit");
    return value;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const run = (kind, payload, op = randomUUID(), who = "consultant", aal = "aal1") =>
  as(
    who,
    async () =>
      (await db.query(`select public.${kind}($1,$2::jsonb) result`, [op, JSON.stringify(payload)]))
        .rows[0].result,
    aal,
  );
const fin = (kind, payload, op = randomUUID(), who = "finance") =>
  run(kind, payload, op, who, "aal2");
async function rejects(fn, message, code, detail) {
  let error;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  ok(error, `Expected rejection: ${message ?? code}`);
  if (message) eq(error.message, message, `Message ${message}`);
  if (code) eq(error.code, code, `Code of ${message ?? code}`);
  if (detail !== undefined) eq(error.detail, detail, `Detail of ${message}`);
}
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const count = async (table, where = "true", args = []) =>
  (await one(`select count(*)::int n from ${table} where ${where}`, args)).n;
const bal = async (item, location) => {
  const row = await one(
    "select quantity::int quantity from public.stock_balances where stock_item_id=$1 and location_id=$2",
    [item, location],
  );
  return row === undefined ? undefined : row.quantity;
};
const shopStock = async (location = shop) =>
  Promise.all([tA, tB, tC, tD].map((item) => bal(item, location)));
const centralStock = async () => Promise.all([tA, tB, tC, tD].map((item) => bal(item, central)));
const split = (webCents, markup, bps, quantity) => {
  const unit = webCents + markup;
  const gross = unit * quantity;
  const brand = Math.floor((gross * bps + 5000) / 10000);
  return { unit, gross, brand, shop: gross - brand };
};
const countPayload = (lines, over = {}) => ({
  schema_version: 1,
  location_id: shop,
  counted_at: now(),
  note: "",
  lines,
  ...over,
});
const cl = (item, quantity, expected) => ({
  stock_item_id: item,
  quantity,
  expected_quantity: expected,
});
const price = (item, over = {}) => ({
  shop_domain: domain,
  variant_gid: gid[item],
  expected_web_price_cents: web[item],
  expected_catalog_observed_at: observedAt[item],
  ...over,
});
const reportPayload = (period, lines, over = {}) => ({
  schema_version: 1,
  location_id: shop,
  period_month: period,
  expected_revision: null,
  reason: null,
  lines,
  ...over,
});
const rl = (item, quantity, before = 0, itemPrice = null) => ({
  stock_item_id: item,
  quantity,
  before_count_quantity: before,
  price: itemPrice,
});
const orderPayload = (lines, over = {}) => ({
  schema_version: 1,
  order_id: null,
  expected_version: null,
  location_id: shop,
  requested_on: dates.today,
  note: "",
  lines,
  ...over,
});
const ol = (item, quantity) => ({ stock_item_id: item, quantity });
const shipPayload = (orderId, version, lines, over = {}) => ({
  schema_version: 1,
  order_id: orderId,
  expected_version: version,
  occurred_at: now(),
  lines,
  ...over,
});
const shopPayload = (over = {}) => ({
  schema_version: 1,
  location_id: null,
  expected_version: null,
  name: "Terzo negozio sintetico",
  brand_share_bps: 6000,
  markup_cents: 1000,
  supply_location_id: central,
  note: "",
  active: true,
  ...over,
});
const payPayload = (reportId, over = {}) => ({
  schema_version: 1,
  report_id: reportId,
  amount_cents: 10000,
  paid_at: now(),
  method: "bank_transfer",
  account_label: "Conto sintetico",
  reference: "Bonifico sintetico",
  ...over,
});
const updatePayload = (paymentId, over = {}) => ({
  schema_version: 1,
  payment_id: paymentId,
  expected_version: 1,
  amount_cents: 9000,
  paid_at: now(),
  method: "bank_transfer",
  account_label: "Conto sintetico",
  reference: "Bonifico sintetico",
  voided: false,
  reason: "Importo corretto dal negozio",
  ...over,
});
const report = (reportId) =>
  one(
    `select revision, brand_share_bps, markup_cents::int markup_cents, pieces::int pieces, gross_cents::int gross_cents,
      brand_cents::int brand_cents, shop_cents::int shop_cents, payment_state, invoice_number, invoice_revision
     from public.consignment_reports where id=$1`,
    [reportId],
  );
const reportLines = (reportId) =>
  rows(
    `select stock_item_id, sku_snapshot, quantity, before_count_quantity, web_price_cents::int web_price_cents,
      unit_shop_price_cents::int unit_shop_price_cents, gross_cents::int gross_cents, brand_cents::int brand_cents,
      shop_cents::int shop_cents, unit_cost_cents::int unit_cost_cents, brand_share_bps, markup_cents::int markup_cents
     from public.consignment_report_lines where report_id=$1 order by stock_item_id`,
    [reportId],
  );
const movementsOf = (key, value) =>
  rows(
    `select stock_item_id, location_id, kind::text kind, quantity_delta::int quantity_delta
     from public.stock_movements where source->>'${key}'=$1 order by stock_item_id, quantity_delta`,
    [value],
  );
let box;
let seal;
const pack = async () => [await bal(box, central), await bal(seal, central)];
const fingerprint = () =>
  one(`select
    (select md5(coalesce(string_agg(stock_item_id||':'||location_id||':'||coalesce(quantity::text,'-'),',' order by stock_item_id,location_id),'')) from public.stock_balances) balances,
    (select md5(coalesce(string_agg(id||':'||kind||':'||quantity_delta||':'||quantity_after,',' order by id),'')) from public.stock_movements) movements,
    (select count(*)::int from public.audit_logs) audit`);
let dates;

try {
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key);
     create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
     create function auth.uid()returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;`,
  );
  const directory = new URL("../migrations/", import.meta.url);
  const files = readdirSync(directory).sort();
  const migration = (suffix) => {
    const found = files.filter((name) => name.endsWith(`_${suffix}.sql`));
    assert.equal(found.length, 1, `Exactly one migration ${suffix}`);
    return readFileSync(new URL(found[0], directory), "utf8");
  };
  for (const suffix of [
    "initial_schema",
    "sales_ecosystem",
    "sales_lifecycle",
    "packaging_materials",
    "shopify_catalog",
    "consignment_workflow",
    "shopify_sales_core",
    "packaging_automatic_consumption",
  ])
    await db.exec(migration(suffix));

  // Synthetic users, locations, T-shirts, balances and catalog BEFORE the migration.
  for (const role of roles) {
    await db.query("insert into auth.users(id)values($1)", [ids[role]]);
    if (role === "outsider") continue;
    await db.query("insert into public.profiles(user_id,display_name)values($1,$2)", [
      ids[role],
      `Sintetico ${role}`,
    ]);
    await db.query(
      "insert into public.memberships(user_id,role,active,finance_access)values($1,$2,$3,$4)",
      [
        ids[role],
        role === "inactive" ? "logistics" : role,
        role !== "inactive",
        ["founder", "production", "finance"].includes(role),
      ],
    );
  }
  await db.query(
    `insert into public.stock_locations(id,code,name,location_type,active)values
      ($1,'MAG01','Magazzino sintetico','Magazzino',true),($2,'NEG01','Negozio sintetico','Negozio Conto Vendita',true),
      ($3,'NEG03','Secondo negozio sintetico','Negozio Conto Vendita',true),($4,'NEG05','Negozio sintetico chiuso','Negozio Conto Vendita',false),
      ($5,'EST01','Esterno sintetico','Esterno',true)`,
    [central, shop, shop3, closedShop, external],
  );
  await db.query(
    "insert into public.products(id,model,category)values($1,'GT3RS','T-shirt'),($2,'F40','T-shirt'),($3,'Adesivo sintetico','Adesivo')",
    [id(300), id(301), id(302)],
  );
  for (const [item, product, name, color, size, cost, active] of [
    [tA, id(300), "GT3RS · Blu · M", "Blu", "M", 13.2, true],
    [tB, id(300), "GT3RS · Blu · L", "Blu", "L", null, true],
    [tC, id(301), "F40 · Rosso · M", "Rosso", "M", 12, true],
    [tD, id(301), "F40 · Rosso · L", "Rosso", "L", null, true],
    [tE, id(301), "F40 · Rosso · XL", "Rosso", "XL", null, false],
    [sticker, id(302), "Adesivo sintetico", "Nero", "Unica", 1, true],
  ]) {
    await db.query(
      "insert into public.stock_items(id,kind,sku,name,unit_cost_eur,active)values($1,'product',$2,$3,$4,$5)",
      [item, sku[item], name, cost, active],
    );
    await db.query(
      "insert into public.product_variants(stock_item_id,product_id,color,size)values($1,$2,$3,$4)",
      [item, product, color, size],
    );
  }
  for (const [item, location, quantity] of [
    [tA, central, 50],
    [tB, central, 50],
    [tC, central, 50],
    [tD, central, 2],
    [sticker, central, 10],
    [tA, shop, 0],
    [tB, shop, 0],
  ])
    await db.query(
      "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,'opening',$4,'Conta sintetica')",
      [randomUUID(), item, location, quantity],
    );
  for (const item of [tA, tB, tC])
    await db.query(
      `insert into public.shopify_catalog_variants(shop_domain,variant_gid,product_gid,sku,product_title,product_type,status,price_cents,source_updated_at,observed_at,stock_item_id)
       values($1,$2,'gid://shopify/Product/11',$3,'T-shirt sintetica','T-shirt','ACTIVE',$4,$5,$5,$6)`,
      [domain, gid[item], sku[item], web[item], observedAt[item], item],
    );

  // 2 · Migrazione: una riga per negozio, nessun saldo o movimento cambiato.
  const before = await fingerprint();
  const packagingAcl = async () =>
    (
      await one(
        "select coalesce(proacl::text,'') acl from pg_proc where oid='private.observe_packaging_source(text,uuid)'::regprocedure",
      )
    ).acl;
  const aclBefore = await packagingAcl();
  const monthly = migration("consignment_monthly");
  await db.exec(monthly);
  ok(true, "consignment_monthly applies after the existing migrations");
  eq(await fingerprint(), before, "Migration changes no balance, movement or audit row");
  eq(await packagingAcl(), aclBefore, "Replaced packaging function keeps its grants");
  ok(
    (
      await one(
        "select prosrc like '%consignment_report_movements%' found from pg_proc where oid='private.observe_packaging_source(text,uuid)'::regprocedure",
      )
    ).found,
    "Packaging function reads the monthly report movements",
  );
  const shopRows = () =>
    rows(
      `select location_id, supply_location_id, brand_share_bps, markup_cents::int markup_cents, currency, first_counted_at,
        note, version::int version, created_by, updated_by from public.consignment_shops order by location_id`,
    );
  const expectedShops = [shop, shop3, closedShop].map((location) => ({
    location_id: location,
    supply_location_id: central,
    brand_share_bps: 6000,
    markup_cents: 1000,
    currency: "EUR",
    first_counted_at: null,
    note: "",
    version: 1,
    created_by: null,
    updated_by: null,
  }));
  eq(
    await shopRows(),
    expectedShops,
    "One row per shop location (also inactive), 6000/1000, never counted, supply MAG01",
  );
  eq(
    await count("public.audit_logs", "table_name='consignment_shops'"),
    0,
    "Shop rows inserted before the audit trigger",
  );
  const insertShops = monthly.match(
    /insert into public\.consignment_shops\(location_id, supply_location_id[\s\S]*?on conflict \(location_id\) do nothing;/,
  )?.[0];
  ok(insertShops, "Initial insert found in the migration");
  await db.exec(insertShops);
  eq(await shopRows(), expectedShops, "A second run of the insert does not duplicate");
  eq(
    (
      await one(
        `select to_regprocedure('public.transfer_consignment_stock(uuid,jsonb)') is not null
          and to_regprocedure('public.register_consignment_sale(uuid,jsonb)') is not null
          and to_regprocedure('public.record_consignment_settlement(uuid,jsonb)') is not null present`,
      )
    ).present,
    true,
    "Previous consignment RPCs still exist",
  );
  eq(
    (await one("select enum_range(null::public.stock_movement_kind)::text kinds")).kinds.match(
      /shop_count|consignment_sale_correction/g,
    ),
    ["shop_count", "consignment_sale_correction"],
    "New movement kinds",
  );
  eq(
    (
      await rows(
        "select tgname from pg_trigger where not tgisinternal and tgrelid='public.stock_movements'::regclass and tgname in('adjustment_not_on_shop','apply_stock_movement') order by tgname",
      )
    ).map((row) => row.tgname),
    ["adjustment_not_on_shop", "apply_stock_movement"],
    "Shop guard sorts before the balance trigger",
  );
  ok(
    await count(
      "pg_trigger",
      "tgrelid='public.consignment_report_movements'::regclass and tgname='observe_packaging'",
    ),
    "Packaging trigger on report movements",
  );

  dates =
    await one(`select to_char(m,'YYYY-MM') cur, to_char(m - interval '1 month','YYYY-MM') prev,
      to_char(m - interval '2 month','YYYY-MM') prev2, to_char(m + interval '1 month','YYYY-MM') next,
      to_char(((m - interval '1 month') at time zone 'Europe/Rome') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') prev_start,
      to_char(((m - interval '1 month' + interval '14 days 12 hours') at time zone 'Europe/Rome') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') prev_mid,
      to_char(((m - interval '1 month' + interval '15 days 12 hours') at time zone 'Europe/Rome') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') prev_late,
      to_char(((m - interval '1 month' - interval '1 hour') at time zone 'Europe/Rome') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') before_prev_start,
      to_char((now() at time zone 'Europe/Rome')::date,'YYYY-MM-DD') today,
      to_char((now() at time zone 'Europe/Rome')::date + 1,'YYYY-MM-DD') tomorrow,
      to_char((m - interval '1 month' - interval '1 day')::date,'YYYY-MM-DD') before_prev
    from (select date_trunc('month', now() at time zone 'Europe/Rome') m) x`);
  await db.query(
    "update public.app_settings set stock_adjustments_enabled=true,manual_sales_enabled=true,sales_started_at=$1",
    [dates.prev_start],
  );
  const activated = (await one("select private.activate_tshirt_packaging() result")).result;
  box = activated.box_item_id;
  seal = activated.sticker_item_id;
  eq(await pack(), [100, 100], "Synthetic packaging active at MAG01");

  // 3 · Conta in negozio.
  const firstLines = [cl(tA, 5, 0), cl(tB, 0, 0), cl(tC, 3, null), cl(tD, 0, null)];
  await rejects(
    () => run("count_consignment_stock", countPayload(firstLines.slice(0, 3))),
    "full_count_required",
    "22023",
  );
  await rejects(
    () => run("count_consignment_stock", countPayload([...firstLines, cl(sticker, 1, null)])),
    "invalid_tshirt",
    "22023",
  );
  await rejects(
    () => run("count_consignment_stock", countPayload([cl(tA, 5, 1), ...firstLines.slice(1)])),
    "stock_changed",
    "22023",
    sku[tA],
  );
  for (const who of ["outsider", "inactive"])
    await rejects(
      () => run("count_consignment_stock", countPayload(firstLines), randomUUID(), who),
      "membership_required",
      "42501",
    );
  for (const payload of [
    countPayload(firstLines, { extra: 1 }),
    countPayload([cl(tA, -1, 0), ...firstLines.slice(1)]),
    countPayload([cl(tA, 100001, 0), ...firstLines.slice(1)]),
    countPayload([cl(tA, 1.5, 0), ...firstLines.slice(1)]),
    countPayload([...firstLines, cl(tA, 1, 0)]),
    countPayload([cl("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz", 1, null)]),
    countPayload([]),
    countPayload(Array.from({ length: 201 }, (_, index) => cl(id(5000 + index), 0, null))),
    countPayload(firstLines, { note: "nota\tcon tabulazione" }),
    countPayload(firstLines, { note: "x".repeat(501) }),
  ])
    await rejects(() => run("count_consignment_stock", payload), "invalid_payload", "22023");
  await rejects(
    () =>
      run(
        "count_consignment_stock",
        countPayload(firstLines, { counted_at: "2099-01-01T00:00:00Z" }),
      ),
    "invalid_date",
    "22023",
  );
  for (const location of [closedShop, central, randomUUID()])
    await rejects(
      () => run("count_consignment_stock", countPayload(firstLines, { location_id: location })),
      "invalid_location",
      "22023",
    );
  await db.exec("update public.app_settings set stock_adjustments_enabled=false");
  await rejects(
    () => run("count_consignment_stock", countPayload(firstLines)),
    "stock_mutations_disabled",
    "42501",
  );
  await db.exec("update public.app_settings set stock_adjustments_enabled=true");
  const countOp = randomUUID();
  const firstCount = countPayload(firstLines, {
    counted_at: dates.prev_mid,
    note: "Prima conta\nsintetica",
  });
  const movementsBeforeCount = await count("public.stock_movements");
  const counted = await run("count_consignment_stock", firstCount, countOp);
  eq(
    counted,
    {
      operation_id: countOp,
      count_id: countOp,
      location_id: shop,
      pieces: 8,
      full_count: true,
      replayed: false,
    },
    "First full count",
  );
  eq(await shopStock(), [5, 0, 3, 0], "Absolute shop quantities");
  eq(await centralStock(), [50, 50, 50, 2], "Central warehouse unchanged by a shop count");
  eq(
    (await count("public.stock_movements")) - movementsBeforeCount,
    3,
    "No movement for an unchanged variant",
  );
  eq(
    await movementsOf("consignment_count_id", countOp),
    [
      { stock_item_id: tA, location_id: shop, kind: "shop_count", quantity_delta: 5 },
      { stock_item_id: tC, location_id: shop, kind: "opening", quantity_delta: 3 },
      { stock_item_id: tD, location_id: shop, kind: "opening", quantity_delta: 0 },
    ],
    "shop_count for a difference, opening for a missing shop balance",
  );
  eq(
    await rows(
      "select stock_item_id, quantity_before::int quantity_before, counted_quantity::int counted_quantity, movement_id is not null moved from public.consignment_count_lines where count_id=$1 order by stock_item_id",
      [countOp],
    ),
    [
      { stock_item_id: tA, quantity_before: 0, counted_quantity: 5, moved: true },
      { stock_item_id: tB, quantity_before: 0, counted_quantity: 0, moved: false },
      { stock_item_id: tC, quantity_before: null, counted_quantity: 3, moved: true },
      { stock_item_id: tD, quantity_before: null, counted_quantity: 0, moved: true },
    ],
    "Count lines keep the quantity read before",
  );
  eq(
    await one(
      "select c.full_count, c.pieces::int pieces, c.note, c.created_by, s.first_counted_at=$2::timestamptz first from public.consignment_counts c join public.consignment_shops s on s.location_id=c.location_id where c.id=$1",
      [countOp, dates.prev_mid],
    ),
    {
      full_count: true,
      pieces: 8,
      note: "Prima conta\nsintetica",
      created_by: ids.consultant,
      first: true,
    },
    "Count header and first count time",
  );
  eq(
    await run("count_consignment_stock", firstCount, countOp),
    { ...counted, replayed: true },
    "Identical replay",
  );
  eq((await count("public.stock_movements")) - movementsBeforeCount, 3, "Replay adds nothing");
  await rejects(
    () => run("count_consignment_stock", { ...firstCount, note: "Altra nota" }, countOp),
    "idempotency_conflict",
    "22023",
  );
  await rejects(
    () => run("count_consignment_stock", firstCount, countOp, "founder"),
    "idempotency_conflict",
    "22023",
  );
  await db.exec("update public.app_settings set stock_adjustments_enabled=false");
  eq(
    (await run("count_consignment_stock", firstCount, countOp)).replayed,
    true,
    "Replay is readable with the flag off",
  );
  await db.exec("update public.app_settings set stock_adjustments_enabled=true");
  const correction = await run(
    "count_consignment_stock",
    countPayload([cl(tB, 2, 0)], { counted_at: dates.prev_late }),
  );
  eq(correction.full_count, false, "A partial correction is not a full count");
  eq(await shopStock(), [5, 2, 3, 0], "Correction changes only the counted variant");
  eq(
    (
      await one(
        "select first_counted_at=$1::timestamptz same from public.consignment_shops where location_id=$2",
        [dates.prev_mid, shop],
      )
    ).same,
    true,
    "First count time unchanged by a correction",
  );
  eq(await pack(), [100, 100], "A shop count consumes no packaging");
  eq(await count("public.packaging_consumptions"), 0);

  // 4 · Resoconto mensile.
  await rejects(
    () =>
      run(
        "save_consignment_report",
        reportPayload(dates.prev, [rl(tA, 1, 0, price(tA))], { location_id: shop3 }),
      ),
    "shop_not_counted",
    "22023",
  );
  for (const period of [dates.next, dates.prev2, "2026-13", "2026-1", "26-10"])
    await rejects(
      () => run("save_consignment_report", reportPayload(period, [rl(tA, 1, 0, price(tA))])),
      "invalid_period",
      "22023",
    );
  await db.exec("update public.app_settings set manual_sales_enabled=false");
  await rejects(
    () => run("save_consignment_report", reportPayload(dates.prev, [rl(tA, 1, 0, price(tA))])),
    "sales_disabled",
    "42501",
  );
  await db.exec(
    "update public.app_settings set manual_sales_enabled=true,stock_adjustments_enabled=false",
  );
  await rejects(
    () => run("save_consignment_report", reportPayload(dates.prev, [rl(tA, 1, 0, price(tA))])),
    "stock_mutations_disabled",
    "42501",
  );
  await db.exec("update public.app_settings set stock_adjustments_enabled=true");
  for (const [line, message, detail] of [
    [rl(tA, 1, 0, price(tA, { expected_web_price_cents: 4400 })), "catalog_changed", sku[tA]],
    [
      rl(tA, 1, 0, price(tA, { expected_catalog_observed_at: "2026-01-16T10:00:00Z" })),
      "catalog_changed",
      sku[tA],
    ],
    [rl(tD, 1, 0, price(tD)), "unmatched_catalog", sku[tD]],
    [rl(tA, 1, 0, price(tA, { variant_gid: gid[tB] })), "unmatched_catalog", sku[tA]],
  ])
    await rejects(
      () => run("save_consignment_report", reportPayload(dates.prev, [line])),
      message,
      "22023",
      detail,
    );
  for (const change of ["status='DRAFT'", "product_type='Felpa'"]) {
    await db.query(`update public.shopify_catalog_variants set ${change} where stock_item_id=$1`, [
      tC,
    ]);
    await rejects(
      () => run("save_consignment_report", reportPayload(dates.prev, [rl(tC, 1, 0, price(tC))])),
      "unmatched_catalog",
      "22023",
      sku[tC],
    );
    await db.query(
      "update public.shopify_catalog_variants set status='ACTIVE',product_type='T-shirt' where stock_item_id=$1",
      [tC],
    );
  }
  eq(
    await count("public.shopify_catalog_variants", "currency_code<>'EUR'"),
    0,
    "Non-EUR catalog rows cannot exist (constraint), the command also requires EUR",
  );
  for (const payload of [
    reportPayload(dates.prev, [rl(tA, 1, 0, null)]),
    reportPayload(dates.prev, [rl(tA, 0, 0, price(tA))]),
    reportPayload(dates.prev, [rl(tA, 1, 2, price(tA))]),
    reportPayload(dates.prev, [rl(tA, 1, 0, price(tA)), rl(tA, 2, 0, price(tA))]),
    reportPayload(dates.prev, [rl(tA, 1, 0, price(tA))], { reason: "x" }),
    reportPayload(dates.prev, [rl(tA, 1, 0, price(tA))], { expected_revision: 1 }),
    reportPayload(dates.prev, [rl(tA, 1, 0, { ...price(tA), extra: true })]),
    { ...reportPayload(dates.prev, []), period_month: 202610 },
  ])
    await rejects(() => run("save_consignment_report", payload), "invalid_payload", "22023");
  await rejects(
    () => run("save_consignment_report", reportPayload(dates.prev, [rl(sticker, 1, 0, price(tA))])),
    "invalid_tshirt",
    "22023",
  );
  await rejects(
    () =>
      run(
        "save_consignment_report",
        reportPayload(dates.prev, [rl(tA, 1, 0, price(tA))], {
          expected_revision: 1,
          reason: "Correzione sintetica",
        }),
      ),
    "report_not_found",
    "22023",
  );
  const atomic = async () => [
    await count("public.consignment_reports"),
    await count("public.stock_movements"),
    await count("private.consignment_receipts"),
    await shopStock(),
  ];
  const beforeShort = await atomic();
  await rejects(
    () =>
      run(
        "save_consignment_report",
        reportPayload(dates.prev, [rl(tA, 3, 0, price(tA)), rl(tB, 3, 0, price(tB))]),
      ),
    "insufficient_shop_stock",
    "22023",
    sku[tB],
  );
  eq(await atomic(), beforeShort, "Insufficient shop stock writes nothing at all");
  const sideTables = async () => [
    await count("public.finance_entries"),
    await count("public.commercial_facts"),
    await count("public.sales_orders"),
    await count("public.consignment_sales"),
  ];
  const sideBefore = await sideTables();
  const reportOp = randomUUID();
  const r1Payload = reportPayload(dates.prev, [rl(tB, 1, 0, price(tB)), rl(tA, 3, 0, price(tA))]);
  const r1 = await run("save_consignment_report", r1Payload, reportOp);
  eq(r1, { operation_id: reportOp, report_id: reportOp, revision: 1, replayed: false });
  const lineA1 = split(4500, 1000, 6000, 3),
    lineB1 = split(4999, 1000, 6000, 1);
  eq(
    await report(reportOp),
    {
      revision: 1,
      brand_share_bps: 6000,
      markup_cents: 1000,
      pieces: 4,
      gross_cents: 22499,
      brand_cents: 13499,
      shop_cents: 9000,
      payment_state: "unpaid",
      invoice_number: null,
      invoice_revision: null,
    },
    "Spec example: 4 pieces, 224,99 shop takings, 134,99 to invoice, 90,00 to the shop",
  );
  eq([lineA1.brand + lineB1.brand, lineA1.gross + lineB1.gross], [13499, 22499]);
  eq(
    await reportLines(reportOp),
    [
      {
        stock_item_id: tA,
        sku_snapshot: sku[tA],
        quantity: 3,
        before_count_quantity: 0,
        web_price_cents: 4500,
        unit_shop_price_cents: 5500,
        gross_cents: 16500,
        brand_cents: 9900,
        shop_cents: 6600,
        unit_cost_cents: 1320,
        brand_share_bps: 6000,
        markup_cents: 1000,
      },
      {
        stock_item_id: tB,
        sku_snapshot: sku[tB],
        quantity: 1,
        before_count_quantity: 0,
        web_price_cents: 4999,
        unit_shop_price_cents: 5999,
        gross_cents: 5999,
        brand_cents: 3599,
        shop_cents: 2400,
        unit_cost_cents: null,
        brand_share_bps: 6000,
        markup_cents: 1000,
      },
    ],
    "Lines with locked prices, unknown cost stays NULL",
  );
  eq(await shopStock(), [2, 1, 3, 0], "Only the shop goes down");
  eq(await centralStock(), [50, 50, 50, 2], "Central warehouse unchanged by a report");
  eq(
    await movementsOf("consignment_report_revision_id", reportOp),
    [
      { stock_item_id: tA, location_id: shop, kind: "consignment_sale", quantity_delta: -3 },
      { stock_item_id: tB, location_id: shop, kind: "consignment_sale", quantity_delta: -1 },
    ],
    "consignment_sale movements on the shop",
  );
  eq(
    await rows(
      "select stock_item_id, quantity_delta::int quantity_delta from public.consignment_report_movements where revision_id=$1 order by stock_item_id",
      [reportOp],
    ),
    [
      { stock_item_id: tA, quantity_delta: -3 },
      { stock_item_id: tB, quantity_delta: -1 },
    ],
  );
  eq(
    await one(
      "select revision, change_kind, reason, (snapshot->>'brand_cents')::int brand, jsonb_array_length(snapshot->'lines') lines from public.consignment_report_revisions where id=$1",
      [reportOp],
    ),
    { revision: 1, change_kind: "lines", reason: null, brand: 13499, lines: 2 },
    "First version with its snapshot",
  );
  eq(
    await sideTables(),
    sideBefore,
    "No finance_entries, commercial_facts, sales_orders, consignment_sales",
  );
  // 6 · Packaging: the report consumes one box and one sticker per piece removed from the shop.
  eq(await pack(), [96, 96], "Report consumes box and sticker from MAG01");
  eq(
    await rows(
      `select c.stock_item_id=$2 is_box, sum(c.requested_quantity)::int requested, sum(c.consumed_quantity)::int consumed
       from public.packaging_consumptions c join public.consignment_report_movements m on m.id=c.source_id
       where c.source_kind='consignment' and m.revision_id=$1 group by 1 order by 1`,
      [reportOp, box],
    ),
    [
      { is_box: false, requested: 4, consumed: 4 },
      { is_box: true, requested: 4, consumed: 4 },
    ],
    "Packaging receipts point to the report movements",
  );
  eq(
    await run("save_consignment_report", r1Payload, reportOp),
    { ...r1, replayed: true },
    "Identical replay",
  );
  await rejects(
    () =>
      run(
        "save_consignment_report",
        reportPayload(dates.prev, [rl(tA, 2, 0, price(tA))]),
        reportOp,
      ),
    "idempotency_conflict",
    "22023",
  );
  await rejects(() => run("save_consignment_report", r1Payload), "report_exists", "23505");
  // A newer catalog price never changes a line already in the report.
  web[tA] = 4700;
  observedAt[tA] = "2026-02-01T10:00:00.000Z";
  await db.query(
    "update public.shopify_catalog_variants set price_cents=4700,observed_at=$2 where stock_item_id=$1",
    [tA, observedAt[tA]],
  );
  const edit = (revision, lines, reason = "Il negozio ha corretto il resoconto") =>
    reportPayload(dates.prev, lines, { expected_revision: revision, reason });
  await rejects(
    () => run("save_consignment_report", edit(1, [rl(tA, 4), rl(tB, 1)], null)),
    "invalid_payload",
    "22023",
  );
  await rejects(
    () => run("save_consignment_report", edit(2, [rl(tA, 4), rl(tB, 1)])),
    "stale_version",
    "22023",
  );
  await rejects(
    () => run("save_consignment_report", edit(1, [rl(tA, 4, 0, price(tA)), rl(tB, 1)])),
    "invalid_payload",
    "22023",
  );
  const r2Op = randomUUID();
  eq(await run("save_consignment_report", edit(1, [rl(tA, 4), rl(tB, 1)]), r2Op, "founder"), {
    operation_id: r2Op,
    report_id: reportOp,
    revision: 2,
    replayed: false,
  });
  eq(
    (await reportLines(reportOp)).map((line) => [line.web_price_cents, line.gross_cents]),
    [
      [4500, 22000],
      [4999, 5999],
    ],
    "Locked price survives a catalog change",
  );
  eq([(await report(reportOp)).pieces, (await report(reportOp)).brand_cents], [5, 16799]);
  eq(await shopStock(), [1, 1, 3, 0], "Modification moves only the difference");
  eq(await pack(), [95, 95]);
  const r3Op = randomUUID();
  await run("save_consignment_report", edit(2, [rl(tA, 2), rl(tB, 1)]), r3Op);
  eq(
    await movementsOf("consignment_report_revision_id", r3Op),
    [
      {
        stock_item_id: tA,
        location_id: shop,
        kind: "consignment_sale_correction",
        quantity_delta: 2,
      },
    ],
    "Lower report: positive consignment_sale_correction",
  );
  eq(await shopStock(), [3, 1, 3, 0]);
  eq(await pack(), [95, 95], "A correction downwards returns no packaging");
  const r4Op = randomUUID();
  await run(
    "save_consignment_report",
    edit(3, [rl(tA, 2), rl(tB, 0), rl(tC, 2, 1, price(tC))]),
    r4Op,
  );
  eq(await shopStock(), [3, 2, 2, 0], "Before-count pieces are invoiced but not removed twice");
  eq(
    (await reportLines(reportOp)).map((line) => [
      line.stock_item_id,
      line.quantity,
      line.before_count_quantity,
      line.gross_cents,
      line.brand_cents,
    ]),
    [
      [tA, 2, 0, 11000, 6600],
      [tC, 2, 1, 8666, 5200],
    ],
    "Removed variant deleted, new variant priced",
  );
  eq(await pack(), [94, 94], "Only scaled pieces consume");
  const r5Op = randomUUID();
  await run("save_consignment_report", edit(4, [rl(tA, 4), rl(tC, 2, 1)]), r5Op);
  eq(await shopStock(), [1, 2, 2, 0]);
  eq(await pack(), [92, 92], "Known limit: lowering and raising again consumes again");
  eq(await report(reportOp), {
    revision: 5,
    brand_share_bps: 6000,
    markup_cents: 1000,
    pieces: 6,
    gross_cents: 30666,
    brand_cents: 18400,
    shop_cents: 12266,
    payment_state: "unpaid",
    invoice_number: null,
    invoice_revision: null,
  });
  eq(
    (
      await rows(
        "select revision, change_kind, reason is not null has_reason from public.consignment_report_revisions where report_id=$1 order by revision",
        [reportOp],
      )
    ).map((row) => [row.revision, row.change_kind, row.has_reason]),
    [
      [1, "lines", false],
      [2, "lines", true],
      [3, "lines", true],
      [4, "lines", true],
      [5, "lines", true],
    ],
    "One version per save, reason from version 2",
  );
  eq(await sideTables(), sideBefore, "Still no sales, facts or finance entries");

  // 5 · Ordini e consegne.
  const o1Op = randomUUID();
  const o1 = await run("save_consignment_order", orderPayload([ol(tD, 3), ol(tA, 3)]), o1Op);
  eq(o1, {
    operation_id: o1Op,
    order_id: o1Op,
    order_number: 1,
    status: "open",
    version: 1,
    replayed: false,
  });
  const o2 = await run("save_consignment_order", orderPayload([ol(tB, 1)]));
  eq(o2.order_number, 2, "Order numbers are progressive per shop");
  const o3 = await run("save_consignment_order", orderPayload([ol(tA, 1)], { location_id: shop3 }));
  eq(o3.order_number, 1, "Another shop starts again from 1");
  for (const lines of [[ol(sticker, 1)], [ol(tE, 1)]])
    await rejects(
      () => run("save_consignment_order", orderPayload(lines)),
      "invalid_tshirt",
      "22023",
    );
  for (const day of [dates.tomorrow, "2026-02-30"])
    await rejects(
      () => run("save_consignment_order", orderPayload([ol(tA, 1)], { requested_on: day })),
      "invalid_date",
      "22023",
    );
  for (const payload of [
    orderPayload([ol(tA, 1)], { order_id: o1.order_id }),
    orderPayload([ol(tA, 0)]),
    orderPayload([]),
  ])
    await rejects(() => run("save_consignment_order", payload), "invalid_payload", "22023");
  const editOrder = (order, version, lines) =>
    orderPayload(lines, {
      order_id: order,
      expected_version: version,
      note: "Richiesta su WhatsApp",
    });
  eq(
    (await run("save_consignment_order", editOrder(o1.order_id, 1, [ol(tA, 4), ol(tD, 3)])))
      .version,
    2,
  );
  await rejects(
    () => run("save_consignment_order", editOrder(o1.order_id, 1, [ol(tA, 4), ol(tD, 3)])),
    "stale_version",
    "22023",
  );
  const shipState = async () => [
    await centralStock(),
    await shopStock(),
    await count("public.consignment_transfers"),
    await count("public.consignment_shipments"),
  ];
  const beforeShip = await shipState();
  await rejects(
    () => run("ship_consignment_order", shipPayload(o1.order_id, 2, [ol(tA, 2), ol(tD, 3)])),
    "insufficient_stock",
    "22023",
    sku[tD],
  );
  eq(await shipState(), beforeShip, "Missing central stock: nothing delivered");
  await db.query(
    "insert into public.sales_orders(id,operation_id,payload_sha256,channel,occurred_at,operational_date,total_cents,payment_state,fulfillment_mode,fulfillment_state,created_by)values($1,$2,$3,'direct',now(),(now() at time zone 'Europe/Rome')::date,100,'unpaid','prepare','unfulfilled',$4)",
    [id(400), randomUUID(), "0".repeat(64), ids.founder],
  );
  await db.query(
    "insert into public.sales_order_lines(id,order_id,stock_item_id,location_id,sku_snapshot,quantity,unit_price_cents,discount_cents)values($1,$2,$3,$4,$5,100000,1,0)",
    [id(401), id(400), tA, central, sku[tA]],
  );
  await db.query(
    "insert into public.stock_reservations(order_line_id,stock_item_id,location_id,reserved_quantity)values($1,$2,$3,49)",
    [id(401), tA, central],
  );
  await rejects(
    () => run("ship_consignment_order", shipPayload(o1.order_id, 2, [ol(tA, 2)])),
    "insufficient_stock",
    "22023",
    sku[tA],
  );
  eq(await shipState(), beforeShip, "Reserved central stock is not delivered");
  await db.query(
    "update public.stock_reservations set reserved_quantity=0 where order_line_id=$1",
    [id(401)],
  );
  await rejects(
    () => run("ship_consignment_order", shipPayload(o1.order_id, 2, [ol(tA, 5)])),
    "exceeds_order",
    "22023",
    sku[tA],
  );
  await rejects(
    () => run("ship_consignment_order", shipPayload(o1.order_id, 2, [ol(tB, 1)])),
    "exceeds_order",
    "22023",
    sku[tB],
  );
  await rejects(
    () => run("ship_consignment_order", shipPayload(o1.order_id, 1, [ol(tA, 2)])),
    "stale_version",
    "22023",
  );
  const packBeforeShipping = await pack();
  const ship1Op = randomUUID();
  const ship1 = await run(
    "ship_consignment_order",
    shipPayload(o1.order_id, 2, [ol(tA, 2)]),
    ship1Op,
  );
  eq(ship1, {
    operation_id: ship1Op,
    shipment_id: ship1Op,
    order_id: o1.order_id,
    status: "open",
    version: 3,
    replayed: false,
  });
  eq(await centralStock(), [48, 50, 50, 2], "Central goes down");
  eq(await shopStock(), [3, 2, 2, 0], "Shop goes up");
  eq(
    await one(
      `select t.from_location_id, t.to_location_id, t.quantity, o.kind::text out_kind, i.kind::text in_kind
       from public.consignment_shipment_lines l join public.consignment_transfers t on t.id=l.transfer_id
       join public.stock_movements o on o.id=t.out_movement_id join public.stock_movements i on i.id=t.in_movement_id where l.shipment_id=$1`,
      [ship1Op],
    ),
    {
      from_location_id: central,
      to_location_id: shop,
      quantity: 2,
      out_kind: "transfer_out",
      in_kind: "transfer_in",
    },
    "Each shipment line is a consignment_transfers row with its two movements",
  );
  eq(
    await one(
      "select direction, order_id, warehouse_location_id, pieces::int pieces, created_by from public.consignment_shipments where id=$1",
      [ship1Op],
    ),
    {
      direction: "to_shop",
      order_id: o1.order_id,
      warehouse_location_id: central,
      pieces: 2,
      created_by: ids.consultant,
    },
  );
  for (const lines of [[ol(tA, 1), ol(tD, 3)], [ol(tD, 3)]])
    await rejects(
      () => run("save_consignment_order", editOrder(o1.order_id, 3, lines)),
      "below_delivered",
      "22023",
      sku[tA],
    );
  await run("save_consignment_order", editOrder(o1.order_id, 3, [ol(tA, 4), ol(tD, 1)]));
  const ship2 = await run(
    "ship_consignment_order",
    shipPayload(o1.order_id, 4, [ol(tD, 1), ol(tA, 2)]),
  );
  eq([ship2.status, ship2.version], ["delivered", 5], "Everything delivered");
  eq(await centralStock(), [46, 50, 50, 1]);
  eq(await shopStock(), [5, 2, 2, 1]);
  eq(
    await rows(
      "select stock_item_id, quantity, delivered_quantity, cancelled_quantity from public.consignment_order_lines where order_id=$1 order by stock_item_id",
      [o1.order_id],
    ),
    [
      { stock_item_id: tA, quantity: 4, delivered_quantity: 4, cancelled_quantity: 0 },
      { stock_item_id: tD, quantity: 1, delivered_quantity: 1, cancelled_quantity: 0 },
    ],
  );
  await rejects(
    () => run("ship_consignment_order", shipPayload(o1.order_id, 5, [ol(tA, 1)])),
    "order_not_open",
    "22023",
  );
  const closeOrder = (order, version, reason = "Il negozio non le vuole più") => ({
    schema_version: 1,
    order_id: order,
    expected_version: version,
    reason,
  });
  await rejects(
    () => run("close_consignment_order", closeOrder(o2.order_id, 1, "no")),
    "invalid_payload",
    "22023",
  );
  const closed2 = await run("close_consignment_order", closeOrder(o2.order_id, 1));
  eq([closed2.status, closed2.version], ["closed", 2]);
  eq(
    await one(
      "select o.close_reason, l.cancelled_quantity from public.consignment_orders o join public.consignment_order_lines l on l.order_id=o.id where o.id=$1",
      [o2.order_id],
    ),
    { close_reason: "Il negozio non le vuole più", cancelled_quantity: 1 },
    "Closing cancels the remainder with the reason",
  );
  await rejects(
    () => run("close_consignment_order", closeOrder(o2.order_id, 2)),
    "order_not_open",
    "22023",
  );
  await rejects(
    () => run("save_consignment_order", editOrder(o2.order_id, 2, [ol(tB, 2)])),
    "order_not_open",
    "22023",
  );
  const o4 = await run("save_consignment_order", orderPayload([ol(tA, 1), ol(tB, 1)]));
  eq(o4.order_number, 3);
  await run("save_consignment_order", editOrder(o4.order_id, 1, [ol(tA, 1)]));
  eq(
    await count("public.consignment_order_lines", "order_id=$1", [o4.order_id]),
    1,
    "A line without deliveries is deleted",
  );
  await run("close_consignment_order", closeOrder(o4.order_id, 2));
  const ship3 = await run("ship_consignment_order", shipPayload(o3.order_id, 1, [ol(tA, 1)]));
  eq(ship3.status, "delivered", "An uncounted shop can receive an order");
  eq(
    [await bal(tA, shop3), await bal(tA, central)],
    [1, 45],
    "Missing shop balance opens at 0, then receives",
  );
  const returnPayload = (lines, over = {}) => ({
    schema_version: 1,
    location_id: shop,
    occurred_at: now(),
    reason: "Fine stagione sintetica",
    lines,
    ...over,
  });
  const returnOp = randomUUID();
  await run("return_consignment_stock", returnPayload([ol(tA, 1)]), returnOp);
  eq([await bal(tA, shop), await bal(tA, central)], [4, 46], "Return: shop down, central up");
  eq(
    await one(
      "select direction, order_id, pieces::int pieces from public.consignment_shipments where id=$1",
      [returnOp],
    ),
    { direction: "to_warehouse", order_id: null, pieces: 1 },
  );
  await rejects(
    () => run("return_consignment_stock", returnPayload([ol(tC, 100)])),
    "insufficient_shop_stock",
    "22023",
    sku[tC],
  );
  await rejects(
    () => run("return_consignment_stock", returnPayload([ol(sticker, 1)])),
    "invalid_tshirt",
    "22023",
  );
  await db.exec("update public.app_settings set stock_adjustments_enabled=false");
  await rejects(
    () => run("return_consignment_stock", returnPayload([ol(tA, 1)])),
    "stock_mutations_disabled",
    "42501",
  );
  await rejects(
    () => run("ship_consignment_order", shipPayload(o4.order_id, 3, [ol(tA, 1)])),
    "stock_mutations_disabled",
    "42501",
  );
  await db.exec("update public.app_settings set stock_adjustments_enabled=true");
  eq(await pack(), packBeforeShipping, "Deliveries and returns consume no packaging");

  // 8 · Negozi.
  for (const who of ["consultant", "logistics"])
    await rejects(
      () => run("save_consignment_shop", shopPayload(), randomUUID(), who),
      "finance_access_required",
      "42501",
    );
  await rejects(
    () => run("save_consignment_shop", shopPayload(), randomUUID(), "finance", "aal1"),
    "finance_access_required",
    "42501",
  );
  for (const supply of [shop, external])
    await rejects(
      () => fin("save_consignment_shop", shopPayload({ supply_location_id: supply })),
      "invalid_location",
      "22023",
    );
  for (const payload of [
    shopPayload({ expected_version: 1 }),
    shopPayload({ active: false }),
    shopPayload({ name: "ab" }),
    shopPayload({ brand_share_bps: 10001 }),
    shopPayload({ markup_cents: -1 }),
    shopPayload({ active: "true" }),
  ])
    await rejects(() => fin("save_consignment_shop", payload), "invalid_payload", "22023");
  const newShopOp = randomUUID();
  const created = await fin("save_consignment_shop", shopPayload(), newShopOp);
  const shop2 = created.location_id;
  eq(
    { ...created, location_id: undefined },
    { operation_id: newShopOp, location_id: undefined, code: "NEG02", version: 1, replayed: false },
    "First free code",
  );
  eq(
    await one(
      "select l.code, l.name, l.location_type, l.active, s.brand_share_bps, s.first_counted_at, s.created_by from public.stock_locations l join public.consignment_shops s on s.location_id=l.id where l.id=$1",
      [shop2],
    ),
    {
      code: "NEG02",
      name: "Terzo negozio sintetico",
      location_type: "Negozio Conto Vendita",
      active: true,
      brand_share_bps: 6000,
      first_counted_at: null,
      created_by: ids.finance,
    },
  );
  const locationCount = await count("public.stock_locations");
  eq(
    (await fin("save_consignment_shop", shopPayload(), newShopOp)).replayed,
    true,
    "Replay creates no second shop",
  );
  eq(await count("public.stock_locations"), locationCount);
  const editShop = (location, version, over = {}) =>
    shopPayload({
      location_id: location,
      expected_version: version,
      name: "Negozio sintetico",
      ...over,
    });
  eq(
    (
      await fin(
        "save_consignment_shop",
        editShop(shop, 1, { brand_share_bps: 5500, markup_cents: 500 }),
      )
    ).version,
    2,
    "New terms",
  );
  await rejects(() => fin("save_consignment_shop", editShop(shop, 1)), "stale_version", "22023");
  await fin(
    "save_consignment_shop",
    editShop(shop, 2, {
      brand_share_bps: 5500,
      markup_cents: 500,
      name: "Negozio sintetico Milano",
    }),
    randomUUID(),
    "founder",
  );
  eq(
    (await one("select name from public.stock_locations where id=$1", [shop])).name,
    "Negozio sintetico Milano",
    "The name lives in stock_locations",
  );
  await rejects(
    () =>
      fin(
        "save_consignment_shop",
        editShop(shop, 3, { brand_share_bps: 5500, markup_cents: 500, active: false }),
      ),
    "shop_not_empty",
    "22023",
  );
  eq(
    (
      await fin(
        "save_consignment_shop",
        editShop(shop2, 1, { name: "Terzo negozio sintetico", active: false }),
      )
    ).version,
    2,
    "An empty shop closes",
  );
  await rejects(
    () =>
      run(
        "count_consignment_stock",
        countPayload([cl(tA, 0, null), cl(tB, 0, null), cl(tC, 0, null), cl(tD, 0, null)], {
          location_id: shop2,
        }),
      ),
    "invalid_location",
    "22023",
  );
  await rejects(
    () => run("save_consignment_order", orderPayload([ol(tA, 1)], { location_id: shop2 })),
    "invalid_location",
    "22023",
  );
  await fin("save_consignment_shop", editShop(shop2, 2, { name: "Terzo negozio sintetico" }));

  // 4 · Resoconto del mese corrente: condizioni nuove, «prima della conta».
  await rejects(
    () => run("save_consignment_report", reportPayload(dates.cur, [rl(tC, 1, 1, price(tC))])),
    "before_count_not_allowed",
    "22023",
  );
  await db.query(
    `insert into public.shopify_catalog_variants(shop_domain,variant_gid,product_gid,sku,product_title,product_type,status,price_cents,source_updated_at,observed_at,stock_item_id)
     values($1,$2,'gid://shopify/Product/12',$3,'T-shirt sintetica','T-shirt','ACTIVE',$4,$5,$5,$6)`,
    [domain, gid[tD], sku[tD], web[tD], observedAt[tD], tD],
  );
  const packBeforeCurrent = await pack();
  const curOp = randomUUID();
  await run(
    "save_consignment_report",
    reportPayload(dates.cur, [rl(tC, 1, 0, price(tC)), rl(tD, 1, 0, price(tD))]),
    curOp,
  );
  const lineC = split(3333, 500, 5500, 1),
    lineD = split(4510, 500, 5500, 1);
  eq([lineC.brand, lineD.brand], [2108, 2756], "Rounding half up on the full line");
  eq(
    await report(curOp),
    {
      revision: 1,
      brand_share_bps: 5500,
      markup_cents: 500,
      pieces: 2,
      gross_cents: lineC.gross + lineD.gross,
      brand_cents: lineC.brand + lineD.brand,
      shop_cents: lineC.shop + lineD.shop,
      payment_state: "unpaid",
      invoice_number: null,
      invoice_revision: null,
    },
    "New reports use the new terms (55%, +5 €)",
  );
  eq(
    [(await report(reportOp)).brand_share_bps, (await report(reportOp)).markup_cents],
    [6000, 1000],
    "Older report keeps its terms",
  );
  eq(await shopStock(), [4, 2, 1, 0]);
  eq(
    await pack(),
    packBeforeCurrent.map((value) => value - 2),
  );
  const recount = await run(
    "count_consignment_stock",
    countPayload([cl(tC, 1, 1)], { counted_at: now() }),
  );
  eq(
    await one("select movement_id from public.consignment_count_lines where count_id=$1", [
      recount.operation_id,
    ]),
    { movement_id: null },
    "Same quantity counted: no movement",
  );
  await run(
    "save_consignment_report",
    reportPayload(dates.cur, [rl(tC, 1, 1), rl(tD, 1)], {
      expected_revision: 1,
      reason: "Venduta prima della conta",
    }),
  );
  eq(await shopStock(), [4, 2, 2, 0], "Count this month: before-count piece returns to the shop");
  eq(
    [(await report(curOp)).pieces, (await report(curOp)).brand_cents],
    [2, 4864],
    "The piece stays in the invoice",
  );

  // 7 · Fattura e pagamenti.
  const invoice = (reportId, revision, over = {}) => ({
    schema_version: 1,
    report_id: reportId,
    expected_revision: revision,
    invoice_number: "SYN-12",
    invoice_date: dates.today,
    ...over,
  });
  for (const who of ["consultant", "logistics"]) {
    await rejects(
      () => run("set_consignment_invoice", invoice(reportOp, 5), randomUUID(), who),
      "finance_access_required",
      "42501",
    );
    await rejects(
      () => run("record_consignment_payment", payPayload(reportOp), randomUUID(), who),
      "finance_access_required",
      "42501",
    );
  }
  await rejects(
    () => run("set_consignment_invoice", invoice(reportOp, 5), randomUUID(), "finance", "aal1"),
    "finance_access_required",
    "42501",
  );
  for (const over of [{ invoice_date: dates.tomorrow }, { invoice_date: dates.before_prev }])
    await rejects(
      () => fin("set_consignment_invoice", invoice(reportOp, 5, over)),
      "invalid_date",
      "22023",
    );
  await rejects(
    () => fin("set_consignment_invoice", invoice(reportOp, 5, { invoice_date: null })),
    "invalid_payload",
    "22023",
  );
  await rejects(
    () => fin("set_consignment_invoice", invoice(reportOp, 4)),
    "stale_version",
    "22023",
  );
  await rejects(
    () => fin("set_consignment_invoice", invoice(randomUUID(), 1)),
    "report_not_found",
    "22023",
  );
  const invoiceOp = randomUUID();
  eq(await fin("set_consignment_invoice", invoice(reportOp, 5), invoiceOp), {
    operation_id: invoiceOp,
    report_id: reportOp,
    revision: 6,
    replayed: false,
  });
  eq(
    [(await report(reportOp)).invoice_number, (await report(reportOp)).invoice_revision],
    ["SYN-12", 6],
  );
  eq(
    (
      await one("select change_kind from public.consignment_report_revisions where id=$1", [
        invoiceOp,
      ])
    ).change_kind,
    "invoice",
  );
  const p1Op = randomUUID();
  const p1 = await fin("record_consignment_payment", payPayload(reportOp), p1Op);
  eq(p1, { operation_id: p1Op, payment_id: p1Op, report_id: reportOp, replayed: false });
  eq((await report(reportOp)).payment_state, "partial");
  await rejects(
    () => fin("record_consignment_payment", payPayload(reportOp, { amount_cents: 8401 })),
    "payment_exceeds_invoice",
    "22023",
  );
  await rejects(
    () => fin("record_consignment_payment", payPayload(reportOp, { method: "card" })),
    "invalid_payload",
    "22023",
  );
  await rejects(
    () =>
      fin("record_consignment_payment", payPayload(reportOp, { paid_at: dates.before_prev_start })),
    "invalid_date",
    "22023",
  );
  await rejects(
    () => fin("record_consignment_payment", payPayload(randomUUID())),
    "report_not_found",
    "22023",
  );
  const p2Op = randomUUID();
  await fin(
    "record_consignment_payment",
    payPayload(reportOp, {
      amount_cents: 8400,
      method: "cash",
      account_label: null,
      reference: null,
    }),
    p2Op,
    "production",
  );
  eq((await report(reportOp)).payment_state, "paid");
  eq(
    (
      await as("consultant", () =>
        db.query("select payment_state from public.consignment_reports where id=$1", [reportOp]),
      )
    ).rows[0].payment_state,
    "paid",
    "Every member sees the payment state",
  );
  eq(
    (await as("consultant", () => db.query("select * from public.consignment_report_payments")))
      .rows.length,
    0,
    "Payments are Finance only",
  );
  eq(
    (
      await as(
        "finance",
        () => db.query("select * from public.consignment_report_payments"),
        "aal2",
      )
    ).rows.length,
    2,
  );
  eq((await fin("update_consignment_payment", updatePayload(p1Op))).version, 2, "Payment edited");
  eq((await report(reportOp)).payment_state, "partial");
  await rejects(
    () => fin("update_consignment_payment", updatePayload(p1Op)),
    "stale_version",
    "22023",
  );
  await rejects(
    () =>
      fin("update_consignment_payment", updatePayload(p1Op, { expected_version: 2, reason: "" })),
    "invalid_payload",
    "22023",
  );
  await rejects(
    () => fin("update_consignment_payment", updatePayload(randomUUID())),
    "payment_not_found",
    "22023",
  );
  await rejects(
    () =>
      fin(
        "update_consignment_payment",
        updatePayload(p1Op, { expected_version: 2, amount_cents: 10001 }),
      ),
    "payment_exceeds_invoice",
    "22023",
  );
  await fin(
    "update_consignment_payment",
    updatePayload(p2Op, {
      amount_cents: 8400,
      method: "cash",
      account_label: null,
      reference: null,
      voided: true,
      reason: "Pagamento registrato due volte",
    }),
  );
  eq((await report(reportOp)).payment_state, "partial", "A voided payment no longer counts");
  eq(
    await rows(
      "select version::int version, reason, (snapshot->>'amount_cents')::int amount from public.consignment_payment_revisions where payment_id=$1 order by version",
      [p1Op],
    ),
    [
      { version: 1, reason: null, amount: 10000 },
      { version: 2, reason: "Importo corretto dal negozio", amount: 9000 },
    ],
    "Payment history with reasons",
  );
  await rejects(
    () =>
      fin(
        "update_consignment_payment",
        updatePayload(p2Op, {
          expected_version: 2,
          amount_cents: 9401,
          reason: "Pagamento ritrovato",
        }),
      ),
    "payment_exceeds_invoice",
    "22023",
  );
  await fin(
    "update_consignment_payment",
    updatePayload(p2Op, { expected_version: 2, amount_cents: 9400, reason: "Pagamento ritrovato" }),
  );
  eq((await report(reportOp)).payment_state, "paid", "Un-voided payment counts again");
  const r7Op = randomUUID();
  await run(
    "save_consignment_report",
    edit(6, [rl(tA, 3), rl(tC, 2, 1)], "Una maglia era stata contata due volte"),
    r7Op,
  );
  eq(
    await report(reportOp),
    {
      revision: 7,
      brand_share_bps: 6000,
      markup_cents: 1000,
      pieces: 5,
      gross_cents: 16500 + 8666,
      brand_cents: 9900 + 5200,
      shop_cents: 6600 + 3466,
      payment_state: "overpaid",
      invoice_number: "SYN-12",
      invoice_revision: 6,
    },
    "Reduced report after payment: overpaid, invoice kept, old terms kept",
  );
  eq(await shopStock(), [5, 2, 2, 0]);
  const curInvoice = await fin(
    "set_consignment_invoice",
    invoice(curOp, 2, { invoice_number: "SYN-13" }),
  );
  eq(curInvoice.revision, 3);
  const removed = await fin(
    "set_consignment_invoice",
    invoice(curOp, 3, { invoice_number: null, invoice_date: null }),
  );
  eq(
    [
      removed.revision,
      (await report(curOp)).invoice_number,
      (await report(curOp)).invoice_revision,
    ],
    [4, null, null],
    "Invoice can be removed, with a new version",
  );

  // 8 · Chiusura di un negozio: magliette, ordini aperti, resoconti da pagare.
  await run(
    "count_consignment_stock",
    countPayload([cl(tA, 0, null), cl(tB, 0, null), cl(tC, 0, null), cl(tD, 0, null)], {
      location_id: shop2,
    }),
  );
  const zeroOp = randomUUID();
  await run(
    "save_consignment_report",
    reportPayload(dates.cur, [], { location_id: shop2 }),
    zeroOp,
  );
  eq(
    await report(zeroOp),
    {
      revision: 1,
      brand_share_bps: 6000,
      markup_cents: 1000,
      pieces: 0,
      gross_cents: 0,
      brand_cents: 0,
      shop_cents: 0,
      payment_state: "nothing_due",
      invoice_number: null,
      invoice_revision: null,
    },
    "A month without sales: nothing to invoice",
  );
  eq(await count("public.consignment_report_movements", "revision_id=$1", [zeroOp]), 0);
  const closeShop = (version) =>
    fin(
      "save_consignment_shop",
      editShop(shop2, version, { name: "Terzo negozio sintetico", active: false }),
    );
  const o5 = await run("save_consignment_order", orderPayload([ol(tA, 1)], { location_id: shop2 }));
  await rejects(() => closeShop(3), "shop_not_empty", "22023");
  await run("ship_consignment_order", shipPayload(o5.order_id, 1, [ol(tA, 1)]));
  await rejects(() => closeShop(3), "shop_not_empty", "22023");
  const shop2Report = randomUUID();
  await run(
    "save_consignment_report",
    reportPayload(dates.prev, [rl(tA, 1, 0, price(tA))], { location_id: shop2 }),
    shop2Report,
  );
  eq([await bal(tA, shop2), (await report(shop2Report)).brand_cents], [0, 3420]);
  await rejects(() => closeShop(3), "shop_not_empty", "22023");
  await fin("record_consignment_payment", payPayload(shop2Report, { amount_cents: 3420 }));
  eq((await closeShop(3)).version, 4, "Empty, delivered and paid: the shop closes");

  // 10 · RPC precedenti dopo la migrazione.
  const oldTransfer = await run("transfer_consignment_stock", {
    schema_version: 1,
    stock_item_id: tA,
    from_location_id: central,
    to_location_id: shop,
    quantity: 1,
    reason: "Trasferimento sintetico",
    occurred_at: now(),
  });
  eq(oldTransfer.replayed, false, "transfer_consignment_stock still works");
  eq(await shopStock(), [6, 2, 2, 0]);
  const packBeforeOld = await pack();
  const oldSale = await run("register_consignment_sale", {
    schema_version: 1,
    stock_item_id: tA,
    location_id: shop,
    quantity: 1,
    reason: "Vendita sintetica in negozio",
    external_reference: randomUUID(),
    occurred_at: now(),
    shop_domain: domain,
    variant_gid: gid[tA],
    expected_web_price_cents: web[tA],
    expected_catalog_observed_at: observedAt[tA],
  });
  ok(oldSale.sale_id, "register_consignment_sale still works");
  eq(
    await pack(),
    packBeforeOld.map((value) => value - 1),
    "Old consignment_sales still consume packaging",
  );
  const settlement = await fin("record_consignment_settlement", {
    schema_version: 1,
    sale_id: oldSale.sale_id,
    amount_cents: 1000,
    occurred_at: now(),
    method: "bank_transfer",
    reference: "Regolamento sintetico",
  });
  eq(settlement.sale_id, oldSale.sale_id, "record_consignment_settlement still works");
  await run("register_manual_sale", {
    schema_version: 1,
    channel: "direct",
    occurred_at: now(),
    location_id: central,
    lines: [{ stock_item_id: tC, quantity: 1, unit_price_cents: 4000, discount_cents: 0 }],
    fulfillment_mode: "delivered_now",
    payment: { status: "unpaid" },
    reason: "Vendita diretta sintetica",
  });
  eq(
    await pack(),
    packBeforeOld.map((value) => value - 2),
    "Fulfillments still consume packaging",
  );
  eq(await count("public.packaging_automation_failures"), 0, "No packaging failure");

  // 06 R7 · Le quantità del negozio non si rettificano dal magazzino.
  const insertMovement = (item, location, kind, delta) =>
    db.query(
      "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,$4,$5,'Movimento sintetico')",
      [randomUUID(), item, location, kind, delta],
    );
  await rejects(() => insertMovement(tA, shop, "adjustment", -1), "shop_location", "22023");
  await rejects(
    () => insertMovement(sticker, closedShop, "adjustment", 1),
    "shop_location",
    "22023",
  );
  await rejects(
    () =>
      as("consultant", () =>
        db.query("select public.adjust_stock($1,$2,$3,-1,'Rettifica sintetica')", [
          randomUUID(),
          tA,
          shop,
        ]),
      ),
    "shop_location",
    "22023",
  );
  eq((await shopStock())[0], 5, "Shop quantity unchanged by rejected adjustments");
  const centralB = await bal(tB, central);
  await as("consultant", () =>
    db.query("select public.adjust_stock($1,$2,$3,1,'Rettifica sintetica')", [
      randomUUID(),
      tB,
      central,
    ]),
  );
  eq(await bal(tB, central), centralB + 1, "Adjustment on MAG01 accepted");
  await insertMovement(tE, shop, "opening", 0);
  eq(await bal(tE, shop), 0, "Opening on the shop accepted");
  await insertMovement(tE, shop, "transfer_in", 1);
  eq(await bal(tE, shop), 1, "transfer_in on the shop accepted");

  // 9 · Audit: ogni comando lascia righe con l'autore.
  for (const [table, operation, actor] of [
    ["consignment_counts", "INSERT", "consultant"],
    ["consignment_count_lines", "INSERT", "consultant"],
    ["consignment_reports", "INSERT", "consultant"],
    ["consignment_reports", "UPDATE", "founder"],
    ["consignment_reports", "UPDATE", "finance"],
    ["consignment_report_lines", "DELETE", "consultant"],
    ["consignment_report_revisions", "INSERT", "founder"],
    ["consignment_report_movements", "INSERT", "consultant"],
    ["consignment_orders", "UPDATE", "consultant"],
    ["consignment_order_lines", "DELETE", "consultant"],
    ["consignment_shipments", "INSERT", "consultant"],
    ["consignment_shipment_lines", "INSERT", "consultant"],
    ["consignment_report_payments", "INSERT", "production"],
    ["consignment_report_payments", "UPDATE", "finance"],
    ["consignment_payment_revisions", "INSERT", "finance"],
    ["consignment_shops", "INSERT", "finance"],
    ["consignment_shops", "UPDATE", "founder"],
    ["stock_locations", "INSERT", "finance"],
    ["stock_locations", "UPDATE", "founder"],
  ])
    ok(
      await count("public.audit_logs", "table_name=$1 and operation=$2 and actor_id=$3", [
        table,
        operation,
        ids[actor],
      ]),
      `Audit ${table} ${operation} by ${actor}`,
    );
  eq(
    await one(
      "select record_key->>'id' id, record_key->>'location_id' location from public.audit_logs where table_name='consignment_counts' and record_key->>'id'=$1",
      [countOp],
    ),
    { id: countOp, location: shop },
    "Audit key carries the shop",
  );

  // 1 · Permessi.
  for (const table of tables) {
    eq(
      await one(
        `select c.relrowsecurity rls, has_table_privilege('anon',c.oid,'select') anon_select,
          has_table_privilege('authenticated',c.oid,'select') read,
          has_table_privilege('authenticated',c.oid,'insert') or has_table_privilege('authenticated',c.oid,'update')
            or has_table_privilege('authenticated',c.oid,'delete') write,
          has_table_privilege('service_role',c.oid,'insert') service_write
         from pg_class c where c.oid=('public.'||$1)::regclass`,
        [table],
      ),
      { rls: true, anon_select: false, read: true, write: false, service_write: false },
      `${table}: RLS, select only`,
    );
    const visible = async (who, aal = "aal1") =>
      (await as(who, () => db.query(`select count(*)::int n from public.${table}`), aal)).rows[0].n;
    if (financeTables.has(table)) {
      eq(await visible("consultant"), 0, `${table} hidden from members without Finance`);
      ok((await visible("finance", "aal2")) > 0, `${table} readable with Finance`);
    } else ok((await visible("consultant")) > 0, `${table} readable by members`);
    eq(
      [await visible("outsider"), await visible("inactive")],
      [0, 0],
      `${table} hidden from non-members`,
    );
  }
  await rejects(
    () =>
      as("outsider", () => db.query("select * from public.consignment_reports"), "aal1", "anon"),
    null,
    "42501",
  );
  for (const sql of [
    "insert into public.consignment_counts(id,location_id,counted_at,full_count,pieces,created_by)values(gen_random_uuid(),'93000000-0000-4000-8000-000000000101',now(),false,0,auth.uid())",
    "update public.consignment_reports set pieces=0",
    "delete from public.consignment_order_lines",
    "update public.consignment_shops set brand_share_bps=10000",
  ])
    await rejects(() => as("founder", () => db.query(sql), "aal2"), null, "42501");
  for (const table of appendOnly) {
    await rejects(() => db.query(`update public.${table} set id=id`), null, "42501");
    await rejects(() => db.query(`delete from public.${table}`), null, "42501");
  }
  for (const command of commands)
    eq(
      await one(
        `select has_function_privilege('anon',$1,'execute') anon, has_function_privilege('authenticated',$1,'execute') wrapper,
          has_function_privilege('authenticated',$2,'execute') processor`,
        [`public.${command}(uuid,jsonb)`, `private.${command}(uuid,jsonb)`],
      ),
      { anon: false, wrapper: true, processor: true },
      `${command} executable only by authenticated`,
    );
  for (const helper of [
    "private.consignment_shop_for_update(uuid,boolean)",
    "private.consignment_move(uuid,uuid,uuid,bigint,text,timestamptz,jsonb)",
    "private.consignment_ensure_shop_balance(uuid,uuid)",
    "private.consignment_refresh_payment_state(uuid)",
    "private.consignment_period(jsonb)",
    "private.reject_shop_adjustment()",
  ])
    eq(
      (await one("select has_function_privilege('authenticated',$1,'execute') granted", [helper]))
        .granted,
      false,
      `${helper} not executable by clients`,
    );
  await rejects(
    () =>
      as("consultant", () =>
        db.query("select private.consignment_ensure_shop_balance($1,$2)", [tB, shop3]),
      ),
    null,
    "42501",
  );

  // 2 · Con due magazzini attivi il magazzino di partenza resta da scegliere.
  await db.query(
    "insert into public.stock_locations(id,code,name,location_type)values($1,'MAG02','Secondo magazzino sintetico','Magazzino'),($2,'NEG07','Negozio sintetico nuovo','Negozio Conto Vendita')",
    [id(107), id(108)],
  );
  const shopsBefore = await rows(
    "select * from public.consignment_shops where location_id<>$1 order by location_id",
    [id(108)],
  );
  await db.exec(insertShops);
  eq(
    await one(
      "select supply_location_id, brand_share_bps, first_counted_at from public.consignment_shops where location_id=$1",
      [id(108)],
    ),
    { supply_location_id: null, brand_share_bps: 6000, first_counted_at: null },
    "Two active warehouses: no supply chosen",
  );
  eq(
    await rows(
      "select * from public.consignment_shops where location_id<>$1 order by location_id",
      [id(108)],
    ),
    shopsBefore,
    "Existing shop rows untouched",
  );

  console.log(
    `PASS ${checks} consignment monthly checks; synthetic fixtures, mocked Auth, no cloud.`,
  );
} finally {
  await db.close();
}
