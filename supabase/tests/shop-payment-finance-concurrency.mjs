// test-db: postgres minimo 33
// Full actual migration chain, real concurrent backends and existing Finance gate.
// Auth/Storage/external extension interfaces and all fixture values are synthetic.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const [bin, modulePath] = process.argv.slice(2);
if (!bin?.startsWith("/") || !modulePath?.startsWith("/"))
  throw Error("Servono percorsi assoluti PG17 e pg.");
const imported = await import(pathToFileURL(modulePath).href),
  Client = imported.Client ?? imported.default.Client;
const run = (name, args) => {
  const r = spawnSync(join(bin, name), args, {
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (r.status !== 0) throw Error(`${name}: ${r.error?.message ?? r.stderr}`);
  return r.stdout.trim();
};
assert.match(run("postgres", ["--version"]), /PostgreSQL\) 17\./);
const directory = mkdtempSync("/private/tmp/luckylap-shop-payment-finance-"),
  data = join(directory, "data"),
  socket = join(directory, "socket");
mkdirSync(socket, { mode: 0o700 });
const clients = [],
  finance = randomUUID(),
  founder = randomUUID(),
  member = randomUUID(),
  session = randomUUID(),
  founderSession = randomUUID(),
  memberSession = randomUUID(),
  central = randomUUID(),
  shop = randomUUID();
let started = false,
  owner,
  a,
  b,
  observer,
  checks = 0;
const eq = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label ?? `Verifica concorrente ${checks + 1}`);
  checks++;
};
const scalar = async (client, sql, args = []) => (await client.query(sql, args)).rows[0].value;
const capture = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
async function success(promise) {
  const result = await promise;
  if (result.error) throw result.error;
  return result.value;
}
async function connect() {
  const c = new Client({
    host: socket,
    port: 5432,
    user: "postgres",
    database: "postgres",
    ssl: false,
    statement_timeout: 15000,
  });
  await c.connect();
  clients.push(c);
  return c;
}
async function begin(client, user = finance) {
  await client.query("begin isolation level read committed");
  await client.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({
      sub: user,
      session_id: user === finance ? session : user === founder ? founderSession : memberSession,
      aal: "aal1",
    }),
  ]);
  await client.query("set local role authenticated");
}
async function call(client, kind, payload, operation = randomUUID()) {
  return scalar(client, `select public.${kind}($1,$2) value`, [operation, payload]);
}
async function rpc(kind, payload, op = randomUUID(), user = finance) {
  await begin(observer, user);
  try {
    const result = await call(observer, kind, payload, op);
    await observer.query("commit");
    return result;
  } catch (error) {
    await observer.query("rollback");
    throw error;
  }
}
async function denied(promise, code) {
  const result = await capture(promise);
  eq(result.error?.code, code);
}
async function blocked(waiter, holder) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const row = (
      await observer.query(
        "select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1",
        [waiter],
      )
    ).rows[0];
    if (row?.wait_event_type === "Lock" && row.blockers.includes(holder)) {
      checks++;
      return;
    }
    await new Promise((done) => setTimeout(done, 20));
  }
  throw Error("Nessun vero lock PostgreSQL osservato.");
}
const meta = (over = {}) => ({
  direction: "income",
  category: "Vendite",
  description: "Incasso sintetico",
  pending: false,
  ...over,
});
let at,
  month,
  reportCount = 0;
