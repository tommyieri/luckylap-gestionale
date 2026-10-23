// test-db: postgres minimo 28
// Controllo CEO su PostgreSQL 17 reale: il feed mostra solo le ultime 24 ore. Con più di 20.000
// righe di audit sintetiche più vecchie, una pagina legge solo le righe delle ultime 24 ore (indici,
// nessuna scansione completa) e costa lo stesso quando la storia cresce. Auth/JWT e dati sintetici;
// nessun DSN, cloud o segreto.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const [bin, modulePath] = process.argv.slice(2);
if (!bin?.startsWith("/") || !modulePath?.startsWith("/"))
  throw Error("Servono soltanto percorsi assoluti runtime PostgreSQL17 e pg/lib/index.js.");
const imported = await import(pathToFileURL(modulePath).href),
  Client = imported.Client ?? imported.default.Client;
const command = (name, args) => {
  const r = spawnSync(join(bin, name), args, {
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (r.status !== 0) throw Error(`${name}: ${r.error?.message ?? r.stderr}`);
  return r.stdout.trim();
};
assert.match(command("postgres", ["--version"]), /PostgreSQL\) 17\./);
const directory = mkdtempSync("/private/tmp/luckylap-ceo-scale-"),
  data = join(directory, "data"),
  socket = join(directory, "socket");
mkdirSync(socket, { mode: 0o700 });
let started = false;
let owner;
let reader;
let checks = 0;
const eq = (a, b, label = "Valori attesi") => {
  assert.deepEqual(a, b, label);
  checks++;
};
const ok = (value, label = "Condizione attesa") => {
  assert.ok(value, label);
  checks++;
};
const team = Array.from({ length: 5 }, () => randomUUID()),
  founder = team[0],
  session = randomUUID();
const NIL = "00000000-0000-0000-0000-000000000000";
const BUDGET_MS = 2000;
const timings = {};

async function connect() {
  const client = new Client({
    host: socket,
    port: 5432,
    user: "luckylap_ceo_scale",
    database: "postgres",
    ssl: false,
    statement_timeout: 8000, // the Supabase limit the feed must stay well below
  });
  await client.connect();
  return client;
}
async function feed({ actor = null, area = null, cursor = null, limit = 50 } = {}) {
  await reader.query("begin");
  try {
    await reader.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ role: "authenticated", sub: founder, session_id: session, aal: "aal1" }),
    ]);
    await reader.query("set local role authenticated");
    const started = performance.now();
    const r = await reader.query("select public.ceo_activity_feed($1,$2,$3,$4,$5) result", [
      actor,
      area,
      cursor?.occurred_at ?? null,
      cursor?.id ?? null,
      limit,
    ]);
    const ms = performance.now() - started;
    await reader.query("commit");
    return { ...r.rows[0].result, ms };
  } catch (e) {
    await reader.query("rollback");
    throw e;
  }
}
async function timed(label, options) {
  const page = await feed(options);
  timings[label] = Math.round(page.ms);
  ok(page.ms < BUDGET_MS, `${label}: ${Math.round(page.ms)} ms, sotto ${BUDGET_MS} ms`);
  return page;
}
async function auditStats() {
  const r = await owner.query(
    "select seq_scan,coalesce(idx_tup_fetch,0)fetched from pg_stat_user_tables where relid='public.audit_logs'::regclass",
  );
  return { seq: Number(r.rows[0].seq_scan), fetched: Number(r.rows[0].fetched) };
}

