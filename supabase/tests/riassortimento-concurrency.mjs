// test-db: postgres minimo 24
// Riassortimento su PostgreSQL 17 reale: catena completa delle migrazioni e import dei due
// riordini, due backend che si sovrappongono davvero (lock osservati in pg_stat_activity) e il
// feed di Controllo CEO con la password CEO vera. Auth sintetico, cluster usa e getta in
// /private/tmp, socket privata, nessun DSN né cloud.
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
const directory = mkdtempSync("/private/tmp/luckylap-riassortimento-"),
  data = join(directory, "data"),
  socket = join(directory, "socket");
mkdirSync(socket, { mode: 0o700 });
const clients = [],
  names = ["founder", "logistics", "production"],
  users = Object.fromEntries(names.map((name) => [name, randomUUID()])),
  sessions = Object.fromEntries(names.map((name) => [name, randomUUID()]));
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
const ok = (value, label) => {
  assert.ok(value, label);
  checks++;
};
const scalar = async (sql, args = []) => (await owner.query(sql, args)).rows[0]?.value;
async function connect(label) {
  const client = new Client({
    host: socket,
    user: "postgres",
    database: "postgres",
    ssl: false,
    application_name: `luckylap-riassortimento-${label}`,
    statement_timeout: 15000,
    query_timeout: 18000,
  });
  client.on("error", () => {});
  await client.connect();
  clients.push(client);
  return client;
}
async function begin(client, who) {
  await client.query("begin isolation level read committed");
  await client.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: users[who], session_id: sessions[who], aal: "aal1" }),
  ]);
  await client.query("set local role authenticated");
}
const call = (client, kind, payload, op = randomUUID()) =>
  client
    .query(`select public.${kind}($1,$2::jsonb) result`, [op, JSON.stringify(payload)])
    .then((response) => response.rows[0].result);
const settle = (promise) =>
  promise.then(
    (result) => ({ ok: true, result }),
    (error) => ({ ok: false, code: error.code, message: error.message, detail: error.detail }),
  );
async function run(who, kind, payload, op = randomUUID()) {
  await begin(owner, who);
  try {
    const result = await call(owner, kind, payload, op);
    await owner.query("commit");
    return result;
  } catch (error) {
    await owner.query("rollback");
    throw error;
  }
}
/** Il backend in attesa è bloccato da un lock dell'altro: una sovrapposizione vera. */
async function waitsOn(waiter, holder) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const row = (
      await owner.query(
        "select state,wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1",
        [waiter],
      )
    ).rows[0];
    if (row?.state === "active" && row.wait_event_type === "Lock" && row.blockers.includes(holder))
      return true;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw Error("Nessuna sovrapposizione vera dei lock fra i due backend.");
}
const balance = (stockItem, location) =>
  scalar(
    "select quantity::int value from public.stock_balances where stock_item_id=$1 and location_id=$2",
    [stockItem, location],
  );
const version = (orderId) =>
  scalar("select version::int value from public.restock_orders where id=$1", [orderId]);
const negative = () =>
  scalar("select count(*)::int value from public.stock_balances where quantity < 0");

const central = randomUUID(),
  milan = randomUUID();
const products = {},
  items = {};
const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const RANGES = [
  ["GT3RS", "Bianco"],
  ["GT3RS", "Blu"],
  ["TESTAROSSA", "Bianco"],
  ["SL", "Azzurro"],
  ["964", "Blu"],
  ["964", "Bianco"],
  ["F40", "Bianco"],
  ["SENNA", "Bianco"],
];
const item = (model, color, size) => items[`${model}|${color}|${size}`];
const sku = (model, color, size) => `SYN-${model}-${color.toUpperCase()}-${size}`;
const restockOrder = async (title, lines, who = "logistics") => {
  const orderId = (
    await run(who, "save_restock_order", {
      schema_version: 1,
      order_id: null,
      expected_version: null,
      title,
      notes: "",
      shop_location_id: milan,
    })
  ).order_id;
  await run(who, "set_restock_lines", {
    schema_version: 1,
    order_id: orderId,
    expected_version: 1,
    lines: lines.map(([destination, model, color, size, quantity]) => ({
      destination,
      product_id: products[model],
      color,
      size,
      quantity,
    })),
  });
  return orderId;
};
const receive = (orderId, expected, pieces) => ({
  schema_version: 1,
  order_id: orderId,
  expected_version: expected,
  expected_pieces: pieces,
  note: "",
});
const undo = (orderId, expected) => ({
  schema_version: 1,
  order_id: orderId,
  expected_version: expected,
  note: "",
});
const adjust = (client, stockItem, delta) =>
  client.query("select public.adjust_stock($1,$2,$3,$4,$5) value", [
    randomUUID(),
    stockItem,
    central,
    delta,
    "Rettifica sintetica concorrente",
  ]);
