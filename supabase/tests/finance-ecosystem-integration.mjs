// test-db: postgres minimo 95
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
const directory = mkdtempSync("/private/tmp/luckylap-finance-integration-"),
  data = join(directory, "data"),
  socket = join(directory, "socket");
mkdirSync(socket, { mode: 0o700 });
const clients = [],
  names = ["founder", "production", "finance", "logistics", "consultant", "outsider"],
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
  for (const file of files) {
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
  ok(
    files.findIndex((file) => file.endsWith("_consignment_monthly.sql")) <
      files.findIndex((file) => file.endsWith("_finance_revisions.sql")),
    "P3 applicata prima del nucleo P4",
  );
  ok(
    files.findIndex((file) => file.endsWith("_partner_module.sql")) <
      files.findIndex((file) => file.endsWith("_partner_work_links.sql")),
    "P2 applicata prima dei collegamenti P5",
  );
  for (const name of names) {
    await db.query("insert into auth.users values($1)", [users[name]]);
    await db.query("insert into auth.sessions values($1,$2,null)", [sessions[name], users[name]]);
    if (name === "outsider") continue;
    await db.query("insert into public.profiles(user_id,display_name)values($1,$2)", [
      users[name],
      `Membro sintetico ${name}`,
    ]);
    await db.query("insert into public.memberships(user_id,role,finance_access)values($1,$2,$3)", [
      users[name],
      name,
      ["production", "finance"].includes(name),
    ]);
  }
  await db.query(
    "insert into private.sensitive_area_credentials(area,password_hash)select area,extensions.crypt('synthetic-password',extensions.gen_salt('bf',10))from unnest(array['finance','audit'])area",
  );
  const day = await today(),
    at = new Date(Date.now() - 60000).toISOString();
  for (const [name, area] of [
    ["finance", "finance"],
    ["production", "finance"],
    ["founder", "finance"],
    ["founder", "audit"],
  ])
    eq(
      (
        await as(name, "select public.unlock_sensitive_area($1,$2) value", [
          area,
          "synthetic-password",
        ])
      )[0].value.status,
      "unlocked",
      "Sblocco attraverso il gate applicativo reale",
    );
  eq(
    (
      await as("consultant", "select public.unlock_sensitive_area('finance',$1) value", [
        "synthetic-password",
      ])
    )[0].value.status,
    "denied",
  );
  await rejected(
    as("consultant", "select public.ceo_activity_feed()"),
    "42501",
    "Il ruolo dichiarato nei metadati non concede CEO",
  );
  const central = randomUUID(),
    shop = randomUUID(),
    item = randomUUID();
  await db.query(
    "insert into public.stock_locations(id,code,name,location_type)values($1,'SYN-MAG','Magazzino sintetico','Magazzino'),($2,'SYN-LCM','Negozio sintetico','Negozio Conto Vendita')",
    [central, shop],
  );
  await db.query(
    "insert into public.stock_items(id,kind,sku,name,unit_cost_eur,list_price_eur)values($1,'product','SYN-INTEGRATION','Prodotto sintetico',13,80)",
    [item],
  );
  const product = randomUUID();
  await db.query(
    "insert into public.products(id,model,category)values($1,'SYN-INTEGRATION','T-shirt')",
    [product],
  );
  await db.query(
    "insert into public.product_variants(stock_item_id,product_id,color,size)values($1,$2,'Test','M')",
    [item, product],
  );
  await db.query(
    "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,'opening',10,'Apertura sintetica')",
    [randomUUID(), item, central],
  );
  await db.query(
    "update public.app_settings set manual_sales_enabled=true,sales_started_at=now()-interval '1 day'",
  );
  const sale = await rpc(
    "register_manual_sale",
    {
      schema_version: 1,
      channel: "direct",
      occurred_at: at,
      location_id: central,
      lines: [{ stock_item_id: item, quantity: 1, unit_price_cents: 8000, discount_cents: 0 }],
      fulfillment_mode: "prepare",
      payment: { status: "paid", method: "cash", amount_cents: 8000, occurred_at: at },
    },
    "logistics",
  );
  const order = sale.order_id,
    payment = await scalar("select id value from public.order_payments where order_id=$1", [order]),
    raw = await scalar("select to_jsonb(p) value from public.order_payments p where id=$1", [
      payment,
    ]),
    facts = await scalar(
      "select count(*)::int value from public.commercial_facts where order_id=$1",
      [order],
    );
  await rpc(
    "revise_finance_movement",
    revision("payment", payment, 0, "update", { values: values(day, 3000) }),
  );
  let summary = (
    await as("logistics", "select public.read_sales_effective_payments(array[$1::uuid]) value", [
      order,
    ])
  )[0].value[0];
  eq(summary.amount_due_cents, "5000", "Correzione Finance apre il residuo in Vendite");
  eq(summary.payment_state, "partially_paid");
  ok(
    !JSON.stringify(summary).includes("Cash"),
    "La proiezione operativa non espone il conto Finance",
  );
  await rpc(
    "record_manual_payment",
    { order_id: order, amount_cents: 5000, method: "cash", occurred_at: new Date().toISOString() },
    "logistics",
  );
  summary = (
    await as("consultant", "select public.read_sales_effective_payments(array[$1::uuid]) value", [
      order,
    ])
  )[0].value[0];
  eq(summary.amount_due_cents, "0");
  eq(summary.payment_state, "paid");
  eq(
    await scalar("select to_jsonb(p) value from public.order_payments p where id=$1", [payment]),
    raw,
    "Pagamento originale immutato",
  );
  eq(
    await scalar("select count(*)::int value from public.commercial_facts where order_id=$1", [
      order,
    ]),
    facts + 1,
    "Solo il nuovo incasso aggiunge un fatto commerciale",
  );
  await rpc(
    "revise_finance_movement",
    revision("payment", payment, 1, "restore", { restore_version: 0 }),
  );
  summary = (
    await as("logistics", "select public.read_sales_effective_payments(array[$1::uuid]) value", [
      order,
    ])
  )[0].value[0];
  eq(summary.refund_due_cents, "5000", "Ripristino dopo secondo pagamento segnala l'eccedenza");
  await rejected(
    rpc("revise_finance_movement", revision("payment", payment, 2, "delete"), "consultant"),
    "42501",
  );
  await rejected(
    as("outsider", "select public.read_sales_effective_payments(array[$1::uuid])", [order]),
    "42501",
  );

  const manualEntry = randomUUID();
  await db.query(
    "insert into public.finance_entries(id,entry_date,entry_type,amount_eur,description,account_label,category,created_by)values($1,$2,'expense',2.34,'Originale sintetico','Cash','Software',$3)",
    [manualEntry, day, users.finance],
  );
  const manualOriginal = await scalar(
    "select to_jsonb(e) value from public.finance_entries e where id=$1",
    [manualEntry],
  );
  await rpc(
    "revise_finance_movement",
    revision("manual", manualEntry, 0, "update", {
      values: values(day, 345, { direction: "expense", category: "Software" }),
    }),
  );
  eq(
    await scalar("select to_jsonb(e) value from public.finance_entries e where id=$1", [
      manualEntry,
    ]),
    manualOriginal,
    "Riga Finance preesistente conservata immutabile",
  );
  await rejected(
    db.query("update public.finance_entries set amount_eur=99 where id=$1", [manualEntry]),
    "42501",
    "La tabella originale resta append-only anche per il proprietario",
  );

  // Canonical Shopify rows keep the provider observation even when Finance
  // declares different effective values; only the common projection changes.
  const externalOrder = randomUUID(),
    externalPayment = randomUUID(),
    externalRefund = randomUUID();
  await db.query(`create function private.seed_synthetic_integration_shopify()returns void language plpgsql security definer set search_path=''as $$begin
    insert into public.sales_orders(id,operation_id,payload_sha256,channel,occurred_at,operational_date,total_cents,payment_state,fulfillment_mode,fulfillment_state,source_kind)
      values('${externalOrder}','${randomUUID()}','${"a".repeat(64)}','shopify_web',now()-interval '1 hour',((now()-interval '1 hour')at time zone'Europe/Rome')::date,10000,'partially_refunded','prepare','unfulfilled','shopify_canonical');
    insert into public.order_payments(id,operation_id,order_id,source_kind,method,amount_cents,occurred_at)
      values('${externalPayment}','${randomUUID()}','${externalOrder}','shopify_observation','shopify_observed',10000,now()-interval '30 minutes');
    insert into public.shopify_refund_observations(id,operation_id,order_id,transaction_gid,amount_cents,occurred_at)
      values('${externalRefund}','${randomUUID()}','${externalOrder}','gid://shopify/OrderTransaction/990099',2000,now()-interval '10 minutes');end$$;
    revoke all on function private.seed_synthetic_integration_shopify()from public,anon,authenticated;grant execute on function private.seed_synthetic_integration_shopify()to service_role;
    begin;set local role service_role;select private.seed_synthetic_integration_shopify();commit;drop function private.seed_synthetic_integration_shopify();`);
  const observedOrder = await scalar(
      "select to_jsonb(o)value from public.sales_orders o where id=$1",
      [externalOrder],
    ),
    observedPayment = await scalar(
      "select to_jsonb(p)value from public.order_payments p where id=$1",
      [externalPayment],
    ),
    observedRefund = await scalar(
      "select to_jsonb(r)value from public.shopify_refund_observations r where id=$1",
      [externalRefund],
    );
  await rpc(
    "revise_finance_movement",
    revision("payment", externalPayment, 0, "update", { values: values(day, 5000) }),
  );
  const externalSummary = (
    await as("logistics", "select public.read_sales_effective_payments(array[$1::uuid])value", [
      externalOrder,
    ])
  )[0].value[0];
  eq(
    externalSummary.amount_due_cents,
    "7000",
    "Shopify: pagamento corretto e rimborso osservato usano la stessa proiezione",
  );
  eq(externalSummary.source_payment_state, "partially_refunded");
  eq(externalSummary.corrected, true);
  eq(
    await scalar("select to_jsonb(o)value from public.sales_orders o where id=$1", [externalOrder]),
    observedOrder,
    "Stato Shopify originale immutato",
  );
  eq(
    await scalar("select to_jsonb(p)value from public.order_payments p where id=$1", [
      externalPayment,
    ]),
    observedPayment,
    "Incasso Shopify originale immutato",
  );
  eq(
    await scalar("select to_jsonb(r)value from public.shopify_refund_observations r where id=$1", [
      externalRefund,
    ]),
    observedRefund,
    "Rimborso Shopify originale immutato",
  );

  // Actual P2 command produces the P5 reminder and a single P6 action.
  const eventDay = `${Number(day.slice(0, 4)) + 2}-03-28`;
  const partner = await rpc(
    "save_partner",
    {
      schema_version: 1,
      partner_id: null,
      name: "Partner sintetico integrazione",
      sections: ["eventi"],
      priority: "media",
      contact_month: day.slice(0, 8) + "01",
      event_starts_on: eventDay,
      event_ends_on: eventDay,
    },
    "consultant",
  );
  const partnerId = partner.id;
  eq(
    await scalar(
      "select count(*)::int value from public.partner_work_links where partner_id=$1 and kind='event'",
      [partnerId],
    ),
    0,
    "Data Partner senza accordo: nessun evento condiviso",
  );
  const sent = await rpc(
    "record_partner_activity",
    {
      schema_version: 1,
      partner_id: partnerId,
      kind: "inviato",
      channel: "form",
      body: "PRIVATE_SYNTHETIC_BODY",
    },
    "consultant",
  );
  eq(
    await scalar(
      "select count(*)::int value from public.partner_work_links l join public.tasks t on t.id=l.task_id where l.partner_id=$1 and l.kind='follow_up'and t.status='todo'and t.assigned_to=$2",
      [partnerId, users.consultant],
    ),
    1,
    "Sollecito al mittente prodotto dal vero comando P2",
  );
  let actions = (await feed(users.consultant, null)).items;
  const sentActions = actions.filter((entry) => entry.message.includes("invio Partner"));
  eq(sentActions.length, 1, "P2 stato + attività + P5 task diventano un solo invio leggibile");
  ok(
    !JSON.stringify(actions).includes("PRIVATE_SYNTHETIC_BODY"),
    "Il testo del messaggio non entra nel feed CEO",
  );
  eq(sentActions[0].href, `/partner?co=${partner.co}#lead-${partner.co}`);
  await rpc(
    "record_partner_activity",
    { schema_version: 1, partner_id: partnerId, kind: "risposta" },
    "consultant",
  );
  eq(
    await scalar(
      "select count(*)::int value from public.partner_work_links l join public.tasks t on t.id=l.task_id where l.partner_id=$1 and l.kind='follow_up'and t.status<>'done'",
      [partnerId],
    ),
    0,
    "Risposta chiude il sollecito in Team",
  );
  const project = await rpc(
    "create_partner_work",
    { schema_version: 1, kind: "project", partner_id: partnerId },
    "consultant",
  );
  eq(
    await scalar("select owner_id value from public.product_development_projects where id=$1", [
      project.target_id,
    ]),
    users.production,
    "Esito assegnato alla produzione",
  );
  await rpc(
    "set_partner_state",
    {
      schema_version: 1,
      partner_id: partnerId,
      expected_version: Number(
        await scalar("select version value from public.partners where id=$1", [partnerId]),
      ),
      stage: "chiuso",
    },
    "consultant",
  );
  const linkedEvent = await scalar(
    "select calendar_event_id value from public.partner_work_links where partner_id=$1 and kind='event'",
    [partnerId],
  );
  ok(linkedEvent, "Accordo fatto: la data Partner genera l'evento condiviso");
  await rpc(
    "create_partner_work",
    {
      schema_version: 1,
      kind: "link_sale",
      partner_id: partnerId,
      event_id: linkedEvent,
      order_id: order,
    },
    "consultant",
  );
  eq(
    await scalar(
      "select count(*)::int value from public.partner_event_sales where partner_id=$1 and order_id=$2",
      [partnerId, order],
    ),
    1,
  );
  eq(
    (
      await as("logistics", "select count(*)::int value from public.calendar_events where id=$1", [
        linkedEvent,
      ])
    )[0].value,
    1,
    "Evento visibile anche a chi non partecipa",
  );
  eq(
    (await as("logistics", "select count(*)::int value from public.finance_movement_revisions"))[0]
      .value,
    0,
    "RLS Finance resta chiusa fuori dal gate",
  );

  // Actual P3 monthly payment is one canonical receipt, separate from credit.
  await db.query(
    "insert into public.consignment_shops(location_id,supply_location_id,created_by,updated_by)values($1,$2,$3,$3)",
    [shop, central, users.finance],
  );
  const report = randomUUID();
  await db.query(
    "insert into public.consignment_reports(id,location_id,period_month,brand_share_bps,markup_cents,pieces,gross_cents,brand_cents,shop_cents,payment_state,created_by,updated_by)values($1,$2,date_trunc('month',now())::date,6000,1000,1,10000,6000,4000,'unpaid',$3,$3)",
    [report, shop, users.finance],
  );
  const shopPayment = randomUUID();
  await rpc(
    "record_consignment_payment",
    {
      schema_version: 1,
      report_id: report,
      amount_cents: 6000,
      paid_at: at,
      method: "cash",
      account_label: "Cash",
      reference: null,
    },
    "finance",
    shopPayment,
  );
  eq(
    await scalar("select payment_state value from public.consignment_reports where id=$1", [
      report,
    ]),
    "paid",
  );
  const edit = {
    schema_version: 1,
    payment_id: shopPayment,
    expected_version: 1,
    amount_cents: 2500,
    paid_at: at,
    method: "cash",
    account_label: "Cash",
    reference: null,
    voided: false,
    reason: "Correzione sintetica P3",
  };
  const editOp = randomUUID();
  await rpc("update_consignment_payment", edit, "finance", editOp);
  eq((await rpc("update_consignment_payment", edit, "finance", editOp)).replayed, true);
  eq(
    await scalar("select payment_state value from public.consignment_reports where id=$1", [
      report,
    ]),
    "partial",
    "P3 stato ricalcolato dalla stessa riga canonica",
  );
  eq(
    await scalar(
      "select sum(amount_cents)::text value from public.consignment_report_payments where report_id=$1 and not voided",
      [report],
    ),
    "2500",
    "Nessun doppio incasso tra P3 e P4",
  );
  eq(
    await scalar(
      "select count(*)::int value from public.consignment_payment_revisions where payment_id=$1",
      [shopPayment],
    ),
    2,
    "Originale e correzione restano nello storico P3",
  );
  eq(
    await scalar(
      "select count(*)::int value from public.finance_movement_revisions where source_id=$1",
      [shopPayment],
    ),
    0,
    "P4 non duplica la ledger P3",
  );
  await rejected(
    rpc("update_consignment_payment", { ...edit, expected_version: 1 }),
    "22023",
    "La versione precedente non sovrascrive una correzione",
  );
  actions = (await feed(users.finance, "finance")).items;
  ok(
    actions.some((entry) => entry.message.includes("incasso")),
    "Gli incassi P3 entrano nel feed CEO",
  );
  eq(
    actions.filter((entry) => entry.message.includes("da 60,00 € a 25,00 €")).length,
    1,
    "Riga canonica P3 e sua revisione producono una sola correzione leggibile",
  );
  for (const [version, voided, state] of [
    [2, true, "unpaid"],
    [3, false, "partial"],
  ]) {
    const operation = randomUUID();
    await rpc(
      "update_consignment_payment",
      { ...edit, expected_version: version, voided },
      "finance",
      operation,
    );
    eq(
      await scalar("select payment_state value from public.consignment_reports where id=$1", [
        report,
      ]),
      state,
      "Eliminazione e recupero P3 ricalcolano il saldo",
    );
    const auditAt = await scalar(
      `select to_char(occurred_at at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')value from public.audit_logs where table_name='consignment_payment_revisions'and record_key->>'id'=$1`,
      [operation],
    );
    const action = (await feed(users.finance, null)).items.filter(
      (entry) => entry.occurred_at === auditAt,
    );
    eq(action.length, 1, "Pagamento, storico e stato resoconto costituiscono una sola azione CEO");
    ok(action[0].message.includes(voided ? "ha eliminato un incasso" : "ha modificato un incasso"));
  }
  eq(
    (await as("logistics", "select count(*)::int value from public.consignment_report_payments"))[0]
      .value,
    0,
    "Il pagamento P3 non è leggibile da Logistica",
  );
  eq(
    (
      await as("logistics", "select count(*)::int value from public.consignment_payment_revisions")
    )[0].value,
    0,
    "Lo storico P3 non è leggibile da Logistica",
  );

  const metadata = {
      direction: "income",
      category: "Categoria sintetica",
      description: "PRIVATE_SYNTHETIC_FINANCE",
      pending: true,
    },
    pendingOp = randomUUID();
  const pendingEdit = { ...edit, expected_version: 4, finance: metadata };
  await rpc("update_consignment_payment", pendingEdit, "finance", pendingOp);
  eq(
    await scalar("select payment_state value from public.consignment_reports where id=$1", [
      report,
    ]),
    "unpaid",
    "Un incasso sospeso non salda il resoconto",
  );
  eq(
    await scalar(
      "select snapshot->'finance'value from public.consignment_payment_revisions where id=$1",
      [pendingOp],
    ),
    metadata,
    "I metadati Finance fanno parte dello stesso storico P3",
  );
  await rpc("update_consignment_payment", {
    ...edit,
    expected_version: 5,
    reference: "Riferimento sintetico",
  });
  eq(
    await scalar(
      "select finance_pending value from public.consignment_report_payments where id=$1",
      [shopPayment],
    ),
    true,
    "Un vecchio form P3 conserva i metadati aggiornati da Finance",
  );
  const states = (
    await as("logistics", "select public.read_consignment_payment_states(array[$1::uuid])value", [
      report,
    ])
  )[0].value;
  eq(
    states,
    [{ report_id: report, payment_state: "unpaid" }],
    "La sola proiezione di stato operativa passa a Logistica",
  );
  await rejected(
    as("logistics", "select private.consignment_posted_payment_net($1)", [report]),
    "42501",
    "Gli importi aggregati privati non sono interrogabili dal client",
  );
  await rejected(
    as("outsider", "select public.read_consignment_payment_states(array[$1::uuid])", [report]),
    "42501",
  );
  await rpc("update_consignment_payment", {
    ...edit,
    expected_version: 6,
    finance: { ...metadata, direction: "expense", pending: false },
  });
  eq(
    await scalar("select payment_state value from public.consignment_reports where id=$1", [
      report,
    ]),
    "unpaid",
    "Un'uscita non aumenta gli incassi ricevuti",
  );
  actions = (await feed(users.finance, "finance")).items;
  ok(
    actions[0].message.includes("-25,00 €") && actions[0].message.includes("Categoria sintetica"),
    "CEO riporta segno e categoria del movimento P3 corretto in Finance",
  );
  ok(
    !JSON.stringify(actions).includes("PRIVATE_SYNTHETIC_FINANCE"),
    "La descrizione Finance non attraversa il DTO CEO",
  );
  const tomorrow = await scalar(
    "select ((statement_timestamp()at time zone'Europe/Rome')::date+1)::text value",
  );
  await rpc("update_consignment_payment", {
    ...edit,
    expected_version: 7,
    paid_at: `${tomorrow}T12:00:00+02:00`,
    finance: { ...metadata, pending: false },
  });
  eq(
    (
      await as("logistics", "select public.read_consignment_payment_states(array[$1::uuid])value", [
        report,
      ])
    )[0].value[0].payment_state,
    "unpaid",
    "La data futura non entra nel saldo operativo",
  );
  await rpc("update_consignment_payment", {
    ...edit,
    expected_version: 8,
    finance: { ...metadata, pending: false },
  });
  eq(
    (
      await as("logistics", "select public.read_consignment_payment_states(array[$1::uuid])value", [
        report,
      ])
    )[0].value[0].payment_state,
    "partial",
    "Data di oggi e stato confermato riallineano Finance e conto vendita",
  );
  eq(
    (await rpc("update_consignment_payment", pendingEdit, "finance", pendingOp)).replayed,
    true,
    "Una ricevuta congelata si può rileggere dopo altre versioni",
  );
  eq(
    await scalar(
      "select count(*)::int value from public.consignment_report_payments where report_id=$1",
      [report],
    ),
    1,
    "Correzioni, eliminazioni e recuperi conservano una sola riga monetaria",
  );

  await db.query(
    "update auth.sessions set not_after=clock_timestamp()-interval '1 second'where id=$1",
    [sessions.finance],
  );
  await rejected(
    rpc("revise_finance_movement", revision("payment", payment, 2, "delete")),
    "42501",
    "Sessione scaduta invalida le correzioni P4",
  );
  await rejected(
    rpc("update_consignment_payment", { ...edit, expected_version: 2 }),
    "42501",
    "Sessione scaduta invalida le correzioni P3",
  );
  await db.query(
    "update private.area_grants set expires_at=clock_timestamp()-interval '1 second'where area='audit'",
  );
  await rejected(feed(null, null), "42501", "Scadenza CEO verificata dopo tutta la catena");
  console.log(
    `PASS ${checks} Finance ecosystem integration checks; catena completa reale, PostgreSQL 17, dati sintetici, nessun cloud.`,
  );
} finally {
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
