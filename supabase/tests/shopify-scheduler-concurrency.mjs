// Real local PostgreSQL 17 and overlapping connections. Vendor extensions are
// explicit stand-ins; this proves transaction locks, not real HTTP delivery.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
const [binaryDirectory,pgModule]=process.argv.slice(2);
if(!binaryDirectory?.startsWith('/')||!pgModule?.startsWith('/'))throw new Error('Pass absolute PostgreSQL17 bin and pg module paths.');
const imported=await import(pathToFileURL(pgModule).href);const Client=imported.Client??imported.default.Client;
const run=(binary,args)=>{const result=spawnSync(join(binaryDirectory,binary),args,{encoding:'utf8',timeout:30000});if(result.status!==0)throw new Error(`${binary}: ${result.error?.message??result.stderr}`);return result.stdout.trim();};
assert.match(run('postgres',['--version']),/PostgreSQL\) 17\./);
const directory=mkdtempSync('/private/tmp/luckylap-scheduler-lock-'),data=join(directory,'data'),socket=join(directory,'socket');mkdirSync(socket,{mode:0o700});
const port=await new Promise((resolvePort,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolvePort(value));});});
const clients=[];let started=false;let checks=0;
const equal=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const secret='synthetic_scheduler_secret_000000000000',rotated='synthetic_rotated_secret_0000000000000';
async function connect(label){const client=new Client({host:socket,port,user:'postgres',database:'postgres',ssl:false,application_name:`luckylap-scheduler-${label}`,statement_timeout:15000,query_timeout:18000});client.on('error',()=>{});await client.connect();clients.push(client);return client;}
const scalar=async(client,sql,args=[])=>(await client.query(sql,args)).rows[0].value;
async function begin(client,role='postgres'){await client.query('begin');if(role!=='postgres')await client.query(`set local role ${role}`);}
async function configure(client,value,enabled){await begin(client,'service_role');try{const result=await scalar(client,'select public.configure_shopify_scheduler($1,$2) value',[value,enabled]);await client.query('commit');return result;}catch(error){await client.query('rollback');throw error;}}
async function waitBlocked(observer,waitingPid,blockingPid){
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
    const row=(await observer.query('select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[waitingPid])).rows[0];
    if(row?.wait_event_type==='Lock'&&row.blockers.includes(blockingPid)){checks++;return;}
    await new Promise(done=>setTimeout(done,20));
  }
  throw new Error('No real advisory-lock contention observed.');
}
try{
  run('initdb',['-D',data,'-L',resolve(binaryDirectory,'../share/postgresql'),'--username=postgres','--no-locale','--encoding=UTF8','--auth-local=trust','--auth-host=reject']);
  run('pg_ctl',['-D',data,'-l',join(directory,'postgres.log'),'-o',`-p ${port} -k ${socket} -c listen_addresses='' -c unix_socket_permissions=0700 -c max_connections=8`,'-w','start']);started=true;
  const observer=await connect('observer'),a=await connect('a'),b=await connect('b');
  const aPid=await scalar(a,'select pg_backend_pid() value'),bPid=await scalar(b,'select pg_backend_pid() value');equal(aPid!==bPid,true,'Two distinct real worker backends');
  await observer.query(readFileSync(new URL('./fixtures/shopify-scheduler.sql',import.meta.url),'utf8'));
  const migrations=new URL('../migrations/',import.meta.url),names=readdirSync(migrations).filter(name=>name.endsWith('_shopify_scheduler.sql'));equal(names.length,1,'One scheduler migration');
  const source=readFileSync(new URL(names[0],migrations),'utf8');await observer.query(source.replace(/^create extension if not exists .*;$/gm,''));
  const requests=()=>scalar(observer,'select count(*)::int value from net.synthetic_requests');
  const dispatch=client=>client.query('select private.dispatch_shopify_worker_tick()');

  // Dispatch already enqueued but has not committed: disable must wait for that
  // exact transaction, so its eventual receipt cannot precede the enqueue.
  await configure(observer,secret,true);await begin(a);await dispatch(a);
  await begin(b,'service_role');let pending=b.query('select public.configure_shopify_scheduler($1,false)',[null]);void pending.catch(()=>undefined);
  await waitBlocked(observer,bPid,aPid);equal(await requests(),0,'Uncommitted enqueue remains invisible while disable waits');
  await a.query('commit');await pending;await b.query('commit');
  equal(await requests(),1,'Pre-disable enqueue commits before disable can finish');
  await dispatch(observer);equal(await requests(),1,'No new enqueue after completed disable');

  // Disable holds the lock first: dispatch starts before disable's commit, then
  // waits and must read the committed absence rather than a stale credential.
  await configure(observer,secret,true);await observer.query('delete from net.synthetic_requests');
  await begin(a,'service_role');await a.query('select public.configure_shopify_scheduler($1,false)',[null]);
  await begin(b);pending=dispatch(b);void pending.catch(()=>undefined);
  await waitBlocked(observer,bPid,aPid);await a.query('commit');await pending;await b.query('commit');
  equal(await requests(),0,'Waiting dispatch sees committed disable and queues nothing');

  // Rotation first: a waiting dispatch uses only the new committed bearer.
  await configure(observer,secret,true);await begin(a,'service_role');await a.query('select public.configure_shopify_scheduler($1,true)',[rotated]);
  await begin(b);pending=dispatch(b);void pending.catch(()=>undefined);
  await waitBlocked(observer,bPid,aPid);await a.query('commit');await pending;await b.query('commit');
  equal(await requests(),1,'Exactly one dispatch after committed rotation');
  equal(await scalar(observer,"select headers->>'Authorization' value from net.synthetic_requests order by id desc limit 1"),`Bearer ${rotated}`,'No old bearer enqueued after rotation wins the lock');

  // Dispatch first, rotation second: old enqueue commits first; subsequent work
  // gets the new credential. Already queued/in-flight HTTP is not revoked.
  await configure(observer,secret,true);await observer.query('delete from net.synthetic_requests');await begin(a);await dispatch(a);
  await begin(b,'service_role');pending=b.query('select public.configure_shopify_scheduler($1,true)',[rotated]);void pending.catch(()=>undefined);
  await waitBlocked(observer,bPid,aPid);equal(await requests(),0,'Rotation cannot finish ahead of the old enqueue transaction');
  await a.query('commit');await pending;await b.query('commit');await dispatch(observer);
  equal(await requests(),2,'Old committed enqueue and one new dispatch remain distinct');
  equal((await observer.query("select headers->>'Authorization' value from net.synthetic_requests order by id")).rows.map(row=>row.value),[`Bearer ${secret}`,`Bearer ${rotated}`],'Queue commit order agrees with credential rotation');
  console.log(`PASS ${checks} real PostgreSQL scheduler checks, including four observed overlapping lock interleavings. Cron/Vault/HTTP remain stand-ins; no cloud or delivery tested.`);
}catch(error){console.error({message:error.message,code:error.code});process.exitCode=1;}
finally{
  await Promise.allSettled(clients.map(client=>client.end()));
  if(started)try{run('pg_ctl',['-D',data,'-m','fast','-w','stop']);}catch{process.exitCode=1;}
  rmSync(directory,{recursive:true,force:true});
}
