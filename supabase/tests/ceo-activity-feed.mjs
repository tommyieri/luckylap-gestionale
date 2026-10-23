// test-db: postgres minimo 121
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
const fixed = "2026-10-22T10:00:00.123456Z",
  newer = "2026-10-22T11:00:00.123456Z";
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
    .filter((name) => /_(initial_schema|area_passwords|ceo_activity_feed)\.sql$/.test(name))
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
  for (const role of roles.filter((r) => r !== "founder"))
    await rejected(feed({ who: role }), "42501");
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
  ])
    await rejected(asRole(reader, "founder", sql), "42501");
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
    asRole(reader, "consultant", "select public.ceo_activity_feed()", [], "authenticated", {
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
  // Separate entities stay separate even at the same precise transaction timestamp.
  const task1 = randomUUID(),
    task2 = randomUUID();
  await log("tasks", { id: task1, title: "Attività sintetica uno" });
  await log("tasks", { id: task2, title: "Attività sintetica due" });
  let result = await feed({ area: "team" });
  eq(result.items.length, 2);
  ok(result.items.every((item) => item.message.includes("Attività sintetica")));
  ok(result.items.every((item) => item.href.startsWith("/team#attivita-")));
  await log(
    "calendar_events",
    { id: randomUUID(), title: "Call sintetica founder", event_type: "meeting" },
    { actor: users.founder },
  );
  eq((await feed({ area: "team" })).items.length, 2, "Default non comprende le azioni del founder");
  eq((await feed({ actor: users.founder })).items.length, 1, "Filtro esplicito founder ammesso");
  await log("notes", { id: randomUUID(), title: "Automazione sintetica" }, { actor: null });
  eq((await feed({ actor: "system" })).items.length, 1);
  ok((await feed()).actors.some((actor) => actor.id === "system"));
  // DELETE survives without any current source table/row and does not carry body/contact fields.
  const deleted = randomUUID();
  await log("notes", null, {
    operation: "DELETE",
    old: {
      id: deleted,
      title: "Nota rimossa sintetica",
      body: "DO_NOT_EXPOSE_BODY",
      email: "nobody@example.invalid",
    },
  });
  const deletedRow = (await feed({ area: "team" })).items.find((item) =>
    item.message.includes("Nota rimossa"),
  );
  eq(deletedRow.href, "/team");
  ok(!JSON.stringify(deletedRow).includes("DO_NOT_EXPOSE_BODY"));
  await log("calendar_events", {
    id: randomUUID(),
    title:
      "Call nobody@example.invalid https://example.invalid +390000000000 sb_secret_SYNTHETIC_TOKEN",
    event_type: "meeting",
  });
  const safe = (await feed({ area: "team" })).items.find((item) =>
    item.message.includes("recapito omesso"),
  );
  ok(safe);
  ok(!JSON.stringify(safe).includes("example.invalid"));
  ok(!JSON.stringify(safe).includes("sb_secret_"));
  ok(!JSON.stringify(safe).includes("+390000"));
  // No Finance grant is needed for already-authorized CEO summaries; only selected values cross.
  const financeId = randomUUID();
  await log("finance_entries", {
    id: financeId,
    amount_eur: 23.45,
    category: "Categoria sintetica",
    description: "PRIVATE_FINANCE_DESCRIPTION",
  });
  await log(
    "finance_entries",
    {
      id: financeId,
      amount_eur: 34.56,
      category: "Categoria sintetica",
      description: "PRIVATE_FINANCE_DESCRIPTION",
    },
    { operation: "UPDATE", at: newer, old: { id: financeId, amount_eur: 23.45 } },
  );
  result = await feed({ area: "finance", limit: 1 });
  ok(result.items[0].message.includes("da 23,45 € a 34,56 €"));
  ok(!JSON.stringify(result).includes("PRIVATE_FINANCE_DESCRIPTION"));
  await log("finance_entries", {
    id: randomUUID(),
    entry_type: "expense",
    amount_eur: 12.34,
    category: "Spesa sintetica",
  });
  ok((await feed({ area: "finance" })).items.some((item) => item.message.includes("-12,34 €")));
  // P4 forward adapter reads its audit keys; no dependency on P4 DDL or RPCs.
  const source = randomUUID();
  await log("finance_entries", { id: source, amount_eur: 10 });
  const op1 = randomUUID(),
    op2 = randomUUID();
  await log("finance_movement_revisions", {
    id: randomUUID(),
    operation_id: op1,
    source_kind: "manual",
    source_id: source,
    version: 1,
    previous_version: 0,
    action: "update",
    value_snapshot: {
      amount_cents: 2000,
      direction: "income",
      category: "Categoria prova",
      description: "PRIVATE_REVISION",
    },
    reason: "PRIVATE_REASON",
  });
  await log("finance_movement_revisions", {
    id: randomUUID(),
    operation_id: op2,
    source_kind: "manual",
    source_id: source,
    version: 2,
    previous_version: 1,
    action: "restore",
    value_snapshot: { amount_cents: 3000, direction: "expense", category: "Categoria prova" },
  });
  result = await feed({ area: "finance" });
  const revisions = result.items.filter((item) => item.message.includes("Categoria prova"));
  eq(revisions.length, 2, "Operazioni differenti sulla stessa radice non vengono unite");
  ok(revisions.some((item) => item.message.includes("da 20,00 € a -30,00 €")));
  ok(!JSON.stringify(result).includes("PRIVATE_REVISION"));
  ok(!JSON.stringify(result).includes("PRIVATE_REASON"));
  // A source action with >50 technical rows is fully grouped before any limit/cursor.
  const order = randomUUID(),
    operation = randomUUID(),
    lines = [];
  await log("sales_orders", { id: order, operation_id: operation, channel: "shopify_web" });
  for (let i = 0; i < 60; i++) {
    const line = randomUUID();
    lines.push(line);
    await log("sales_order_lines", { id: line, order_id: order, quantity: 1 });
  }
  result = await feed({ area: "sales", limit: 1 });
  eq(result.items.length, 1);
  ok(result.items[0].message.includes("60 unità"), "Quantità aggregata su tutte le righe");
  const orderItem = result.items[0].id;
  for (const line of lines) {
    const f = randomUUID();
    await log("fulfillment_lines", { id: f, order_line_id: line, quantity: 1 }, { at: newer });
    await log(
      "stock_movements",
      {
        id: randomUUID(),
        stock_item_id: randomUUID(),
        source: { sales_order_id: order, sales_order_line_id: line },
      },
      { at: newer },
    );
  }
  result = await feed({ area: "sales", limit: 1 });
  ok(result.items[0].message.includes("60 unità"));
  ok(result.items[0].message.includes("consegna"));
  ok(
    result.items[0].message.includes("Shopify online"),
    "Il canale della vendita accompagna la consegna",
  );
  eq(result.items[0].href, `/sales#order-${order}`);
  ok(result.next_cursor);
  eq(
    (await feed({ area: "sales", cursor: result.next_cursor, limit: 1 })).items[0].id,
    orderItem,
    "Il cursore non spezza un gruppo tecnico",
  );
  await log("sales_orders", { id: randomUUID(), channel: "shopify_pos" }, { at: newer });
  const quantityUnknown = (await feed({ area: "sales" })).items.find((item) =>
    item.message.includes("Shopify POS"),
  );
  ok(quantityUnknown);
  ok(!quantityUnknown.message.includes("0 unità"), "Quantità storica assente non inventata");
  ok(!quantityUnknown.message.includes("( ·"));
  // Exact microsecond boundaries and filters are applied to complete actions.
  for (const [index, at] of [
    "2026-10-23T10:00:00.000001Z",
    "2026-10-23T10:00:00.000002Z",
    "2026-10-23T10:00:00.000003Z",
  ].entries())
    await log(
      "notes",
      { id: randomUUID(), title: `Pagina sintetica ${index}` },
      { actor: null, at },
    );
  const first = await feed({ actor: "system", area: "team", limit: 2 });
  eq(first.items.length, 2);
  eq(first.next_cursor.occurred_at, "2026-10-23T10:00:00.000002Z");
  const second = await feed({ actor: "system", area: "team", cursor: first.next_cursor, limit: 2 });
  ok(second.items.some((item) => item.occurred_at === "2026-10-23T10:00:00.000001Z"));
  ok(second.items.every((item) => !first.items.some((other) => other.id === item.id)));
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
    { key: { id: partner } },
  );
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
    { key: { id: activity } },
  );
  result = await feed({ area: "partner" });
  eq(result.items.length, 1);
  ok(result.items[0].message.includes("invio Partner"));
  eq(result.items[0].href, "/partner?co=12#lead-12");
  ok(!JSON.stringify(result).includes("PRIVATE_PARTNER_BODY"));
  // P3 report + payment revision pairs collapse, preserving selected amount correction.
  const report = randomUUID(),
    payment = randomUUID(),
    revision = randomUUID();
  await log("consignment_reports", { id: report, location_id: randomUUID() });
  await log(
    "consignment_report_payments",
    {
      id: payment,
      report_id: report,
      amount_cents: 5000,
      finance_direction: "expense",
      finance_category: "Eventi",
    },
    { at: newer, operation: "UPDATE", old: { id: payment, report_id: report, amount_cents: 4000 } },
  );
  await log(
    "consignment_payment_revisions",
    {
      id: revision,
      payment_id: payment,
      version: 2,
      snapshot: { amount_cents: 5000, finance: { direction: "expense", category: "Eventi" } },
    },
    { at: newer },
  );
  result = await feed({ area: "finance" });
  const payments = result.items.filter((item) => item.message.includes("incasso"));
  eq(payments.length, 1);
  ok(payments[0].message.includes("da 40,00 € a -50,00 €"));
  ok(payments[0].message.includes("Eventi"));
  // Concurrent commits: one statement never reads half an uncommitted action.
  await writerA.query("begin");
  await writerB.query("begin");
  const concurrentAt = "2026-10-25T10:00:00.654321Z";
  const concurrentA = randomUUID(),
    concurrentB = randomUUID();
  await log(
    "tasks",
    { id: concurrentA, title: "Concorrente A" },
    { at: concurrentAt, client: writerA },
  );
  await log(
    "tasks",
    { id: concurrentB, title: "Concorrente B" },
    { at: concurrentAt, client: writerB },
  );
  await writerB.query("commit");
  result = await feed({ area: "team" });
  eq(
    result.items.filter((item) => item.message.includes("Concorrente")).length,
    1,
    "Il gruppo non confermato resta invisibile",
  );
  await writerA.query("commit");
  result = await feed({ area: "team" });
  eq(
    result.items.filter((item) => item.message.includes("Concorrente")).length,
    2,
    "Due azioni indipendenti simultanee restano distinte",
  );
  // P5 generated artifacts join only their link INSERT transaction, never all future edits.
  const linkedPartner = randomUUID(),
    generatedTask = randomUUID(),
    secondTask = randomUUID(),
    generatedAt = "2026-10-26T10:00:00.123456Z",
    projectAt = "2026-10-26T11:00:00.123456Z",
    calendarAt = "2026-10-26T12:00:00.123456Z",
    manualAt = "2026-10-26T13:00:00.123456Z",
    manualCalendarAt = "2026-10-26T14:00:00.123456Z";
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
  const nextCycleAt = "2026-10-26T10:30:00.123456Z",
    responseAt = "2026-10-26T10:45:00.123456Z";
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
  eq(related.length, 2, "Due task dello stesso Partner modificati insieme restano due azioni Team");
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
  const saleAt = "2026-10-26T15:00:00.123456Z",
    linkedOrder = randomUUID();
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
  const automationAt = "2026-10-26T16:00:00.123456Z",
    automaticTask = randomUUID();
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
