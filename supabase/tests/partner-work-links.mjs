// test-db: pglite minimo 42
// Synthetic Auth contract. Uses actual P2 migration after integration, minimal contract otherwise.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const eq = (a, b, m) => {
  assert.deepEqual(a, b, m ?? "Values differ");
  checks++;
};
const ok = (a, m) => {
  assert.ok(a, m ?? "Expected truthy value");
  checks++;
};
const rejects = async (fn, code) => {
  let e;
  try {
    await fn();
  } catch (x) {
    e = x;
  }
  ok(e, "Expected rejected command");
  eq(e.code, code);
};
const u = randomUUID(),
  production = randomUUID(),
  outsider = randomUUID(),
  partner = randomUUID();
const migration = (name) => readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8");
async function as(fn, id = u) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: id }),
    ]);
    await db.exec("set local role authenticated");
    const out = await fn();
    await db.exec("commit");
    return out;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const cmd = (kind, extra = {}, op = randomUUID(), actor = u) =>
  as(
    async () =>
      (
        await db.query("select public.create_partner_work($1,$2::jsonb)r", [
          op,
          JSON.stringify({ schema_version: 1, kind, ...extra }),
        ])
      ).rows[0].r,
    actor,
  );
const count = async (table) => (await db.query("select count(*)::int n from " + table)).rows[0].n;
const activity = async (kind, origin = "team", at = new Date().toISOString()) => {
  const id = randomUUID();
  await db.query(
    `insert into public.partner_activities(id,operation_id,partner_id,origin,kind,occurred_at,created_by,partner_name,partner_co,message_kind)values($1,$2,$3,$4,$5,$6,$7,'Synthetic partner',42,case when $5='inviato'then'primo'else null end)`,
    [id, randomUUID(), partner, origin, kind, at, u],
  );
  return id;
};
try {
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;create function auth.uid()returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;create schema storage;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to authenticated;`,
  );
  for (const name of [
    "20261021114636_initial_schema.sql",
    "20261021121044_sales_ecosystem.sql",
    "20261021130138_brand_assets_and_development.sql",
  ])
    await db.exec(migration(name));
  const dependency = new URL("../migrations/20261022200000_partner_module.sql", import.meta.url);
  const actual = process.argv[3] ?? (existsSync(dependency) ? dependency : null);
  await db.exec(
    readFileSync(
      actual ?? new URL("fixtures/work-links/partner-contract.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const name of readdirSync(new URL("../migrations", import.meta.url)).filter((n) =>
    n.endsWith("_partner_work_links.sql"),
  ))
    await db.exec(migration(name));
  for (const [id, role] of [
    [u, "founder"],
    [production, "production"],
    [outsider, null],
  ]) {
    await db.query("insert into auth.users values($1)", [id]);
    await db.query(
      "insert into public.profiles(user_id,display_name)values($1,'Synthetic member')",
      [id],
    );
    if (role)
      await db.query("insert into public.memberships(user_id,role)values($1,$2)", [id, role]);
  }
  await db.query(
    "insert into public.partners(id,co,name,origin,stage,created_by,sections,priority,contact_month)values($1,42,'Synthetic partner','team','da_contattare',$2,array['eventi'],'media',date_trunc('month',current_date)::date)",
    [partner, u],
  );
  eq(await count("public.partner_work_links"), 0, "No fabricated historic followup");
  const today = () =>
    as(async () => (await db.query("select public.read_partner_today(current_date)r")).rows[0].r);
  eq((await today()).contact_count, 1, "Today counts shared due contacts");
  await rejects(
    () => as(() => db.query("select public.read_partner_today(current_date)"), outsider),
    "42501",
  );
  await activity("inviato", "file");
  eq(await count("public.tasks"), 0, "Historic device export is inert");
  const now = new Date(Date.now() + 1000).toISOString();
  await activity("inviato", "team", now);
  eq(await count("public.tasks"), 1);
  const first = (await db.query("select * from public.tasks")).rows[0];
  eq(first.assigned_to, u);
  eq(first.status, "todo");
  eq(
    (
      await db.query(
        "select (due_at at time zone'Europe/Rome')::date=(( $1::timestamptz at time zone'Europe/Rome')::date+7) v from public.tasks",
        [now],
      )
    ).rows[0].v,
    true,
  );
  await activity("inviato", "team", new Date(Date.now() + 2000).toISOString());
  eq(await count("public.tasks"), 2);
  eq(
    (await db.query("select count(*)::int n from public.tasks where status='todo'")).rows[0].n,
    1,
    "New cycle replaces old reminder",
  );
  await activity("risposta", "team", new Date(Date.now() + 3000).toISOString());
  eq(
    (await db.query("select count(*)::int n from public.tasks where status<>'done'")).rows[0].n,
    0,
  );
  await db.query(
    `insert into public.partner_do_not_contact(partner_id,active,reason,created_by)values($1,true,'Synthetic block',$2)`,
    [partner, u],
  );
  eq((await today()).contact_count, 0, "Blocked contacts never appear in Today");
  await activity("inviato", "team", new Date(Date.now() + 4000).toISOString());
  eq(await count("public.tasks"), 2, "Do-not-contact never opens a reminder");
  await db.query("delete from public.partner_do_not_contact where partner_id=$1", [partner]);
  const day = (
    await db.query(
      "select (make_date(extract(year from current_date)::int+2,3,31)-extract(dow from make_date(extract(year from current_date)::int+2,3,31))::int)::text as calendar_day",
    )
  ).rows[0].calendar_day;
  await db.query(
    "update public.partners set event_starts_on=$1,application_deadline=$1 where id=$2",
    [day, partner],
  );
  eq(await count("public.calendar_events"), 2);
  const link = (await db.query("select * from public.partner_work_links where kind='event'"))
    .rows[0];
  eq(
    (
      await db.query(
        "select extract(epoch from ends_at-starts_at)/3600 h from public.calendar_events where id=$1",
        [link.calendar_event_id],
      )
    ).rows[0].h
      .toString()
      .split(".")[0],
    "23",
    "DST all-day is 23 hours",
  );
  const event = (
    await db.query("select * from public.calendar_events where id=$1", [link.calendar_event_id])
  ).rows[0];
  eq(JSON.parse(event.description).allDay, true);
  await db.query("update public.partners set event_ends_on=event_starts_on+1 where id=$1", [
    partner,
  ]);
  eq(await count("public.calendar_events"), 2, "Date changes reuse same event");
  await db.query("update public.calendar_events set title='Human edited event'where id=$1", [
    link.calendar_event_id,
  ]);
  await db.query("update public.partners set event_ends_on=event_starts_on+2 where id=$1", [
    partner,
  ]);
  eq(
    (
      await db.query("select title from public.calendar_events where id=$1", [
        link.calendar_event_id,
      ])
    ).rows[0].title,
    "Human edited event",
  );
  let conflict = (await db.query("select * from public.partner_work_links where id=$1", [link.id]))
    .rows[0];
  eq(conflict.needs_review, true);
  await db.query("update public.calendar_events set title='Second human edit'where id=$1", [
    link.calendar_event_id,
  ]);
  await rejects(
    () =>
      cmd("resolve", {
        link_id: link.id,
        expected_version: Number(conflict.version),
        keep_manual: false,
      }),
    "40001",
  );
  conflict = (await db.query("select * from public.partner_work_links where id=$1", [link.id]))
    .rows[0];
  await db.query("update public.calendar_events set title='Human edited event'where id=$1", [
    link.calendar_event_id,
  ]);
  conflict = (await db.query("select * from public.partner_work_links where id=$1", [link.id]))
    .rows[0];
  await rejects(
    () =>
      cmd("resolve", {
        link_id: link.id,
        expected_version: Number(conflict.version) - 1,
        keep_manual: true,
      }),
    "40001",
  );
  await cmd("resolve", {
    link_id: link.id,
    expected_version: Number(conflict.version),
    keep_manual: true,
  });
  await db.query("update public.partners set event_ends_on=event_starts_on+3 where id=$1", [
    partner,
  ]);
  eq(
    (
      await db.query("select title from public.calendar_events where id=$1", [
        link.calendar_event_id,
      ])
    ).rows[0].title,
    "Human edited event",
    "Explicit human event stays detached",
  );
  const deadline = (await db.query("select * from public.partner_work_links where kind='deadline'"))
    .rows[0];
  await db.query("update public.calendar_events set title='Manual deadline'where id=$1", [
    deadline.calendar_event_id,
  ]);
  const current = (
    await db.query("select version from public.partner_work_links where id=$1", [link.id])
  ).rows[0];
  await cmd("resolve", {
    link_id: link.id,
    expected_version: Number(current.version),
    keep_manual: false,
  });
  eq(
    (
      await db.query("select title from public.calendar_events where id=$1", [
        link.calendar_event_id,
      ])
    ).rows[0].title,
    "Evento · Synthetic partner",
  );
  eq(
    (
      await db.query("select title from public.calendar_events where id=$1", [
        deadline.calendar_event_id,
      ])
    ).rows[0].title,
    "Manual deadline",
    "Resolve only touches chosen link",
  );
  const op = randomUUID(),
    result = await cmd("project", { partner_id: partner }, op);
  ok(result.target_id);
  eq((await cmd("project", { partner_id: partner }, op)).replayed, true);
  eq(await count("public.product_development_projects"), 1);
  eq(
    (await db.query("select owner_id from public.product_development_projects")).rows[0].owner_id,
    production,
  );
  await cmd("project", { partner_id: partner });
  eq(
    await count("public.product_development_projects"),
    1,
    "Second button press links existing outcome",
  );
  await rejects(() => cmd("shop_review", { partner_id: partner }, op), "23505");
  const review = await cmd("shop_review", { partner_id: partner });
  ok(review.target_id);
  eq(
    (
      await db.query("select description from public.tasks where id=$1", [review.target_id])
    ).rows[0].description.includes("commercialista"),
    true,
  );
  await rejects(() => cmd("event", { partner_id: partner }, randomUUID(), outsider), "42501");
  eq(
    (await as(() => db.query("select id from public.partner_work_links"), outsider)).rows.length,
    0,
    "RLS denies outsiders",
  );
  await rejects(
    () => as(() => db.query("update public.partner_work_links set needs_review=false")),
    "42501",
  );
  eq(
    (
      await db.query(
        "select has_function_privilege('authenticated','private.sync_partner_work_dates(uuid,uuid,boolean,text)','execute') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  console.log(
    "PASS " +
      checks +
      " Partner work links synthetic checks passed (" +
      (actual ? "actual P2 migration" : "isolated P2 contract") +
      ").",
  );
} catch (error) {
  console.error(
    JSON.stringify({
      message: error.message,
      code: error.code,
      detail: error.detail,
      where: error.where,
      query: error.query,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
