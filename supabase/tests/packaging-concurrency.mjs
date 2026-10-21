// Real PostgreSQL 17, two overlapping worker backends and one observer.
// Auth is an explicit synthetic fixture. No DSN, cloud or production claims.
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
const directory = mkdtempSync("/private/tmp/luckylap-packaging-lock-");
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
const actor = randomUUID(),
  location = randomUUID();
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
    application_name: `luckylap-packaging-${label}`,
    statement_timeout: 15000,
    query_timeout: 18000,
    connectionTimeoutMillis: 5000,
  });
  client.on("error", () => {});
  await client.connect();
  clients.push(client);
  return client;
}
async function begin(client) {
  await client.query("begin isolation level read committed");
  await client.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: actor, aal: "aal1" }),
  ]);
  await client.query("set local role authenticated");
}
async function blockedByA() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const row = (
      await observer.query(
        "select pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1",
        [bPid],
      )
    ).rows[0];
    if (
      row?.state === "active" &&
      row.wait_event_type === "Lock" &&
      row.wait_event === "advisory" &&
      row.blockers.includes(aPid)
    )
      return row;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw Error("No real advisory-lock overlap between the packaging worker backends.");
}
async function fixtureShirt(label) {
  const item = randomUUID(),
    product = randomUUID();
  await observer.query("insert into public.products(id,model,category) values($1,$2,'T-shirt')", [
    product,
    `SYNTHETIC-${label}`,
  ]);
  await observer.query(
    "insert into public.stock_items(id,kind,sku,name) values($1,'product',$2,$3)",
    [item, `SYNTHETIC-${label}`, `Synthetic ${label}`],
  );
  await observer.query(
    "insert into public.product_variants(stock_item_id,product_id,color,size) values($1,$2,'Synthetic','M')",
    [item, product],
  );
  await observer.query(
    "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason) values($1,$2,$3,'opening',1000,'Synthetic count')",
    [randomUUID(), item, location],
  );
  return item;
}
async function fixtureOrder(item, quantity) {
  const order = randomUUID(),
    line = randomUUID();
  await observer.query(
    `insert into public.sales_orders(id,operation_id,payload_sha256,channel,occurred_at,operational_date,total_cents,payment_state,fulfillment_mode,fulfillment_state,created_by)
    values($1,$2,$3,'direct',clock_timestamp()-interval '1 second',current_date,$4,'unpaid','prepare','unfulfilled',$5)`,
    [order, randomUUID(), "0".repeat(64), quantity * 100, actor],
  );
  await observer.query(
    `insert into public.sales_order_lines(id,order_id,stock_item_id,location_id,sku_snapshot,quantity,unit_price_cents,discount_cents)
    values($1,$2,$3,$4,'SYNTHETIC',$5,100,0)`,
    [line, order, item, location, quantity],
  );
  await observer.query(
    "insert into public.stock_reservation_events(operation_id,order_line_id,kind,quantity_delta,created_by) values($1,$2,'allocate',$3,$4)",
    [randomUUID(), line, quantity, actor],
  );
  return { order, line, quantity };
}
const fulfill = async (client, order) => {
  const occurred = await scalar(client, "select transaction_timestamp() value");
  return client.query("select public.fulfill_order_lines($1,$2::jsonb) result", [
    randomUUID(),
    JSON.stringify({
      order_id: order.order,
      lines: [{ order_line_id: order.line, quantity: order.quantity }],
      occurred_at: occurred.toISOString(),
      reason: "Synthetic packaging lock proof",
    }),
  ]);
};
const state = async (box, sticker) => ({
  balances: (
    await observer.query(
      "select quantity::int quantity from public.stock_balances where stock_item_id in($1,$2) and location_id=$3 order by stock_item_id",
      [box, sticker, location],
    )
  ).rows.map((row) => row.quantity),
  fulfillments: await scalar(observer, "select count(*)::int value from public.fulfillment_lines"),
  receipts: await scalar(observer, "select count(*)::int value from public.packaging_consumptions"),
  entries: await scalar(
    observer,
    "select count(*)::int value from public.packaging_consumption_entries",
  ),
});

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
  equal(aPid !== bPid, true, "Two distinct real PostgreSQL worker backends");
  await observer.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;`);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations)
    .filter((name) =>
      /_(initial_schema|sales_ecosystem|sales_lifecycle|packaging_materials|shopify_catalog|consignment_workflow|shopify_sales_core|packaging_automatic_consumption)\.sql$/.test(
        name,
      ),
    )
    .sort())
    await observer.query(readFileSync(new URL(name, migrations), "utf8"));
  await observer.query("insert into auth.users(id) values($1)", [actor]);
  await observer.query(
    "insert into public.profiles(user_id,display_name) values($1,'Synthetic operator')",
    [actor],
  );
  await observer.query("insert into public.memberships(user_id,role) values($1,'consultant')", [
    actor,
  ]);
  await observer.query(
    "insert into public.stock_locations(id,code,name,location_type) values($1,'MAG01','Synthetic Magadzino','Magazzino')",
    [location],
  );
  const shirtA = await fixtureShirt("SHIRT-A"),
    shirtB = await fixtureShirt("SHIRT-B");
  const activated = await scalar(observer, "select private.activate_tshirt_packaging() value");
  const box = activated.box_item_id,
    sticker = activated.sticker_item_id;
  await observer.query(
    "update public.app_settings set stock_adjustments_enabled=true,manual_sales_enabled=true,sales_started_at=clock_timestamp()-interval '1 day'",
  );
  const first = await fixtureOrder(shirtA, 1),
    second = await fixtureOrder(shirtA, 2),
    third = await fixtureOrder(shirtB, 3);

  // A fulfills but holds its transaction open. The absolute count in B has the
  // old expected=100 and must wait on packaging, then reject against 99.
  await begin(a);
  await fulfill(a, first);
  await begin(b);
  let pending = b
    .query("select public.adjust_packaging_quantity($1,$2::jsonb)", [
      randomUUID(),
      JSON.stringify({
        schema_version: 1,
        stock_item_id: box,
        expected_quantity: 100,
        quantity: 120,
        reason: "Synthetic stale absolute count",
      }),
    ])
    .then(
      () => ({ ok: true }),
      (error) => ({ ok: false, code: error.code, message: error.message }),
    );
  const countWait = await blockedByA();
  equal(
    { blocked: countWait.blockers.includes(aPid), ...(await state(box, sticker)) },
    { blocked: true, balances: [100, 100], fulfillments: 0, receipts: 0, entries: 0 },
    "Waiting count cannot observe any uncommitted delivery or packaging receipt",
  );
  await a.query("commit");
  const stale = await pending;
  await b.query("rollback");
  equal(
    {
      ...stale,
      manualReceipts: await scalar(
        observer,
        "select count(*)::int value from private.packaging_inventory_receipts",
      ),
    },
    { ok: false, code: "22023", message: "packaging_quantity_changed", manualReceipts: 0 },
    "Stale absolute count fails CAS and leaves no receipt or overwritten balance",
  );
  equal(
    await state(box, sticker),
    { balances: [99, 99], fulfillments: 1, receipts: 2, entries: 2 },
    "Committed first delivery has exactly one box and one sticker receipt",
  );

  // The orders use different product balances and order rows. Therefore B's
  // observed advisory wait is packaging serialization, not a product-row lock.
  await begin(a);
  await fulfill(a, second);
  await begin(b);
  pending = fulfill(b, third).then(
    (result) => ({ ok: true, result }),
    (error) => ({ ok: false, code: error.code, message: error.message }),
  );
  const fulfillmentWait = await blockedByA();
  equal(
    { blocked: fulfillmentWait.blockers.includes(aPid), ...(await state(box, sticker)) },
    { blocked: true, balances: [99, 99], fulfillments: 1, receipts: 2, entries: 2 },
    "Concurrent fulfillment waits on packaging; all pending source and material receipts remain atomic",
  );
  await a.query("commit");
  const next = await pending;
  assert.equal(next.ok, true);
  await b.query("commit");
  const final = await state(box, sticker);
  const totals = (
    await observer.query(
      "select sum(requested_quantity)::int requested,sum(consumed_quantity)::int consumed from public.packaging_consumptions group by stock_item_id order by stock_item_id",
    )
  ).rows;
  const invalid = await scalar(
    observer,
    `select (select count(*) from public.stock_balances where quantity<0)+(select count(*) from public.packaging_consumptions c where consumed_quantity<>(select coalesce(sum(quantity),0) from public.packaging_consumption_entries e where e.consumption_id=c.id)) value`,
  );
  equal(
    { ...final, totals, invalid: Number(invalid) },
    {
      balances: [94, 94],
      fulfillments: 3,
      receipts: 6,
      entries: 6,
      totals: [
        { requested: 6, consumed: 6 },
        { requested: 6, consumed: 6 },
      ],
      invalid: 0,
    },
    "Six delivered T-shirts consume exactly six boxes and six stickers, with complete receipts and no negative or inconsistent balance",
  );
  console.log(
    JSON.stringify(
      {
        version,
        checks,
        workerPids: [aPid, bPid],
        observedWaits: [countWait, fulfillmentWait],
        final,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS ${checks} real PostgreSQL packaging concurrency checks. Auth is synthetic; no cloud or real inventory touched.`,
  );
} catch (error) {
  console.error({ message: error.message, code: error.code, where: error.where });
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
