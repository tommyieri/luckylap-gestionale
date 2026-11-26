// test-db: postgres minimo 194
// PostgreSQL 17 reale: tutte le migrazioni, lease concorrenti e fonti/revisioni Finance.
// Solo interfacce Auth/Storage/estensioni Supabase hanno stand-in. Dati sintetici, nessun HTTP.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const [bin, modulePath] = process.argv.slice(2);
if (!bin?.startsWith("/") || !modulePath?.startsWith("/"))
  throw Error("Servono percorsi locali assoluti per PostgreSQL 17 e pg; nessun DSN.");
const imported = await import(pathToFileURL(modulePath).href);
const Client = imported.Client ?? imported.default.Client;
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
const temporary = mkdtempSync("/private/tmp/luckylap-packlink-finance-");
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
const clients = [];
const users = { finance: randomUUID(), logistics: randomUUID(), outsider: randomUUID() };
const sessions = Object.fromEntries(Object.keys(users).map((name) => [name, randomUUID()]));
const connectionId = randomUUID();
const clientId = "synthetic-client";
const shop = "synthetic-packlink.myshopify.com";
const cutover = "2030-10-20T22:00:00.123456Z";
const current = "2030-11-02T23:30:00Z";
let owner;
let started = false;
let checks = 0;
const eq = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const ok = (value, label) => {
  assert.ok(value, label);
  checks++;
};
const scalar = async (db, sql, args = []) => (await db.query(sql, args)).rows[0].value;
async function connect(label) {
  const db = new Client({
    host: socket,
    port,
    user: "postgres",
    database: "postgres",
    ssl: false,
    application_name: `packlink-synthetic-${label}`,
    statement_timeout: 15000,
    query_timeout: 20000,
  });
  db.on("error", () => {});
  await db.connect();
  clients.push(db);
  return db;
}
async function begin(db, role = "service_role", name) {
  await db.query("begin");
  if (name)
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: users[name], session_id: sessions[name], role: "service_role" }),
    ]);
  await db.query(`set local role ${role}`);
}
async function as(db, sql, args = [], role = "service_role", name) {
  await begin(db, role, name);
  try {
    const result = await db.query(sql, args);
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
const claimSql = "select public.claim_packlink_sync($1,$2) value";
const claim = async (db = owner, seconds = 120) =>
  (await as(db, claimSql, [randomUUID(), seconds])).rows[0].value;
const apply = async (lease, payload, db = owner) =>
  (
    await as(db, "select public.apply_packlink_transactions($1,$2,$3::jsonb) value", [
      lease.connection_id,
      lease.lease_token,
      JSON.stringify(payload),
    ])
  ).rows[0].value;
const finish = async (lease, outcome, reason) =>
  (
    await as(owner, "select public.finish_packlink_sync($1,$2,$3,$4) value", [
      lease.connection_id,
      lease.lease_token,
      outcome,
      reason,
    ])
  ).rows[0].value;
const tx = (id, extra = {}) => ({
  provider_transaction_id: id,
  provider_type: "LABELS_ORDER",
  amount_cents: 1234,
  currency: "EUR",
  occurred_at: current,
  shipment_references: ["SYNTHETIC_REF"],
  shopify_order_gid: null,
  ...extra,
});
const payload = (transactions, extra = {}) => ({
  schema_version: 1,
  client_id: clientId,
  transactions,
  ...extra,
});
const resetLease = async () => {
  await owner.query(
    "update private.packlink_sync_state set lease_expires_at=clock_timestamp()-interval '1 second',next_attempt_at='-infinity' where lease_token is not null",
  );
  await owner.query("update private.packlink_sync_state set next_attempt_at='-infinity'");
};
const count = () => scalar(owner, "select count(*)::int value from public.packlink_transactions");
const status = async (name = "finance") =>
  (await as(owner, "select public.get_packlink_sync_status() value", [], "authenticated", name))
    .rows[0].value;
async function waitBlocked(observer, waiter, blocker) {
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    const row = (
      await observer.query(
        "select wait_event_type,pg_blocking_pids($1) blockers from pg_stat_activity where pid=$1",
        [waiter],
      )
    ).rows[0];
    if (row?.wait_event_type === "Lock" && row.blockers.includes(blocker)) {
      checks++;
      return;
    }
    await new Promise((done) => setTimeout(done, 15));
  }
  throw Error("Non osservata la contesa reale fra le due sessioni PostgreSQL.");
}

try {
  command("initdb", [
    "-D",
    data,
    "-L",
    resolve(bin, "../share/postgresql"),
    "--username=postgres",
    "--no-locale",
    "--encoding=UTF8",
    "--auth-local=trust",
    "--auth-host=reject",
  ]);
  command("pg_ctl", [
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
  owner = await connect("observer");
  const a = await connect("a");
  const b = await connect("b");
  await owner.query(`
    create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
    create schema extensions;create extension pgcrypto with schema extensions;
    create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
    create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid()returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role;
    create schema storage;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;grant select,insert,update,delete on storage.objects to authenticated;
    create schema vault;create table vault.secrets(id uuid primary key,name text,decrypted_secret text);create view vault.decrypted_secrets as select * from vault.secrets;
    create schema cron;create table cron.job(jobid bigint,jobname text,username text,schedule text,command text,active boolean);
    create schema net;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
  `);
  const migrationDirectory = new URL("../migrations/", import.meta.url);
  const files = readdirSync(migrationDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    let source = readFileSync(new URL(file, migrationDirectory), "utf8");
    assert.ok(source.trim(), `Migrazione vuota: ${file}`);
    source = source.replace(
      /^create extension if not exists (?:pg_cron|pg_net|supabase_vault) with schema [a-z_]+;$/gm,
      "-- Solo l'estensione Supabase esterna usa l'interfaccia sintetica sopra.",
    );
    try {
      await owner.query(source);
    } catch (error) {
      throw Error(`Migrazione ${file}: ${error.message}`, { cause: error });
    }
  }
  ok(
    files.includes("20261126115621_packlink_finance_sync.sql"),
    "Nuova migrazione nella catena completa",
  );
  for (const name of Object.keys(users)) {
    await owner.query("insert into auth.users values($1)", [users[name]]);
    await owner.query("insert into auth.sessions values($1,$2,null)", [
      sessions[name],
      users[name],
    ]);
    if (name !== "outsider") {
      await owner.query("insert into public.profiles(user_id,display_name) values($1,$2)", [
        users[name],
        `Membro sintetico ${name}`,
      ]);
      await owner.query(
        "insert into public.memberships(user_id,role,finance_access) values($1,$2,$3)",
        [users[name], name, name === "finance"],
      );
    }
  }
  await owner.query(
    "insert into private.sensitive_area_credentials(area,password_hash) values('finance',extensions.crypt('synthetic-password',extensions.gen_salt('bf',10)))",
  );
  const statusKeys = [
    "configured",
    "enabled",
    "last_attempt_at",
    "last_success_at",
    "outcome",
    "reason",
    "counts",
  ].sort();
  await rejected(status(), "42501", "Status negato senza password Finance");
  eq(
    (
      await as(
        owner,
        "select public.unlock_sensitive_area('finance','synthetic-password') value",
        [],
        "authenticated",
        "finance",
      )
    ).rows[0].value.status,
    "unlocked",
    "Gate Finance reale",
  );
  eq(await claim(), null, "Non configurato: nessuna lease");
  eq(
    await status(),
    {
      configured: false,
      enabled: false,
      last_attempt_at: null,
      last_success_at: null,
      outcome: null,
      reason: null,
      counts: { inserted: 0, replayed: 0, ignored: 0 },
    },
    "Status non configurato senza identità o dati",
  );

  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const table of ["private.packlink_sync_configuration", "private.packlink_sync_state"])
      eq(
        await scalar(owner, "select has_table_privilege($1,$2,'SELECT') value", [role, table]),
        false,
        `${role} non legge ${table}`,
      );
    for (const operation of ["INSERT", "UPDATE", "DELETE"])
      eq(
        await scalar(
          owner,
          "select has_table_privilege($1,'public.packlink_transactions',$2) value",
          [role, operation],
        ),
        false,
        `${role}: nessun DML diretto sulla fonte`,
      );
  }
  for (const fn of [
    "claim_packlink_sync(uuid,integer)",
    "apply_packlink_transactions(uuid,uuid,jsonb)",
    "finish_packlink_sync(uuid,uuid,text,text)",
  ]) {
    for (const role of ["anon", "authenticated"])
      eq(
        await scalar(owner, "select has_function_privilege($1,$2,'EXECUTE') value", [
          role,
          `public.${fn}`,
        ]),
        false,
        `${role} non chiama ${fn}`,
      );
    eq(
      await scalar(owner, "select has_function_privilege('service_role',$1,'EXECUTE') value", [
        `public.${fn}`,
      ]),
      true,
      `service_role chiama ${fn}`,
    );
  }
  await owner.query(
    "grant execute on function public.claim_packlink_sync(uuid,integer),private.claim_packlink_sync(uuid,integer) to authenticated",
  );
  await rejected(
    as(owner, claimSql, [randomUUID(), 120], "authenticated", "finance"),
    "42501",
    "JWT service_role contraffatto non sostituisce il ruolo SQL",
  );
  await owner.query(
    "revoke execute on function public.claim_packlink_sync(uuid,integer),private.claim_packlink_sync(uuid,integer) from authenticated",
  );
  await owner.query(
    "insert into private.packlink_sync_configuration(connection_id,expected_client_id,shop_domain,cutover_at) values($1,$2,$3,$4)",
    [connectionId, clientId, shop, cutover],
  );
  eq(await claim(), null, "Configurazione inizialmente disabilitata");
  eq((await status()).enabled, false, "Status disabilitato");
  for (const seconds of [null, 29, 901])
    await rejected(as(owner, claimSql, [randomUUID(), seconds]), "22023", "Limite lease validato");
  await rejected(as(owner, claimSql, [null, 120]), "22023", "Worker obbligatorio");
  await owner.query("update private.packlink_sync_configuration set enabled=true");

  const aPid = await scalar(a, "select pg_backend_pid() value");
  const bPid = await scalar(b, "select pg_backend_pid() value");
  ok(aPid !== bPid, "Sessioni PostgreSQL indipendenti");
  await begin(a);
  const firstLease = (await a.query(claimSql, [randomUUID(), 120])).rows[0].value;
  const waiting = claim(b);
  await waitBlocked(owner, bPid, aPid);
  await a.query("commit");
  eq(await waiting, null, "Un solo claim concorrente vince");
  eq(firstLease.connection_id, connectionId, "Binding connessione");
  eq(firstLease.expected_client_id, clientId, "Binding account");
  eq(firstLease.shop_domain, shop, "Binding shop");
  eq(
    await scalar(owner, "select ($1::timestamptz=$2::timestamptz) value", [
      firstLease.cutover_at,
      cutover,
    ]),
    true,
    "Cutover con microsecondi preservati",
  );
  eq((await status()).outcome, "running", "Health in corso");
  await rejected(
    apply({ ...firstLease, lease_token: randomUUID() }, payload([])),
    "22023",
    "Token errato non applica",
  );
  await rejected(
    apply({ ...firstLease, connection_id: randomUUID() }, payload([])),
    "22023",
    "Connessione errata non applica",
  );
  await owner.query(
    "update private.packlink_sync_configuration set expected_client_id='changed-client'",
  );
  await rejected(
    apply(firstLease, payload([])),
    "22023",
    "Binding configurazione modificato invalida apply",
  );
  await owner.query(
    "update private.packlink_sync_configuration set expected_client_id=$1,enabled=false",
    [clientId],
  );
  await rejected(
    apply(firstLease, payload([])),
    "22023",
    "Disable durante la lettura invalida apply",
  );
  await owner.query("update private.packlink_sync_configuration set enabled=true");
  await resetLease();
  const lease = await claim();
  await rejected(apply(firstLease, payload([])), "22023", "Lease vecchia dopo reclaim non applica");
  eq(await count(), 0, "Nessun effetto da lease invalide");
  const accepted = [
    tx("OLD", { occurred_at: "2030-10-20T22:00:00.123455Z" }),
    tx("BOUNDARY", { occurred_at: cutover, shipment_references: [] }),
    tx("CHARGE", {
      shipment_references: ["REF_B", "REF_A"],
      shopify_order_gid: "gid://shopify/Order/123",
    }),
    tx("CREDIT", { provider_type: "REFUND", amount_cents: 456, shipment_references: ["REF_A"] }),
    tx("MANUAL", { amount_cents: 789, shipment_references: ["MANUAL_REF"] }),
  ];
  eq(
    await apply(lease, payload(accepted)),
    { status: "applied", inserted: 4, replayed: 0, ignored: 1, reason: null },
    "Addebiti, rimborso e spedizione manuale; storico ignorato",
  );
  eq(await count(), 4, "Una riga per transazione ammessa");
  const originals = (
    await owner.query("select * from public.packlink_transactions order by provider_transaction_id")
  ).rows;
  const charge = originals.find((row) => row.provider_transaction_id === "CHARGE");
  const credit = originals.find((row) => row.provider_transaction_id === "CREDIT");
  eq(charge.kind, "shipping_charge", "Addebito distinto");
  eq(credit.kind, "shipping_refund", "Rimborso distinto");
  eq(credit.amount_cents, "456", "Centesimi positivi senza arrotondamenti");
  eq(charge.shop_domain, shop, "Shop da config, non da payload");
  eq(charge.shipment_references, ["REF_A", "REF_B"], "Riferimenti canonici senza semantica ordine");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.packlink_transactions where provider_transaction_id='OLD'",
    ),
    0,
    "Un microsecondo prima non entra",
  );
  const health = await status();
  eq(Object.keys(health).sort(), statusKeys, "Status coarse esatto");
  eq(health.counts, { inserted: 4, replayed: 0, ignored: 1 }, "Contatori senza dati finanziari");
  ok(health.last_attempt_at && health.last_success_at, "Tentativo e successo persistiti");
  eq(health.outcome, "applied", "Health successo");

  const replayLease = await claim();
  const enrichedReplay = structuredClone(accepted);
  enrichedReplay[2].shopify_order_gid = null;
  enrichedReplay[2].shipment_references.reverse();
  enrichedReplay[1].occurred_at = "2030-10-20T22:00:00.123456000Z";
  eq(
    await apply(replayLease, payload(enrichedReplay)),
    { status: "applied", inserted: 0, replayed: 4, ignored: 1, reason: null },
    "Risposta persa: replay senza duplicare, enrichment escluso dal digest",
  );
  eq(
    (await owner.query("select * from public.packlink_transactions where id=$1", [charge.id]))
      .rows[0],
    charge,
    "Originale/UUID/observed_at/gid invariati nel replay",
  );

  for (const change of [
    { amount_cents: 1235 },
    { provider_type: "REFUND" },
    { occurred_at: "2030-11-02T23:30:01Z" },
    { shipment_references: ["OTHER_REF"] },
    { occurred_at: "2030-01-01T00:00:00Z" },
  ]) {
    await resetLease();
    const conflictLease = await claim();
    eq(
      await apply(conflictLease, payload([tx("NEW_BEFORE_CONFLICT"), tx("CHARGE", change)])),
      {
        status: "review",
        inserted: 0,
        replayed: 0,
        ignored: 0,
        reason: "packlink_transaction_conflict",
      },
      "Conflitto rifiuta batch intero",
    );
    eq(await count(), 4, "Nessuna riga nuova prima del conflitto");
  }
  await resetLease();
  eq(
    await apply(await claim(), payload([tx("DUPLICATE"), tx("DUPLICATE")])),
    { status: "applied", inserted: 1, replayed: 1, ignored: 0, reason: null },
    "Duplicato identico nello stesso batch non duplica",
  );
  await resetLease();
  eq(
    await apply(
      await claim(),
      payload([tx("UNWRITTEN"), tx("DIFF"), tx("DIFF", { amount_cents: 99 })]),
    ),
    {
      status: "review",
      inserted: 0,
      replayed: 0,
      ignored: 0,
      reason: "packlink_transaction_conflict",
    },
    "Duplicato discordante nella stessa risposta blocca tutto",
  );
  eq(await count(), 5, "Conteggio dopo conflitto interno");
  const invalidRows = [
    { provider_transaction_id: "" },
    { provider_transaction_id: "SYNTHETIC/TX" },
    { provider_transaction_id: "!INVALID" },
    { provider_transaction_id: "X".repeat(121) },
    { provider_type: "OTHER" },
    { provider_type: null },
    { amount_cents: 0 },
    { amount_cents: -1 },
    { amount_cents: "1234" },
    { amount_cents: 1.5 },
    { amount_cents: 9000000000000001 },
    { currency: "USD" },
    { currency: null },
    { occurred_at: "2030-02-30T00:00:00Z" },
    { occurred_at: "2030-11-02T23:30:00+00:00" },
    { occurred_at: "2030-11-02T23:30:00.1234567Z" },
    { occurred_at: "infinity" },
    { occurred_at: null },
    { shipment_references: null },
    { shipment_references: ["DUP", "DUP"] },
    { shipment_references: ["invalid@example.test"] },
    { shipment_references: Array.from({ length: 21 }, (_, i) => `REF_${i}`) },
    { shipment_references: ["R".repeat(101)] },
    { shipment_references: [null] },
    { shopify_order_gid: "gid://shopify/Product/1" },
    { shopify_order_gid: "gid://shopify/Order/0" },
    { shopify_order_gid: "gid://shopify/Order/18446744073709551616" },
    { recipient: "Campo non ammesso" },
  ];
  const invalidPayloads = invalidRows.map((change) =>
    payload([tx("NEW_VALID"), tx("INVALID", change)]),
  );
  const missing = tx("MISSING");
  delete missing.currency;
  invalidPayloads.push(
    payload([missing]),
    null,
    [],
    payload([], { extra: true }),
    payload([], { schema_version: 2 }),
    payload([], { client_id: null }),
    payload([], { client_id: "C".repeat(129) }),
    payload([], { transactions: null }),
    payload(Array.from({ length: 1001 }, (_, i) => tx(`OVER_${i}`))),
  );
  for (const invalid of invalidPayloads) {
    await resetLease();
    const result = await apply(await claim(), invalid);
    eq(
      result,
      {
        status: "review",
        inserted: 0,
        replayed: 0,
        ignored: 0,
        reason: "invalid_packlink_payload",
      },
      "Payload invalido rifiutato integralmente",
    );
    eq(await count(), 5, "Payload invalido senza effetti parziali");
  }
  await resetLease();
  eq(
    await apply(
      await claim(),
      payload([tx("WRONG_ACCOUNT")], { client_id: "other-synthetic-client" }),
    ),
    { status: "review", inserted: 0, replayed: 0, ignored: 0, reason: "packlink_client_mismatch" },
    "Account diverso non entra",
  );
  eq(await claim(), null, "Review applicativa attende cooldown");
  await resetLease();
  const failedLease = await claim();
  await rejected(
    finish(failedLease, "retry", "Error https://example.test"),
    "22023",
    "Errore non sanitizzato rifiutato",
  );
  await rejected(
    finish(failedLease, "applied", "invalid"),
    "22023",
    "Finish non può dichiarare successo",
  );
  await rejected(
    finish({ ...failedLease, lease_token: randomUUID() }, "retry", "network_error"),
    "22023",
    "Finish non rilascia un token diverso",
  );
  eq(
    await finish(failedLease, "retry", "network_error"),
    { status: "retry", inserted: 0, replayed: 0, ignored: 0, reason: "network_error" },
    "Finish retry sanitizzato e controllato",
  );
  eq(await claim(), null, "Retry attende cooldown");
  await resetLease();
  eq(
    await finish(await claim(), "review", "api_unauthorized"),
    { status: "review", inserted: 0, replayed: 0, ignored: 0, reason: "api_unauthorized" },
    "Review mantiene autonomia dopo cooldown",
  );
  await resetLease();
  const expiredLease = await claim();
  await resetLease();
  eq((await status()).reason, "lease_expired", "Health non resta running dopo scadenza");
  await rejected(
    apply(expiredLease, payload([tx("EXPIRED")])),
    "22023",
    "Lease scaduta non applica",
  );
  await rejected(
    finish(expiredLease, "review", "expired"),
    "22023",
    "Lease scaduta non rilascia stato",
  );
  eq(
    await apply(await claim(), payload([])),
    { status: "applied", inserted: 0, replayed: 0, ignored: 0, reason: null },
    "Batch vuoto valido aggiorna successo",
  );

  for (const name of ["logistics", "outsider"])
    eq(
      (await as(owner, "select id from public.packlink_transactions", [], "authenticated", name))
        .rowCount,
      0,
      "RLS senza accesso Finance",
    );
  await rejected(status("logistics"), "42501", "Status negato a ruolo senza Finance");
  eq(
    (await as(owner, "select id from public.packlink_transactions", [], "authenticated", "finance"))
      .rowCount,
    5,
    "Fonte leggibile solo con Finance aperta",
  );
  await owner.query("update public.memberships set active=false where user_id=$1", [users.finance]);
  eq(
    (await as(owner, "select id from public.packlink_transactions", [], "authenticated", "finance"))
      .rowCount,
    0,
    "Revoca ruolo effettiva sulle fonti",
  );
  await rejected(status(), "42501", "Revoca effettiva sullo status");
  await owner.query("update public.memberships set active=true where user_id=$1", [users.finance]);

  const original = (
    await as(
      owner,
      "select public.read_finance_revision_source('packlink',$1) value",
      [charge.id],
      "authenticated",
      "finance",
    )
  ).rows[0].value;
  eq(original.order_id, null, "Revisioni Packlink non ricalcolano Sales");
  eq(original.values.account, null, "Nessuna banca presunta");
  eq(original.values.date, "2030-11-03", "Data Finance nel giorno di Roma");
  eq(original.values.direction, "expense", "Fonte addebito come uscita");
  eq(original.values.category, "Spedizioni", "Categoria costo vettore");
  const refundOriginal = (
    await as(
      owner,
      "select public.read_finance_revision_source('packlink',$1) value",
      [credit.id],
      "authenticated",
      "finance",
    )
  ).rows[0].value;
  eq(refundOriginal.values.direction, "income", "Fonte rimborso come entrata distinta");
  const revision = async (version, action, extra = {}) =>
    (
      await as(
        owner,
        "select public.revise_finance_movement($1,$2::jsonb) value",
        [
          randomUUID(),
          JSON.stringify({
            schema_version: 1,
            source_kind: "packlink",
            source_id: charge.id,
            expected_version: version,
            action,
            reason: "Correzione sintetica",
            ...extra,
          }),
        ],
        "authenticated",
        "finance",
      )
    ).rows[0].value;
  eq(
    (
      await revision(0, "update", {
        values: { ...original.values, amount_cents: 4321, account: "Conto sintetico" },
      })
    ).version,
    1,
    "Correzione append-only nuova fonte",
  );
  await rejected(revision(0, "delete"), "22023", "CAS rifiuta versione obsoleta");
  eq((await revision(1, "delete")).version, 2, "Eliminazione applicativa conserva fonte");
  eq(
    (await revision(2, "restore", { restore_version: 0 })).version,
    3,
    "Ripristino fonte originale",
  );
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.finance_movement_revisions where source_kind='packlink'",
    ),
    3,
    "Storico completo",
  );
  await resetLease();
  eq(
    (await apply(await claim(), payload([accepted[2]]))).replayed,
    1,
    "Reimport dopo revisione recupera stessa fonte",
  );
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.finance_movement_revisions where source_kind='packlink'",
    ),
    3,
    "Reimport non modifica le revisioni umane",
  );
  eq(
    (await owner.query("select * from public.packlink_transactions where id=$1", [charge.id]))
      .rows[0],
    charge,
    "Fonte preservata dopo update/delete/restore",
  );
  await resetLease();
  const opaqueResult = await apply(
    await claim(),
    payload([
      tx("SYNTHETIC-TX:OPAQUE", {
        occurred_at: "2030-11-02T23:30:00.000000000Z",
        shopify_order_gid: "gid://shopify/Order/18446744073709551615",
      }),
    ]),
  );
  eq(opaqueResult.inserted, 1, "ID opaco ristretto e UINT64 massimo compatibili con client");
  eq(
    await scalar(
      owner,
      "select shopify_order_gid value from public.packlink_transactions where provider_transaction_id='SYNTHETIC-TX:OPAQUE'",
    ),
    "gid://shopify/Order/18446744073709551615",
    "GID UINT64 preservato",
  );
  const attachmentArgs = [
    "packlink",
    charge.id,
    "ricevuta-sintetica.pdf",
    "application/pdf",
    123,
    "a".repeat(64),
  ];
  const attach = async () =>
    (
      await as(
        owner,
        "select public.prepare_finance_movement_attachment($1,$2,$3,$4,$5,$6) value",
        attachmentArgs,
        "authenticated",
        "finance",
      )
    ).rows[0].value;
  const attachment = await attach();
  ok(attachment.id, "Allegato PDF ammesso su Packlink");
  eq(await attach(), attachment, "Allegato idempotente per hash");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.finance_movement_attachments where source_kind='packlink'",
    ),
    1,
    "Nessun allegato duplicato",
  );
  await rejected(
    as(
      owner,
      "select public.finish_finance_movement_attachment($1)",
      [attachment.id],
      "authenticated",
      "finance",
    ),
    "22023",
    "Allegato non pronto senza bytes verificati",
  );
  let updateError;
  try {
    await owner.query("update public.packlink_transactions set amount_cents=1 where id=$1", [
      charge.id,
    ]);
  } catch (error) {
    updateError = error;
  }
  ok(updateError, "Anche il proprietario non riscrive la fonte");
  let deleteError;
  try {
    await owner.query("delete from public.packlink_transactions where id=$1", [charge.id]);
  } catch (error) {
    deleteError = error;
  }
  ok(deleteError, "Anche il proprietario non elimina la fonte");
  eq(await count(), 6, "Ledger immutabile dopo tutti i percorsi");
  await resetLease();
  eq(
    (
      await apply(
        await claim(),
        payload(Array.from({ length: 1000 }, (_, index) => tx(`LIMIT_${index}`))),
      )
    ).inserted,
    1000,
    "Limite massimo 1000 transazioni applicabile in un batch",
  );
  eq(await count(), 1006, "Batch al limite senza perdita di righe");
  console.log(`PASS ${checks} controlli Packlink/Finance su PostgreSQL 17 reale`);
} finally {
  for (const client of clients) await client.end().catch(() => {});
  if (started) command("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  rmSync(temporary, { recursive: true, force: true });
}
