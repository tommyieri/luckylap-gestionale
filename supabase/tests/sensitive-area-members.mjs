// test-db: postgres minimo 180
// Catena reale di tutte le migrazioni: P2/P3 prima di P4/P5/P6.
// Solo Auth, Storage e le estensioni Supabase esterne hanno stand-in espliciti.
// Nessuna funzione applicativa sostituita; dati sintetici, socket privata, nessun cloud.
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
const directory = mkdtempSync("/private/tmp/luckylap-area-members-"),
  data = join(directory, "data"),
  socket = join(directory, "socket");
mkdirSync(socket, { mode: 0o700 });
const clients = [],
  names = ["founder", "production", "finance", "logistics", "consultant", "inactive", "outsider"],
  users = Object.fromEntries(names.map((name) => [name, randomUUID()])),
  sessions = Object.fromEntries(names.map((name) => [name, randomUUID()]));
let started = false,
  checks = 0,
  db;
const eq = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const ok = (value, label) => {
  assert.ok(value, label);
  checks++;
};
const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0].value;
async function as(name, sql, params = [], { sid = sessions[name], role = "authenticated" } = {}) {
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({
        sub: users[name],
        role,
        session_id: sid,
        aal: "aal1",
        user_metadata: { role: "founder" },
      }),
    ]);
    await db.query(`set local role ${role}`);
    const result = (await db.query(sql, params)).rows;
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
async function rejected(promise, code, label) {
  let caught;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  eq(caught?.code, code, label);
}
async function rpc(name, payload, who = "finance", op = randomUUID()) {
  assert.match(name, /^[a-z_]+$/);
  return (
    await as(who, `select public.${name}($1,$2::jsonb) value`, [op, JSON.stringify(payload)])
  )[0].value;
}
const today = () =>
  scalar("select (statement_timestamp() at time zone 'Europe/Rome')::date::text value");
