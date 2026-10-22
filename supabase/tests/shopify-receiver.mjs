// Embedded PostgreSQL + mocked gateway roles. No connection to Shopify or Supabase.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (!process.argv[2]) throw new Error("Pass the external PGlite module path.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
};
const uuid = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const roles = ["founder", "production", "finance", "logistics", "consultant"];
const cue = (changes = {}) => {
  const webhookId = changes.webhookId ?? randomUUID();
  const shopDomain = changes.shopDomain ?? "synthetic-shop.myshopify.com";
  return {
    shopDomain,
    webhookId,
    eventId: uuid(101),
    deliveryKey: `${shopDomain}:${webhookId.toLowerCase()}`,
    apiVersion: "2026-10",
    topic: "orders/create",
    orderGid: "gid://shopify/Order/9007199254740993",
    sourceName: "web",
    channel: "shopify_web",
    currency: "EUR",
    sourceCreatedAt: "2026-10-21T11:00:00+02:00",
    sourceUpdatedAt: "2026-10-21T12:00:00+02:00",
    bodySha256: "a".repeat(64),
    requiresCanonicalRead: true,
    ...changes,
  };
};
async function asRole(role, callback, claims = {}) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ role, ...claims }),
    ]);
    await db.exec(`set local role ${role}`);
    const result = await callback();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const receive = (input, role = "service_role", claims = {}, schema = "public") =>
  asRole(
    role,
    async () =>
      (
        await db.query(`select ${schema}.receive_shopify_order_notification($1::jsonb) result`, [
          JSON.stringify(input),
        ])
      ).rows[0].result,
    claims,
  );
