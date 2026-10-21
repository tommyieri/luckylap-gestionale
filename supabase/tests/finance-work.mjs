// Isolated synthetic-only PostgreSQL harness; no cloud, email or real Finance source.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Passare il percorso esterno PGlite dist/index.js.');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite(); let checks = 0;
const equal = (a,b,m) => { assert.deepEqual(a,b,m); checks++; };
const check = (v,m) => { assert.ok(v,m); checks++; };
const uuid = n => `70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const roles = ['founder','production','finance','logistics','consultant','inactive','production_without_flag','outsider'];
const users = Object.fromEntries(roles.map((role,i) => [role,uuid(i+1)]));
const directory = new URL('../migrations/',import.meta.url);
function migration(suffix) {
  const found = readdirSync(directory).filter(name => name.endsWith(`_${suffix}.sql`));
  assert.equal(found.length,1,`Exactly one isolated ${suffix} migration`);
  return readFileSync(new URL(found[0],directory),'utf8');
}
async function asUser(name,action,aal='aal2',role='authenticated') {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:users[name],aal,user_metadata:{role:'founder'}})]);
    await db.exec(`set local role ${role}`);
    const result = await action(); await db.exec('commit'); return result;
  } catch(error) { await db.exec('rollback'); throw error; }
}
async function reject(action,message,code) {
  let caught; try { await action(); } catch(error) { caught=error; }
  check(caught,`reject ${message}`); if(message) equal(caught.message,message); if(code) equal(caught.code,code);
}
const rpc = (kind,payload,operation=randomUUID(),user='finance',aal='aal2') => asUser(user,async() => (await db.query(`select public.${kind}($1,$2::jsonb) result`,[operation,JSON.stringify(payload)])).rows[0].result,aal);
const count = async table => (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
try {
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to anon,authenticated;`);
  for(const suffix of ['initial_schema','finance_imports','sales_ecosystem','sales_lifecycle']) await db.exec(migration(suffix));
  for(const name of roles) {
    await db.query('insert into auth.users(id) values($1)',[users[name]]); if(name==='outsider') continue;
    await db.query('insert into public.profiles(user_id,display_name) values($1,$2)',[users[name],name]);
    await db.query('insert into public.memberships(user_id,role,active,finance_access) values($1,$2,$3,$4)',[users[name],name==='inactive'?'finance':name==='production_without_flag'?'production':name,name!=='inactive',['production','finance','inactive'].includes(name)]);
  }
  const day = (await db.query("select (now() at time zone 'Europe/Rome')::date::text as report_day")).rows[0].report_day;
  await db.query("insert into public.finance_entries(id,entry_date,entry_type,amount_eur,description,created_by) values($1,$2,'expense',1.30,'Synthetic legacy preserved',$3)",[uuid(100),day,users.finance]);
  await db.exec(migration('finance_work'));
  equal((await db.query('select source_kind,amount_cents::text n,description from public.finance_entries')).rows[0],{source_kind:'legacy_unclassified',n:'130',description:'Synthetic legacy preserved'},'Legacy values preserved without invented provenance');
  const payload = {schema_version:1,entry_date:day,entry_type:'expense',amount_cents:1234,description:'Synthetic expense declaration',account_label:'User-declared test account',category:'User-declared test category',not_duplicate_confirmed:true};
  const operation = randomUUID(), registered = await rpc('record_finance_entry',payload,operation);
  equal(registered.replayed,false); equal(registered.operation_id,operation);
  const row = (await db.query('select amount_eur::text amount,amount_cents::text cents,source_kind,review_status,created_by from public.finance_entries where id=$1',[registered.entry_id])).rows[0];
  equal(row,{amount:'12.34',cents:'1234',source_kind:'manual_declaration',review_status:'unclassified',created_by:users.finance},'Exact positive cents and explicitly unclassified source');
  const beforeReplay = await count('public.audit_logs');
  equal(await rpc('record_finance_entry',{...payload,description:'  '+payload.description+'  '},operation),{...registered,replayed:true},'Canonical trimmed replay');
  equal(await count('public.audit_logs'),beforeReplay,'Replay adds no data/audit');
  await reject(() => rpc('record_finance_entry',{...payload,amount_cents:1235},operation),'idempotency_conflict','22023');
  await reject(() => rpc('record_finance_entry',payload,operation,'founder'),'idempotency_conflict','22023');
  for(const name of ['logistics','consultant','inactive','production_without_flag','outsider']) await reject(() => rpc('record_finance_entry',payload,randomUUID(),name),'finance_access_required','42501');
  for(const name of ['founder','production','finance']) await reject(() => rpc('record_finance_entry',payload,randomUUID(),name,'aal1'),'finance_access_required','42501');
  const future = (await db.query("select ((now() at time zone 'Europe/Rome')::date+1)::text as report_day")).rows[0].report_day;
  const beforeInvalid = [await count('public.finance_entries'),await count('private.finance_work_receipts'),await count('public.audit_logs')];
  for(const bad of [null,[],{}, {...payload,total:1}, {...payload,amount_cents:0}, {...payload,amount_cents:-1}, {...payload,amount_cents:1.5}, {...payload,amount_cents:'1234'}, {...payload,amount_cents:100000000000000}, {...payload,entry_date:'2026-02-30'}, {...payload,entry_type:'transfer'}, {...payload,description:'ab'}, {...payload,description:'x'.repeat(2001)}, {...payload,account_label:123}, {...payload,category:'x'.repeat(121)}, {...payload,not_duplicate_confirmed:false}, {...payload,created_by:users.founder}]) await reject(() => rpc('record_finance_entry',bad),'invalid_finance_payload','22023');
  await reject(() => rpc('record_finance_entry',{...payload,entry_date:future}),'future_finance_entry','22023');
  equal([await count('public.finance_entries'),await count('private.finance_work_receipts'),await count('public.audit_logs')],beforeInvalid,'Invalid requests are atomic');
  const voidOperation=randomUUID(), voidPayload={schema_version:1,entry_id:registered.entry_id,reason:'Synthetic correction by void'};
  const voided=await rpc('void_finance_entry',voidPayload,voidOperation,'production');
  equal(voided.entry_id,registered.entry_id); equal(await count('public.finance_entry_voids'),1);
  equal((await db.query('select amount_eur::text amount,description from public.finance_entries where id=$1',[registered.entry_id])).rows[0],{amount:'12.34',description:payload.description},'Void preserves original financial source');
  equal(await rpc('void_finance_entry',voidPayload,voidOperation,'production'),{...voided,replayed:true});
  await reject(() => rpc('void_finance_entry',voidPayload),'finance_entry_already_voided','22023');
  await reject(() => rpc('void_finance_entry',voidPayload,operation),'idempotency_conflict','22023');
  await reject(() => rpc('void_finance_entry',{...voidPayload,reason:'Changed cause'},voidOperation,'production'),'idempotency_conflict','22023');
  const beforeVoidFailure=[await count('public.finance_entry_voids'),await count('private.finance_work_receipts'),await count('public.audit_logs')];
  await reject(() => rpc('void_finance_entry',{...voidPayload,entry_id:uuid(999)}),'finance_entry_not_found','22023');
  await reject(() => rpc('void_finance_entry',{...voidPayload,reason:'ab'}),'invalid_finance_payload','22023');
  equal([await count('public.finance_entry_voids'),await count('private.finance_work_receipts'),await count('public.audit_logs')],beforeVoidFailure,'Void failure leaves no receipt or audit');
  for(const table of ['finance_entries','finance_entry_voids']) {
    await reject(() => asUser('finance',() => db.exec(`delete from public.${table}`)),null,'42501');
    await reject(() => db.exec(`delete from public.${table}`),'Registro append-only: aggiungere un movimento di rettifica.','42501');
    for(const name of roles) for(const aal of ['aal1','aal2']) {
      const allowed=aal==='aal2'&&['founder','production','finance'].includes(name);
      equal(await asUser(name,async()=> (await db.query(`select count(*)::int n from public.${table}`)).rows[0].n>0,aal),allowed,`${table}/${name}/${aal}`);
    }
  }
  await reject(() => asUser('finance',()=>db.query("insert into public.finance_entries(entry_date,entry_type,amount_eur,description) values($1,'income',1,'Synthetic forbidden direct insert')",[day])),null,'42501');
  await reject(() => asUser('finance',()=>db.exec("update public.finance_entries set description='Synthetic forbidden update'")),null,'42501');
  await reject(() => asUser('finance',()=>db.exec('select * from private.finance_work_receipts')),null,'42501');
  await reject(() => asUser('finance',()=>db.query('select private.finish_finance_work($1,$2,$3,$4)',[randomUUID(),'record_finance_entry','{}','{}'])),null,'42501');
  await reject(() => asUser('outsider',()=>db.query('select public.record_finance_entry($1,$2)',[randomUUID(),JSON.stringify(payload)]),'aal2','anon'),null,'42501');
  await db.exec(`update public.memberships set active=false where user_id='${users.finance}'`);
  await reject(() => rpc('record_finance_entry',payload),'finance_access_required','42501');
  equal(await count('public.finance_import_transactions'),0,'No BudgetFlow source changes');
  equal(await count('public.sales_orders'),0,'Manual Finance creates no sale');
  equal(await count('public.order_payments'),0,'Manual Finance creates no payment declaration');
  equal(await count('public.commercial_facts'),0,'No fake sales/payment facts');
  equal(await count('public.stock_movements'),0,'No invented stock or COGS changes');
  // Integration fixture: Sales produces protected observed facts; it never
  // manufactures a second manual Finance entry or imports historical cash.
  await db.query("insert into public.products(id,model,category) values($1,'SYNTHETIC-FINANCE-LINK','T-shirt')",[uuid(200)]);
  await db.query("insert into public.stock_items(id,kind,sku,name,unit_cost_eur,list_price_eur) values($1,'product','SYNTHETIC-FINANCE-LINK-M','Synthetic only',13.20,40.01)",[uuid(201)]);
  await db.query("insert into public.product_variants(stock_item_id,product_id,color,size) values($1,$2,'Synthetic','M')",[uuid(201),uuid(200)]);
  await db.query("insert into public.stock_locations(id,code,name,location_type) values($1,'FIN-TEST','Synthetic only','central')",[uuid(202)]);
  await db.query("insert into public.stock_movements(operation_id,stock_item_id,location_id,kind,quantity_delta,reason) values($1,$2,$3,'opening',5,'Synthetic initial count')",[randomUUID(),uuid(201),uuid(202)]);
  await db.exec("update public.app_settings set manual_sales_enabled=true,sales_started_at=now()-interval '1 day'");
  const occurred=(await db.query("select (now()-interval '10 seconds')::text as occurred")).rows[0].occurred;
  const iso=new Date(occurred).toISOString(),manualBeforeSale=await count('public.finance_entries');
  const sale=await rpc('register_manual_sale',{schema_version:1,channel:'direct',occurred_at:iso,location_id:uuid(202),lines:[{stock_item_id:uuid(201),quantity:2,unit_price_cents:4001,discount_cents:0}],fulfillment_mode:'prepare',payment:{status:'paid',method:'cash',amount_cents:8002,occurred_at:iso}},randomUUID(),'founder','aal1');
  await rpc('cancel_unfulfilled_lines',{order_id:sale.order_id,occurred_at:iso,reason:'Synthetic cancellation only',lines:[{order_line_id:sale.lines[0].order_line_id,quantity:1}]},randomUUID(),'founder','aal1');
  equal(await count('public.commercial_facts'),3,'Sale/payment/cancellation kept as three distinct facts');
  equal(await count('public.order_payments'),1,'One observed payment, never a second sale');
  equal(await count('public.finance_entries'),manualBeforeSale,'Sales does not duplicate manual Finance entries');
  equal(await count('public.finance_import_transactions'),0,'Sales does not manufacture BudgetFlow rows');
  equal(await asUser('production',async()=> (await db.query('select count(*)::int n from public.commercial_facts')).rows[0].n),3,'Protected facts visible to allowed Finance member at aal2');
  equal(await asUser('logistics',async()=> (await db.query('select count(*)::int n from public.commercial_facts')).rows[0].n),0,'Operational member cannot read Finance facts');
  console.log(`PASS ${checks} Finance work checks; synthetic embedded PostgreSQL and mocked Auth. Live JWT/PostgREST and concurrent connections remain unverified.`);
} catch(error) { console.error('FAIL Finance work:',error.message,error.code??'',error.where??''); process.exitCode=1; }
finally { await db.close(); }
