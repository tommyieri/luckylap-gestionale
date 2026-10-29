// test-db: pglite minimo 106
// Eliminazione e ripristino dei riassortimenti: dati sintetici, Auth simulato,
// nessun cloud. Le quantità e lo storico rimangono indipendenti dalla visibilità.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (!process.argv[2]?.startsWith("/")) throw Error("Serve il percorso assoluto di PGlite.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const eq = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const users = Object.fromEntries(
  ["logistics", "consultant", "inactive", "outsider"].map((role) => [role, randomUUID()]),
);
const central = randomUUID(),
  shop = randomUUID(),
  product = randomUUID(),
  item = randomUUID();
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
async function as(who, fn, role = "authenticated") {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify(who ? { sub: users[who], aal: "aal1" } : {}),
    ]);
    await db.exec(`set local role ${role}`);
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const run = (command, payload, op = randomUUID(), who = "logistics") =>
  as(
    who,
    async () =>
      (
        await db.query(`select public.${command}($1,$2::jsonb) result`, [
          op,
          JSON.stringify(payload),
        ])
      ).rows[0].result,
  );
async function rejects(fn, message, code) {
  let caught;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `Rifiuto atteso: ${message ?? code}`);
  checks++;
  if (message) eq(caught.message, message, message);
  if (code) eq(caught.code, code, code);
}
const metadata = (over = {}) => ({
  schema_version: 1,
  order_id: null,
  expected_version: null,
  title: "Riassortimento sintetico",
  notes: "Nota sintetica",
  shop_location_id: shop,
  ...over,
});
const deletion = (order_id, expected_version, deleted, note = "Motivazione sintetica") => ({
  schema_version: 1,
  order_id,
  expected_version,
  deleted,
  note,
});
const line = {
  destination: "shop",
  product_id: product,
  color: "Verde sintetico",
  size: "M",
  quantity: 3,
};
const current = (orderId) =>
  one("select *,version::int version from public.restock_orders where id=$1", [orderId]);
const effects = () =>
  one(`select
  (select md5(coalesce(jsonb_agg(to_jsonb(b) order by stock_item_id,location_id)::text,'')) from public.stock_balances b) balances,
  (select md5(coalesce(jsonb_agg(to_jsonb(m) order by id)::text,'')) from public.stock_movements m) movements,
  (select md5(coalesce(jsonb_agg(to_jsonb(f) order by id)::text,'')) from public.finance_entries f) finance,
  (select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'')) from public.restock_arrivals a) arrivals,
  (select md5(coalesce(jsonb_agg(to_jsonb(e) order by id)::text,'')) from public.restock_state_events e) states,
  (select md5(coalesce(jsonb_agg(to_jsonb(l) order by id)::text,'')) from public.restock_lines l) lines`);

