// test-db: pglite minimo 172
// Recupero temporaneo, guardie prima del catalogo e regressioni Partner con soli dati sintetici.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) throw new Error("Passare il percorso di PGlite.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const migrations = new URL("../migrations/", import.meta.url);
const previous = readFileSync(
  new URL("20261124083129_partner_eventi_priorita_fallback.sql", migrations),
  "utf8",
);
const recovery = readFileSync(
  new URL("20261124095231_partner_fallback_recupero_temporaneo.sql", migrations),
  "utf8",
);
const fix = readFileSync(
  new URL("20261124095335_partner_fallback_guardia_rapida.sql", migrations),
  "utf8",
);
const db = new PGlite();
let checks = 0;
const eq = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks++;
};
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.v;
const founder = "80000000-0000-4000-8000-000000000001";
const at = "2026-11-24T09:00:00Z";
const count = async () =>
  Number(
    await scalar(
      "select case when is_called then last_value else 0 end v from private.catalog_calls",
    ),
  );
const reset = () => db.exec("select setval('private.catalog_calls',1,false)");
const fallback = (instant = at) =>
  scalar("select private.partner_event_fallback_check($1::timestamptz) v", [instant]);
const catalog = async (payload) => {
  await db.query("select set_config('test.catalog_payload',$1,false)", [JSON.stringify(payload)]);
  return scalar("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') v", [
    JSON.stringify(payload),
  ]);
};
let sha;
const proof = async (change = {}, replace = true) => {
  if (replace) await db.exec("truncate private.partner_event_exhaustion_checks restart identity");
  const row = { created: at, until: "2026-11-26T09:00:00Z", exhausted: true, sha, ...change };
  return Number(
    await scalar(
      `insert into private.partner_event_exhaustion_checks
    (checked_by,created_at,valid_until,exhausted,catalog_sha256) values($1,$2,$3,$4,$5) returning id v`,
      [founder, row.created, row.until, row.exhausted, row.sha],
    ),
  );
};
const noCatalog = async (instant = at) => {
  await reset();
  eq(await fallback(instant), null);
  eq(await count(), 0, "una prova inutilizzabile non deve leggere il catalogo");
};

