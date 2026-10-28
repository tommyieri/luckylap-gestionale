// test-db: pglite minimo 196
// Assistente Partner, compito 3 (_assistente_partner_scheduler.sql): lo scheduler, copia di quello
// Shopify con nomi propri. Migrazioni dei compiti 1 e 2 su PGlite, poi la fixture
// fixtures/partner-assistant-scheduler.sql (sostituti sintetici di Cron, pg_net e Vault, più un job
// Shopify già attivo), poi la migrazione dello scheduler. Si verificano permessi, transazioni e
// configurazione, non la consegna vera, la cifratura di Vault o un cron con l'orologio. Solo segreti
// sintetici, nessuna rete e nessun accesso cloud.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (!process.argv[2]?.startsWith("/"))
  throw new Error("Passare il percorso assoluto di @electric-sql/pglite/dist/index.js.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const eq = (a, b, m) => {
  assert.deepEqual(a, b, m ?? "Values differ");
  checks++;
};
const ok = (a, m) => {
  assert.ok(a, m ?? "Expected truthy value");
  checks++;
};
const rejects = async (fn, code, message) => {
  let e;
  try {
    await fn();
  } catch (x) {
    e = x;
  }
  ok(e, `Atteso un errore ${code}`);
  eq(e.code, code, `Codice atteso ${code} (${e.message})`);
  if (message) eq(e.message, message);
};

const migrations = new URL("../migrations/", import.meta.url);
const migrationNames = (suffix) => readdirSync(migrations).filter((n) => n.endsWith(suffix));
const migration = (suffix) => {
  const names = migrationNames(suffix);
  assert.equal(names.length, 1, `Una sola migrazione ${suffix}`);
  return readFileSync(new URL(names[0], migrations), "utf8");
};
const value = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.v;
const count = (table) => value(`select count(*)::int as v from ${table}`);

// Un ruolo client con il suo JWT, come PostgREST: claims locali e set local role.
async function as(role, fn, claims = {}) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role, ...claims }),
    ]);
    await db.exec(`set local role ${role}`);
    const out = await fn();
    await db.exec("commit");
    return out;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const asService = (fn) => as("service_role", fn);