const record = (reportId) => ({
  schema_version: 1,
  report_id: reportId,
  amount_cents: 3000,
  paid_at: at,
  method: "cash",
  account_label: "Cash",
  reference: null,
});
const update = (paymentId, version, over = {}) => ({
  schema_version: 1,
  payment_id: paymentId,
  expected_version: version,
  amount_cents: 3000,
  paid_at: at,
  method: "cash",
  account_label: "Cash",
  reference: null,
  voided: false,
  reason: "Correzione sintetica",
  finance: meta(),
  ...over,
});
async function report() {
  const id = randomUUID();
  await owner.query(
    "insert into public.consignment_reports(id,location_id,period_month,brand_share_bps,markup_cents,pieces,gross_cents,brand_cents,shop_cents,payment_state,created_by,updated_by)values($1,$2,($3::date-$5*interval'1 month')::date,6000,1000,1,10000,6000,4000,'unpaid',$4,$4)",
    [id, shop, month, finance, reportCount++],
  );
  return id;
}
try {
  run("initdb", [
    "-D",
    data,
    "-U",
    "postgres",
    "--auth=trust",
    "--no-locale",
    "--encoding=UTF8",
    "--no-sync",
    "-L",
    resolve(bin, "../share/postgresql"),
  ]);
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    join(directory, "postgres.log"),
    "-o",
    `-k ${socket} -h '' -c fsync=off -c max_connections=8`,
    "-w",
    "start",
  ]);
  started = true;
  owner = await connect();
  a = await connect();
  b = await connect();
  observer = await connect();
  const aPid = await scalar(a, "select pg_backend_pid() value"),
    bPid = await scalar(b, "select pg_backend_pid() value");
  eq(aPid !== bPid, true);
  await owner.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema extensions;create extension pgcrypto with schema extensions;
 create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
 create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid()returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;
 create schema storage;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;grant select,insert,update,delete on storage.objects to authenticated;
 create schema vault;create table vault.secrets(id uuid primary key,name text,decrypted_secret text);create view vault.decrypted_secrets as select * from vault.secrets;
 create schema cron;create table cron.job(jobid bigint,jobname text,username text,schedule text,command text,active boolean);create schema net;`);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    let sql = readFileSync(new URL(name, migrations), "utf8");
    if (name.endsWith("_shopify_scheduler.sql")) {
      let replaced = 0;
      sql = sql.replace(
        /^create extension if not exists (?:pg_cron|pg_net|supabase_vault) with schema [a-z_]+;$/gm,
        () => {
          replaced++;
          return "-- External Supabase extension interface supplied above.";
        },
      );
      assert.equal(replaced, 3);
    }
    try {
      await owner.query(sql);
    } catch (error) {
      throw Error(`Migrazione ${name}: ${error.message}`, { cause: error });
    }
  }
  for (const [user, role] of [
    [finance, "finance"],
    [founder, "founder"],
    [member, "logistics"],
  ]) {
    await owner.query("insert into auth.users values($1)", [user]);
    await owner.query("insert into auth.sessions values($1,$2,null)", [
      user === finance ? session : user === founder ? founderSession : memberSession,
      user,
    ]);
    await owner.query(
      "insert into public.profiles(user_id,display_name)values($1,'Persona sintetica')",
      [user],
    );
    await owner.query(
      "insert into public.memberships(user_id,role,finance_access)values($1,$2,$3)",
      [user, role, role !== "logistics"],
    );
  }
  await owner.query(
    "insert into private.sensitive_area_credentials(area,password_hash)values('finance',extensions.crypt('synthetic-password',extensions.gen_salt('bf',10)))",
  );
  for (const [user, sid] of [
    [finance, session],
    [founder, founderSession],
  ])
    await owner.query(
      "insert into private.area_grants(session_id,user_id,area,credential_version,expires_at)select $1,$2,'finance',version,clock_timestamp()+interval'8 hours'from private.sensitive_area_credentials where area='finance'",
      [sid, user],
    );
  await owner.query(
    "insert into public.stock_locations(id,code,name,location_type)values($1,'SYN-MAG','Magazzino sintetico','Magazzino'),($2,'SYN-NEG','Negozio sintetico','Negozio Conto Vendita')",
    [central, shop],
  );
  await owner.query(
    "insert into public.consignment_shops(location_id,supply_location_id,created_by,updated_by)values($1,$2,$3,$3)",
    [shop, central, finance],
  );
  at = await scalar(
    owner,
    "select to_char(statement_timestamp()at time zone'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') value",
  );
  month = await scalar(
    owner,
    "select date_trunc('month',statement_timestamp()at time zone'Europe/Rome')::date::text value",
  );
  const reportId = await report(),
    payment = randomUUID();
  await rpc("record_consignment_payment", record(reportId), payment);
  const commercial = await scalar(
    owner,
    "select to_jsonb(r)-'payment_state' value from public.consignment_reports r where id=$1",
    [reportId],
  );
  // Two corrections with the same CAS genuinely overlap on the P3 shop lock.
  await begin(a);
  await call(
    a,
    "update_consignment_payment",
    update(payment, 1, { amount_cents: 2000, finance: meta({ direction: "expense" }) }),
  );
  await begin(b);
  const staleOp = randomUUID(),
    stale = capture(
      call(b, "update_consignment_payment", update(payment, 1, { amount_cents: 4000 }), staleOp),
    );
  await blocked(bPid, aPid);
  await a.query("commit");
  eq((await stale).error?.message, "stale_version");
  await b.query("rollback");
  eq(
    await scalar(
      owner,
      "select version::int value from public.consignment_report_payments where id=$1",
      [payment],
    ),
    2,
  );
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.consignment_payment_revisions where payment_id=$1",
      [payment],
    ),
    2,
  );
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.consignment_receipts where operation_id=$1",
      [staleOp],
    ),
    0,
  );
  eq(
    await scalar(owner, "select private.consignment_posted_payment_net($1)::text value", [
      reportId,
    ]),
    "-2000",
  );
  eq(
    await scalar(owner, "select payment_state value from public.consignment_reports where id=$1", [
      reportId,
    ]),
    "unpaid",
  );
  // A legacy edit changes a canonical field but preserves all Finance-only values.
  const future = await scalar(
    owner,
    "select to_char((statement_timestamp()+interval'2 days')at time zone'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') value",
  );
  await rpc(
    "update_consignment_payment",
    update(payment, 2, {
      paid_at: future,
      amount_cents: 2000,
      finance: meta({
        direction: "expense",
        pending: true,
        category: "Others",
        description: "Metadati da conservare",
      }),
    }),
  );
  const { finance: omitted, ...oldPayload } = update(payment, 3, {
    paid_at: future,
    amount_cents: 2000,
    method: "other",
  });
  await rpc("update_consignment_payment", oldPayload);
  eq(
    await scalar(
      owner,
      "select jsonb_build_object('direction',finance_direction,'pending',finance_pending,'category',finance_category,'description',finance_description) value from public.consignment_report_payments where id=$1",
      [payment],
    ),
    meta({
      direction: "expense",
      pending: true,
      category: "Others",
      description: "Metadati da conservare",
    }),
  );
  eq(
    await scalar(owner, "select private.consignment_posted_payment_net($1)::text value", [
      reportId,
    ]),
    "0",
  );
  // Concurrent identical retries wait on the receipt operation and return one version.
  const retryOp = randomUUID(),
    retryPayload = { ...oldPayload, expected_version: 4 };
  await begin(a);
  const original = await call(a, "update_consignment_payment", retryPayload, retryOp);
  await begin(b);
  const duplicate = capture(call(b, "update_consignment_payment", retryPayload, retryOp));
  await blocked(bPid, aPid);
  await a.query("commit");
  const replay = await success(duplicate);
  await b.query("commit");
  eq(replay.replayed, true);
  eq(replay.version, original.version);
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.consignment_receipts where operation_id=$1",
      [retryOp],
    ),
    1,
  );
  await denied(rpc("update_consignment_payment", retryPayload, retryOp, founder), "22023");
  await denied(
    rpc("update_consignment_payment", { ...retryPayload, amount_cents: 2001 }, retryOp),
    "22023",
  );
  // Two payments for the last amount cannot both be recorded.
  const doubleReport = await report(),
    payA = randomUUID(),
    payB = randomUUID(),
    full = { ...record(doubleReport), amount_cents: 6000 };
  await begin(a);
  await call(a, "record_consignment_payment", full, payA);
  await begin(b);
  const double = capture(call(b, "record_consignment_payment", full, payB));
  await blocked(bPid, aPid);
  await a.query("commit");
  eq((await double).error?.message, "payment_exceeds_invoice");
  await b.query("rollback");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.consignment_report_payments where report_id=$1",
      [doubleReport],
    ),
    1,
  );
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.consignment_receipts where operation_id=$1",
      [payB],
    ),
    0,
  );
  // A late DB failure rolls back head, history, operational state and receipt together.
  await owner.query(
    "create function private.synthetic_payment_failure()returns trigger language plpgsql as $$begin if new.reason='Rollback sintetico'then raise exception'Synthetic failure'using errcode='23514';end if;return new;end$$;create trigger synthetic_payment_failure after insert on public.consignment_payment_revisions for each row execute function private.synthetic_payment_failure()",
  );
  const before = await scalar(
      owner,
      "select to_jsonb(p) value from public.consignment_report_payments p where id=$1",
      [payment],
    ),
    rollbackOp = randomUUID();
  await denied(
    rpc(
      "update_consignment_payment",
      update(payment, 5, { reason: "Rollback sintetico" }),
      rollbackOp,
    ),
    "23514",
  );
  eq(
    await scalar(
      owner,
      "select to_jsonb(p) value from public.consignment_report_payments p where id=$1",
      [payment],
    ),
    before,
  );
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.consignment_payment_revisions where payment_id=$1",
      [payment],
    ),
    5,
  );
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.consignment_receipts where operation_id=$1",
      [rollbackOp],
    ),
    0,
  );
  // Gate expiry during a genuine wait cannot authorize the later write.
  await owner.query(
    "update private.area_grants set expires_at=clock_timestamp()+interval'300 milliseconds'where user_id=$1",
    [finance],
  );
  await a.query("begin");
  await a.query("select 1 from public.consignment_shops where location_id=$1 for update", [shop]);
  await begin(b);
  const expiredOp = randomUUID(),
    expired = capture(call(b, "update_consignment_payment", update(payment, 5), expiredOp));
  await blocked(bPid, aPid);
  await new Promise((done) => setTimeout(done, 350));
  await a.query("commit");
  eq((await expired).error?.message, "finance_access_required");
  await b.query("rollback");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.consignment_receipts where operation_id=$1",
      [expiredOp],
    ),
    0,
  );
  await denied(rpc("update_consignment_payment", retryPayload, retryOp), "42501");
  await denied(
    rpc("update_consignment_payment", update(payment, 5), randomUUID(), member),
    "42501",
  );
  await begin(observer, member);
  const state = await scalar(observer, "select public.read_consignment_payment_states($1) value", [
    [reportId],
  ]);
  await observer.query("commit");
  eq(state, [{ report_id: reportId, payment_state: "unpaid" }]);
  eq(
    await scalar(
      owner,
      "select to_jsonb(r)-'payment_state' value from public.consignment_reports r where id=$1",
      [reportId],
    ),
    commercial,
  );
  eq(await scalar(owner, "select count(*)::int value from public.stock_movements"), 0);
  eq(await scalar(owner, "select count(*)::int value from public.finance_movement_revisions"), 0);
  console.log(
    `PASS ${checks} shop payment Finance concurrent checks; full actual chain, PG17 pids ${aPid}/${bPid}, real locks/CAS/Finance gate, synthetic Auth/fixtures.`,
  );
} finally {
  for (const c of clients)
    try {
      await c.query("rollback");
    } catch {}
  for (const c of clients.reverse())
    try {
      await c.end();
    } catch {}
  try {
    if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
