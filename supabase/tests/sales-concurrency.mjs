// Real PostgreSQL backend processes, synthetic domain fixtures, mocked Auth.
// This harness never accepts a DSN and only connects to its own private socket.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const [binaryDirectory, pgModule] = process.argv.slice(2);
if (!binaryDirectory?.startsWith("/") || !pgModule?.startsWith("/"))
  throw new Error("Passare due percorsi assoluti: PostgreSQL 17 bin e pg/lib/index.js.");
const pg = await import(pathToFileURL(pgModule).href);
const Client = pg.Client ?? pg.default?.Client;
assert.ok(Client, "Pinned external node-postgres Client required");
const run = (name, args) => {
  const result = spawnSync(join(binaryDirectory, name), args, {
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.status !== 0)
    throw new Error(`${name} failed: ${result.error?.message ?? result.stderr?.trim()}`);
  return result.stdout.trim();
};
const version = run("postgres", ["--version"]);
assert.match(version, /PostgreSQL\) 17\./, "Only PostgreSQL 17 is accepted");
const temporary = mkdtempSync("/private/tmp/luckylap-pg17-");
const dataDirectory = join(temporary, "data"),
  socketDirectory = join(temporary, "socket");
mkdirSync(socketDirectory, { mode: 0o700 });
const port = await new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const assigned = server.address().port;
    server.close(() => resolvePort(assigned));
  });
});
const rootDirectory = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const evidencePath = join(rootDirectory, ".private", "deployment-proof", "sales-concurrency.json");
const evidence = {
  startedAt: new Date().toISOString(),
  version,
  transport: "private Unix socket; TCP disabled",
  port,
  checks: 0,
  migrations: [],
  cases: [],
};
const clients = [];
let started = false;
let administrator;
let a;
let b;
let pids;
const uuid = (n) => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = uuid(1),
  location = uuid(2),
  product = uuid(3);
const equal = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  evidence.checks += 1;
};
const truth = (value, label) => {
  assert.ok(value, label);
  evidence.checks += 1;
};
const connect = async (name) => {
  const client = new Client({
    host: socketDirectory,
    port,
    user: "luckylap_qa_owner",
    password: "",
    database: "postgres",
    ssl: false,
    application_name: `luckylap-local-${name}`,
    statement_timeout: 15000,
    query_timeout: 18000,
    connectionTimeoutMillis: 5000,
  });
  client.on("error", () => {});
  await client.connect();
  clients.push(client);
  return client;
};
const begin = async (client) => {
  await client.query("begin isolation level read committed");
  await client.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: actor, aal: "aal1" }),
  ]);
  await client.query("set local role authenticated");
};
const command = async (client, operation, payload) =>
  (
    await client.query("select public.register_manual_sale($1,$2::jsonb) result", [
      operation,
      JSON.stringify(payload),
    ])
  ).rows[0].result;
const adjust = async (client, item) =>
  (
    await client.query(
      "select public.adjust_stock($1,$2,$3,-1,'Synthetic concurrency correction') id",
      [randomUUID(), item, location],
    )
  ).rows[0].id;
