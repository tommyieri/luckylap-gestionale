// test-db: postgres minimo 16
// Conto vendita semplice su PostgreSQL 17 reale: due backend che si sovrappongono e
// un osservatore. Auth sintetico, cluster usa e getta in /private/tmp, nessun DSN né cloud.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const [binaryDirectory, pgModule] = process.argv.slice(2);
if (!binaryDirectory?.startsWith("/") || !pgModule?.startsWith("/"))
  throw Error("Pass absolute PostgreSQL17 bin and external pg/lib/index.js paths.");
const imported = await import(pathToFileURL(pgModule).href);
const Client = imported.Client ?? imported.default?.Client;
const run = (binary, args) => {
  const result = spawnSync(join(binaryDirectory, binary), args, {
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.status !== 0) throw Error(`${binary}: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
};
const version = run("postgres", ["--version"]);
assert.match(version, /PostgreSQL\) 17\./);
const directory = mkdtempSync("/private/tmp/luckylap-consignment-lock-");
const data = join(directory, "data"),
  socket = join(directory, "socket");
mkdirSync(socket, { mode: 0o700 });
const port = await new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const value = server.address().port;
    server.close(() => resolvePort(value));
  });
});
const clients = [];
let started = false;
let observer;
let a;
let b;
let aPid;
let bPid;
let checks = 0;
const uuid = (n) => `94000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const operator = uuid(1),
  colleague = uuid(2),
  financeUser = uuid(3),
  founder = uuid(4),
  central = uuid(100),
  shop = uuid(101),
  lastShirt = uuid(200),
  shirt = uuid(201);
const sku = { [lastShirt]: "SYN-LAST-M", [shirt]: "SYN-SHIRT-M" };
const domain = "synthetic.myshopify.com",
  variant = "gid://shopify/ProductVariant/201",
  observed = "2026-01-15T10:00:00.000Z";
const equal = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const scalar = async (client, sql, args = []) => (await client.query(sql, args)).rows[0].value;
async function connect(label) {
  const client = new Client({
    host: socket,
    port,
    user: "postgres",
    database: "postgres",
    ssl: false,
    application_name: `luckylap-consignment-${label}`,
    statement_timeout: 15000,
    query_timeout: 18000,
    connectionTimeoutMillis: 5000,
  });
  client.on("error", () => {});
  await client.connect();
  clients.push(client);
  return client;
}
async function begin(client, user, aal = "aal1") {
  await client.query("begin isolation level read committed");
  await client.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: user, aal }),
  ]);
  await client.query("set local role authenticated");
}
const call = (client, kind, payload, op = randomUUID()) =>
  client
    .query(`select public.${kind}($1,$2::jsonb) result`, [op, JSON.stringify(payload)])
    .then((response) => response.rows[0].result);
const settle = (promise) =>
  promise.then(
    (result) => ({ ok: true, result }),
    (error) => ({ ok: false, code: error.code, message: error.message, detail: error.detail }),
  );
async function command(user, kind, payload, aal = "aal1") {
  await begin(observer, user, aal);
  try {
    const result = await call(observer, kind, payload);
    await observer.query("commit");
    return result;
  } catch (error) {
    await observer.query("rollback");
    throw error;
  }
}
// The waiter is blocked on a lock held by the holder: a real overlap, not a sequential run.
async function waitsOn(waiter, holder) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const row = (
      await observer.query(
        "select state,wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1",
        [waiter],
      )
    ).rows[0];
    if (row?.state === "active" && row.wait_event_type === "Lock" && row.blockers.includes(holder))
      return true;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw Error("No real lock overlap between the two consignment backends.");
}
const blockedByA = () => waitsOn(bPid, aPid);
const balance = async (item, location) =>
  scalar(
    observer,
    "select quantity::int value from public.stock_balances where stock_item_id=$1 and location_id=$2",
    [item, location],
  );
const month = async () =>
  scalar(observer, "select to_char(now() at time zone 'Europe/Rome','YYYY-MM') value");
