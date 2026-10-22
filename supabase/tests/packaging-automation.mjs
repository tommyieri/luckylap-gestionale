// Synthetic PostgreSQL semantics + mocked Auth. No DSN or cloud connection.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (!process.argv[2]?.startsWith("/")) throw Error("Pass absolute external PGlite dist/index.js");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const eq = (a, b, m = "Values must match") => {
  assert.deepEqual(a, b, m);
  checks++;
};
const ok = (a, m = "Expected truthy value") => {
  assert.ok(a, m);
  checks++;
};
const u = randomUUID(),
  outsider = randomUUID(),
  mag = randomUUID(),
  shop = randomUUID(),
  shirt = randomUUID(),
  hat = randomUUID(),
  retailSticker = randomUUID();
const now = () => new Date().toISOString();
const before = "2020-01-01T12:00:00Z";
const count = async (t) => (await db.query(`select count(*)::int n from ${t}`)).rows[0].n;
const balance = async (item) =>
  Number(
    (
      await db.query(
        "select quantity from public.stock_balances where stock_item_id=$1 and location_id=$2",
        [item, mag],
      )
    ).rows[0]?.quantity,
  );
async function asUser(fn, id = u, role = "authenticated") {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: id, aal: "aal1", user_metadata: { role: "founder" } }),
    ]);
    await db.exec(`set local role ${role}`);
    const r = await fn();
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
async function rejects(fn, code, message) {
  let error;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  ok(error, "Expected rejection");
  eq(error.code, code);
  if (message) eq(error.message, message);
}
const cmd = async (kind, payload, operation = randomUUID(), id = u) =>
  asUser(
    async () =>
      (
        await db.query(`select public.${kind}($1,$2::jsonb)result`, [
          operation,
          JSON.stringify(payload),
        ])
      ).rows[0].result,
    id,
  );
const adjust = (item, expected, quantity, op = randomUUID()) =>
  cmd(
    "adjust_packaging_quantity",
    {
      schema_version: 1,
      stock_item_id: item,
      expected_quantity: expected,
      quantity,
      reason: "Synthetic verified count",
    },
    op,
  );
