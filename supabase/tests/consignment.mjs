// Synthetic embedded PostgreSQL, mocked Auth. No cloud or actual stock writes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (!process.argv[2]) throw Error("Pass external PGlite module path");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const eq = (a, b, m = "Values must match") => {
  assert.deepEqual(a, b, m);
  checks++;
};
const ok = (v, m) => {
  assert.ok(v, m);
  checks++;
};
const id = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const roles = [
  "founder",
  "production",
  "finance",
  "logistics",
  "consultant",
  "outsider",
  "inactive",
];
const ids = Object.fromEntries(roles.map((r, i) => [r, id(i + 1)]));
const central = id(100),
  shop = id(101),
  external = id(102),
  unknown = id(103),
  shirt = id(200),
  other = id(201);
const domain = "synthetic.myshopify.com",
  variant = "gid://shopify/ProductVariant/123",
  observed = "2026-10-21T10:00:00Z",
  at = "2026-10-21T11:00:00Z";
async function user(name, fn, aal = "aal1", role = "authenticated") {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: ids[name], aal, user_metadata: { role: "founder" } }),
    ]);
    await db.exec(`set local role ${role}`);
    const value = await fn();
    await db.exec("commit");
    return value;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const run = (kind, payload, op = randomUUID(), who = "consultant", aal = "aal1") =>
  user(
    who,
    async () =>
      (await db.query(`select public.${kind}($1,$2::jsonb)result`, [op, JSON.stringify(payload)]))
        .rows[0].result,
    aal,
  );