async function rejects(action, message, code) {
  let error;
  try {
    await action();
  } catch (caught) {
    error = caught;
  }
  check(error, `Must reject: ${message ?? code}`);
  if (message) equal(error.message, message, `Machine error: ${message}`);
  if (code) equal(error.code, code, `SQLSTATE: ${message ?? code}`);
}
const total = async (table) => (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
try {
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema auth to anon, authenticated, service_role;`);
  const directory = new URL("../migrations/", import.meta.url);
  const names = readdirSync(directory);
  for (const suffix of ["initial_schema", "sales_ecosystem", "shopify_receiver"]) {
    const matches = names.filter((name) => name.endsWith(`_${suffix}.sql`));
    assert.equal(matches.length, 1, `One migration required for ${suffix}`);
    await db.exec(readFileSync(new URL(matches[0], directory), "utf8"));
  }
  for (const [index, role] of roles.entries()) {
    await db.query("insert into auth.users(id) values($1)", [uuid(index + 1)]);
    await db.query("insert into public.profiles(user_id,display_name) values($1,$2)", [
      uuid(index + 1),
      `Synthetic ${role}`,
    ]);
    await db.query("insert into public.memberships(user_id,role,finance_access) values($1,$2,$3)", [
      uuid(index + 1),
      role,
      ["founder", "production", "finance"].includes(role),
    ]);
    for (const schema of ["public", "private"])
      await rejects(
        () =>
          receive(
            cue(),
            "authenticated",
            { sub: uuid(index + 1), aal: "aal2", user_metadata: { role: "service_role" } },
            schema,
          ),
        null,
        "42501",
      );
  }
  await rejects(() => receive(cue(), "anon", { role: "service_role" }), null, "42501");
  await rejects(
    () =>
      db.query("select private.receive_shopify_order_notification($1::jsonb)", [
        JSON.stringify(cue()),
      ]),
    "shopify_receiver_access_required",
    "42501",
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const table of ["shopify_webhook_inbox", "shopify_order_read_jobs"]) {
      await rejects(
        () => asRole(role, () => db.query(`select * from private.${table}`)),
        null,
        "42501",
      );
      equal(
        (
          await db.query("select has_table_privilege($1,$2,'INSERT,UPDATE,DELETE') allowed", [
            role,
            `private.${table}`,
          ])
        ).rows[0].allowed,
        false,
        `${role} has no direct DML on ${table}`,
      );
    }
  }
  equal(
    (
      await db.query(
        "select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('shopify_webhook_inbox','shopify_order_read_jobs') and c.relrowsecurity",
      )
    ).rows[0].n,
    2,
    "RLS enabled as defense in depth",
  );
  equal(
    (
      await db.query(
        "select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='receive_shopify_order_notification' and n.nspname='public'",
      )
    ).rows[0].prosecdef,
    false,
    "Public wrapper is invoker",
  );

  const input = cue();
  const first = await receive(input);
  equal(first.replayed, false, "First receipt is new");
  equal(first.state, "awaiting_app", "No false synchronized state");
  check(
    first.inbox_id && first.job_id && first.received_at,
    "Stable receipt contains persisted IDs and time",
  );
  equal(
    await receive(input),
    { ...first, replayed: true },
    "Identical retry returns original receipt",
  );
  equal(await total("private.shopify_webhook_inbox"), 1, "No second inbox entry");
  equal(await total("private.shopify_order_read_jobs"), 1, "No second job");
  equal(
    await receive({
      ...input,
      webhookId: input.webhookId.toUpperCase(),
      eventId: input.eventId.toUpperCase(),
    }),
    { ...first, replayed: true },
    "UUID case is canonicalized",
  );
  for (const changed of [
    { bodySha256: "b".repeat(64) },
    { topic: "orders/paid" },
    { eventId: uuid(102) },
    { eventId: null },
    { orderGid: "gid://shopify/Order/123" },
    { sourceName: "pos", channel: "shopify_pos" },
    { currency: "USD" },
    { sourceUpdatedAt: "2026-10-21T12:01:00+02:00" },
  ])
    await rejects(() => receive({ ...input, ...changed }), "shopify_delivery_conflict", "22023");
  equal(await total("private.shopify_webhook_inbox"), 1, "Conflicts preserve original inbox");
  equal(await total("private.shopify_order_read_jobs"), 1, "Conflicts preserve original job");
  await receive(cue({ eventId: input.eventId }));
  equal(
    await total("private.shopify_order_read_jobs"),
    2,
    "Same event with another delivery remains a separate cue",
  );
  await receive(cue({ shopDomain: "other-synthetic.myshopify.com", webhookId: input.webhookId }));
  equal(
    await total("private.shopify_order_read_jobs"),
    3,
    "Deduplication is shop plus delivery ID",
  );
  for (const source of [
    { sourceName: null, channel: "shopify_other", eventId: null },
    { sourceName: "pos", channel: "shopify_pos" },
    { sourceName: "synthetic_app", channel: "shopify_other" },
  ])
    await receive(cue(source));

  const countBefore = await total("private.shopify_webhook_inbox");
  for (const malformed of [
    null,
    {},
    cue({ raw_body: "never stored" }),
    cue({ customer: { email: "private@example.test" } }),
    cue({ shopDomain: "custom.test" }),
    cue({ webhookId: "invalid" }),
    cue({ eventId: "invalid" }),
    cue({ deliveryKey: "wrong" }),
    cue({ apiVersion: "2026-07" }),
    cue({ topic: "refunds/create" }),
    cue({ orderGid: "gid://shopify/Order/18446744073709551616" }),
    cue({ sourceName: "x".repeat(256) }),
    cue({ sourceName: { private: "value" } }),
    cue({ sourceName: "web", channel: "shopify_pos" }),
    cue({ currency: "eur" }),
    cue({ sourceCreatedAt: "2026-02-30T11:00:00Z" }),
    cue({ sourceCreatedAt: "1999-01-01T00:00:00Z" }),
    cue({ sourceCreatedAt: "2026-10-22T11:00:00Z" }),
    cue({ sourceUpdatedAt: "2026-10-21" }),
    cue({ bodySha256: "A".repeat(64) }),
    cue({ requiresCanonicalRead: false }),
    cue({ requiresCanonicalRead: "true" }),
  ])
    await rejects(
      () => receive(malformed),
      malformed === null ||
        (typeof malformed === "object" &&
          (!Object.hasOwn(malformed, "shopDomain") ||
            Object.hasOwn(malformed, "raw_body") ||
            Object.hasOwn(malformed, "customer")))
        ? "invalid_payload"
        : "invalid_shopify_cue",
      "22023",
    );
  equal(
    await total("private.shopify_webhook_inbox"),
    countBefore,
    "Malformed cues leave no records",
  );

  await db.exec(`create function private.synthetic_fail_shopify_job() returns trigger language plpgsql as $$begin raise exception 'synthetic job failure';end$$;
    create trigger synthetic_job_failure before insert on private.shopify_order_read_jobs for each row execute function private.synthetic_fail_shopify_job();`);
  await rejects(() => receive(cue()), "synthetic job failure", "P0001");
  equal(
    await total("private.shopify_webhook_inbox"),
    countBefore,
    "Job failure rolls back inbox insert",
  );
  equal(
    await total("private.shopify_order_read_jobs"),
    countBefore,
    "Job failure has no partial job",
  );
  await db.exec(
    "drop trigger synthetic_job_failure on private.shopify_order_read_jobs; drop function private.synthetic_fail_shopify_job()",
  );
  await rejects(
    () =>
      db.query("update private.shopify_webhook_inbox set topic=topic where id=$1", [
        first.inbox_id,
      ]),
    null,
    "42501",
  );
  await rejects(
    () => db.query("delete from private.shopify_order_read_jobs where id=$1", [first.job_id]),
    null,
    "42501",
  );
  const stored = (
    await db.query("select cue from private.shopify_webhook_inbox where id=$1", [first.inbox_id])
  ).rows[0].cue;
  equal(
    stored,
    input,
    "Only the whitelisted cue is stored, without raw body, customer or monetary data",
  );
  equal(await total("public.sales_orders"), 0, "Receiving a cue does not create a sale");
  equal(await total("public.order_payments"), 0, "Receiving a cue does not declare a payment");
  equal(
    await total("public.commercial_facts"),
    0,
    "Receiving a cue does not fabricate Finance facts",
  );
  equal(await total("public.finance_entries"), 0, "Receiving a cue does not create manual Finance");
  equal(
    await total("public.stock_movements"),
    0,
    "Receiving a cue does not change physical inventory",
  );
  equal(
    (
      await db.query(
        "select manual_sales_enabled, sales_started_at from public.app_settings where id",
      )
    ).rows[0],
    { manual_sales_enabled: false, sales_started_at: null },
    "Receiver never enables operational flags or sets a cutover",
  );
  console.log(
    `PASS ${checks} Shopify receiver checks. Synthetic cues only; no cloud, orders, stock, Finance, credentials or subscriptions modified.`,
  );
} catch (error) {
  console.error({
    message: error.message,
    code: error.code,
    where: error.where,
    position: error.position,
    internalPosition: error.internalPosition,
  });
  process.exitCode = 1;
} finally {
  await db.close();
}
