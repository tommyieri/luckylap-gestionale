// test-db: postgres minimo 25
// PostgreSQL 17 locale, catena completa: rosso prima della migrazione, verde dopo.
// Auth/Storage e interfacce esterne simulate; solo fixture sintetiche, nessun DSN.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const [bin, modulePath] = process.argv.slice(2);
if (!bin?.startsWith("/") || !modulePath?.startsWith("/"))
  throw Error("Servono percorsi assoluti PG17 e pg; nessun DSN.");
const imported = await import(pathToFileURL(modulePath).href);
const Client = imported.Client ?? imported.default.Client;
const run = (name, args) => {
  const result = spawnSync(join(bin, name), args, {
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.status !== 0) throw Error(`${name}: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
};
assert.match(run("postgres", ["--version"]), /PostgreSQL\) 17\./);
const directory = mkdtempSync("/private/tmp/luckylap-shopify-time-");
const data = join(directory, "data");
const socket = join(directory, "socket");
mkdirSync(socket, { mode: 0o700 });
const clients = [];
let started = false,
  owner,
  worker,
  checks = 0;
const eq = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const scalar = async (client, sql, args = []) => (await client.query(sql, args)).rows[0].value;
const clone = (value) => structuredClone(value);
const gid = (type, n) => `gid://shopify/${type}/${n}`;
const shop = "synthetic-time.myshopify.com";
const location = randomUUID(),
  item = randomUUID();
const created = "2026-01-12T10:00:05.000Z";
const updated = "2026-01-12T10:01:00.000Z";
const paid = "2026-01-12T10:00:00.000Z";
const migrationName = "20261126123000_shopify_transaction_time.sql";
const migrations = new URL("../migrations/", import.meta.url);

function order(n = 1) {
  return {
    schemaVersion: 1,
    apiVersion: "2026-10",
    shopDomain: shop,
    orderId: gid("Order", n),
    sourceName: "web",
    retailLocationId: null,
    createdAt: created,
    updatedAt: updated,
    cancelledAt: null,
    test: false,
    edited: false,
    hasDiscountCodes: false,
    shopCurrency: "EUR",
    presentmentCurrency: "EUR",
    taxesIncluded: true,
    totals: {
      originalTotalCents: 3701,
      currentTotalCents: 3701,
      originalSubtotalCents: 3701,
      currentSubtotalCents: 3701,
      totalShippingPriceCents: 0,
      currentShippingPriceCents: 0,
      originalTaxCents: 0,
      currentTaxCents: 0,
      totalRefundedCents: 0,
      totalReceivedCents: 3701,
      orderDiscountCents: 0,
      totalDiscountCents: 0,
    },
    lines: [
      {
        id: gid("LineItem", n * 100),
        variantId: gid("ProductVariant", 100),
        sku: "SYN-TIME-M",
        quantity: 1,
        currentQuantity: 1,
        isGiftCard: false,
        requiresShipping: true,
        originalUnitPriceCents: 3701,
        discountedTotalCents: 3701,
        lineDiscountCents: 0,
        discountAllocationsCents: [],
      },
    ],
    fulfillments: [],
    refunds: [],
    transactions: [
      {
        id: gid("OrderTransaction", n * 100),
        kind: "SALE",
        status: "SUCCESS",
        amountCents: 3701,
        currency: "EUR",
        processedAt: paid,
        parentId: null,
        test: false,
        gateway: "synthetic_gateway",
      },
    ],
  };
}
async function connect() {
  const client = new Client({
    host: socket,
    port: 5432,
    user: "postgres",
    database: "postgres",
    ssl: false,
    statement_timeout: 15000,
    query_timeout: 18000,
  });
  await client.connect();
  clients.push(client);
  return client;
}
async function rpc(name, args) {
  await worker.query("begin");
  try {
    await worker.query("set local role service_role");
    const result = await scalar(
      worker,
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`,
      args,
    );
    await worker.query("commit");
    return result;
  } catch (error) {
    await worker.query("rollback");
    throw error;
  }
}
async function receive(o) {
  const webhook = randomUUID();
  const receipt = await rpc("receive_shopify_order_notification", [
    {
      shopDomain: shop,
      webhookId: webhook,
      eventId: randomUUID(),
      deliveryKey: `${shop}:${webhook}`,
      apiVersion: "2026-10",
      topic: "orders/paid",
      orderGid: o.orderId,
      sourceName: "web",
      channel: "shopify_web",
      currency: "EUR",
      sourceCreatedAt: created,
      sourceUpdatedAt: updated,
      bodySha256: createHash("sha256").update(JSON.stringify(o)).digest("hex"),
      requiresCanonicalRead: true,
    },
  ]);
  const leases = await rpc("claim_shopify_order_jobs", [randomUUID(), 20, 120]);
  const lease = leases.find((entry) => entry.job_id === receipt.job_id);
  assert.ok(lease, "Il job sintetico deve essere acquisibile");
  return lease;
}
const apply = (o, lease) => rpc("apply_shopify_order", [lease.job_id, lease.lease_token, o]);
const validate = (o) => scalar(owner, "select private.validate_shopify_canonical($1) value", [o]);
async function rejected(o, reason) {
  try {
    await validate(o);
    assert.fail(`Atteso ${reason}`);
  } catch (error) {
    eq([error.code, error.message], ["P0001", reason], "Resta il rifiuto canonico previsto");
  }
}
async function effects() {
  return scalar(
    owner,
    `select jsonb_build_object(
    'orders',(select count(*) from public.sales_orders),
    'payments',(select count(*) from public.order_payments),
    'facts',(select count(*) from public.commercial_facts),
    'observations',(select count(*) from public.shopify_transaction_observations),
    'effects',(select count(*) from private.shopify_effect_receipts),
    'reservations',(select count(*) from public.stock_reservation_events),
    'movements',(select count(*) from public.stock_movements)) value`,
  );
}
try {
  run("initdb", [
    "-D",
    data,
    "-U",
    "postgres",
    "--auth-local=trust",
    "--auth-host=reject",
    "--no-locale",
    "--encoding=UTF8",
    "--no-sync",
    "-L",
    resolve(bin, "../share/postgresql"),
  ]);
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    join(directory, "postgres.log"),
    "-o",
    `-k ${socket} -h '' -c fsync=off -c unix_socket_permissions=0700 -c max_connections=8`,
    "-w",
    "start",
  ]);
  started = true;
  owner = await connect();
  worker = await connect();
  await owner.query(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema extensions; create extension pgcrypto with schema extensions;
    create schema auth; create table auth.users(id uuid primary key); create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$; grant usage on schema auth to anon,authenticated,service_role;
    create schema storage; create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name)); alter table storage.objects enable row level security; grant usage on schema storage to anon,authenticated,service_role; grant select,insert,update,delete on storage.objects to authenticated;
    create schema vault; create table vault.secrets(id uuid primary key,name text,decrypted_secret text); create view vault.decrypted_secrets as select * from vault.secrets;
    create schema cron; create table cron.job(jobid bigint,jobname text,username text,schedule text,command text,active boolean); create schema net;`);
  for (const name of readdirSync(migrations)
    .filter((entry) => entry.endsWith(".sql") && entry !== migrationName)
    .sort()) {
    let sql = readFileSync(new URL(name, migrations), "utf8");
    if (name.endsWith("_shopify_scheduler.sql") || name.endsWith("_packlink_scheduler.sql")) {
      let replaced = 0;
      sql = sql.replace(
        /^create extension if not exists (?:pg_cron|pg_net|supabase_vault) with schema [a-z_]+;$/gm,
        () => {
          replaced++;
          return "-- Interfaccia esterna simulata nel bootstrap locale.";
        },
      );
      assert.equal(replaced, 3);
    }
    try {
      await owner.query(sql);
    } catch (error) {
      throw Error(`Migrazione ${name}: ${error.message}`, { cause: error });
    }
  }
  const sample = order();
  const control = clone(sample);
  control.transactions[0].processedAt = created;
  eq(
    (await validate(control)).captures,
    3701,
    "Il controllo identico, salvo processedAt, passa prima del fix",
  );
  await rejected(sample, "invalid_canonical");
  const acl = await scalar(
    owner,
    `select jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,
    'securityDefiner',prosecdef,'volatility',provolatile) value from pg_proc where oid='private.validate_shopify_canonical(jsonb)'::regprocedure`,
  );
  await owner.query(
    "update public.app_settings set sales_started_at='2026-01-01T00:00:00Z' where id",
  );
  await owner.query(
    "insert into public.stock_locations(id,code,name,location_type) values($1,'SYN-TIME','Sede sintetica','Magazzino')",
    [location],
  );
  await owner.query(
    "insert into public.stock_items(id,kind,sku,name,unit_cost_eur,list_price_eur) values($1,'product','SYN-TIME-M','Articolo sintetico',1.23,37.01)",
    [item],
  );
  await owner.query(
    "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason) values($1,$2,$3,'opening',10,'Conteggio sintetico')",
    [randomUUID(), item, location],
  );
  await owner.query(
    "insert into public.shopify_catalog_variants(shop_domain,variant_gid,product_gid,sku,product_title,status,price_cents,source_updated_at,stock_item_id) values($1,$2,$3,'SYN-TIME-M','Articolo sintetico','ACTIVE',3701,$4,$5)",
    [shop, gid("ProductVariant", 100), gid("Product", 100), created, item],
  );
  await owner.query(
    "insert into private.shopify_sync_configuration(shop_domain,enabled,online_location_id) values($1,true,$2)",
    [shop, location],
  );
  const baseline = await effects();
  const lease = await receive(sample);
  eq(
    (await apply(sample, lease)).reason,
    "invalid_canonical",
    "Rosso: il vecchio apply rifiuta il pagamento precedente all'ordine",
  );
  eq(await effects(), baseline, "Rosso senza effetti commerciali o fisici parziali");
  console.log(
    "REGRESSIONE ROSSA confermata: solo processedAt anteriore alla creazione distingue il caso valido dal controllo.",
  );
  await owner.query(readFileSync(new URL(migrationName, migrations), "utf8"));
  eq(
    await scalar(
      owner,
      `select jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,
    'securityDefiner',prosecdef,'volatility',provolatile) value from pg_proc where oid='private.validate_shopify_canonical(jsonb)'::regprocedure`,
    ),
    acl,
    "ACL e proprietà del validatore invariati",
  );
  eq(
    (await validate(sample)).captures,
    3701,
    "Verde: SALE cinque secondi prima della creazione è valido",
  );
  const remotePast = clone(sample);
  remotePast.transactions[0].processedAt = "2025-06-01T00:00:00.000Z";
  eq(
    (await validate(remotePast)).captures,
    3701,
    "Nessuna finestra temporale arbitraria rispetto alla creazione",
  );
  eq(
    await rpc("requeue_shopify_order_job", [lease.job_id]),
    true,
    "Recupero locale esplicito del job in revisione",
  );
  const renewed = (await rpc("claim_shopify_order_jobs", [randomUUID(), 20, 120])).find(
    (entry) => entry.job_id === lease.job_id,
  );
  const applied = await apply(sample, renewed);
  eq(applied.status, "applied", "Verde: apply completo sullo stesso job riaccodato");
  const payment = await scalar(
    owner,
    "select jsonb_build_object('amount',amount_cents,'processedAt',to_char(occurred_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')) value from public.order_payments where order_id=$1",
    [applied.order_id],
  );
  eq(
    payment,
    { amount: 3701, processedAt: paid },
    "Importo e timestamp della fonte preservati senza clamping",
  );
  eq(
    await scalar(owner, "select payment_state value from public.sales_orders where id=$1", [
      applied.order_id,
    ]),
    "paid",
    "Vendita risulta pagata",
  );
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.commercial_facts where order_id=$1",
      [applied.order_id],
    ),
    2,
    "Un fatto vendita e un fatto incasso",
  );
  const committed = await effects();
  eq((await apply(sample, renewed)).status, "replayed", "Replay della stessa lease");
  eq(await effects(), committed, "Replay senza duplicazioni");
  const invalid = clone(sample);
  invalid.transactions[0].processedAt = "non-una-data";
  await rejected(invalid, "invalid_canonical");
  const future = clone(sample);
  future.transactions[0].processedAt = "2026-01-12T10:01:00.000000001Z";
  await rejected(future, "invalid_canonical");
  const missing = clone(sample);
  missing.transactions[0].processedAt = null;
  await rejected(missing, "missing_transaction_time");
  const negative = clone(sample);
  negative.transactions[0].amountCents = -1;
  await rejected(negative, "invalid_canonical");
  const wrongAmount = clone(sample);
  wrongAmount.totals.totalReceivedCents = 3700;
  await rejected(wrongAmount, "observed_payment_mismatch");
  const refund = clone(sample);
  refund.transactions.push({
    ...refund.transactions[0],
    id: gid("OrderTransaction", 200),
    kind: "REFUND",
    amountCents: 701,
    parentId: refund.transactions[0].id,
    processedAt: updated,
  });
  refund.totals.totalRefundedCents = 701;
  refund.refunds.push({
    id: gid("Refund", 100),
    createdAt: updated,
    updatedAt: updated,
    totalRefundedCents: 701,
    lines: [],
  });
  eq((await validate(refund)).refunds, 701, "Rimborso con genitore corretto continua a funzionare");
  const foreignParent = clone(refund);
  foreignParent.transactions[1].parentId = gid("OrderTransaction", 999);
  await rejected(foreignParent, "unknown_parent_transaction");
  const excessiveRefund = clone(refund);
  excessiveRefund.transactions[1].amountCents = 3702;
  await rejected(excessiveRefund, "refund_parent_mismatch");
  const wrongRefundTotal = clone(refund);
  wrongRefundTotal.refunds[0].totalRefundedCents = 700;
  await rejected(wrongRefundTotal, "refund_totals_mismatch");
  const futureOrder = order(2);
  futureOrder.transactions[0].processedAt = future.transactions[0].processedAt;
  const futureLease = await receive(futureOrder);
  eq(
    (await apply(futureOrder, futureLease)).reason,
    "invalid_canonical",
    "Il limite superiore resta attivo anche nel vero apply",
  );
  eq(await effects(), committed, "Ordine con tempo non valido non crea effetti parziali");
  console.log(
    `PASS ${checks} Shopify transaction time checks; catena completa, PostgreSQL17 locale, fixture sintetiche, nessun cloud.`,
  );
} finally {
  for (const client of clients) {
    try {
      await client.query("rollback");
    } catch {}
  }
  for (const client of clients.reverse()) {
    try {
      await client.end();
    } catch {}
  }
  try {
    if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