// Synthetic transactions, chronological; every row is written by SQL in bulk.
// A sale: 12 rows; its delivery: 10 rows; a task, a Finance revision: 1 row; a Partner send with
// follow-up: 4 rows. Sub-second offsets keep every transaction distinct.
const load = (from, to, base) => `
with s as (
 select i, ${base} + i * interval '90 seconds' ts,
  (array['${team.join("','")}']::uuid[])[1 + i % 5] actor,
  gen_random_uuid() o, gen_random_uuid() l1, gen_random_uuid() l2, gen_random_uuid() s1, gen_random_uuid() s2,
  gen_random_uuid() f1, gen_random_uuid() f2, gen_random_uuid() c1, gen_random_uuid() pk,
  '10000000-0000-4000-8000-000000000001'::uuid loc
 from generate_series(${from}, ${to}) i
), rows as (
 select ts, actor, v.t, v.op, v.d from s cross join lateral (values
  ('sales_orders', 'INSERT', jsonb_build_object('id', o, 'operation_id', gen_random_uuid(), 'channel', 'direct', 'total_cents', 4500)),
  ('sales_order_lines', 'INSERT', jsonb_build_object('id', l1, 'order_id', o, 'quantity', 1, 'line_total_cents', 1500)),
  ('sales_order_lines', 'INSERT', jsonb_build_object('id', l2, 'order_id', o, 'quantity', 2, 'line_total_cents', 3000)),
  ('stock_reservations', 'INSERT', jsonb_build_object('order_line_id', l1, 'stock_item_id', s1, 'location_id', loc, 'reserved_quantity', 1)),
  ('stock_reservations', 'INSERT', jsonb_build_object('order_line_id', l2, 'stock_item_id', s2, 'location_id', loc, 'reserved_quantity', 2)),
  ('stock_movements', 'INSERT', jsonb_build_object('id', gen_random_uuid(), 'stock_item_id', s1, 'location_id', loc, 'kind', 'reservation', 'source', jsonb_build_object('sales_order_id', o, 'sales_order_line_id', l1))),
  ('stock_movements', 'INSERT', jsonb_build_object('id', gen_random_uuid(), 'stock_item_id', s2, 'location_id', loc, 'kind', 'reservation', 'source', jsonb_build_object('sales_order_id', o, 'sales_order_line_id', l2))),
  ('stock_balances', 'UPDATE', jsonb_build_object('stock_item_id', s1, 'location_id', loc, 'quantity', 4)),
  ('stock_balances', 'UPDATE', jsonb_build_object('stock_item_id', s2, 'location_id', loc, 'quantity', 3)),
  ('commercial_facts', 'INSERT', jsonb_build_object('id', gen_random_uuid(), 'order_id', o, 'fact_kind', 'sale_observed')),
  ('order_payments', 'INSERT', jsonb_build_object('id', gen_random_uuid(), 'order_id', o, 'operation_id', gen_random_uuid(), 'method', 'cash', 'amount_cents', 4500)),
  ('commercial_facts', 'INSERT', jsonb_build_object('id', gen_random_uuid(), 'order_id', o, 'fact_kind', 'payment_reported'))
 ) v(t, op, d)
 union all
 select ts + interval '45 seconds', actor, v.t, v.op, v.d from s cross join lateral (values
  ('fulfillment_lines', 'INSERT', jsonb_build_object('id', f1, 'order_line_id', l1, 'quantity', 1)),
  ('fulfillment_lines', 'INSERT', jsonb_build_object('id', f2, 'order_line_id', l2, 'quantity', 2)),
  ('stock_movements', 'INSERT', jsonb_build_object('id', gen_random_uuid(), 'stock_item_id', s1, 'location_id', loc, 'kind', 'sale', 'source', jsonb_build_object('sales_order_id', o, 'sales_order_line_id', l1))),
  ('stock_movements', 'INSERT', jsonb_build_object('id', gen_random_uuid(), 'stock_item_id', s2, 'location_id', loc, 'kind', 'sale', 'source', jsonb_build_object('sales_order_id', o, 'sales_order_line_id', l2))),
  ('stock_balances', 'UPDATE', jsonb_build_object('stock_item_id', s1, 'location_id', loc, 'quantity', 3)),
  ('stock_balances', 'UPDATE', jsonb_build_object('stock_item_id', s2, 'location_id', loc, 'quantity', 1)),
  ('sales_order_lines', 'UPDATE', jsonb_build_object('id', l1, 'order_id', o, 'quantity', 1, 'fulfilled_quantity', 1)),
  ('packaging_consumptions', 'INSERT', jsonb_build_object('id', c1, 'source_kind', 'fulfillment', 'source_id', f1, 'stock_item_id', pk, 'location_id', loc)),
  ('packaging_consumption_entries', 'INSERT', jsonb_build_object('id', gen_random_uuid(), 'consumption_id', c1, 'quantity', 1)),
  ('stock_movements', 'INSERT', jsonb_build_object('id', gen_random_uuid(), 'stock_item_id', pk, 'location_id', loc, 'kind', 'packaging', 'source', jsonb_build_object('packaging_consumption_id', c1)))
 ) v(t, op, d)
 union all
 select ts + interval '12.123456 seconds', actor, 'tasks', 'INSERT', jsonb_build_object('id', gen_random_uuid(), 'title', 'Attività sintetica ' || i)
 from s
 union all
 select ts + interval '30.234567 seconds', actor, 'finance_movement_revisions', 'INSERT', jsonb_build_object('id', gen_random_uuid(), 'operation_id', gen_random_uuid(),
  'source_kind', 'manual', 'source_id', gen_random_uuid(), 'action', 'update', 'value_snapshot', jsonb_build_object('amount_cents', 1234, 'category', 'Categoria sintetica'))
 from s where i % 3 = 0
 union all
 select ts + interval '60.345678 seconds', actor, v.t, v.op, v.d from s
 cross join lateral (select gen_random_uuid() partner, gen_random_uuid() task, (i % 900) + 1 co) p
 cross join lateral (values
  ('partner_activities', 'INSERT', jsonb_build_object('id', gen_random_uuid(), 'partner_id', p.partner, 'partner_name', 'Contatto sintetico ' || p.co, 'partner_co', p.co, 'kind', 'inviato', 'origin', 'team')),
  ('partners', 'UPDATE', jsonb_build_object('id', p.partner, 'co', p.co, 'name', 'Contatto sintetico ' || p.co, 'stage', 'contattato')),
  ('tasks', 'INSERT', jsonb_build_object('id', p.task, 'title', 'Sollecito sintetico', 'status', 'todo')),
  ('partner_work_links', 'INSERT', jsonb_build_object('id', gen_random_uuid(), 'partner_id', p.partner, 'kind', 'follow_up', 'task_id', p.task))
 ) v(t, op, d) where i % 4 = 0
)
insert into public.audit_logs(occurred_at, actor_id, table_name, operation, record_key, old_data, new_data)
select ts, actor, t, op, jsonb_strip_nulls(jsonb_build_object('id', d -> 'id', 'stock_item_id', d -> 'stock_item_id', 'location_id', d -> 'location_id',
  'partner_id', d -> 'partner_id')), case when op = 'UPDATE' then d end, d
from rows`;
// Transactions (and so feed items) per sale index: sale, delivery, task, revision every 3rd, send every 4th.
const itemsUpTo = (n) => n * 3 + Math.floor(n / 3) + Math.floor(n / 4);