try {
  await db.exec(`create schema private; create role authenticated; create role service_role;
    create table public.memberships(user_id uuid primary key,active boolean not null,role text not null);
    create table private.partner_event_exhaustion_checks(id bigint generated always as identity primary key,
      checked_by uuid not null,created_at timestamptz not null,valid_until timestamptz not null,
      exhausted boolean not null,catalog_sha256 text not null);
    create sequence private.catalog_calls;
    create function private.partner_assistant_rome_day(p_at timestamptz) returns date
      language sql stable set search_path='' as $$ select (p_at at time zone 'Europe/Rome')::date $$;
    create function private.partner_event_priority_from() returns date
      language sql immutable set search_path='' as $$ select date '2026-11-24' $$;
    create function private.partner_event_priority_catalog(p_day date) returns jsonb
      language plpgsql stable security invoker set search_path='' as $$
      begin
        if current_setting('test.catalog_throw',true)='on' then raise exception 'catalog_must_not_run'; end if;
        perform nextval('private.catalog_calls');
        return coalesce(nullif(current_setting('test.catalog_payload',true),'')::jsonb,'[]'::jsonb);
      end $$;
    create function private.partner_event_priority_catalog_sha256(p_day date) returns text
      language sql stable set search_path='' as $$ select encode(sha256(convert_to(private.partner_event_priority_catalog(p_day)::text,'UTF8')),'hex') $$;
    create function private.partner_event_priority_pending(p_day date) returns integer
      language sql stable set search_path='' as $$ select count(*)::integer from jsonb_array_elements(private.partner_event_priority_catalog(p_day)) x where x->'contactable'='true'::jsonb $$;`);
  await db.query("insert into public.memberships values($1,true,'founder')", [founder]);
  const start = previous.indexOf("create function private.partner_event_fallback_check(");
  const end = previous.indexOf(
    "create function private.record_partner_event_exhaustion_as_founder",
    start,
  );
  assert.ok(start >= 0 && end > start);
  await db.exec(previous.slice(start, end));
  await db.exec(
    "revoke all on function private.partner_event_fallback_check(timestamptz) from public; grant execute on function private.partner_event_fallback_check(timestamptz) to authenticated",
  );
  const attributes = () =>
    db
      .query(
        "select proacl::text,provolatile,prosecdef,proconfig from pg_proc where oid='private.partner_event_fallback_check(timestamptz)'::regprocedure",
      )
      .then((r) => r.rows);
  const originalAttributes = await attributes();
  sha = await catalog([]);
  await reset();
  eq(await fallback(), null);
  const oldCalls = await count();
  ok(
    oldCalls > 0,
    "riproduce la scansione del catalogo senza attestazioni nella vecchia funzione SQL",
  );
  await db.exec(recovery);
  await noCatalog();
  eq(await attributes(), originalAttributes, "il recupero conserva grants e attributi");
  await proof();
  await assert.rejects(db.exec(recovery), /partner_event_fallback_recovery_requires_empty_history/);
  checks++;
  await db.exec("rollback; truncate private.partner_event_exhaustion_checks restart identity");
  const fixStart = fix.indexOf("create or replace function private.partner_event_fallback_check(");
  const fixEnd = fix.indexOf("$$;", fixStart) + 3;
  assert.ok(fixStart >= 0 && fixEnd > fixStart);
  await db.exec(fix.slice(fixStart, fixEnd));
  eq(await attributes(), originalAttributes, "il fix conserva grants e attributi");
  eq(
    await scalar(
      "select lanname v from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='private.partner_event_fallback_check(timestamptz)'::regprocedure",
    ),
    "plpgsql",
  );

  // Una funzione che solleva un'eccezione prova che la guardia precede davvero il catalogo.
  await db.exec("select set_config('test.catalog_throw','on',false)");
  await noCatalog();
  await proof();
  await noCatalog(null);
  await proof({ exhausted: false });
  await noCatalog();
  await proof({ created: "2026-11-24T09:00:01Z" });
  await noCatalog();
  await proof({ until: at });
  await noCatalog();
  await proof({ until: "2026-11-24T08:59:59Z" });
  await noCatalog();
  await proof();
  await db.query("update public.memberships set active=false where user_id=$1", [founder]);
  await noCatalog();
  await db.query("update public.memberships set active=true,role='consultant' where user_id=$1", [
    founder,
  ]);
  await noCatalog();
  await db.query("update public.memberships set role='founder' where user_id=$1", [founder]);
  await proof({ created: "2026-11-22T09:00:00Z" });
  await noCatalog("2026-11-23T09:00:00Z");
  await proof();
  await proof({ exhausted: false }, false);
  await noCatalog();
  await proof();
  await proof({ created: "2026-11-24T09:00:01Z" }, false);
  await noCatalog();
  await proof();
  await assert.rejects(fallback(), /catalog_must_not_run/);
  checks++;
  await db.exec("select set_config('test.catalog_throw','off',false)");
  await reset();
  eq(Number(await fallback()), 1, "l'inizio è incluso");
  eq(await count(), 1, "impronta e contatti riusano un solo catalogo");
  await noCatalog("2026-11-26T09:00:00Z");
  await proof({ sha: "0".repeat(64) });
  await reset();
  eq(await fallback(), null);
  eq(await count(), 1);
  sha = await catalog([{ contactable: true }]);
  await proof();
  await reset();
  eq(await fallback(), null, "un evento residuo impedisce il fallback");
  eq(await count(), 1);
  sha = await catalog([{ contactable: false }]);
  await proof();
  await reset();
  eq(Number(await fallback()), 1);
  eq(await count(), 1);
  console.log(
    `Scansioni catalogo: vecchio=${oldCalls}, recupero=0, fix senza prove=0, prova valida=1.`,
  );
} finally {
  await db.close();
}