const values = (date, amount, extra = {}) => ({
  date,
  direction: "income",
  amount_cents: amount,
  account: "Cash",
  target_account: null,
  category: "Vendite",
  description: "Correzione sintetica",
  pending: false,
  ...extra,
});
const revision = (kind, source, expected, action, extra = {}) => ({
  schema_version: 1,
  source_kind: kind,
  source_id: source,
  expected_version: expected,
  action,
  reason: "Verifica integrata sintetica",
  ...extra,
});
const feed = async (actor, area) =>
  (
    await as("founder", "select public.ceo_activity_feed($1,$2,null,null,50) value", [actor, area])
  )[0].value;

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
    `-k ${socket} -h '' -c fsync=off -c shared_buffers=16MB`,
    "-w",
    "start",
  ]);
  started = true;
  db = new Client({
    host: socket,
    user: "postgres",
    database: "postgres",
    ssl: false,
    statement_timeout: 15000,
  });
  await db.connect();
  clients.push(db);
  // Supabase-owned interfaces only: no application helper or table is mocked.
  await db.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
    create schema extensions;create extension pgcrypto with schema extensions;
    create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
    create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid()returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role;
    create schema storage;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;grant select,insert,update,delete on storage.objects to authenticated;
    create schema vault;create table vault.secrets(id uuid primary key,name text,decrypted_secret text);create view vault.decrypted_secrets as select * from vault.secrets;
    create schema cron;create table cron.job(jobid bigint,jobname text,username text,schedule text,command text,active boolean);
    create schema net;`);
  const migrationDirectory = new URL("../migrations/", import.meta.url),
    files = readdirSync(migrationDirectory)
      .filter((name) => name.endsWith(".sql"))
      .sort();
  const policyFile = files.find((name) => name.endsWith("_sensitive_area_member_passwords.sql"));
  if (!policyFile) throw Error("Migrazione password membri assente.");
  for (const file of files.filter((name) => name !== policyFile)) {
    let source = readFileSync(new URL(file, migrationDirectory), "utf8");
    if (file.endsWith("_shopify_scheduler.sql")) {
      // Only unavailable external extension installation is omitted. The actual
      // scheduler DDL, ACL, ownership and application functions still compile.
      let count = 0;
      source = source.replace(
        /^create extension if not exists (?:pg_cron|pg_net|supabase_vault) with schema [a-z_]+;$/gm,
        () => {
          count++;
          return "-- External Supabase extension interface provided above.";
        },
      );
      eq(count, 3, "Tre sole estensioni esterne sostituite esplicitamente");
    }
    try {
      await db.query(source);
    } catch (error) {
      throw Error(`Migrazione ${file}: ${error.message}`, { cause: error });
    }
    checks++;
  }
  for (const name of names) {
    await db.query("insert into auth.users values($1)", [users[name]]);
    await db.query("insert into auth.sessions(id,user_id)values($1,$2)", [
      sessions[name],
      users[name],
    ]);
    if (name === "outsider") continue;
    await db.query("insert into public.profiles(user_id,display_name)values($1,$2)", [
      users[name],
      `Membro sintetico ${name}`,
    ]);
    await db.query(
      "insert into public.memberships(user_id,role,active,finance_access)values($1,$2,$3,false)",
      [users[name], name === "inactive" ? "finance" : name, name !== "inactive"],
    );
  }
  const financePassword = "synthetic-finance",
    auditPassword = "synthetic-audit";
  const configure = async (area, password) =>
    (
      await as(
        "founder",
        "select public.configure_sensitive_password($1,$2)value",
        [area, password],
        { role: "service_role" },
      )
    )[0].value;
  eq(
    await configure("finance", financePassword),
    true,
    "Bootstrap locale tramite la funzione amministrativa reale",
  );
  eq(
    await configure("audit", auditPassword),
    true,
    "Password CEO distinta configurata soltanto nel database usa e getta",
  );
  await db.query(
    "insert into public.finance_entries(entry_date,entry_type,amount_eur,description,created_by)values(current_date,'income',5.43,'Voce sintetica',$1)",
    [users.founder],
  );
  const oldFunctions = await scalar(
    "select jsonb_agg(jsonb_build_array(p.oid::text,p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text)order by p.oid)value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and p.proname in('sensitive_area_status','unlock_sensitive_area','lock_sensitive_area','configure_sensitive_password','can_finance','can_audit','finance_revision_live_access','shop_payment_finance_access','is_founder')",
  );
  const policiesBefore = await scalar(
    "select jsonb_agg(to_jsonb(p)order by p.schemaname,p.tablename,p.policyname)value from pg_policies p",
  );
  const dataSnapshot = () =>
    scalar(
      "select jsonb_build_object('memberships',(select jsonb_agg(to_jsonb(m)order by user_id)from public.memberships m),'credentials',(select jsonb_agg(to_jsonb(c)order by area)from private.sensitive_area_credentials c),'finance',(select jsonb_agg(to_jsonb(e)order by id)from public.finance_entries e),'stock',(select count(*)from public.stock_movements),'orders',(select count(*)from public.sales_orders),'grants',(select count(*)from private.area_grants))value",
    );
  const beforeData = await dataSnapshot();
  await db.query(readFileSync(new URL(policyFile, migrationDirectory), "utf8"));
  eq(
    await dataSnapshot(),
    beforeData,
    "La migrazione non cambia credenziali, ruoli, grant, scorte o movimenti",
  );
  eq(
    await scalar(
      "select jsonb_agg(jsonb_build_array(p.oid::text,p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text)order by p.oid)value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and p.proname in('sensitive_area_status','unlock_sensitive_area','lock_sensitive_area','configure_sensitive_password','can_finance','can_audit','finance_revision_live_access','shop_payment_finance_access','is_founder')",
    ),
    oldFunctions,
    "Tutti gli altri gate e la gestione delle password restano identici",
  );
  eq(
    await scalar(
      "select jsonb_agg(to_jsonb(p)order by p.schemaname,p.tablename,p.policyname)value from pg_policies p",
    ),
    policiesBefore,
    "Nessuna policy RLS viene rimossa o riscritta",
  );
  const value = async (who, sql, args = [], options = {}) =>
    (await as(who, sql, args, options))[0].value;
  const status = (who, area, options = {}) =>
    value(who, "select public.sensitive_area_status($1)value", [area], options);
  const unlock = (who, area, password, options = {}) =>
    value(who, "select public.unlock_sensitive_area($1,$2)value", [area, password], options);
  const active = names.filter((name) => !["inactive", "outsider"].includes(name));
  let expectedEntries = 1;
  for (const name of active) {
    eq(await status(name, "finance"), false, `${name}: niente Finance prima della password`);
    eq(await status(name, "audit"), false, `${name}: niente CEO prima della password`);
    eq(
      Number(await value(name, "select count(*)value from public.finance_entries")),
      0,
      `${name}: RLS Finance chiusa`,
    );
    await rejected(
      as(name, "select public.ceo_activity_feed()"),
      "42501",
      `${name}: RPC CEO chiusa senza password`,
    );
    eq(
      (await unlock(name, "finance", "incorrect-synthetic-password")).status,
      "denied",
      `${name}: password errata negata`,
    );
    const financeGrant = await unlock(name, "finance", financePassword);
    eq(
      financeGrant.status,
      "unlocked",
      `${name}: password Finance corretta ammessa senza finance_access`,
    );
    ok(
      Date.parse(financeGrant.expires_at) > Date.now() + 7.99 * 60 * 60 * 1000 &&
        Date.parse(financeGrant.expires_at) < Date.now() + 8.01 * 60 * 60 * 1000,
      "La durata esistente resta otto ore",
    );
    eq(await status(name, "finance"), true, `${name}: grant Finance leggibile nella sessione`);
    eq(await status(name, "audit"), false, `${name}: Finance non sblocca CEO`);
    eq(
      Number(await value(name, "select count(*)value from public.finance_entries")),
      expectedEntries,
      `${name}: RLS usa il grant effettivo`,
    );
    eq(
      (await unlock(name, "audit", auditPassword)).status,
      "unlocked",
      `${name}: password CEO ammessa a ogni membro attivo`,
    );
    eq(await status(name, "audit"), true, `${name}: CEO aperto solo dopo la propria password`);
    const feedPage = await value(name, "select public.ceo_activity_feed()value");
    ok(Array.isArray(feedPage.items), `${name}: feed CEO reale leggibile`);
    eq(
      await value(name, "select private.is_founder()value"),
      name === "founder",
      `${name}: privilegi founder indipendenti dal grant aree`,
    );
    await rejected(
      as(name, "select public.configure_sensitive_password('finance',$1)", [
        "unauthorized-synthetic-password",
      ]),
      "42501",
      `${name}: conoscere la password non permette di cambiarla`,
    );
    const added = await rpc(
      "record_finance_entry",
      {
        schema_version: 1,
        entry_date: await today(),
        entry_type: "expense",
        amount_cents: 321,
        description: "Spesa sintetica",
        not_duplicate_confirmed: true,
        account_label: "Cash",
        category: "Eventi",
      },
      name,
    );
    ok(
      typeof added.entry_id === "string",
      `${name}: comando Finance reale consentito dopo sblocco`,
    );
    expectedEntries++;
  }
  eq(
    await value("founder", "select private.can_finance()value"),
    true,
    "Helper Finance comune ancora protetto da grant",
  );
  for (const name of ["inactive", "outsider"]) {
    for (const [area, password] of [
      ["finance", financePassword],
      ["audit", auditPassword],
    ]) {
      eq(
        (await unlock(name, area, password)).status,
        "denied",
        `${name}: password corretta non sostituisce membership attiva`,
      );
      eq(await status(name, area), false, `${name}: nessuno stato area senza membership`);
    }
    eq(
      Number(await value(name, "select count(*)value from public.finance_entries")),
      0,
      `${name}: dati Finance invisibili`,
    );
    await rejected(
      as(name, "select public.ceo_activity_feed()"),
      "42501",
      `${name}: nessuna RPC CEO`,
    );
  }
  await db.query(
    "insert into private.area_grants(session_id,user_id,area,credential_version,expires_at)select $1,$2,area,version,now()+interval '8 hours'from private.sensitive_area_credentials",
    [sessions.inactive, users.inactive],
  );
  eq(
    await status("inactive", "finance"),
    false,
    "Un grant preesistente non supera la membership disattivata",
  );
  eq(
    await status("inactive", "audit"),
    false,
    "Un grant CEO preesistente non supera la membership disattivata",
  );
  for (const area of ["other", null, "/finance"]) {
    eq(await status("consultant", area), false, "Le destinazioni non ammesse restano chiuse");
    eq(
      (await unlock("consultant", area, financePassword)).status,
      "denied",
      "Nessuna nuova area arbitraria",
    );
  }
  const alternate = randomUUID();
  await db.query("insert into auth.sessions(id,user_id)values($1,$2)", [
    alternate,
    users.consultant,
  ]);
  eq(
    await status("consultant", "finance", { sid: alternate }),
    false,
    "Il grant non passa a una seconda sessione",
  );
  eq(
    (await unlock("consultant", "finance", financePassword, { sid: alternate })).status,
    "unlocked",
    "Password ripresentata sulla seconda sessione",
  );
  eq(
    await value("consultant", "select public.lock_sensitive_area('finance')value", [], {
      sid: alternate,
    }),
    true,
    "Chiusura del solo grant di questa sessione",
  );
  eq(await status("consultant", "finance", { sid: alternate }), false, "Seconda sessione richiusa");
  eq(await status("consultant", "finance"), true, "La prima sessione resta autonoma");
  await db.query("update public.memberships set active=false where user_id=$1", [users.consultant]);
  eq(
    await status("consultant", "finance"),
    false,
    "Revoca membership nega immediatamente Finance già aperta",
  );
  eq(
    await status("consultant", "audit"),
    false,
    "Revoca membership nega immediatamente CEO già aperto",
  );
  await rejected(
    as("consultant", "select public.ceo_activity_feed()"),
    "42501",
    "CEO chiuso dopo revoca",
  );
  await db.query("update public.memberships set active=true where user_id=$1", [users.consultant]);
  await db.query(
    "update public.memberships set role='logistics',finance_access=false where user_id=$1",
    [users.production],
  );
  eq(
    await status("production", "finance"),
    true,
    "Cambio ruolo operativo non revoca una password valida",
  );
  eq(
    await status("production", "audit"),
    true,
    "CEO dipende da password e membro attivo, non dal ruolo",
  );
  await db.query(
    "update private.area_grants set expires_at=clock_timestamp()-interval '1 second'where user_id=$1 and area='finance'",
    [users.logistics],
  );
  eq(await status("logistics", "finance"), false, "Il grant scaduto resta negato");
  eq(await status("logistics", "audit"), true, "Scadenza isolata dell'area Finance");
  await db.query(
    "update auth.sessions set not_after=clock_timestamp()-interval '1 second'where id=$1",
    [sessions.finance],
  );
  eq(await status("finance", "finance"), false, "Sessione Auth scaduta nega Finance");
  eq(await status("finance", "audit"), false, "Sessione Auth scaduta nega CEO");
  eq(
    (await unlock("finance", "finance", financePassword)).status,
    "denied",
    "Sessione scaduta non rinnova il grant",
  );
  eq(
    await status("consultant", "finance", { sid: sessions.founder }),
    false,
    "La sessione di un altro utente non si trasferisce",
  );
  const rotated = "synthetic-finance-rotated";
  eq(
    await configure("finance", rotated),
    true,
    "Rotazione consentita solo dal canale amministrativo esistente",
  );
  eq(
    await status("founder", "finance"),
    false,
    "La rotazione invalida anche i grant founder precedenti",
  );
  eq(await status("consultant", "audit"), true, "Rotazione Finance preserva password/grant CEO");
  eq(
    (await unlock("consultant", "finance", financePassword)).status,
    "denied",
    "Password Finance precedente non valida dopo rotazione",
  );
  eq(
    (await unlock("consultant", "finance", rotated)).status,
    "unlocked",
    "Nuova password ammessa al membro attivo",
  );
  for (let attempt = 1; attempt <= 5; attempt++)
    eq(
      (await unlock("logistics", "finance", "incorrect-synthetic-password")).status,
      attempt === 5 ? "locked" : "denied",
      "Contatore tentativi esistente conservato",
    );
  eq(
    (await unlock("logistics", "finance", rotated)).status,
    "locked",
    "Password corretta non supera il blocco tentativi",
  );
  eq(
    (await unlock("logistics", "finance", rotated, { sid: alternate })).status,
    "denied",
    "Sessione di altro utente non aggira limiti",
  );
  eq(
    (await unlock("founder", "finance", rotated)).status,
    "unlocked",
    "I tentativi di un utente non bloccano un altro membro",
  );
  await db.query("delete from auth.sessions where id=$1", [sessions.consultant]);
  eq(
    await status("consultant", "finance"),
    false,
    "Logout invalida Finance nonostante grant ancora presente",
  );
  eq(
    await status("consultant", "audit"),
    false,
    "Logout invalida CEO nonostante grant ancora presente",
  );
  eq(
    (await unlock("consultant", "audit", auditPassword)).status,
    "denied",
    "Logout non può ricreare il grant",
  );
  await rejected(
    as("outsider", "select public.ceo_activity_feed()", [], { sid: sessions.founder }),
    "42501",
    "Metadati founder simulati non creano appartenenza o grant",
  );
  await rejected(
    as("founder", "select public.unlock_sensitive_area('finance',$1)", [rotated], { role: "anon" }),
    "42501",
    "Nessun accesso anonimo alla RPC password",
  );
  for (const signature of [
    "private.sensitive_area_eligible(text)",
    "private.configure_sensitive_password(text,text)",
  ])
    eq(
      await scalar("select has_function_privilege('authenticated',$1,'EXECUTE')value", [signature]),
      false,
      "Nessuna esecuzione diretta di helper/gestione credenziali",
    );
  for (const table of [
    "private.sensitive_area_credentials",
    "private.area_grants",
    "private.area_password_attempts",
  ])
    await rejected(
      as("founder", `select * from ${table}`),
      "42501",
      "Credenziali, grant e contatori restano privati anche dopo sblocco",
    );
  console.log(
    `PASS ${checks} controlli: aree Finance/CEO per ogni membro attivo, password, sessione e RLS.`,
  );
} finally {
  for (const client of clients)
    try {
      await client.end();
    } catch {}
  if (started)
    try {
      command("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
    } catch {}
  rmSync(directory, { recursive: true, force: true });
}
