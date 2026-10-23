// test-db: postgres minimo 327
// PostgreSQL 17 reale e gate CEO esistente; Auth/JWT e tutti i dati sono sintetici.
// Nessun DSN, cloud, worktree P2/P3 o segreto operativo viene utilizzato.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
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
const directory = mkdtempSync("/private/tmp/luckylap-ceo-feed-"),
  data = join(directory, "data"),
  socket = join(directory, "socket");
mkdirSync(socket, { mode: 0o700 });
const clients = [];
let started = false;
let owner;
let writerA;
let writerB;
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
const roles = [
  "founder",
  "production",
  "finance",
  "logistics",
  "consultant",
  "outsider",
  "inactive",
];
const users = Object.fromEntries(roles.map((role) => [role, randomUUID()])),
  sessions = Object.fromEntries(roles.map((role) => [role, randomUUID()]));
const fixed = "2026-10-22T10:00:00.123456Z";
async function connect() {
  const client = new Client({
    host: socket,
    port: 5432,
    user: "luckylap_ceo_qa",
    database: "postgres",
    ssl: false,
    statement_timeout: 15000,
  });
  await client.connect();
  clients.push(client);
  return client;
}
async function asRole(client, who, sql, args = [], role = "authenticated", claims = {}) {
  await client.query("begin");
  try {
    await client.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ role, sub: users[who], session_id: sessions[who], aal: "aal1", ...claims }),
    ]);
    await client.query(`set local role ${role}`);
    const r = await client.query(sql, args);
    await client.query("commit");
    return r;
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}
async function feed({
  actor = null,
  area = null,
  cursor = null,
  limit = 50,
  who = "founder",
  client = reader,
} = {}) {
  return (
    await asRole(client, who, "select public.ceo_activity_feed($1,$2,$3,$4,$5)result", [
      actor,
      area,
      cursor?.occurred_at ?? null,
      cursor?.id ?? null,
      limit,
    ])
  ).rows[0].result;
}
async function rejected(promise, code) {
  await assert.rejects(promise, (e) => e.code === code);
  checks++;
}
async function log(
  table,
  value,
  {
    actor = users.consultant,
    at = fixed,
    operation = "INSERT",
    old = null,
    key = null,
    client = owner,
  } = {},
) {
  const id = randomUUID();
  await client.query(
    "insert into public.audit_logs(id,occurred_at,actor_id,table_name,operation,record_key,old_data,new_data)values($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id,
      at,
      actor,
      table,
      operation,
      key ?? { id: value?.id ?? old?.id },
      old,
      operation === "DELETE" ? null : value,
    ],
  );
  return id;
}
try {
  command("initdb", [
    "-D",
    data,
    "-U",
    "luckylap_ceo_qa",
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
  writerA = await connect();
  writerB = await connect();
  reader = await connect();
  await owner.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
 create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
 create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid()returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;
 create schema extensions;create extension pgcrypto schema extensions;`);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations)
    .filter((name) =>
      /_(initial_schema|area_passwords|ceo_activity_feed|sensitive_area_member_passwords|ceo_feed_fixes)\.sql$/.test(
        name,
      ),
    )
    .sort())
    await owner.query(readFileSync(new URL(name, migrations), "utf8"));
  for (const role of roles) {
    await owner.query("insert into auth.users(id)values($1)", [users[role]]);
    await owner.query("insert into auth.sessions(id,user_id)values($1,$2)", [
      sessions[role],
      users[role],
    ]);
    if (role === "outsider") continue;
    await owner.query("insert into public.profiles(user_id,display_name)values($1,$2)", [
      users[role],
      `Persona sintetica ${role}`,
    ]);
    await owner.query("insert into public.memberships(user_id,role,active)values($1,$2,$3)", [
      users[role],
      role === "inactive" ? "founder" : role,
      role !== "inactive",
    ]);
  }
  await owner.query(
    "insert into private.sensitive_area_credentials(area,password_hash)values('audit',extensions.crypt('synthetic-ceo-password',extensions.gen_salt('bf',10)))",
  );
  for (const role of roles.filter((r) => r !== "outsider"))
    await owner.query(
      "insert into private.area_grants(session_id,user_id,area,credential_version,expires_at)select $1,$2,'audit',version,clock_timestamp()+interval '8 hours'from private.sensitive_area_credentials where area='audit'",
      [sessions[role], users[role]],
    );
  await owner.query("truncate public.audit_logs");
  // Denial is checked by the actual eight-hour/session/membership SQL, not a mock helper.
  // Since PR #14 every active member with the CEO password of this session reads the feed.
  for (const role of ["production", "finance", "logistics", "consultant"])
    eq((await feed({ who: role })).items, [], `${role}: feed con la password CEO`);
  for (const role of ["outsider", "inactive"]) await rejected(feed({ who: role }), "42501");
  await owner.query("delete from private.area_grants where user_id=$1", [users.production]);
  await rejected(feed({ who: "production" }), "42501");
  await rejected(
    asRole(reader, "founder", "select public.ceo_activity_feed()", [], "authenticated", {
      sub: null,
    }),
    "42501",
  );
  for (const role of ["anon", "service_role"])
    await rejected(
      asRole(reader, "founder", "select public.ceo_activity_feed()", [], role),
      "42501",
    );
  for (const sql of [
    "select * from private.activity_feed_actions()",
    "select private.activity_feed_text('x')",
    "select private.activity_partner_operation('partner_activities',null)",
    "select * from private.activity_feed_window(now(),now(),null)",
    "select private.activity_feed_keys('tasks',null,null,null)",
    "select private.activity_feed_parent('tasks','{}')",
  ])
    await rejected(asRole(reader, "founder", sql), "42501");
  // Same security shape as the first feed migration: empty search_path everywhere, definer only
  // for the gate, EXECUTE only on the two feed entry points and only for authenticated.
  const functions = (
    await owner.query(`select p.proname,n.nspname,p.prosecdef,p.proconfig,
      has_function_privilege('authenticated',p.oid,'execute')auth,has_function_privilege('anon',p.oid,'execute')anon,
      has_function_privilege('service_role',p.oid,'execute')service
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where (n.nspname='private' and (p.proname like 'activity_%' or p.proname='ceo_activity_feed')) or (n.nspname='public' and p.proname='ceo_activity_feed')`)
  ).rows;
  ok(functions.length >= 14, `${functions.length} funzioni del feed`);
  for (const f of functions) {
    ok(f.proconfig?.includes('search_path=""'), `${f.nspname}.${f.proname}: search_path vuoto`);
    eq(
      f.prosecdef,
      f.nspname === "private" && f.proname === "ceo_activity_feed",
      `${f.nspname}.${f.proname}: definer solo per il gate`,
    );
    eq(
      [f.auth, f.anon, f.service],
      [f.proname === "ceo_activity_feed", false, false],
      `${f.nspname}.${f.proname}: EXECUTE`,
    );
  }
  eq((await feed()).items, [], "Feed iniziale vuoto");
  await owner.query("delete from private.area_grants where user_id=$1", [users.founder]);
  await rejected(feed(), "42501");
  await owner.query(
    "insert into private.area_grants(session_id,user_id,area,credential_version,expires_at)select $1,$2,'audit',version,clock_timestamp()+interval '8 hours'from private.sensitive_area_credentials where area='audit'",
    [sessions.founder, users.founder],
  );
  await owner.query(
    "update private.sensitive_area_credentials set version=gen_random_uuid() where area='audit'",
  );
  await rejected(feed(), "42501");
  await owner.query(
    "update private.area_grants set credential_version=(select version from private.sensitive_area_credentials where area='audit')where user_id=$1",
    [users.founder],
  );
  await rejected(
    asRole(reader, "outsider", "select public.ceo_activity_feed()", [], "authenticated", {
      user_metadata: { role: "founder" },
      app_metadata: { role: "founder" },
    }),
    "42501",
  );
  await owner.query(
    "update private.area_grants set expires_at=clock_timestamp()-interval '1 second'where user_id=$1",
    [users.founder],
  );
  await rejected(feed(), "42501");
  await owner.query(
    "update private.area_grants set expires_at=clock_timestamp()+interval '8 hours'where user_id=$1",
    [users.founder],
  );
  await owner.query(
    "update auth.sessions set not_after=clock_timestamp()-interval'1 second'where id=$1",
    [sessions.founder],
  );
  await rejected(feed(), "42501");
  await owner.query("update auth.sessions set not_after=null where id=$1", [sessions.founder]);
  for (const args of [
    ["bad", null, null, null, 50],
    [null, "bad", null, null, 50],
    [null, null, fixed, null, 50],
    [null, null, null, null, 51],
  ])
    await rejected(
      asRole(reader, "founder", "select public.ceo_activity_feed($1,$2,$3,$4,$5)", args),
      "22023",
    );
  // Every scenario has its own transaction time: occurred_at + actor is the transaction.
  // The feed shows only the last 24 hours (now() in SQL): scenarios start 20 hours ago.
  let clock = Date.now() - 20 * 3600 * 1000;
  const tick = () => {
    clock += 1000;
    return new Date(clock).toISOString().replace(/\.\d{3}Z$/, ".000001Z");
  };
  const at = async (time, options = {}) =>
    (await feed(options)).items.filter((item) => item.occurred_at === time);
  const one = async (time, options = {}, label = "Una sola frase") => {
    const found = await at(time, options);
    eq(found.length, 1, label);
    return found[0];
  };
  // Message text only for digits: random UUIDs in links may contain any digits.
  const leaks = (value) => /PRIVATE/.test(JSON.stringify(value)) || /987|€/.test(value.message);
  const shop = randomUUID();
  await owner.query(
    "insert into public.stock_locations(id,code,name,location_type)values($1,'NEGQA','Negozio sintetico','Negozio Conto Vendita')",
    [shop],
  );
  // The founder's own actions are in the default view («Tutti»).
  let t = tick();
  const founderCall = randomUUID();
  await log(
    "calendar_events",
    { id: founderCall, title: "Call sintetica founder", event_type: "meeting" },
    { actor: users.founder, at: t },
  );
  let row = await one(t, {}, "Il default comprende le azioni del founder");
  eq(row.actor_id, users.founder);
  eq(row.message, "Persona sintetica founder ha aggiunto una call: Call sintetica founder.");
  eq(row.href, `/team#evento-${founderCall}`);
  eq((await at(t, { actor: users.founder })).length, 1, "Filtro esplicito founder ammesso");
  eq((await at(t, { actor: users.consultant })).length, 0, "Filtro persona esatto");
  // Only the last 24 hours: an older action stays in audit_logs and never reaches the feed.
  const old = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  await log("tasks", { id: randomUUID(), title: "Attività di due giorni fa" }, { at: old });
  for (const options of [{}, { actor: users.consultant }, { area: "team" }])
    ok(
      !(await feed(options)).items.some((item) => item.message.includes("due giorni fa")),
      `Più vecchia di 24 ore: fuori dal feed ${JSON.stringify(options)}`,
    );
  eq(
    (await feed({ cursor: { occurred_at: t, id: "00000000-0000-0000-0000-000000000000" } }))
      .next_cursor,
    null,
    "Nessuna pagina oltre le 24 ore",
  );
  eq(
    (
      await owner.query(
        "select count(*)::int n from public.audit_logs where new_data->>'title'=$1",
        ["Attività di due giorni fa"],
      )
    ).rows[0].n,
    1,
    "La riga resta nel registro tecnico",
  );
  // Same transaction, same kind: one sentence with the number; other actors stay apart.
  t = tick();
  await log("tasks", { id: randomUUID(), title: "Attività sintetica uno" }, { at: t });
  await log("tasks", { id: randomUUID(), title: "Attività sintetica due" }, { at: t });
  await log(
    "tasks",
    { id: randomUUID(), title: "Attività di un altro" },
    {
      at: t,
      actor: users.production,
    },
  );
  let rows = await at(t);
  eq(rows.length, 2, "Due persone nello stesso istante: due frasi");
  row = rows.find((item) => item.actor_id === users.consultant);
  eq(row.message, "Persona sintetica consultant ha aggiunto 2 attività.");
  eq(row.href, "/team");
  eq(row.area, "team");
  ok(rows.some((item) => item.message.endsWith("ha aggiunto un’attività: Attività di un altro.")));
  const later = tick();
  await log("tasks", { id: randomUUID(), title: "Attività successiva" }, { at: later });
  eq((await at(later)).length, 1, "Stesso attore, transazione diversa: frase diversa");
  await log(
    "notes",
    { id: randomUUID(), title: "Automazione sintetica" },
    {
      actor: null,
      at: (t = tick()),
    },
  );
  eq((await at(t, { actor: "system" })).length, 1);
  ok((await feed()).actors.some((actor) => actor.id === "system"));
  ok((await feed()).actors.some((actor) => actor.id === users.founder));
  // DELETE survives without any current source table/row and does not carry body/contact fields.
  t = tick();
  await log("notes", null, {
    at: t,
    operation: "DELETE",
    old: {
      id: randomUUID(),
      title: "Nota rimossa sintetica",
      body: "PRIVATE_BODY",
      email: "nobody@example.invalid",
    },
  });
  row = await one(t);
  eq(row.href, "/team");
  ok(row.message.includes("Nota rimossa sintetica"));
  ok(!JSON.stringify(row).includes("PRIVATE_BODY"));
  t = tick();
  await log(
    "calendar_events",
    {
      id: randomUUID(),
      title:
        "Call nobody@example.invalid https://example.invalid +390000000000 sb_secret_SYNTHETIC_TOKEN",
      event_type: "meeting",
    },
    { at: t },
  );
  row = await one(t);
  ok(row.message.includes("recapito omesso"));
  ok(!JSON.stringify(row).includes("example.invalid"));
  ok(!JSON.stringify(row).includes("sb_secret_"));
  ok(!JSON.stringify(row).includes("+390000"));
  // Finance and payments: no amount, category, description or reason for any Finance-related table.
  const money = {
    amount_eur: 987.65,
    amount_cents: 98765,
    refund_cents: 98765,
    payment_cents: 98765,
    total_cents: 98765,
    category: "PRIVATE_CATEGORY",
    category_label: "PRIVATE_CATEGORY",
    finance_category: "PRIVATE_CATEGORY",
    description: "PRIVATE_DESCRIPTION",
    label: "PRIVATE_LABEL",
    reason: "PRIVATE_REASON",
    note: "PRIVATE_NOTE",
  };
  const order = randomUUID(),
    entry = randomUUID(),
    batch = randomUUID(),
    payment = randomUUID(),
    shopPayment = randomUUID(),
    report = randomUUID(),
    source = randomUUID();
  const financeCases = [
    {
      table: "finance_entries",
      value: { id: entry, entry_type: "expense", ...money },
      message: "ha registrato un movimento Finance.",
      href: `/finance#movimento-manual-${entry}`,
    },
    {
      table: "finance_entries",
      value: { id: entry, entry_type: "expense", ...money, amount_eur: 987.66 },
      options: { operation: "UPDATE", old: { id: entry, ...money } },
      message: "ha corretto un movimento Finance.",
      href: `/finance#movimento-manual-${entry}`,
    },
    {
      table: "finance_entry_voids",
      value: { id: randomUUID(), entry_id: entry, ...money },
      message: "ha annullato un movimento Finance.",
      href: `/finance#movimento-manual-${entry}`,
    },
    {
      table: "finance_documents",
      value: { id: randomUUID(), source_kind: "budgetflow", ...money },
      message: "ha archiviato un documento Finance.",
      href: "/finance",
    },
    {
      table: "finance_movement_revisions",
      value: {
        id: randomUUID(),
        operation_id: randomUUID(),
        source_kind: "budgetflow",
        source_id: source,
        version: 1,
        previous_version: 0,
        action: "update",
        value_snapshot: { ...money, direction: "expense" },
        ...money,
      },
      message: "ha corretto un movimento Finance.",
      href: `/finance#movimento-budgetflow-${source}`,
    },
    {
      table: "finance_movement_revisions",
      value: {
        id: randomUUID(),
        operation_id: randomUUID(),
        source_kind: "consignment_settlement",
        source_id: source,
        version: 2,
        action: "delete",
        deleted: true,
        value_snapshot: money,
      },
      message: "ha eliminato un movimento Finance.",
      href: `/finance#movimento-consignment-${source}`,
    },
    {
      table: "finance_movement_revisions",
      value: {
        id: randomUUID(),
        operation_id: randomUUID(),
        source_kind: "payment",
        source_id: source,
        version: 3,
        action: "restore",
        value_snapshot: money,
      },
      message: "ha ripristinato un movimento Finance.",
      href: `/finance#movimento-payment-${source}`,
    },
    {
      table: "order_payments",
      value: { id: payment, order_id: order, operation_id: randomUUID(), method: "cash", ...money },
      message: "ha registrato un incasso.",
      href: `/sales#order-${order}`,
    },
    {
      table: "shopify_refund_observations",
      value: { id: randomUUID(), order_id: order, ...money },
      message: "ha registrato un rimborso.",
      href: `/sales#order-${order}`,
    },
    {
      table: "consignment_settlements",
      value: { id: randomUUID(), sale_id: randomUUID(), ...money },
      message: "ha registrato un incasso dal conto vendita.",
      href: "/finance",
    },
    {
      table: "consignment_report_payments",
      value: { id: shopPayment, report_id: report, location_id: shop, ...money },
      message: "ha registrato un incasso da Negozio sintetico.",
      href: `/finance#movimento-shop_payment-${shopPayment}`,
    },
    {
      table: "consignment_report_payments",
      value: { id: shopPayment, report_id: report, location_id: shop, ...money, amount_cents: 1 },
      options: { operation: "UPDATE", old: { id: shopPayment, report_id: report, ...money } },
      message: "ha modificato un incasso da Negozio sintetico.",
      href: `/finance#movimento-shop_payment-${shopPayment}`,
    },
    {
      table: "consignment_payment_revisions",
      value: {
        id: randomUUID(),
        payment_id: shopPayment,
        version: 3,
        voided: true,
        snapshot: { ...money, finance: { category: "PRIVATE_CATEGORY" } },
      },
      message: "ha eliminato un incasso dal conto vendita.",
      href: "/finance",
    },
  ];
  for (const item of financeCases) {
    t = tick();
    await log(item.table, item.value, { at: t, ...item.options });
    row = await one(t, { area: "finance" }, `Una frase Finance per ${item.table}`);
    eq(row.message, `Persona sintetica consultant ${item.message}`, `Frase di ${item.table}`);
    eq(row.href, item.href, `Link di ${item.table}`);
    ok(!leaks(row), `Nessun importo o testo Finance per ${item.table}`);
  }
  // BudgetFlow import: the batch and its rows are one sentence with the count, no amounts.
  t = tick();
  await log(
    "finance_import_batches",
    { id: batch, source_row_count: 3, ...money },
    {
      at: t,
      actor: null,
    },
  );
  for (let i = 0; i < 3; i++)
    await log(
      "finance_import_transactions",
      { id: randomUUID(), batch_id: batch, ...money },
      {
        at: t,
        actor: null,
      },
    );
  row = await one(t, { actor: "system" });
  eq(row.message, "Il sistema ha importato 3 movimenti da BudgetFlow.");
  ok(!leaks(row));
  // P4 revision pairs on one movement are two actions (different operations), never merged into one.
  t = tick();
  for (const action of ["update", "restore"])
    await log(
      "finance_movement_revisions",
      {
        id: randomUUID(),
        operation_id: randomUUID(),
        source_kind: "manual",
        source_id: entry,
        action,
        value_snapshot: money,
      },
      { at: t },
    );
  rows = await at(t, { area: "finance" });
  eq(rows.length, 2, "Due revisioni diverse nella stessa transazione restano due tipi");
  ok(rows.every((item) => item.href === `/finance#movimento-manual-${entry}`));
  // Monthly consignment report: pieces and «da fatturare» (decision 16, 03 §10); invoice without number.
  t = tick();
  await log(
    "consignment_reports",
    { id: report, location_id: shop, period_month: "2026-10-01", ...money },
    { at: t },
  );
  await log(
    "consignment_report_revisions",
    {
      id: randomUUID(),
      report_id: report,
      location_id: shop,
      revision: 1,
      change_kind: "lines",
      reason: "PRIVATE_REASON",
      snapshot: { period_month: "2026-10", pieces: 12, brand_cents: 13499, gross_cents: 98765 },
    },
    { at: t },
  );
  await log(
    "consignment_report_lines",
    { id: randomUUID(), report_id: report, quantity: 12, ...money },
    { at: t },
  );
  await log(
    "stock_movements",
    {
      id: randomUUID(),
      stock_item_id: randomUUID(),
      location_id: shop,
      kind: "consignment_sale",
      source: { consignment_report_id: report },
    },
    { at: t },
  );
  row = await one(t, { area: "consignment" });
  eq(
    row.message,
    "Persona sintetica consultant ha registrato il resoconto di ottobre 2026 di Negozio sintetico: 12 pezzi, 134,99 € da fatturare.",
  );
  eq(row.href, "/consignment/NEGQA/resoconto/2026-10");
  ok(!/PRIVATE/.test(JSON.stringify(row)) && !row.message.includes("987"));
  eq((await at(t, { area: "sales" })).length, 0, "Il conto vendita non è più sotto Vendite");
  for (const [revision, change_kind, expected] of [
    [2, "lines", "ha corretto il resoconto di ottobre 2026 di Negozio sintetico."],
    [3, "invoice", "ha segnato la fattura del resoconto di ottobre 2026 di Negozio sintetico."],
  ]) {
    t = tick();
    await log(
      "consignment_report_revisions",
      {
        id: randomUUID(),
        report_id: report,
        location_id: shop,
        revision,
        change_kind,
        reason: "PRIVATE_REASON",
        snapshot: {
          period_month: "2026-10",
          pieces: 12,
          brand_cents: 98765,
          invoice: { number: "PRIVATE_INVOICE" },
        },
      },
      { at: t },
    );
    row = await one(t);
    eq(row.message, `Persona sintetica consultant ${expected}`);
    eq(row.href, "/consignment/NEGQA/resoconto/2026-10");
    ok(!leaks(row), "Correzione e fattura senza importo né numero");
  }
  const consignmentCases = [
    [
      "consignment_counts",
      { id: randomUUID(), location_id: shop, pieces: 23, full_count: true, note: "PRIVATE_NOTE" },
      {},
      "ha contato Negozio sintetico: 23 pezzi.",
    ],
    [
      "consignment_orders",
      {
        id: randomUUID(),
        location_id: shop,
        order_number: 3,
        status: "open",
        note: "PRIVATE_NOTE",
      },
      {},
      "ha inserito l’ordine n. 3 di Negozio sintetico.",
    ],
    [
      "consignment_shipments",
      {
        id: randomUUID(),
        location_id: shop,
        direction: "to_shop",
        pieces: 6,
        reason: "PRIVATE_REASON",
      },
      {},
      "ha consegnato 6 pezzi a Negozio sintetico.",
    ],
    [
      "consignment_shipments",
      {
        id: randomUUID(),
        location_id: shop,
        direction: "to_warehouse",
        pieces: 1,
        reason: "PRIVATE_REASON",
      },
      {},
      "ha riportato 1 pezzo in magazzino da Negozio sintetico.",
    ],
    [
      "consignment_shops",
      { location_id: shop, markup_cents: 98765, brand_share_bps: 9876, note: "PRIVATE_NOTE" },
      {
        operation: "UPDATE",
        key: { location_id: shop },
        old: { location_id: shop, markup_cents: 1 },
      },
      "ha cambiato le condizioni di Negozio sintetico.",
    ],
  ];
  for (const [table, value, options, expected] of consignmentCases) {
    t = tick();
    await log(table, value, { at: t, ...options });
    if (table === "consignment_shipments")
      await log(
        "stock_movements",
        {
          id: randomUUID(),
          stock_item_id: randomUUID(),
          location_id: shop,
          kind: "transfer_out",
          source: { consignment_shipment_id: value.id },
        },
        { at: t },
      );
    row = await one(t, { area: "consignment" }, `Una frase per ${table}`);
    eq(row.message, `Persona sintetica consultant ${expected}`);
    eq(row.href, "/consignment/NEGQA");
    ok(!leaks(row));
  }
  // Stock adjustments open «Rettifiche»; a sale writes many rows and stays one sentence.
  t = tick();
  const item = randomUUID(),
    mag = randomUUID();
  await log(
    "stock_movements",
    {
      id: randomUUID(),
      stock_item_id: item,
      location_id: mag,
      kind: "adjustment",
      quantity_delta: 2,
      reason: "PRIVATE_REASON",
    },
    { at: t },
  );
  await log(
    "stock_balances",
    { stock_item_id: item, location_id: mag, quantity: 5 },
    { at: t, operation: "UPDATE", key: { stock_item_id: item, location_id: mag } },
  );
  row = await one(t, { area: "stock" });
  eq(row.message, "Persona sintetica consultant ha rettificato il magazzino.");
  eq(row.href, "/stock/rettifiche");
  t = tick();
  const sale = randomUUID();
  await log(
    "sales_orders",
    { id: sale, operation_id: randomUUID(), channel: "direct", ...money },
    { at: t },
  );
  for (let i = 0; i < 2; i++) {
    const line = randomUUID(),
      stock = randomUUID();
    await log("sales_order_lines", { id: line, order_id: sale, quantity: 2, ...money }, { at: t });
    await log(
      "stock_reservations",
      { order_line_id: line, stock_item_id: stock, location_id: mag, reserved_quantity: 2 },
      { at: t, key: { stock_item_id: stock, location_id: mag } },
    );
    await log(
      "stock_movements",
      {
        id: randomUUID(),
        stock_item_id: stock,
        location_id: mag,
        kind: "reservation",
        source: { sales_order_id: sale, sales_order_line_id: line },
      },
      { at: t },
    );
    await log(
      "stock_balances",
      { stock_item_id: stock, location_id: mag, quantity: 1 },
      { at: t, operation: "UPDATE", key: { stock_item_id: stock, location_id: mag } },
    );
  }
  await log(
    "commercial_facts",
    { id: randomUUID(), order_id: sale, fact_kind: "sale", ...money },
    { at: t },
  );
  await log(
    "order_payments",
    { id: randomUUID(), order_id: sale, operation_id: randomUUID(), method: "cash", ...money },
    { at: t },
  );
  row = await one(t, {}, "Una vendita di 10 righe è una frase");
  eq(row.message, "Persona sintetica consultant ha registrato una vendita (4 unità · diretta).");
  eq(row.href, `/sales#order-${sale}`);
  eq(row.area, "sales");
  ok(!leaks(row));
  // Registration cancellation and return (PR #9): one sentence each, whole transaction, no amounts.
  t = tick();
  await log(
    "sales_registration_cancellations",
    { id: randomUUID(), order_id: sale, operation_id: randomUUID(), product_quantity: 4, ...money },
    { at: t },
  );
  await log(
    "sales_orders",
    { id: sale, order_state: "cancelled", ...money },
    { at: t, operation: "UPDATE", old: { id: sale } },
  );
  await log(
    "sales_order_lines",
    { id: randomUUID(), order_id: sale, quantity: 2, cancelled_quantity: 2 },
    { at: t, operation: "UPDATE" },
  );
  await log(
    "stock_movements",
    {
      id: randomUUID(),
      stock_item_id: item,
      location_id: mag,
      kind: "reservation_release",
      source: { sales_order_id: sale },
    },
    { at: t },
  );
  await log(
    "finance_movement_revisions",
    {
      id: randomUUID(),
      operation_id: randomUUID(),
      source_kind: "payment",
      source_id: randomUUID(),
      action: "delete",
      deleted: true,
      value_snapshot: money,
    },
    { at: t },
  );
  await log(
    "commercial_facts",
    { id: randomUUID(), order_id: sale, fact_kind: "cancellation", ...money },
    { at: t },
  );
  row = await one(t, {}, "L’annullamento è una sola frase, con il pagamento eliminato");
  eq(row.message, "Persona sintetica consultant ha annullato la registrazione di una vendita.");
  eq(row.href, `/sales#order-${sale}`);
  eq(row.area, "sales");
  ok(!leaks(row));
  t = tick();
  const sold = randomUUID(),
    returned = randomUUID(),
    returnLine = randomUUID();
  await log(
    "manual_sale_returns",
    {
      id: returned,
      order_id: sold,
      operation_id: randomUUID(),
      finance_entry_id: entry,
      product_quantity: 1,
      ...money,
    },
    { at: t },
  );
  await log(
    "manual_sale_return_lines",
    { id: returnLine, return_id: returned, order_line_id: randomUUID(), quantity: 1, ...money },
    { at: t },
  );
  await log(
    "manual_sale_return_fulfillments",
    { id: randomUUID(), return_line_id: returnLine, quantity: 1 },
    { at: t },
  );
  await log(
    "manual_sale_return_packaging",
    { id: randomUUID(), return_id: returned, stock_item_id: randomUUID(), quantity: 1 },
    { at: t },
  );
  await log("finance_entries", { id: randomUUID(), entry_type: "expense", ...money }, { at: t });
  await log(
    "stock_movements",
    {
      id: randomUUID(),
      stock_item_id: item,
      location_id: mag,
      kind: "return",
      source: { return_id: returned, sales_order_id: sold },
    },
    { at: t },
  );
  await log(
    "sales_orders",
    { id: sold, order_state: "returned" },
    { at: t, operation: "UPDATE", old: { id: sold } },
  );
  row = await one(t, {}, "Il reso è una sola frase, con il rimborso in Finance");
  eq(row.message, "Persona sintetica consultant ha registrato un reso.");
  eq(row.href, `/sales#order-${sold}`);
  ok(!leaks(row));
  eq((await at(t, { area: "finance" })).length, 0, "Il rimborso non diventa una seconda frase");
  // Archive and restore of a brand asset (set_brand_asset_archived).
  const asset = randomUUID();
  for (const [archivedBefore, archivedAfter, verb] of [
    [null, "2026-10-01T09:00:00Z", "ha archiviato"],
    ["2026-10-01T09:00:00Z", null, "ha ripristinato"],
  ]) {
    t = tick();
    await log(
      "assets",
      {
        id: asset,
        name: "Logo sintetico",
        asset_type: "logo",
        description: "PRIVATE_DESCRIPTION",
        archived_at: archivedAfter,
      },
      {
        at: t,
        operation: "UPDATE",
        actor: users.production,
        old: { id: asset, name: "Logo sintetico", archived_at: archivedBefore },
      },
    );
    row = await one(t);
    eq(row.message, `Persona sintetica production ${verb} un contenuto: Logo sintetico.`);
    eq(row.href, `/assets#contenuto-${asset}`);
    eq(row.area, "assets");
  }
  t = tick();
  await log(
    "assets",
    { id: asset, name: "Logo rinominato", archived_at: null },
    { at: t, operation: "UPDATE", old: { id: asset, name: "Logo sintetico", archived_at: null } },
  );
  ok((await one(t)).message.includes("ha aggiornato un contenuto: Logo rinominato"));
  // Bulk operations of one transaction: the Partner import (207 contacts) is one sentence.
  t = tick();
  await log(
    "partner_research_imports",
    { source_commit: "synthetic", partners_total: 207, partners_new: 207 },
    { at: t, actor: null, key: { id: randomUUID() } },
  );
  for (let co = 1; co <= 207; co++) {
    const partner = randomUUID(),
      variant = randomUUID();
    await log(
      "partners",
      { co, name: `Contatto sintetico ${co}`, stage: "da_contattare" },
      { at: t, actor: null, key: { id: partner } },
    );
    await log(
      "partner_contacts",
      { partner_id: partner, kind: "email" },
      { at: t, actor: null, key: { id: randomUUID(), partner_id: partner } },
    );
    await log(
      "partner_message_variants",
      { partner_id: partner, approach: "collab" },
      { at: t, actor: null, key: { id: variant, partner_id: partner } },
    );
    await log(
      "partner_message_revisions",
      { variant_id: variant, revision_no: 1 },
      { at: t, actor: null, key: { id: randomUUID(), variant_id: variant } },
    );
  }
  row = await one(t, { actor: "system" }, "L’import Partner di 207 contatti è una frase");
  eq(row.message, "Il sistema ha importato 207 contatti in Partner.");
  eq(row.href, "/partner");
  eq(row.area, "partner");
  eq((await at(t, { area: "partner" })).length, 1);
  // The Partner dates backfill (54 events with their links) and its cleanup: one sentence each.
  const datedPartners = Array.from({ length: 54 }, () => randomUUID()),
    events = Array.from({ length: 54 }, () => randomUUID());
  t = tick();
  for (let i = 0; i < 54; i++) {
    await log(
      "calendar_events",
      { id: events[i], title: `Evento · Contatto ${i}`, event_type: "other" },
      { at: t, actor: null },
    );
    await log(
      "partner_work_links",
      { partner_id: datedPartners[i], kind: "event", calendar_event_id: events[i], version: 1 },
      { at: t, actor: null, key: { id: randomUUID(), partner_id: datedPartners[i] } },
    );
  }
  row = await one(t, { actor: "system" }, "Il backfill delle date è una frase");
  eq(row.message, "Il sistema ha aggiunto 54 appuntamenti nel calendario.");
  eq(row.href, "/team");
  eq(row.area, "team");
  t = tick();
  for (let i = 0; i < 54; i++) {
    await log("calendar_events", null, {
      at: t,
      actor: null,
      operation: "DELETE",
      old: { id: events[i], title: `Evento · Contatto ${i}`, event_type: "other" },
    });
    await log(
      "partner_work_links",
      { partner_id: datedPartners[i], kind: "event", calendar_event_id: null, version: 2 },
      {
        at: t,
        actor: null,
        operation: "UPDATE",
        key: { id: randomUUID(), partner_id: datedPartners[i] },
      },
    );
  }
  row = await one(t, { actor: "system" }, "La pulizia delle date è una frase");
  eq(row.message, "Il sistema ha tolto 54 appuntamenti dal calendario.");
  // Inventory import: products, places, articles, opening movements and balances: one sentence.
  t = tick();
  for (let i = 0; i < 3; i++)
    await log("products", { id: randomUUID(), model: `Modello ${i}` }, { at: t, actor: null });
  for (let i = 0; i < 2; i++)
    await log(
      "stock_locations",
      { id: randomUUID(), code: `QA${i}`, name: `Sede ${i}` },
      { at: t, actor: null },
    );
  for (let i = 0; i < 10; i++) {
    const article = randomUUID();
    await log(
      "stock_items",
      {
        id: article,
        kind: "product",
        sku: `QA-${i}`,
        name: `Articolo ${i}`,
        unit_cost_eur: 987.65,
      },
      { at: t, actor: null },
    );
    await log(
      "product_variants",
      { stock_item_id: article, size: "M" },
      { at: t, actor: null, key: { stock_item_id: article } },
    );
    await log(
      "stock_movements",
      {
        id: randomUUID(),
        operation_id: randomUUID(),
        stock_item_id: article,
        location_id: mag,
        kind: "opening",
        quantity_delta: 4,
      },
      { at: t, actor: null },
    );
    await log(
      "stock_balances",
      { stock_item_id: article, location_id: mag, quantity: 4 },
      { at: t, actor: null, key: { stock_item_id: article, location_id: mag } },
    );
  }
  row = await one(t, { actor: "system" }, "L’import dell’inventario è una frase");
  eq(row.message, "Il sistema ha importato 10 articoli in magazzino.");
  eq(row.href, "/stock");
  // A source action with >50 technical rows is fully grouped before any limit/cursor.
  t = tick();
  const bigOrder = randomUUID(),
    lines = [];
  await log(
    "sales_orders",
    { id: bigOrder, operation_id: randomUUID(), channel: "shopify_web" },
    { at: t, actor: null },
  );
  for (let i = 0; i < 60; i++) {
    const line = randomUUID();
    lines.push(line);
    await log(
      "sales_order_lines",
      { id: line, order_id: bigOrder, quantity: 1 },
      { at: t, actor: null },
    );
  }
  let result = await feed({ area: "sales", limit: 1 });
  eq(result.items.length, 1);
  eq(result.items[0].message, "Il sistema ha ricevuto un ordine (60 unità · Shopify online).");
  const orderItem = result.items[0].id;
  const delivered = tick();
  for (const line of lines) {
    await log(
      "fulfillment_lines",
      { id: randomUUID(), order_line_id: line, quantity: 1 },
      { at: delivered },
    );
    await log(
      "stock_movements",
      {
        id: randomUUID(),
        stock_item_id: randomUUID(),
        source: { sales_order_id: bigOrder, sales_order_line_id: line },
      },
      { at: delivered },
    );
  }
  result = await feed({ area: "sales", limit: 1 });
  eq(
    result.items[0].message,
    "Persona sintetica consultant ha registrato una consegna (60 unità · Shopify online).",
    "Il canale della vendita accompagna la consegna",
  );
  eq(result.items[0].href, `/sales#order-${bigOrder}`);
  ok(result.next_cursor);
  eq(
    (await feed({ area: "sales", cursor: result.next_cursor, limit: 1 })).items[0].id,
    orderItem,
    "Il cursore non spezza un gruppo tecnico",
  );
  t = tick();
  await log("sales_orders", { id: randomUUID(), channel: "shopify_pos" }, { at: t, actor: null });
  row = await one(t);
  ok(row.message.includes("Shopify POS"));
  ok(!row.message.includes("0 unità"), "Quantità storica assente non inventata");
  ok(!row.message.includes("( ·"));
  // Exact microsecond boundaries and filters are applied to complete actions.
  const micro = tick().slice(0, -8);
  for (const [index, time] of [
    `${micro}.000001Z`,
    `${micro}.000002Z`,
    `${micro}.000003Z`,
  ].entries())
    await log(
      "notes",
      { id: randomUUID(), title: `Pagina sintetica ${index}` },
      { actor: null, at: time },
    );
  const first = await feed({ actor: "system", area: "team", limit: 2 });
  eq(first.items.length, 2);
  eq(first.next_cursor.occurred_at, `${micro}.000002Z`);
  const second = await feed({ actor: "system", area: "team", cursor: first.next_cursor, limit: 2 });
  ok(second.items.some((entry) => entry.occurred_at === `${micro}.000001Z`));
  ok(second.items.every((entry) => !first.items.some((other) => other.id === entry.id)));
  // P2 privacy-compatible activity keys and optional operation lookup, without importing its schema.
  await owner.query(
    "create table public.partner_activities(id uuid primary key,operation_id uuid not null)",
  );
  const partner = randomUUID(),
    activity = randomUUID();
  await owner.query("insert into public.partner_activities values($1,$2)", [
    activity,
    randomUUID(),
  ]);
  await log(
    "partners",
    { name: "Partner sintetico", co: 12, version: 2 },
    { key: { id: partner }, at: tick() },
  );
  t = tick();
  await log(
    "partner_activities",
    {
      partner_id: partner,
      partner_name: "Partner sintetico",
      partner_co: 12,
      kind: "inviato",
      origin: "team",
      body: "PRIVATE_PARTNER_BODY",
    },
    { key: { id: activity }, at: t },
  );
  row = await one(t, { area: "partner" });
  ok(row.message.includes("invio Partner"));
  eq(row.href, "/partner?co=12#lead-12");
  ok(!JSON.stringify(row).includes("PRIVATE_PARTNER_BODY"));
  // Concurrent commits: one statement never reads half an uncommitted action.
  await writerA.query("begin");
  await writerB.query("begin");
  const concurrentAt = tick();
  await log(
    "tasks",
    { id: randomUUID(), title: "Concorrente A" },
    { at: concurrentAt, client: writerA },
  );
  await log(
    "tasks",
    { id: randomUUID(), title: "Concorrente B" },
    { at: concurrentAt, client: writerB, actor: users.production },
  );
  await writerB.query("commit");
  eq((await at(concurrentAt)).length, 1, "Il gruppo non confermato resta invisibile");
  await writerA.query("commit");
  eq((await at(concurrentAt)).length, 2, "Due azioni indipendenti simultanee restano distinte");
  // P5 generated artifacts join only their link INSERT transaction, never all future edits.
  const linkedPartner = randomUUID(),
    generatedTask = randomUUID(),
    secondTask = randomUUID(),
    [
      generatedAt,
      nextCycleAt,
      responseAt,
      projectAt,
      calendarAt,
      manualAt,
      manualCalendarAt,
      saleAt,
      automationAt,
    ] = Array.from({ length: 9 }, tick);
  await log(
    "partners",
    { name: "Partner collegamenti sintetico", co: 73 },
    { key: { id: linkedPartner } },
  );
  const generatedActivity = randomUUID(),
    generatedOperation = randomUUID();
  await owner.query("insert into public.partner_activities values($1,$2)", [
    generatedActivity,
    generatedOperation,
  ]);
  await log(
    "partner_activities",
    {
      partner_id: linkedPartner,
      partner_name: "Partner collegamenti sintetico",
      partner_co: 73,
      kind: "inviato",
      origin: "team",
    },
    { at: generatedAt, key: { id: generatedActivity } },
  );
  await log(
    "tasks",
    { id: generatedTask, title: "Sollecito sintetico collegato", status: "todo" },
    { at: generatedAt },
  );
  await log(
    "partner_work_links",
    { partner_id: linkedPartner, kind: "follow_up", task_id: generatedTask },
    { at: generatedAt, key: { id: randomUUID() } },
  );
  let related = (await feed()).items.filter((item) => item.occurred_at === generatedAt);
  eq(related.length, 1, "L’invio e il sollecito generato sono un’azione");
  ok(related[0].message.includes("invio Partner"));
  eq(related[0].href, "/partner?co=73#lead-73");
  for (const [at, kind] of [
    [nextCycleAt, "inviato"],
    [responseAt, "risposta"],
  ]) {
    const sourceActivity = randomUUID();
    await owner.query("insert into public.partner_activities values($1,$2)", [
      sourceActivity,
      randomUUID(),
    ]);
    await log(
      "partner_activities",
      {
        partner_id: linkedPartner,
        partner_name: "Partner collegamenti sintetico",
        partner_co: 73,
        kind,
        origin: "team",
      },
      { at, key: { id: sourceActivity } },
    );
    await log(
      "tasks",
      {
        id: kind === "inviato" ? generatedTask : secondTask,
        title: "Sollecito chiuso automaticamente",
        status: "done",
      },
      { at, operation: "UPDATE" },
    );
    if (kind === "inviato") {
      await log(
        "tasks",
        { id: secondTask, title: "Secondo sollecito sintetico", status: "todo" },
        { at },
      );
      await log(
        "partner_work_links",
        { partner_id: linkedPartner, kind: "follow_up", task_id: secondTask },
        { at, key: { id: randomUUID() } },
      );
    }
    const sourceAction = (await feed()).items.filter((item) => item.occurred_at === at);
    eq(
      sourceAction.length,
      1,
      "La chiusura tecnica del vecchio sollecito appartiene all’azione Partner",
    );
    ok(sourceAction[0].message.includes(kind === "inviato" ? "invio Partner" : "risposta Partner"));
  }
  const generatedProject = randomUUID();
  await log(
    "product_development_projects",
    { id: generatedProject, name: "Progetto sintetico collegato" },
    { at: projectAt },
  );
  await log(
    "partner_work_links",
    { partner_id: linkedPartner, kind: "project", project_id: generatedProject },
    { at: projectAt, key: { id: randomUUID() } },
  );
  related = (await feed()).items.filter((item) => item.occurred_at === projectAt);
  eq(related.length, 1);
  eq(related[0].href, `/development#progetto-${generatedProject}`);
  const generatedCalendar = randomUUID(),
    calendarLink = randomUUID();
  await log(
    "calendar_events",
    { id: generatedCalendar, title: "Evento sintetico collegato" },
    { at: calendarAt },
  );
  await log(
    "partner_work_links",
    { partner_id: linkedPartner, kind: "event", calendar_event_id: generatedCalendar },
    { at: calendarAt, key: { id: calendarLink } },
  );
  related = (await feed()).items.filter((item) => item.occurred_at === calendarAt);
  eq(related.length, 1);
  eq(related[0].area, "team");
  await log(
    "tasks",
    { id: generatedTask, title: "Modifica manuale indipendente uno", status: "done" },
    { at: manualAt, operation: "UPDATE", old: { id: generatedTask } },
  );
  await log(
    "tasks",
    { id: secondTask, title: "Modifica manuale indipendente due", status: "done" },
    { at: manualAt, operation: "UPDATE", old: { id: secondTask } },
  );
  related = (await feed({ area: "team" })).items.filter((item) => item.occurred_at === manualAt);
  eq(related.length, 1, "Due task modificati nella stessa transazione: una frase Team");
  eq(related[0].message, "Persona sintetica consultant ha completato 2 attività.");
  eq(related[0].area, "team", "Le modifiche manuali successive non diventano un’azione Partner");
  await log(
    "calendar_events",
    { id: generatedCalendar, title: "Appuntamento manuale successivo" },
    { at: manualCalendarAt, operation: "UPDATE", old: { id: generatedCalendar } },
  );
  await log(
    "partner_work_links",
    {
      partner_id: linkedPartner,
      kind: "event",
      calendar_event_id: generatedCalendar,
      needs_review: true,
      version: 2,
    },
    { at: manualCalendarAt, operation: "UPDATE", key: { id: calendarLink } },
  );
  related = (await feed()).items.filter((item) => item.occurred_at === manualCalendarAt);
  eq(related.length, 1, "La sola invalidazione tecnica del link non duplica l’edit Team");
  eq(related[0].area, "team");
  const linkedOrder = randomUUID();
  await log(
    "partner_event_sales",
    { partner_id: linkedPartner, event_id: generatedCalendar, order_id: linkedOrder },
    { at: saleAt, key: { event_id: generatedCalendar, order_id: linkedOrder } },
  );
  related = (await feed()).items.filter((item) => item.occurred_at === saleAt);
  eq(related.length, 1);
  ok(related[0].message.includes("ha collegato una vendita"));
  ok(related[0].message.includes("Partner collegamenti sintetico"));
  eq(related[0].href, "/partner?co=73#lead-73");
  const automaticTask = randomUUID();
  await log(
    "tasks",
    { id: automaticTask, title: "Task automatico sintetico" },
    { at: automationAt, actor: null },
  );
  await log(
    "partner_work_links",
    { partner_id: linkedPartner, kind: "follow_up", task_id: automaticTask },
    { at: automationAt, actor: null, key: { id: randomUUID() } },
  );
  related = (await feed({ actor: "system" })).items.filter(
    (item) => item.occurred_at === automationAt,
  );
  eq(related.length, 1);
  eq(related[0].actor_id, null);
  ok(related[0].message.startsWith("Il sistema "));
  const allowed = ["id", "occurred_at", "actor_id", "actor_name", "area", "message", "href"].sort();
  for (const row of (await feed()).items)
    eq(Object.keys(row).sort(), allowed, "Solo DTO consentito");
  await owner.query("update public.memberships set active=false where user_id=$1", [users.founder]);
  await rejected(feed(), "42501");
  console.log(
    `PASS ${checks} CEO activity feed checks; PostgreSQL 17 reale, gate 8h reale, Auth/dati sintetici, nessun cloud.`,
  );
} finally {
  for (const client of clients.reverse())
    try {
      await client.end();
    } catch {}
  try {
    if (started) command("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