// Il job di cron gira come postgres, il proprietario delle funzioni, senza JWT.
async function asPostgres(fn) {
  await db.exec("begin");
  try {
    await db.exec("set local role postgres");
    const out = await fn();
    await db.exec("commit");
    return out;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}

// Solo credenziali sintetiche, mai valori operativi.
const secret = "sintetico_scheduler_assistente_00000000";
const rotated = "sintetico_ruotato_assistente_000000000";
const JOB = "luckylap-partner-assistant";
const SECRET_NAME = "luckylap_partner_assistant_bearer";
const URL_WORKER = "https://luckylap.vercel.app/api/integrations/partner-assistant/worker";
const COMMAND = "select private.dispatch_partner_assistant_tick();";
const configure = (s, enabled, schema = "public") =>
  value(`select ${schema}.configure_partner_assistant_scheduler($1, $2) as v`, [s, enabled]);
const dispatch = () => db.query("select private.dispatch_partner_assistant_tick()");
// Tutto quello che lo scheduler dell'assistente lascia: job, segreto, puntatore privato.
const assistantJobs = async () =>
  (
    await db.query(
      `select 'cron:' || jobname as v from cron.job where jobname = $1
       union all select 'vault:' || name from vault.secrets where name = $2
       union all select 'stato' from private.partner_assistant_scheduler_state
       order by 1`,
      [JOB, SECRET_NAME],
    )
  ).rows.map((r) => r.v);
const jobRow = async () =>
  (
    await db.query("select jobname, schedule, active, username from cron.job where jobname = $1", [
      JOB,
    ])
  ).rows[0];
const lastRequest = async () =>
  (
    await db.query(
      `select url, body, headers, timeout_ms as timeout_milliseconds, executed_by
         from net.synthetic_requests order by id desc limit 1`,
    )
  ).rows[0];
const shopifySyntheticJob = async () =>
  (await db.query("select * from cron.job where jobname = 'luckylap-shopify-worker'")).rows;
const shopifySecret = async () =>
  (
    await db.query(
      "select id, name, description, secret from vault.secrets where name = 'luckylap_shopify_worker_bearer'",
    )
  ).rows;

const FUNCTIONS = [
  "private.configure_partner_assistant_scheduler(text,boolean)",
  "private.dispatch_partner_assistant_tick()",
  "public.configure_partner_assistant_scheduler(text,boolean)",
];

try {
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create schema storage; create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb, unique(bucket_id, name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated; grant select, insert, update, delete on storage.objects to authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  eq(await value("select current_user as v"), "postgres", "Il proprietario atteso delle funzioni");
  for (const suffix of [
    "_initial_schema.sql",
    "_sales_ecosystem.sql",
    "_brand_assets_and_development.sql",
    "_partner_module.sql",
    "_partner_work_links.sql",
    "_partner_dates_only_agreed.sql",
    "_partner_oggi_fixes.sql",
    "_assistente_partner.sql",
    "_assistente_partner_worker.sql",
  ])
    await db.exec(migration(suffix));
  await db.exec(
    readFileSync(new URL("fixtures/partner-assistant-scheduler.sql", import.meta.url), "utf8"),
  );
  const before = await shopifySyntheticJob();
  eq(before.length, 1, "La fixture ha il job Shopify sintetico");

  // 1. Il testo della migrazione: transazione unica, nessuna estensione, URL fisso, niente segreti.
  eq(migrationNames("_assistente_partner_scheduler.sql").length, 1, "Una sola migrazione");
  const sql = migration("_assistente_partner_scheduler.sql");
  ok(/^begin;$/m.test(sql) && /^commit;\s*$/m.test(sql), "Migrazione tra begin e commit");
  eq(/create\s+extension/i.test(sql), false, "Nessun create extension");
  ok(sql.includes(`url := '${URL_WORKER}'`), "URL fisso del worker");
  eq(
    sql.match(/hashtextextended\('luckylap\.partner_assistant\.scheduler', 0\)/g)?.length,
    2,
    "Stesso lock per il giro e per la configurazione",
  );
  ok(!sql.includes(secret) && !sql.includes(rotated), "Nessun segreto nella migrazione");

  // 2. Vault leggibile dai ruoli del browser: la migrazione si ferma e non lascia niente. Si ferma
  // dentro la sua transazione, prima del commit: la sessione resta nella transazione interrotta,
  // che rifiuta ogni comando finché non si annulla, quindi niente è stato confermato.
  for (const role of ["anon", "authenticated"])
    for (const relation of ["vault.secrets", "vault.decrypted_secrets"]) {
      await db.exec(`grant select on ${relation} to ${role}`);
      await rejects(
        () => db.exec(sql),
        "55000",
        "partner_assistant_scheduler_vault_permissions_required",
      );
      await rejects(() => db.query("select 1"), "25P02");
      await db.exec("rollback");
      await db.exec(`revoke select on ${relation} from ${role}`);
    }

  // 3. Mentre la migrazione si applica, nessuna chiamata a cron, net o vault: ogni scrittura nelle
  // tabelle sintetiche e cron.schedule stesso falliscono.
  await db.exec(`create function private.synthetic_no_call() returns trigger language plpgsql as $$
      begin raise exception 'synthetic_call_during_migration'; end $$;
    create trigger synthetic_no_call before insert or update or delete on cron.job
      for each statement execute function private.synthetic_no_call();
    create trigger synthetic_no_call before insert or update or delete on vault.secrets
      for each statement execute function private.synthetic_no_call();
    create trigger synthetic_no_call before insert or update or delete on net.synthetic_requests
      for each statement execute function private.synthetic_no_call();
    update private.synthetic_scheduler_switch set mode = 'fail';`);
  await db.exec(sql);
  await db.exec(`drop trigger synthetic_no_call on cron.job; drop trigger synthetic_no_call on vault.secrets;
    drop trigger synthetic_no_call on net.synthetic_requests; drop function private.synthetic_no_call();
    update private.synthetic_scheduler_switch set mode = 'normal';`);
  eq(await assistantJobs(), [], "dopo la migrazione nessun job e nessun segreto");
  eq(await count("vault.secrets"), 0, "Nessun segreto");
  eq(await count("net.synthetic_requests"), 0, "Nessuna chiamata HTTP");
  eq(await shopifySyntheticJob(), before, "La migrazione non tocca il job Shopify");
  await asPostgres(() => dispatch());
  eq(await count("net.synthetic_requests"), 0, "Senza configurazione il giro non chiama");

  // 4. Tabella, funzioni e permessi.
  eq(
    await value(
      "select relrowsecurity as v from pg_class where oid = 'private.partner_assistant_scheduler_state'::regclass",
    ),
    true,
    "Puntatore privato con RLS",
  );
  eq(
    await value(
      "select pg_get_userbyid(relowner) as v from pg_class where oid = 'private.partner_assistant_scheduler_state'::regclass",
    ),
    "postgres",
  );
  for (const signature of FUNCTIONS) {
    const row = (
      await db.query(
        `select pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig, l.lanname
           from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = $1::regprocedure`,
        [signature],
      )
    ).rows[0];
    eq(row.owner, "postgres", `${signature}: proprietario postgres`);
    eq(row.prosecdef, signature.startsWith("private."), `${signature}: definer solo se private`);
    eq(row.proconfig, ['search_path=""'], `${signature}: search_path vuoto`);
    eq(row.lanname, "plpgsql", `${signature}: plpgsql, compila anche senza cron, net e vault`);
  }
  for (const role of ["public", "anon", "authenticated", "service_role"]) {
    const executes = async (signature) =>
      role === "public"
        ? value(
            `select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as v`,
            [signature],
          )
        : value("select has_function_privilege($1, $2, 'EXECUTE') as v", [role, signature]);
    eq(
      await executes("private.dispatch_partner_assistant_tick()"),
      false,
      `${role}: il giro lo lancia solo cron, come postgres`,
    );
    for (const schema of ["public", "private"])
      eq(
        await executes(`${schema}.configure_partner_assistant_scheduler(text,boolean)`),
        role === "service_role",
        `${role}: configura solo service_role (${schema})`,
      );
  }
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const table of [
      "private.partner_assistant_scheduler_state",
      ...(role === "service_role" ? [] : ["vault.secrets", "vault.decrypted_secrets"]),
    ]) {
      eq(
        await value("select has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE') as v", [
          role,
          table,
        ]),
        false,
        `${role}: nessun accesso diretto a ${table}`,
      );
      await rejects(() => as(role, () => db.query(`select * from ${table}`)), "42501");
    }
  }
  for (const table of ["vault.secrets", "vault.decrypted_secrets"]) {
    eq(
      await value("select pg_get_userbyid(relowner) as v from pg_class where oid = $1::regclass", [
        table,
      ]),
      "supabase_admin",
      "Proprietario di Vault invariato",
    );
    eq(
      await value("select has_table_privilege('service_role', $1, 'SELECT') as v", [table]),
      true,
      "Accesso di service_role a Vault invariato",
    );
  }
  // Un JWT del team che dichiara service_role nei metadati resta authenticated.
  for (const member of ["founder", "consultant", "production", "finance", "logistics"]) {
    const claims = { sub: `sintetico-${member}`, user_metadata: { role: "service_role" } };
    for (const schema of ["public", "private"])
      await rejects(
        () => as("authenticated", () => configure(secret, true, schema), claims),
        "42501",
      );
    await rejects(() => as("authenticated", () => dispatch(), claims), "42501");
  }
  await rejects(() => as("anon", () => configure(secret, true)), "42501");
  await rejects(
    () => configure(secret, true, "private"),
    "42501",
    "partner_assistant_worker_access_required",
  );

  // 5. Segreti non validi: errore 22023, niente scritto.
  for (const invalid of [
    null,
    "",
    "x".repeat(31),
    "x".repeat(257),
    "spazio ".repeat(10),
    "é".repeat(32),
    "x".repeat(32) + "\n",
  ])
    await rejects(
      () => asService(() => configure(invalid, true)),
      "22023",
      "invalid_partner_assistant_scheduler_configuration",
    );
  await rejects(() => asService(() => configure("corto", true)), "22023");
  await rejects(
    () => asService(() => configure(secret, null)),
    "22023",
    "invalid_partner_assistant_scheduler_configuration",
  );
  eq(await assistantJobs(), [], "Configurazioni rifiutate: niente job, segreto o puntatore");

  // 6. Accensione, con un segreto Shopify sintetico accanto.
  await db.query(
    "select vault.create_secret('sintetico_shopify_00000000000000000000', 'luckylap_shopify_worker_bearer', 'Shopify sintetico')",
  );
  const shopifyBefore = await shopifySecret();
  eq(
    await asService(() => configure(secret, true)),
    { enabled: true, schedule_seconds: 120 },
    "Ricevuta senza segreti",
  );
  eq(await assistantJobs(), [`cron:${JOB}`, "stato", `vault:${SECRET_NAME}`]);
  const firstSecretId = await value("select id as v from vault.secrets where name = $1", [
    SECRET_NAME,
  ]);
  eq(
    await value("select description as v from vault.secrets where name = $1", [SECRET_NAME]),
    "LuckyLap Partner assistant scheduler bearer",
  );
  eq(await jobRow(), { jobname: JOB, schedule: "*/2 * * * *", active: true, username: "postgres" });
  const job = (await db.query("select * from cron.job where jobname = $1", [JOB])).rows[0];
  eq(job.command, COMMAND, "Il comando di cron non ha bearer, URL o SQL interpolato");
  ok(!JSON.stringify(job).includes(secret), "Il segreto non sta nella riga di cron");
  eq(await shopifySyntheticJob(), before, "Accensione: il job Shopify non cambia");
  eq(await shopifySecret(), shopifyBefore, "Accensione: il segreto Shopify non cambia");
  eq(
    (await as("service_role", () => configure(secret, true, "private"))).schedule_seconds,
    120,
    "Anche la funzione private, solo per service_role",
  );

  // 7. Il giro: URL fisso, bearer letto da Vault al momento, timeout breve.
  await asPostgres(() => dispatch());
  const posted = await lastRequest();
  eq(posted.url, URL_WORKER);
  eq(posted.headers.Authorization, `Bearer ${secret}`);
  eq(posted.timeout_milliseconds, 10000);
  eq(posted.headers, { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" });
  eq(posted.body, {}, "Nessun corpo deciso da chi chiama");
  eq(posted.executed_by, "postgres");
  eq(await count("net.synthetic_requests"), 1, "Un giro, una chiamata");
  // Un segreto rovinato in Vault: il giro non chiama.
  await db.query("update vault.secrets set secret = 'corto' where name = $1", [SECRET_NAME]);
  await asPostgres(() => dispatch());
  eq(await count("net.synthetic_requests"), 1, "Segreto non valido: nessuna chiamata");
  await db.query("update vault.secrets set secret = $2 where name = $1", [SECRET_NAME, secret]);

  // 8. Rotazione, job in pausa riattivato, riprogrammazione fallita.
  eq(await asService(() => configure(rotated, true)), { enabled: true, schedule_seconds: 120 });
  eq(
    await value("select id as v from vault.secrets where name = $1", [SECRET_NAME]),
    firstSecretId,
    "La rotazione aggiorna lo stesso segreto",
  );
  eq(await count("vault.secrets"), 2, "Il segreto Shopify resta");
  eq(await count("cron.job"), 2, "Job con nome sovrascritto, non duplicato");
  eq(
    await value("select jobid as v from cron.job where jobname = $1", [JOB]),
    job.jobid,
    "Stesso job dopo la riconfigurazione",
  );
  await db.query("update cron.job set active = false where jobname = $1", [JOB]);
  // Il puntatore: il segreto è sempre lo stesso, l'ora di configurazione cambia a ogni accensione.
  const pointer = async () =>
    (
      await db.query(
        "select vault_secret_id, configured_at::text as configured_at from private.partner_assistant_scheduler_state",
      )
    ).rows[0];
  // Ora fissa nel passato: il controllo non dipende dalla risoluzione dell'orologio.
  await db.query(
    "update private.partner_assistant_scheduler_state set configured_at = '2000-01-01 00:00:00+00'",
  );
  const pointerBefore = await pointer();
  eq(await asService(() => configure(rotated, true)), { enabled: true, schedule_seconds: 120 });
  eq((await jobRow()).active, true, "Accensione esplicita: il job in pausa si riattiva");
  const pointerAfter = await pointer();
  ok(
    pointerAfter.vault_secret_id === firstSecretId &&
      pointerAfter.configured_at !== pointerBefore.configured_at,
    "Riaccensione: stesso segreto, ora di configurazione nuova",
  );
  await db.query("update private.synthetic_scheduler_switch set mode = 'fail'");
  await rejects(() => asService(() => configure(secret, true)), "P0001");
  eq(
    await value("select secret as v from vault.secrets where name = $1", [SECRET_NAME]),
    rotated,
    "Riprogrammazione fallita: la rotazione torna indietro",
  );
  eq(
    await pointer(),
    pointerAfter,
    "Riprogrammazione fallita: il puntatore resta, con la sua ora di configurazione",
  );
  eq((await jobRow()).active, true, "Riprogrammazione fallita: il job resta attivo");
  await db.query("update private.synthetic_scheduler_switch set mode = 'normal'");
  await asPostgres(() => dispatch());
  eq(
    (await lastRequest()).headers.Authorization,
    `Bearer ${rotated}`,
    "Il giro legge il segreto ruotato",
  );
  for (const boundary of ["x".repeat(32), "x".repeat(256)])
    eq(
      await asService(() => configure(boundary, true)),
      { enabled: true, schedule_seconds: 120 },
      "Segreti al limite accettati",
    );

  // 9. Spegnimento fallito a metà: tutto torna indietro.
  await db.exec(`create function private.synthetic_block_vault_delete() returns trigger language plpgsql as $$ begin
      if old.name = 'luckylap_partner_assistant_bearer' then raise exception 'synthetic Vault delete failure'; end if;
      return old; end $$;
    create trigger synthetic_block_delete before delete on vault.secrets for each row
      execute function private.synthetic_block_vault_delete();`);
  await rejects(() => asService(() => configure(null, false)), "P0001");
  eq(
    await assistantJobs(),
    [`cron:${JOB}`, "stato", `vault:${SECRET_NAME}`],
    "Spegnimento fallito: job, puntatore e segreto restano",
  );
  await db.exec(
    "drop trigger synthetic_block_delete on vault.secrets; drop function private.synthetic_block_vault_delete()",
  );

  // 10. Spegnimento: solo il job, il segreto e il puntatore dell'assistente.
  eq((await asService(() => configure(null, false))).enabled, false);
  eq(await assistantJobs(), []);
  eq(await shopifySyntheticJob(), before, "il job Shopify non cambia");
  eq(await shopifySecret(), shopifyBefore, "Spegnimento: il segreto Shopify resta");
  const requests = await count("net.synthetic_requests");
  await asPostgres(() => dispatch());
  eq(await count("net.synthetic_requests"), requests, "Spento: il giro non chiama");
  eq(
    await asService(() => configure(null, false)),
    { enabled: false, schedule_seconds: 120 },
    "Spegnere due volte non fa danni",
  );
  for (const mode of ["fail", "wrong_owner"]) {
    await db.query("update private.synthetic_scheduler_switch set mode = $1", [mode]);
    await rejects(
      () => asService(() => configure(secret, true)),
      mode === "fail" ? "P0001" : "55000",
      mode === "fail" ? undefined : "partner_assistant_scheduler_configuration_unavailable",
    );
    eq(await assistantJobs(), [], `Programmazione fallita (${mode}): niente resta`);
  }
  await db.query("update private.synthetic_scheduler_switch set mode = 'normal'");
  eq(await shopifySyntheticJob(), before, "Alla fine il job Shopify è quello della fixture");

  console.log(
    `PASS ${checks} controlli dello scheduler dell'Assistente Partner. Cron, pg_net e Vault sintetici: nessuna estensione vera, nessun orologio, nessuna consegna.`,
  );
} catch (error) {
  console.error({ message: error.message, code: error.code, position: error.position });
  process.exitCode = 1;
} finally {
  await db.close();
}
