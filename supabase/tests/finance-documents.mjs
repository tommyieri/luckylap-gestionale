// Synthetic PostgreSQL policy checks, mocked Auth and Storage schema.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw Error('Pass external PGlite dependency');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const migration=suffix=>{const dir=new URL('../migrations/',import.meta.url); const file=readdirSync(dir).find(name=>name.endsWith(suffix));if(!file)throw Error(suffix);return readFileSync(new URL(file,dir),'utf8');};
try {
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    create schema storage;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select on storage.objects to anon,authenticated;`);
  await db.exec(migration('_initial_schema.sql'));
  await db.exec(migration('_private_finance_documents.sql'));
  const path='sources/'+ 'a'.repeat(64) + '/synthetic.pdf';
  await db.query(`insert into public.finance_documents(source_kind,file_name,storage_path,sha256,byte_size,content_type) values('recap','synthetic.pdf',$1,$2,123,'application/pdf')`,[path,'a'.repeat(64)]);
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2),($1,$3),($4,$2)',['finance-documents',path,'sources/'+'b'.repeat(64)+'/unregistered.pdf','another-bucket']);
  const roles=['founder','production','finance','logistics','consultant'];
  for(let i=0;i<roles.length;i++) {
    const id=`10000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`;
    await db.query('insert into auth.users values($1)',[id]);
    await db.query('insert into public.profiles(user_id,display_name) values($1,$2)',[id,roles[i]]);
    await db.query('insert into public.memberships(user_id,role,finance_access) values($1,$2,$3)',[id,roles[i],i<3]);
    for(const aal of ['aal1','aal2']) {
      await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,aal})]);
      await db.exec('set role authenticated');
      eq((await db.query('select count(*)::int n from public.finance_documents')).rows[0].n,aal==='aal2'&&i<3?1:0);
      eq((await db.query('select count(*)::int n from storage.objects')).rows[0].n,aal==='aal2'&&i<3?1:0);
      await db.exec('reset role');
    }
  }
  await db.exec('set role anon');
  await assert.rejects(()=>db.query('select * from public.finance_documents'),/permission denied/);checks++;
  eq((await db.query('select count(*)::int n from storage.objects')).rows[0].n,0);
  await db.exec('reset role;set role authenticated');
  await assert.rejects(()=>db.query("delete from public.finance_documents"),/permission denied/);checks++;
  await db.exec('reset role');
  await assert.rejects(()=>db.query("update public.finance_documents set review_status='unreviewed'"),/append-only|immutable|modific/i);checks++;
  eq((await db.query("select count(*)::int n from public.audit_logs where table_name='finance_documents'")).rows[0].n,1);
  console.log(`PASS ${checks} Finance document policy checks (mock Auth/Storage, no real JWT).`);
} finally { await db.close(); }
