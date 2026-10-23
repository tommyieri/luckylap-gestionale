// test-db: postgres minimo 82
// PostgreSQL 17 reale, transazioni/lock/RLS reali; Auth e dati solo sintetici.
// P2 reale opzionale: terzo argomento = migrazione locale, sempre letta soltanto.
// Nessun DSN, account cloud, dato operativo o servizio persistente.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const [bin, modulePath, partnerMigration] = process.argv.slice(2);
if (
  !bin?.startsWith("/") ||
  !modulePath?.startsWith("/") ||
  (partnerMigration && !partnerMigration.startsWith("/"))
)
  throw Error("Servono percorsi assoluti per PostgreSQL 17, pg e l’eventuale migrazione P2.");
const imported = await import(pathToFileURL(modulePath).href),
  Client = imported.Client ?? imported.default.Client;
const command = (name, args) => {
  const result = spawnSync(join(bin, name), args, {
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.status !== 0) throw Error(`${name}: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
};
assert.match(command("postgres", ["--version"]), /PostgreSQL\) 17\./);
const directory = mkdtempSync("/private/tmp/luckylap-partner-work-concurrency-"),
  data = join(directory, "data"),
  socket = join(directory, "socket");
mkdirSync(socket, { mode: 0o700 });
const clients = [],
  roles = ["founder", "production", "logistics", "finance", "consultant", "outsider", "inactive"],
  users = Object.fromEntries(roles.map((role) => [role, randomUUID()]));
let started = false,
  checks = 0,
  co = 100;
let owner, a, b, observer;
const eq = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const ok = (value, label) => {
  assert.ok(value, label);
  checks++;
};
const scalar = async (client, sql, values = []) => (await client.query(sql, values)).rows[0].value;
async function connect() {
  const client = new Client({
    host: socket,
    port: 5432,
    user: "luckylap_partner_work_qa",
    database: "postgres",
    ssl: false,
    statement_timeout: 15000,
  });
  await client.connect();
  clients.push(client);
  return client;
}
async function begin(client, who = "founder", role = "authenticated") {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ role: role ?? "owner", sub: who === null ? null : users[who] }),
  ]);
  if (role) await client.query(`set local role ${role}`);
}
async function as(client, fn, who = "founder", role = "authenticated") {
  await begin(client, who, role);
  try {
    const result = await fn();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
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
async function rejected(promise, code, label) {
  const result = await capture(promise);
  eq(result.error?.code, code, label ?? "Comando rifiutato con codice atteso");
}
async function waitBlocked(waitingPid, blockingPid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const row = (
      await observer.query(
        "select wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1",
        [waitingPid],
      )
    ).rows[0];
    if (row?.wait_event_type === "Lock" && row.blockers.includes(blockingPid)) {
      checks++;
      return;
    }
    await new Promise((done) => setTimeout(done, 20));
  }
  throw Error(
    `Nessuna attesa PostgreSQL reale osservata: ${waitingPid} non bloccato da ${blockingPid}.`,
  );
}
const payload = (kind, fields) => ({ schema_version: 1, kind, ...fields });
async function work(client, operation, value) {
  return scalar(client, "select public.create_partner_work($1,$2) value", [operation, value]);
}
async function partner(dates = false) {
  const id = randomUUID();
  co++;
  await owner.query(
    "insert into public.partners(id,co,name,origin,stage,owner_id,created_by,sections,priority,contact_month,event_starts_on,application_deadline)values($1,$2,'Partner concorrenza sintetico','team','da_contattare',$3,$3,array['eventi'],'media',date_trunc('month',current_date)::date,case when $4 then (current_date+interval'2 years')::date end,case when $4 then (current_date+interval'2 years')::date end)",
    [id, co, users.founder, dates],
  );
  return id;
}
async function link(partnerId) {
  return (
    await owner.query(
      "select * from public.partner_work_links where partner_id=$1 and kind='event'",
      [partnerId],
    )
  ).rows[0];
}
async function activity(client, partnerId, kind, at) {
  const id = randomUUID();
  await client.query(
    "insert into public.partner_activities(id,operation_id,partner_id,partner_name,partner_co,origin,kind,message_kind,occurred_at,created_by)select $1,$2,id,name,co,'team',$4,case when $4='inviato'then'primo'end,$5,$6 from public.partners where id=$3",
    [id, randomUUID(), partnerId, kind, at, users.founder],
  );
  return id;
}
async function reminderState(partnerId) {
  return (
    await owner.query(
      "select count(*)::int total,count(*)filter(where t.status<>'done')::int open,array_agg(l.activity_id)filter(where t.status<>'done') active from public.partner_work_links l join public.tasks t on t.id=l.task_id where l.partner_id=$1 and l.kind='follow_up'",
      [partnerId],
    )
  ).rows[0];
}
try {
  command("initdb", [
    "-D",
    data,
    "-U",
    "luckylap_partner_work_qa",
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
  a = await connect();
  b = await connect();
  observer = await connect();
  const pids = {
    a: await scalar(a, "select pg_backend_pid() value"),
    b: await scalar(b, "select pg_backend_pid() value"),
  };
  assert.notEqual(pids.a, pids.b);
  await owner.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid()returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;
    create schema storage;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const file of [
    "20261021114636_initial_schema.sql",
    "20261021121044_sales_ecosystem.sql",
    "20261021130138_brand_assets_and_development.sql",
  ])
    await owner.query(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  const localPartner = new URL("../migrations/20261022215908_partner_module.sql", import.meta.url),
    dependency =
      partnerMigration ??
      (existsSync(localPartner)
        ? localPartner
        : new URL("fixtures/work-links/partner-contract.sql", import.meta.url));
  await owner.query(readFileSync(dependency, "utf8"));
  const migrations = new URL("../migrations/", import.meta.url),
    files = readdirSync(migrations)
      .filter((name) => name.endsWith("_partner_work_links.sql"))
      .sort();
  assert.equal(files.length, 1, "Una sola migrazione P5 attesa");
  const migration = readFileSync(new URL(files[0], migrations), "utf8"),
    digest = createHash("sha256").update(migration).digest("hex");
  await owner.query(migration);
  for (const role of roles) {
    await owner.query("insert into auth.users values($1)", [users[role]]);
    await owner.query("insert into public.profiles(user_id,display_name)values($1,$2)", [
      users[role],
      `Persona sintetica ${role}`,
    ]);
    if (role !== "outsider")
      await owner.query("insert into public.memberships(user_id,role,active)values($1,$2,$3)", [
        users[role],
        role === "inactive" ? "founder" : role,
        role !== "inactive",
      ]);
  }
  // Existing active-member predicate and real table privileges/policies are exercised.
  for (const who of roles.slice(0, 5)) {
    const id = await partner(),
      result = await as(
        a,
        () => work(a, randomUUID(), payload("project", { partner_id: id })),
        who,
      );
    ok(result.target_id, `${who}: comando umano consentito`);
    eq(
      await as(
        a,
        () =>
          scalar(
            a,
            "select count(*)::int value from public.partner_work_links where partner_id=$1",
            [id],
          ),
        who,
      ),
      1,
      `${who}: RLS lettura membro`,
    );
  }
  const deniedPartner = await partner();
  for (const who of ["outsider", "inactive"])
    await rejected(
      as(a, () => work(a, randomUUID(), payload("project", { partner_id: deniedPartner })), who),
      "42501",
    );
  for (const role of ["anon", "service_role"])
    await rejected(
      as(
        a,
        () => work(a, randomUUID(), payload("project", { partner_id: deniedPartner })),
        "founder",
        role,
      ),
      "42501",
    );
  await rejected(
    as(a, () => work(a, randomUUID(), payload("project", { partner_id: deniedPartner })), null),
    "42501",
  );
  eq(
    await as(
      a,
      () => scalar(a, "select count(*)::int value from public.partner_work_links"),
      "outsider",
    ),
    0,
  );
  await rejected(
    as(a, () => a.query("update public.partner_work_links set detached=true")),
    "42501",
  );
  await rejected(
    as(a, () => a.query("select * from private.partner_work_receipts")),
    "42501",
  );
  await rejected(
    as(a, () =>
      a.query("select private.sync_partner_work_dates($1,$2)", [deniedPartner, users.founder]),
    ),
    "42501",
  );

  // Manual calendar edit wins while automatic date sync genuinely waits on its row.
  const calendarPartner = await partner(true),
    initial = await link(calendarPartner);
  await begin(a, "consultant");
  await a.query("update public.calendar_events set title='Titolo manuale uno'where id=$1", [
    initial.calendar_event_id,
  ]);
  await begin(b, "founder", null);
  const sync = capture(
    b.query("update public.partners set event_ends_on=event_starts_on+1 where id=$1", [
      calendarPartner,
    ]),
  );
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  await success(sync);
  await b.query("commit");
  eq(
    await scalar(owner, "select title value from public.calendar_events where id=$1", [
      initial.calendar_event_id,
    ]),
    "Titolo manuale uno",
  );
  let current = await link(calendarPartner);
  eq(current.needs_review, true);
  ok(BigInt(current.version) > BigInt(initial.version));
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_work_links where partner_id=$1 and kind in('event','deadline')",
      [calendarPartner],
    ),
    2,
  );

  // A page's CAS version cannot absorb a human edit committed while resolve waits.
  const staleVersion = current.version,
    staleOp = randomUUID();
  await begin(a, "logistics");
  await a.query("update public.calendar_events set title='Titolo manuale due'where id=$1", [
    current.calendar_event_id,
  ]);
  await begin(b, "finance");
  const stale = capture(
    work(
      b,
      staleOp,
      payload("resolve", {
        link_id: current.id,
        expected_version: Number(staleVersion),
        keep_manual: false,
      }),
    ),
  );
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq((await stale).error?.code, "40001", "Resolve obsoleto respinto dopo il vero lock calendar");
  await b.query("rollback");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.partner_work_receipts where operation_id=$1",
      [staleOp],
    ),
    0,
  );
  eq(
    await scalar(owner, "select title value from public.calendar_events where id=$1", [
      current.calendar_event_id,
    ]),
    "Titolo manuale due",
  );

  // Reverse ordering: the authorized restore commits, then a waiting human edit remains visible.
  current = await link(calendarPartner);
  await begin(a, "founder");
  await work(
    a,
    randomUUID(),
    payload("resolve", {
      link_id: current.id,
      expected_version: Number(current.version),
      keep_manual: false,
    }),
  );
  await begin(b, "production");
  const manualAfter = capture(
    b.query("update public.calendar_events set title='Titolo manuale dopo resolve'where id=$1", [
      current.calendar_event_id,
    ]),
  );
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  await success(manualAfter);
  await b.query("commit");
  eq(
    await scalar(owner, "select title value from public.calendar_events where id=$1", [
      current.calendar_event_id,
    ]),
    "Titolo manuale dopo resolve",
  );
  current = await link(calendarPartner);
  eq(current.needs_review, true);
  eq(current.detached, false);

  // Delete invalidates the same CAS token too, without resurrecting an event implicitly.
  await begin(a, "consultant");
  await a.query("delete from public.calendar_events where id=$1", [current.calendar_event_id]);
  await begin(b, "founder");
  const deletedResolve = capture(
    work(
      b,
      randomUUID(),
      payload("resolve", {
        link_id: current.id,
        expected_version: Number(current.version),
        keep_manual: false,
      }),
    ),
  );
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq((await deletedResolve).error?.code, "40001");
  await b.query("rollback");
  current = await link(calendarPartner);
  eq(current.calendar_event_id, null);
  eq(current.needs_review, true);

  // Insert-trigger automation is driven by synthetic source rows as the database owner.
  // P2's separate command layer remains read-only and is not impersonated as a client grant.
  const t0 = "2026-01-10T10:00:00.000001Z",
    t1 = "2026-01-10T11:00:00.000002Z",
    t2 = "2026-01-10T12:00:00.000003Z";
  const cycles = await partner();
  await begin(a, "founder", null);
  await activity(a, cycles, "inviato", t0);
  await begin(b, "founder", null);
  let latestActivity;
  const secondSent = capture(
    activity(b, cycles, "inviato", t1).then((id) => {
      latestActivity = id;
    }),
  );
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  await success(secondSent);
  await b.query("commit");
  let reminders = await reminderState(cycles);
  eq(reminders.total, 2);
  eq(reminders.open, 1);
  eq(reminders.active, [latestActivity]);
  const reverse = await partner();
  await begin(a, "founder", null);
  const newerSent = await activity(a, reverse, "inviato", t1);
  await begin(b, "founder", null);
  const olderSent = capture(activity(b, reverse, "inviato", t0));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  await success(olderSent);
  await b.query("commit");
  reminders = await reminderState(reverse);
  eq(reminders.total, 1);
  eq(reminders.active, [newerSent]);
  const responseFirst = await partner();
  await begin(a, "founder", null);
  await activity(a, responseFirst, "risposta", t1);
  await begin(b, "founder", null);
  const lateSent = capture(activity(b, responseFirst, "inviato", t0));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  await success(lateSent);
  await b.query("commit");
  reminders = await reminderState(responseFirst);
  eq(reminders.open, 0);
  eq(reminders.total, 0);
  const oldResponse = await partner();
  await begin(a, "founder", null);
  const newCycle = await activity(a, oldResponse, "inviato", t1);
  await begin(b, "founder", null);
  const response = capture(activity(b, oldResponse, "risposta", t0));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  await success(response);
  await b.query("commit");
  reminders = await reminderState(oldResponse);
  eq(reminders.open, 1);
  eq(reminders.active, [newCycle]);
  await activity(owner, cycles, "risposta", t2);
  eq((await reminderState(cycles)).open, 0);
  eq((await reminderState(oldResponse)).open, 1);

  // Two explicit commands serialize on the Partner parent and return one production project.
  const projectPartner = await partner(),
    projectA = randomUUID(),
    projectB = randomUUID(),
    projectPayload = payload("project", { partner_id: projectPartner });
  await begin(a, "founder");
  const firstProject = await work(a, projectA, projectPayload);
  await begin(b, "consultant");
  const otherProject = capture(work(b, projectB, projectPayload));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  const secondProject = await success(otherProject);
  await b.query("commit");
  eq(firstProject.target_id, secondProject.target_id);
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_work_links where partner_id=$1 and kind='project'",
      [projectPartner],
    ),
    1,
  );
  eq(
    await scalar(
      owner,
      "select owner_id value from public.product_development_projects where id=$1",
      [firstProject.target_id],
    ),
    users.production,
  );
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.partner_work_receipts where operation_id=any($1::uuid[])",
      [[projectA, projectB]],
    ),
    2,
  );

  const replayPartner = await partner(),
    replayOperation = randomUUID(),
    replayPayload = payload("project", { partner_id: replayPartner });
  await begin(a, "production");
  const original = await work(a, replayOperation, replayPayload);
  await begin(b, "production");
  const retry = capture(work(b, replayOperation, replayPayload));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  const replayed = await success(retry);
  await b.query("commit");
  eq(replayed.replayed, true);
  eq(replayed.target_id, original.target_id);
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.partner_work_receipts where operation_id=$1",
      [replayOperation],
    ),
    1,
  );

  const boundPartner = await partner(),
    boundOperation = randomUUID(),
    boundPayload = payload("project", { partner_id: boundPartner });
  await begin(a, "finance");
  await work(a, boundOperation, boundPayload);
  await begin(b, "logistics");
  const wrongActor = capture(work(b, boundOperation, boundPayload));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq((await wrongActor).error?.code, "23505");
  await b.query("rollback");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.partner_work_receipts where operation_id=$1",
      [boundOperation],
    ),
    1,
  );
  const changedPartner = await partner(),
    changedOperation = randomUUID();
  await begin(a, "founder");
  await work(a, changedOperation, payload("project", { partner_id: changedPartner }));
  await begin(b, "founder");
  const wrongPayload = capture(
    work(b, changedOperation, payload("shop_review", { partner_id: changedPartner })),
  );
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq((await wrongPayload).error?.code, "23505");
  await b.query("rollback");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_work_links where partner_id=$1 and kind='shop_review'",
      [changedPartner],
    ),
    0,
  );
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.partner_work_receipts where operation_id=$1",
      [changedOperation],
    ),
    1,
  );
  // A sale association is metadata only and cannot make later Partner cancellation fail.
  const salePartner = await partner(true),
    saleLink = await link(salePartner),
    orderId = randomUUID();
  await owner.query(
    "insert into public.sales_orders(id,operation_id,payload_sha256,channel,occurred_at,operational_date,total_cents,payment_state,fulfillment_mode,fulfillment_state,created_by)values($1,$2,repeat('0',64),'direct',now(),(now()at time zone'Europe/Rome')::date,0,'unpaid','prepare','unfulfilled',$3)",
    [orderId, randomUUID(), users.founder],
  );
  const sourceOrder = await scalar(
    owner,
    "select to_jsonb(o) value from public.sales_orders o where id=$1",
    [orderId],
  );
  const association = payload("link_sale", {
    partner_id: salePartner,
    event_id: saleLink.calendar_event_id,
    order_id: orderId,
  });
  const linked = await as(a, () => work(a, randomUUID(), association), "consultant");
  eq(linked.target_id, saleLink.calendar_event_id);
  await as(a, () => work(a, randomUUID(), association), "logistics");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_event_sales where order_id=$1",
      [orderId],
    ),
    1,
  );
  await owner.query(
    "update public.partners set event_starts_on=null,event_ends_on=null where id=$1",
    [salePartner],
  );
  eq(
    await scalar(owner, "select count(*)::int value from public.calendar_events where id=$1", [
      saleLink.calendar_event_id,
    ]),
    1,
    "La sincronizzazione conserva l’evento con vendite storiche",
  );
  const reviewSaleLink = await link(salePartner),
    blockedAlignment = randomUUID();
  eq(reviewSaleLink.needs_review, true);
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_event_sales where order_id=$1",
      [orderId],
    ),
    1,
  );
  await rejected(
    as(a, () =>
      work(
        a,
        blockedAlignment,
        payload("resolve", {
          link_id: saleLink.id,
          expected_version: Number(reviewSaleLink.version),
          keep_manual: false,
        }),
      ),
    ),
    "22023",
    "Non si forza l’eliminazione automatica di un evento con vendite",
  );
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.partner_work_receipts where operation_id=$1",
      [blockedAlignment],
    ),
    0,
  );
  // An intentional human delete waits for an in-flight association, then cascades only its metadata.
  await begin(a, "consultant");
  await work(a, randomUUID(), association);
  await begin(b, "logistics");
  const deleteAssociated = capture(
    b.query("delete from public.calendar_events where id=$1", [saleLink.calendar_event_id]),
  );
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  await success(deleteAssociated);
  await b.query("commit");
  eq(
    await scalar(owner, "select count(*)::int value from public.calendar_events where id=$1", [
      saleLink.calendar_event_id,
    ]),
    0,
  );
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_event_sales where order_id=$1",
      [orderId],
    ),
    0,
  );
  eq((await link(salePartner)).calendar_event_id, null);
  eq(
    await scalar(owner, "select to_jsonb(o) value from public.sales_orders o where id=$1", [
      orderId,
    ]),
    sourceOrder,
    "Il collegamento e il suo annullamento non cambiano la vendita",
  );
  eq(await scalar(owner, "select count(*)::int value from public.stock_movements"), 0);
  eq(await scalar(owner, "select count(*)::int value from public.order_payments"), 0);
  eq(await scalar(owner, "select count(*)::int value from public.finance_entries"), 0);
  console.log(
    `PASS ${checks} Partner work concurrent checks; PostgreSQL 17 reale, pids ${pids.a}/${pids.b}, RLS reale, ${partnerMigration || existsSync(localPartner) ? "P2 reale" : "contratto P2 isolato"}, Auth/dati sintetici. P5 SHA256 ${digest}`,
  );
} finally {
  // A failed contention assertion must not leave a live transaction blocking cleanup.
  for (const client of clients)
    try {
      await client.query("rollback");
    } catch {}
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
