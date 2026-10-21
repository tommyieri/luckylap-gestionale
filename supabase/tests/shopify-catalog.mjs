// Synthetic PostgreSQL/Auth fixtures only. No Shopify calls or cloud writes.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Passare il percorso esterno di @electric-sql/pglite/dist/index.js.');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite(); let checks = 0;
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
const rejects = async (promise, code) => { await assert.rejects(promise, error => error.code === code); checks += 1; };
const id = number => `40000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const roles = ['founder', 'production', 'finance', 'logistics', 'consultant', 'outsider', 'inactive'];
const users = Object.fromEntries(roles.map((role, index) => [role, id(index + 1)]));
const migration = suffix => {
  const directory = new URL('../migrations/', import.meta.url);
  const names = readdirSync(directory).filter(name => name.endsWith(`_${suffix}.sql`));
  assert.equal(names.length, 1);
  return readFileSync(new URL(names[0], directory), 'utf8');
};
const row = (variant = 1, overrides = {}) => ({
  shop_domain: 'synthetic.myshopify.com', variant_gid: `gid://shopify/ProductVariant/${variant}`,
  product_gid: 'gid://shopify/Product/1', sku: `LL-SYN-${variant}`, product_title: 'Synthetic product',
  product_type: 'T-shirt', status: 'ACTIVE', price_cents: 4500, currency_code: 'EUR',
  source_updated_at: '2026-10-20T12:00:00Z', observed_at: '2026-10-21T12:00:00Z', stock_item_id: null,
  ...overrides,
});
const insert = async value => {
  const keys = Object.keys(value);
  return db.query(`insert into public.shopify_catalog_variants(${keys.join(',')}) values(${keys.map((_, index) => `$${index + 1}`).join(',')})`, Object.values(value));
};
async function asUser(role, callback, aal = 'aal1') {
  await db.exec('begin; set local role authenticated;');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: role ? users[role] : undefined, aal, user_metadata: { role: 'founder', active: true } })]);
    const result = await callback(); await db.exec('commit'); return result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
