// test-db: postgres minimo 108
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
const directory = mkdtempSync("/private/tmp/luckylap-sale-cancellation-"),
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
    "insert into public.stock_locations(id,code,name,location_type)values($1,'SYN-MAG','Magazzino sintetico','Magazzino')",
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
      "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,'opening',5,'Apertura sintetica')",
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
  const register = async (qty = 2, mode = "delivered_now", paid = true) => {
    const op = randomUUID(),
      at = new Date(Date.now() - 1000).toISOString(),
      total = 777 * qty - 11;
    const payload = {
      schema_version: 1,
      channel: "direct",
      occurred_at: at,
      location_id: central,
      lines: [{ stock_item_id: item, quantity: qty, unit_price_cents: 777, discount_cents: 11 }],
      fulfillment_mode: mode,
      payment: paid
        ? { status: "paid", method: "cash", amount_cents: total, occurred_at: at }
        : { status: "unpaid" },
      reason: "Prova sintetica",
    };
    const result = await rpc("register_manual_sale", payload, "logistics", op);
    const line = await scalar("select id value from public.sales_order_lines where order_id=$1", [
      result.order_id,
    ]);
    return { order: result.order_id, line, payload, op, total };
  };
  const salesState = async (order) =>
    scalar(
      "select jsonb_build_object('state',o.order_state,'fulfillment',o.fulfillment_state,'cancelled',o.cancelled_cents,'refund',o.refund_due_cents,'payment',o.payment_state,'line_amount',(select sum(cancelled_amount_cents)from public.sales_order_lines where order_id=o.id),'open_qty',(select sum(quantity-fulfilled_quantity-cancelled_quantity)from public.sales_order_lines where order_id=o.id),'reserved',(select coalesce(sum(r.reserved_quantity),0)from public.stock_reservations r join public.sales_order_lines l on l.id=r.order_line_id where l.order_id=o.id),'deficit',(select coalesce(sum(r.required_quantity-r.completed_quantity-r.cancelled_quantity),0)from public.production_requirements r join public.sales_order_lines l on l.id=r.order_line_id where l.order_id=o.id))value from public.sales_orders o where o.id=$1",
      [order],
    );
  eq(
    (await as("logistics", "select * from public.finance_movement_revisions")).length,
    0,
    "Nessun accesso Finance operativo",
  );
  await rejected(preview(randomUUID(), "outsider"), "42501", "Estraneo escluso");
  eq(
    await scalar(
      "select has_function_privilege('authenticated','private.manual_sale_cancellation_state(uuid)','EXECUTE')value",
    ),
    false,
    "Snapshot privato non eseguibile",
  );
  eq(
    await scalar(
      "select has_function_privilege('anon','public.cancel_manual_sale_registration(uuid,jsonb)','EXECUTE')value",
    ),
    false,
    "Anon non può annullare",
  );
  const sale = await register(),
    payment = await scalar("select id value from public.order_payments where order_id=$1", [
      sale.order,
    ]);
  const rawPayment = await scalar(
    "select to_jsonb(p)value from public.order_payments p where id=$1",
    [payment],
  );
  const rawFulfillment = await scalar(
    "select jsonb_agg(to_jsonb(f))value from public.fulfillment_lines f where order_line_id=$1",
    [sale.line],
  );
  eq(
    [await balance(item), await balance(box), await balance(sticker)],
    [3, 3, 3],
    "Vendita scarica capi e packaging",
  );
  const first = await preview(sale.order);
  const casState = await scalar("select private.manual_sale_cancellation_state($1)value", [
    sale.order,
  ]);
  eq(
    casState.as_of_date,
    await today(),
    "Il CAS contiene il giorno Roma usato dai saldi effettivi",
  );
  eq(
    casState.effective_payment_summary.net_cents,
    String(sale.total),
    "Il CAS congela anche il netto Finance mostrato in anteprima",
  );
  eq(
    await scalar("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex')value", [
      JSON.stringify(casState),
    ]),
    first.expected_version,
    "L'hash restituito usa lo stato completo con la base temporale",
  );
  ok(
    await scalar(
      "select encode(sha256(convert_to(jsonb_set($1::jsonb,'{as_of_date}',to_jsonb((($1::jsonb->>'as_of_date')::date+1)::text))::text,'UTF8')),'hex')<>$2 value",
      [JSON.stringify(casState), first.expected_version],
    ),
    "Il passaggio del solo giorno invalida l'anteprima congelata",
  );
  eq(
    Object.keys(first).sort(),
    [
      "already_cancelled",
      "box_quantity",
      "expected_version",
      "order_id",
      "payment_cents",
      "product_quantity",
      "sticker_quantity",
    ].sort(),
    "Preview non espone conti, note o fonti Finance",
  );
  eq(
    [
      first.product_quantity,
      first.box_quantity,
      first.sticker_quantity,
      Number(first.payment_cents),
      first.already_cancelled,
    ],
    [2, 2, 2, sale.total, false],
    "Riepilogo esatto",
  );
  assert.match(first.expected_version, /^[0-9a-f]{64}$/);
  checks++;
  await rejected(
    rpc(
      "cancel_manual_sale_registration",
      { ...cancellation(sale.order, first), confirm_stock: false },
      "logistics",
    ),
    "22023",
    "Conferma magazzino obbligatoria",
  );
  const day = await today(),
    edited = sale.total - 111;
  await rpc(
    "revise_finance_movement",
    revision("payment", payment, 0, "update", { values: values(day, edited) }),
    "founder",
  );
  await rejected(
    rpc("cancel_manual_sale_registration", cancellation(sale.order, first), "logistics"),
    "22023",
    "CAS vede revisioni Finance intervenute",
  );
  eq(await count("public.sales_registration_cancellations"), 0, "Conflitto non crea marker");
  eq(
    [await balance(item), await balance(box), await balance(sticker)],
    [3, 3, 3],
    "Conflitto non restituisce giacenze",
  );
  const current = await preview(sale.order),
    op = randomUUID(),
    payload = cancellation(sale.order, current);
  eq(Number(current.payment_cents), edited, "Preview segue incasso effettivo corrente");
  eq(
    (await rpc("cancel_manual_sale_registration", payload, "logistics", op)).replayed,
    false,
    "Membro senza Finance annulla la sola registrazione",
  );
  eq(
    [await balance(item), await balance(box), await balance(sticker)],
    [5, 5, 5],
    "Ripristino esatto capi e packaging",
  );
  const state = await salesState(sale.order);
  eq(
    state,
    {
      state: "cancelled",
      fulfillment: "cancelled",
      cancelled: sale.total,
      refund: 0,
      payment: "unpaid",
      line_amount: sale.total,
      open_qty: 0,
      reserved: 0,
      deficit: 0,
    },
    "Header e righe rimangono compatibili col reader",
  );
  eq(
    await scalar("select fulfilled_quantity value from public.sales_order_lines where id=$1", [
      sale.line,
    ]),
    2,
    "Consegne storiche conservate",
  );
  eq(
    await scalar("select to_jsonb(p)value from public.order_payments p where id=$1", [payment]),
    rawPayment,
    "Incasso originale immutato",
  );
  eq(
    await scalar(
      "select jsonb_agg(to_jsonb(f))value from public.fulfillment_lines f where order_line_id=$1",
      [sale.line],
    ),
    rawFulfillment,
    "Fulfillment originale immutato",
  );
  const deleted = await scalar(
    "select to_jsonb(r)value from public.finance_revision_current r where source_kind='payment'and source_id=$1",
    [payment],
  );
  eq(
    [
      deleted.action,
      deleted.deleted,
      deleted.previous_version,
      deleted.version,
      deleted.value_snapshot.amount_cents,
    ],
    ["delete", true, 1, 2, edited],
    "Esclusione P4 conserva full snapshot rettificato",
  );
  eq(
    await scalar(
      "select count(*)::int value from private.finance_revision_receipts where operation_id=$1",
      [deleted.operation_id],
    ),
    1,
    "Ricevuta P4 della cancellazione presente",
  );
  eq(
    (
      await as("logistics", "select public.read_sales_effective_payments($1::uuid[])value", [
        [sale.order],
      ])
    )[0].value[0].amount_due_cents,
    "0",
    "Finance effettiva senza residuo da incassare",
  );
  await rejected(
    rpc(
      "revise_finance_movement",
      revision("payment", payment, 2, "restore", { restore_version: 1 }),
      "founder",
    ),
    "22023",
    "Ripristino Finance non riattiva ordine annullato",
  );
  await rejected(
    rpc(
      "record_manual_payment",
      {
        order_id: sale.order,
        amount_cents: sale.total,
        method: "cash",
        occurred_at: new Date().toISOString(),
      },
      "logistics",
    ),
    "22023",
    "Nuovo incasso impedito",
  );
  const movements = await count("public.stock_movements"),
    revisions = await count("public.finance_movement_revisions");
  eq(
    (await rpc("cancel_manual_sale_registration", payload, "logistics", op)).replayed,
    true,
    "Replay esatto disponibile",
  );
  eq(
    [await count("public.stock_movements"), await count("public.finance_movement_revisions")],
    [movements, revisions],
    "Replay non compensa due volte",
  );
  await rejected(
    rpc(
      "cancel_manual_sale_registration",
      { ...payload, reason: "Motivo sintetico diverso" },
      "logistics",
      op,
    ),
    "22023",
    "Operazione congelata respinge payload mutato",
  );
  await rejected(
    rpc("cancel_manual_sale_registration", payload, "production", op),
    "22023",
    "Ricevuta vincolata all'attore",
  );
  await rejected(
    rpc("cancel_manual_sale_registration", payload, "logistics"),
    "22023",
    "Nuovo operation ID non annulla due volte",
  );
  eq(
    (await rpc("register_manual_sale", sale.payload, "logistics", sale.op)).replayed,
    true,
    "Vecchia ricevuta registrazione recuperabile",
  );
  eq((await salesState(sale.order)).state, "cancelled", "Vecchio replay non riattiva stato");
  eq((await preview(sale.order)).already_cancelled, true, "Preview identifica marker esistente");
  eq(
    (await as("logistics", "select * from public.finance_movement_revisions")).length,
    0,
    "Revisioni automatiche non allargano Finance",
  );
  const mixed = await register(10, "prepare", true);
  const requirement = await scalar(
    "select id value from public.production_requirements where order_line_id=$1",
    [mixed.line],
  );
  await rpc(
    "complete_production",
    {
      requirement_id: requirement,
      quantity: 2,
      occurred_at: new Date().toISOString(),
      reason: "Produzione sintetica reale",
    },
    "production",
  );
  await rpc(
    "fulfill_order_lines",
    {
      order_id: mixed.order,
      lines: [{ order_line_id: mixed.line, quantity: 1 }],
      occurred_at: new Date().toISOString(),
      reason: "Consegna sintetica",
    },
    "logistics",
  );
  await rpc(
    "cancel_unfulfilled_lines",
    {
      order_id: mixed.order,
      lines: [{ order_line_id: mixed.line, quantity: 2 }],
      occurred_at: new Date().toISOString(),
      reason: "Annullamento sintetico parziale",
    },
    "logistics",
  );
  const mixedPreview = await preview(mixed.order);
  eq(mixedPreview.product_quantity, 1, "Si restituisce solo l'uscita fisica già effettuata");
  await rpc(
    "cancel_manual_sale_registration",
    cancellation(mixed.order, mixedPreview),
    "logistics",
  );
  eq(await balance(item), 7, "Produzione completata resta fisicamente disponibile");
  eq(
    await scalar(
      "select jsonb_build_array(required_quantity,completed_quantity,cancelled_quantity,status)value from public.production_requirements where id=$1",
      [requirement],
    ),
    [5, 2, 3, "satisfied"],
    "Chiude solo produzione ancora aperta",
  );
  const mixedState = await salesState(mixed.order);
  eq(
    [
      mixedState.cancelled,
      mixedState.line_amount,
      mixedState.open_qty,
      mixedState.reserved,
      mixedState.deficit,
    ],
    [mixed.total, mixed.total, 0, 0, 0],
    "Annullo dopo parziale conserva residui coerenti",
  );
  await rejected(
    rpc(
      "complete_production",
      {
        requirement_id: requirement,
        quantity: 1,
        occurred_at: new Date().toISOString(),
        reason: "Produzione tardiva sintetica",
      },
      "production",
    ),
    "22023",
    "Produzione tardiva non riattiva fabbisogno",
  );
  const adjust = async (id, quantity) =>
    rpc(
      "adjust_packaging_quantity",
      {
        schema_version: 1,
        stock_item_id: id,
        expected_quantity: await balance(id),
        quantity,
        reason: "Conta sintetica",
      },
      "logistics",
    );
  await adjust(box, 1);
  await adjust(sticker, 0);
  const deficit = await register(2),
    dp = await preview(deficit.order);
  eq(
    [dp.box_quantity, dp.sticker_quantity],
    [1, 0],
    "Preview restituisce solo packaging realmente consumato",
  );
  eq(
    Number(
      await scalar("select sum(consumption_deficit)value from public.packaging_material_status"),
    ),
    3,
    "Deficit prima dell'annullo",
  );
  await rpc("cancel_manual_sale_registration", cancellation(deficit.order, dp), "logistics");
  eq(
    [await balance(box), await balance(sticker)],
    [1, 0],
    "Nessun reso fittizio del packaging mancante",
  );
  eq(
    Number(
      await scalar("select sum(consumption_deficit)value from public.packaging_material_status"),
    ),
    0,
    "Deficit annullato non compare nella domanda",
  );
  await adjust(box, 20);
  await adjust(sticker, 20);
  await rpc("reconcile_packaging_consumption", { schema_version: 1 }, "logistics");
  eq(
    [await balance(box), await balance(sticker)],
    [20, 20],
    "Riconciliazione non riaddebita fonte annullata",
  );
  await db.query(
    "select private.observe_packaging_source('fulfillment',f.id)from public.fulfillment_lines f where order_line_id=$1",
    [deficit.line],
  );
  eq(
    [await balance(box), await balance(sticker)],
    [20, 20],
    "Osservazione ripetuta fonte storica è innocua",
  );
  await db.query(
    "create function public.qa_fail_package()returns trigger language plpgsql as $$begin if new.source->>'kind'='packaging_consumption'then raise exception 'Synthetic packaging failure';end if;return new;end$$;create trigger qa_fail_package before insert on public.stock_movements for each row execute function public.qa_fail_package()",
  );
  const failed = await register(1),
    fp = await preview(failed.order);
  eq([fp.box_quantity, fp.sticker_quantity], [0, 0], "Fallimento packaging non inventa consumo");
  eq(
    Number(
      await scalar(
        "select count(*)value from public.packaging_automation_failures where not resolved",
      ),
    ),
    1,
    "Failure differita tracciata",
  );
  await rpc("cancel_manual_sale_registration", cancellation(failed.order, fp), "logistics");
  eq(
    Number(
      await scalar(
        "select count(*)value from public.packaging_automation_failures where not resolved",
      ),
    ),
    0,
    "Failure della fonte annullata chiusa",
  );
  await db.query(
    "drop trigger qa_fail_package on public.stock_movements;drop function public.qa_fail_package()",
  );
  await rpc("reconcile_packaging_consumption", { schema_version: 1 }, "logistics");
  eq(
    [await balance(box), await balance(sticker)],
    [20, 20],
    "Recovery differita non produce nuovi consumi",
  );
  const rollback = await register(1),
    rp = await preview(rollback.order),
    beforeBalances = [await balance(item), await balance(box), await balance(sticker)],
    beforeRevisions = await count("public.finance_movement_revisions");
  await db.query(
    "create function public.qa_fail_cancellation()returns trigger language plpgsql as $$begin if new.source->>'kind'='manual_sale_registration_cancellation'and exists(select 1 from public.packaging_items where stock_item_id=new.stock_item_id and packaging_type='sticker')then raise exception 'Synthetic cancellation failure';end if;return new;end$$;create trigger qa_fail_cancellation before insert on public.stock_movements for each row execute function public.qa_fail_cancellation()",
  );
  await rejected(
    rpc("cancel_manual_sale_registration", cancellation(rollback.order, rp), "logistics"),
    "P0001",
    "Errore tardivo annulla tutta la transazione",
  );
  eq(
    [await balance(item), await balance(box), await balance(sticker)],
    beforeBalances,
    "Compensazioni intermedie rollback",
  );
  eq(
    await count("public.finance_movement_revisions"),
    beforeRevisions,
    "Nessuna revisione da operazione fallita",
  );
  eq(
    (await preview(rollback.order)).expected_version,
    rp.expected_version,
    "CAS e fonti invariati dopo rollback",
  );
  eq(
    Number(
      await scalar(
        "select count(*)value from public.sales_registration_cancellations where order_id=$1",
        [rollback.order],
      ),
    ),
    0,
    "Nessun marker parziale",
  );
  await db.query(
    "drop trigger qa_fail_cancellation on public.stock_movements;drop function public.qa_fail_cancellation()",
  );
  // Two real connections race on the same aggregate and independent operation IDs.
  async function connected(who, sql, params) {
    const client = new Client({
      host: socket,
      user: "postgres",
      database: "postgres",
      ssl: false,
      statement_timeout: 15000,
    });
    clients.push(client);
    await client.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: users[who], session_id: sessions[who], aal: "aal1" }),
      ]);
      await client.query("set local role authenticated");
      const rows = (await client.query(sql, params)).rows;
      await client.query("commit");
      return rows;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      await client.end();
      clients.splice(clients.indexOf(client), 1);
    }
  }
  const concurrent = await register(1),
    cp = await preview(concurrent.order),
    cpayload = JSON.stringify(cancellation(concurrent.order, cp));
  const race = await Promise.allSettled([
    connected("logistics", "select public.cancel_manual_sale_registration($1,$2::jsonb)value", [
      randomUUID(),
      cpayload,
    ]),
    connected("production", "select public.cancel_manual_sale_registration($1,$2::jsonb)value", [
      randomUUID(),
      cpayload,
    ]),
  ]);
  eq(
    race.filter((r) => r.status === "fulfilled").length,
    1,
    "Due annulli concorrenti: una sola compensazione",
  );
  eq(
    race.filter((r) => r.status === "rejected")[0].reason.message,
    "sale_registration_cancelled",
    "Secondo annullo concorrente respinto",
  );
  eq(
    Number(
      await scalar(
        "select count(*)value from public.sales_registration_cancellations where order_id=$1",
        [concurrent.order],
      ),
    ),
    1,
    "Un solo ledger per ordine",
  );
  const financeRace = await register(1),
    frp = await preview(financeRace.order),
    frpayment = await scalar("select id value from public.order_payments where order_id=$1", [
      financeRace.order,
    ]);
  const raceResults = await Promise.allSettled([
    connected("logistics", "select public.cancel_manual_sale_registration($1,$2::jsonb)value", [
      randomUUID(),
      JSON.stringify(cancellation(financeRace.order, frp)),
    ]),
    connected("founder", "select public.revise_finance_movement($1,$2::jsonb)value", [
      randomUUID(),
      JSON.stringify(revision("payment", frpayment, 0, "update", { values: values(day, 600) })),
    ]),
  ]);
  eq(
    raceResults.filter((r) => r.status === "fulfilled").length,
    1,
    "Revisione e annullo si serializzano sul medesimo ordine",
  );
  const fs = await salesState(financeRace.order);
  if (fs.state === "cancelled") {
    eq(raceResults[1].status, "rejected", "L'annullo vincente blocca revisione tardiva");
    eq(
      (
        await as("logistics", "select public.read_sales_effective_payments($1::uuid[])value", [
          [financeRace.order],
        ])
      )[0].value[0].amount_due_cents,
      "0",
      "Nessun residuo riattivato dalla race",
    );
  } else {
    eq(
      raceResults[0].reason.message,
      "sale_cancellation_conflict",
      "Revisione vincente invalida preview",
    );
    eq(
      Number(
        await scalar(
          "select count(*)value from public.sales_registration_cancellations where order_id=$1",
          [financeRace.order],
        ),
      ),
      0,
      "Conflitto finanziario non restituisce merce",
    );
  }
  // The fresh-session check is repeated after an aggregate row-lock wait.
  const expired = await register(1),
    ep = await preview(expired.order);
  await db.query(
    "update auth.sessions set not_after=clock_timestamp()+interval '150 milliseconds'where id=$1",
    [sessions.consultant],
  );
  await db.query("begin");
  await db.query("select 1 from public.sales_orders where id=$1 for update", [expired.order]);
  const waiting = connected(
    "consultant",
    "select public.cancel_manual_sale_registration($1,$2::jsonb)value",
    [randomUUID(), JSON.stringify(cancellation(expired.order, ep))],
  );
  await new Promise((resolve) => setTimeout(resolve, 220));
  await db.query("commit");
  await rejected(waiting, "42501", "Sessione scaduta durante attesa lock non scrive");
  eq(
    Number(
      await scalar(
        "select count(*)value from public.sales_registration_cancellations where order_id=$1",
        [expired.order],
      ),
    ),
    0,
    "Scadenza sessione conserva fonti",
  );
  const canonical = randomUUID();
  // Synthetic fixture factory retains real provider guards and denied raw ACLs.
  await db.query(
    "create function public.qa_canonical_order(p_id uuid,p_op uuid)returns void language sql security definer set search_path=''as $$insert into public.sales_orders(id,operation_id,payload_sha256,source_kind,channel,occurred_at,operational_date,total_cents,payment_state,fulfillment_mode,fulfillment_state,created_by)values(p_id,p_op,repeat('a',64),'shopify_canonical','shopify_web',now(),(now()at time zone 'Europe/Rome')::date,766,'paid','prepare','unfulfilled',null)$$",
  );
  await db.query("begin");
  await db.query("set local role service_role");
  await db.query("select public.qa_canonical_order($1,$2)", [canonical, randomUUID()]);
  await db.query("commit");
  await db.query("drop function public.qa_canonical_order(uuid,uuid)");
  await rejected(
    preview(canonical),
    "22023",
    "Ordine Shopify escluso dalla preview di annullo manuale",
  );
  await rejected(
    rpc(
      "cancel_manual_sale_registration",
      cancellation(canonical, { expected_version: "0".repeat(64) }),
      "logistics",
    ),
    "22023",
    "Ordine Shopify escluso dal comando di annullo manuale",
  );
  eq(
    await scalar("select order_state value from public.sales_orders where id=$1", [canonical]),
    "confirmed",
    "Sorgente Shopify non modificata",
  );
  const multiple = await register(1),
    firstPayment = await scalar("select id value from public.order_payments where order_id=$1", [
      multiple.order,
    ]);
  await rpc(
    "revise_finance_movement",
    revision("payment", firstPayment, 0, "update", { values: values(day, 500) }),
    "founder",
  );
  await rpc(
    "record_manual_payment",
    {
      order_id: multiple.order,
      amount_cents: multiple.total - 500,
      method: "cash",
      occurred_at: new Date().toISOString(),
    },
    "logistics",
  );
  await rpc(
    "revise_finance_movement",
    revision("payment", firstPayment, 1, "update", {
      values: values("2099-12-31", 500, { direction: "expense", pending: true }),
    }),
    "founder",
  );
  const mp = await preview(multiple.order);
  eq(
    Number(mp.payment_cents),
    multiple.total - 500,
    "Preview usa solo il netto effettivo postato, conservando pagamenti futuri separati",
  );
  await rpc("cancel_manual_sale_registration", cancellation(multiple.order, mp), "logistics");
  eq(
    Number(
      await scalar("select count(*)value from public.order_payments where order_id=$1", [
        multiple.order,
      ]),
    ),
    2,
    "Due fonti incasso originali conservate",
  );
  eq(
    Number(
      await scalar(
        "select count(*)value from public.finance_revision_current r join public.order_payments p on p.id=r.source_id where r.source_kind='payment'and p.order_id=$1 and r.deleted",
        [multiple.order],
      ),
    ),
    2,
    "Entrambe le fonti escluse, compresa quella futura",
  );
  eq(
    await scalar(
      "select jsonb_build_array(r.value_snapshot->>'date',r.value_snapshot->>'direction',r.value_snapshot->'pending')value from public.finance_revision_current r where source_kind='payment'and source_id=$1",
      [firstPayment],
    ),
    ["2099-12-31", "expense", true],
    "Delete preserva data futura, direzione e pending del full snapshot",
  );
  eq(
    await scalar("select private.effective_order_payment_summary($1)->>'net_cents'value", [
      multiple.order,
    ]),
    "0",
    "Unico saldo effettivo senza doppi storni",
  );
  const unpaid = await register(1, "delivered_now", false),
    up = await preview(unpaid.order),
    beforeUnpaidRevisions = await count("public.finance_movement_revisions");
  eq(Number(up.payment_cents), 0, "Vendita non incassata: effetto Finance zero");
  await rpc("cancel_manual_sale_registration", cancellation(unpaid.order, up), "logistics");
  eq(
    await count("public.finance_movement_revisions"),
    beforeUnpaidRevisions,
    "Nessuna revisione incasso fittizio per vendita non pagata",
  );
  await rejected(
    as(
      "logistics",
      "update public.sales_registration_cancellations set reason='Mutazione sintetica'where order_id=$1",
      [unpaid.order],
    ),
    "42501",
    "Membro non modifica ledger annullamenti",
  );
  await rejected(
    db.query("delete from public.sales_registration_cancellations where order_id=$1", [
      unpaid.order,
    ]),
    "42501",
    "Ledger annullamenti immutabile anche per proprietario",
  );
  console.log(
    `PASS ${checks} controlli: annullo registrazione manuale, stock, packaging, Finance e concorrenza.`,
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