async function order(item = shirt, qty = 1, source = "manual_declaration", at = now()) {
  const oid = randomUUID(),
    line = randomUUID();
  await db.exec("begin");
  try {
    if (source === "shopify_canonical") await db.exec("set local role service_role");
    await db.query(
      `insert into public.sales_orders(id,operation_id,payload_sha256,channel,occurred_at,operational_date,total_cents,payment_state,fulfillment_mode,fulfillment_state,created_by,source_kind)
   values($1,$2,$3,$4,$5,($5::timestamptz at time zone 'Europe/Rome')::date,100,'unpaid','prepare','unfulfilled',$6,$7)`,
      [
        oid,
        randomUUID(),
        "0".repeat(64),
        source === "shopify_canonical" ? "shopify_web" : "direct",
        at,
        source === "shopify_canonical" ? null : u,
        source,
      ],
    );
    await db.query(
      `insert into public.sales_order_lines(id,order_id,stock_item_id,location_id,sku_snapshot,quantity,unit_price_cents,discount_cents,source_kind)values($1,$2,$3,$4,'SYNTHETIC', $5,100,0,$6)`,
      [line, oid, item, mag, qty, source],
    );
    await db.exec("commit");
    return { oid, line, item, source };
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
async function fulfill(o, qty, at = now()) {
  const fid = randomUUID(),
    movement = randomUUID();
  await db.exec("begin");
  try {
    if (o.source === "shopify_canonical") await db.exec("set local role service_role");
    await db.query(
      `insert into public.stock_movements(id,operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,$4,'sale_fulfillment',$5,'Synthetic delivery')`,
      [movement, randomUUID(), o.item, mag, -qty],
    );
    await db.query(
      "insert into public.fulfillment_lines(id,order_line_id,quantity,stock_movement_id,fulfilled_at)values($1,$2,$3,$4,$5)",
      [fid, o.line, qty, movement, at],
    );
    await db.query(
      "update public.sales_order_lines set fulfilled_quantity=fulfilled_quantity+$1 where id=$2",
      [qty, o.line],
    );
    await db.exec("commit");
    return fid;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
try {
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key);
 create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid()returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;`);
  const dir = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(dir)
    .filter((n) =>
      /_(initial_schema|sales_ecosystem|sales_lifecycle|packaging_materials|shopify_catalog|consignment_workflow|shopify_sales_core|packaging_automatic_consumption|consignment_monthly)\.sql$/.test(
        n,
      ),
    )
    .sort())
    await db.exec(readFileSync(new URL(name, dir), "utf8"));
  ok(true, "Forward migration parses on PostgreSQL");
  eq(await count("public.packaging_items"), 0, "Migration does not seed");
  await db.query("insert into auth.users(id)values($1),($2)", [u, outsider]);
  await db.query(
    "insert into public.profiles(user_id,display_name)values($1,'Synthetic operator')",
    [u],
  );
  await db.query("insert into public.memberships(user_id,role)values($1,'consultant')", [u]);
  await db.query(
    "insert into public.stock_locations(id,code,name,location_type)values($1,'MAG01','Synthetic Magazzino','Magazzino'),($2,'LCM','Synthetic shop','Negozio Conto Vendita')",
    [mag, shop],
  );
  for (const [item, category] of [
    [shirt, "T-shirt"],
    [hat, "Cappellino"],
    [retailSticker, "Adesivo"],
  ]) {
    const product = randomUUID();
    await db.query("insert into public.products(id,model,category)values($1,$2,$3)", [
      product,
      `Synthetic ${category}`,
      category,
    ]);
    await db.query("insert into public.stock_items(id,kind,sku,name)values($1,'product',$2,$3)", [
      item,
      `SYN-${item}`,
      `Synthetic ${category}`,
    ]);
    await db.query(
      "insert into public.product_variants(stock_item_id,product_id,color,size)values($1,$2,'Black','M')",
      [item, product],
    );
    await db.query(
      "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,'opening',1000,'Synthetic only')",
      [randomUUID(), item, mag],
    );
  }
  // Test transport grants only, so synthetic Shopify rows pass its source guard.
  await db.exec("grant select,insert,update on all tables in schema public to service_role");
  const existing = await order(shirt, 3, "shopify_canonical", before);
  await fulfill(await order(), 1);
  eq(await count("public.packaging_consumptions"), 0, "Before activation has no effects");
  await rejects(() => asUser(() => db.exec("select private.activate_tshirt_packaging()")), "42501");
  const activated = (await db.query("select private.activate_tshirt_packaging() result")).rows[0]
    .result;
  const box = activated.box_item_id,
    sticker = activated.sticker_item_id;
  eq(
    [await balance(box), await balance(sticker)],
    [100, 100],
    "Explicit owner count initializes exactly 100 each",
  );
  eq(await count("public.packaging_items"), 2);
  eq(
    (
      await db.query("select unit_cost_eur from public.stock_items where id in($1,$2)", [
        box,
        sticker,
      ])
    ).rows,
    [{ unit_cost_eur: null }, { unit_cost_eur: null }],
    "No costs invented",
  );
  eq(
    (
      await db.query("select specifications from public.packaging_items where stock_item_id=$1", [
        box,
      ])
    ).rows[0].specifications,
    "30 × 22,5 × 2,5 cm",
  );
  const moves = await count("public.stock_movements");
  eq(
    (await db.query("select private.activate_tshirt_packaging() result")).rows[0].result.replayed,
    true,
  );
  eq(await count("public.stock_movements"), moves, "Activation retry creates no openings");
  await db.exec("update public.app_settings set stock_adjustments_enabled=true");
  const manual = await order(shirt, 5);
  const status = async () =>
    (
      await asUser(() =>
        db.query("select * from public.packaging_material_status order by packaging_type"),
      )
    ).rows;
  eq(
    (await status()).map((r) => Number(r.reserved)),
    [8, 8],
    "Known open old + new orders reserve packaging",
  );
  const f1 = await fulfill(manual, 2);
  if (await count("public.packaging_automation_failures"))
    await db.query("select private.observe_packaging_source('fulfillment',$1)", [f1]);
  eq([await balance(box), await balance(sticker)], [98, 98]);
  eq(
    (await status()).map((r) => Number(r.reserved)),
    [6, 6],
    "Only partial delivery released from reservation",
  );
  await db.query("select private.observe_packaging_source('fulfillment',$1)", [f1]);
  eq(
    [await balance(box), await balance(sticker)],
    [98, 98],
    "Replayed source does not consume twice",
  );
  await fulfill(manual, 1);
  eq(
    [await balance(box), await balance(sticker)],
    [97, 97],
    "Second partial consumes only its delta",
  );
  await db.query(
    "update public.sales_order_lines set cancelled_quantity=quantity-fulfilled_quantity where id=$1",
    [manual.line],
  );
  eq(
    [await balance(box), await balance(sticker)],
    [97, 97],
    "Cancellation never restocks consumed material",
  );
  await fulfill(await order(hat), 1);
  await fulfill(await order(retailSticker), 1);
  eq(
    [await balance(box), await balance(sticker)],
    [97, 97],
    "Hats/retail stickers never consume packaging",
  );
  const web = await order(shirt, 1, "shopify_canonical");
  await fulfill(web, 1);
  eq([await balance(box), await balance(sticker)], [96, 96], "Shopify web delivery consumes");
  const pos = await order(shirt, 1, "shopify_canonical");
  await db.exec("begin;set local role service_role");
  await db.query("update public.sales_orders set channel='shopify_pos'where id=$1", [pos.oid]);
  await db.exec("commit");
  await fulfill(pos, 1);
  eq([await balance(box), await balance(sticker)], [95, 95], "Shopify POS consumes");
  await fulfill(existing, 1);
  eq(
    [await balance(box), await balance(sticker)],
    [94, 94],
    "Old known open order consumes a genuinely new delivery",
  );
  const late = await order(shirt, 1, "shopify_canonical", before);
  await fulfill(late, 1);
  eq(
    [await balance(box), await balance(sticker)],
    [94, 94],
    "Unseen old Shopify order is review-only",
  );
  eq(
    (await status()).map((r) => Number(r.historical_review)),
    [1, 1],
  );
  const old = await order(shirt, 1, "manual_declaration", before);
  await fulfill(old, 1, before);
  eq(
    [await balance(box), await balance(sticker)],
    [94, 94],
    "Old manual delivered_at never backfills",
  );
  await fulfill(await order(shirt, 1, "manual_declaration", before), 1);
  eq(
    [await balance(box), await balance(sticker)],
    [93, 93],
    "Old manual order may have a new real delivery",
  );
  // LCM transfers do not consume; confirmed LCM sale debits central packaging.
  const out = randomUUID(),
    incoming = randomUUID();
  for (const [id, loc, kind, delta] of [
    [out, mag, "transfer_out", -2],
    [incoming, shop, "transfer_in", 2],
  ]) {
    if (loc === shop)
      await db.query(
        "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,'opening',0,'Synthetic shop count')",
        [randomUUID(), shirt, shop],
      );
    await db.query(
      "insert into public.stock_movements(id,operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,$4,$5,$6,'Synthetic transfer')",
      [id, randomUUID(), shirt, loc, kind, delta],
    );
  }
  eq([await balance(box), await balance(sticker)], [93, 93], "Transfer has no packaging effects");
  const lcm = randomUUID(),
    lcmMove = randomUUID();
  await db.query(
    "insert into public.stock_movements(id,operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,$4,'consignment_sale',-1,'Synthetic LCM sale')",
    [lcmMove, randomUUID(), shirt, shop],
  );
  await db.query(
    `insert into public.consignment_sales(id,stock_item_id,location_id,sku_snapshot,quantity,shop_domain,variant_gid,catalog_observed_at,web_price_cents,unit_shop_price_cents,gross_cents,brand_claim_cents,shop_share_cents,external_reference,reason,occurred_at,movement_id,created_by)
 values($1,$2,$3,'SYNTHETIC',1,'synthetic.myshopify.com','gid://shopify/ProductVariant/1',$4,100,1100,1100,660,440,'Synthetic LCM','Synthetic sale',$4,$5,$6)`,
    [lcm, shirt, shop, now(), lcmMove, u],
  );
  eq([await balance(box), await balance(sticker)], [92, 92], "LCM consumes central only");
  await adjust(box, 92, 1);
  await adjust(sticker, 92, 0);
  const shortage = await order(shirt, 3);
  await fulfill(shortage, 3);
  eq(
    [await balance(box), await balance(sticker)],
    [0, 0],
    "Only actual available units are debited",
  );
  eq(
    (await status()).map((r) => [Number(r.reconcilable_deficit), Number(r.consumption_deficit)]),
    [
      [2, 3],
      [3, 4],
    ],
    "Deficit is explicit, with historical quantity separate",
  );
  eq(
    (
      await db.query("select fulfilled_quantity from public.sales_order_lines where id=$1", [
        shortage.line,
      ])
    ).rows[0].fulfilled_quantity,
    3,
    "Packaging shortage does not roll back the sale",
  );
  eq(
    await count("public.packaging_automation_failures"),
    0,
    "Ordinary shortage is handled without exception",
  );
  const adjustOp = randomUUID();
  await adjust(box, 0, 10, adjustOp);
  eq((await adjust(box, 0, 10, adjustOp)).replayed, true, "Manual count retry does not add stock");
  await rejects(() => adjust(box, 0, 11), "22023", "packaging_quantity_changed");
  await rejects(() => adjust(box, 10, 10), "22023", "quantity_unchanged");
  await adjust(sticker, 0, 10);
  const reconcileOp = randomUUID();
  const recon = await cmd("reconcile_packaging_consumption", { schema_version: 1 }, reconcileOp);
  eq(
    [await balance(box), await balance(sticker)],
    [8, 7],
    "Explicit reconciliation debits outstanding quantity once",
  );
  eq(recon.remaining_deficit, 2, "Historical review remains blocked");
  eq(
    (await cmd("reconcile_packaging_consumption", { schema_version: 1 }, reconcileOp)).replayed,
    true,
  );
  eq([await balance(box), await balance(sticker)], [8, 7]);
  await cmd("reconcile_packaging_consumption", { schema_version: 1 });
  eq(
    [await balance(box), await balance(sticker)],
    [8, 7],
    "New retry with no pending quantity has no debit",
  );
  const reviews = (
    await db.query("select id from public.packaging_consumptions where not automatic_allowed")
  ).rows;
  for (const row of reviews)
    await db.query(
      "select private.approve_packaging_review($1,'Synthetic explicit owner review')",
      [row.id],
    );
  eq([await balance(box), await balance(sticker)], [7, 6]);
  // A forced ledger failure is isolated, visible and recoverable, even after one material would have debited.
  await db.exec(
    `create function public.qa_fail_package()returns trigger language plpgsql as $$begin if new.source->>'kind'='packaging_consumption' then raise exception 'Synthetic packaging failure';end if;return new;end$$;create trigger qa_fail_package before insert on public.stock_movements for each row execute function public.qa_fail_package();`,
  );
  const failed = await order();
  await fulfill(failed, 1);
  eq(await count("public.packaging_automation_failures"), 1);
  eq([await balance(box), await balance(sticker)], [7, 6], "Packaging subtransaction rolled back");
  eq(
    (
      await db.query("select fulfilled_quantity from public.sales_order_lines where id=$1", [
        failed.line,
      ])
    ).rows[0].fulfilled_quantity,
    1,
    "Unexpected packaging error does not roll back core delivery",
  );
  await db.exec(
    "drop trigger qa_fail_package on public.stock_movements;drop function public.qa_fail_package()",
  );
  await cmd("reconcile_packaging_consumption", { schema_version: 1 });
  eq([await balance(box), await balance(sticker)], [6, 5]);
  eq(
    (await db.query("select resolved from public.packaging_automation_failures")).rows[0].resolved,
    true,
  );
  for (const table of [
    "packaging_automation",
    "packaging_consumptions",
    "packaging_consumption_entries",
    "packaging_automation_failures",
  ])
    await rejects(() => asUser(() => db.exec(`delete from public.${table}`)), "42501");
  await rejects(
    () => asUser(() => db.exec("select * from private.packaging_activation_orders")),
    "42501",
  );
  await rejects(
    () =>
      asUser(() =>
        db.exec("select private.approve_packaging_review(gen_random_uuid(),'Spoof review')"),
      ),
    "42501",
  );
  await rejects(
    () => asUser(() => db.exec("select * from public.packaging_material_status"), outsider, "anon"),
    "42501",
  );
  eq(
    (await asUser(() => db.exec("select * from public.packaging_material_status"), outsider))[0]
      .rows.length,
    0,
    "Uninvited account sees no material",
  );
  await rejects(
    () => cmd("reconcile_packaging_consumption", { schema_version: 1 }, randomUUID(), outsider),
    "42501",
    "membership_required",
  );
  await db.exec("update public.app_settings set stock_adjustments_enabled=false");
  eq(
    (await adjust(box, 0, 10, adjustOp)).replayed,
    true,
    "Exact receipt is readable after flag disabled",
  );
  await rejects(() => adjust(box, 6, 8), "42501", "stock_mutations_disabled");
  eq(await count("public.finance_entries"), 0, "Packaging creates no fabricated finance entries");
  eq(
    (
      await db.query(
        "select count(*)::int n from public.packaging_consumptions c where consumed_quantity<>(select coalesce(sum(quantity),0)from public.packaging_consumption_entries e where e.consumption_id=c.id)",
      )
    ).rows[0].n,
    0,
    "Every aggregate consumed quantity matches append-only ledger receipts",
  );
  console.log(
    `PASS ${checks} packaging automation checks; synthetic fixtures, mocked Auth, no cloud.`,
  );
} finally {
  await db.close();
}