try {
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
  await db.exec(migration('initial_schema'));
  await db.exec(migration('shopify_catalog'));
  for (const role of roles) {
    await db.query('insert into auth.users values($1)', [users[role]]);
    if (role === 'outsider') continue;
    await db.query('insert into public.profiles(user_id,display_name) values($1,$2)', [users[role], role]);
    await db.query('insert into public.memberships(user_id,role,active) values($1,$2,$3)', [users[role], role === 'inactive' ? 'consultant' : role, role !== 'inactive']);
  }
  await db.query("insert into public.stock_items(id,kind,sku,name) values($1,'product','LL-SYN-1','Synthetic physical product'),($2,'packaging','LL-PKG-1','Synthetic box')", [id(101), id(102)]);
  await insert(row(1, { stock_item_id: id(101) }));
  await insert(row(2, { sku: 'LL-STICKER-UNKNOWN', product_type: 'Sticker', price_cents: 500 }));
  equal((await db.query("select count(*)::int n from public.audit_logs where table_name='shopify_catalog_variants' and operation='INSERT' and actor_id is null")).rows[0].n, 2, 'Owner imports are audited as system operations');
  equal((await db.query("select record_key from public.audit_logs where table_name='shopify_catalog_variants' and new_data->>'variant_gid'='gid://shopify/ProductVariant/2'")).rows[0].record_key, { shop_domain: 'synthetic.myshopify.com', variant_gid: 'gid://shopify/ProductVariant/2' }, 'Unmapped audit record retains the full composite identity');
  equal((await db.query('select stock_item_id from public.shopify_catalog_variants where variant_gid=$1', ['gid://shopify/ProductVariant/2'])).rows[0].stock_item_id, null, 'Unknown commercial SKU stays unmapped');
  for (const role of roles) {
    for (const aal of ['aal1', 'aal2']) {
      equal((await asUser(role, () => db.query('select variant_gid from public.shopify_catalog_variants'), aal)).rows.length, role === 'outsider' || role === 'inactive' ? 0 : 2, 'Only current active members read; aal1 is sufficient for catalog');
    }
    await rejects(asUser(role, () => insert(row(10))), '42501');
    await rejects(asUser(role, () => db.exec("update public.shopify_catalog_variants set price_cents=1")), '42501');
    await rejects(asUser(role, () => db.exec('delete from public.shopify_catalog_variants')), '42501');
    await rejects(asUser(role, () => db.exec('truncate public.shopify_catalog_variants')), '42501');
  }
  equal((await asUser(null, () => db.query('select variant_gid from public.shopify_catalog_variants'))).rows, [], 'Missing identity cannot read despite authenticated SQL role');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      equal((await db.query('select has_table_privilege($1,$2,$3) allowed', [role, 'public.shopify_catalog_variants', privilege])).rows[0].allowed, false, 'No inherited default table write grants');
    }
  }
  equal((await db.query("select has_table_privilege('anon','public.shopify_catalog_variants','SELECT') allowed")).rows[0].allowed, false, 'No anonymous catalog grant');
  equal((await db.query("select has_column_privilege('authenticated','public.shopify_catalog_variants','price_cents','UPDATE') allowed")).rows[0].allowed, false, 'No column write grants');
  await db.exec('begin;set local role anon;');
  await rejects(db.exec('select * from public.shopify_catalog_variants'), '42501');
  await db.exec('rollback;');
  await rejects(insert(row(3, { stock_item_id: id(999) })), '23503');
  await rejects(insert(row(3, { sku: 'LL-PKG-1', stock_item_id: id(102) })), '22023');
  await rejects(insert(row(3, { sku: 'll-syn-1', stock_item_id: id(101) })), '22023');
  await rejects(insert(row(1)), '23505');
  await rejects(insert(row(3, { sku: 'LL-SYN-1' })), '23505');
  await insert(row(3, { sku: 'LL-SYN-1', status: 'ARCHIVED' }));
  await rejects(insert(row(4, { sku: 'LL-SYN-1', stock_item_id: id(101), status: 'ARCHIVED' })), '23505');
  await insert(row(1, { shop_domain: 'second.myshopify.com', stock_item_id: id(101) }));
  equal((await db.query('select count(*)::int n from public.shopify_catalog_variants where variant_gid=$1', ['gid://shopify/ProductVariant/1'])).rows[0].n, 2, 'Variant identity and mapping are scoped to shop');
  for (const overrides of [
    { shop_domain: 'https://synthetic.myshopify.com' }, { shop_domain: 'custom.example.test' },
    { shop_domain: 'Upper.myshopify.com' }, { shop_domain: '-bad.myshopify.com' },
    { variant_gid: 'gid://shopify/Product/90' }, { variant_gid: 'gid://shopify/ProductVariant/0' },
    { product_gid: 'gid://shopify/ProductVariant/90' }, { sku: '' }, { sku: ' padded ' }, { sku: 'line\nbreak' },
    { product_title: ' ' }, { product_type: 'x'.repeat(241) }, { status: 'UNKNOWN' },
    { price_cents: -1 }, { price_cents: '100000000000000' }, { currency_code: 'USD' },
    { source_updated_at: 'infinity' }, { observed_at: '-infinity' },
  ]) await rejects(insert(row(90, overrides)), '23514');
  await insert(row(5, { price_cents: 0 }));
  await insert(row(6, { price_cents: '99999999999999' }));
  equal((await db.query('select price_cents::text n from public.shopify_catalog_variants where variant_gid=$1', ['gid://shopify/ProductVariant/6'])).rows[0].n, '99999999999999', 'Integer cent maximum stays exact');
  await db.exec("update public.shopify_catalog_variants set price_cents=4600, observed_at='2026-10-21T13:00:00Z' where shop_domain='synthetic.myshopify.com' and variant_gid='gid://shopify/ProductVariant/1'");
  equal((await db.query("select price_cents::int n from public.shopify_catalog_variants where shop_domain='synthetic.myshopify.com' and variant_gid='gid://shopify/ProductVariant/1'")).rows[0].n, 4600, 'Owner may refresh catalog observation');
  equal((await db.query("select actor_id,record_key,old_data->>'price_cents' before,new_data->>'price_cents' after from public.audit_logs where table_name='shopify_catalog_variants' and operation='UPDATE'")).rows[0], { actor_id: null, record_key: { shop_domain: 'synthetic.myshopify.com', variant_gid: 'gid://shopify/ProductVariant/1', stock_item_id: id(101) }, before: '4500', after: '4600' }, 'Catalog refresh audit preserves before/after and the source identity');
  await db.exec("delete from public.shopify_catalog_variants where shop_domain='synthetic.myshopify.com' and variant_gid='gid://shopify/ProductVariant/3'");
  equal((await db.query("select actor_id,record_key,old_data->>'variant_gid' previous,new_data from public.audit_logs where table_name='shopify_catalog_variants' and operation='DELETE'")).rows[0], { actor_id: null, record_key: { shop_domain: 'synthetic.myshopify.com', variant_gid: 'gid://shopify/ProductVariant/3' }, previous: 'gid://shopify/ProductVariant/3', new_data: null }, 'Owner removal retains an audit record');
  equal((await db.query("select has_function_privilege('authenticated','private.audit_shopify_catalog_change()','EXECUTE') allowed")).rows[0].allowed, false, 'Clients cannot execute the audit helper');
  await db.query('update public.memberships set active=false where user_id=$1', [users.consultant]);
  equal((await asUser('consultant', () => db.query('select variant_gid from public.shopify_catalog_variants'))).rows, [], 'Membership revocation takes effect without refreshing claims');
  equal((await db.query("select relrowsecurity from pg_class where oid='public.shopify_catalog_variants'::regclass")).rows[0].relrowsecurity, true, 'RLS enabled');
  equal((await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='shopify_catalog_variants' and column_name ~ '(quantity|available|inventory|stock_quantity)'")).rows, [], 'No Shopify quantity columns');
  equal((await db.query('select count(*)::int n from public.stock_balances')).rows[0].n, 0, 'Catalog never creates physical stock balances');
  equal((await db.query('select count(*)::int n from public.stock_movements')).rows[0].n, 0, 'Catalog never writes physical movements');
  equal((await db.query('select count(*)::int n from public.stock_items')).rows[0].n, 2, 'Unknown Shopify SKU never creates inventory items');
  console.log(`PASS ${checks} Shopify catalog checks; synthetic embedded PostgreSQL and mocked Auth. Live JWT/PostgREST remain unverified.`);
} finally { await db.close(); }