const reportPayload = (period, quantity, over = {}) => ({
  schema_version: 1,
  location_id: shop,
  period_month: period,
  expected_revision: null,
  reason: null,
  lines: [
    {
      stock_item_id: shirt,
      quantity,
      before_count_quantity: 0,
      price: over.expected_revision
        ? null
        : {
            shop_domain: domain,
            variant_gid: variant,
            expected_web_price_cents: 4500,
            expected_catalog_observed_at: observed,
          },
    },
  ],
  ...over,
});
const orderFor = (item, quantity) =>
  command(operator, "save_consignment_order", {
    schema_version: 1,
    order_id: null,
    expected_version: null,
    location_id: shop,
    requested_on: new Date().toISOString().slice(0, 10),
    note: "",
    lines: [{ stock_item_id: item, quantity }],
  });
const shipPayload = (order, item, quantity) => ({
  schema_version: 1,
  order_id: order.order_id,
  expected_version: order.version,
  occurred_at: new Date().toISOString(),
  lines: [{ stock_item_id: item, quantity }],
});
const salePayload = () => ({
  schema_version: 1,
  channel: "direct",
  occurred_at: new Date(Date.now() - 1000).toISOString(),
  location_id: central,
  lines: [{ stock_item_id: lastShirt, quantity: 1, unit_price_cents: 4000, discount_cents: 0 }],
  fulfillment_mode: "delivered_now",
  payment: { status: "unpaid" },
  reason: "Vendita diretta sintetica",
});
const negative = () =>
  scalar(observer, "select count(*)::int value from public.stock_balances where quantity<0");

