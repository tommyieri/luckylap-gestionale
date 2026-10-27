// test-db: postgres minimo 32
// Assistente Partner, compito 2: due giri sovrapposti del worker su PostgreSQL 17 reale (lock,
// transazioni e permessi veri). Il secondo giro trova il lavoro occupato e non fa niente; mai due
// lease attive; una lease scaduta conta un solo tentativo anche con due giri insieme. Cluster usa e
// getta in /private/tmp su socket privata, Auth e dati solo sintetici, nessun DSN o accesso cloud.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const [bin, modulePath] = process.argv.slice(2);
if (!bin?.startsWith("/") || !modulePath?.startsWith("/"))
  throw Error("Servono percorsi assoluti per PostgreSQL 17 e pg.");
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
const directory = mkdtempSync("/private/tmp/luckylap-partner-assistant-concurrency-"),
  data = join(directory, "data"),
  socket = join(directory, "socket");
mkdirSync(socket, { mode: 0o700 });
const clients = [];
let started = false,
  checks = 0;
let owner, a, b, observer;
const eq = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label ?? "Valori diversi");
  checks++;
};
const scalar = async (client, sql, values = []) => (await client.query(sql, values)).rows[0].value;
async function connect() {
  const client = new Client({
    host: socket,
    port: 5432,
    user: "postgres",
    database: "postgres",
    ssl: false,
    statement_timeout: 15000,
  });
  await client.connect();
  clients.push(client);
  return client;
}
// Il JWT del worker, come PostgREST: claims locali e set local role service_role.
async function beginService(client) {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await client.query("set local role service_role");
}
async function asService(client, fn) {
  await beginService(client);
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
async function waitBlocked(waitingPid, blockingPid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const row = (
      await observer.query(
        "select wait_event_type, pg_blocking_pids(pid) blockers from pg_stat_activity where pid = $1",
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
const WORKERS = { a: randomUUID(), b: randomUUID() };
const claimSql = "select public.claim_partner_assistant_step($1, 360) value";
const claim = (client, worker) => scalar(client, claimSql, [worker]);
const activeLeases = () =>
  scalar(
    owner,
    "select count(*)::int value from public.partner_assistant_jobs where lease_expires_at > clock_timestamp()",
  );
const releaseAll = async () => {
  const leased = (
    await owner.query(
      "select id, lease_token from public.partner_assistant_jobs where lease_token is not null",
    )
  ).rows;
  for (const row of leased)
    await asService(a, () =>
      scalar(
        a,
        "select public.fail_partner_assistant_step($1, $2, 'rilascia', 'non_idoneo') value",
        [row.id, row.lease_token],
      ),
    );
};

try {
  command("initdb", [
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
  // auth.uid() come in produzione: request.jwt.claim.sub, poi request.jwt.claims->>'sub'.
  await owner.query(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create schema storage; create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb, unique(bucket_id, name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated; grant select, insert, update, delete on storage.objects to authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  const migrations = new URL("../migrations/", import.meta.url),
    names = readdirSync(migrations);
  for (const suffix of [
    "_initial_schema.sql",
    "_sales_ecosystem.sql",
    "_brand_assets_and_development.sql",
    "_partner_module.sql",
    "_partner_work_links.sql",
    "_partner_dates_only_agreed.sql",
    "_partner_oggi_fixes.sql",
    "_assistente_partner.sql",
    "_assistente_partner_worker.sql",
  ]) {
    const found = names.filter((name) => name.endsWith(suffix));
    assert.equal(found.length, 1, `Una sola migrazione ${suffix}`);
    await owner.query(readFileSync(new URL(found[0], migrations), "utf8"));
  }
  const founder = randomUUID(),
    assistant = randomUUID();
  for (const [user, name] of [
    [founder, "Fondatore sintetico"],
    [assistant, "Assistente"],
  ]) {
    await owner.query("insert into auth.users values ($1)", [user]);
    await owner.query("insert into public.profiles(user_id, display_name) values ($1, $2)", [
      user,
      name,
    ]);
  }
  await owner.query("insert into public.memberships(user_id, role) values ($1, 'founder')", [
    founder,
  ]);
  for (let co = 951; co <= 953; co++) {
    const id = randomUUID();
    await owner.query(
      `insert into public.partners(id, co, name, origin, stage, created_by, sections, priority, contact_month)
       values ($1, $2, $3, 'team', 'da_contattare', $4, array['collab'], 'alta', date '2026-11-01')`,
      [id, co, `Club sintetico ${co}`, founder],
    );
    await owner.query(
      `insert into public.partner_contacts(partner_id, kind, value, link_value, created_by, updated_by)
       values ($1, 'email', $2, $2, $3, $3)`,
      [id, `club${co}@example.test`, founder],
    );
  }
  eq(
    await asService(a, () =>
      scalar(a, "select public.configure_partner_assistant($1, $2) value", [assistant, founder]),
    ),
    { configured: true },
  );
  await owner.query("update private.partner_assistant_config set mode = 'prepara'");

  // 1. Il primo giro tiene la configurazione: il secondo aspetta davvero, poi trova il lavoro occupato.
  await beginService(a);
  const first = await claim(a, WORKERS.a);
  eq(first.status, "claimed");
  await beginService(b);
  const second = capture(claim(b, WORKERS.b));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq(await success(second), { status: "idle", reason: "occupato" });
  await b.query("commit");
  eq(await activeLeases(), 1, "Mai due lease attive");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_assistant_jobs where lease_token is not null",
    ),
    1,
  );
  eq(
    await scalar(
      owner,
      "select lease_token::text value from public.partner_assistant_jobs where id = $1",
      [first.job.job_id],
    ),
    first.job.lease_token,
    "La lease è quella del primo giro",
  );
  eq(
    await scalar(owner, "select count(*)::int value from public.partner_assistant_jobs"),
    3,
    "I lavori nascono una volta sola",
  );

  // 2. Due giri lanciati insieme, più volte: uno solo prende un lavoro.
  for (let round = 0; round < 5; round++) {
    await releaseAll();
    const results = await Promise.all([
      asService(a, () => claim(a, WORKERS.a)),
      asService(b, () => claim(b, WORKERS.b)),
    ]);
    eq(
      results.map((r) => (r.status === "claimed" ? "claimed" : r.reason)).sort(),
      ["claimed", "occupato"],
      `Giro ${round + 1}: un solo lavoro preso`,
    );
    eq(await activeLeases(), 1, `Giro ${round + 1}: una sola lease attiva`);
  }

  // 3. Lease scaduta e due giri insieme: un solo tentativo consumato.
  const expired = await scalar(
    owner,
    `update public.partner_assistant_jobs set lease_expires_at = now() - interval '1 second'
      where lease_token is not null returning partner_id value`,
  );
  const results = await Promise.all([
    asService(a, () => claim(a, WORKERS.a)),
    asService(b, () => claim(b, WORKERS.b)),
  ]);
  eq(results.map((r) => (r.status === "claimed" ? "claimed" : r.reason)).sort(), [
    "claimed",
    "occupato",
  ]);
  eq(
    await scalar(
      owner,
      "select attempts value from public.partner_assistant_jobs where partner_id = $1",
      [expired],
    ),
    1,
    "Lease scaduta: un solo tentativo anche con due giri",
  );
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.partner_assistant_events where outcome = 'lease_scaduta'",
    ),
    1,
  );
  eq(await activeLeases(), 1);

  // 4. Un giro mentre la conclusione del passo non è ancora confermata: il giro non aspetta e trova
  // il lavoro occupato; dopo la conferma prende il passo successivo dello stesso lavoro.
  const completeResearch = (client, job) =>
    scalar(client, "select public.complete_partner_assistant_research($1, $2::jsonb) value", [
      randomUUID(),
      JSON.stringify({
        schema_version: 1,
        job_id: job.job_id,
        lease_token: job.lease_token,
        text: "Ricerca sintetica.",
        sources: ["https://club.example.test/notizie"],
        model: "claude-opus-5-5",
        rules_version: 1,
      }),
    ]);
  const leased = results.find((r) => r.status === "claimed").job;
  await beginService(a);
  const done = await completeResearch(a, leased);
  eq(done.status, "done");
  eq(await asService(b, () => claim(b, WORKERS.b)), { status: "idle", reason: "occupato" });
  await a.query("commit");
  const next = await asService(b, () => claim(b, WORKERS.b));
  eq(
    [next.status, next.job.job_id, next.job.step, next.job.attempts],
    ["claimed", leased.job_id, "estrazione", 0],
    "Dopo la conferma: il passo successivo, tentativi azzerati",
  );
  eq(await activeLeases(), 1);
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_assistant_notes where kind = 'ricerca'",
    ),
    1,
    "Una sola nota di ricerca",
  );

  // 5. La guardia dei complete_* blocca il lavoro prima di guardare la lease: con una pausa non
  // ancora confermata, che rilascia ogni lease, la conclusione di un passo aspetta davvero, poi trova
  // la lease persa e non salva niente.
  await releaseAll();
  const target = (
    await owner.query(
      `update public.partner_assistant_jobs set lease_token = gen_random_uuid(),
         lease_expires_at = now() + interval '5 minutes'
       where id = (select id from public.partner_assistant_jobs where step = 'ricerca' order by id limit 1)
       returning id::text as job_id, lease_token::text as lease_token`,
    )
  ).rows[0];
  await beginService(a);
  eq(await scalar(a, "select public.pause_partner_assistant('credito') value"), {
    status: "done",
    paused_reason: "credito",
  });
  await beginService(b);
  const late = capture(completeResearch(b, target));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq(await success(late), { status: "lease_persa" }, "Dopo la pausa la lease non c'è più");
  await b.query("commit");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_assistant_notes where kind = 'ricerca'",
    ),
    1,
    "Nessuna nota di ricerca nuova",
  );
  eq(
    (
      await owner.query(
        "select step, lease_token from public.partner_assistant_jobs where id = $1",
        [target.job_id],
      )
    ).rows[0],
    { step: "ricerca", lease_token: null },
    "Il passo non avanza",
  );
  console.log(
    `PASS ${checks} Assistente Partner concurrent checks; PostgreSQL 17 reale, pids ${pids.a}/${pids.b}, Auth/dati sintetici.`,
  );
} finally {
  // Un controllo fallito non deve lasciare transazioni aperte che bloccano la pulizia.
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
