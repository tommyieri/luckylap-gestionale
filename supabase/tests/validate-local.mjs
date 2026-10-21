// PostgreSQL semantics check with MOCKED Supabase Auth, no external connection.
// This is not an end-to-end test of Supabase/PostgREST/JWT/MFA or concurrency.
// Install PGlite outside the app and pass its absolute dist/index.js as argv[2].
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) throw new Error("Passare il percorso assoluto di @electric-sql/pglite/dist/index.js (dipendenza di test esterna).");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks += 1; };
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated;
  `);
  await db.exec(read("../migrations/202610210001_initial_schema.sql"));
  checks += 1;
  await db.exec(read("../inventory-initial.sql"));
  const counts = (await db.query(`select
    (select count(*)::int from public.products) products,
    (select count(*)::int from public.stock_items) items,
    (select count(*)::int from public.stock_locations) locations,
    (select count(*)::int from public.stock_movements) openings,
    (select count(*)::int from public.finance_entries) finance,
    (select count(*)::int from public.packaging_items) packaging`)).rows[0];
  assert.deepEqual(counts, { products: 9, items: 51, locations: 4, openings: 102, finance: 0, packaging: 0 }); checks += 1;
  const source = JSON.parse(process.argv[3]
    ? readFileSync(process.argv[3], "utf8")
    : read("../../data/inventory-source.json"));
  for (const row of source.inventory) for (const stock of row.stocks) {
    const result = await db.query(`select quantity::text as quantity from public.stock_balances b
      join public.stock_items i on i.id = b.stock_item_id
      join public.stock_locations l on l.id = b.location_id where i.sku = $1 and l.code = $2`, [row.sku, stock.location_code]);
    check(result.rows[0]?.quantity === (stock.quantity == null ? null : String(stock.quantity)), `Source quantity ${row.sku} ${stock.location_code}`);
  }

  const ids = {
    founder: "10000000-0000-0000-0000-000000000001",
    production: "10000000-0000-0000-0000-000000000002",
    finance: "10000000-0000-0000-0000-000000000003",
    logistics: "10000000-0000-0000-0000-000000000004",
    consultant: "10000000-0000-0000-0000-000000000005",
    outsider: "10000000-0000-0000-0000-000000000006",
    inactive: "10000000-0000-0000-0000-000000000007",
    other_production: "10000000-0000-0000-0000-000000000008",
  };
  for (const [name, id] of Object.entries(ids)) {
    await db.query("insert into auth.users(id, email) values ($1, $2)", [id, `${name}@example.invalid`]);
    if (name === "outsider") continue;
    await db.query("insert into public.profiles(user_id, display_name) values ($1, $2)", [id, name]);
    const role = name === "other_production" ? "production" : name === "inactive" ? "logistics" : name;
    await db.query("insert into public.memberships(user_id, role, active, finance_access) values ($1, $2, $3, $4)", [id, role, name !== "inactive", ["production", "finance"].includes(name)]);
  }
  await db.exec(`
    insert into public.stock_items(id, kind, sku, name) values ('20000000-0000-0000-0000-000000000001', 'packaging', 'TEST-ONLY', 'Test fixture');
    insert into public.stock_movements(operation_id, stock_item_id, location_id, kind, quantity_delta, reason)
      values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', (select id from public.stock_locations where code='MAG01'), 'opening', 10, 'Test fixture');
    insert into public.finance_entries(entry_date, entry_type, amount_eur, description, created_by)
      values (current_date, 'expense', 1, 'TEST ONLY; rolled back with in-memory DB', '${ids.founder}');
  `);
  const location = (await db.query("select id from public.stock_locations where code='MAG01'")).rows[0].id;
  const rpc = "select public.adjust_stock($1, '20000000-0000-0000-0000-000000000001', $2, $3, $4) as id";
  const operation = "30000000-0000-0000-0000-000000000002";

  async function asUser(name, aal, action, role = "authenticated") {
    await db.exec(`begin; set local role ${role};`);
    try {
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids[name], aal, user_metadata: { role: "founder" } })]);
      return await action();
    } finally { await db.exec("rollback;"); }
  }
  async function deny(name, aal, sql, params = [], role) {
    let caught;
    try { await asUser(name, aal, () => db.query(sql, params), role); } catch (error) { caught = error; }
    check(caught?.code === "42501", `${name} must be denied: ${sql}; got ${caught?.code}`);
  }
  for (const name of ["founder", "production", "finance", "logistics", "consultant", "other_production"]) {
    await asUser(name, "aal1", async () => {
      check((await db.query("select count(*)::int as n from public.stock_items")).rows[0].n === 52, `${name} reads shared inventory`);
      check((await db.query("select count(*)::int as n from public.finance_entries")).rows[0].n === 0, `${name} finance requires aal2`);
      check((await db.query("select count(*)::int as n from public.audit_logs")).rows[0].n === 0, `${name} audit requires aal2`);
    });
    await asUser(name, "aal2", async () => {
      const financeCount = (await db.query("select count(*)::int as n from public.finance_entries")).rows[0].n;
      check(financeCount === (["founder", "production", "finance"].includes(name) ? 1 : 0), `${name} finance whitelist`);
      const auditCount = (await db.query("select count(*)::int as n from public.audit_logs")).rows[0].n;
      check(name === "founder" ? auditCount > 0 : auditCount === 0, `${name} founder-only audit`);
    });
    await deny(name, "aal2", "update public.memberships set role='founder' where user_id=$1", [ids[name]]);
    await deny(name, "aal2", "update public.stock_balances set quantity=500");
    await deny(name, "aal2", "delete from public.stock_movements");
    await deny(name, "aal2", "insert into public.audit_logs(table_name, operation, record_key) values ('fake', 'INSERT', '{}')");
    await deny(name, "aal2", rpc, [operation, location, 1, "Disabled flag"]);
  }
  for (const name of ["outsider", "inactive"]) {
    await asUser(name, "aal2", async () => {
      check((await db.query("select count(*)::int as n from public.stock_items")).rows[0].n === 0, `${name} inventory denied`);
      check((await db.query("select count(*)::int as n from public.finance_entries")).rows[0].n === 0, `${name} finance denied`);
    });
    await deny(name, "aal2", "insert into public.tasks(title) values ('Denied')");
    await deny(name, "aal2", rpc, [operation, location, 1, "Denied nonmember"]);
  }
  await deny("outsider", "aal1", "select * from public.stock_items", [], "anon");
  await deny("outsider", "aal1", rpc, [operation, location, 1, "Denied anon"], "anon");
  await deny("logistics", "aal2", "insert into public.finance_entries(entry_date, entry_type, amount_eur, description) values (current_date, 'expense', 10, 'Denied')");
  await deny("founder", "aal1", "insert into public.finance_entries(entry_date, entry_type, amount_eur, description) values (current_date, 'expense', 10, 'Denied without MFA')");
  await deny("consultant", "aal1", "insert into public.discount_rules(label, discount_type, value) values ('Disabled', 'percentage', 10)");
  await db.exec("update public.app_settings set stock_adjustments_enabled=true, discounts_enabled=true;");
  for (const name of ["founder", "production", "finance", "logistics", "consultant"]) {
    await asUser(name, "aal1", async () => {
      const beforeAudit = (await db.query("select count(*)::int as n from public.audit_logs")).rows[0].n;
      check(beforeAudit === 0, "No audit content exposed before mutation");
      const first = await db.query(rpc, [operation, location, -2, "Physical correction"]);
      const retry = await db.query(rpc, [operation, location, -2, "Physical correction"]);
      check(first.rows[0].id === retry.rows[0].id, `${name} retry returns same movement`);
      check((await db.query("select quantity::int as q from public.stock_balances where stock_item_id='20000000-0000-0000-0000-000000000001'")).rows[0].q === 8, `${name} exactly one delta applied`);
      await db.query("insert into public.discount_rules(label, discount_type, value) values ('Enabled', 'percentage', 10)"); checks += 1;
      await db.query("insert into public.tasks(title) values ('Collaborative task')"); checks += 1;
    });
  }
  for (const [delta, reason] of [[-11, "Below zero"], [0, "No delta"], [1, " "]]) {
    let code;
    try { await asUser("consultant", "aal1", () => db.query(rpc, [operation, location, delta, reason])); } catch (error) { code = error.code; }
    check(code === "22023", `Invalid delta/reason rejected (${delta})`);
  }
  await asUser("consultant", "aal1", async () => {
    await db.query(rpc, [operation, location, -2, "Physical correction"]);
    let code;
    try { await db.query(rpc, [operation, location, 1, "Different request"]); } catch (error) { code = error.code; }
    check(code === "22023", "operation_id cannot be reused with different payload");
  });
  let reimportError;
  try { await db.exec(read("../inventory-initial.sql")); } catch (error) { reimportError = error; await db.exec("rollback;"); }
  check(Boolean(reimportError), "Initial import refuses an existing catalog");
  console.log(`PASS ${checks} checks in embedded PostgreSQL with mocked Auth; real Supabase runtime checks remain required.`);
} finally { await db.close(); }
