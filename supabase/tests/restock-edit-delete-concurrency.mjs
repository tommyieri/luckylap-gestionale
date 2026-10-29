// test-db: postgres minimo 40
// PostgreSQL 17 reale: eliminazione contro arrivo, replay concorrente, ripristino
// e collegamenti al conto vendita. Lock osservati, solo dati sintetici e cluster temporaneo.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const [bin, modulePath] = process.argv.slice(2);
if (!bin?.startsWith("/") || !modulePath?.startsWith("/"))
  throw Error("Servono percorsi assoluti per PostgreSQL 17 e pg.");
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
const directory = mkdtempSync("/private/tmp/luckylap-restock-delete-");
const data = join(directory, "data"),
  socket = join(directory, "socket");
mkdirSync(socket, { mode: 0o700 });
const clients = [],
  user = randomUUID(),
  session = randomUUID();
const central = randomUUID(),
  shop = randomUUID(),
  product = randomUUID(),
  item = randomUUID();
let started = false,
  checks = 0,
  owner,
  a,
  b,
  aPid,
  bPid;
const eq = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const scalar = async (sql, args = []) => (await owner.query(sql, args)).rows[0]?.value;
async function connect(label) {
  const client = new Client({
    host: socket,
    user: "postgres",
    database: "postgres",
    ssl: false,
    application_name: `restock-delete-${label}`,
    statement_timeout: 15000,
    query_timeout: 18000,
  });
  client.on("error", () => {});
  await client.connect();
  clients.push(client);
  return client;
}
async function begin(client) {
  await client.query("begin isolation level read committed");
  await client.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: user, session_id: session, aal: "aal1" }),
  ]);
  await client.query("set local role authenticated");
}
const call = (client, kind, payload, op = randomUUID()) =>
  client
    .query(`select public.${kind}($1,$2::jsonb) value`, [op, JSON.stringify(payload)])
    .then((result) => result.rows[0].value);
const settle = (promise) =>
  promise.then(
    (result) => ({ ok: true, result }),
    (error) => ({ ok: false, message: error.message, code: error.code }),
  );
async function run(kind, payload, op = randomUUID()) {
  await begin(owner);
  try {
    const result = await call(owner, kind, payload, op);
    await owner.query("commit");
    return result;
  } catch (error) {
    await owner.query("rollback");
    throw error;
  }
}
async function waitsOn(waiter, holder) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const row = (
      await owner.query(
        "select state,wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1",
        [waiter],
      )
    ).rows[0];
    if (
      row?.state === "active" &&
      row.wait_event_type === "Lock" &&
      row.blockers.includes(holder)
    ) {
      checks++;
      return;
    }
    await new Promise((done) => setTimeout(done, 20));
  }
  throw Error("Nessuna sovrapposizione reale dei lock fra i backend.");
}
const deleted = (order_id, expected_version, value = true) => ({
  schema_version: 1,
  order_id,
  expected_version,
  deleted: value,
  note: "Motivo sintetico concorrente",
});
const receive = (order_id, expected_version) => ({
  schema_version: 1,
  order_id,
  expected_version,
  expected_pieces: 3,
  note: "Arrivo sintetico",
});
async function newOrder(title) {
  const order = await run("save_restock_order", {
    schema_version: 1,
    order_id: null,
    expected_version: null,
    title,
    notes: "",
    shop_location_id: shop,
  });
  await run("set_restock_lines", {
    schema_version: 1,
    order_id: order.order_id,
    expected_version: 1,
    lines: [
      {
        destination: "shop",
        product_id: product,
        color: "Verde sintetico",
        size: "M",
        quantity: 3,
      },
    ],
  });
  return order.order_id;
}
const effects = async () =>
  (
    await owner.query(`select
  (select md5(coalesce(jsonb_agg(to_jsonb(b) order by stock_item_id,location_id)::text,'')) from public.stock_balances b) balances,
  (select md5(coalesce(jsonb_agg(to_jsonb(m) order by id)::text,'')) from public.stock_movements m) movements,
  (select md5(coalesce(jsonb_agg(to_jsonb(f) order by id)::text,'')) from public.finance_entries f) finance,
  (select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'')) from public.restock_arrivals a) arrivals`)
  ).rows[0];
