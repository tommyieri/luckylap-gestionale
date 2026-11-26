// test-db: postgres minimo 80
// Real PostgreSQL 17, production migrations and synthetic-only receipt cues.
// Auth is a stand-in; no Shopify, cloud database, HTTP or real business data.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const [binaryDirectory, pgModule] = process.argv.slice(2);
if (!binaryDirectory?.startsWith("/") || !pgModule?.startsWith("/"))
  throw new Error("Pass absolute PostgreSQL 17 bin and pg/lib/index.js paths; no DSN.");
const imported = await import(pathToFileURL(pgModule).href);
const Client = imported.Client ?? imported.default.Client;
const run = (program, args) => {
  const result = spawnSync(join(binaryDirectory, program), args, {
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.status !== 0) throw new Error(`${program}: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
};
assert.match(run("postgres", ["--version"]), /PostgreSQL\) 17\./);
const temporary = mkdtempSync("/private/tmp/luckylap-cutover-claim-");
const data = join(temporary, "data");
const socket = join(temporary, "socket");
mkdirSync(socket, { mode: 0o700 });
const port = await new Promise((done, fail) => {
  const server = createServer();
  server.once("error", fail);
  server.listen(0, "127.0.0.1", () => {
    const assigned = server.address().port;
    server.close(() => done(assigned));
  });
});
const shop = "synthetic-cutover.myshopify.com";
const otherShop = "synthetic-other.myshopify.com";
const cutover = "2030-02-01T12:00:00.123456Z";
const historical = "2030-01-01T00:00:00Z";
const current = "2030-03-01T00:00:00Z";
const clients = [];
let started = false;
let checks = 0;
let sequence = 0;
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
    application_name: `luckylap-cutover-${label}`,
    statement_timeout: 6000,
    query_timeout: 9000,
  });
  client.on("error", () => {});
  await client.connect();
  clients.push(client);
  return client;
}
async function begin(client, role = "service_role") {
  await client.query("begin");
  if (role !== "postgres") await client.query(`set local role ${role}`);
}
async function as(client, sql, args = [], role = "service_role") {
  await begin(client, role);
  try {
    const result = await client.query(sql, args);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
const claimSql = "select public.claim_shopify_order_jobs($1,$2,$3) value";
const claim = async (client, limit = 1) =>
  (await as(client, claimSql, [randomUUID(), limit, 120])).rows[0].value;
async function waitBlocked(observer, waitingPid, blockingPid) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const row = (
      await observer.query(
        "select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1",
        [waitingPid],
      )
    ).rows[0];
    if (row?.wait_event_type === "Lock" && row.blockers.includes(blockingPid)) {
      checks++;
      return;
    }
    await new Promise((done) => setTimeout(done, 15));
  }
  throw new Error("Expected overlap between the two PostgreSQL transactions was not observed.");
}

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
    join(temporary, "postgres.log"),
    "-o",
    `-p ${port} -k ${socket} -c listen_addresses='' -c unix_socket_permissions=0700 -c max_connections=8`,
    "-w",
    "start",
  ]);
  started = true;
  const owner = await connect("observer");
  const a = await connect("a");
  const b = await connect("b");
  const aPid = await scalar(a, "select pg_backend_pid() value");
  const bPid = await scalar(b, "select pg_backend_pid() value");
  equal(aPid !== bPid, true, "Independent real PostgreSQL sessions");
  await owner.query(`
    create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role;
    create schema extensions;create extension pgcrypto schema extensions;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
  `);
  const directory = new URL("../migrations/", import.meta.url);
  for (const suffix of [
    "initial_schema",
    "finance_imports",
    "sales_ecosystem",
    "sales_lifecycle",
    "shopify_catalog",
    "shopify_receiver",
    "area_passwords",
    "shopify_sales_core",
    "shopify_canonical_worker",
    "shopify_pre_cutover_claim",
  ]) {
    const files = readdirSync(directory).filter((name) => name.endsWith(`_${suffix}.sql`));
    assert.equal(files.length, 1, suffix);
    await owner.query(readFileSync(new URL(files[0], directory), "utf8"));
  }
  // A fixture for an identity imported before a later cutover change. It takes
  // the exact application order lock, but is not a replacement for apply tests.
  await owner.query(`
    create function private.synthetic_seed_identity(p_shop text,p_gid text) returns uuid
    language plpgsql security definer set search_path='' as $$declare sale uuid;begin
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.shopify.'||p_shop||'.'||p_gid,0));
      insert into public.sales_orders(operation_id,payload_sha256,channel,occurred_at,operational_date,total_cents,payment_state,fulfillment_mode,fulfillment_state,created_by,source_kind)
        values(gen_random_uuid(),repeat('a',64),'shopify_web','2030-01-01T00:00:00Z','2030-01-01',0,'unpaid','prepare','unfulfilled',null,'shopify_canonical') returning id into sale;
      insert into private.shopify_order_identities(shop_domain,order_gid,order_id,baseline_sha256,source_updated_at,source_updated_key,canonical_digest,canonical)
        values(p_shop,p_gid,sale,repeat('b',64),'2030-01-01T00:00:00Z','2030-01-01T00:00:00.000000000Z',repeat('c',64),'{}');
      return sale;
    end$$;
    revoke all on function private.synthetic_seed_identity(text,text) from public;
    grant execute on function private.synthetic_seed_identity(text,text) to service_role;
    insert into private.shopify_sync_configuration(shop_domain,enabled) values('${shop}',true),('${otherShop}',true);
  `);
  const reset = async () => {
    await owner.query(
      "truncate private.shopify_webhook_inbox cascade;truncate public.sales_orders cascade",
    );
    await owner.query("update private.shopify_sync_configuration set enabled=true");
    await owner.query(
      "update public.app_settings set manual_sales_enabled=false,sales_started_at=$1",
      [cutover],
    );
  };
  const seed = async (created = historical, options = {}) => {
    const domain = options.shop ?? shop;
    const orderGid = options.gid ?? `gid://shopify/Order/${++sequence}`;
    const webhookId = randomUUID();
    const cue = {
      shopDomain: domain,
      webhookId,
      eventId: null,
      deliveryKey: `${domain}:${webhookId}`,
      apiVersion: "2026-10",
      topic: "orders/updated",
      orderGid,
      sourceName: "web",
      channel: "shopify_web",
      currency: "EUR",
      sourceCreatedAt: created,
      sourceUpdatedAt: "2031-01-01T00:00:00Z",
      bodySha256: "d".repeat(64),
      requiresCanonicalRead: true,
    };
    let jobId;
    if (options.corruptCue) {
      // Emulate a malformed legacy/corrupted cue without weakening the real receiver.
      if (options.missingCreated) delete cue.sourceCreatedAt;
      const inboxId = await scalar(
        owner,
        "insert into private.shopify_webhook_inbox(shop_domain,webhook_id,order_gid,topic,api_version,payload_sha256,metadata_sha256,cue) values($1,$2,$3,'orders/updated','2026-10',$4,$4,$5) returning id value",
        [domain, webhookId, orderGid, "d".repeat(64), cue],
      );
      jobId = await scalar(
        owner,
        "insert into private.shopify_order_read_jobs(inbox_id) values($1) returning id value",
        [inboxId],
      );
    } else {
      const response = (
        await as(owner, "select public.receive_shopify_order_notification($1) value", [cue])
      ).rows[0].value;
      jobId = response.job_id;
    }
    if (options.state) {
      await owner.query(
        "update private.shopify_job_leases set state=$2,attempts=3,reason='access_denied',worker_id=$3,lease_token=$4,lease_expires_at=$5 where job_id=$1",
        [
          jobId,
          options.state,
          randomUUID(),
          randomUUID(),
          options.expired ? "2000-01-01T00:00:00Z" : "2100-01-01T00:00:00Z",
        ],
      );
    }
    return { jobId, orderGid, cue };
  };
  const lease = async (job) =>
    (await owner.query("select * from private.shopify_job_leases where job_id=$1", [job.jobId]))
      .rows[0];
  const snapshot = async () => {
    const result = {};
    for (const table of [
      "public.sales_orders",
      "public.sales_order_lines",
      "public.order_payments",
      "public.finance_entries",
      "public.stock_movements",
      "public.stock_balances",
      "public.stock_reservations",
      "public.stock_reservation_events",
      "public.commercial_facts",
      "public.shopify_order_financials",
      "public.shopify_refund_observations",
      "public.shopify_transaction_observations",
      "private.shopify_order_identities",
      "private.shopify_line_identities",
      "private.shopify_effect_receipts",
    ])
      result[table] = await scalar(
        owner,
        `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') value from ${table} t`,
      );
    return result;
  };

  await reset();
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(
      as(a, claimSql, [randomUUID(), 1, 120], role),
      (error) => error.code === "42501",
    );
    checks++;
  }
  await assert.rejects(
    as(a, "select private.shopify_cue_is_before_cutover($1,$2)", [
      JSON.stringify(historical),
      cutover,
    ]),
    (error) => error.code === "42501",
  );
  checks++;
  const old = [];
  for (const state of ["pending", "retry", "review"]) old.push(await seed(historical, { state }));
  const fresh = await seed(current);
  const before = await snapshot();
  const receiptsBefore = await owner.query(
    "select id,cue,payload_sha256,metadata_sha256 from private.shopify_webhook_inbox order by id",
  );
  const claimed = await claim(a);
  equal(
    claimed.map((row) => row.job_id),
    [fresh.jobId],
    "Current order is claimed after historical cleanup",
  );
  for (const job of old) {
    const row = await lease(job);
    equal(row.state, "ignored", "Eligible pending/retry/review becomes ignored");
    equal(
      row.result,
      { status: "ignored", reason: "before_sales_cutover", job_id: job.jobId },
      "Technical ignored receipt only",
    );
    equal(
      [row.worker_id, row.lease_token, row.lease_expires_at, row.canonical_digest],
      [null, null, null, null],
      "No stale lease authority survives cleanup",
    );
    equal(row.attempts, 3, "Cleanup does not fabricate a canonical read attempt");
  }
  equal(await snapshot(), before, "No Sales, Finance, stock, identity or effect changes");
  equal(
    (
      await owner.query(
        "select id,cue,payload_sha256,metadata_sha256 from private.shopify_webhook_inbox order by id",
      )
    ).rows,
    receiptsBefore.rows,
    "Signed source cues remain immutable",
  );
  equal(await claim(a), [], "Ignored jobs and a live lease are not reclaimed");

  await reset();
  for (let index = 0; index < 25; index++) await seed(historical, { state: "pending" });
  const afterBacklog = await seed(current);
  equal(
    (await claim(a)).map((row) => row.job_id),
    [afterBacklog.jobId],
    "Historical backlog does not consume p_limit or trigger history reads",
  );
  equal(
    await scalar(
      owner,
      "select count(*)::int value from private.shopify_job_leases where state='ignored'",
    ),
    20,
    "Cleanup is bounded to twenty deliveries",
  );
  equal(
    await scalar(
      owner,
      "select count(*)::int value from private.shopify_job_leases where state='pending'",
    ),
    5,
    "Overflow historical jobs wait without being leased",
  );
  equal(await claim(a), [], "Next cleanup drains history without returning it to the API reader");
  equal(
    await scalar(
      owner,
      "select count(*)::int value from private.shopify_job_leases where state='ignored'",
    ),
    25,
    "Remaining bounded batch closes on a later tick",
  );

  for (const timestamp of [
    "2030-02-01T12:00:00.123455999Z",
    cutover,
    "2030-02-01T12:00:00.123456001Z",
    "2030-02-01T12:00:00.122456Z",
    "2030-02-01T13:00:00.123456+01:00",
    "2030-02-01T07:00:00.123456-05:00",
    "2030-02-01T07:00:00.123455999-05:00",
  ]) {
    await reset();
    const boundary = await seed(timestamp);
    equal(
      (await claim(a)).map((row) => row.job_id),
      [boundary.jobId],
      "At/after cutover and the full one-millisecond margin are never inferred historical",
    );
  }
  for (const timestamp of [
    "2030-02-01T12:00:00.122454999Z",
    "2030-02-01T12:59:59.000000001+01:00",
    "2030-02-01T06:59:59.000000001-05:00",
    "2030-02-01T17:29:59.000000001+05:30",
  ]) {
    await reset();
    const prior = await seed(timestamp);
    equal(
      await claim(a),
      [],
      "Unequivocal history, including offset timestamps, needs no API read",
    );
    equal(
      (await lease(prior)).state,
      "ignored",
      "Conservative timestamp comparison closes only definite history",
    );
  }
  for (const [created, extra] of [
    ["not-a-date", {}],
    ["2030-02-30T12:00:00Z", {}],
    [null, {}],
    [4, {}],
    [historical, { missingCreated: true }],
    ["2030-01-01T00:00:00+24:00", {}],
    ["2030-01-01T00:00:00-01:60", {}],
    ["2030-01-01T00:00:00+1:00", {}],
  ]) {
    await reset();
    const malformed = await seed(created, { corruptCue: true, ...extra });
    equal(
      (await claim(a)).map((row) => row.job_id),
      [malformed.jobId],
      "Malformed/missing source dates are not silently discarded",
    );
  }

  await reset();
  const disabled = await seed(historical, { state: "review" });
  await owner.query("update private.shopify_sync_configuration set enabled=false");
  equal(await claim(a), [], "Disabled configuration is not a cleanup authorization");
  equal((await lease(disabled)).state, "review", "Disabled shop review is preserved");
  await reset();
  const noCutover = await seed(historical, { state: "review" });
  await owner.query("update public.app_settings set sales_started_at=null");
  await claim(a);
  equal((await lease(noCutover)).state, "review", "Missing cutover never authorizes cleanup");
  await reset();
  const unconfigured = await seed(historical, {
    shop: "synthetic-unconfigured.myshopify.com",
    state: "review",
  });
  await claim(a);
  equal((await lease(unconfigured)).state, "review", "Unconfigured shop is left untouched");

  await reset();
  const active = await seed(historical, { state: "leased" });
  const applied = await seed(historical, { state: "applied" });
  const alreadyIgnored = await seed(historical, { state: "ignored" });
  const terminal = [await lease(active), await lease(applied), await lease(alreadyIgnored)];
  equal(await claim(a), [], "Active leases and terminal states are excluded");
  equal(
    [await lease(active), await lease(applied), await lease(alreadyIgnored)],
    terminal,
    "Cleanup never changes active/terminal deliveries",
  );
  await reset();
  const expired = await seed(historical, { state: "leased", expired: true });
  equal(
    (await claim(a)).map((row) => row.job_id),
    [expired.jobId],
    "Expired leases retain the existing recovery path",
  );
  equal((await lease(expired)).attempts, 4, "Expired lease recovery is a real new claim");

  await reset();
  const importedJob = await seed(historical, { state: "review" });
  await as(a, "select private.synthetic_seed_identity($1,$2)", [shop, importedJob.orderGid]);
  const importedBefore = await snapshot();
  await claim(a);
  equal(
    (await lease(importedJob)).state,
    "review",
    "An existing import is never hidden by its source creation date",
  );
  equal(await snapshot(), importedBefore, "Existing business data and identity are untouched");
  const sameGidOtherShop = await seed(historical, {
    state: "review",
    shop: otherShop,
    gid: importedJob.orderGid,
  });
  await claim(a);
  equal(
    (await lease(sameGidOtherShop)).state,
    "ignored",
    "Identity exclusion uses both shop and order GID",
  );

  await reset();
  const locked = await seed(historical, { state: "review" });
  const unlocked = await seed(current);
  await begin(a, "postgres");
  await a.query("select job_id from private.shopify_job_leases where job_id=$1 for update", [
    locked.jobId,
  ]);
  equal(
    (await claim(b)).map((row) => row.job_id),
    [unlocked.jobId],
    "SKIP LOCKED avoids a held historical lease and still claims current work",
  );
  equal((await lease(locked)).state, "review", "Locked history is unchanged in a separate session");
  await a.query("commit");
  await claim(b);
  equal(
    (await lease(locked)).state,
    "ignored",
    "Previously locked history closes on a later claim",
  );

  await reset();
  const importing = await seed(historical, { state: "review" });
  await begin(a);
  await a.query("select private.synthetic_seed_identity($1,$2)", [shop, importing.orderGid]);
  equal(await claim(b), [], "Try-advisory skips a concurrent import without waiting for it");
  equal(
    (await lease(importing)).state,
    "review",
    "Uncommitted identity is protected by the shared order lock",
  );
  await a.query("commit");
  await claim(b);
  equal(
    (await lease(importing)).state,
    "review",
    "Committed concurrent identity is rechecked on the next cleanup",
  );

  await reset();
  const decision = await seed(historical, { state: "review" });
  await begin(a);
  equal(
    await scalar(a, claimSql, [randomUUID(), 1, 120]),
    [],
    "Cleanup decision can be held until transaction commit",
  );
  await begin(b);
  let pending = b.query(
    "select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.shopify.'||$1||'.'||$2,0))",
    [shop, decision.orderGid],
  );
  void pending.catch(() => {});
  await waitBlocked(owner, bPid, aPid);
  equal(
    (await lease(decision)).state,
    "review",
    "Ignored decision is not visible before its commit",
  );
  await a.query("commit");
  await pending;
  await b.query("commit");
  equal(
    (await lease(decision)).state,
    "ignored",
    "Order lock releases only after the ignored decision commits",
  );

  await reset();
  const shifted = await seed("2030-01-15T00:00:00Z");
  await begin(a, "postgres");
  await a.query("update public.app_settings set sales_started_at='2030-01-01T00:00:00Z'");
  await begin(b);
  pending = b.query(claimSql, [randomUUID(), 1, 120]);
  void pending.catch(() => {});
  await waitBlocked(owner, bPid, aPid);
  await a.query("commit");
  const shiftedClaim = (await pending).rows[0].value;
  await b.query("commit");
  equal(
    shiftedClaim.map((row) => row.job_id),
    [shifted.jobId],
    "Cleanup rereads a committed cutover change under its row lock",
  );
  equal(
    (await lease(shifted)).state,
    "leased",
    "A now-current order is claimed, not incorrectly ignored",
  );

  await reset();
  const rolledBack = await seed(historical, { state: "review" });
  await begin(a);
  await scalar(a, claimSql, [randomUUID(), 1, 120]);
  await a.query("rollback");
  equal((await lease(rolledBack)).state, "review", "Cleanup rolls back with its claim transaction");
  for (const args of [
    [null, 1, 120],
    [randomUUID(), 0, 120],
    [randomUUID(), 21, 120],
    [randomUUID(), 1, 29],
    [randomUUID(), 1, 901],
  ]) {
    await assert.rejects(as(a, claimSql, args), (error) => error.code === "22023");
    checks++;
  }
  equal(
    (await lease(rolledBack)).state,
    "review",
    "Invalid claim parameters cannot cause cleanup side effects",
  );
  const finalBefore = await snapshot();
  await claim(a);
  equal(
    await snapshot(),
    finalBefore,
    "No commercial or physical mutations after all recovery paths",
  );
  console.log(
    `PASS ${checks} PostgreSQL 17 cutover-claim checks; real row/advisory/settings interleavings, synthetic cues only, no cloud access.`,
  );
} catch (error) {
  console.error({ message: error.message, code: error.code });
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map((client) => client.query("rollback")));
  await Promise.allSettled(clients.map((client) => client.end()));
  if (started) {
    try {
      run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
    } catch {
      process.exitCode = 1;
    }
  }
  rmSync(temporary, { recursive: true, force: true });
}
