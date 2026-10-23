// test-db: postgres minimo 32
// Real PostgreSQL 17 connections, disposable private socket, synthetic data only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  setupRevisionDatabase,
  users,
  session,
  sourceIds,
  orderId,
  id,
  payload,
  values,
} from "./fixtures/finance-revisions.mjs";
const [bin, modulePath] = process.argv.slice(2);
if (!bin?.startsWith("/") || !modulePath?.startsWith("/"))
  throw Error("Passare solo due percorsi locali assoluti: PG17 bin e pg/lib/index.js.");
const pg = await import(pathToFileURL(modulePath).href),
  Client = pg.Client ?? pg.default.Client;
const run = (name, args) => {
  const result = spawnSync(join(bin, name), args, {
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.status !== 0) throw Error(`${name}: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
};
const version = run("postgres", ["--version"]);
assert.match(version, /PostgreSQL\) 17\./);
const temporary = mkdtempSync("/private/tmp/luckylap-finance-revisions-"),
  data = join(temporary, "data"),
  socket = join(temporary, "socket");
mkdirSync(socket, { mode: 0o700 });
const port = await new Promise((done, fail) => {
  const server = createServer();
  server.once("error", fail);
  server.listen(0, "127.0.0.1", () => {
    const p = server.address().port;
    server.close(() => done(p));
  });
});
let started = false,
  checks = 0;
const clients = [];
const evidence = {
  version,
  transport: "private Unix socket, TCP disabled",
  startedAt: new Date().toISOString(),
  pids: [],
  cases: [],
  checks: 0,
  passed: false,
};
const equal = (a, b, label) => {
  assert.deepEqual(a, b, label);
  checks++;
};
const check = (v, label) => {
  assert.ok(v, label);
  checks++;
};
async function connect(name) {
  const client = new Client({
    host: socket,
    port,
    user: "luckylap_revision_test",
    database: "postgres",
    password: "",
    ssl: false,
    application_name: `luckylap-revisions-${name}`,
    statement_timeout: 15000,
    query_timeout: 18000,
    connectionTimeoutMillis: 5000,
  });
  client.on("error", () => {});
  await client.connect();
  clients.push(client);
  return client;
}
async function begin(client, role = "finance") {
  await client.query("begin isolation level read committed");
  await client.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({
      sub: users[role],
      session_id: session(role),
      aal: "aal1",
      user_metadata: { role: "founder" },
    }),
  ]);
  await client.query("set local role authenticated");
}
const rev = (client, p, op = randomUUID()) =>
  client
    .query("select public.revise_finance_movement($1,$2::jsonb) result", [op, JSON.stringify(p)])
    .then((r) => r.rows[0].result);
const caught = (promise) =>
  promise.then(
    (result) => ({ result }),
    (error) => ({ error }),
  );
async function blocks(owner, blocked, blocker) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const row = (
      await owner.query("select $2::int=any(pg_blocking_pids($1::int)) blocked", [blocked, blocker])
    ).rows[0];
    if (row.blocked) {
      checks++;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error("Second real connection did not block on the expected transaction.");
}
const payment = (client, op, amount, occurred) =>
  client
    .query("select public.record_manual_payment($1,$2::jsonb) result", [
      op,
      JSON.stringify({
        order_id: orderId,
        amount_cents: amount,
        method: "cash",
        occurred_at: occurred,
      }),
    ])
    .then((r) => r.rows[0].result);
try {
  run("initdb", [
    "-D",
    data,
    "-A",
    "trust",
    "-U",
    "luckylap_revision_test",
    "--no-locale",
    "--encoding=UTF8",
  ]);
  run("pg_ctl", [
    "-D",
    data,
    "-o",
    `-k ${socket} -p ${port} -c listen_addresses= -c log_min_messages=warning`,
    "-l",
    join(temporary, "server.log"),
    "-w",
    "start",
  ]);
  started = true;
  const owner = await connect("owner"),
    a = await connect("a"),
    b = await connect("b");
  const db = { exec: (sql) => owner.query(sql), query: (sql, args) => owner.query(sql, args) };
  await owner.query("create schema extensions;create extension pgcrypto with schema extensions;");
  const fixture = await setupRevisionDatabase(db);
  const pa = (await a.query("select pg_backend_pid() pid")).rows[0].pid,
    pb = (await b.query("select pg_backend_pid() pid")).rows[0].pid;
  evidence.pids = [pa, pb];
  check(pa !== pb, "two distinct real backend processes");
  // Concurrent source CAS: first uncommitted version owns the source lock.
  await begin(a);
  await begin(b, "founder");
  const casPayload = payload("budgetflow", {
      values: values({ amount_cents: 101, account: "Test bank" }),
    }),
    casFirst = await rev(a, casPayload);
  const casSecond = caught(rev(b, casPayload));
  await blocks(owner, pb, pa);
  await a.query("commit");
  const conflict = await casSecond;
  equal(conflict.error?.message, "finance_revision_conflict", "one stale CAS rejected");
  await b.query("rollback");
  equal(
    (
      await owner.query(
        "select count(*)::int n from public.finance_movement_revisions where source_kind='budgetflow'",
      )
    ).rows[0].n,
    1,
    "one source revision committed",
  );
  evidence.cases.push("source CAS: one commit, one conflict");
  // Same operation in two connections serializes before CAS and returns receipt.
  await begin(a);
  await begin(b);
  const operation = randomUUID(),
    retryPayload = payload("budgetflow", {
      expected_version: 1,
      values: values({ amount_cents: 202, account: "Test bank" }),
    });
  const original = await rev(a, retryPayload, operation),
    same = caught(rev(b, retryPayload, operation));
  await blocks(owner, pb, pa);
  await a.query("commit");
  const recovered = await same;
  equal(recovered.result, { ...original, replayed: true }, "same frozen operation recovered");
  await b.query("commit");
  equal(
    (
      await owner.query(
        "select count(*)::int n from private.finance_revision_receipts where operation_id=$1",
        [operation],
      )
    ).rows[0].n,
    1,
    "one durable receipt",
  );
  evidence.cases.push("same operation: one revision, exact replay");
  // Correcting an original 100 payment to 50 permits only one residual 50.
  await begin(a);
  await rev(a, payload());
  await a.query("commit");
  const occurred = new Date(Date.now() - 10000).toISOString(),
    paymentOp = randomUUID();
  await begin(a, "logistics");
  await begin(b, "consultant");
  const winner = await payment(a, paymentOp, 5000, occurred),
    loser = caught(payment(b, randomUUID(), 5000, occurred));
  await blocks(owner, pb, pa);
  await a.query("commit");
  equal(
    (await loser).error?.message,
    "payment_already_recorded",
    "concurrent residual rejected deterministically",
  );
  await b.query("rollback");
  equal(
    (
      await owner.query("select count(*)::int n from public.order_payments where order_id=$1", [
        orderId,
      ])
    ).rows[0].n,
    2,
    "only one new residual payment",
  );
  await begin(a, "logistics");
  equal(
    await payment(a, paymentOp, 5000, occurred),
    { ...winner, replayed: true },
    "exact payment retry",
  );
  await a.query("commit");
  evidence.cases.push("two residual payments: one success, one rejected, exact retry");
  // Revision and new collection share the aggregate row lock. A sale payment
  // cannot be deleted from Finance: a correction to zero opens the residual.
  await begin(a);
  await begin(b, "logistics");
  await rev(a, payload("payment", { expected_version: 1, values: values({ amount_cents: 0 }) }));
  const afterDelete = caught(payment(b, randomUUID(), 5000, occurred));
  await blocks(owner, pb, pa);
  await a.query("commit");
  equal(
    (await afterDelete).result?.payment_state,
    "paid",
    "collection reads committed corrected residual",
  );
  await b.query("commit");
  await begin(a);
  await rev(a, {
    schema_version: 1,
    source_kind: "payment",
    source_id: sourceIds.payment,
    expected_version: 2,
    action: "restore",
    restore_version: 0,
    reason: "Synthetic overpayment restoration",
  });
  await a.query("commit");
  equal(
    (
      await owner.query(
        "select refund_due_cents::text amount from public.sales_orders where id=$1",
        [orderId],
      )
    ).rows[0].amount,
    "10000",
    "restore exposes overpayment after further collection",
  );
  evidence.cases.push("correction/collection serialize; restore exposes overpayment");
  // Corrected old consignment residual is serialized by the original sale row.
  await begin(a);
  await rev(a, payload("consignment_settlement", { values: values({ amount_cents: 500 }) }));
  await a.query("commit");
  const settlementOp = randomUUID(),
    settlementPayload = {
      schema_version: 1,
      sale_id: id(222),
      amount_cents: 6100,
      occurred_at: occurred,
      method: "cash",
      reference: "SYN-CONCURRENT",
    };
  const settle = (client, op, p) =>
    client
      .query("select public.record_consignment_settlement($1,$2::jsonb) result", [
        op,
        JSON.stringify(p),
      ])
      .then((r) => r.rows[0].result);
  await begin(a);
  await begin(b, "founder");
  const settlement = await settle(a, settlementOp, settlementPayload),
    duplicate = caught(settle(b, randomUUID(), { ...settlementPayload, reference: "SYN-OTHER" }));
  await blocks(owner, pb, pa);
  await a.query("commit");
  equal(
    (await duplicate).error?.message,
    "settlement_exceeds_claim",
    "concurrent legacy residual rejected",
  );
  await b.query("rollback");
  await begin(a);
  equal(
    await settle(a, settlementOp, settlementPayload),
    { ...settlement, replayed: true },
    "legacy settlement exact retry",
  );
  await a.query("commit");
  evidence.cases.push("legacy residual: single actual collection, exact retry");
  // Legacy void cannot bypass an in-flight P4 edit of the same source.
  await begin(a);
  await begin(b);
  await rev(a, payload("manual"));
  const legacyVoid = caught(
    b.query("select public.void_finance_entry($1,$2::jsonb)", [
      randomUUID(),
      JSON.stringify({
        schema_version: 1,
        entry_id: sourceIds.manual,
        reason: "Synthetic stale old button",
      }),
    ]),
  );
  await blocks(owner, pb, pa);
  await a.query("commit");
  equal(
    (await legacyVoid).error?.message,
    "use_finance_revisions",
    "legacy void prevented after concurrent revision",
  );
  await b.query("rollback");
  evidence.cases.push("manual revision versus legacy void: one controlled path");
  // A session deleted while a revision waits must not regain a write via the wait.
  await a.query("begin");
  await a.query("select id from public.finance_entries where id=$1 for update", [sourceIds.manual]);
  await begin(b);
  const revoked = caught(rev(b, payload("manual", { expected_version: 1 })));
  await blocks(owner, pb, pa);
  await owner.query("delete from auth.sessions where id=$1", [session("finance")]);
  await a.query("commit");
  equal(
    (await revoked).error?.message,
    "finance_access_required",
    "fresh session checked after wait",
  );
  await b.query("rollback");
  await owner.query("insert into auth.sessions(id,user_id)values($1,$2)", [
    session("finance"),
    users.finance,
  ]);
  evidence.cases.push("logout during lock wait: no mutation");
  // Expiry must be evaluated after a real wait, not at statement start.
  await owner.query(
    "update private.area_grants set expires_at=clock_timestamp()+interval '500 milliseconds' where session_id=$1 and area='finance'",
    [session("finance")],
  );
  await a.query("begin");
  await a.query("select id from public.finance_entries where id=$1 for update", [sourceIds.manual]);
  await begin(b);
  const expired = caught(rev(b, payload("manual", { expected_version: 1 })));
  await blocks(owner, pb, pa);
  await owner.query("select pg_sleep(0.6)");
  await a.query("commit");
  equal(
    (await expired).error?.message,
    "finance_access_required",
    "area expires naturally during source lock wait",
  );
  await b.query("rollback");
  await owner.query(
    "update private.area_grants set expires_at=clock_timestamp()+interval '8 hours' where session_id=$1 and area='finance'",
    [session("finance")],
  );
  evidence.cases.push("natural Finance expiry during lock wait: no mutation");
  // Whole transaction rollback preserves revision, receipt and order together.
  const before = (
    await owner.query(
      "select (select count(*) from public.finance_movement_revisions)::int revisions,(select count(*) from private.finance_revision_receipts)::int receipts,(select refund_due_cents::text from public.sales_orders where id=$1) refund",
      [orderId],
    )
  ).rows[0];
  await begin(a);
  await rev(a, payload("payment", { expected_version: 3, values: values({ amount_cents: 1234 }) }));
  await assert.rejects(
    () => a.query("select 1/0"),
    (error) => error.code === "22012",
  );
  checks++;
  await a.query("rollback");
  equal(
    (
      await owner.query(
        "select (select count(*) from public.finance_movement_revisions)::int revisions,(select count(*) from private.finance_revision_receipts)::int receipts,(select refund_due_cents::text from public.sales_orders where id=$1) refund",
        [orderId],
      )
    ).rows[0],
    before,
    "atomic rollback of all effects",
  );
  equal(
    (await owner.query("select count(*)::int n from public.stock_movements")).rows[0].n,
    fixture.stockBefore,
    "no stock mutation across races",
  );
  equal(
    (
      await owner.query(
        "select unit_price_cents::text price,quantity from public.sales_order_lines where id=$1",
        [id(202)],
      )
    ).rows[0],
    { price: "10000", quantity: 1 },
    "prices and quantities untouched",
  );

  equal(
    (
      await owner.query("select amount_cents::text amount from public.order_payments where id=$1", [
        sourceIds.payment,
      ])
    ).rows[0].amount,
    "10000",
    "original payment amount remains immutable",
  );
  equal(
    (
      await owner.query(
        "select amount_cents::text amount from public.finance_entries where id=$1",
        [sourceIds.manual],
      )
    ).rows[0].amount,
    "123",
    "original manual amount remains immutable",
  );
  equal(
    (
      await owner.query(
        "select count(*)::int n from public.finance_movement_revisions where source_kind='budgetflow'",
      )
    ).rows[0].n,
    2,
    "exactly two distinct CAS/replay revisions",
  );
  equal(
    (
      await owner.query("select count(*)::int n from public.order_payments where order_id=$1", [
        orderId,
      ])
    ).rows[0].n,
    3,
    "three actual payment sources, no duplicates after races",
  );
  equal(
    (
      await owner.query(
        "select count(*)::int n from public.consignment_settlements where sale_id=$1",
        [id(222)],
      )
    ).rows[0].n,
    2,
    "one additional legacy settlement only",
  );
  evidence.cases.push("atomic rollback, immutable stock and prices");
  evidence.passed = true;
  console.log(
    `PASS ${checks} Finance revision concurrency controlli superati (PostgreSQL 17, PID distinti).`,
  );
} catch (error) {
  console.error(JSON.stringify({ message: error.message, code: error.code, where: error.where }));
  process.exitCode = 1;
} finally {
  for (const client of clients.reverse()) await client.end().catch(() => {});
  if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  evidence.checks = checks;
  evidence.finishedAt = new Date().toISOString();
  const proof = fileURLToPath(new URL("../../.private/deployment-proof/", import.meta.url));
  mkdirSync(proof, { recursive: true });
  writeFileSync(
    join(proof, "finance-revisions-concurrency.json"),
    JSON.stringify(evidence, null, 2),
  );
  rmSync(temporary, { recursive: true, force: true });
}