const isDeleted = (order) =>
  scalar("select deleted_at is not null value from public.restock_orders where id=$1", [order]);
const version = (order) =>
  scalar("select version::int value from public.restock_orders where id=$1", [order]);
const eventCount = (order) =>
  scalar("select count(*)::int value from public.restock_deletion_events where order_id=$1", [
    order,
  ]);
const shopCount = (order) =>
  scalar("select count(*)::int value from public.consignment_orders where restock_order_id=$1", [
    order,
  ]);
const errorIs = (result, message, label) =>
  eq([result.ok, result.message, result.code], [false, message, "22023"], label);
const shopPayload = (order) => ({
  schema_version: 1,
  order_id: null,
  expected_version: null,
  location_id: shop,
  requested_on: new Date().toISOString().slice(0, 10),
  note: "Ordine sintetico",
  lines: [{ stock_item_id: item, quantity: 1 }],
  restock_order_id: order,
});

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
  owner = await connect("owner");
  a = await connect("a");
  b = await connect("b");
  aPid = (await a.query("select pg_backend_pid() value")).rows[0].value;
  bPid = (await b.query("select pg_backend_pid() value")).rows[0].value;
  await owner.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
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
  const migrationDirectory = new URL("../migrations/", import.meta.url);
  const files = readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    let source = readFileSync(new URL(file, migrationDirectory), "utf8");
    if (file.endsWith("_shopify_scheduler.sql"))
      source = source.replace(
        /^create extension if not exists (?:pg_cron|pg_net|supabase_vault) with schema [a-z_]+;$/gm,
        "-- Interfaccia esterna già fornita nello schema del test.",
      );
    await owner.query(source);
  }
  eq(
    files.some((file) => file.endsWith("_restock_edit_delete.sql")),
    true,
    "Catena completa con eliminazione riassortimenti",
  );
  await owner.query("insert into auth.users(id) values ($1)", [user]);
  await owner.query("insert into auth.sessions values ($1,$2,null)", [session, user]);
  await owner.query(
    "insert into public.profiles(user_id,display_name) values ($1,'Persona sintetica')",
    [user],
  );
  await owner.query("insert into public.memberships(user_id,role) values ($1,'logistics')", [user]);
  await owner.query(
    `insert into public.stock_locations(id,code,name,location_type,active) values
    ($1,'MAG01','Magadzino','Magazzino',true),($2,'NEG01','Negozio sintetico','Negozio Conto Vendita',true)`,
    [central, shop],
  );
  await owner.query(
    "insert into public.consignment_shops(location_id,supply_location_id,sizes) values ($1,$2,array['M'])",
    [shop, central],
  );
  await owner.query(
    "insert into public.products(id,model,category) values ($1,'Modello sintetico','T-shirt')",
    [product],
  );
  await owner.query(
    "insert into public.stock_items(id,kind,sku,name,active) values ($1,'product','SYN-VERDE-M','Maglietta sintetica',true)",
    [item],
  );
  await owner.query(
    "insert into public.product_variants(stock_item_id,product_id,color,size) values ($1,$2,'Verde sintetico','M')",
    [item, product],
  );
  await owner.query(
    "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason) values ($1,$2,$3,'opening',7,'Conta sintetica')",
    [randomUUID(), item, central],
  );
  await owner.query("update public.app_settings set stock_adjustments_enabled=true where id");

  // Eliminazione prima dell’arrivo: l’arrivo attende e poi perde la versione.
  const first = await newOrder("Elimina prima dell'arrivo sintetico"),
    beforeFirst = await effects();
  await begin(a);
  await call(a, "set_restock_deleted", deleted(first, 2));
  await begin(b);
  const receiveBlocked = settle(call(b, "receive_restock_order", receive(first, 2)));
  await waitsOn(bPid, aPid);
  await a.query("commit");
  errorIs(
    await receiveBlocked,
    "stale_version",
    "L'arrivo concorrente perde il CAS dopo eliminazione",
  );
  await b.query("rollback");
  errorIs(
    await settle(run("receive_restock_order", receive(first, 3))),
    "restock_deleted",
    "Anche con versione aggiornata non carica l'eliminato",
  );
  eq(
    await effects(),
    beforeFirst,
    "Nessun carico, arrivo o effetto Finance sul riassortimento eliminato",
  );
  eq(await isDeleted(first), true, "Riassortimento eliminato");
  eq(await eventCount(first), 1, "Un solo evento di eliminazione");

  // Arrivo prima dell’eliminazione: il carico resta unico e il nuovo tentativo di
  // eliminazione con versione fresca cambia solo la visibilità.
  const second = await newOrder("Arrivo prima di eliminazione sintetico");
  const quantityBefore = await scalar(
    "select quantity::int value from public.stock_balances where stock_item_id=$1 and location_id=$2",
    [item, central],
  );
  await begin(a);
  await call(a, "receive_restock_order", receive(second, 2));
  await begin(b);
  const deleteBlocked = settle(call(b, "set_restock_deleted", deleted(second, 2)));
  await waitsOn(bPid, aPid);
  await a.query("commit");
  errorIs(await deleteBlocked, "stale_version", "Eliminazione obsoleta perde il CAS dopo carico");
  await b.query("rollback");
  eq(await isDeleted(second), false, "Il tentativo obsoleto non elimina l'arrivo");
  eq(
    await scalar(
      "select quantity::int value from public.stock_balances where stock_item_id=$1 and location_id=$2",
      [item, central],
    ),
    quantityBefore + 3,
    "Carico singolo di tre pezzi",
  );
  const beforeDelete = await effects();
  await run("set_restock_deleted", deleted(second, 3));
  eq(await effects(), beforeDelete, "Eliminare con CAS fresco conserva il carico appena arrivato");
  eq(
    await scalar(
      "select count(*)::int value from public.restock_arrivals where order_id=$1 and undone_at is null",
      [second],
    ),
    1,
    "Un solo arrivo aperto",
  );
  eq(await version(second), 4, "Versione dopo arrivo e successiva eliminazione");

  // Identica operazione su due connessioni: lock della ricevuta, risultato
  // originale al primo e replay al secondo, un solo evento e una sola ricevuta.
  const third = await newOrder("Replay concorrente sintetico"),
    op = randomUUID(),
    dataThird = deleted(third, 2),
    beforeThird = await effects();
  await begin(a);
  const original = await call(a, "set_restock_deleted", dataThird, op);
  await begin(b);
  const repeated = settle(call(b, "set_restock_deleted", dataThird, op));
  await waitsOn(bPid, aPid);
  await a.query("commit");
  const replay = await repeated;
  eq(replay.ok, true, "Replay concorrente riuscito");
  eq(replay.result, { ...original, replayed: true }, "Risultato canonico del replay");
  await b.query("commit");
  eq(await eventCount(third), 1, "Replay concorrente con un solo evento");
  eq(
    await scalar("select count(*)::int value from private.restock_receipts where operation_id=$1", [
      op,
    ]),
    1,
    "Replay concorrente con una sola ricevuta",
  );
  eq(await version(third), 3, "Replay non incrementa nuovamente la versione");
  eq(await effects(), beforeThird, "Replay concorrente senza effetti patrimoniali");

  // Il ripristino vince la versione contro una seconda eliminazione obsoleta.
  await begin(a);
  await call(a, "set_restock_deleted", deleted(third, 3, false));
  await begin(b);
  const staleDelete = settle(call(b, "set_restock_deleted", deleted(third, 3)));
  await waitsOn(bPid, aPid);
  await a.query("commit");
  errorIs(
    await staleDelete,
    "stale_version",
    "Il ripristino rende obsoleta l'eliminazione concorrente",
  );
  await b.query("rollback");
  eq(await isDeleted(third), false, "Ripristino conservato dopo conflitto");
  eq(await version(third), 4, "Ripristino incrementa una sola versione");
  await run("set_restock_deleted", deleted(third, 4));
  eq(
    await eventCount(third),
    3,
    "Elimina, ripristina e nuova eliminazione conservati nello storico",
  );
  eq(await effects(), beforeThird, "Nemmeno ripristino ed eliminazione duplicano effetti");

  // Nuovo ordine del negozio contro eliminazione: il lock del riassortimento
  // impedisce l’inserimento dopo che l’eliminazione è stata confermata.
  const fourth = await newOrder("Collegamento dopo eliminazione sintetico");
  await run("receive_restock_order", receive(fourth, 2));
  const beforeLink = await effects();
  await begin(a);
  await call(a, "set_restock_deleted", deleted(fourth, 3));
  await begin(b);
  const linkBlocked = settle(call(b, "save_consignment_order", shopPayload(fourth)));
  await waitsOn(bPid, aPid);
  await a.query("commit");
  errorIs(
    await linkBlocked,
    "restock_deleted",
    "Nessun nuovo ordine del negozio dopo eliminazione",
  );
  await b.query("rollback");
  eq(await shopCount(fourth), 0, "Nessun collegamento inserito sul riassortimento eliminato");
  eq(await effects(), beforeLink, "Collegamento rifiutato senza variazioni a stock o Finance");

  // Ordine del negozio già inserito prima dell’eliminazione: rimane una sola
  // volta, la successiva eliminazione del riassortimento non lo cancella.
  const fifth = await newOrder("Collegamento prima di eliminazione sintetico");
  await run("receive_restock_order", receive(fifth, 2));
  const beforeExisting = await effects();
  await begin(a);
  const linked = await call(a, "save_consignment_order", shopPayload(fifth));
  await begin(b);
  const afterLinkDelete = settle(call(b, "set_restock_deleted", deleted(fifth, 3)));
  await waitsOn(bPid, aPid);
  await a.query("commit");
  const afterLinkResult = await afterLinkDelete;
  eq(afterLinkResult.ok, true, "Eliminazione dopo inserimento del collegamento completata");
  await b.query("commit");
  eq(await shopCount(fifth), 1, "Un solo ordine valido precedente all'eliminazione");
  eq(
    await isDeleted(fifth),
    true,
    "Riassortimento eliminato conservando il collegamento precedente",
  );
  eq(
    await scalar("select restock_order_id::text value from public.consignment_orders where id=$1", [
      linked.order_id,
    ]),
    fifth,
    "Collegamento precedente immutato",
  );
  eq(
    await effects(),
    beforeExisting,
    "Eliminazione e collegamento precedente senza carichi aggiuntivi",
  );
  errorIs(
    await settle(run("save_consignment_order", shopPayload(fifth))),
    "restock_deleted",
    "Ulteriori collegamenti sullo stesso eliminato sono rifiutati",
  );
  eq(await shopCount(fifth), 1, "Il collegamento rifiutato non duplica l'ordine precedente");
  eq(
    await scalar("select count(*)::int value from public.stock_balances where quantity<0"),
    0,
    "Nessuna scorta negativa",
  );
  console.log(
    `PASS ${checks} controlli riassortimenti concorrenti; PostgreSQL 17 reale, dati sintetici, nessun cloud.`,
  );
} finally {
  // In caso di errore rilascia prima i lock così la chiusura dei client non
  // aspetta altri comandi, quindi arresta ed elimina il cluster temporaneo.
  await Promise.allSettled(clients.map((client) => client.query("rollback")));
  for (const client of clients.reverse()) {
    try {
      await client.end();
    } catch {}
  }
  try {
    if (started) command("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