try {
  command("initdb", [
    "-D",
    data,
    "-U",
    "luckylap_ceo_scale",
    "--auth=trust",
    "--no-locale",
    "--encoding=UTF8",
    "--no-sync",
    "-L",
    resolve(bin, "../share/postgresql"),
  ]);
  command("pg_ctl", [
    "-D",
    data,
    "-l",
    join(directory, "postgres.log"),
    "-o",
    `-k ${socket} -h '' -c fsync=off`,
    "-w",
    "start",
  ]);
  started = true;
  owner = await connect();
  reader = await connect();
  await owner.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
 create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
 create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid()returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;
 create schema extensions;create extension pgcrypto schema extensions;`);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations)
    .filter((name) =>
      /_(initial_schema|area_passwords|ceo_activity_feed|ceo_feed_fixes)\.sql$/.test(name),
    )
    .sort())
    await owner.query(readFileSync(new URL(name, migrations), "utf8"));
  for (const [index, user] of team.entries()) {
    await owner.query("insert into auth.users(id)values($1)", [user]);
    await owner.query("insert into public.profiles(user_id,display_name)values($1,$2)", [
      user,
      `Persona sintetica ${index + 1}`,
    ]);
    await owner.query("insert into public.memberships(user_id,role,active)values($1,$2,true)", [
      user,
      index === 0 ? "founder" : "production",
    ]);
  }
  await owner.query("insert into auth.sessions(id,user_id)values($1,$2)", [session, founder]);
  await owner.query(
    "insert into private.sensitive_area_credentials(area,password_hash)values('audit',extensions.crypt('synthetic-ceo-password',extensions.gen_salt('bf',10)))",
  );
  await owner.query(
    "insert into private.area_grants(session_id,user_id,area,credential_version,expires_at)select $1,$2,'audit',version,clock_timestamp()+interval '8 hours'from private.sensitive_area_credentials where area='audit'",
    [session, founder],
  );
  await owner.query("truncate public.audit_logs");
  const OLD = "now() - interval '10 days'",
    RECENT = "now() - interval '4 hours'";
  const settings = async (when) =>
    owner.query(
      `insert into public.audit_logs(occurred_at,actor_id,table_name,operation,record_key,old_data,new_data)values(${when},$1,'app_settings','UPDATE','{}','{}','{"manual_sales_enabled":true}')`,
      [founder],
    );
  const count = async (where = "true") =>
    Number(
      (await owner.query(`select count(*) from public.audit_logs where ${where}`)).rows[0].count,
    );
  // The last 24 hours: about 150 sales cycles, a 207-contact import and one «Impostazioni» action,
  // the oldest of the day (a rare filter reads the whole day).
  await settings("now() - interval '23 hours 50 minutes'");
  await owner.query(load(1, 150, RECENT));
  await owner.query(`with p as (select co, gen_random_uuid() id, gen_random_uuid() variant from generate_series(1, 207) co)
   insert into public.audit_logs(occurred_at,actor_id,table_name,operation,record_key,old_data,new_data)
   select now() - interval '2 hours 0.5 seconds', null::uuid, t, 'INSERT', k, null::jsonb, d from p cross join lateral (values
    ('partners', jsonb_build_object('id', id), jsonb_build_object('co', co, 'name', 'Contatto importato ' || co)),
    ('partner_contacts', jsonb_build_object('id', gen_random_uuid(), 'partner_id', id), jsonb_build_object('partner_id', id, 'kind', 'email')),
    ('partner_message_variants', jsonb_build_object('id', variant, 'partner_id', id), jsonb_build_object('partner_id', id, 'approach', 'collab')),
    ('partner_message_revisions', jsonb_build_object('id', gen_random_uuid(), 'variant_id', variant), jsonb_build_object('variant_id', variant, 'revision_no', 1))
   ) v(t, k, d)
   union all select now() - interval '2 hours 0.5 seconds', null::uuid, 'partner_research_imports', 'INSERT', jsonb_build_object('id', gen_random_uuid()), null::jsonb,
    '{"partners_total":207}'::jsonb`);
  const recent = await count("occurred_at >= now() - interval '24 hours'");
  timings.righe24h = recent;
  // Older than 24 hours, phase 1: about 6.000 rows, and an old «Impostazioni» action.
  await settings("now() - interval '30 days'");
  await owner.query(load(1, 250, OLD));
  await owner.query("vacuum analyze public.audit_logs");
  timings.righeVecchieFase1 = await count("occurred_at < now() - interval '24 hours'");
  ok(
    timings.righeVecchieFase1 > 5000,
    `Fase 1: ${timings.righeVecchieFase1} righe più vecchie di 24 ore`,
  );
  const flush = async () => {
    for (const client of [owner, reader]) await client.query("select pg_stat_force_next_flush()");
    await new Promise((done) => setTimeout(done, 100));
  };
  const measured = async (label, options = {}) => {
    await flush();
    const before = await auditStats();
    const page = await timed(label, options);
    await flush();
    const after = await auditStats();
    eq(after.seq - before.seq, 0, `${label}: nessuna scansione completa di audit_logs`);
    return { page, fetched: after.fetched - before.fetched };
  };
  const small = await measured("primaPaginaFase1");
  eq(small.page.items.length, 50);
  // Phase 2: more than 20.000 rows older than 24 hours.
  await owner.query(load(251, 1000, OLD));
  await owner.query("vacuum analyze public.audit_logs");
  const rows = await count();
  timings.righe = rows;
  timings.righeVecchie = await count("occurred_at < now() - interval '24 hours'");
  ok(timings.righeVecchie >= 20000, `Fase 2: ${timings.righeVecchie} righe più vecchie di 24 ore`);

  // EXPLAIN: the reads the feed makes use the indexes, never a full scan of audit_logs.
  const plan = async (sql, args) =>
    JSON.stringify((await owner.query(`explain (format json) ${sql}`, args)).rows[0]["QUERY PLAN"]);
  let text = await plan(
    "select occurred_at from public.audit_logs where occurred_at >= now() - interval '24 hours' order by occurred_at desc limit 400",
  );
  ok(
    text.includes("audit_logs_time") && !text.includes("Seq Scan"),
    "Blocchi delle 24 ore: indice audit_logs_time",
  );
  text = await plan(
    "select occurred_at from public.audit_logs where occurred_at >= now() - interval '24 hours' and actor_id = $1 order by actor_id, occurred_at desc limit 400",
    [team[2]],
  );
  ok(
    /audit_logs_(time|actor_time)/.test(text) && !text.includes("Seq Scan"),
    "Blocchi per persona: un indice, mai tutta la tabella",
  );
  text = await plan(
    "select occurred_at from public.audit_logs where occurred_at >= now() - interval '24 hours' and actor_id is null order by actor_id, occurred_at desc limit 400",
  );
  ok(
    /audit_logs_(time|actor_time)/.test(text) && !text.includes("Seq Scan"),
    "Blocchi delle automazioni: un indice",
  );
  text = await plan(
    "select 1 from public.audit_logs a where a.table_name = 'sales_orders' and coalesce(a.new_data ->> 'id', a.old_data ->> 'id', a.record_key ->> 'id') = $1",
    [randomUUID()],
  );
  ok(
    text.includes("audit_logs_feed_entity") && !text.includes("Seq Scan"),
    "Storia di un elemento: indice audit_logs_feed_entity",
  );
  text = await plan(
    "select 1 from public.audit_logs l where l.table_name = 'partner_work_links' and l.operation = 'INSERT' and l.new_data ->> 'task_id' = $1",
    [randomUUID()],
  );
  ok(
    text.includes("audit_logs_follow_up_task") && !text.includes("Seq Scan"),
    "Solleciti: indice audit_logs_follow_up_task",
  );

  // One page: the same rows read and the same time with 4 times more old history.
  const big = await measured("primaPagina");
  eq(big.page.items.length, 50);
  timings.righeLettePrimaPagina = big.fetched;
  ok(
    big.fetched <= small.fetched + 50,
    `Righe lette: ${small.fetched} con ${timings.righeVecchieFase1} righe vecchie, ${big.fetched} con ${timings.righeVecchie}`,
  );
  ok(big.fetched < recent, `Una pagina legge meno delle ${recent} righe delle 24 ore`);
  ok(
    big.page.ms < Math.max(3 * timings.primaPaginaFase1, timings.primaPaginaFase1 + 150),
    `Costo legato alle 24 ore: ${timings.primaPaginaFase1} ms e ${Math.round(big.page.ms)} ms`,
  );
  eq(
    big.page.items[0].message,
    "Persona sintetica 1 ha registrato una consegna (3 unità · diretta).",
  );
  await timed("filtroPersona", { actor: team[3] });
  await timed("filtroSistema", { actor: "system" });
  await timed("filtroFinance", { area: "finance" });
  await timed("filtroPartner", { area: "partner" });
  // Every action of the 24 hours, page after page: none lost, none repeated, none older.
  const seen = new Set();
  let cursor = null,
    page,
    pages = 0,
    total = 0,
    imported = 0;
  const since = Date.now() - 24 * 3600 * 1000;
  const startedAll = performance.now();
  do {
    page = await feed({ cursor });
    pages++;
    for (const item of page.items) {
      assert.ok(!seen.has(item.id), "Nessuna frase ripetuta tra le pagine");
      assert.ok(Date.parse(item.occurred_at) >= since - 60000, "Solo le ultime 24 ore");
      seen.add(item.id);
      if (item.message === "Il sistema ha importato 207 contatti in Partner.") imported++;
    }
    total += page.items.length;
    cursor = page.next_cursor;
  } while (cursor && pages < 100);
  timings.tutteLe24OreMs = Math.round(performance.now() - startedAll);
  timings.pagine24h = pages;
  eq(
    total,
    itemsUpTo(150) + 2,
    "Le 24 ore intere: vendite, consegne, attività, revisioni, invii, import, impostazioni",
  );
  eq(imported, 1, "L’import di 207 contatti è una frase");
  ok(
    timings.tutteLe24OreMs / pages < BUDGET_MS / 2,
    `Media per pagina ${Math.round(timings.tutteLe24OreMs / pages)} ms`,
  );
  // A rare filter inside the 24 hours: bounded reads, the cursor stops at the block boundary.
  cursor = null;
  let found = [],
    requests = 0,
    slowest = 0;
  do {
    page = await feed({ area: "settings", cursor });
    requests++;
    slowest = Math.max(slowest, page.ms);
    found = found.concat(page.items);
    if (page.next_cursor && !page.items.length) eq(page.next_cursor.id, NIL, "Cursore di confine");
    cursor = page.next_cursor;
  } while (cursor && requests < 20);
  timings.filtroRaroLetture = requests;
  timings.filtroRaroPeggiore = Math.round(slowest);
  eq(
    found.map((item) => item.message),
    ["Persona sintetica 1 ha aggiornato le impostazioni del team."],
    "Solo l’azione delle 24 ore",
  );
  ok(slowest < BUDGET_MS, `Filtro raro: lettura più lenta ${Math.round(slowest)} ms`);
  // Feed reads never write.
  eq(await count(), rows);
  console.log(`Tempi (ms) e righe: ${JSON.stringify(timings)}`);
  console.log(
    `PASS ${checks} CEO activity feed scale checks; PostgreSQL 17 reale, ${rows} righe di audit sintetiche (${timings.righeVecchie} oltre le 24 ore), nessun cloud.`,
  );
} finally {
  for (const client of [reader, owner])
    try {
      await client?.end();
    } catch {}
  try {
    if (started) command("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