const payload = (item, mode = "delivered_now", paid = false) => ({
  schema_version: 1,
  channel: "direct",
  occurred_at: new Date(Date.now() - 60000).toISOString(),
  location_id: location,
  lines: [{ stock_item_id: item, quantity: 1, unit_price_cents: 4001, discount_cents: 0 }],
  fulfillment_mode: mode,
  payment: paid
    ? {
        status: "paid",
        method: "cash",
        amount_cents: 4001,
        occurred_at: new Date(Date.now() - 60000).toISOString(),
      }
    : { status: "unpaid" },
});
async function fixture(number, quantity = 1) {
  const item = uuid(number);
  await administrator.query(
    "insert into public.stock_items(id,kind,sku,name,unit_cost_eur,list_price_eur) values($1,'product',$2,'Synthetic concurrency only',13.20,40.01)",
    [item, `SYNTHETIC-CONCURRENCY-${number}`],
  );
  await administrator.query(
    "insert into public.product_variants(stock_item_id,product_id,color,size) values($1,$2,'Test','M')",
    [item, product],
  );
  await administrator.query(
    "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason) values($1,$2,$3,'opening',$4,'Synthetic opening count')",
    [randomUUID(), item, location, quantity],
  );
  return item;
}
const state = async (item) =>
  (
    await administrator.query(
      `select b.quantity::int on_hand,
  coalesce((select sum(r.reserved_quantity)::int from public.stock_reservations r where r.stock_item_id=b.stock_item_id and r.location_id=b.location_id),0) reserved,
  (select count(*)::int from public.sales_order_lines l where l.stock_item_id=b.stock_item_id) orders,
  (select count(*)::int from public.stock_movements m where m.stock_item_id=b.stock_item_id and m.kind::text='sale_fulfillment') movements,
  coalesce((select sum(p.required_quantity)::int from public.production_requirements p join public.sales_order_lines l on l.id=p.order_line_id where l.stock_item_id=b.stock_item_id),0) production
  from public.stock_balances b where b.stock_item_id=$1 and b.location_id=$2`,
      [item, location],
    )
  ).rows[0];
