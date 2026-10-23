// Synthetic, reusable bootstrap for PGlite and real PostgreSQL concurrency.
import { readFileSync, readdirSync } from "node:fs";
const directory = new URL("../../migrations/", import.meta.url);
export const id = (n) => `83000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const roles = [
  "founder",
  "production",
  "finance",
  "logistics",
  "consultant",
  "inactive",
  "production_no_flag",
  "outsider",
];
export const users = Object.fromEntries(roles.map((role, index) => [role, id(index + 1)]));
export const session = (role) => id(30 + roles.indexOf(role));
export const sourceIds = {
  budgetflow: id(102),
  manual: id(103),
  payment: id(203),
  refund: id(213),
  consignment_settlement: id(223),
};
export const orderId = id(200),
  externalOrderId = id(210);
export const values = (overrides = {}) => ({
  date: "2026-03-17",
  direction: "income",
  amount_cents: 5000,
  account: "Cash",
  target_account: null,
  category: "Vendite",
  description: "Synthetic correction",
  pending: false,
  ...overrides,
});
export const payload = (kind = "payment", overrides = {}) => ({
  schema_version: 1,
  source_kind: kind,
  source_id: sourceIds[kind],
  expected_version: 0,
  action: "update",
  reason: "Synthetic correction reason",
  values: values(),
  ...overrides,
});
export function migration(suffix) {
  const names = readdirSync(directory).filter((n) => n.endsWith(`_${suffix}.sql`));
  if (names.length !== 1) throw Error(`Migration fixture missing ${suffix}`);
  return readFileSync(new URL(names[0], directory), "utf8");
}
export async function setupRevisionDatabase(db) {
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;
 create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to anon,authenticated;`);
  const suffixes = [
    "initial_schema",
    "finance_imports",
    "sales_ecosystem",
    "sales_lifecycle",
    "finance_work",
    "shopify_catalog",
    "consignment_workflow",
    "area_passwords",
    "shopify_sales_core",
    "finance_revisions",
    "finance_fixes",
  ];
  // Apply chronology, including the unchanged production Finance/session helpers.
  const names = readdirSync(directory)
    .filter((name) => suffixes.some((s) => name.endsWith(`_${s}.sql`)))
    .sort();
  for (const name of names) await db.exec(readFileSync(new URL(name, directory), "utf8"));
  for (const role of roles) {
    await db.query("insert into auth.users(id)values($1)", [users[role]]);
    await db.query("insert into auth.sessions(id,user_id)values($1,$2)", [
      session(role),
      users[role],
    ]);
    if (role === "outsider") continue;
    await db.query("insert into public.profiles(user_id,display_name)values($1,$2)", [
      users[role],
      `Synthetic ${role}`,
    ]);
    await db.query(
      "insert into public.memberships(user_id,role,active,finance_access)values($1,$2,$3,$4)",
      [
        users[role],
        role === "inactive" ? "finance" : role === "production_no_flag" ? "production" : role,
        role !== "inactive",
        ["production", "finance", "inactive"].includes(role),
      ],
    );
  }
  await db.exec(
    "insert into private.sensitive_area_credentials(area,password_hash)values('finance',extensions.crypt('synthetic-password',extensions.gen_salt('bf',10)))",
  );
  for (const role of roles.filter((r) => r !== "outsider"))
    await db.query(
      "insert into private.area_grants(session_id,user_id,area,credential_version,expires_at)select $1,$2,'finance',version,now()+interval '8 hours' from private.sensitive_area_credentials where area='finance'",
      [session(role), users[role]],
    );
  await db.exec(
    "update public.app_settings set manual_sales_enabled=true,sales_started_at=now()-interval '1 day'",
  );
  await db.query(
    "insert into public.stock_locations(id,code,name,location_type)values($1,'SYN-CENTRAL','Synthetic central','Magazzino'),($2,'SYN-SHOP','Synthetic shop','Negozio Conto Vendita')",
    [id(90), id(91)],
  );
  await db.query(
    "insert into public.stock_items(id,kind,sku,name,unit_cost_eur,list_price_eur)values($1,'product','SYN-REVISION','Synthetic product',20,100)",
    [id(92)],
  );
  await db.query(
    "insert into public.finance_import_batches(id,source_system,source_file_name,source_sha256,normalized_sha256,fingerprint_version,extracted_at,reference_date,source_row_count,source_record_ids_available)values($1,'budgetflow','synthetic.csv',$2,$3,'budgetflow-v1-sorted-raw-core','2026-03-17T01:00:00Z','2026-03-17',1,false)",
    [id(101), "a".repeat(64), "b".repeat(64)],
  );
  const raw = {
    Date: "2026-03-17T00:00:00+0100",
    Amount: "-12.34",
    "Source Currency": "EUR",
    "Target Currency": "EUR",
    "Exchange Rate": "1",
    "Budget Book": "Synthetic",
    "Source Account": "Test bank",
    "Target Account": "",
    Folder: "",
    Category: "Software",
    Payee: "Synthetic vendor",
    Tags: "",
    Notes: "Synthetic source preserved",
    Pending: "False",
  };
  await db.query(
    "insert into public.finance_import_transactions(id,batch_id,source_row,raw_record,raw_fingerprint_sha256,economic_fingerprint_sha256,source_timestamp,occurred_at,transaction_date,amount_text,amount_cents,currency,target_currency,exchange_rate_text,account_label,pending,future_as_of_reference_date)values($1,$2,2,$3::jsonb,$4,$5,$6::text,($6::text)::timestamptz,'2026-03-17','-12.34',-1234,'EUR','EUR','1','Test bank',false,false)",
    [sourceIds.budgetflow, id(101), JSON.stringify(raw), "c".repeat(64), "d".repeat(64), raw.Date],
  );
  await db.query(
    "insert into public.finance_entries(id,entry_date,entry_type,amount_eur,description,account_label,category,created_by)values($1,'2026-03-17','expense',1.23,'Synthetic manual original','Cash','Software',$2)",
    [sourceIds.manual, users.finance],
  );
  await db.query(
    "insert into public.sales_orders(id,operation_id,payload_sha256,channel,occurred_at,operational_date,total_cents,payment_state,fulfillment_mode,fulfillment_state,created_by)values($1,$2,$3,'direct',now()-interval '1 hour',(now()-interval '1 hour') at time zone 'Europe/Rome',10000,'paid','prepare','unfulfilled',$4)",
    [orderId, id(201), "e".repeat(64), users.finance],
  );
  await db.query(
    "insert into public.sales_order_lines(id,order_id,stock_item_id,location_id,sku_snapshot,quantity,unit_price_cents,discount_cents,unit_cost_cents)values($1,$2,$3,$4,'SYN-REVISION',1,10000,0,2000)",
    [id(202), orderId, id(92), id(90)],
  );
  await db.query(
    "insert into public.order_payments(id,operation_id,order_id,method,amount_cents,occurred_at,created_by)values($1,$2,$3,'cash',10000,now()-interval '30 minutes',$4)",
    [sourceIds.payment, id(204), orderId, users.finance],
  );
  await db.query(
    "insert into public.commercial_facts(operation_id,order_id,payment_id,fact_kind,amount_cents,occurred_at,created_by)values($1,$2,$3,'payment_reported',10000,now()-interval '30 minutes',$4)",
    [id(205), orderId, sourceIds.payment, users.finance],
  );
  // Seed an external observation through a temporary owner function, retaining
  // service_role's actual source guard; no table ACL bypass is left behind.
  await db.exec(`create function private.seed_revision_external() returns void language plpgsql security definer set search_path='' as $$begin
 insert into public.sales_orders(id,operation_id,payload_sha256,channel,occurred_at,operational_date,total_cents,payment_state,fulfillment_mode,fulfillment_state,created_by,source_kind)
 values('${externalOrderId}','${id(211)}','${"f".repeat(64)}','shopify_web',now()-interval '1 hour',(now()-interval '1 hour') at time zone 'Europe/Rome',20000,'partially_refunded','prepare','unfulfilled',null,'shopify_canonical');
 insert into public.order_payments(id,operation_id,order_id,source_kind,method,amount_cents,occurred_at,created_by)values('${id(212)}','${id(214)}','${externalOrderId}','shopify_observation','shopify_observed',10000,now()-interval '30 minutes',null);
 insert into public.shopify_refund_observations(id,operation_id,order_id,transaction_gid,amount_cents,occurred_at)values('${sourceIds.refund}','${id(215)}','${externalOrderId}','gid://shopify/OrderTransaction/8301',2000,now()-interval '10 minutes');end$$;
 revoke all on function private.seed_revision_external() from public,anon,authenticated;grant execute on function private.seed_revision_external() to service_role;
 begin;set local role service_role;select private.seed_revision_external();commit;drop function private.seed_revision_external();`);
  await db.query(
    "insert into public.stock_movements(id,operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,$4,'opening',10,'Synthetic opening')",
    [id(220), id(225), id(92), id(91)],
  );
  await db.query(
    "insert into public.stock_movements(id,operation_id,stock_item_id,location_id,kind,quantity_delta,reason)values($1,$2,$3,$4,'consignment_sale',-1,'Synthetic sale')",
    [id(221), id(226), id(92), id(91)],
  );
  await db.query(
    "insert into public.consignment_sales(id,stock_item_id,location_id,sku_snapshot,quantity,shop_domain,variant_gid,catalog_observed_at,web_price_cents,unit_shop_price_cents,gross_cents,brand_claim_cents,shop_share_cents,external_reference,reason,occurred_at,movement_id,created_by)values($1,$2,$3,'SYN-REVISION',1,'synthetic.myshopify.com','gid://shopify/ProductVariant/8301',now(),10000,11000,11000,6600,4400,'SYN-LEGACY','Synthetic legacy sale',now()-interval '1 hour',$4,$5)",
    [id(222), id(92), id(91), id(221), users.finance],
  );
  await db.query(
    "insert into public.consignment_settlements(id,sale_id,amount_cents,occurred_at,method,reference,created_by)values($1,$2,1000,now()-interval '30 minutes','cash','SYN-LEGACY-PAYMENT',$3)",
    [sourceIds.consignment_settlement, id(222), users.finance],
  );
  return {
    stockBefore: (await db.query("select count(*)::int n from public.stock_movements")).rows[0].n,
  };
}
export async function asRevisionUser(
  db,
  role,
  action,
  { sid = session(role), databaseRole = "authenticated", extra = {} } = {},
) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({
        sub: users[role],
        session_id: sid,
        aal: "aal1",
        user_metadata: { role: "founder" },
        ...extra,
      }),
    ]);
    await db.exec(`set local role ${databaseRole}`);
    const result = await action();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