try {
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role;`);
  const directory = new URL("../migrations/", import.meta.url);
  const files = readdirSync(directory).sort();
  const migration = (suffix) => {
    const found = files.filter((name) => name.endsWith(`_${suffix}.sql`));
    assert.equal(found.length, 1, `Una migrazione ${suffix}`);
    return readFileSync(new URL(found[0], directory), "utf8");
  };
  for (const suffix of [
    "initial_schema",
    "sales_ecosystem",
    "sales_lifecycle",
    "packaging_materials",
    "shopify_catalog",
    "consignment_workflow",
    "shopify_sales_core",
    "packaging_automatic_consumption",
  ])
    await db.exec(migration(suffix));
  for (const [role, user] of Object.entries(users)) {
    await db.query("insert into auth.users(id) values ($1)", [user]);
    if (role === "outsider") continue;
    await db.query("insert into public.profiles(user_id,display_name) values ($1,$2)", [
      user,
      `Persona sintetica ${role}`,
    ]);
    await db.query("insert into public.memberships(user_id,role,active) values ($1,$2,$3)", [
      user,
      role === "inactive" ? "logistics" : role,
      role !== "inactive",
    ]);
  }
  await db.query(
    `insert into public.stock_locations(id,code,name,location_type,active) values
    ($1,'MAG01','Magadzino','Magazzino',true),($2,'NEG01','Negozio sintetico','Negozio Conto Vendita',true)`,
    [central, shop],
  );
  await db.query(
    "insert into public.products(id,model,category) values ($1,'Modello sintetico','T-shirt')",
    [product],
  );
  await db.query(
    "insert into public.stock_items(id,kind,sku,name,active) values ($1,'product','SYN-VERDE-M','Maglietta sintetica',true)",
    [item],
  );
  await db.query(
    "insert into public.product_variants(stock_item_id,product_id,color,size) values ($1,$2,'Verde sintetico','M')",
    [item, product],
  );
  await db.query(
    "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason) values ($1,$2,$3,'opening',7,'Conta sintetica')",
    [randomUUID(), item, central],
  );
  await db.query("update public.app_settings set stock_adjustments_enabled=true where id");
  for (const suffix of [
    "consignment_monthly",
    "ceo_activity_feed",
    "ceo_feed_fixes",
    "riassortimento",
    "restock_edit_delete",
  ])
    await db.exec(migration(suffix));

  const permissions = await one(`select
    has_function_privilege('authenticated','public.set_restock_deleted(uuid,jsonb)','execute') member,
    has_function_privilege('anon','public.set_restock_deleted(uuid,jsonb)','execute') anon,
    has_function_privilege('service_role','public.set_restock_deleted(uuid,jsonb)','execute') service,
    has_table_privilege('authenticated','public.restock_deletion_events','select') read,
    has_table_privilege('authenticated','public.restock_deletion_events','insert') write,
    (select relrowsecurity from pg_class where oid='public.restock_deletion_events'::regclass) rls`);
  eq(
    permissions,
    { member: true, anon: false, service: false, read: true, write: false, rls: true },
    "Permessi minimi e RLS",
  );
  const pending = (await run("save_restock_order", metadata())).order_id;
  await run("set_restock_lines", {
    schema_version: 1,
    order_id: pending,
    expected_version: 1,
    lines: [line],
  });
  const before = await effects();
  const op = randomUUID(),
    payload = deletion(pending, 2, true);
  const result = await run("set_restock_deleted", payload, op);
  eq(
    result,
    {
      operation_id: op,
      order_id: pending,
      state: "discussion",
      version: 3,
      deleted: true,
      replayed: false,
    },
    "Elimina con versione",
  );
  eq(await effects(), before, "Eliminare non modifica quantità, righe, arrivi, stati o Finance");
  const deleted = await current(pending);
  eq(
    [Boolean(deleted.deleted_at), deleted.deleted_by, deleted.deletion_note],
    [true, users.logistics, payload.note],
    "Autore e motivo eliminazione",
  );
  eq(
    await run("set_restock_deleted", payload, op),
    { ...result, replayed: true },
    "Replay identico prima di CAS",
  );
  eq(
    (await one("select count(*)::int n from public.restock_deletion_events")).n,
    1,
    "Replay non duplica lo storico",
  );
  await rejects(
    () => run("set_restock_deleted", { ...payload, note: "Altro motivo" }, op),
    "idempotency_conflict",
    "22023",
  );
  await rejects(
    () => run("set_restock_deleted", payload, op, "consultant"),
    "idempotency_conflict",
    "22023",
  );
  await rejects(
    () => run("set_restock_deleted", deletion(pending, 2, false)),
    "stale_version",
    "22023",
  );
  await rejects(
    () => run("set_restock_deleted", deletion(pending, 3, true)),
    "invalid_payload",
    "22023",
  );

  for (const [who, expected] of [
    ["consultant", 1],
    ["outsider", 0],
    ["inactive", 0],
  ]) {
    eq(
      await as(
        who,
        async () =>
          (await one("select count(*)::int n from public.restock_orders where id=$1", [pending])).n,
      ),
      expected,
      `RLS ordini eliminati ${who}`,
    );
    eq(
      await as(
        who,
        async () =>
          (
            await one(
              "select count(*)::int n from public.restock_deletion_events where order_id=$1",
              [pending],
            )
          ).n,
      ),
      expected,
      `RLS storico ${who}`,
    );
  }
  for (const who of ["outsider", "inactive", null])
    await rejects(
      () => run("set_restock_deleted", deletion(pending, 3, false), randomUUID(), who),
      "membership_required",
      "42501",
    );
  await rejects(
    () =>
      as(
        null,
        () =>
          db.query("select public.set_restock_deleted($1,$2)", [
            randomUUID(),
            JSON.stringify(payload),
          ]),
        "anon",
      ),
    undefined,
    "42501",
  );
  await rejects(
    () =>
      as("logistics", () =>
        db.query("update public.restock_orders set deleted_at=null where id=$1", [pending]),
      ),
    undefined,
    "42501",
  );
  await rejects(
    () =>
      as("logistics", () =>
        db.query("delete from public.restock_deletion_events where order_id=$1", [pending]),
      ),
    undefined,
    "42501",
  );
  await rejects(
    () => db.query("delete from public.restock_deletion_events where order_id=$1", [pending]),
    "Registro append-only: aggiungere un movimento di rettifica.",
    "42501",
  );

  const blocked = [
    ["save_restock_order", metadata({ order_id: pending, expected_version: 3 })],
    [
      "set_restock_lines",
      { schema_version: 1, order_id: pending, expected_version: 3, lines: [line] },
    ],
    [
      "move_restock_order",
      {
        schema_version: 1,
        order_id: pending,
        expected_version: 3,
        state: "quality",
        note: "Nota sintetica",
      },
    ],
    [
      "receive_restock_order",
      {
        schema_version: 1,
        order_id: pending,
        expected_version: 3,
        expected_pieces: 3,
        note: "Nota sintetica",
      },
    ],
    [
      "undo_restock_arrival",
      { schema_version: 1, order_id: pending, expected_version: 3, note: "Nota sintetica" },
    ],
    [
      "set_restock_shop_done",
      { schema_version: 1, order_id: pending, expected_version: 3, done: true },
    ],
  ];
  for (const [command, data] of blocked)
    await rejects(() => run(command, data), "restock_deleted", "22023");
  for (const over of [
    { note: "" },
    { note: "ab" },
    { note: "x".repeat(501) },
    { deleted: "true" },
    { deleted: null },
    { schema_version: 2 },
    { unknown: true },
    { expected_version: 0 },
    { order_id: null },
  ])
    await rejects(
      () => run("set_restock_deleted", { ...deletion(pending, 3, false), ...over }),
      "invalid_payload",
      "22023",
    );

  const restoreOp = randomUUID(),
    restored = await run(
      "set_restock_deleted",
      deletion(pending, 3, false),
      restoreOp,
      "consultant",
    );
  eq([restored.deleted, restored.version], [false, 4], "Ogni membro può ripristinare");
  const active = await current(pending);
  eq(
    [active.deleted_at, active.deleted_by, active.deletion_note],
    [null, null, ""],
    "Ripristino pulisce il marcatore attuale",
  );
  eq(
    (
      await db.query(
        "select deleted,created_by,note from public.restock_deletion_events order by deleted desc",
      )
    ).rows,
    [
      { deleted: true, created_by: users.logistics, note: payload.note },
      { deleted: false, created_by: users.consultant, note: payload.note },
    ],
    "Storico append-only conserva entrambe le operazioni",
  );
  eq(await effects(), before, "Anche il ripristino non ha effetti sul patrimonio");
  await run(
    "save_restock_order",
    metadata({ order_id: pending, expected_version: 4, title: "Titolo corretto sintetico" }),
  );
  eq((await current(pending)).title, "Titolo corretto sintetico", "Modifica dopo ripristino");
  await run("receive_restock_order", {
    schema_version: 1,
    order_id: pending,
    expected_version: 5,
    expected_pieces: 3,
    note: "Arrivo sintetico",
  });
  await run(
    "save_restock_order",
    metadata({ order_id: pending, expected_version: 6, title: "Titolo dopo arrivo sintetico" }),
  );
  eq(
    (await current(pending)).title,
    "Titolo dopo arrivo sintetico",
    "Titolo e note modificabili anche dopo arrivo",
  );
  await rejects(
    () =>
      run("set_restock_lines", {
        schema_version: 1,
        order_id: pending,
        expected_version: 7,
        lines: [line],
      }),
    "restock_received",
    "22023",
  );
  const afterArrival = await effects();
  await run("set_restock_deleted", deletion(pending, 7, true));
  eq(
    await effects(),
    afterArrival,
    "Eliminazione di un arrivo conserva anche la registrazione di carico",
  );
  await rejects(
    async () =>
      run("save_consignment_order", {
        schema_version: 1,
        order_id: null,
        expected_version: null,
        location_id: shop,
        requested_on: (await one("select ((now() at time zone 'Europe/Rome')::date)::text d")).d,
        note: "Nota sintetica",
        lines: [{ stock_item_id: item, quantity: 1 }],
        restock_order_id: pending,
      }),
    "restock_deleted",
    "22023",
  );
  await run("set_restock_deleted", deletion(pending, 8, false));
  await run("undo_restock_arrival", {
    schema_version: 1,
    order_id: pending,
    expected_version: 9,
    note: "Storno sintetico",
  });
  eq(
    (
      await one(
        "select quantity::int quantity from public.stock_balances where stock_item_id=$1 and location_id=$2",
        [item, central],
      )
    ).quantity,
    7,
    "Il ripristino mantiene l'annullo dell'arrivo funzionante",
  );
  eq((await current(pending)).state, "discussion", "Annullo torna allo stato precedente");
  await rejects(
    () => run("set_restock_deleted", deletion(randomUUID(), 1, true)),
    "restock_not_found",
    "22023",
  );
  eq(
    (
      await one("select count(*)::int n from public.restock_deletion_events where order_id=$1", [
        pending,
      ])
    ).n,
    4,
    "Quattro cambi recuperabili registrati",
  );
  console.log(`PASS ${checks} controlli riassortimenti: modifica, eliminazione e ripristino.`);
} finally {
  await db.close();
}
