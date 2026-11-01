// test-db: pglite minimo 264
// Riassortimento su PGlite (20261023164150_riassortimento): Auth simulato, solo dati sintetici,
// nessun cloud. Gruppi: migrazione (taglie del negozio di Milano e audit), permessi, riordini,
// righe, stati, arrivo in magazzino una volta sola, annullo dell'arrivo, ordine del negozio legato
// al riordine e consegna, taglie del negozio nel conto vendita, frasi del feed di Controllo CEO e
// import dei due riordini in corso (85 = 64 + 17 + 4, e 36).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (!process.argv[2]?.startsWith("/")) throw Error("Pass absolute external PGlite dist/index.js");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const eq = (actual, expected, message = "Values must match") => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const ok = (value, message = "Expected truthy value") => {
  assert.ok(value, message);
  checks++;
};
const id = (n) => `95000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const roles = ["founder", "production", "logistics", "consultant", "outsider", "inactive"];
const ids = Object.fromEntries(roles.map((role, index) => [role, id(index + 1)]));
const central = id(100),
  milan = id(101),
  other = id(102),
  external = id(103);
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
const MODELS = [...new Set(RANGES.map(([model]) => model))];
const productId = (model) => id(200 + MODELS.indexOf(model));
const capProduct = id(220),
  cap = id(221),
  fresh = id(222),
  unknownItem = id(223);
/** Variante sintetica: `item("GT3RS", "Blu", "M")`. */
const item = (model, color, size) => {
  const range = RANGES.findIndex(([m, c]) => m === model && c === color),
    index = SIZES.indexOf(size);
  if (range < 0 || index < 0)
    throw Error(`Variante sintetica sconosciuta: ${model} ${color} ${size}`);
  return id(300 + range * 6 + index);
};
const sku = (model, color, size) => `SYN-${model}-${color.toUpperCase()}-${size}`;
/** Giacenza di partenza nel Magadzino sintetico: 5 per variante, 0 per le XS. */
const opening = (size) => (size === "XS" ? 0 : 5);

// PGlite legge l'ora da Date.now(): now() va al millisecondo, non al microsecondo come in
// PostgreSQL. Due transazioni nello stesso millisecondo avrebbero lo stesso now(), e il feed di
// Controllo CEO, che raggruppa per persona e istante, le unirebbe in una frase sola scelta a caso
// (per esempio «Dal ricamatore» sparisce). Ogni transazione parte in un millisecondo nuovo.
let lastTransactionEnd = 0;
async function as(name, fn, role = "authenticated") {
  while (Date.now() <= lastTransactionEnd) await new Promise((done) => setTimeout(done, 1));
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify(name ? { sub: ids[name], aal: "aal1" } : {}),
    ]);
    await db.exec(`set local role ${role}`);
    const value = await fn();
    await db.exec("commit");
    return value;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  } finally {
    lastTransactionEnd = Date.now();
  }
}
const run = (kind, payload, op = randomUUID(), who = "logistics") =>
  as(
    who,
    async () =>
      (await db.query(`select public.${kind}($1,$2::jsonb) result`, [op, JSON.stringify(payload)]))
        .rows[0].result,
  );
async function rejects(fn, message, code, detail) {
  let error;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  ok(error, `Rifiuto atteso: ${message ?? code}`);
  if (message) eq(error.message, message, `Messaggio ${message}`);
  if (code) eq(error.code, code, `Codice di ${message ?? code}`);
  if (detail !== undefined) eq(error.detail, detail, `Dettaglio di ${message}`);
}
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const count = async (table, where = "true", args = []) =>
  (await one(`select count(*)::int n from ${table} where ${where}`, args)).n;
const bal = async (stockItem, location = central) => {
  const row = await one(
    "select quantity::int quantity from public.stock_balances where stock_item_id=$1 and location_id=$2",
    [stockItem, location],
  );
  return row === undefined ? undefined : row.quantity;
};
const fingerprint = () =>
  one(`select
    (select md5(coalesce(string_agg(stock_item_id||':'||location_id||':'||coalesce(quantity::text,'-'),',' order by stock_item_id,location_id),'')) from public.stock_balances) balances,
    (select md5(coalesce(string_agg(id||':'||kind||':'||quantity_delta||':'||quantity_after,',' order by id),'')) from public.stock_movements) movements`);
const auditByTable = async () =>
  Object.fromEntries(
    (
      await rows(
        "select table_name, count(*)::int n from public.audit_logs group by table_name order by table_name",
      )
    ).map((row) => [row.table_name, row.n]),
  );
const orderPayload = (over = {}) => ({
  schema_version: 1,
  order_id: null,
  expected_version: null,
  title: "Riordine sintetico",
  notes: "",
  shop_location_id: milan,
  ...over,
});
const line = (destination, model, color, size, quantity) => ({
  destination,
  product_id: productId(model),
  color,
  size,
  quantity,
});
const linesPayload = (orderId, version, lines) => ({
  schema_version: 1,
  order_id: orderId,
  expected_version: version,
  lines,
});
const movePayload = (orderId, version, state, note = "") => ({
  schema_version: 1,
  order_id: orderId,
  expected_version: version,
  state,
  note,
});
const receivePayload = (orderId, version, pieces, note = "") => ({
  schema_version: 1,
  order_id: orderId,
  expected_version: version,
  expected_pieces: pieces,
  note,
});
const undoPayload = (orderId, version, note = "") => ({
  schema_version: 1,
  order_id: orderId,
  expected_version: version,
  note,
});
const order = (orderId) =>
  one("select *, version::int version from public.restock_orders where id=$1", [orderId]);
const today = async () =>
  (await one("select ((now() at time zone 'Europe/Rome')::date)::text d")).d;
const feed = async () =>
  rows(
    "select actor_name, area, message, href from private.activity_feed_window(now() - interval '1 hour', 'infinity'::timestamptz, null) order by occurred_at, message",
  );
const feedHas = async (message, href, label) => {
  const found = (await feed()).filter((row) => row.message === message);
  eq(found.length, 1, `${label}: una frase «${message}»`);
  eq([found[0]?.area, found[0]?.href], ["stock", href], `${label}: area Magazzino e link`);
};

try {
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key);
     create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
     create function auth.uid()returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;`,
  );
  const directory = new URL("../migrations/", import.meta.url);
  const files = readdirSync(directory).sort();
  const migration = (suffix) => {
    const found = files.filter((name) => name.endsWith(`_${suffix}.sql`));
    assert.equal(found.length, 1, `Exactly one migration ${suffix}`);
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

  // Utenti, sedi e catalogo sintetici prima del conto vendita: le righe dei negozi le crea la sua migrazione.
  for (const role of roles) {
    await db.query("insert into auth.users(id)values($1)", [ids[role]]);
    if (role === "outsider") continue;
    await db.query("insert into public.profiles(user_id,display_name)values($1,$2)", [
      ids[role],
      `Sintetico ${role}`,
    ]);
    await db.query("insert into public.memberships(user_id,role,active)values($1,$2,$3)", [
      ids[role],
      role === "inactive" ? "logistics" : role,
      role !== "inactive",
    ]);
  }
  await db.query(
    `insert into public.stock_locations(id,code,name,location_type,active)values
      ($1,'MAG01','Magadzino','Magazzino',true),($2,'NEG01','Libreria sintetica Milano','Negozio Conto Vendita',true),
      ($3,'NEG02','Secondo negozio sintetico','Negozio Conto Vendita',true),($4,'EST01','Esterno sintetico','Esterno',true)`,
    [central, milan, other, external],
  );
  for (const model of MODELS)
    await db.query("insert into public.products(id,model,category)values($1,$2,'T-shirt')", [
      productId(model),
      model,
    ]);
  await db.query(
    "insert into public.products(id,model,category)values($1,'Cappellino sintetico','Cappellino')",
    [capProduct],
  );
  for (const [model, color] of RANGES)
    for (const size of SIZES) {
      const stockItem = item(model, color, size);
      await db.query(
        "insert into public.stock_items(id,kind,sku,name,active)values($1,'product',$2,$3,true)",
        [stockItem, sku(model, color, size), `${model} · ${color} · ${size}`],
      );
      await db.query(
        "insert into public.product_variants(stock_item_id,product_id,color,size,central_target_quantity)values($1,$2,$3,$4,3)",
        [stockItem, productId(model), color, size],
      );
      await db.query(
        "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,'opening',$4,'Conta sintetica')",
        [randomUUID(), stockItem, central, opening(size)],
      );
      for (const shop of [milan, other])
        await db.query(
          "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,'opening',0,'Conta sintetica')",
          [randomUUID(), stockItem, shop],
        );
    }
  // Cappellino; una variante nuova senza giacenza nel Magadzino; una con giacenza ignota.
  for (const [stockItem, code, color, size] of [
    [cap, "SYN-CAP-UNICA", "Verde", "UNICA"],
    [fresh, "SYN-SENNA-NERO-M", "Nero", "M"],
    [unknownItem, "SYN-SENNA-NERO-L", "Nero", "L"],
  ]) {
    await db.query(
      "insert into public.stock_items(id,kind,sku,name,active)values($1,'product',$2,$3,true)",
      [stockItem, code, code],
    );
    await db.query(
      "insert into public.product_variants(stock_item_id,product_id,color,size)values($1,$2,$3,$4)",
      [stockItem, stockItem === cap ? capProduct : productId("SENNA"), color, size],
    );
  }
  await db.query(
    "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,'opening',4,'Conta sintetica')",
    [randomUUID(), cap, central],
  );
  await db.query(
    "insert into public.stock_balances(stock_item_id,location_id,quantity)values($1,$2,null)",
    [unknownItem, central],
  );
  await db.query("update public.app_settings set stock_adjustments_enabled=true where id");
  for (const suffix of ["consignment_monthly", "ceo_activity_feed", "ceo_feed_fixes"])
    await db.exec(migration(suffix));

  // 1 · Migrazione: una sola riga cambiata (le taglie del negozio di Milano), nel registro.
  const before = await fingerprint();
  const auditBefore = await count("public.audit_logs");
  await db.exec(migration("riassortimento"));
  ok(true, "riassortimento si applica dopo le migrazioni esistenti");
  eq(await fingerprint(), before, "Nessun saldo o movimento cambiato dalla migrazione");
  eq(
    await rows(
      "select location_id, sizes from public.consignment_shops where location_id in ($1,$2) order by location_id",
      [milan, other],
    ),
    [
      { location_id: milan, sizes: ["S", "M", "L", "XL"] },
      { location_id: other, sizes: null },
    ],
    "Milano tiene S, M, L, XL; l'altro negozio tutte le taglie",
  );
  eq(await count("public.audit_logs"), auditBefore + 1, "Una sola riga di audit nuova");
  const sizesAudit = await one(
    "select actor_id, operation, old_data->'sizes' old_sizes, new_data->'sizes' new_sizes from public.audit_logs where table_name='consignment_shops' order by occurred_at desc limit 1",
  );
  eq(
    sizesAudit,
    { actor_id: null, operation: "UPDATE", old_sizes: null, new_sizes: ["S", "M", "L", "XL"] },
    "Taglie di Milano nel registro, dal sistema",
  );
  eq(
    (await one("select enum_range(null::public.stock_movement_kind)::text kinds")).kinds.includes(
      "restock_receipt,restock_receipt_reversal",
    ),
    true,
    "Tipi di movimento restock_receipt e restock_receipt_reversal",
  );
  const tables = ["restock_orders", "restock_lines", "restock_state_events", "restock_arrivals"];
  for (const table of tables) {
    const info = await one(
      `select c.relrowsecurity rls,
        has_table_privilege('anon','public.${table}','select') anon_select,
        has_table_privilege('authenticated','public.${table}','select') member_select,
        has_table_privilege('authenticated','public.${table}','insert') member_insert,
        has_table_privilege('authenticated','public.${table}','update') member_update,
        has_table_privilege('authenticated','public.${table}','delete') member_delete,
        exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='audit_change') audited
       from pg_class c where c.oid='public.${table}'::regclass`,
    );
    eq(
      info,
      {
        rls: true,
        anon_select: false,
        member_select: true,
        member_insert: false,
        member_update: false,
        member_delete: false,
        audited: true,
      },
      `${table}: RLS, sola lettura per i membri, niente per anon, audit`,
    );
  }
  const commands = [
    "save_restock_order",
    "set_restock_lines",
    "move_restock_order",
    "receive_restock_order",
    "undo_restock_arrival",
    "set_restock_shop_done",
  ];
  for (const name of commands) {
    const info = await one(
      `select p.prosecdef private_definer, p.proconfig private_config, q.prosecdef public_definer,
        has_function_privilege('anon', q.oid, 'execute') anon_execute,
        has_function_privilege('authenticated', q.oid, 'execute') member_execute
       from pg_proc p, pg_proc q
       where p.oid='private.${name}(uuid,jsonb)'::regprocedure and q.oid='public.${name}(uuid,jsonb)'::regprocedure`,
    );
    eq(
      [info.private_definer, info.private_config.includes('search_path=""'), info.public_definer],
      [true, true, false],
      `${name}: processore security definer con search_path vuoto, wrapper invoker`,
    );
    eq(
      [info.anon_execute, info.member_execute],
      [false, true],
      `${name}: EXECUTE ad authenticated, non ad anon`,
    );
  }
  for (const helper of [
    "start_restock(uuid,text,jsonb)",
    "finish_restock(uuid,text,jsonb,jsonb)",
    "restock_order_for_update(uuid,bigint)",
    "consignment_size_allowed()",
  ])
    eq(
      (await one(`select has_function_privilege('authenticated','private.${helper}','execute') x`))
        .x,
      false,
      `private.${helper} senza EXECUTE per i client`,
    );
  eq(
    await count(
      "pg_trigger",
      "tgname='consignment_size_allowed' and tgrelid in ('public.consignment_count_lines'::regclass,'public.consignment_report_lines'::regclass,'public.consignment_order_lines'::regclass,'public.consignment_shipment_lines'::regclass)",
    ),
    4,
    "Controllo delle taglie su conta, resoconto, ordini e consegne",
  );

  // 2 · Permessi: anon, chi non è nel team e chi non è più attivo non leggono e non scrivono.
  await rejects(
    () => run("save_restock_order", orderPayload(), randomUUID(), null),
    "membership_required",
    "42501",
  );
  await rejects(
    () =>
      as(
        null,
        () =>
          db.query("select public.save_restock_order($1,$2::jsonb)", [
            randomUUID(),
            JSON.stringify(orderPayload()),
          ]),
        "anon",
      ),
    null,
    "42501",
  );
  await rejects(
    () => as(null, () => db.query("select * from public.restock_orders"), "anon"),
    null,
    "42501",
  );
  await rejects(
    () => run("save_restock_order", orderPayload(), randomUUID(), "outsider"),
    "membership_required",
    "42501",
  );
  await rejects(
    () => run("save_restock_order", orderPayload(), randomUUID(), "inactive"),
    "membership_required",
    "42501",
  );
  await rejects(
    () =>
      as("founder", () =>
        db.query(
          "insert into public.restock_orders(id,title,state_changed_by,warehouse_location_id,created_by,updated_by)values($1,'Diretto',$2,$3,$2,$2)",
          [randomUUID(), ids.founder, central],
        ),
      ),
    null,
    "42501",
  );
  eq(await count("public.restock_orders"), 0, "Nessun riordine scritto dai rifiuti");

  // 3 · Riordine: creazione, replay, conflitti, titolo unico, versione.
  const createOp = randomUUID();
  const created = await run("save_restock_order", orderPayload(), createOp);
  eq(
    created,
    {
      operation_id: createOp,
      order_id: createOp,
      state: "discussion",
      version: 1,
      replayed: false,
    },
    "Riordine creato in «Discussione»",
  );
  const first = createOp;
  eq(
    [(await order(first)).warehouse_location_id, (await order(first)).shop_location_id],
    [central, milan],
    "Per noi il Magadzino (MAG01), per il negozio Milano",
  );
  eq(
    await rows(
      "select from_state, to_state, created_by from public.restock_state_events where order_id=$1",
      [first],
    ),
    [{ from_state: null, to_state: "discussion", created_by: ids.logistics }],
    "Primo passo dello storico: Discussione, con chi",
  );
  eq(
    await run("save_restock_order", orderPayload(), createOp),
    { ...created, replayed: true },
    "Replay identico: stesso esito, niente di nuovo",
  );
  eq(await count("public.restock_orders"), 1, "Un solo riordine dopo il replay");
  await rejects(
    () => run("save_restock_order", orderPayload({ notes: "Altro" }), createOp),
    "idempotency_conflict",
    "22023",
  );
  await rejects(
    () => run("save_restock_order", orderPayload(), createOp, "founder"),
    "idempotency_conflict",
    "22023",
  );
  await rejects(
    () => run("save_restock_order", orderPayload({ title: "RIORDINE SINTETICO" })),
    "title_taken",
    "23505",
  );
  for (const [label, payload] of [
    ["titolo corto", orderPayload({ title: "ab" })],
    ["chiave in più", { ...orderPayload(), extra: 1 }],
    ["chiave mancante", (({ notes, ...rest }) => rest)(orderPayload())],
    ["versione senza riordine", orderPayload({ expected_version: 1 })],
    ["negozio non UUID", orderPayload({ shop_location_id: "NEG01" })],
  ])
    await rejects(
      () => run("save_restock_order", payload),
      "invalid_payload",
      "22023",
      undefined,
      label,
    );
  await rejects(
    () =>
      run(
        "save_restock_order",
        orderPayload({ title: "Negozio sbagliato", shop_location_id: central }),
      ),
    "invalid_location",
    "22023",
  );
  const edited = await run(
    "save_restock_order",
    orderPayload({ order_id: first, expected_version: 1, notes: "Nota sintetica" }),
  );
  eq(
    [edited.version, (await order(first)).notes],
    [2, "Nota sintetica"],
    "Nota salvata, versione 2",
  );
  await rejects(
    () =>
      run(
        "save_restock_order",
        orderPayload({ order_id: first, expected_version: 1, notes: "Vecchia" }),
      ),
    "stale_version",
    "22023",
  );

  // 4 · Righe: per noi, per il negozio (solo S–XL a Milano), per il cliente anche in XXXL.
  const firstLines = [
    line("warehouse", "GT3RS", "Blu", "M", 3),
    line("warehouse", "GT3RS", "Blu", "XS", 2),
    line("warehouse", "SL", "Azzurro", "L", 4),
    line("shop", "GT3RS", "Blu", "S", 2),
    line("shop", "SL", "Azzurro", "XL", 1),
    line("customer", "GT3RS", "Blu", "XXXL", 1),
    line("customer", "SL", "Azzurro", "M", 1),
  ];
  const linesOp = randomUUID();
  const setLines = await run("set_restock_lines", linesPayload(first, 2, firstLines), linesOp);
  eq([setLines.pieces, setLines.version], [14, 3], "Sette righe, 14 pezzi, versione 3");
  eq(
    await rows(
      "select destination, size, stock_item_id, quantity from public.restock_lines where order_id=$1 and destination='customer' order by size",
      [first],
    ),
    [
      {
        destination: "customer",
        size: "M",
        stock_item_id: item("SL", "Azzurro", "M"),
        quantity: 1,
      },
      { destination: "customer", size: "XXXL", stock_item_id: null, quantity: 1 },
    ],
    "Per il cliente: XXXL senza variante, M con la variante del catalogo",
  );
  eq(
    await run("set_restock_lines", linesPayload(first, 2, firstLines), linesOp),
    { ...setLines, replayed: true },
    "Replay delle righe",
  );
  for (const [label, wrong, message, detail] of [
    [
      "XS per Milano",
      line("shop", "GT3RS", "Blu", "XS", 1),
      "size_not_in_shop",
      sku("GT3RS", "Blu", "XS"),
    ],
    [
      "XXL per Milano",
      line("shop", "SL", "Azzurro", "XXL", 1),
      "size_not_in_shop",
      sku("SL", "Azzurro", "XXL"),
    ],
    ["XXXL per noi", line("warehouse", "GT3RS", "Blu", "XXXL", 1), "unknown_variant", ""],
    ["colore inesistente", line("customer", "GT3RS", "Viola", "M", 1), "unknown_variant", ""],
  ])
    await rejects(
      () => run("set_restock_lines", linesPayload(first, 3, [...firstLines, wrong])),
      message,
      "22023",
      detail,
      label,
    );
  await rejects(
    () =>
      run(
        "set_restock_lines",
        linesPayload(first, 3, [
          {
            destination: "shop",
            product_id: capProduct,
            color: "Verde",
            size: "UNICA",
            quantity: 1,
          },
        ]),
      ),
    "invalid_tshirt",
    "22023",
  );
  await rejects(
    () => run("set_restock_lines", linesPayload(first, 3, [firstLines[0], firstLines[0]])),
    "invalid_payload",
    "22023",
  );
  await rejects(
    () => run("set_restock_lines", linesPayload(first, 3, [{ ...firstLines[0], size: "m" }])),
    "invalid_payload",
    "22023",
  );
  await rejects(
    () =>
      run(
        "set_restock_lines",
        linesPayload(
          first,
          3,
          Array.from({ length: 601 }, () => firstLines[0]),
        ),
      ),
    "invalid_payload",
    "22023",
  );
  await rejects(
    () => run("set_restock_lines", linesPayload(first, 2, firstLines)),
    "stale_version",
    "22023",
  );
  const keptLine = await one(
    "select id from public.restock_lines where order_id=$1 and destination='warehouse' and size='M'",
    [first],
  );
  const secondLines = [
    line("warehouse", "GT3RS", "Blu", "M", 3),
    line("warehouse", "SL", "Azzurro", "L", 6),
    line("warehouse", "SENNA", "Bianco", "S", 2),
    line("shop", "GT3RS", "Blu", "S", 2),
    line("shop", "SL", "Azzurro", "XL", 1),
    line("customer", "GT3RS", "Blu", "XXXL", 1),
  ];
  const auditLines = await count("public.audit_logs", "table_name='restock_lines'");
  await run("set_restock_lines", linesPayload(first, 3, secondLines));
  eq(
    (
      await one(
        "select id from public.restock_lines where order_id=$1 and destination='warehouse' and size='M' and color='Blu'",
        [first],
      )
    ).id,
    keptLine.id,
    "Una riga uguale resta la stessa riga",
  );
  eq(
    (
      await rows(
        "select operation from public.audit_logs where table_name='restock_lines' order by occurred_at, operation offset $1",
        [auditLines],
      )
    )
      .map((row) => row.operation)
      .sort(),
    ["DELETE", "DELETE", "INSERT", "UPDATE"],
    "Solo le righe cambiate: due tolte, una nuova, una aggiornata",
  );
  eq(
    (await one("select sum(quantity)::int n from public.restock_lines where order_id=$1", [first]))
      .n,
    15,
    "Quindici pezzi dopo la modifica",
  );
  await rejects(
    () =>
      run(
        "save_restock_order",
        orderPayload({ order_id: first, expected_version: 4, shop_location_id: other }),
      ),
    "shop_has_lines",
    "22023",
  );

  // 5 · Stati: avanti e indietro fino all'arrivo, con lo storico.
  let version = 4;
  for (const [state, note] of [
    ["supplier", "Ordinate a Marco"],
    ["quality", ""],
    ["embroiderer", "Torna dal ricamatore"],
    ["quality", "Da Antonella"],
  ]) {
    const moved = await run(
      "move_restock_order",
      movePayload(first, version, state, note),
      randomUUID(),
      "founder",
    );
    eq([moved.state, moved.version], [state, version + 1], `Passo a ${state}`);
    version = moved.version;
  }
  eq(
    (
      await rows(
        "select from_state, to_state, note, created_by from public.restock_state_events where order_id=$1 order by created_at",
        [first],
      )
    ).slice(1),
    [
      {
        from_state: "discussion",
        to_state: "supplier",
        note: "Ordinate a Marco",
        created_by: ids.founder,
      },
      { from_state: "supplier", to_state: "quality", note: "", created_by: ids.founder },
      {
        from_state: "quality",
        to_state: "embroiderer",
        note: "Torna dal ricamatore",
        created_by: ids.founder,
      },
      {
        from_state: "embroiderer",
        to_state: "quality",
        note: "Da Antonella",
        created_by: ids.founder,
      },
    ],
    "Storico completo, anche all'indietro",
  );
  await rejects(
    () => run("move_restock_order", movePayload(first, version, "quality")),
    "invalid_payload",
    "22023",
  );
  await rejects(
    () => run("move_restock_order", movePayload(first, version, "in_hand")),
    "invalid_payload",
    "22023",
  );
  await rejects(
    () => run("move_restock_order", movePayload(first, version - 1, "supplier")),
    "stale_version",
    "22023",
  );
  await rejects(
    () => run("move_restock_order", movePayload(randomUUID(), 1, "supplier")),
    "restock_not_found",
    "22023",
  );
  await rejects(
    () =>
      as("founder", () =>
        db.query("update public.restock_state_events set note='x' where order_id=$1", [first]),
      ),
    null,
    "42501",
  );

  // 6 · Arrivo: per noi e per il negozio entrano nel Magadzino una volta sola; per il cliente mai.
  const balancesBefore = {
    gt3m: await bal(item("GT3RS", "Blu", "M")),
    gt3s: await bal(item("GT3RS", "Blu", "S")),
    slL: await bal(item("SL", "Azzurro", "L")),
    slXL: await bal(item("SL", "Azzurro", "XL")),
    sennaS: await bal(item("SENNA", "Bianco", "S")),
    milanS: await bal(item("GT3RS", "Blu", "S"), milan),
  };
  await db.query("update public.app_settings set stock_adjustments_enabled=false where id");
  await rejects(
    () => run("receive_restock_order", receivePayload(first, version, 14)),
    "stock_mutations_disabled",
    "42501",
  );
  await db.query("update public.app_settings set stock_adjustments_enabled=true where id");
  await rejects(
    () => run("receive_restock_order", receivePayload(first, version, 15)),
    "stale_version",
    "22023",
  );
  const movementsBefore = await count("public.stock_movements");
  const receiveOp = randomUUID();
  const received = await run(
    "receive_restock_order",
    receivePayload(first, version, 14, "Arrivate"),
    receiveOp,
    "founder",
  );
  eq(
    received,
    {
      operation_id: receiveOp,
      order_id: first,
      arrival_id: receiveOp,
      pieces: 14,
      state: "in_hand",
      version: version + 1,
      replayed: false,
    },
    "In mano nostra: 14 pezzi caricati",
  );
  version = received.version;
  eq(
    [
      await bal(item("GT3RS", "Blu", "M")),
      await bal(item("GT3RS", "Blu", "S")),
      await bal(item("SL", "Azzurro", "L")),
      await bal(item("SL", "Azzurro", "XL")),
      await bal(item("SENNA", "Bianco", "S")),
      await bal(item("GT3RS", "Blu", "S"), milan),
    ],
    [
      balancesBefore.gt3m + 3,
      balancesBefore.gt3s + 2,
      balancesBefore.slL + 6,
      balancesBefore.slXL + 1,
      balancesBefore.sennaS + 2,
      balancesBefore.milanS,
    ],
    "Magadzino: più per noi e per il negozio, il negozio non cambia",
  );
  eq(await count("public.stock_movements"), movementsBefore + 5, "Un movimento per variante");
  eq(
    await rows(
      `select kind::text kind, reason, quantity_delta::int delta, source->>'restock_order_id' restock, source->>'restock_arrival_id' arrival,
        (source->>'warehouse_quantity')::int warehouse, (source->>'shop_quantity')::int shop, actor_id
       from public.stock_movements where stock_item_id=$1 and kind='restock_receipt'`,
      [item("GT3RS", "Blu", "S")],
    ),
    [
      {
        kind: "restock_receipt",
        reason: "Riassortimento: Riordine sintetico",
        delta: 2,
        restock: first,
        arrival: receiveOp,
        warehouse: 0,
        shop: 2,
        actor_id: ids.founder,
      },
    ],
    "Movimento chiaro: tipo, causale «Riassortimento: …», origine e chi",
  );
  eq(
    await count(
      "public.stock_movements",
      "source->>'restock_order_id'=$1 and stock_item_id is null",
      [first],
    ),
    0,
    "Nessun movimento per la XXXL del cliente",
  );
  eq(
    await one(
      "select pieces, warehouse_pieces, shop_pieces, customer_pieces, previous_state, location_id from public.restock_arrivals where id=$1",
      [receiveOp],
    ),
    {
      pieces: 14,
      warehouse_pieces: 11,
      shop_pieces: 3,
      customer_pieces: 1,
      previous_state: "quality",
      location_id: central,
    },
    "Arrivo: 11 per noi, 3 per il negozio, 1 per il cliente",
  );
  eq(
    await run(
      "receive_restock_order",
      receivePayload(first, version - 1, 14, "Arrivate"),
      receiveOp,
      "founder",
    ),
    { ...received, replayed: true },
    "Replay dell'arrivo: nessun secondo carico",
  );
  eq(await count("public.stock_movements"), movementsBefore + 5, "Ancora cinque movimenti");
  await rejects(
    () => run("receive_restock_order", receivePayload(first, version, 14), randomUUID(), "founder"),
    "restock_received",
    "22023",
  );
  await rejects(
    () => run("set_restock_lines", linesPayload(first, version, secondLines)),
    "restock_received",
    "22023",
  );
  await rejects(
    () => run("move_restock_order", movePayload(first, version, "quality")),
    "restock_received",
    "22023",
  );

  // 7 · Ordine del negozio legato al riordine, consegna come oggi.
  const consignmentOrder = (lines, over = {}) => ({
    schema_version: 1,
    order_id: null,
    expected_version: null,
    location_id: milan,
    requested_on: "2026-10-23",
    note: "Riordine sintetico",
    lines,
    ...over,
  });
  const lcmLines = [
    { stock_item_id: item("GT3RS", "Blu", "S"), quantity: 2 },
    { stock_item_id: item("SL", "Azzurro", "XL"), quantity: 1 },
  ].sort((a, b) => (a.stock_item_id < b.stock_item_id ? -1 : 1));
  const requested = await today();
  const second = (await run("save_restock_order", orderPayload({ title: "Secondo sintetico" })))
    .order_id;
  await rejects(
    () =>
      run(
        "save_consignment_order",
        consignmentOrder(lcmLines, { requested_on: requested, restock_order_id: second }),
      ),
    "restock_not_ready",
    "22023",
  );
  await rejects(
    () =>
      run(
        "save_consignment_order",
        consignmentOrder(lcmLines, {
          requested_on: requested,
          restock_order_id: first,
          location_id: other,
        }),
      ),
    "restock_not_ready",
    "22023",
  );
  const linkedOp = randomUUID();
  const linked = await run(
    "save_consignment_order",
    consignmentOrder(lcmLines, { requested_on: requested, restock_order_id: first }),
    linkedOp,
  );
  eq(
    (
      await one("select restock_order_id from public.consignment_orders where id=$1", [
        linked.order_id,
      ])
    ).restock_order_id,
    first,
    "Ordine del negozio legato al riordine",
  );
  eq(
    await run(
      "save_consignment_order",
      consignmentOrder(lcmLines, { requested_on: requested, restock_order_id: first }),
      linkedOp,
    ),
    { ...linked, replayed: true },
    "Replay dell'ordine legato",
  );
  const plain = await run(
    "save_consignment_order",
    consignmentOrder(lcmLines, { requested_on: requested }),
  );
  eq(
    (
      await one("select restock_order_id from public.consignment_orders where id=$1", [
        plain.order_id,
      ])
    ).restock_order_id,
    null,
    "Senza la chiave l'ordine resta come prima",
  );
  await run("close_consignment_order", {
    schema_version: 1,
    order_id: plain.order_id,
    expected_version: 1,
    reason: "Ordine sintetico doppio",
  });
  await rejects(
    () =>
      run(
        "save_consignment_order",
        consignmentOrder(lcmLines, {
          requested_on: requested,
          order_id: linked.order_id,
          expected_version: 1,
          restock_order_id: first,
        }),
      ),
    "invalid_payload",
    "22023",
  );
  await rejects(
    () =>
      run(
        "save_consignment_order",
        consignmentOrder([{ stock_item_id: item("GT3RS", "Blu", "XS"), quantity: 1 }], {
          requested_on: requested,
        }),
      ),
    "size_not_in_shop",
    "22023",
    sku("GT3RS", "Blu", "XS"),
  );
  await rejects(
    () => run("undo_restock_arrival", undoPayload(first, version), randomUUID(), "founder"),
    "shop_order_linked",
    "22023",
    String(linked.order_number),
  );
  // Prima conta di Milano: solo le T-shirt attive nelle sue taglie.
  const tshirts = RANGES.flatMap(([model, color]) => SIZES.map((size) => ({ model, color, size })));
  const countLine = (row, quantity = 0) => ({
    stock_item_id: item(row.model, row.color, row.size),
    quantity,
    expected_quantity: 0,
  });
  const milanSizes = tshirts.filter((row) => ["S", "M", "L", "XL"].includes(row.size));
  // Le due varianti SENNA Nero (M, L) non hanno ancora una giacenza nei negozi.
  const blackSenna = [fresh, unknownItem].map((stockItem) => ({
    stock_item_id: stockItem,
    quantity: 0,
    expected_quantity: null,
  }));
  const countPayload = (lines, location = milan) => ({
    schema_version: 1,
    location_id: location,
    counted_at: new Date().toISOString(),
    note: "",
    lines: [...lines, ...blackSenna],
  });
  await rejects(
    () =>
      run(
        "count_consignment_stock",
        countPayload(milanSizes.slice(1).map((row) => countLine(row))),
      ),
    "full_count_required",
    "22023",
  );
  await rejects(
    () =>
      run(
        "count_consignment_stock",
        countPayload(
          [...milanSizes, { model: "GT3RS", color: "Blu", size: "XS" }].map((row) =>
            countLine(row),
          ),
        ),
      ),
    "size_not_in_shop",
    "22023",
    sku("GT3RS", "Blu", "XS"),
  );
  const counted = await run(
    "count_consignment_stock",
    countPayload(milanSizes.map((row) => countLine(row))),
  );
  eq([counted.full_count, counted.pieces], [true, 0], "Prima conta di Milano in S–XL: completa");
  await rejects(
    () =>
      run(
        "count_consignment_stock",
        countPayload(
          milanSizes.map((row) => countLine(row)),
          other,
        ),
      ),
    "full_count_required",
    "22023",
  );
  const shipped = await run("ship_consignment_order", {
    schema_version: 1,
    order_id: linked.order_id,
    expected_version: 1,
    occurred_at: new Date().toISOString(),
    lines: lcmLines,
  });
  eq(shipped.status, "delivered", "Consegna a Milano registrata come oggi");
  eq(
    [
      await bal(item("GT3RS", "Blu", "S")),
      await bal(item("SL", "Azzurro", "XL")),
      await bal(item("GT3RS", "Blu", "S"), milan),
      await bal(item("SL", "Azzurro", "XL"), milan),
    ],
    [balancesBefore.gt3s, balancesBefore.slXL, 2, 1],
    "Dopo la consegna: nel Magadzino resta solo il «per noi», il negozio ha le sue",
  );
  await rejects(
    () => run("undo_restock_arrival", undoPayload(first, version), randomUUID(), "founder"),
    "shop_order_linked",
    "22023",
    String(linked.order_number),
  );

  // 8 · Annulla arrivo: solo se i pezzi sono ancora liberi; poi il riordine si modifica di nuovo.
  const undoOrder = (
    await run("save_restock_order", orderPayload({ title: "Da annullare", shop_location_id: null }))
  ).order_id;
  await run(
    "set_restock_lines",
    linesPayload(undoOrder, 1, [
      line("warehouse", "F40", "Bianco", "L", 4),
      line("warehouse", "964", "Blu", "M", 2),
      line("customer", "F40", "Bianco", "XXXL", 1),
    ]),
  );
  await run("move_restock_order", movePayload(undoOrder, 2, "supplier"));
  const undoBefore = [await bal(item("F40", "Bianco", "L")), await bal(item("964", "Blu", "M"))];
  const undoArrival = await run("receive_restock_order", receivePayload(undoOrder, 3, 6));
  eq(
    [await bal(item("F40", "Bianco", "L")), await bal(item("964", "Blu", "M"))],
    [undoBefore[0] + 4, undoBefore[1] + 2],
    "Arrivo da annullare caricato",
  );
  await rejects(
    () =>
      run("set_restock_shop_done", {
        schema_version: 1,
        order_id: undoOrder,
        expected_version: 4,
        done: true,
      }),
    "invalid_payload",
    "22023",
  );
  await as("logistics", () =>
    db.query("select public.adjust_stock($1,$2,$3,$4,$5)", [
      randomUUID(),
      item("F40", "Bianco", "L"),
      central,
      -(undoBefore[0] + 1),
      "Vendita sintetica fuori dal gestionale",
    ]),
  );
  const blockedPrint = await fingerprint();
  await rejects(
    () => run("undo_restock_arrival", undoPayload(undoOrder, 4)),
    "restock_stock_used",
    "22023",
    sku("F40", "Bianco", "L"),
  );
  eq(await fingerprint(), blockedPrint, "Annullo rifiutato: nessun movimento");
  await as("logistics", () =>
    db.query("select public.adjust_stock($1,$2,$3,$4,$5)", [
      randomUUID(),
      item("F40", "Bianco", "L"),
      central,
      undoBefore[0] + 1,
      "Rettifica sintetica di ritorno",
    ]),
  );
  const undoOp = randomUUID();
  const undone = await run(
    "undo_restock_arrival",
    undoPayload(undoOrder, 4, "Contati male"),
    undoOp,
  );
  eq(
    [undone.state, undone.version, undone.pieces, undone.arrival_id],
    ["supplier", 5, 6, undoArrival.arrival_id],
    "Arrivo annullato: il riordine torna «Ordine magliette a Marco»",
  );
  eq(
    [await bal(item("F40", "Bianco", "L")), await bal(item("964", "Blu", "M"))],
    undoBefore,
    "Magadzino come prima dell'arrivo",
  );
  eq(
    await rows(
      "select kind::text kind, quantity_delta::int delta, reason from public.stock_movements where source->>'restock_undo_id'=$1 order by stock_item_id",
      [undoOp],
    ),
    [
      {
        kind: "restock_receipt_reversal",
        delta: -2,
        reason: "Arrivo annullato. Riassortimento: Da annullare",
      },
      {
        kind: "restock_receipt_reversal",
        delta: -4,
        reason: "Arrivo annullato. Riassortimento: Da annullare",
      },
    ],
    "Movimenti opposti, uno per variante",
  );
  eq(
    await one("select undone_by, undo_operation_id from public.restock_arrivals where id=$1", [
      undoArrival.arrival_id,
    ]),
    { undone_by: ids.logistics, undo_operation_id: undoOp },
    "Arrivo chiuso con chi e il riferimento dell'annullo",
  );
  eq(
    await run("undo_restock_arrival", undoPayload(undoOrder, 4, "Contati male"), undoOp),
    { ...undone, replayed: true },
    "Replay dell'annullo",
  );
  await rejects(
    () => run("undo_restock_arrival", undoPayload(undoOrder, 5)),
    "restock_not_received",
    "22023",
  );
  await run(
    "set_restock_lines",
    linesPayload(undoOrder, 5, [line("warehouse", "F40", "Bianco", "L", 5)]),
  );
  const again = await run("receive_restock_order", receivePayload(undoOrder, 6, 5));
  eq(
    [
      again.state,
      await bal(item("F40", "Bianco", "L")),
      await count("public.restock_arrivals", "order_id=$1", [undoOrder]),
    ],
    ["in_hand", undoBefore[0] + 5, 2],
    "Dopo l'annullo il riordine si modifica e arriva di nuovo",
  );

  // Variante nuova (giacenza da 0) e giacenza ignota.
  const freshOrder = (
    await run(
      "save_restock_order",
      orderPayload({ title: "Variante nuova", shop_location_id: null }),
    )
  ).order_id;
  await run(
    "set_restock_lines",
    linesPayload(freshOrder, 1, [line("warehouse", "SENNA", "Nero", "M", 3)]),
  );
  await run("receive_restock_order", receivePayload(freshOrder, 2, 3));
  eq(
    await rows(
      "select kind::text kind, quantity_delta::int delta from public.stock_movements where stock_item_id=$1 and location_id=$2 order by created_at, kind::text",
      [fresh, central],
    ),
    [
      { kind: "opening", delta: 0 },
      { kind: "restock_receipt", delta: 3 },
    ],
    "Variante mai entrata: giacenza di partenza 0, poi l'arrivo",
  );
  eq(await bal(fresh), 3, "Tre pezzi nel Magadzino");
  const unknownOrder = (
    await run(
      "save_restock_order",
      orderPayload({ title: "Giacenza ignota", shop_location_id: null }),
    )
  ).order_id;
  await run(
    "set_restock_lines",
    linesPayload(unknownOrder, 1, [line("warehouse", "SENNA", "Nero", "L", 1)]),
  );
  await rejects(
    () => run("receive_restock_order", receivePayload(unknownOrder, 2, 1)),
    "unknown_stock",
    "22023",
    "SYN-SENNA-NERO-L",
  );
  eq(
    await count("public.restock_arrivals", "order_id=$1", [unknownOrder]),
    0,
    "Nessun arrivo a metà",
  );

  // Segno a mano «consegnate al negozio».
  const manual = (await run("save_restock_order", orderPayload({ title: "Segno a mano" })))
    .order_id;
  await run("set_restock_lines", linesPayload(manual, 1, [line("shop", "964", "Bianco", "M", 1)]));
  await run("receive_restock_order", receivePayload(manual, 2, 1));
  const doneOp = randomUUID();
  const marked = await run(
    "set_restock_shop_done",
    { schema_version: 1, order_id: manual, expected_version: 3, done: true },
    doneOp,
  );
  eq([marked.done, marked.version], [true, 4], "Segnate consegnate al negozio");
  ok((await order(manual)).shop_done_at, "Data del segno");
  await rejects(
    () => run("undo_restock_arrival", undoPayload(manual, 4)),
    "shop_order_linked",
    "22023",
    "",
  );
  await run("set_restock_shop_done", {
    schema_version: 1,
    order_id: manual,
    expected_version: 4,
    done: false,
  });
  await run("undo_restock_arrival", undoPayload(manual, 5));
  eq((await order(manual)).state, "discussion", "Senza segno l'arrivo si annulla");

  // 9 · Taglie del negozio nel conto vendita: le magliette riportate restano possibili.
  await db.query("update public.consignment_shops set sizes=null where location_id=$1", [other]);
  const otherCount = await run(
    "count_consignment_stock",
    countPayload(
      tshirts.map((row) =>
        countLine(row, row.model === "GT3RS" && row.color === "Blu" && row.size === "XS" ? 1 : 0),
      ),
      other,
    ),
  );
  eq(otherCount.full_count, true, "Negozio con tutte le taglie: la prima conta le comprende tutte");
  await db.query(
    "update public.consignment_shops set sizes=array['S','M','L','XL'] where location_id=$1",
    [other],
  );
  await run("return_consignment_stock", {
    schema_version: 1,
    location_id: other,
    occurred_at: new Date().toISOString(),
    reason: "XS riportata in magazzino",
    lines: [{ stock_item_id: item("GT3RS", "Blu", "XS"), quantity: 1 }],
  });
  eq(
    await bal(item("GT3RS", "Blu", "XS"), other),
    0,
    "Una XS si riporta in magazzino anche fuori taglia",
  );
  await db.query("update public.consignment_shops set sizes=null where location_id=$1", [other]);

  // 10 · Audit e feed di Controllo CEO.
  eq(
    await count("public.audit_logs", "table_name='restock_orders' and actor_id is null"),
    0,
    "Ogni scrittura dei comandi ha la persona",
  );
  ok(
    (await count("public.audit_logs", "table_name='restock_state_events'")) >= 8,
    "Storico degli stati nel registro",
  );
  const feedRows = await feed();
  ok(feedRows.length > 0, "Il feed legge le ultime 24 ore");
  const firstHref = `/stock/riassortimento/${first}`;
  await feedHas(
    "Sintetico logistics ha creato il riordine «Riordine sintetico».",
    firstHref,
    "Creazione",
  );
  await feedHas(
    "Sintetico founder ha portato il riordine «Riordine sintetico» a «Ordine magliette a Marco».",
    firstHref,
    "Stato avanti",
  );
  await feedHas(
    "Sintetico founder ha portato il riordine «Riordine sintetico» a «Dal ricamatore».",
    firstHref,
    "Stato indietro",
  );
  ok(
    feedRows.filter(
      (row) =>
        row.message ===
        "Sintetico logistics ha cambiato le quantità del riordine «Riordine sintetico».",
    ).length >= 2,
    "Quantità cambiate",
  );
  await feedHas(
    "Sintetico founder ha caricato in Magadzino il riordine «Riordine sintetico»: 11 pezzi per noi e 3 per Libreria sintetica Milano.",
    firstHref,
    "Arrivo",
  );
  await feedHas(
    "Sintetico logistics ha annullato l’arrivo del riordine «Da annullare»: 6 pezzi tolti da Magadzino.",
    `/stock/riassortimento/${undoOrder}`,
    "Annullo",
  );
  await feedHas(
    "Sintetico logistics ha segnato come consegnate a Libreria sintetica Milano le magliette del riordine «Segno a mano».",
    `/stock/riassortimento/${manual}`,
    "Segno a mano",
  );
  await feedHas(
    "Sintetico logistics ha aggiornato il riordine «Riordine sintetico».",
    firstHref,
    "Nota",
  );
  const sizesLine = feedRows.find((row) => row.message.includes("ha impostato le taglie"));
  eq(
    [sizesLine?.message, sizesLine?.area, sizesLine?.href],
    [
      "Il sistema ha impostato le taglie di Libreria sintetica Milano: S, M, L, XL.",
      "consignment",
      "/consignment/NEG01",
    ],
    "Taglie del negozio nel feed, dal sistema",
  );
  eq(feedRows.filter((row) => /€|cent/.test(row.message)).length, 0, "Nessun importo nelle frasi");

  // 11 · Import dei due riordini in corso sul catalogo sintetico.
  const importSql = readFileSync(
    new URL("../imports/20261023_riassortimento.sql", import.meta.url),
    "utf8",
  );
  const importBefore = await fingerprint();
  const auditTablesBefore = await auditByTable();
  await db.exec(importSql);
  eq(await fingerprint(), importBefore, "Import: nessun saldo o movimento");
  const auditTablesAfter = await auditByTable();
  eq(
    Object.keys(auditTablesAfter)
      .filter((table) => auditTablesAfter[table] !== auditTablesBefore[table])
      .sort(),
    ["restock_lines", "restock_orders", "restock_state_events"],
    "Import: solo righe di audit delle tabelle nuove",
  );
  const imported = await rows(
    `select o.id, o.title, o.state, o.created_by, o.shop_location_id, o.warehouse_location_id,
      coalesce(sum(l.quantity), 0)::int total,
      coalesce(sum(l.quantity) filter (where l.destination = 'warehouse'), 0)::int warehouse,
      coalesce(sum(l.quantity) filter (where l.destination = 'shop'), 0)::int shop,
      coalesce(sum(l.quantity) filter (where l.destination = 'customer'), 0)::int customer
     from public.restock_orders o left join public.restock_lines l on l.order_id = o.id
     where o.title in ('Riordine settembre 2026', 'Pezzi in controllo da Antonella')
     group by o.id order by o.title desc`,
  );
  eq(
    imported.map(({ id: _, ...row }) => row),
    [
      {
        title: "Riordine settembre 2026",
        state: "quality",
        created_by: ids.founder,
        shop_location_id: milan,
        warehouse_location_id: central,
        total: 85,
        warehouse: 64,
        shop: 17,
        customer: 4,
      },
      {
        title: "Pezzi in controllo da Antonella",
        state: "quality",
        created_by: ids.founder,
        shop_location_id: null,
        warehouse_location_id: central,
        total: 36,
        warehouse: 36,
        shop: 0,
        customer: 0,
      },
    ],
    "Import: 85 = 64 + 17 + 4, e 36 tutti per noi, «Da Antonella», dal founder",
  );
  const september = imported[0].id;
  eq(
    await rows(
      "select size, stock_item_id from public.restock_lines where order_id=$1 and destination='customer' order by color, size",
      [september],
    ),
    [
      { size: "XXXL", stock_item_id: null },
      { size: "XXXL", stock_item_id: null },
      { size: "XXXL", stock_item_id: null },
      { size: "XXXL", stock_item_id: null },
    ],
    "Le quattro XXXL sono per il cliente, senza variante",
  );
  eq(
    await rows(
      "select e.from_state, e.to_state, e.note, e.created_by from public.restock_state_events e where e.order_id in ($1,$2) order by e.order_id",
      [imported[0].id, imported[1].id],
    ),
    [imported[0].id, imported[1].id].sort().map(() => ({
      from_state: null,
      to_state: "quality",
      note: "Importato dal file di produzione",
      created_by: ids.founder,
    })),
    "Storico: «Da Antonella», importato dal file",
  );
  eq(
    (
      await rows(
        "select size, sum(quantity)::int n from public.restock_lines where order_id=$1 group by size order by size",
        [september],
      )
    )
      .map((row) => `${row.size}:${row.n}`)
      .sort(),
    ["L:22", "M:19", "S:16", "XL:18", "XS:1", "XXL:5", "XXXL:4"].sort(),
    "Totali per taglia come nel file: XS 1, S 16, M 19, L 22, XL 18, XXL 5, XXXL 4",
  );
  const auditAfterImport = await count("public.audit_logs");
  await db.exec(importSql);
  eq(
    [
      await count(
        "public.restock_orders",
        "title in ('Riordine settembre 2026','Pezzi in controllo da Antonella')",
      ),
      await count("public.audit_logs"),
    ],
    [2, auditAfterImport],
    "Import ripetuto: niente di nuovo",
  );
  ok(
    (await feed()).some(
      (row) =>
        row.message === "Il sistema ha importato 2 riordini." &&
        row.href === "/stock/riassortimento",
    ),
    "Import nel feed: una frase per i due riordini",
  );

  // Il riordine importato arriva: nel Magadzino 64 + 17; dopo la consegna a Milano restano 64.
  const centralTotal = async () =>
    (
      await one(
        "select coalesce(sum(quantity),0)::int n from public.stock_balances where location_id=$1",
        [central],
      )
    ).n;
  const milanTotal = async () =>
    (
      await one(
        "select coalesce(sum(quantity),0)::int n from public.stock_balances where location_id=$1",
        [milan],
      )
    ).n;
  const [centralBefore, milanBefore] = [await centralTotal(), await milanTotal()];
  const septemberOrder = await order(september);
  const arrived = await run(
    "receive_restock_order",
    receivePayload(september, septemberOrder.version, 81),
    randomUUID(),
    "founder",
  );
  eq(arrived.pieces, 81, "All'arrivo entrano 81 pezzi: 64 per noi e 17 per il negozio");
  eq(await centralTotal(), centralBefore + 81, "Magadzino +81");
  const shopLines = await rows(
    "select stock_item_id, quantity from public.restock_lines where order_id=$1 and destination='shop' order by stock_item_id",
    [september],
  );
  eq(
    shopLines.reduce((sum, row) => sum + row.quantity, 0),
    17,
    "Diciassette pezzi per il negozio",
  );
  const septemberShop = await run(
    "save_consignment_order",
    consignmentOrder(shopLines, { requested_on: requested, restock_order_id: september }),
  );
  await run("ship_consignment_order", {
    schema_version: 1,
    order_id: septemberShop.order_id,
    expected_version: 1,
    occurred_at: new Date().toISOString(),
    lines: shopLines,
  });
  eq(
    [await centralTotal(), await milanTotal()],
    [centralBefore + 64, milanBefore + 17],
    "Dopo la consegna: Magadzino +64 (per noi), Milano +17, le XXXL mai in magazzino",
  );

  console.log(`PASS ${checks} riassortimento checks; PGlite, dati sintetici, nessun cloud.`);
} finally {
  await db.close();
}