async function invariant() {
  equal(
    (
      await administrator.query(`select count(*)::int n from public.stock_balances b where b.quantity<0 or
    coalesce((select sum(r.reserved_quantity) from public.stock_reservations r where r.stock_item_id=b.stock_item_id and r.location_id=b.location_id),0)>b.quantity`)
    ).rows[0].n,
    0,
    "Physical balances stay nonnegative and cover every reservation",
  );
}
async function blockedByA() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const observed = (
      await administrator.query(
        "select pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1",
        [pids.b],
      )
    ).rows[0];
    if (observed?.wait_event_type === "Lock" && observed.blockers.includes(pids.a)) {
      truth(observed.state === "active", "Second backend has an active overlapping query");
      return observed;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error("No observed lock contention between the two backend PIDs");
}
async function contend(name, first, second, finishFirst = "commit") {
  await begin(a);
  const firstResult = await first(a);
  await begin(b);
  // Capture the rejection immediately: the second query remains pending while
  // the first transaction still holds its locks, verified through pg_stat_activity.
  const secondPending = second(b).then(
    (result) => ({ ok: true, result }),
    (error) => ({ ok: false, code: error.code, message: error.message }),
  );
  const waiting = await blockedByA();
  await a.query(finishFirst);
  const secondResult = await secondPending;
  await b.query(secondResult.ok ? "commit" : "rollback");
  const entry = {
    name,
    backendPids: [pids.a, pids.b],
    waiting,
    firstEnd: finishFirst,
    firstResult,
    secondResult,
  };
  evidence.cases.push(entry);
  await invariant();
  return entry;
}
async function countState() {
  const tables = [
    "sales_orders",
    "sales_order_lines",
    "order_payments",
    "commercial_facts",
    "stock_movements",
    "stock_reservations",
    "stock_reservation_events",
    "production_requirements",
    "fulfillment_lines",
    "audit_logs",
  ];
  const result = {};
  for (const table of tables)
    result[table] = (
      await administrator.query(`select count(*)::int n from public.${table}`)
    ).rows[0].n;
  result.outbox = (
    await administrator.query("select count(*)::int n from private.sales_outbox")
  ).rows[0].n;
  return result;
}
try {
  // --skip-post-install leaves Homebrew's global share symlink absent. Point
  // initdb directly at its installed input files instead of changing the prefix.
  const shareDirectory = resolve(binaryDirectory, "../share/postgresql");
  run("initdb", [
    "-D",
    dataDirectory,
    "-L",
    shareDirectory,
    "--username=luckylap_qa_owner",
    "--no-locale",
    "--encoding=UTF8",
    "--auth-local=trust",
    "--auth-host=reject",
  ]);
  run("pg_ctl", [
    "-D",
    dataDirectory,
    "-l",
    join(temporary, "postgres.log"),
    "-o",
    `-p ${port} -k ${socketDirectory} -c listen_addresses='' -c unix_socket_permissions=0700 -c max_connections=12`,
    "-w",
    "start",
  ]);
  started = true;
  evidence.postmasterPid = Number(
    readFileSync(join(dataDirectory, "postmaster.pid"), "utf8").split("\n")[0],
  );
  administrator = await connect("observer");
  a = await connect("worker-a");
  b = await connect("worker-b");
  pids = Object.fromEntries(
    await Promise.all(
      [
        ["observer", administrator],
        ["a", a],
        ["b", b],
      ].map(async ([name, client]) => [
        name,
        (await client.query("select pg_backend_pid() pid")).rows[0].pid,
      ]),
    ),
  );
  evidence.backendPids = pids;
  equal(new Set(Object.values(pids)).size, 3, "Three distinct real PostgreSQL backends");
  evidence.isolation = (
    await administrator.query("show transaction_isolation")
  ).rows[0].transaction_isolation;
  await administrator.query(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    create schema storage; create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);`);
  const migrationDirectory = new URL("../migrations/", import.meta.url);
  const migrationPattern =
    /_(initial_schema|finance_imports|sales_ecosystem|sales_lifecycle)\.sql$/;
  for (const name of readdirSync(migrationDirectory)
    .filter((name) => migrationPattern.test(name))
    .sort()) {
    const sql = readFileSync(new URL(name, migrationDirectory), "utf8");
    await administrator.query(sql);
    evidence.migrations.push({ name, sha256: createHash("sha256").update(sql).digest("hex") });
  }
  equal(evidence.migrations.length, 4, "The unmodified domain migrations are loaded");
  await administrator.query("insert into auth.users(id) values($1)", [actor]);
  await administrator.query(
    "insert into public.profiles(user_id,display_name) values($1,'Synthetic operator')",
    [actor],
  );
  await administrator.query(
    "insert into public.memberships(user_id,role,active) values($1,'logistics',true)",
    [actor],
  );
  await administrator.query(
    "insert into public.stock_locations(id,code,name,location_type) values($1,'QA-CONCURRENT','Synthetic only','central')",
    [location],
  );
  await administrator.query(
    "insert into public.products(id,model,category) values($1,'SYNTHETIC-CONCURRENT','T-shirt')",
    [product],
  );
  await administrator.query(
    "update public.app_settings set manual_sales_enabled=true,sales_started_at=now()-interval '1 day',stock_adjustments_enabled=true,discounts_enabled=true",
  );

  const last = await fixture(101);
  const lastInput = payload(last, "delivered_now", true);
  const lastRace = await contend(
    "two deliveries compete for the last ready unit",
    (client) => command(client, randomUUID(), lastInput),
    (client) => command(client, randomUUID(), lastInput),
  );
  equal(
    lastRace.secondResult,
    { ok: false, code: "22023", message: "insufficient_ready_stock" },
    "Only one delivery can succeed",
  );
  equal(
    await state(last),
    { on_hand: 0, reserved: 0, orders: 1, movements: 1, production: 0 },
    "Rejected last-unit sale leaves no order or physical effect",
  );

  const retryItem = await fixture(102);
  const retryInput = payload(retryItem, "delivered_now", true);
  const retryOperation = randomUUID();
  const retryRace = await contend(
    "same operation UUID submitted concurrently",
    (client) => command(client, retryOperation, retryInput),
    (client) => command(client, retryOperation, retryInput),
  );
  truth(retryRace.secondResult.ok, "Concurrent identical retry succeeds as replay");
  equal(
    retryRace.secondResult.result,
    { ...retryRace.firstResult, replayed: true },
    "Concurrent replay returns the same committed order and IDs",
  );
  equal(
    await state(retryItem),
    { on_hand: 0, reserved: 0, orders: 1, movements: 1, production: 0 },
    "Concurrent retry cannot double debit stock",
  );
  equal(
    (
      await administrator.query(
        "select (select count(*)::int from public.order_payments where order_id=$1) payments,(select count(*)::int from public.commercial_facts where order_id=$1) facts,(select count(*)::int from private.sales_outbox where order_id=$1) outbox",
        [retryRace.firstResult.order_id],
      )
    ).rows[0],
    { payments: 1, facts: 2, outbox: 1 },
    "Replay has one payment, two fact kinds and one outbox entry",
  );

  const prepareItem = await fixture(103);
  const prepareInput = payload(prepareItem, "prepare");
  const prepareRace = await contend(
    "two preparation orders compete for one ready unit",
    (client) => command(client, randomUUID(), prepareInput),
    (client) => command(client, randomUUID(), prepareInput),
  );
  truth(prepareRace.secondResult.ok, "Both preparation orders may be accepted");
  equal(
    await state(prepareItem),
    { on_hand: 1, reserved: 1, orders: 2, movements: 0, production: 1 },
    "Preparation reserves the unit once and plans only the deficit",
  );
  const guardLine = prepareRace.secondResult.result.lines[0].order_line_id;
  await assert.rejects(
    administrator.query(
      "insert into public.stock_reservations(order_line_id,stock_item_id,location_id,reserved_quantity) values($1,$2,$3,1)",
      [guardLine, prepareItem, location],
    ),
    (error) => error.code === "22023" && error.message === "reserved_stock_conflict",
  );
  evidence.checks += 1;
  equal(
    (await state(prepareItem)).reserved,
    1,
    "The independent reservation guard rejects an over-allocation even for owner SQL",
  );

  const reserveFirst = await fixture(104);
  const reserveInput = payload(reserveFirst, "prepare");
  const correctionRace = await contend(
    "reservation wins before a stock reduction",
    (client) => command(client, randomUUID(), reserveInput),
    (client) => adjust(client, reserveFirst),
  );
  equal(
    correctionRace.secondResult,
    { ok: false, code: "22023", message: "reserved_stock_conflict" },
    "A concurrent reduction cannot invalidate committed reservations",
  );
  equal(
    await state(reserveFirst),
    { on_hand: 1, reserved: 1, orders: 1, movements: 0, production: 0 },
    "Rejected reduction keeps the reserved unit physically present",
  );

  const reductionFirst = await fixture(105);
  const reductionInput = payload(reductionFirst, "prepare");
  const oppositeRace = await contend(
    "stock reduction wins before preparation",
    (client) => adjust(client, reductionFirst),
    (client) => command(client, randomUUID(), reductionInput),
  );
  truth(oppositeRace.secondResult.ok, "Preparation after a committed correction still succeeds");
  equal(
    await state(reductionFirst),
    { on_hand: 0, reserved: 0, orders: 1, movements: 0, production: 1 },
    "Corrected-away unit is produced, never reserved",
  );

  const abortItem = await fixture(106);
  const abortInput = payload(abortItem, "delivered_now", true);
  const abortedOperation = randomUUID();
  const abortRace = await contend(
    "first sale rolls back while another waits",
    (client) => command(client, abortedOperation, abortInput),
    (client) => command(client, randomUUID(), abortInput),
    "rollback",
  );
  truth(abortRace.secondResult.ok, "Waiting sale proceeds after the first transaction rolls back");
  equal(
    await state(abortItem),
    { on_hand: 0, reserved: 0, orders: 1, movements: 1, production: 0 },
    "Rollback releases the last unit and only the committed sale remains",
  );
  equal(
    (
      await administrator.query(
        "select count(*)::int n from public.sales_orders where operation_id=$1",
        [abortedOperation],
      )
    ).rows[0].n,
    0,
    "Rolled-back operation leaves no order",
  );
  equal(
    (
      await administrator.query(
        "select count(*)::int n from public.audit_logs where new_data->>'id'=$1",
        [abortRace.firstResult.order_id],
      )
    ).rows[0].n,
    0,
    "Rolled-back sale leaves no order audit",
  );

  const rollbackReady = await fixture(201);
  const rollbackEmpty = await fixture(202, 0);
  const beforeFailure = await countState();
  const beforeBalances = [await state(rollbackReady), await state(rollbackEmpty)];
  await administrator.query(`create schema qa_concurrency;
    create function qa_concurrency.witness_partial_effect() returns trigger language plpgsql as $$ begin raise notice 'QA_PARTIAL_STOCK_EFFECT'; return new; end $$;
    create trigger zz_qa_partial_effect after insert on public.stock_movements for each row when(new.kind::text='sale_fulfillment') execute function qa_concurrency.witness_partial_effect();`);
  let witnessed = 0;
  const notice = (value) => {
    if (value.message === "QA_PARTIAL_STOCK_EFFECT") witnessed += 1;
  };
  a.on("notice", notice);
  const invalidInput = payload(rollbackReady);
  invalidInput.lines.push({
    stock_item_id: rollbackEmpty,
    quantity: 1,
    unit_price_cents: 4001,
    discount_cents: 0,
  });
  await begin(a);
  await assert.rejects(
    command(a, randomUUID(), invalidInput),
    (error) => error.code === "22023" && error.message === "insufficient_ready_stock",
  );
  evidence.checks += 1;
  await a.query("rollback");
  a.off("notice", notice);
  equal(
    witnessed,
    1,
    "Test-only notice proves first-line stock effects executed before the later error",
  );
  equal(
    await countState(),
    beforeFailure,
    "Failed multi-line sale rolls back every order, fact, reservation, movement, audit and outbox effect",
  );
  equal(
    [await state(rollbackReady), await state(rollbackEmpty)],
    beforeBalances,
    "Failed multi-line sale restores both balances",
  );
  evidence.cases.push({
    name: "later line failure rolls back an already executed first-line effect",
    backendPid: pids.a,
    witnessedPartialEffect: witnessed,
    allDomainCountsUnchanged: true,
  });
  await invariant();
  equal(
    (await administrator.query("select count(*)::int n from public.finance_entries")).rows[0].n,
    0,
    "Sales do not invent approved Finance entries",
  );
  equal(
    (await administrator.query("select count(*)::int n from public.finance_import_transactions"))
      .rows[0].n,
    0,
    "Synthetic sales never change cash-import history",
  );
  evidence.passed = true;
} catch (error) {
  evidence.passed = false;
  evidence.failure = { message: error.message, code: error.code };
  throw error;
} finally {
  for (const client of clients.reverse()) {
    try {
      await client.end();
    } catch {
      /* shutdown still follows */
    }
  }
  if (started || existsSync(join(dataDirectory, "postmaster.pid"))) {
    try {
      run("pg_ctl", ["-D", dataDirectory, "-m", "immediate", "-w", "stop"]);
      evidence.clusterStopped = true;
    } catch (error) {
      evidence.clusterStopped = false;
      evidence.cleanupError = error.message;
      process.exitCode = 1;
    }
  }
  if (evidence.clusterStopped || !existsSync(join(dataDirectory, "postmaster.pid"))) {
    rmSync(temporary, { recursive: true, force: true });
    evidence.temporaryClusterRemoved = !existsSync(temporary);
  }
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(join(rootDirectory, ".private", "deployment-proof"), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(
    `${evidence.passed ? "PASS" : "FAIL"} ${evidence.checks} checks on ${version}; backends ${JSON.stringify(pids)}; ${evidence.cases.length} cases; cluster stopped=${evidence.clusterStopped}; evidence=.private/deployment-proof/sales-concurrency.json`,
  );
}
