// Real local PostgreSQL 17 + real pgcrypto; only Auth/JWT claims are simulated.
// Takes runtime/module paths, never a DSN or an external database connection.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const [binaryDirectory, pgModule] = process.argv.slice(2);
if (!binaryDirectory?.startsWith('/') || !pgModule?.startsWith('/')) throw new Error('Passare PostgreSQL 17 bin e pg/lib/index.js come percorsi assoluti.');
const pg = await import(pathToFileURL(pgModule).href); const Client = pg.Client ?? pg.default.Client;
const run = (name, args) => { const r=spawnSync(join(binaryDirectory,name),args,{encoding:'utf8',timeout:30000}); if(r.status!==0)throw new Error(`${name}: ${r.error?.message??r.stderr}`);return r.stdout.trim(); };
const version = run('postgres',['--version']);assert.match(version,/PostgreSQL\) 17\./);
const temporary=mkdtempSync('/private/tmp/luckylap-area-passwords-'),dataDirectory=join(temporary,'data'),socketDirectory=join(temporary,'socket');mkdirSync(socketDirectory,{mode:0o700});
const port=await new Promise((done,fail)=>{const s=createServer();s.once('error',fail);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>done(p));});});
const evidence={version,startedAt:new Date().toISOString(),checks:0,concurrency:[],passed:false};const clients=[];let started=false;let owner;let a;let b;let pids;
const id=n=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const roles=['founder','production','finance','logistics','consultant','outsider','inactive','production_no_flag'];
const users=Object.fromEntries(roles.map((r,i)=>[r,id(i+1)]));
const defaultSession=role=>id(100+roles.indexOf(role)*10);
// These are synthetic test strings only; never operational credentials.
const financePassword='qa-finance-6',auditPassword='qa-audit-6',rotatedPassword='qa-rotated-6';
const equal=(a,b,label)=>{assert.deepEqual(a,b,label);evidence.checks+=1;};
const truth=(v,label)=>{assert.ok(v,label);evidence.checks+=1;};
const rejected=async(promise,code)=>{await assert.rejects(promise,e=>e.code===code);evidence.checks+=1;};
async function connect(name){const c=new Client({host:socketDirectory,port,user:'luckylap_qa_owner',password:'',database:'postgres',ssl:false,application_name:`luckylap-area-${name}`,statement_timeout:15000,query_timeout:18000});c.on('error',()=>{});await c.connect();clients.push(c);return c;}
async function begin(client,role='founder',session=defaultSession(role),extra={},dbRole='authenticated'){
  await client.query('begin');await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:users[role],role:dbRole,session_id:session,aal:'aal1',...extra})]);await client.query(`set local role ${dbRole}`);
}
async function as(role,sql,args=[],session=defaultSession(role),extra={},dbRole='authenticated'){
  await begin(a,role,session,extra,dbRole);try{const result=await a.query(sql,args);await a.query('commit');return result;}catch(e){await a.query('rollback');throw e;}
}
const value=async(...args)=>(await as(...args)).rows[0].value;
const status=(role,area='finance',session=defaultSession(role),extra={})=>value(role,'select public.sensitive_area_status($1) value',[area],session,extra);
const unlock=(role,password=financePassword,area='finance',session=defaultSession(role),extra={})=>value(role,'select public.unlock_sensitive_area($1,$2) value',[area,password],session,extra);
const configure=(area,password)=>value('founder','select public.configure_sensitive_password($1,$2) value',[area,password],id(100),{role:'service_role'},'service_role');
async function blocked(){const end=Date.now()+5000;while(Date.now()<end){const r=(await owner.query('select pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[pids.b])).rows[0];if(r?.wait_event_type==='Lock'&&r.blockers.includes(pids.a)){truth(r.state==='active','Concurrent second request is active and blocked by first backend');return r;}await new Promise(done=>setTimeout(done,20));}throw new Error('No real lock contention observed');}
try{
  run('initdb',['-D',dataDirectory,'-L',resolve(binaryDirectory,'../share/postgresql'),'--username=luckylap_qa_owner','--no-locale','--encoding=UTF8','--auth-local=trust','--auth-host=reject']);
  run('pg_ctl',['-D',dataDirectory,'-l',join(temporary,'postgres.log'),'-o',`-p ${port} -k ${socketDirectory} -c listen_addresses='' -c unix_socket_permissions=0700 -c max_connections=12`,'-w','start']);started=true;
  owner=await connect('observer');a=await connect('a');b=await connect('b');pids=Object.fromEntries(await Promise.all([['owner',owner],['a',a],['b',b]].map(async([name,c])=>[name,(await c.query('select pg_backend_pid() pid')).rows[0].pid])));evidence.backendPids=pids;equal(new Set(Object.values(pids)).size,3,'Distinct real backend connections');
  await owner.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to anon,authenticated,service_role;
    create schema extensions;create extension pgcrypto schema extensions;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  const directory=new URL('../migrations/',import.meta.url);
  for(const suffix of ['initial_schema','area_passwords']){const names=readdirSync(directory).filter(n=>n.endsWith(`_${suffix}.sql`));assert.equal(names.length,1);await owner.query(readFileSync(new URL(names[0],directory),'utf8'));}
  for(const role of roles){await owner.query('insert into auth.users values($1)',[users[role]]);await owner.query('insert into auth.sessions(id,user_id) values($1,$2)',[defaultSession(role),users[role]]);if(role==='outsider')continue;await owner.query('insert into public.profiles(user_id,display_name) values($1,$2)',[users[role],role]);await owner.query('insert into public.memberships(user_id,role,active,finance_access) values($1,$2,$3,$4)',[users[role],role==='inactive'?'finance':role==='production_no_flag'?'production':role,role!=='inactive',['production','finance','inactive'].includes(role)]);}
  for(const [session,user]of[[101,'founder'],[104,'founder'],[105,'founder'],[102,'finance'],[999,'finance']])await owner.query('insert into auth.sessions(id,user_id) values($1,$2)',[id(session),users[user]]);
  await owner.query("insert into public.finance_entries(entry_date,entry_type,amount_eur,description,created_by) values(current_date,'expense',1,'Synthetic only',$1)",[users.founder]);
  equal(await status('founder'),false,'Unconfigured area fails closed');equal((await unlock('founder')).status,'denied','No credential is auto-seeded');
  equal((await owner.query('select count(*)::int n from private.sensitive_area_credentials')).rows[0].n,0,'No migration password seed');
  await rejected(as('founder','select public.configure_sensitive_password($1,$2)',['finance',financePassword]),'42501');
  await rejected(as('founder','select public.configure_sensitive_password($1,$2)',['finance',financePassword],id(100),{role:'service_role'}),'42501');
  await rejected(as('founder','select public.configure_sensitive_password($1,$2)',['finance',financePassword],id(100),{role:'authenticated'},'service_role'),'42501');
  for(const [area,password]of[['unknown',financePassword],['finance','short'],['finance','x'.repeat(73)],['finance','é'.repeat(37)]])await rejected(configure(area,password),'22023');
  equal(await configure('finance',financePassword),true,'Service bootstrap configures Finance');equal(await configure('audit',auditPassword),true,'Service bootstrap configures CEO');
  equal((await owner.query("select bool_and(password_hash ~ '^\\$2a\\$10\\$' and length(password_hash)=60) safe from private.sensitive_area_credentials")).rows[0].safe,true,'Only bcrypt cost10 hashes are stored');
  for(const role of roles){const financeEligible=['founder','production','finance'].includes(role);const auditEligible=role==='founder';
    for(const aal of['aal1','aal2']){equal(await status(role,'finance',defaultSession(role),{aal,user_metadata:{role:'founder',finance_access:true}}),false,'AAL and editable metadata never unlock an area');}
    equal((await unlock(role)).status,financeEligible?'unlocked':'denied','Only current Finance members can unlock shared Finance password');
    equal((await unlock(role,auditPassword,'audit')).status,auditEligible?'unlocked':'denied','CEO password only unlocks founder');
    equal(await status(role),financeEligible,'Finance status honors current membership');equal(await status(role,'audit'),auditEligible,'Audit status honors founder eligibility');
    equal((await value(role,'select count(*)::int value from public.finance_entries')),financeEligible?1:0,'Existing Finance RLS uses password grants');
    equal(await value(role,'select private.can_audit() value'),auditEligible,'Existing audit helper uses password grants');
  }
  const grant=(await owner.query('select extract(epoch from(expires_at-clock_timestamp())) seconds from private.area_grants where user_id=$1 and area=$2',[users.founder,'finance'])).rows[0];truth(Number(grant.seconds)>28700&&Number(grant.seconds)<=28800,'Grant expires after eight hours');
  for(const session of[null,'not-a-uuid','']){equal(await status('founder','finance',session),false,'Missing/malformed session denied');equal((await unlock('founder',financePassword,'finance',session)).status,'denied','Unlock requires current Auth session UUID');}
  equal(await status('founder','finance',id(100),{session_id:undefined}),false,'Absent session claim fails closed');equal((await unlock('founder',financePassword,'finance',id(100),{session_id:undefined})).status,'denied','Missing session claim cannot unlock');
  equal(await status('founder','finance',defaultSession('production')),false,'Another user session does not authorize the JWT subject');equal((await unlock('founder',financePassword,'finance',defaultSession('production'))).status,'denied','Correct password cannot use another user session');
  equal((await unlock('founder',financePassword,'finance',id(104))).status,'unlocked','Live Auth session can unlock');await owner.query('delete from auth.sessions where id=$1',[id(104)]);equal(await status('founder','finance',id(104)),false,'Deleting Auth session invalidates the unchanged JWT grant');equal((await unlock('founder',financePassword,'finance',id(104))).status,'denied','Deleted Auth session cannot renew with a still-valid JWT');
  equal((await unlock('founder',financePassword,'finance',id(105))).status,'unlocked','Second live session unlocks');await owner.query('update auth.sessions set not_after=clock_timestamp()-interval \'1 second\' where id=$1',[id(105)]);equal(await status('founder','finance',id(105)),false,'Auth session not_after expiry invalidates its grant');equal((await unlock('founder',financePassword,'finance',id(105))).status,'denied','Expired Auth session cannot renew with correct password');
  equal(await status('founder','finance',id(101)),false,'Same user on another session remains locked');equal((await unlock('founder',financePassword,'finance',id(101))).status,'unlocked','Other session needs its own password grant');
  equal(await value('founder','select public.lock_sensitive_area($1) value',['finance']),true,'Lock current session');equal(await status('founder'),false,'Locked session loses Finance');equal(await status('founder','finance',id(101)),true,'Lock leaves other session untouched');equal(await status('founder','audit'),true,'Lock leaves other area untouched');
  equal(await value('founder','select public.lock_sensitive_area($1) value',['finance']),true,'Lock is idempotent');
  await owner.query('update private.area_grants set expires_at=clock_timestamp()-interval \'1 second\' where user_id=$1 and area=$2',[users.founder,'finance']);equal(await status('founder','finance',id(101)),false,'Expired grants fail closed');
  equal((await unlock('founder')).status,'unlocked','Correct password renews an expired grant');
  await owner.query('update public.memberships set active=false where user_id=$1',[users.production]);equal(await status('production'),false,'Revoked membership immediately denies an existing grant');equal((await unlock('production')).status,'denied','Revoked membership cannot renew');await owner.query('update public.memberships set active=true,finance_access=false where user_id=$1',[users.production]);equal(await status('production'),false,'Production Finance flag remains required');await owner.query('update public.memberships set finance_access=true where user_id=$1',[users.production]);
  for(let n=1;n<=5;n+=1)equal((await unlock('finance','wrong-test-password')).status,n===5?'locked':'denied','Failed counters commit and fifth failure locks');
  equal((await unlock('finance',financePassword,'finance',id(999))).status,'locked','User/area lock applies across sessions');equal((await owner.query('select failed_count from private.area_password_attempts where user_id=$1 and area=$2',[users.finance,'finance'])).rows[0].failed_count,5,'Locked correct password does not reset counter');
  equal((await unlock('founder')).status,'unlocked','One user lock does not lock other eligible users');
  await owner.query('update private.area_password_attempts set locked_until=clock_timestamp()-interval \'1 second\' where user_id=$1 and area=$2',[users.finance,'finance']);equal((await unlock('finance')).status,'unlocked','Password may unlock after cooldown');
  await unlock('finance','wrong-test-password');await owner.query('update private.area_password_attempts set window_started_at=clock_timestamp()-interval \'16 minutes\' where user_id=$1 and area=$2',[users.finance,'finance']);equal((await unlock('finance','wrong-test-password')).status,'denied','New failure window starts after fifteen minutes');equal((await owner.query('select failed_count from private.area_password_attempts where user_id=$1 and area=$2',[users.finance,'finance'])).rows[0].failed_count,1,'Expired failure window resets the counter');
  const oldVersion=(await owner.query("select version from private.sensitive_area_credentials where area='finance'")).rows[0].version;equal(await configure('finance',rotatedPassword),true,'Rotation succeeds');truth((await owner.query("select version from private.sensitive_area_credentials where area='finance'")).rows[0].version!==oldVersion,'Rotation changes credential version');equal((await owner.query("select count(*)::int n from private.area_grants where area='finance'")).rows[0].n,0,'Rotation removes every Finance grant');equal((await owner.query("select count(*)::int n from private.area_password_attempts where area='finance'")).rows[0].n,0,'Rotation resets all Finance counters');equal(await status('founder','audit'),true,'Finance rotation preserves audit grants');equal((await unlock('founder',financePassword)).status,'denied','Old password is no longer valid');equal((await unlock('founder',rotatedPassword)).status,'unlocked','Rotated password works');
  equal(await configure('finance','é'.repeat(36)),true,'Exactly 72 UTF8 bytes are supported');equal((await unlock('founder','é'.repeat(36))).status,'unlocked','UTF8 bytes match exactly');await configure('finance',financePassword);
  for(const table of['sensitive_area_credentials','area_grants','area_password_attempts']){equal((await owner.query('select relrowsecurity enabled from pg_class where oid=$1::regclass',[`private.${table}`])).rows[0].enabled,true,'Private control table has RLS');for(const dbRole of['anon','authenticated','service_role']){equal((await owner.query('select has_table_privilege($1,$2,\'SELECT\') allowed',[dbRole,`private.${table}`])).rows[0].allowed,false,'No role may read private hashes/grants/counters');}await rejected(as('founder',`select * from private.${table}`),'42501');await rejected(as('founder',`delete from private.${table}`),'42501');}
  await rejected(as('founder','insert into private.area_grants(session_id,user_id,area,credential_version,expires_at) values($1,$2,\'finance\',$3,now()+interval \'8 hours\')',[id(100),users.founder,id(123)]),'42501');
  for(const name of['sensitive_area_eligible(text)','current_auth_session_id()'])equal((await owner.query('select has_function_privilege(\'authenticated\',$1,\'EXECUTE\') allowed',[`private.${name}`])).rows[0].allowed,false,'Internal helpers are not client RPCs');
  for(const name of['sensitive_area_status(text)','unlock_sensitive_area(text,text)','lock_sensitive_area(text)'])equal((await owner.query('select has_function_privilege(\'anon\',$1,\'EXECUTE\') allowed',[`public.${name}`])).rows[0].allowed,false,'Anon cannot execute area RPC');
  equal((await owner.query("select count(*)::int n from public.audit_logs where coalesce(old_data::text,'') like '%qa-finance-6%' or coalesce(new_data::text,'') like '%qa-finance-6%' or table_name in('sensitive_area_credentials','area_grants','area_password_attempts')")).rows[0].n,0,'No password or control-table payload reaches general audit');

  // Real overlapping backend requests prove that counters cannot lose updates.
  for(let n=0;n<3;n+=1)await unlock('finance','wrong-test-password');
  await begin(a,'finance');const fourth=(await a.query('select public.unlock_sensitive_area($1,$2) value',['finance','wrong-test-password'])).rows[0].value;equal(fourth.status,'denied','Fourth failure waits for commit');
  await begin(b,'finance',id(102));const pending=b.query('select public.unlock_sensitive_area($1,$2) value',['finance','wrong-test-password']);const wait=await blocked();await a.query('commit');const fifth=(await pending).rows[0].value;await b.query('commit');equal(fifth.status,'locked','Concurrent fifth failure locks after serialized fourth');equal((await owner.query("select failed_count from private.area_password_attempts where user_id=$1 and area='finance'",[users.finance])).rows[0].failed_count,5,'No lost concurrent failed-attempt increment');evidence.concurrency.push({case:'failed counters serialize',waiting:wait});
  await configure('finance',financePassword);await begin(a,'founder');equal((await a.query('select public.unlock_sensitive_area($1,$2) value',['finance',financePassword])).rows[0].value.status,'unlocked','Unlock holds the old credential version until commit');await begin(b,'founder',id(103),{role:'service_role'},'service_role');const rotation=b.query('select public.configure_sensitive_password($1,$2) value',['finance',rotatedPassword]);const rotationWait=await blocked();await a.query('commit');equal((await rotation).rows[0].value,true,'Rotation completes after concurrent unlock');await b.query('commit');equal(await status('founder'),false,'Concurrent rotation invalidates the just-committed old grant');equal((await unlock('founder',rotatedPassword)).status,'unlocked','New version unlocks normally');evidence.concurrency.push({case:'rotation excludes stale grant',waiting:rotationWait});
  evidence.passed=true;
}catch(error){evidence.failure={message:error.message,code:error.code};throw error;}finally{
  for(const c of clients.reverse())try{await c.end();}catch{}
  if(started||existsSync(join(dataDirectory,'postmaster.pid')))try{run('pg_ctl',['-D',dataDirectory,'-m','immediate','-w','stop']);evidence.clusterStopped=true;}catch(error){evidence.cleanupError=error.message;process.exitCode=1;}
  if(evidence.clusterStopped||!existsSync(join(dataDirectory,'postmaster.pid'))){rmSync(temporary,{recursive:true,force:true});evidence.clusterRemoved=!existsSync(temporary);}
  evidence.finishedAt=new Date().toISOString();const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));mkdirSync(join(root,'.private','deployment-proof'),{recursive:true});writeFileSync(join(root,'.private','deployment-proof','area-passwords.json'),`${JSON.stringify(evidence,null,2)}\n`,{mode:0o600});console.log(`${evidence.passed?'PASS':'FAIL'} ${evidence.checks} area-password checks on ${version}; backends=${JSON.stringify(pids)}; cluster stopped=${evidence.clusterStopped}`);
}
