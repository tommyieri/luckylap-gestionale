// Synthetic embedded PostgreSQL + mocked Auth only. Never connects to Supabase.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Pass the external PGlite module path.');
const { PGlite }=await import(pathToFileURL(process.argv[2]).href);const db=new PGlite();let checks=0;
const equal=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};const check=(a,m)=>{assert.ok(a,m);checks++;};
const uuid=n=>`80000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const roles=['founder','production','finance','logistics','consultant','outsider','inactive'];
const ids=Object.fromEntries(roles.map((role,index)=>[role,uuid(index+1)]));const location=uuid(100),otherLocation=uuid(101),product=uuid(200);
const material=(overrides={})=>({schema_version:1,sku:`SYNTHETIC-${randomUUID()}`,name:'Synthetic shirt box',packaging_type:'box',specifications:null,unit_cost_cents:null,location_id:location,initial_quantity:null,...overrides});
async function asUser(name,action,role='authenticated') {await db.exec('begin');try{await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:ids[name],aal:'aal1',user_metadata:{role:'founder'}})]);await db.exec(`set local role ${role}`);const result=await action();await db.exec('commit');return result;}catch(error){await db.exec('rollback');throw error;}}
const run=(name,payload,operation=randomUUID(),user='consultant')=>asUser(user,async()=>(await db.query(`select public.${name}($1,$2::jsonb) result`,[operation,JSON.stringify(payload)])).rows[0].result);
const create=(payload,op=randomUUID(),user='consultant')=>run('create_packaging_material',payload,op,user);
const count=(payload,op=randomUUID(),user='consultant')=>run('initialize_packaging_count',payload,op,user);
async function rejects(action,message,code){let error;try{await action();}catch(e){error=e;}check(error,`Reject ${message}`);if(message)equal(error.message,message,`Machine error ${message}`);if(code)equal(error.code,code,`SQLSTATE ${message}`);}
const total=async table=>(await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to anon,authenticated;`);
 const directory=new URL('../migrations/',import.meta.url);
 for(const name of readdirSync(directory).filter(name=>/_(initial_schema|sales_ecosystem|sales_lifecycle|packaging_materials)\.sql$/.test(name)).sort())await db.exec(readFileSync(new URL(name,directory),'utf8'));
 for(const role of roles){await db.query('insert into auth.users(id)values($1)',[ids[role]]);if(role==='outsider')continue;await db.query('insert into public.profiles(user_id,display_name)values($1,$2)',[ids[role],role]);await db.query('insert into public.memberships(user_id,role,active)values($1,$2,$3)',[ids[role],role==='inactive'?'logistics':role,role!=='inactive']);}
 await db.query("insert into public.stock_locations(id,code,name,location_type)values($1,'TEST','Synthetic only','central'),($2,'OTHER','Synthetic other','other')",[location,otherLocation]);
 await db.query("insert into public.stock_items(id,kind,sku,name)values($1,'product','SYNTHETIC-SHIRT','Synthetic product')",[product]);
 await rejects(()=>create(material()),'stock_mutations_disabled','42501');
 await db.exec('update public.app_settings set stock_adjustments_enabled=true');
 for(const user of ['outsider','inactive'])await rejects(()=>create(material(),randomUUID(),user),'membership_required','42501');
 const input=material({sku:'SYNTHETIC-BOX',specifications:'  Synthetic box specification  '});const operation=randomUUID();
 const unknown=await create(input,operation);
 equal(unknown.replayed,false,'First create');equal(unknown.movement_id,null,'No invented opening when the count is absent');
 equal((await db.query('select quantity from public.stock_balances where stock_item_id=$1 and location_id=$2',[unknown.stock_item_id,location])).rows[0].quantity,null,'Absent count stays explicitly unknown');
 equal((await db.query('select unit_cost_eur,list_price_eur from public.stock_items where id=$1',[unknown.stock_item_id])).rows[0],{unit_cost_eur:null,list_price_eur:null},'No cost or selling price invented');
 equal((await db.query('select packaging_type,specifications from public.packaging_items where stock_item_id=$1',[unknown.stock_item_id])).rows[0],{packaging_type:'box',specifications:'Synthetic box specification'},'Packaging is a separate box material');
 const beforeRetry=await total('public.audit_logs');equal(await create({...input,specifications:'Synthetic box specification'},operation),{...unknown,replayed:true},'Canonical retry keeps the same material');equal(await total('public.audit_logs'),beforeRetry,'Retry has no additional audit effects');
 await rejects(()=>create({...input,name:'Different'},operation),'idempotency_conflict','22023');
 await rejects(()=>create(input,operation,'founder'),'idempotency_conflict','22023');
 await rejects(()=>create(input),'sku_already_exists','23505');
 const zero=await create(material({sku:'SYNTHETIC-BOX-ZERO',initial_quantity:0,unit_cost_cents:0}));check(zero.movement_id,'Explicit zero receives an opening ledger record');
 equal((await db.query('select quantity::text n from public.stock_balances where stock_item_id=$1',[zero.stock_item_id])).rows[0].n,'0','Declared zero stays zero');
 equal((await db.query('select unit_cost_eur::text n from public.stock_items where id=$1',[zero.stock_item_id])).rows[0].n,'0.00','Explicit zero cost stays zero');
 const stickers=await create(material({sku:'SYNTHETIC-PACKAGING-STICKER',packaging_type:'sticker',unit_cost_cents:123,initial_quantity:12}));
 equal((await db.query('select kind::text,unit_cost_eur::text c from public.stock_items where id=$1',[stickers.stock_item_id])).rows[0],{kind:'packaging',c:'1.23'},'Packaging stickers are not product variants or retail Shopify stickers');
 equal((await db.query('select count(*)::int n from public.product_variants where stock_item_id=$1',[stickers.stock_item_id])).rows[0].n,0,'No product variant created for packaging');
 const countPayload={schema_version:1,stock_item_id:unknown.stock_item_id,location_id:location,quantity:3,reason:'Synthetic physical count'};const countOperation=randomUUID();
 const initialized=await count(countPayload,countOperation);check(initialized.movement_id,'Actual declared count creates opening');equal((await db.query('select quantity::text n from public.stock_balances where stock_item_id=$1 and location_id=$2',[unknown.stock_item_id,location])).rows[0].n,'3','Count initializes unknown balance');
 equal(await count(countPayload,countOperation),{...initialized,replayed:true},'Count retry is idempotent');
 await rejects(()=>count(countPayload),'known_stock','22023');
 await rejects(()=>count({...countPayload,quantity:4},countOperation),'idempotency_conflict','22023');
 const secondLocation=await count({...countPayload,location_id:otherLocation,quantity:0});check(secondLocation.movement_id,'A missing location balance can be initialized explicitly to zero');
 await rejects(()=>count({...countPayload,stock_item_id:product}),'unknown_packaging','22023');
 await rejects(()=>count({...countPayload,location_id:uuid(999)}),'invalid_location','22023');
 await rejects(()=>count(countPayload,operation),'idempotency_conflict','22023');
 for(const role of roles.slice(0,5)){const result=await create(material({sku:`SYNTHETIC-${role}`}),randomUUID(),role);check(result.stock_item_id,`${role} creates packaging`);await count({schema_version:1,stock_item_id:result.stock_item_id,location_id:location,quantity:0,reason:'Synthetic initial count'},randomUUID(),role);}
 const itemsBefore=await total('public.stock_items');
 for(const bad of [null,{},material({schema_version:'1'}),material({unit_cost_cents:1.5}),material({unit_cost_cents:-1}),material({unit_cost_cents:1_000_000_000_000}),material({initial_quantity:-1}),material({initial_quantity:1.5}),material({initial_quantity:'0'}),material({packaging_type:'shopify_sticker'}),material({name:''}),material({sku:' '}),material({location_id:'invalid'}),material({actor_id:ids.founder}),material({specifications:'x'.repeat(2001)})])await rejects(()=>create(bad),'invalid_payload','22023');
 equal(await total('public.stock_items'),itemsBefore,'Invalid payloads leave no partial catalog records');
 await rejects(()=>create(material({location_id:uuid(999)})),'invalid_location','22023');
 await db.exec(`create function public.qa_reject_packaging_opening() returns trigger language plpgsql as $$begin if new.reason='Conta iniziale packaging dichiarata' then raise exception 'synthetic ledger failure';end if;return new;end$$;create trigger qa_failure before insert on public.stock_movements for each row execute function public.qa_reject_packaging_opening();`);
 const balancesBefore=await total('public.stock_balances');const receiptsBefore=await total('private.packaging_command_receipts');
 await rejects(()=>create(material({sku:'SYNTHETIC-ROLLBACK',initial_quantity:1})),'synthetic ledger failure','P0001');
 equal(await total('public.stock_items'),itemsBefore,'Ledger failure rolls back the material');equal(await total('public.stock_balances'),balancesBefore,'Ledger failure rolls back the balance');equal(await total('private.packaging_command_receipts'),receiptsBefore,'Ledger failure has no false receipt');
 await db.exec('drop trigger qa_failure on public.stock_movements;drop function public.qa_reject_packaging_opening()');
 await db.exec('update public.app_settings set stock_adjustments_enabled=false');
 equal((await create(input,operation)).replayed,true,'Create receipt is recoverable after writes disabled');equal((await count(countPayload,countOperation)).replayed,true,'Count receipt is recoverable after writes disabled');
 await rejects(()=>create(material()),'stock_mutations_disabled','42501');
 await rejects(()=>count({...countPayload,location_id:uuid(999)}),'stock_mutations_disabled','42501');
 await rejects(()=>asUser('outsider',()=>db.query('select public.create_packaging_material($1,$2::jsonb)',[randomUUID(),JSON.stringify(material())]),'anon'),null,'42501');
 await rejects(()=>asUser('consultant',()=>db.exec('select * from private.packaging_command_receipts')),null,'42501');
 await db.query('update public.memberships set active=false where user_id=$1',[ids.consultant]);await rejects(()=>create(input,operation),'membership_required','42501');
 equal(await total('public.finance_entries'),0,'Packaging creation/count never manufactures an expense or approved Finance entry');
 console.log(`PASS ${checks} packaging checks; synthetic fixtures and mocked Auth only. No cloud, real stock, costs, subscriptions or files modified.`);
}finally{await db.close();}