const transfer = (over = {}) => ({
  schema_version: 1,
  stock_item_id: shirt,
  from_location_id: central,
  to_location_id: shop,
  quantity: 2,
  reason: "Synthetic allocation",
  occurred_at: at,
  ...over,
});
const sale = (over = {}) => ({
  schema_version: 1,
  stock_item_id: shirt,
  location_id: shop,
  quantity: 1,
  reason: "Synthetic shop declaration",
  external_reference: randomUUID(),
  occurred_at: at,
  shop_domain: domain,
  variant_gid: variant,
  expected_web_price_cents: 4001,
  expected_catalog_observed_at: observed,
  ...over,
});
const settle = (sale_id, over = {}) => ({
  schema_version: 1,
  sale_id,
  amount_cents: 1000,
  occurred_at: at,
  method: "bank_transfer",
  reference: randomUUID(),
  ...over,
});
async function rejects(fn, message, code) {
  let err;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  ok(err, `reject ${message}`);
  if (message) eq(err.message, message);
  if (code) eq(err.code, code);
}
const total = async (table) => (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
const balance = async (loc) =>
  (
    await db.query(
      "select quantity::int n from public.stock_balances where stock_item_id=$1 and location_id=$2",
      [shirt, loc],
    )
  ).rows[0]?.n;
try {
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;create table auth.users(id uuid primary key);create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;create function auth.uid()returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to anon,authenticated;`,
  );
  const dir = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(dir)
    .filter((n) =>
      /_(initial_schema|sales_ecosystem|sales_lifecycle|shopify_catalog|consignment_workflow|packaging_automatic_consumption|consignment_monthly)\.sql$/.test(
        n,
      ),
    )
    .sort())
    await db.exec(readFileSync(new URL(name, dir), "utf8"));
  for (const role of roles) {
    await db.query("insert into auth.users(id)values($1)", [ids[role]]);
    if (role === "outsider") continue;
    await db.query("insert into public.profiles(user_id,display_name)values($1,$2)", [
      ids[role],
      role,
    ]);
    await db.query(
      "insert into public.memberships(user_id,role,active,finance_access)values($1,$2,$3,$4)",
      [
        ids[role],
        role === "inactive" ? "logistics" : role,
        role !== "inactive",
        ["founder", "production", "finance"].includes(role),
      ],
    );
  }
  await db.query(
    "insert into public.stock_locations(id,code,name,location_type)values($1,'MAG','Synthetic central','Magazzino'),($2,'SHOP','Synthetic shop','Negozio Conto Vendita'),($3,'EXT','Synthetic external','Esterno'),($4,'UNKN','Synthetic unknown shop','Negozio Conto Vendita')",
    [central, shop, external, unknown],
  );
  await db.query(
    "insert into public.products(id,model,category)values($1,'Synthetic shirt','T-shirt'),($2,'Synthetic sticker','Adesivo')",
    [id(300), id(301)],
  );
  await db.query(
    "insert into public.stock_items(id,kind,sku,name,unit_cost_eur)values($1,'product','SYNTHETIC-TEE','Synthetic shirt',null),($2,'product','SYNTHETIC-STICKER','Synthetic sticker',1)",
    [shirt, other],
  );
  await db.query(
    "insert into public.product_variants(stock_item_id,product_id,color,size)values($1,$3,'Black','M'),($2,$4,'Black','M')",
    [shirt, other, id(300), id(301)],
  );
  for (const [item, loc, qty] of [
    [shirt, central, 100],
    [shirt, shop, 0],
    [other, central, 10],
    [other, shop, 0],
  ])
    await db.query(
      "insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,'opening',$4,'Synthetic count')",
      [randomUUID(), item, loc, qty],
    );
  await db.query(
    "insert into public.shopify_catalog_variants(shop_domain,variant_gid,product_gid,sku,product_title,product_type,status,price_cents,source_updated_at,observed_at,stock_item_id)values($1,$2,'gid://shopify/Product/1','SYNTHETIC-TEE','Synthetic shirt','T-shirt','ACTIVE',4001,$3,$3,$4)",
    [domain, variant, observed, shirt],
  );
  await rejects(
    () => run("transfer_consignment_stock", transfer()),
    "stock_mutations_disabled",
    "42501",
  );
  await db.exec("update public.app_settings set stock_adjustments_enabled=true");
  for (const who of ["outsider", "inactive"])
    await rejects(
      () => run("transfer_consignment_stock", transfer(), randomUUID(), who),
      "membership_required",
      "42501",
    );
  const first = transfer(),
    op = randomUUID(),
    before = await total("public.stock_movements");
  const moved = await run("transfer_consignment_stock", first, op);
  eq(moved.replayed, false);
  eq(await balance(central), 98);
  eq(await balance(shop), 2);
  eq(await total("public.stock_movements"), before + 2);
  eq(await total("public.finance_entries"), 0, "Transfers create no expense");
  eq(await run("transfer_consignment_stock", first, op), { ...moved, replayed: true });
  eq(await total("public.stock_movements"), before + 2);
  await rejects(
    () => run("transfer_consignment_stock", { ...first, quantity: 1 }, op),
    "idempotency_conflict",
    "22023",
  );
  await rejects(
    () => run("transfer_consignment_stock", first, op, "founder"),
    "idempotency_conflict",
    "22023",
  );
  await run(
    "transfer_consignment_stock",
    transfer({ from_location_id: shop, to_location_id: central, quantity: 1 }),
  );
  eq(await balance(central), 99);
  eq(await balance(shop), 1, "Unsold return restores central");
  for (const payload of [
    transfer({ to_location_id: external }),
    transfer({ from_location_id: shop, to_location_id: shop }),
    transfer({ from_location_id: central, to_location_id: central }),
  ])
    await rejects(() => run("transfer_consignment_stock", payload), "invalid_location", "22023");
  await rejects(
    () => run("transfer_consignment_stock", transfer({ to_location_id: unknown })),
    "unknown_stock",
    "22023",
  );
  await rejects(
    () => run("transfer_consignment_stock", transfer({ stock_item_id: other })),
    "invalid_tshirt",
    "22023",
  );
  await rejects(
    () => run("transfer_consignment_stock", transfer({ quantity: 100000 })),
    "insufficient_stock",
    "22023",
  );
  await rejects(() => run("register_consignment_sale", sale()), "sales_disabled", "42501");
  await db.exec(
    "update public.app_settings set manual_sales_enabled=true,sales_started_at='2026-10-21T10:30:00Z'",
  );
  await rejects(
    () => run("register_consignment_sale", sale({ expected_web_price_cents: 4000 })),
    "catalog_changed",
    "22023",
  );
  await rejects(
    () =>
      run(
        "register_consignment_sale",
        sale({ expected_catalog_observed_at: "2026-10-20T10:00:00Z" }),
      ),
    "catalog_changed",
    "22023",
  );
  await rejects(
    () =>
      run("register_consignment_sale", sale({ variant_gid: "gid://shopify/ProductVariant/999" })),
    "unmatched_catalog",
    "22023",
  );
  await rejects(
    () => run("register_consignment_sale", sale({ location_id: central })),
    "invalid_location",
    "22023",
  );
  await rejects(
    () => run("register_consignment_sale", sale({ occurred_at: "2026-10-21T10:00:00Z" })),
    "before_cutover",
    "22023",
  );
  const soldPayload = sale(),
    soldOp = randomUUID(),
    sold = await run("register_consignment_sale", soldPayload, soldOp);
  eq(await balance(shop), 0);
  const fact = (
    await db.query(
      "select web_price_cents::int,unit_shop_price_cents::int,gross_cents::int,brand_claim_cents::int,shop_share_cents::int,unit_cost_cents from public.consignment_sales where id=$1",
      [sold.sale_id],
    )
  ).rows[0];
  eq(
    fact,
    {
      web_price_cents: 4001,
      unit_shop_price_cents: 5001,
      gross_cents: 5001,
      brand_claim_cents: 3001,
      shop_share_cents: 2000,
      unit_cost_cents: null,
    },
    "Web +1000 exact, full-line split rounded, unknown cost remains NULL",
  );
  eq(await total("public.sales_orders"), 0);
  eq(await total("public.order_payments"), 0);
  eq(await total("public.consignment_settlements"), 0, "Shop sale is a claim, not money received");
  eq(await run("register_consignment_sale", soldPayload, soldOp), { ...sold, replayed: true });
  await run("transfer_consignment_stock", transfer({ quantity: 20 }));
  await rejects(
    () => run("register_consignment_sale", soldPayload),
    "duplicate_reference",
    "23505",
  );
  for (const who of roles.slice(0, 5)) {
    await run("transfer_consignment_stock", transfer({ quantity: 1 }), randomUUID(), who);
    const row = await run("register_consignment_sale", sale(), randomUUID(), who);
    ok(row.sale_id, `${who} can declare shop sale`);
  }
  // A real reservation blocks both a shop sale and a transfer of reserved units.
  await db.query(
    "insert into public.sales_orders(id,operation_id,payload_sha256,channel,occurred_at,operational_date,total_cents,payment_state,fulfillment_mode,fulfillment_state,created_by)values($1,$2,$3,'direct',$4,'2026-10-21',100,'unpaid','prepare','unfulfilled',$5)",
    [id(400), randomUUID(), "0".repeat(64), at, ids.founder],
  );
  await db.query(
    "insert into public.sales_order_lines(id,order_id,stock_item_id,location_id,sku_snapshot,quantity,unit_price_cents,discount_cents)values($1,$2,$3,$4,'SYNTHETIC-TEE',100000,1,0)",
    [id(401), id(400), shirt, shop],
  );
  const remaining = await balance(shop);
  await db.query(
    "insert into public.stock_reservations(order_line_id,stock_item_id,location_id,reserved_quantity)values($1,$2,$3,$4)",
    [id(401), shirt, shop, remaining],
  );
  await rejects(() => run("register_consignment_sale", sale()), "insufficient_stock", "22023");
  await rejects(
    () =>
      run(
        "transfer_consignment_stock",
        transfer({ from_location_id: shop, to_location_id: central, quantity: 1 }),
      ),
    "insufficient_stock",
    "22023",
  );
  await db.query(
    "update public.stock_reservations set reserved_quantity=0 where order_line_id=$1",
    [id(401)],
  );
  for (const who of ["consultant", "logistics", "finance"])
    await rejects(
      () => run("record_consignment_settlement", settle(sold.sale_id), randomUUID(), who),
      "finance_access_required",
      "42501",
    );
  const payment = settle(sold.sale_id),
    payop = randomUUID(),
    paid = await run("record_consignment_settlement", payment, payop, "finance", "aal2");
  eq(paid.sale_id, sold.sale_id);
  eq(await run("record_consignment_settlement", payment, payop, "finance", "aal2"), {
    ...paid,
    replayed: true,
  });
  await rejects(
    () =>
      run(
        "record_consignment_settlement",
        settle(sold.sale_id, { amount_cents: 2002 }),
        randomUUID(),
        "founder",
        "aal2",
      ),
    "settlement_exceeds_claim",
    "22023",
  );
  await run(
    "record_consignment_settlement",
    settle(sold.sale_id, { amount_cents: 2001 }),
    randomUUID(),
    "production",
    "aal2",
  );
  eq(
    (
      await db.query(
        "select sum(amount_cents)::int n from public.consignment_settlements where sale_id=$1",
        [sold.sale_id],
      )
    ).rows[0].n,
    3001,
  );
  await rejects(
    () =>
      run(
        "record_consignment_settlement",
        settle(sold.sale_id, { amount_cents: 1 }),
        randomUUID(),
        "founder",
        "aal2",
      ),
    "settlement_exceeds_claim",
    "22023",
  );
  eq(
    (await user("consultant", () => db.query("select * from public.consignment_settlements"))).rows
      .length,
    0,
  );
  ok(
    (await user("finance", () => db.query("select * from public.consignment_settlements"), "aal2"))
      .rows.length > 0,
  );
  ok(
    (await user("consultant", () => db.query("select * from public.consignment_sales"))).rows
      .length > 0,
  );
  await rejects(
    () => user("consultant", () => db.exec("delete from public.consignment_sales")),
    null,
    "42501",
  );
  await rejects(
    () => user("consultant", () => db.exec("select * from private.consignment_receipts")),
    null,
    "42501",
  );
  for (const payload of [
    transfer({ discount_cents: 0 }),
    transfer({ quantity: 1.5 }),
    transfer({ reason: "x" }),
    transfer({ quantity: 0 }),
    transfer({ occurred_at: "2099-01-01" }),
  ])
    await rejects(
      () => run("transfer_consignment_stock", payload),
      payload.occurred_at === "2099-01-01" ? "invalid_date" : "invalid_payload",
      "22023",
    );
  // Fail the second ledger write: neither side, receipt nor projection commits.
  const beforeRollback = [
    await balance(central),
    await balance(shop),
    await total("public.stock_movements"),
    await total("public.consignment_transfers"),
    await total("private.consignment_receipts"),
  ];
  await db.exec(
    `create function public.qa_reject_consignment_in()returns trigger language plpgsql as $$begin if new.kind='transfer_in' then raise exception 'synthetic second movement failure';end if;return new;end$$;create trigger qa_consignment_failure before insert on public.stock_movements for each row execute function public.qa_reject_consignment_in();`,
  );
  await rejects(
    () => run("transfer_consignment_stock", transfer({ quantity: 1 })),
    "synthetic second movement failure",
    "P0001",
  );
  eq(
    [
      await balance(central),
      await balance(shop),
      await total("public.stock_movements"),
      await total("public.consignment_transfers"),
      await total("private.consignment_receipts"),
    ],
    beforeRollback,
    "Second ledger failure rolls back both balances, ledger and receipt",
  );
  await db.exec(
    "drop trigger qa_consignment_failure on public.stock_movements;drop function public.qa_reject_consignment_in()",
  );
  await rejects(() => db.exec("update public.consignment_sales set reason=reason"), null, "42501");
  await rejects(() => db.exec("delete from public.consignment_transfers"), null, "42501");
  await db.query(
    "update public.shopify_catalog_variants set price_cents=90000000000000 where stock_item_id=$1",
    [shirt],
  );
  await rejects(
    () =>
      run(
        "register_consignment_sale",
        sale({ expected_web_price_cents: 90000000000000, quantity: 100000 }),
      ),
    "invalid_payload",
    "22023",
  );
  await db.query(
    "update public.shopify_catalog_variants set price_cents=4001,status='DRAFT' where stock_item_id=$1",
    [shirt],
  );
  await rejects(() => run("register_consignment_sale", sale()), "unmatched_catalog", "22023");
  await db.query(
    "update public.shopify_catalog_variants set status='ACTIVE' where stock_item_id=$1",
    [shirt],
  );
  await db.query(
    "update public.shopify_catalog_variants set product_type='Sticker' where stock_item_id=$1",
    [shirt],
  );
  await rejects(() => run("register_consignment_sale", sale()), "unmatched_catalog", "22023");
  await db.query(
    "update public.shopify_catalog_variants set product_type='T-shirt' where stock_item_id=$1",
    [shirt],
  );
  await db.exec(
    "update public.app_settings set stock_adjustments_enabled=false,manual_sales_enabled=false",
  );
  eq((await run("transfer_consignment_stock", first, op)).replayed, true);
  eq((await run("register_consignment_sale", soldPayload, soldOp)).replayed, true);
  await rejects(
    () => run("register_consignment_sale", sale()),
    "stock_mutations_disabled",
    "42501",
  );
  await db.query("update public.memberships set active=false where user_id=$1", [ids.consultant]);
  await rejects(
    () => run("register_consignment_sale", soldPayload, soldOp),
    "membership_required",
    "42501",
  );
  console.log(`PASS ${checks} consignment checks; mocked Auth/PGlite, no cloud.`);
} finally {
  await db.close();
}
