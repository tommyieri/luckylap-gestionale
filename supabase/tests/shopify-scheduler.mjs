// PostgreSQL semantics via PGlite. Cron, pg_net and Vault are explicit local
// stand-ins: this proves ACL/transaction/configuration behavior, not delivery,
// extension encryption or a real wall-clock cron process. No network or cloud.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (!process.argv[2]?.startsWith("/")) throw new Error("Pass the absolute PGlite module path.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const equal = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const check = (value, label) => {
  assert.ok(value, label);
  checks++;
};
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].value;
async function as(role, callback, claims = {}) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ role, ...claims }),
    ]);
    await db.exec(`set local role ${role}`);
    const value = await callback();
    await db.exec("commit");
    return value;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const configure = (secret, enabled, role = "service_role", schema = "public", claims = {}) =>
  as(
    role,
    () => scalar(`select ${schema}.configure_shopify_scheduler($1,$2) value`, [secret, enabled]),
    claims,
  );
async function rejects(action, code, message) {
  let caught;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  check(caught, "Action must reject");
  equal(caught.code, code, "Expected SQLSTATE");
  if (message) equal(caught.message, message, "Safe machine error");
}
const count = (table) => scalar(`select count(*)::int value from ${table}`);
// Only synthetic credentials below. They are never operational values.
const secret = "synthetic_scheduler_secret_000000000000";
const rotated = "synthetic_rotated_secret_0000000000000";
const name = "luckylap-shopify-worker";
const secretName = "luckylap_shopify_worker_bearer";
try {
  equal(
    await scalar("select current_user value"),
    "postgres",
    "Harness uses expected function owner",
  );
  await db.exec(readFileSync(new URL("./fixtures/shopify-scheduler.sql", import.meta.url), "utf8"));
  const directory = new URL("../migrations/", import.meta.url);
  const files = readdirSync(directory).filter((file) => file.endsWith("_shopify_scheduler.sql"));
  equal(files.length, 1, "Exactly one scheduler migration");
  const migration = readFileSync(new URL(files[0], directory), "utf8");
  equal(
    (migration.match(/^create extension if not exists /gm) ?? []).length,
    3,
    "Three explicit extension prerequisites",
  );
  check(
    migration.includes("url:='https://luckylap.vercel.app/api/integrations/shopify/worker'"),
    "Fixed production URL",
  );
  check(
    !migration.includes(secret) && !migration.includes(rotated),
    "No credential literal in migration",
  );
  const localMigration = migration.replace(/^create extension if not exists .*;$/gm, "");
  for (const role of ["anon", "authenticated"])
    for (const relation of ["vault.secrets", "vault.decrypted_secrets"]) {
      await db.exec(`grant select on ${relation} to ${role}`);
      await rejects(
        () => db.exec(localMigration),
        "55000",
        "shopify_scheduler_vault_permissions_required",
      );
      await db.exec("rollback");
      equal(
        await scalar("select to_regclass('private.shopify_scheduler_state') is null value"),
        true,
        "Unsafe Vault preflight leaves no module table",
      );
      await db.exec(`revoke select on ${relation} from ${role}`);
    }
  await db.exec(localMigration);
  equal(await count("cron.job"), 0, "Migration creates no cron job");
  equal(await count("vault.secrets"), 0, "Migration seeds no secret");
  equal(
    await count("private.shopify_scheduler_state"),
    0,
    "Migration does not enable configuration",
  );
  equal(await count("net.synthetic_requests"), 0, "Migration queues no HTTP call");
  equal(
    await scalar(
      "select relrowsecurity value from pg_class where oid='private.shopify_scheduler_state'::regclass",
    ),
    true,
    "Private pointer table has RLS",
  );
  equal(
    await scalar(
      "select prosecdef value from pg_proc where oid='public.configure_shopify_scheduler(text,boolean)'::regprocedure",
    ),
    false,
    "Public wrapper is invoker",
  );
  for (const signature of [
    "private.configure_shopify_scheduler(text,boolean)",
    "private.dispatch_shopify_worker_tick()",
  ]) {
    equal(
      await scalar(
        "select pg_get_userbyid(proowner) value from pg_proc where oid=$1::regprocedure",
        [signature],
      ),
      "postgres",
      "Explicit postgres definer owner",
    );
    equal(
      await scalar("select prosecdef value from pg_proc where oid=$1::regprocedure", [signature]),
      true,
      "Internal function is definer",
    );
    check(
      (
        await scalar("select proconfig value from pg_proc where oid=$1::regprocedure", [signature])
      ).includes('search_path=""'),
      "Fixed empty search path",
    );
  }
  for (const role of ["founder", "production", "finance", "logistics", "consultant"]) {
    for (const schema of ["public", "private"])
      await rejects(
        () =>
          configure(secret, true, "authenticated", schema, {
            sub: `synthetic-${role}`,
            user_metadata: { role: "service_role" },
          }),
        "42501",
      );
    await rejects(
      () =>
        as("authenticated", () => db.query("select private.dispatch_shopify_worker_tick()"), {
          role: "service_role",
        }),
      "42501",
    );
  }
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const table of [
      "private.shopify_scheduler_state",
      ...(role === "service_role" ? [] : ["vault.secrets", "vault.decrypted_secrets"]),
    ]) {
      equal(
        await scalar("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') value", [
          role,
          table,
        ]),
        false,
        "No browser access to Vault or direct API access to pointer",
      );
      await rejects(() => as(role, () => db.query(`select * from ${table}`)), "42501");
    }
    equal(
      await scalar(
        "select has_function_privilege($1,'private.dispatch_shopify_worker_tick()','EXECUTE') value",
        [role],
      ),
      false,
      "Only postgres cron owner may dispatch",
    );
  }
  for (const table of ["vault.secrets", "vault.decrypted_secrets"]) {
    equal(
      await scalar("select pg_get_userbyid(relowner) value from pg_class where oid=$1::regclass", [
        table,
      ]),
      "supabase_admin",
      "Provider Vault owner unchanged",
    );
    equal(
      await scalar("select has_table_privilege('service_role',$1,'SELECT') value", [table]),
      true,
      "Provider server-role Vault access preserved",
    );
  }
  await rejects(() => configure(secret, true, "anon"), "42501");
  await rejects(
    () => db.query("select private.configure_shopify_scheduler($1,true)", [secret]),
    "42501",
    "shopify_worker_access_required",
  );
  for (const invalid of [
    null,
    "",
    "short",
    "x".repeat(31),
    "x".repeat(257),
    "space ".repeat(10),
    "é".repeat(32),
    "x".repeat(32) + "\n",
  ]) {
    await rejects(
      () => configure(invalid, true),
      "22023",
      "invalid_shopify_scheduler_configuration",
    );
  }
  await rejects(() => configure(secret, null), "22023", "invalid_shopify_scheduler_configuration");
  equal(await count("vault.secrets"), 0, "Invalid configurations leave no secret");
  equal(await count("cron.job"), 0, "Invalid configurations leave no job");
  await db.query("select vault.create_secret('synthetic-other','unrelated_secret','unrelated')");
  await db.query("select cron.schedule('unrelated-job','0 0 * * *','select 1;')");
  equal(
    await configure(secret, true),
    { enabled: true, schedule_seconds: 60 },
    "Service role enables with a nonsecret receipt",
  );
  const firstSecretId = await scalar("select id value from vault.secrets where name=$1", [
    secretName,
  ]);
  equal(await count("private.shopify_scheduler_state"), 1, "Exactly one private pointer");
  let job = (await db.query("select * from cron.job where jobname=$1", [name])).rows[0];
  equal(job.username, "postgres", "Cron executes as postgres, never service_role");
  equal(job.schedule, "* * * * *", "Fixed one-minute cadence");
  equal(
    job.command,
    "select private.dispatch_shopify_worker_tick();",
    "Cron command has no bearer, URL or interpolated SQL",
  );
  check(!JSON.stringify(job).includes(secret), "Cron row does not contain the credential");
  await db.query("select private.dispatch_shopify_worker_tick()");
  let posted = (await db.query("select * from net.synthetic_requests order by id desc limit 1"))
    .rows[0];
  equal(
    posted.url,
    "https://luckylap.vercel.app/api/integrations/shopify/worker",
    "Exact HTTPS callback",
  );
  equal(posted.body, {}, "No caller-controlled request payload");
  equal(posted.timeout_ms, 55000, "Bounded HTTP timeout");
  equal(posted.executed_by, "postgres", "Dispatch owner remains postgres");
  equal(
    posted.headers,
    { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    "Bearer read privately at dispatch time",
  );
  equal(
    await configure(rotated, true),
    { enabled: true, schedule_seconds: 60 },
    "Credential rotation succeeds",
  );
  equal(
    await scalar("select id value from vault.secrets where name=$1", [secretName]),
    firstSecretId,
    "Rotation updates one existing Vault secret",
  );
  equal(await count("vault.secrets"), 2, "Unrelated secret preserved");
  equal(await count("cron.job"), 2, "Named job overwritten rather than duplicated");
  equal(
    await scalar("select jobid value from cron.job where jobname=$1", [name]),
    job.jobid,
    "Reconfigure keeps the named job identity",
  );
  await db.query("update cron.job set active=false where jobname=$1", [name]);
  equal(
    await configure(rotated, true),
    { enabled: true, schedule_seconds: 60 },
    "Explicit enable restores a paused named job",
  );
  equal(
    await scalar("select active value from cron.job where jobname=$1", [name]),
    true,
    "Paused job is explicitly reactivated",
  );
  await db.query("update private.synthetic_scheduler_switch set mode='fail'");
  await rejects(() => configure(secret, true), "P0001");
  equal(
    await scalar("select secret value from vault.secrets where name=$1", [secretName]),
    rotated,
    "A failed reschedule rolls back credential rotation",
  );
  equal(
    await scalar("select vault_secret_id value from private.shopify_scheduler_state"),
    firstSecretId,
    "A failed reschedule preserves the prior pointer",
  );
  equal(
    await scalar("select active value from cron.job where jobname=$1", [name]),
    true,
    "A failed reschedule preserves the prior active job",
  );
  await db.query("update private.synthetic_scheduler_switch set mode='normal'");
  await db.query("select private.dispatch_shopify_worker_tick()");
  equal(
    await scalar(
      "select headers->>'Authorization' value from net.synthetic_requests order by id desc limit 1",
    ),
    `Bearer ${rotated}`,
    "Dispatch reads current rotated credential",
  );
  for (const boundary of ["x".repeat(32), "x".repeat(256)])
    equal(
      await configure(boundary, true),
      { enabled: true, schedule_seconds: 60 },
      "Accepted URL-safe secret boundary",
    );
  await db.exec(`create function private.synthetic_block_vault_delete() returns trigger language plpgsql as $$begin
    if old.name='luckylap_shopify_worker_bearer' then raise exception 'synthetic Vault delete failure';end if;return old;end$$;
    create trigger synthetic_block_delete before delete on vault.secrets for each row execute function private.synthetic_block_vault_delete();`);
  await rejects(() => configure(null, false), "P0001");
  equal(
    await count("private.shopify_scheduler_state"),
    1,
    "Failed disable rolls back pointer deletion",
  );
  equal(
    await scalar("select count(*)::int value from cron.job where jobname=$1", [name]),
    1,
    "Failed disable rolls back unschedule",
  );
  equal(
    await scalar("select count(*)::int value from vault.secrets where name=$1", [secretName]),
    1,
    "Failed disable preserves the credential",
  );
  await db.exec(
    "drop trigger synthetic_block_delete on vault.secrets;drop function private.synthetic_block_vault_delete()",
  );
  equal(
    await configure(null, false),
    { enabled: false, schedule_seconds: 60 },
    "Disable removes only the named configuration",
  );
  equal(await count("private.shopify_scheduler_state"), 0, "Disable removes private pointer");
  equal(await count("vault.secrets"), 1, "Disable preserves unrelated Vault secret");
  equal(
    await scalar("select jobname value from cron.job"),
    "unrelated-job",
    "Disable preserves unrelated cron job",
  );
  equal(
    await scalar("select name value from vault.secrets"),
    "unrelated_secret",
    "Only the fixed Vault name removed",
  );
  const before = await count("net.synthetic_requests");
  await db.query("select private.dispatch_shopify_worker_tick()");
  equal(await count("net.synthetic_requests"), before, "Disabled dispatch queues no HTTP call");
  equal(
    await configure(null, false),
    { enabled: false, schedule_seconds: 60 },
    "Repeated disable is safe",
  );
  for (const mode of ["fail", "wrong_owner"]) {
    await db.query("update private.synthetic_scheduler_switch set mode=$1", [mode]);
    await rejects(() => configure(secret, true), mode === "fail" ? "P0001" : "55000");
    equal(
      await count("private.shopify_scheduler_state"),
      0,
      "Failed scheduling rolls back private pointer",
    );
    equal(await count("vault.secrets"), 1, "Failed scheduling rolls back credential creation");
    equal(await count("cron.job"), 1, "Failed scheduling rolls back named job");
  }
  console.log(
    `PASS ${checks} Shopify scheduler checks. Cron/pg_net/Vault stand-ins only; no real extensions, clock scheduling, credentials or delivery verified.`,
  );
} catch (error) {
  console.error({ message: error.message, code: error.code, position: error.position });
  process.exitCode = 1;
} finally {
  await db.close();
}