// Riusa le 119 regressioni originali senza cambiarne file o fixture. Le sostituzioni
// sono controllate e riguardano solo URL, ordine delle migrazioni e benchmark locale.
let source = readFileSync(new URL("partner-eventi-priorita-fallback.mjs", import.meta.url), "utf8");
const replaceOnce = (before, after) => {
  assert.equal(source.indexOf(before), source.lastIndexOf(before));
  assert.ok(source.includes(before), `Ancora mancante: ${before}`);
  source = source.replace(before, () => after);
};
replaceOnce(
  'const migrations = new URL("../migrations/", import.meta.url);',
  `const migrations = new URL(${JSON.stringify(migrations.href)});`,
);
replaceOnce(
  '  await db.exec(migration("_partner_eventi_priorita_fallback.sql"));',
  '  await db.exec(migration("_partner_eventi_priorita_fallback.sql"));\n  await db.exec(migration("_partner_fallback_recupero_temporaneo.sql"));\n  await db.exec(migration("_partner_fallback_guardia_rapida.sql"));',
);
replaceOnce(
  '  eq(await fallback(), false, "la migrazione non accende il fallback");',
  `
  await as("postgres",founder,async()=>{
    await db.exec("savepoint synthetic_queue_benchmark");
    await db.query(\`insert into public.partners(id,co,name,origin,stage,created_by,sections,country,priority,contact_month)
      select gen_random_uuid(),50000+i,'Candidato sintetico '||i,'team','da_contattare',$1,array['collab']::text[],'Italia','media',date '2026-11-01'
      from generate_series(0,849) i\`,[founder]);
    await db.query(\`insert into public.partner_contacts(partner_id,kind,value,link_value,created_by,updated_by)
      select id,'email','queue-'||co||'@synthetic.example.test','queue-'||co||'@synthetic.example.test',$1,$1
      from public.partners where co between 50000 and 50849\`,[founder]);
    const benchmarkCatalogDefinition=await value("select pg_get_functiondef('private.partner_event_priority_catalog(date)'::regprocedure) v");
    await db.exec(\`create or replace function private.partner_event_priority_catalog(p_day date) returns jsonb
      language plpgsql stable security invoker set search_path='' as $$
      begin raise exception 'benchmark_catalog_must_not_run'; end $$\`);
    eq(Number(await value("select count(*) v from public.partners where co between 50000 and 50849")),850);
    const benchmarkStarted=performance.now();
    const benchmarkProgram=await value("select private.read_partner_email_program($1::date,1) v",[TODAY]);
    const benchmarkMs=Math.round(performance.now()-benchmarkStarted);
    eq(benchmarkProgram.unprepared.length,0);
    eq(benchmarkProgram.items.length,0);
    eq(benchmarkProgram.config.eventPriorityFrom,TODAY);
    console.log("Benchmark read_partner_email_program/queue:850candidati sintetici,"+benchmarkMs+"ms; catalogo non chiamato, nessuna soglia wall-time.");
    await db.exec(benchmarkCatalogDefinition);
    await db.query(\`insert into public.partners(id,co,name,origin,stage,created_by,sections,country,priority,contact_month,event_starts_on,next_action,next_action_on)
      select gen_random_uuid(),51000+i,'Evento manuale sintetico '||i,'team','da_contattare',$1,array['eventi']::text[],'Italia','media',date '2026-11-01',date '2027-05-20','Gestione manuale sintetica',date '2026-11-25'
      from generate_series(0,4) i\`,[founder]);
    await db.query(\`insert into public.partner_contacts(partner_id,kind,value,link_value,created_by,updated_by)
      select id,'email','manual-'||co||'@synthetic.example.test','manual-'||co||'@synthetic.example.test',$1,$1
      from public.partners where co between 51000 and 51004\`,[founder]);
    eq(Number(await value("select private.partner_event_priority_pending($1::date) v",[TODAY])),0);
    const benchmarkSha=await value("select private.partner_event_priority_catalog_sha256($1::date) v",[TODAY]);
    const benchmarkProof=await rpc("select private.record_partner_event_exhaustion_as_founder($1,$2,$3::jsonb) r",[founder,randomUUID(),JSON.stringify({schema_version:1,checked_on:TODAY,expected_catalog_sha256:benchmarkSha,exhausted:true,reason:"Verifica sintetica benchmark: nessun evento automatico contattabile residuo.",official_sources:["https://benchmark.example.test/events"]})]);
    ok(benchmarkProof.check_id);
    const validBenchmarkStarted=performance.now();
    const validBenchmarkProgram=await value("select private.read_partner_email_program($1::date,1) v",[TODAY]);
    const validBenchmarkMs=Math.round(performance.now()-validBenchmarkStarted);
    eq(validBenchmarkProgram.unprepared.length,850);
    eq(validBenchmarkProgram.counts.unpreparedTotal,850);
    eq(validBenchmarkProgram.items.length,0);
    console.log("Benchmark con prova valida/catalogo vero:850candidati e5eventi manuali,"+validBenchmarkMs+"ms;850non-eventi ammessi, nessuna soglia wall-time.");
    await db.query(\`insert into public.partner_assistant_jobs(partner_id,status,step,write_on)
      select id,'in_coda','ricerca',date '2026-11-24' from public.partners where co between 50000 and 50849\`);
    const jobsBenchmarkStarted=performance.now();
    const jobsBenchmarkProgram=await value("select private.read_partner_email_program($1::date,1) v",[TODAY]);
    const jobsBenchmarkMs=Math.round(performance.now()-jobsBenchmarkStarted);
    eq(jobsBenchmarkProgram.items.length,850);
    eq(jobsBenchmarkProgram.unprepared.length,0);
    ok(jobsBenchmarkProgram.items.every(r=>r.eligible&&r.fallbackWindow===null));
    console.log("Benchmark con prova valida/catalogo vero:850job senza bozza e5eventi manuali,"+jobsBenchmarkMs+"ms;nessuna finestra fallback indebita.");
    await db.exec("rollback to savepoint synthetic_queue_benchmark");
  },{now});
  eq(await fallback(), false, "la migrazione non accende il fallback");`,
);
const legacy = await import(
  `data:text/javascript;base64,${Buffer.from(source + "\nexport {checks as legacyChecks};\n").toString("base64")}`
);
if (process.exitCode) throw new Error("Regressioni Partner fallite.");
checks += legacy.legacyChecks;
console.log(
  `PASS ${checks} controlli: recupero, guardie senza catalogo, benchmark sintetico e regressioni Partner.`,
);
