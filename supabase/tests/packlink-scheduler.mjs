// test-db: pglite minimo 51
// Cron, Vault and HTTP are explicit synthetic stand-ins; no real secrets/network.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (!process.argv[2]?.startsWith("/")) throw new Error("Pass the absolute PGlite module path.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const equal = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
const value = async (sql, args = []) => (await db.query(sql, args)).rows[0].value;
async function as(role, task) {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    const result = await task();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
async function rejected(task, code) {
  let caught;
  try {
    await task();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  equal(caught.code, code);
}
const secret = "synthetic_packlink_scheduler_secret_0000000000";
const rotated = "synthetic_packlink_rotated_secret_000000000000";
const configure = (token, enabled, role = "service_role") =>
  as(role, () =>
    value("select public.configure_packlink_scheduler($1,$2) value", [token, enabled]),
  );
try {
  await db.exec(readFileSync(new URL("./fixtures/shopify-scheduler.sql", import.meta.url), "utf8"));
  await db.exec(
    "create table private.packlink_sync_configuration(enabled boolean not null); insert into private.packlink_sync_configuration values(false)",
  );
  const directory = new URL("../migrations/", import.meta.url);
  const files = readdirSync(directory).filter((f) => f.endsWith("_packlink_scheduler.sql"));
  equal(files.length, 1);
  const source = readFileSync(new URL(files[0], directory), "utf8");
  const migration = source.replace(/^create extension if not exists .*;$/gm, "");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`grant select on vault.decrypted_secrets to ${role}`);
    await rejected(async () => {
      try {
        await db.exec(migration);
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    }, "55000");
    await db.exec(`revoke select on vault.decrypted_secrets from ${role}`);
  }
  await db.exec(migration);
  for (const table of [
    "cron.job",
    "vault.secrets",
    "net.synthetic_requests",
    "private.packlink_scheduler_state",
  ])
    equal(await value(`select count(*)::int value from ${table}`), 0);
  for (const role of ["anon", "authenticated"]) {
    await rejected(() => configure(secret, true, role), "42501");
    await rejected(
      () => as(role, () => db.exec("select private.dispatch_packlink_worker_tick()")),
      "42501",
    );
    await rejected(
      () => as(role, () => db.query("select * from private.packlink_scheduler_state")),
      "42501",
    );
  }
  await rejected(
    () =>
      as("authenticated", async () => {
        await db.query("select set_config('request.jwt.claims',$1,true)", [
          '{"role":"service_role"}',
        ]);
        return value("select public.configure_packlink_scheduler($1,true) value", [secret]);
      }),
    "42501",
  );
  await rejected(() => configure(secret, true), "55000");
  for (const bad of [null, "short", "synthetic\ninvalid-secret-000000000000", "x".repeat(257)])
    await rejected(() => configure(bad, true), "22023");
  await db.exec("update private.packlink_sync_configuration set enabled=true");
  equal(await configure(secret, true), { enabled: true, schedule_seconds: 900 });
  const job = (await db.query("select * from cron.job")).rows[0];
  equal(job.username, "postgres");
  equal(job.schedule, "*/15 * * * *");
  equal(job.active, true);
  equal(job.command, "select private.dispatch_packlink_worker_tick();");
  equal(job.command.includes(secret), false);
  await db.query("select private.dispatch_packlink_worker_tick()");
  let request = (await db.query("select * from net.synthetic_requests order by id desc limit 1"))
    .rows[0];
  equal(request.url, "https://luckylap.vercel.app/api/integrations/packlink/worker");
  equal(request.body, {});
  equal(request.timeout_ms, 55000);
  equal(request.executed_by, "postgres");
  equal(request.headers, { "Content-Type": "application/json", Authorization: `Bearer ${secret}` });
  await db.exec("update private.packlink_sync_configuration set enabled=false");
  await db.query("select private.dispatch_packlink_worker_tick()");
  equal(await value("select count(*)::int value from net.synthetic_requests"), 1);
  await db.exec(
    "update private.packlink_sync_configuration set enabled=true; update cron.job set active=false",
  );
  equal(await configure(rotated, true), { enabled: true, schedule_seconds: 900 });
  equal(await value("select count(*)::int value from cron.job"), 1);
  equal(await value("select active value from cron.job"), true);
  equal(await value("select count(*)::int value from vault.secrets"), 1);
  await db.query("select private.dispatch_packlink_worker_tick()");
  request = (await db.query("select * from net.synthetic_requests order by id desc limit 1"))
    .rows[0];
  equal(request.headers.Authorization, `Bearer ${rotated}`);
  await db.exec("update private.synthetic_scheduler_switch set mode='fail'");
  await rejected(() => configure(secret, true), "P0001");
  equal(await value("select secret value from vault.secrets"), rotated);
  await db.exec("update private.synthetic_scheduler_switch set mode='wrong_owner'");
  await rejected(() => configure(secret, true), "55000");
  equal(await value("select count(*)::int value from cron.job"), 1);
  equal(await value("select secret value from vault.secrets"), rotated);
  await db.exec("update private.synthetic_scheduler_switch set mode='normal'");
  await db.query("insert into vault.secrets(name,secret) values('synthetic_unrelated_secret',$1)", [
    secret,
  ]);
  equal(await configure(null, false), { enabled: false, schedule_seconds: 900 });
  equal(await value("select count(*)::int value from cron.job"), 0);
  equal(await value("select count(*)::int value from private.packlink_scheduler_state"), 0);
  equal(
    await value(
      "select count(*)::int value from vault.secrets where name='luckylap_packlink_worker_bearer'",
    ),
    0,
  );
  equal(
    await value(
      "select count(*)::int value from vault.secrets where name='synthetic_unrelated_secret'",
    ),
    1,
  );
  await db.query("select private.dispatch_packlink_worker_tick()");
  equal(await value("select count(*)::int value from net.synthetic_requests"), 2);
  for (const role of ["anon", "authenticated", "service_role"])
    equal(
      await value(
        "select has_function_privilege($1,'private.dispatch_packlink_worker_tick()','EXECUTE') value",
        [role],
      ),
      false,
    );
  equal(
    await value(
      "select has_function_privilege('service_role','public.configure_packlink_scheduler(text,boolean)','EXECUTE') value",
    ),
    true,
  );
  console.log(`PASS ${checks} Packlink scheduler checks; PGlite, synthetic stand-ins, no network.`);
} finally {
  await db.close();
}