const shopOrder = (restockId, lines) => ({
  schema_version: 1,
  order_id: null,
  expected_version: null,
  location_id: milan,
  requested_on: new Date().toISOString().slice(0, 10),
  note: "",
  lines,
  restock_order_id: restockId,
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
  // Solo le interfacce di Supabase hanno stand-in: nessuna funzione applicativa sostituita.
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
  const migrationDirectory = new URL("../migrations/", import.meta.url),
    files = readdirSync(migrationDirectory)
      .filter((name) => name.endsWith(".sql"))
      .sort();
  for (const file of files) {
    let source = readFileSync(new URL(file, migrationDirectory), "utf8");
    if (file.endsWith("_shopify_scheduler.sql"))
      source = source.replace(
        /^create extension if not exists (?:pg_cron|pg_net|supabase_vault) with schema [a-z_]+;$/gm,
        "-- Estensione esterna fornita sopra.",
      );
    await owner.query(source);
  }
  ok(files.at(-1).endsWith("_riassortimento.sql"), "Catena completa fino al riassortimento");

  for (const name of names) {
    await owner.query("insert into auth.users values($1)", [users[name]]);
    await owner.query("insert into auth.sessions values($1,$2,null)", [
      sessions[name],
      users[name],
    ]);
    await owner.query("insert into public.profiles(user_id,display_name)values($1,$2)", [
      users[name],
      `Membro sintetico ${name}`,
    ]);
    await owner.query("insert into public.memberships(user_id,role)values($1,$2)", [
      users[name],
      name,
    ]);
  }
  await owner.query(
    `insert into public.stock_locations(id,code,name,location_type,active)values
      ($1,'MAG01','Magadzino','Magazzino',true),($2,'NEG01','Libreria sintetica Milano','Negozio Conto Vendita',true)`,
    [central, milan],
  );
  await owner.query(
    "insert into public.consignment_shops(location_id,supply_location_id,sizes)values($1,$2,array['S','M','L','XL'])",
    [milan, central],
  );
  for (const [model] of RANGES)
    if (!products[model])
      products[model] = (
        await owner.query(
          "insert into public.products(model,category)values($1,'T-shirt') returning id",
          [model],
        )
      ).rows[0].id;
  for (const [model, color] of RANGES)
    for (const size of SIZES) {
      const stockItem = (
        await owner.query(
          "insert into public.stock_items(kind,sku,name,active)values('product',$1,$1,true) returning id",
          [sku(model, color, size)],
        )
      ).rows[0].id;
      items[`${model}|${color}|${size}`] = stockItem;
      await owner.query(
        "insert into public.product_variants(stock_item_id,product_id,color,size,central_target_quantity)values($1,$2,$3,$4,3)",
        [stockItem, products[model], color, size],
      );
      for (const [location, quantity] of [
        [central, 2],
        [milan, 0],
      ])
        await owner.query(
          "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,'opening',$4,'Conta sintetica')",
          [randomUUID(), stockItem, location, quantity],
        );
    }
  await owner.query("update public.app_settings set stock_adjustments_enabled=true where id");
  await owner.query(
    "insert into private.sensitive_area_credentials(area,password_hash)values('audit',extensions.crypt('synthetic-ceo-password',extensions.gen_salt('bf',10)))",
  );
  await owner.query(
    "insert into private.area_grants(session_id,user_id,area,credential_version,expires_at)select $1,$2,'audit',version,clock_timestamp()+interval '8 hours' from private.sensitive_area_credentials where area='audit'",
    [sessions.founder, users.founder],
  );

  // 0 · Import dei due riordini sulla catena reale: 85 = 64 + 17 + 4, e 36.
  const movementsBefore = await scalar("select count(*)::int value from public.stock_movements");
  await owner.query(
    readFileSync(new URL("../imports/20261023_riassortimento.sql", import.meta.url), "utf8"),
  );
  eq(
    (
      await owner.query(
        `select o.title, o.state, sum(l.quantity)::int total,
          sum(l.quantity) filter (where l.destination='warehouse')::int warehouse,
          coalesce(sum(l.quantity) filter (where l.destination='shop'),0)::int shop,
          coalesce(sum(l.quantity) filter (where l.destination='customer'),0)::int customer
         from public.restock_orders o join public.restock_lines l on l.order_id=o.id group by o.id order by o.title desc`,
      )
    ).rows,
    [
      {
        title: "Riordine settembre 2026",
        state: "quality",
        total: 85,
        warehouse: 64,
        shop: 17,
        customer: 4,
      },
      {
        title: "Pezzi in controllo da Antonella",
        state: "quality",
        total: 36,
        warehouse: 36,
        shop: 0,
        customer: 0,
      },
    ],
    "Import sulla catena reale",
  );
  eq(
    await scalar("select count(*)::int value from public.stock_movements"),
    movementsBefore,
    "Import: nessun movimento",
  );

  // 1 · Due arrivi dello stesso riordine: uno vince, l'altro trova la versione cambiata.
  const one = await restockOrder("Arrivo conteso", [
    ["warehouse", "GT3RS", "Blu", "M", 3],
    ["shop", "GT3RS", "Blu", "S", 1],
  ]);
  const beforeM = await balance(item("GT3RS", "Blu", "M"), central);
  await begin(a, "logistics");
  const won = await call(a, "receive_restock_order", receive(one, 2, 4));
  await begin(b, "founder");
  let pending = settle(call(b, "receive_restock_order", receive(one, 2, 4)));
  await waitsOn(bPid, aPid);
  await a.query("commit");
  let late = await pending;
  await b.query("rollback");
  eq(won.pieces, 4, "Primo arrivo: 4 pezzi");
  eq(
    { ok: late.ok, code: late.code, message: late.message },
    { ok: false, code: "22023", message: "stale_version" },
    "Secondo arrivo concorrente: stale_version",
  );
  eq(
    [
      await balance(item("GT3RS", "Blu", "M"), central),
      await scalar("select count(*)::int value from public.restock_arrivals where order_id=$1", [
        one,
      ]),
      await scalar(
        "select count(*)::int value from public.stock_movements where source->>'restock_order_id'=$1",
        [one],
      ),
    ],
    [beforeM + 3, 1, 2],
    "Un solo carico: un arrivo, due movimenti",
  );

  // 2 · Lo stesso invio ripetuto mentre il primo è in corso: una sola ricevuta.
  const two = await restockOrder("Invio ripetuto", [["warehouse", "SL", "Azzurro", "L", 2]]);
  const repeated = randomUUID();
  await begin(a, "logistics");
  const firstTry = await call(a, "receive_restock_order", receive(two, 2, 2), repeated);
  await begin(b, "logistics");
  pending = settle(call(b, "receive_restock_order", receive(two, 2, 2), repeated));
  await waitsOn(bPid, aPid);
  await a.query("commit");
  late = await pending;
  await b.query("commit");
  eq(
    late.ok && late.result,
    { ...firstTry, replayed: true },
    "Il secondo invio recupera la ricevuta",
  );
  eq(
    await scalar("select count(*)::int value from public.restock_arrivals where order_id=$1", [
      two,
    ]),
    1,
    "Un solo arrivo per lo stesso invio",
  );

  // 3 · Annulla arrivo contro una rettifica sull'ultimo pezzo libero, nei due ordini.
  const last = item("F40", "Bianco", "XXL");
  await run("logistics", "save_restock_order", {
    schema_version: 1,
    order_id: null,
    expected_version: null,
    title: "Ultimo pezzo",
    notes: "",
    shop_location_id: null,
  });
  const three = await scalar(
    "select id::text value from public.restock_orders where title='Ultimo pezzo'",
  );
  await run("logistics", "set_restock_lines", {
    schema_version: 1,
    order_id: three,
    expected_version: 1,
    lines: [
      {
        destination: "warehouse",
        product_id: products.F40,
        color: "Bianco",
        size: "XXL",
        quantity: 1,
      },
    ],
  });
  await begin(a, "logistics");
  await adjust(a, last, -2);
  await a.query("commit");
  await run("logistics", "receive_restock_order", receive(three, 2, 1));
  eq(await balance(last, central), 1, "Un solo pezzo nel Magadzino, quello del riordine");
  await begin(a, "logistics");
  await adjust(a, last, -1);
  await begin(b, "founder");
  pending = settle(call(b, "undo_restock_arrival", undo(three, await version(three))));
  await waitsOn(bPid, aPid);
  await a.query("commit");
  late = await pending;
  await b.query("rollback");
  eq(
    { ok: late.ok, code: late.code, message: late.message, detail: late.detail },
    {
      ok: false,
      code: "22023",
      message: "restock_stock_used",
      detail: sku("F40", "Bianco", "XXL"),
    },
    "Rettifica prima: l'annullo trova il pezzo già uscito",
  );
  eq([await balance(last, central), await negative()], [0, 0], "Nessuna giacenza negativa");
  await run("logistics", "save_restock_order", {
    schema_version: 1,
    order_id: three,
    expected_version: await version(three),
    title: "Ultimo pezzo",
    notes: "Rimesso a posto",
    shop_location_id: null,
  });
  await begin(a, "logistics");
  await adjust(a, last, 1);
  await a.query("commit");
  await begin(a, "founder");
  const undone = await call(a, "undo_restock_arrival", undo(three, await version(three)));
  await begin(b, "logistics");
  pending = settle(adjust(b, last, -1));
  await waitsOn(bPid, aPid);
  await a.query("commit");
  late = await pending;
  await b.query("rollback");
  eq(undone.state, "discussion", "Annullo prima: il riordine torna in discussione");
  eq(
    { ok: late.ok, code: late.code, message: late.message },
    { ok: false, code: "22023", message: "La rettifica produrrebbe una giacenza negativa." },
    "La rettifica dopo l'annullo non trova il pezzo",
  );
  eq([await balance(last, central), await negative()], [0, 0], "Annullo vinto: giacenza a zero");

  // 4 · Annulla arrivo contro l'ordine del negozio legato al riordine, nei due ordini.
  const four = await restockOrder("Per il negozio", [["shop", "964", "Bianco", "M", 2]]);
  await run("logistics", "receive_restock_order", receive(four, 2, 2));
  const fourLines = [{ stock_item_id: item("964", "Bianco", "M"), quantity: 2 }];
  await begin(a, "logistics");
  const linked = await call(a, "save_consignment_order", shopOrder(four, fourLines));
  await begin(b, "founder");
  pending = settle(call(b, "undo_restock_arrival", undo(four, 3)));
  await waitsOn(bPid, aPid);
  await a.query("commit");
  late = await pending;
  await b.query("rollback");
  eq(
    { ok: late.ok, code: late.code, message: late.message, detail: late.detail },
    { ok: false, code: "22023", message: "shop_order_linked", detail: String(linked.order_number) },
    "Ordine del negozio prima: l'annullo è rifiutato con il numero dell'ordine",
  );
  const five = await restockOrder("Annullo prima dell'ordine", [["shop", "964", "Bianco", "L", 1]]);
  await run("logistics", "receive_restock_order", receive(five, 2, 1));
  await begin(a, "founder");
  await call(a, "undo_restock_arrival", undo(five, 3));
  await begin(b, "logistics");
  pending = settle(
    call(
      b,
      "save_consignment_order",
      shopOrder(five, [{ stock_item_id: item("964", "Bianco", "L"), quantity: 1 }]),
    ),
  );
  await waitsOn(bPid, aPid);
  await a.query("commit");
  late = await pending;
  await b.query("rollback");
  eq(
    { ok: late.ok, code: late.code, message: late.message },
    { ok: false, code: "22023", message: "restock_not_ready" },
    "Annullo prima: l'ordine legato è rifiutato",
  );
  eq(
    await scalar(
      "select count(*)::int value from public.consignment_orders where restock_order_id=$1",
      [five],
    ),
    0,
    "Nessun ordine legato a un riordine non arrivato",
  );

  // 5 · Feed di Controllo CEO con la password CEO vera: frasi dei riordini, nessun importo.
  await begin(owner, "founder");
  const feed = (
    await owner.query("select public.ceo_activity_feed(null,'stock',null,null,50) value")
  ).rows[0].value;
  await owner.query("commit");
  const messages = feed.items.map((row) => row.message);
  for (const expected of [
    "Il sistema ha importato 2 riordini.",
    "Membro sintetico logistics ha caricato in Magadzino il riordine «Arrivo conteso»: 3 pezzi per noi e 1 per Libreria sintetica Milano.",
    "Membro sintetico founder ha annullato l’arrivo del riordine «Ultimo pezzo»: 1 pezzo tolto da Magadzino.",
    "Membro sintetico logistics ha creato il riordine «Per il negozio».",
  ])
    ok(messages.includes(expected), `Feed: «${expected}»`);
  ok(
    feed.items.every((row) => row.area === "stock" && /^\/stock(\/|$)/.test(row.href ?? "/stock")),
    "Area Magazzino e link del riassortimento",
  );
  ok(
    feed.items.some((row) => row.href === `/stock/riassortimento/${one}`),
    "Link al riordine",
  );
  eq(messages.filter((message) => /€/.test(message)).length, 0, "Nessun importo nel feed");

  console.log(
    `PASS ${checks} riassortimento concurrency checks; PostgreSQL 17 reale, catena completa, dati sintetici, nessun cloud.`,
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
