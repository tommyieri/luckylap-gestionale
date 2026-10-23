// test-db: postgres minimo 120
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
const directory = mkdtempSync("/private/tmp/luckylap-sale-returns-"),
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
    "insert into private.sensitive_area_credentials(area,password_hash)values('finance',extensions.crypt('synthetic-password',extensions.gen_salt('bf',10)))",
  );
  await as("founder", "select public.unlock_sensitive_area('finance','synthetic-password')");
  const central = randomUUID(),
    item = randomUUID(),
    product = randomUUID(),
    box = randomUUID(),
    sticker = randomUUID();
  await db.query(
    "insert into public.stock_locations(id,code,name,location_type)values($1,'MAG01','Magazzino sintetico','Magazzino')",
    [central],
  );
  await db.query(
    "insert into public.stock_items(id,kind,sku,name,unit_cost_eur,list_price_eur)values($1,'product','SYN-CANCEL','Maglietta sintetica',3,8),($2,'packaging','SYN-CANCEL-BOX','Scatola sintetica',1,null),($3,'packaging','SYN-CANCEL-STICKER','Adesivo sintetico',1,null)",
    [item, box, sticker],
  );
  await db.query(
    "insert into public.products(id,model,category)values($1,'SYN-CANCEL','T-shirt')",
    [product],
  );
  await db.query(
    "insert into public.product_variants(stock_item_id,product_id,color,size)values($1,$2,'Test','M')",
    [item, product],
  );
  await db.query(
    "insert into public.packaging_items(stock_item_id,packaging_type)values($1,'box'),($2,'sticker')",
    [box, sticker],
  );
  for (const id of [item, box, sticker])
    await db.query(
      "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,'opening',100,'Apertura sintetica')",
      [randomUUID(), id, central],
    );
  await db.query(
    "update public.packaging_automation set location_id=$1,box_item_id=$2,sticker_item_id=$3,started_at=now()-interval '1 day'",
    [central, box, sticker],
  );
  await db.query(
    "update public.app_settings set manual_sales_enabled=true,sales_started_at=now()-interval '1 day',stock_adjustments_enabled=true",
  );
  const balance = async (id) =>
    Number(
      await scalar(
        "select quantity value from public.stock_balances where stock_item_id=$1 and location_id=$2",
        [id, central],
      ),
    );
  const count = async (table) => Number(await scalar(`select count(*) value from ${table}`));
  const preview = async (order, who = "logistics") =>
    (await as(who, "select public.preview_manual_sale_cancellation($1) value", [order]))[0].value;
  const cancellation = (order, p) => ({
    schema_version: 1,
    order_id: order,
    expected_version: p.expected_version,
    reason: "Registrazione sintetica errata",
    confirm_stock: true,
  });
  const register = async (qty = 3, mode = "delivered_now", paid = true, discount = 2) => {
    const op = randomUUID(),
      at = new Date(Date.now() - 1000).toISOString(),
      total = 100 * qty - discount;
    const payload = {
      schema_version: 1,
      channel: "direct",
      occurred_at: at,
      location_id: central,
      lines: [
        { stock_item_id: item, quantity: qty, unit_price_cents: 100, discount_cents: discount },
      ],
      fulfillment_mode: mode,
      payment: paid
        ? { status: "paid", method: "cash", amount_cents: total, occurred_at: at }
        : { status: "unpaid" },
      reason: "Prova reso sintetica",
    };
    const result = await rpc("register_manual_sale", payload, "logistics", op);
    const line = await scalar("select id value from public.sales_order_lines where order_id=$1", [
      result.order_id,
    ]);
    return { order: result.order_id, line, payload, op, total };
  };
  const request = (o, qty = 0, extra = {}) => ({
    schema_version: 1,
    order_id: o.order,
    lines: qty ? [{ order_line_id: o.line, quantity: qty }] : [],
    reusable_boxes: 0,
    reusable_stickers: 0,
    refund_account: qty ? "Cash" : "",
    ...extra,
  });
  const quote = async (p, who = "logistics") =>
    (
      await as(who, "select public.preview_manual_sale_return($1::jsonb)value", [JSON.stringify(p)])
    )[0].value;
  const confirmation = (p, q, extra = {}) => ({
    ...p,
    expected_version: q.expected_version,
    occurred_at: new Date().toISOString(),
    reason: "Reso sintetico verificato",
    refund_completed_confirmed: true,
    ...extra,
  });
  const returned = async (p, q = undefined, who = "logistics", op = randomUUID()) =>
    rpc("return_manual_sale_registration", confirmation(p, q ?? (await quote(p))), who, op);
  const summary = async (o) =>
    scalar("select private.effective_order_payment_summary($1)value", [o.order]);
  const snapshot = async () => [
    await count("public.manual_sale_returns"),
    await count("public.stock_movements"),
    await count("public.finance_entries"),
  ];
  const sale = await register();
  const initial = await quote(request(sale));
  eq(initial.product_quantity, 0, "Anteprima iniziale senza selezione o conto");
  eq(
    initial.lines.map((l) => [
      l.order_line_id,
      l.available_quantity,
      l.selected_quantity,
      l.refund_cents,
    ]),
    [[sale.line, 3, 0, 0]],
    "Tutte le righe rendibili e nessuna selezione implicita",
  );
  eq(
    [await balance(item), await balance(box), await balance(sticker)],
    [97, 97, 97],
    "Vendita iniziale scarica capi e packaging",
  );
  await rejected(quote(request(sale), "outsider"), "42501", "Estraneo escluso");
  eq(
    await scalar(
      "select has_function_privilege('anon','public.preview_manual_sale_return(jsonb)','EXECUTE')value",
    ),
    false,
    "Anon escluso da anteprima",
  );
  eq(
    await scalar(
      "select has_function_privilege('authenticated','private.normalize_manual_sale_return(jsonb)','EXECUTE')value",
    ),
    false,
    "Normalizzatore privato non eseguibile",
  );
  await rejected(
    as("logistics", "insert into public.manual_sale_returns(order_id)values($1)", [sale.order]),
    "42501",
    "Nessuna scrittura diretta ledger",
  );
  await rejected(quote(request(sale, 4)), "22023", "Quantità oltre consegnato rifiutata");
  await rejected(
    quote(request(sale, 1, { refund_account: "" })),
    "22023",
    "Conto rimborso richiesto per selezione",
  );
  await rejected(
    quote(
      request(sale, 1, {
        lines: [
          { order_line_id: sale.line, quantity: 1 },
          { order_line_id: sale.line, quantity: 1 },
        ],
      }),
    ),
    "22023",
    "Righe duplicate rifiutate",
  );
  await rejected(
    quote(request(sale, 1, { reusable_boxes: 2 })),
    "22023",
    "Packaging non supera capi restituiti",
  );
  await rejected(
    returned(request(sale), initial),
    "22023",
    "Reso senza rimborso positivo non registrabile",
  );
  const p1 = request(sale, 1, { reusable_boxes: 1 }),
    q1 = await quote(p1),
    op = randomUUID(),
    c1 = confirmation(p1, q1);
  eq(
    [q1.refund_cents, q1.reusable_boxes_available, q1.reusable_stickers_available],
    [99, 1, 1],
    "Prima frazione scontata e materiali riutilizzabili disponibili",
  );
  await rejected(
    rpc(
      "return_manual_sale_registration",
      { ...c1, refund_completed_confirmed: false },
      "logistics",
    ),
    "22023",
    "Rimborso già effettuato richiede conferma",
  );
  const first = await rpc("return_manual_sale_registration", c1, "logistics", op);
  eq(
    [first.refund_cents, first.product_quantity, first.box_quantity, first.sticker_quantity],
    [99, 1, 1, 0],
    "Registrazione resa parziale",
  );
  eq(
    [await balance(item), await balance(box), await balance(sticker)],
    [98, 98, 97],
    "Rientro capo, sola scatola confermata riutilizzabile",
  );
  eq(
    await scalar("select order_state value from public.sales_orders where id=$1", [sale.order]),
    "partially_returned",
    "Stato reso parziale",
  );
  let s = await summary(sale);
  eq(
    [s.net_cents, s.amount_due_cents, s.refund_due_cents],
    ["199", "0", "0"],
    "Rimborso non crea falso nuovo credito",
  );
  const refund = await scalar(
    "select finance_entry_id value from public.manual_sale_returns where id=$1",
    [first.return_id],
  );
  eq(
    await scalar(
      "select jsonb_build_array(entry_type,amount_cents,account_label,category)value from public.finance_entries where id=$1",
      [refund],
    ),
    ["expense", 99, "Cash", "Vendite"],
    "Unica uscita Finance sul conto dichiarato",
  );
  eq(
    await scalar("select private.finance_revision_original('manual',$1)->>'order_id'value", [
      refund,
    ]),
    sale.order,
    "P4 riconosce il genitore del rimborso",
  );
  eq(
    (await as("logistics", "select *from public.finance_entries")).length,
    0,
    "Reso non apre Finance a chi non è autorizzato",
  );
  const operational = (
    await as("logistics", "select public.read_sales_effective_payments($1::uuid[])value", [
      [sale.order],
    ])
  )[0].value[0];
  eq(
    [operational.net_cents, operational.incoming_cents, operational.outgoing_cents],
    [undefined, undefined, undefined],
    "Proiezione operativa non espone conti o flussi Finance",
  );
  eq(operational.amount_due_cents, "0", "Proiezione operativa vede il residuo corretto");
  await rejected(preview(sale.order), "22023", "Annullo registrazione rifiutato dopo vero reso");
  await rejected(
    rpc("return_manual_sale_registration", c1, "finance", op),
    "22023",
    "Stessa operazione non trasferibile ad altro membro",
  );
  const stable = await snapshot();
  eq(
    (await rpc("return_manual_sale_registration", c1, "logistics", op)).replayed,
    true,
    "Replay stesso invio riuscito",
  );
  eq(await snapshot(), stable, "Replay non duplica soldi o stock");
  await rejected(
    rpc(
      "return_manual_sale_registration",
      { ...c1, reason: "Altro motivo sintetico" },
      "logistics",
      op,
    ),
    "22023",
    "UUID riutilizzato con motivo differente rifiutato",
  );
  const second = await returned(request(sale, 1));
  eq(second.refund_cents, 99, "Seconda frazione conserva il resto");
  const third = await returned(request(sale, 1, { reusable_boxes: 1, reusable_stickers: 1 }));
  eq(third.refund_cents, 100, "Ultima unità riceve il centesimo residuo");
  eq(
    [await balance(item), await balance(box), await balance(sticker)],
    [100, 99, 98],
    "Confezioni non riutilizzabili non riaccreditate",
  );
  s = await summary(sale);
  eq(
    [s.net_cents, s.amount_due_cents, s.refund_due_cents, s.payment_state],
    ["0", "0", "0", "refunded"],
    "Reso completo chiude saldo senza centesimi fantasma",
  );
  eq(
    await scalar(
      "select jsonb_build_array(order_state,fulfillment_state)value from public.sales_orders where id=$1",
      [sale.order],
    ),
    ["returned", "returned"],
    "Stati ordine reso completo",
  );
  eq((await quote(request(sale))).lines, [], "Nessuna quantità rendibile dopo reso totale");
  await rejected(returned(request(sale, 1)), "22023", "Reso doppio impedito");
  eq(
    (await rpc("return_manual_sale_registration", c1, "logistics", op)).replayed,
    true,
    "Replay storico disponibile anche dopo altri resi",
  );
  await rejected(
    db.query("update public.manual_sale_returns set reason='Tentativo sintetico'where id=$1", [
      first.return_id,
    ]),
    "42501",
    "Storico immutabile anche proprietario",
  );
  await rejected(
    db.query("delete from public.manual_sale_return_lines where return_id=$1", [first.return_id]),
    "42501",
    "Dettagli del reso immutabili",
  );

  const unpaid = await register(1, "delivered_now", false, 0),
    before = await snapshot();
  await rejected(quote(request(unpaid, 1)), "22023", "Nessun rimborso oltre incassi effettivi");
  eq(await snapshot(), before, "Rimborso non finanziato senza effetti");
  const pending = await register(1, "prepare", true, 0);
  await rejected(
    quote(request(pending, 1)),
    "22023",
    "Merce prenotata non consegnata non rientra come reso",
  );
  const cancelled = await register(1, "delivered_now", true, 0),
    cp = await preview(cancelled.order);
  await rpc("cancel_manual_sale_registration", cancellation(cancelled.order, cp), "logistics");
  await rejected(quote(request(cancelled, 1)), "22023", "Vendita già annullata non resa");

  // Riduzione commerciale cumulativa: annullo prima o dopo reso, centesimi esatti.
  for (const returnFirst of [false, true]) {
    const partial = await register(3, "prepare", true, 2);
    await rpc(
      "fulfill_order_lines",
      {
        order_id: partial.order,
        lines: [{ order_line_id: partial.line, quantity: 2 }],
        occurred_at: new Date().toISOString(),
        reason: "Consegna sintetica parziale",
      },
      "logistics",
    );
    if (returnFirst)
      eq(
        (await returned(request(partial, 1))).refund_cents,
        99,
        "Reso iniziale prima dell'annullo",
      );
    await rpc(
      "cancel_unfulfilled_lines",
      {
        order_id: partial.order,
        lines: [{ order_line_id: partial.line, quantity: 1 }],
        occurred_at: new Date().toISOString(),
        reason: "Annullamento sintetico residuo",
      },
      "logistics",
    );
    const r = await returned(request(partial, returnFirst ? 1 : 2));
    eq(
      r.refund_cents,
      returnFirst ? 100 : 199,
      "Reso successivo assorbe il resto del prezzo scontato",
    );
    s = await summary(partial);
    eq(
      [s.amount_due_cents, s.refund_due_cents],
      ["0", "99"],
      "Nessun credito fantasma; rimane solo rimborso della quantità annullata",
    );
    eq(
      await scalar(
        "select o.cancelled_cents+coalesce(sum(r.refund_cents),0)value from public.sales_orders o left join public.manual_sale_returns r on r.order_id=o.id where o.id=$1 group by o.id",
        [partial.order],
      ),
      "298",
      "Riduzioni commerciali esattamente pari al totale",
    );
  }

  // P4 rettifica i soldi senza creare o togliere capi una seconda volta.
  const edited = await register(2, "delivered_now", true, 0),
    er = await returned(request(edited, 1));
  const entry = await scalar(
      "select finance_entry_id value from public.manual_sale_returns where id=$1",
      [er.return_id],
    ),
    day = await today(),
    stockBefore = await balance(item);
  await rpc(
    "revise_finance_movement",
    revision("manual", entry, 0, "update", {
      values: values(day, 70, { direction: "expense", description: "Rimborso sintetico corretto" }),
    }),
    "founder",
  );
  s = await summary(edited);
  eq(
    [s.net_cents, s.amount_due_cents, s.refund_due_cents],
    ["130", "0", "30"],
    "Correzione rimborso Finance aggiorna il saldo ordine",
  );
  eq(await balance(item), stockBefore, "Correzione Finance non tocca lo stock");
  await rpc("revise_finance_movement", revision("manual", entry, 1, "delete"), "founder");
  eq((await summary(edited)).net_cents, "200", "Eliminazione logica Finance esclusa dal netto");
  await rpc(
    "revise_finance_movement",
    revision("manual", entry, 2, "restore", { restore_version: 0 }),
    "founder",
  );
  eq((await summary(edited)).net_cents, "100", "Ripristino Finance ricalcola netto");
  const stale = request(edited, 1),
    staleQ = await quote(stale);
  await rpc(
    "revise_finance_movement",
    revision("manual", entry, 3, "update", {
      values: values(day, 100, {
        direction: "expense",
        description: "Solo descrizione sintetica diversa",
      }),
    }),
    "founder",
  );
  await rejected(
    returned(stale, staleQ),
    "22023",
    "CAS rileva persino una revisione Finance senza cambio importo",
  );

  // Concorrenza reale: due connessioni non possono restituire lo stesso capo.
  const race = await register(1, "delivered_now", true, 0),
    rp = request(race, 1),
    rq = await quote(rp),
    raceBefore = await balance(item);
  const connection = async () => {
    const c = new Client({
      host: socket,
      user: "postgres",
      database: "postgres",
      ssl: false,
      statement_timeout: 15000,
    });
    await c.connect();
    clients.push(c);
    return c;
  };
  const tx = async (c, who, sql, params) => {
    await c.query("begin");
    try {
      await c.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: users[who], session_id: sessions[who], aal: "aal1" }),
      ]);
      await c.query("set local role authenticated");
      const r = (await c.query(sql, params)).rows;
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  };
  const cA = await connection(),
    cB = await connection(),
    payloadA = confirmation(rp, rq),
    payloadB = confirmation(rp, rq);
  const settled = await Promise.allSettled([
    tx(cA, "logistics", "select public.return_manual_sale_registration($1,$2::jsonb)value", [
      randomUUID(),
      JSON.stringify(payloadA),
    ]),
    tx(cB, "consultant", "select public.return_manual_sale_registration($1,$2::jsonb)value", [
      randomUUID(),
      JSON.stringify(payloadB),
    ]),
  ]);
  eq(settled.filter((x) => x.status === "fulfilled").length, 1, "Un solo reso concorrente riesce");
  eq(
    settled.filter((x) => x.status === "rejected").length,
    1,
    "L'altro reso concorrente rifiutato",
  );
  eq(await balance(item), raceBefore + 1, "Una sola compensazione fisica concorrente");
  eq(
    await scalar("select count(*)::int value from public.manual_sale_returns where order_id=$1", [
      race.order,
    ]),
    1,
    "Un solo rimborso concorrente registrato",
  );
  const contested = await register(1, "delivered_now", true, 0),
    contestedReturn = request(contested, 1),
    contestedQ = await quote(contestedReturn),
    contestedCancel = await preview(contested.order),
    contestedBefore = await balance(item);
  const race2 = await Promise.allSettled([
    tx(cA, "logistics", "select public.return_manual_sale_registration($1,$2::jsonb)value", [
      randomUUID(),
      JSON.stringify(confirmation(contestedReturn, contestedQ)),
    ]),
    tx(cB, "consultant", "select public.cancel_manual_sale_registration($1,$2::jsonb)value", [
      randomUUID(),
      JSON.stringify(cancellation(contested.order, contestedCancel)),
    ]),
  ]);
  eq(
    race2.filter((x) => x.status === "fulfilled").length,
    1,
    "Annullo e reso concorrenti: una sola operazione valida",
  );
  eq(await balance(item), contestedBefore + 1, "Annullo contro reso non riaccredita due volte");
  eq(
    await scalar(
      "select(select count(*)from public.manual_sale_returns where order_id=$1)+(select count(*)from public.sales_registration_cancellations where order_id=$1)value",
      [contested.order],
    ),
    "1",
    "Un solo ramo definitivo della correzione",
  );

  // La correzione P4 cambia l'anteprima anche quando il reso attende lo stesso ordine.
  const financeRace = await register(1, "delivered_now", true, 0),
    financeRequest = request(financeRace, 1),
    financeQ = await quote(financeRequest),
    financePayment = await scalar("select id value from public.order_payments where order_id=$1", [
      financeRace.order,
    ]);
  await cA.query("begin");
  await cA.query("select id from public.sales_orders where id=$1 for update", [financeRace.order]);
  const waiting = tx(
    cB,
    "logistics",
    "select public.return_manual_sale_registration($1,$2::jsonb)value",
    [randomUUID(), JSON.stringify(confirmation(financeRequest, financeQ))],
  ).then(
    (v) => ({ ok: true, value: v }),
    (e) => ({ ok: false, error: e }),
  );
  let blocked = false;
  for (let i = 0; i < 100; i++) {
    const rows = await db.query("select wait_event_type from pg_stat_activity where pid=$1", [
      cB.processID,
    ]);
    if (rows.rows[0]?.wait_event_type === "Lock") {
      blocked = true;
      break;
    }
    await db.query("select pg_sleep(0.005)");
  }
  ok(blocked, "Il reso attende davvero il lock ordine");
  await cA.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: users.founder, session_id: sessions.founder, aal: "aal1" }),
  ]);
  await cA.query("set local role authenticated");
  await cA.query("select public.revise_finance_movement($1,$2::jsonb)", [
    randomUUID(),
    JSON.stringify(revision("payment", financePayment, 0, "update", { values: values(day, 90) })),
  ]);
  await cA.query("commit");
  const raced = await waiting;
  eq(raced.ok, false, "Correzione incasso sopraggiunta impedisce il rimborso non finanziato");
  eq(raced.error?.code, "22023", "Conflitto pagamento gestito senza errore infrastrutturale");
  eq(
    await scalar("select count(*)::int value from public.manual_sale_returns where order_id=$1", [
      financeRace.order,
    ]),
    0,
    "Race Finance non lascia rimborsi parziali",
  );

  // Una sessione scaduta durante l'attesa non può completare il reso.
  const expiry = await register(1, "delivered_now", true, 0),
    expiryRequest = request(expiry, 1),
    expiryQ = await quote(expiryRequest);
  await cA.query("begin");
  await cA.query("select id from public.sales_orders where id=$1 for update", [expiry.order]);
  await db.query(
    "update auth.sessions set not_after=clock_timestamp()+interval '100 milliseconds'where id=$1",
    [sessions.consultant],
  );
  const expiring = tx(
    cB,
    "consultant",
    "select public.return_manual_sale_registration($1,$2::jsonb)value",
    [randomUUID(), JSON.stringify(confirmation(expiryRequest, expiryQ))],
  ).then(
    (v) => ({ ok: true, value: v }),
    (e) => ({ ok: false, error: e }),
  );
  blocked = false;
  for (let i = 0; i < 100; i++) {
    const rows = await db.query("select wait_event_type from pg_stat_activity where pid=$1", [
      cB.processID,
    ]);
    if (rows.rows[0]?.wait_event_type === "Lock") {
      blocked = true;
      break;
    }
    await db.query("select pg_sleep(0.005)");
  }
  ok(blocked, "La sessione valida attende davvero il lock");
  await db.query("select pg_sleep(0.12)");
  await cA.query("commit");
  const expired = await expiring;
  eq(expired.ok, false, "Scadenza naturale in attesa impedisce il reso");
  eq(expired.error?.code, "42501", "Sessione scaduta esplicitamente negata");
  eq(
    await scalar("select count(*)::int value from public.manual_sale_returns where order_id=$1", [
      expiry.order,
    ]),
    0,
    "Nessun rimborso dopo scadenza naturale",
  );
  await db.query("update auth.sessions set not_after=null where id=$1", [sessions.consultant]);

  // Il vecchio annullo Finance può attendere il lock dopo i suoi controlli iniziali.
  // Una revisione P4 sopraggiunta deve prevalere sul vecchio comando, senza due storie.
  const legacySale = await register(2, "delivered_now", true, 0),
    legacyReturn = await returned(request(legacySale, 1)),
    legacyEntry = await scalar(
      "select finance_entry_id value from public.manual_sale_returns where id=$1",
      [legacyReturn.return_id],
    ),
    legacyStock = await balance(item);
  await cA.query("begin");
  await cA.query("select id from public.sales_orders where id=$1 for update", [legacySale.order]);
  const legacyVoidPayload = {
      schema_version: 1,
      entry_id: legacyEntry,
      reason: "Annullamento rimborso sintetico",
    },
    legacyVoidOperation = randomUUID();
  const legacyWaiting = tx(cB, "founder", "select public.void_finance_entry($1,$2::jsonb)value", [
    legacyVoidOperation,
    JSON.stringify(legacyVoidPayload),
  ]).then(
    (v) => ({ ok: true, value: v }),
    (e) => ({ ok: false, error: e }),
  );
  blocked = false;
  for (let i = 0; i < 100; i++) {
    const rows = await db.query("select wait_event_type from pg_stat_activity where pid=$1", [
      cB.processID,
    ]);
    if (rows.rows[0]?.wait_event_type === "Lock") {
      blocked = true;
      break;
    }
    await db.query("select pg_sleep(0.005)");
  }
  ok(blocked, "Vecchio annullo Finance attende davvero il genitore del rimborso");
  await cA.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: users.founder, session_id: sessions.founder, aal: "aal1" }),
  ]);
  await cA.query("set local role authenticated");
  await cA.query("select public.revise_finance_movement($1,$2::jsonb)", [
    randomUUID(),
    JSON.stringify(
      revision("manual", legacyEntry, 0, "update", {
        values: values(day, 80, {
          direction: "expense",
          description: "Rimborso rettificato durante attesa sintetica",
        }),
      }),
    ),
  ]);
  await cA.query("commit");
  const legacyResult = await legacyWaiting;
  eq(
    [legacyResult.ok, legacyResult.error?.code, legacyResult.error?.message],
    [false, "22023", "use_finance_revisions"],
    "P4 acquisito il genitore prevale sul vecchio annullo già in attesa",
  );
  eq(
    await scalar(
      "select count(*)::int value from public.finance_entry_voids where finance_entry_id=$1",
      [legacyEntry],
    ),
    0,
    "Nessun annullo legacy dopo una revisione P4 concorrente",
  );
  eq(
    await scalar(
      "select count(*)::int value from private.finance_work_receipts where operation_id=$1",
      [legacyVoidOperation],
    ),
    0,
    "Nessuna ricevuta di successo per annullo legacy respinto",
  );
  eq(
    (await summary(legacySale)).net_cents,
    "120",
    "Il saldo conserva la sola revisione P4 vincente",
  );
  eq(await balance(item), legacyStock, "La race Finance non compensa capi nuovamente");

  // Scadenza naturale sia dell'area Finance sia della sessione Auth durante l'attesa.
  for (const expires of ["grant", "session"]) {
    const timedSale = await register(2, "delivered_now", true, 0),
      timedReturn = await returned(request(timedSale, 1)),
      timedEntry = await scalar(
        "select finance_entry_id value from public.manual_sale_returns where id=$1",
        [timedReturn.return_id],
      ),
      timedOperation = randomUUID();
    await cA.query("begin");
    await cA.query("select id from public.sales_orders where id=$1 for update", [timedSale.order]);
    if (expires === "grant")
      await db.query(
        "update private.area_grants set expires_at=clock_timestamp()+interval '1 second'where session_id=$1 and area='finance'",
        [sessions.founder],
      );
    else
      await db.query(
        "update auth.sessions set not_after=clock_timestamp()+interval '1 second'where id=$1",
        [sessions.founder],
      );
    const timedWaiting = tx(cB, "founder", "select public.void_finance_entry($1,$2::jsonb)value", [
      timedOperation,
      JSON.stringify({
        schema_version: 1,
        entry_id: timedEntry,
        reason: "Annullamento con scadenza sintetica",
      }),
    ]).then(
      (v) => ({ ok: true, value: v }),
      (e) => ({ ok: false, error: e }),
    );
    blocked = false;
    for (let i = 0; i < 100; i++) {
      const rows = await db.query("select wait_event_type from pg_stat_activity where pid=$1", [
        cB.processID,
      ]);
      if (rows.rows[0]?.wait_event_type === "Lock") {
        blocked = true;
        break;
      }
      await db.query("select pg_sleep(0.005)");
    }
    ok(blocked, `Vecchio annullo Finance valido attende davvero il genitore: ${expires}`);
    await db.query("select pg_sleep(1.05)");
    await cA.query("commit");
    const timedResult = await timedWaiting;
    eq(
      [timedResult.ok, timedResult.error?.code, timedResult.error?.message],
      [false, "42501", "finance_access_required"],
      `Scadenza naturale ${expires} ricontrollata dopo il lock`,
    );
    eq(
      await scalar(
        "select count(*)::int value from public.finance_entry_voids where finance_entry_id=$1",
        [timedEntry],
      ),
      0,
      `Nessun annullo scritto dopo scadenza ${expires}`,
    );
    eq(
      await scalar(
        "select count(*)::int value from private.finance_work_receipts where operation_id=$1",
        [timedOperation],
      ),
      0,
      `Nessuna ricevuta scritta dopo scadenza ${expires}`,
    );
    eq(
      (await summary(timedSale)).net_cents,
      "100",
      `Saldo rimborso invariato dopo scadenza ${expires}`,
    );
    await db.query("update auth.sessions set not_after=null where id=$1", [sessions.founder]);
    await db.query(
      "update private.area_grants set expires_at=clock_timestamp()+interval '8 hours'where session_id=$1 and area='finance'",
      [sessions.founder],
    );
    await rpc(
      "void_finance_entry",
      {
        schema_version: 1,
        entry_id: timedEntry,
        reason: "Annullamento sintetico dopo accesso ripristinato",
      },
      "founder",
    );
    eq(
      (await summary(timedSale)).net_cents,
      "200",
      `Vecchio annullo del rimborso ancora valido dopo nuovo accesso: ${expires}`,
    );
  }

  // Deficit storico di packaging: il reso non crea confezioni mai consumate.
  const currentBox = await balance(box),
    currentSticker = await balance(sticker);
  await db.query(
    "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,'adjustment',$4,'Azzeramento sintetico packaging'),($5,$6,$3,'adjustment',$7,'Azzeramento sintetico packaging')",
    [randomUUID(), box, central, -currentBox, randomUUID(), sticker, -currentSticker],
  );
  const deficit = await register(2, "delivered_now", true, 0),
    deficitQ = await quote(request(deficit, 1));
  eq(
    [deficitQ.reusable_boxes_available, deficitQ.reusable_stickers_available],
    [0, 0],
    "Confezioni non consumate non si possono riaccreditare",
  );
  eq(
    await scalar(
      "select coalesce(sum(c.requested_quantity-c.consumed_quantity),0)value from public.packaging_consumptions c join public.fulfillment_lines f on f.id=c.source_id and c.source_kind='fulfillment'where f.order_line_id=$1",
      [deficit.line],
    ),
    "4",
    "Due capi senza scatole e adesivi lasciano quattro richieste",
  );
  await returned(request(deficit, 1));
  eq(
    await scalar(
      "select coalesce(sum(c.requested_quantity-c.consumed_quantity),0)value from public.packaging_consumptions c join public.fulfillment_lines f on f.id=c.source_id and c.source_kind='fulfillment'where f.order_line_id=$1",
      [deficit.line],
    ),
    "2",
    "Il reso parziale sopprime solo il fabbisogno delle sue confezioni",
  );
  await returned(request(deficit, 1));
  eq(
    await scalar(
      "select coalesce(sum(c.requested_quantity-c.consumed_quantity),0)value from public.packaging_consumptions c join public.fulfillment_lines f on f.id=c.source_id and c.source_kind='fulfillment'where f.order_line_id=$1",
      [deficit.line],
    ),
    "0",
    "Il reso totale azzera il deficit per quella consegna",
  );
  const fulfillment = await scalar(
    "select id value from public.fulfillment_lines where order_line_id=$1",
    [deficit.line],
  );
  await db.query("select private.observe_packaging_source('fulfillment',$1)", [fulfillment]);
  eq(
    [await balance(box), await balance(sticker)],
    [0, 0],
    "Recupero della fonte non consuma packaging per capi resi",
  );
  console.log(
    `PASS ${checks} controlli: resi manuali, rientri, rimborsi, centesimi, Finance e concorrenza.`,
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