try {
  run("initdb", [
    "-D",
    data,
    "-L",
    resolve(binaryDirectory, "../share/postgresql"),
    "--username=postgres",
    "--no-locale",
    "--encoding=UTF8",
    "--auth-local=trust",
    "--auth-host=reject",
  ]);
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    join(directory, "postgres.log"),
    "-o",
    `-p ${port} -k ${socket} -c listen_addresses='' -c unix_socket_permissions=0700 -c max_connections=8`,
    "-w",
    "start",
  ]);
  started = true;
  observer = await connect("observer");
  a = await connect("a");
  b = await connect("b");
  aPid = await scalar(a, "select pg_backend_pid() value");
  bPid = await scalar(b, "select pg_backend_pid() value");
  equal(aPid !== bPid, true, "Two distinct real PostgreSQL backends");
  await observer.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;`);
  const migrations = new URL("../migrations/", import.meta.url);
  const names = readdirSync(migrations).sort();
  const migration = (suffix) => {
    const found = names.filter((name) => name.endsWith(`_${suffix}.sql`));
    assert.equal(found.length, 1, `Exactly one migration ${suffix}`);
    return readFileSync(new URL(found[0], migrations), "utf8");
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
    await observer.query(migration(suffix));
  for (const [user, role, financeAccess] of [
    [operator, "consultant", false],
    [colleague, "logistics", false],
    [financeUser, "finance", true],
    [founder, "founder", true],
  ]) {
    await observer.query("insert into auth.users(id) values($1)", [user]);
    await observer.query("insert into public.profiles(user_id,display_name) values($1,$2)", [
      user,
      `Sintetico ${role}`,
    ]);
    await observer.query(
      "insert into public.memberships(user_id,role,finance_access) values($1,$2,$3)",
      [user, role, financeAccess],
    );
  }
  await observer.query(
    "insert into public.stock_locations(id,code,name,location_type) values($1,'MAG01','Magazzino sintetico','Magazzino'),($2,'NEG01','Negozio sintetico','Negozio Conto Vendita')",
    [central, shop],
  );
  await observer.query(
    "insert into public.products(id,model,category) values($1,'GT3RS','T-shirt')",
    [uuid(300)],
  );
  for (const [item, size] of [
    [lastShirt, "S"],
    [shirt, "M"],
  ]) {
    await observer.query(
      "insert into public.stock_items(id,kind,sku,name,list_price_eur) values($1,'product',$2,$3,40)",
      [item, sku[item], `T-shirt sintetica ${size}`],
    );
    await observer.query(
      "insert into public.product_variants(stock_item_id,product_id,color,size) values($1,$2,'Blu',$3)",
      [item, uuid(300), size],
    );
  }
  for (const [item, location, quantity] of [
    [lastShirt, central, 1],
    [shirt, central, 20],
    [lastShirt, shop, 0],
    [shirt, shop, 0],
  ])
    await observer.query(
      "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason) values($1,$2,$3,'opening',$4,'Conta sintetica')",
      [randomUUID(), item, location, quantity],
    );
  await observer.query(
    `insert into public.shopify_catalog_variants(shop_domain,variant_gid,product_gid,sku,product_title,product_type,status,price_cents,source_updated_at,observed_at,stock_item_id)
     values($1,$2,'gid://shopify/Product/20',$3,'T-shirt sintetica','T-shirt','ACTIVE',4500,$4,$4,$5)`,
    [domain, variant, sku[shirt], observed, shirt],
  );
  await observer.query(migration("consignment_monthly"));
  await observer.query(
    "update public.app_settings set stock_adjustments_enabled=true,manual_sales_enabled=true,sales_started_at=now()-interval '400 days'",
  );
  await command(operator, "count_consignment_stock", {
    schema_version: 1,
    location_id: shop,
    counted_at: new Date().toISOString(),
    note: "",
    lines: [
      { stock_item_id: lastShirt, quantity: 0, expected_quantity: 0 },
      { stock_item_id: shirt, quantity: 10, expected_quantity: 0 },
    ],
  });
  const period = await month();

  // 1. Two creations of the same month: the shop lock lets one win, the other sees it.
  await begin(a, operator);
  const created = await call(a, "save_consignment_report", reportPayload(period, 2));
  await begin(b, colleague);
  let pending = settle(call(b, "save_consignment_report", reportPayload(period, 3)));
  await blockedByA();
  equal(
    await scalar(observer, "select count(*)::int value from public.consignment_reports"),
    0,
    "Waiting creation cannot see the uncommitted report",
  );
  await a.query("commit");
  const duplicate = await pending;
  await b.query("rollback");
  equal(
    { ok: duplicate.ok, code: duplicate.code, message: duplicate.message },
    { ok: false, code: "23505", message: "report_exists" },
    "Second creation of the same month: report_exists",
  );
  equal(
    [
      await scalar(observer, "select count(*)::int value from public.consignment_reports"),
      await balance(shirt, shop),
    ],
    [1, 8],
    "One report, the shop goes down once",
  );

  // 2. Two edits from the same version: one wins, the other is stale.
  const edit = (quantity) =>
    reportPayload(period, quantity, { expected_revision: 1, reason: "Correzione sintetica" });
  await begin(a, operator);
  await call(a, "save_consignment_report", edit(4));
  await begin(b, colleague);
  pending = settle(call(b, "save_consignment_report", edit(5)));
  await blockedByA();
  await a.query("commit");
  const stale = await pending;
  await b.query("rollback");
  equal(
    { ok: stale.ok, code: stale.code, message: stale.message },
    { ok: false, code: "22023", message: "stale_version" },
    "Second edit from the same version: stale_version",
  );
  equal(
    (
      await observer.query(
        "select revision, pieces::int pieces, (select count(*)::int from public.consignment_report_revisions) versions from public.consignment_reports where id=$1",
        [created.report_id],
      )
    ).rows[0],
    { revision: 2, pieces: 4, versions: 2 },
    "Exactly one second version",
  );
  equal(await balance(shirt, shop), 6, "Shop stock follows the winning version only");

  // 3. Delivery of the last central T-shirt against a direct sale, both orders.
  const firstOrder = await orderFor(lastShirt, 1);
  await begin(a, operator);
  await call(a, "ship_consignment_order", shipPayload(firstOrder, lastShirt, 1));
  await begin(b, colleague);
  pending = settle(call(b, "register_manual_sale", salePayload()));
  await blockedByA();
  await a.query("commit");
  const lateSale = await pending;
  await b.query("rollback");
  equal(
    { ok: lateSale.ok, code: lateSale.code, message: lateSale.message },
    { ok: false, code: "22023", message: "insufficient_ready_stock" },
    "Direct sale after the delivery finds no T-shirt",
  );
  equal(
    [await balance(lastShirt, central), await balance(lastShirt, shop), await negative()],
    [0, 1, 0],
    "Delivery won: no negative balance",
  );
  await observer.query(
    "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason) values($1,$2,$3,'adjustment',1,'Rettifica sintetica')",
    [randomUUID(), lastShirt, central],
  );
  const secondOrder = await orderFor(lastShirt, 1);
  await begin(b, colleague);
  await call(b, "register_manual_sale", salePayload());
  await begin(a, operator);
  pending = settle(call(a, "ship_consignment_order", shipPayload(secondOrder, lastShirt, 1)));
  await waitsOn(aPid, bPid);
  await b.query("commit");
  const lateDelivery = await pending;
  await a.query("rollback");
  equal(
    {
      ok: lateDelivery.ok,
      code: lateDelivery.code,
      message: lateDelivery.message,
      detail: lateDelivery.detail,
    },
    { ok: false, code: "22023", message: "insufficient_stock", detail: sku[lastShirt] },
    "Delivery after the direct sale is refused with the SKU",
  );
  equal(
    [
      await balance(lastShirt, central),
      await balance(lastShirt, shop),
      await scalar(observer, "select count(*)::int value from public.fulfillment_lines"),
      await negative(),
    ],
    [0, 1, 1, 0],
    "Sale won: nothing delivered, no negative balance",
  );

  // 4. A count against a delivery: the count never absorbs the delivered T-shirts.
  const thirdOrder = await orderFor(shirt, 2);
  const countsBefore = await scalar(
    observer,
    "select count(*)::int value from public.consignment_counts",
  );
  await begin(a, operator);
  await call(a, "ship_consignment_order", shipPayload(thirdOrder, shirt, 2));
  await begin(b, colleague);
  pending = settle(
    call(b, "count_consignment_stock", {
      schema_version: 1,
      location_id: shop,
      counted_at: new Date().toISOString(),
      note: "",
      lines: [{ stock_item_id: shirt, quantity: 6, expected_quantity: 6 }],
    }),
  );
  await blockedByA();
  await a.query("commit");
  const staleCount = await pending;
  await b.query("rollback");
  equal(
    {
      ok: staleCount.ok,
      code: staleCount.code,
      message: staleCount.message,
      detail: staleCount.detail,
    },
    { ok: false, code: "22023", message: "stock_changed", detail: sku[shirt] },
    "Count read before the delivery is refused",
  );
  equal(
    [
      await balance(shirt, shop),
      await scalar(observer, "select count(*)::int value from public.consignment_counts"),
    ],
    [8, countsBefore],
    "Delivered T-shirts stay in the shop, no count written",
  );

  // 5. Two payments that together exceed the amount to invoice.
  const due = await scalar(
    observer,
    "select brand_cents::int value from public.consignment_reports where id=$1",
    [created.report_id],
  );
  const payment = (amount) => ({
    schema_version: 1,
    report_id: created.report_id,
    amount_cents: amount,
    paid_at: new Date().toISOString(),
    method: "bank_transfer",
    account_label: "Conto sintetico",
    reference: null,
  });
  const amount = Math.ceil((due * 6) / 10);
  await begin(a, financeUser, "aal2");
  await call(a, "record_consignment_payment", payment(amount));
  await begin(b, founder, "aal2");
  pending = settle(call(b, "record_consignment_payment", payment(amount)));
  await blockedByA();
  await a.query("commit");
  const excess = await pending;
  await b.query("rollback");
  equal(
    { ok: excess.ok, code: excess.code, message: excess.message },
    { ok: false, code: "22023", message: "payment_exceeds_invoice" },
    "Second payment over the amount due is refused",
  );
  equal(
    await observer
      .query(
        "select (select sum(amount_cents)::int from public.consignment_report_payments where not voided) paid, payment_state from public.consignment_reports where id=$1",
        [created.report_id],
      )
      .then((response) => response.rows[0]),
    { paid: amount, payment_state: "partial" },
    "Only one payment, state partial",
  );
  equal(await negative(), 0, "No negative balance anywhere");
  console.log(
    JSON.stringify({ version, checks, backends: [aPid, bPid], period, due, amount }, null, 2),
  );
  console.log(
    `PASS ${checks} real PostgreSQL consignment concurrency checks. Auth is synthetic; no cloud or real inventory touched.`,
  );
} catch (error) {
  console.error({
    message: error.message,
    code: error.code,
    detail: error.detail,
    where: error.where,
  });
  process.exitCode = 1;
} finally {
  if (observer)
    for (const pid of [aPid, bPid].filter(Boolean))
      try {
        await observer.query("select pg_terminate_backend($1)", [pid]);
      } catch {}
  await Promise.allSettled(clients.map((client) => client.end()));
  if (started)
    try {
      run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
    } catch {
      process.exitCode = 1;
    }
  rmSync(directory, { recursive: true, force: true });
}
