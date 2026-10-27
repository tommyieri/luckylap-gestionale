// test-db: pglite minimo 306
// Assistente Partner, compito 1 (_assistente_partner.sql): configurazione a riga unica, regole
// versionate, interruttore per contatto, lavori, note e bozze append-only, cancellazione dei dati
// con il recapito, comandi del team, lettura dello stato e permessi. Migrazioni applicate in ordine
// su PGlite, auth.uid() definita come in produzione, permessi predefiniti di Supabase sullo schema
// public. Solo dati sintetici (domini example.test, CO da 951 in su), nessun accesso cloud.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (!process.argv[2])
  throw new Error("Passare il percorso esterno di @electric-sql/pglite/dist/index.js.");
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
// Come partner-oggi-fixes.mjs: riceve una funzione, così l'errore nasce dentro rejects.
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

const fixtureId = (n) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const founder = fixtureId(901),
  consultant = fixtureId(902),
  assistant = fixtureId(990);
const sha = (text) => createHash("sha256").update(text).digest("hex");

const migrations = new URL("../migrations/", import.meta.url);
const migration = (suffix) => {
  const names = readdirSync(migrations).filter((n) => n.endsWith(suffix));
  assert.equal(names.length, 1, `Una sola migrazione ${suffix}`);
  return readFileSync(new URL(names[0], migrations), "utf8");
};

const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const value = async (sql, args = []) => (await one(sql, args))?.v;
// Il proprietario del database: nessun ruolo client, nessun claim.
const asOwner = (sql, args) => (args ? db.query(sql, args) : db.exec(sql));

// Un ruolo client con il suo JWT, come PostgREST: claims locali e set local role.
const CLIENT_ROLES = new Set(["anon", "authenticated", "service_role"]);
async function as(role, sub, fn) {
  assert.ok(CLIENT_ROLES.has(role), `Ruolo sconosciuto: ${role}`);
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(sub ? { sub, role } : { role }),
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
const cmd = async (name, payload, op = randomUUID()) =>
  (
    await db.query(`select public.${name}($1, $2::jsonb) r`, [
      op,
      JSON.stringify({ schema_version: 1, ...payload }),
    ])
  ).rows[0].r;
const mode = (sub, payload, op) =>
  as("authenticated", sub, () => cmd("set_partner_assistant_mode", payload, op));
const rules = (sub, payload, op) =>
  as("authenticated", sub, () => cmd("save_partner_assistant_rules", payload, op));
const contact = (sub, payload, op) =>
  as("authenticated", sub, () => cmd("set_partner_assistant_contact", payload, op));
const statusAs = (sub) =>
  as(
    "authenticated",
    sub,
    async () => (await db.query("select public.read_partner_assistant_status() r")).rows[0].r,
  );

const configRow = () =>
  one("select mode, version::int as version from private.partner_assistant_config");
const config = () =>
  one(
    `select mode, version::int as version, actor_id, handoff_to, starting_credit_usd::text as credit,
       paused_reason, backoff_until, last_tick_at, updated_by from private.partner_assistant_config`,
  );
const rulesVersions = async () =>
  (await db.query("select version from public.partner_assistant_rules order by version")).rows.map(
    (r) => r.version,
  );
const job = (partnerId) =>
  one(
    `select status, step, attempts, rewrites, reason, lease_token, lease_expires_at, research_note_id,
       choice_note_id, draft_id, next_attempt_at <= now() as due from public.partner_assistant_jobs
     where partner_id = $1`,
    [partnerId],
  );
const countNotesAndDrafts = (partnerId) =>
  value(
    `select ((select count(*) from public.partner_assistant_notes where partner_id = $1)
       + (select count(*) from public.partner_assistant_drafts where partner_id = $1))::int as v`,
    [partnerId],
  );
const canWrite = (role, table) =>
  value(
    `select has_table_privilege($1, $2, 'INSERT') or has_table_privilege($1, $2, 'UPDATE')
       or has_table_privilege($1, $2, 'DELETE') or has_table_privilege($1, $2, 'TRUNCATE') as v`,
    [role, table],
  );
const canSelect = (role, table) =>
  value("select has_table_privilege($1, $2, 'SELECT') as v", [role, table]);
const canExecute = (role, signature) =>
  value("select has_function_privilege($1, $2, 'EXECUTE') as v", [role, signature]);
const assistantFunctions = async (pattern) =>
  (
    await db.query(
      `select n.nspname || '.' || p.proname as name, p.proconfig, p.prosecdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') order by 1`,
    )
  ).rows.filter((r) => pattern.test(r.name));
const searchPathEmpty = async (pattern) =>
  (await assistantFunctions(pattern)).every(
    (r) => JSON.stringify(r.proconfig) === JSON.stringify(['search_path=""']),
  );

// Schede sintetiche: CO da 951 in su, email su example.test.
let nextCo = 950;
async function partner(name) {
  const id = randomUUID();
  nextCo++;
  await asOwner(
    `insert into public.partners(id, co, name, origin, stage, created_by, sections, priority, contact_month)
     values ($1, $2, $3, 'team', 'da_contattare', $4, array['collab'], 'alta', date_trunc('month', current_date)::date)`,
    [id, nextCo, name ?? `Club sintetico ${nextCo}`, founder],
  );
  const email = `club${nextCo}@example.test`;
  const contactId = await value(
    `insert into public.partner_contacts(partner_id, kind, value, link_value, created_by, updated_by)
     values ($1, 'email', $2, $2, $3, $3) returning id as v`,
    [id, email, founder],
  );
  return { id, co: nextCo, contactId };
}
const note = (p, kind = "ricerca") =>
  value(
    `insert into public.partner_assistant_notes(partner_id, kind, content, sources, rules_version, model, operation_id, created_by)
     values ($1, $2, $3::jsonb, array['https://example.test/fonte'], 1, 'claude-opus-5-5', gen_random_uuid(), $4)
     returning id as v`,
    [p.id, kind, JSON.stringify({ text: `Nota sintetica ${kind} ${p.co}` }), assistant],
  );
const draft = (p, researchNoteId, rulesVersion = 1) => {
  const body = `Testo sintetico della bozza per il CO ${p.co}.`;
  return value(
    `insert into public.partner_assistant_drafts(partner_id, contact_id, partner_version, language, subject, body,
       signature, sha256, rules_version, research_note_id, operation_id, created_by)
     values ($1, $2, 1, 'it', $3, $4, 'Tommaso', $5, $6, $7, gen_random_uuid(), $8) returning id as v`,
    [
      p.id,
      p.contactId,
      `Oggetto sintetico ${p.co}`,
      body,
      sha(body),
      rulesVersion,
      researchNoteId,
      assistant,
    ],
  );
};
const addJob = (p, fields) =>
  asOwner(
    `insert into public.partner_assistant_jobs(partner_id, status, step, attempts, rewrites, reason,
       research_note_id, choice_note_id, draft_id, lease_token, lease_expires_at, next_attempt_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12::timestamptz, now()))`,
    [
      p.id,
      fields.status,
      fields.step,
      fields.attempts ?? 0,
      fields.rewrites ?? 0,
      fields.reason ?? null,
      fields.research_note_id ?? null,
      fields.choice_note_id ?? null,
      fields.draft_id ?? null,
      fields.lease_token ?? null,
      fields.lease_expires_at ?? null,
      fields.next_attempt_at ?? null,
    ],
  );
const requeued = (step) => ({
  status: "in_coda",
  step,
  attempts: 0,
  rewrites: 0,
  reason: null,
  lease_token: null,
  lease_expires_at: null,
  due: true,
});
const pick = (object, keys) => Object.fromEntries(keys.map((key) => [key, object[key]]));
const REQUEUE_KEYS = Object.keys(requeued("ricerca"));

const PUBLIC_TABLES = [
  "public.partner_assistant_rules",
  "public.partner_assistant_contacts",
  "public.partner_assistant_jobs",
  "public.partner_assistant_notes",
  "public.partner_assistant_drafts",
];
const PRIVATE_TABLES = [
  "private.partner_assistant_config",
  "private.partner_assistant_runs",
  "private.partner_assistant_events",
  "private.partner_assistant_receipts",
];
// Le sole funzioni che un membro esegue: tre comandi e la lettura, private e wrapper.
const MEMBER_FUNCTIONS = [
  "private.set_partner_assistant_mode(uuid,jsonb)",
  "public.set_partner_assistant_mode(uuid,jsonb)",
  "private.set_partner_assistant_contact(uuid,jsonb)",
  "public.set_partner_assistant_contact(uuid,jsonb)",
  "private.save_partner_assistant_rules(uuid,jsonb)",
  "public.save_partner_assistant_rules(uuid,jsonb)",
  "private.read_partner_assistant_status()",
  "public.read_partner_assistant_status()",
];
const INTERNAL_FUNCTIONS = [
  "private.partner_assistant_begin(uuid,text,uuid,jsonb)",
  "private.partner_assistant_finish(uuid,text,uuid,jsonb,jsonb)",
  "private.partner_assistant_append_only()",
  "private.partner_assistant_erase(uuid)",
  "private.partner_assistant_contact_erased()",
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
  for (const suffix of [
    "_initial_schema.sql",
    "_sales_ecosystem.sql",
    "_brand_assets_and_development.sql",
    "_partner_module.sql",
    "_partner_work_links.sql",
    "_partner_dates_only_agreed.sql",
    "_partner_oggi_fixes.sql",
  ])
    await db.exec(migration(suffix));
  for (const [id, name, role] of [
    [founder, "Fondatore sintetico", "founder"],
    [consultant, "Consulente sintetico", "consultant"],
    [assistant, "Assistente", null],
  ]) {
    await asOwner("insert into auth.users values ($1)", [id]);
    await asOwner("insert into public.profiles(user_id, display_name) values ($1, $2)", [id, name]);
    if (role)
      await asOwner("insert into public.memberships(user_id, role) values ($1, $2)", [id, role]);
  }
  const p951 = await partner("Club sintetico 951");

  // 1. La migrazione: transazione unica, nessuna estensione, riga di configurazione e regole v1.
  const sql = migration("_assistente_partner.sql");
  ok(/^begin;$/m.test(sql) && /^commit;\s*$/m.test(sql), "Migrazione tra begin e commit");
  eq(/create\s+extension/i.test(sql), false, "Nessuna estensione nuova");
  await db.exec(sql);
  eq(await configRow(), { mode: "spento", version: 1 });
  eq(
    pick(await config(), ["actor_id", "handoff_to", "credit", "paused_reason", "backoff_until"]),
    { actor_id: null, handoff_to: null, credit: null, paused_reason: null, backoff_until: null },
    "Configurazione nuova: niente profili, credito o pausa",
  );
  await rejects(
    () => asOwner("insert into private.partner_assistant_config(singleton) values (false)"),
    "23514",
  );
  await rejects(
    () => asOwner("insert into private.partner_assistant_config default values"),
    "23505",
  );
  eq(await rulesVersions(), [1]);
  const rulesV1 = await one(
    "select body, created_by from public.partner_assistant_rules where version = 1",
  );
  eq(rulesV1.created_by, null, "Regole v1: scritte dalla migrazione");
  ok(
    rulesV1.body.startsWith(
      "# Regole dell'assistente Partner, versione 1\n\nScrivi a nome di Tommaso, fondatore di LuckyLap.",
    ),
    "Regole v1: inizio dell'Appendice A",
  );
  ok(
    rulesV1.body.endsWith("Herzlichen Dank für Ihre Zeit.\nFreundliche Grüße"),
    "Regole v1: fine dell'Appendice A, senza a capo",
  );
  ok(rulesV1.body.includes("\n## Mai\n- Conto vendita, in nessuna lingua.\n"), "Regole v1: «Mai»");
  await rejects(
    () =>
      asOwner(
        "insert into public.partner_assistant_rules(version, body) values (99, 'Senza autore')",
      ),
    "23514",
  );

  // 2. Modalità: prova e invio solo al founder e non in questa consegna; prepara solo configurato.
  await rejects(
    () => mode(consultant, { mode: "invio", expected_version: 1 }),
    "42501",
    "partner_assistant_founder_required",
  );
  await rejects(
    () => mode(founder, { mode: "invio", expected_version: 1 }),
    "22023",
    "partner_assistant_mode_unavailable",
  );
  await rejects(
    () => mode(founder, { mode: "prova", expected_version: 1 }),
    "22023",
    "partner_assistant_mode_unavailable",
  );
  await rejects(
    () => mode(consultant, { mode: "prepara", expected_version: 1 }),
    "55000",
    "partner_assistant_not_configured",
  );
  await asOwner(
    `update private.partner_assistant_config set actor_id = '${assistant}', handoff_to = '${founder}'`,
  );
  eq((await configRow()).version, 1, "La configurazione del proprietario non cambia la versione");
  const op1 = randomUUID();
  const first = await mode(
    consultant,
    { mode: "prepara", expected_version: 1, starting_credit_usd: 92.05 },
    op1,
  );
  eq(first.version, 2);
  eq(Object.keys(first).sort(), ["id", "mode", "replayed", "version"]);
  eq(pick(first, ["mode", "replayed"]), { mode: "prepara", replayed: false });
  eq(first.id, await value("select id as v from private.partner_assistant_config"));
  const replay = await mode(
    consultant,
    { mode: "prepara", expected_version: 1, starting_credit_usd: 92.05 },
    op1,
  );
  eq(replay.replayed, true);
  eq(replay, { ...first, replayed: true }, "Ripetizione: stesso risultato");
  eq((await configRow()).version, 2, "La ripetizione non cambia niente");
  eq(
    pick(await config(), ["credit", "updated_by"]),
    { credit: "92.05", updated_by: consultant },
    "Credito di partenza e autore",
  );
  eq(
    (await mode(consultant, { mode: "spento", expected_version: 1 })).mode,
    "spento",
    "spento vince anche con versione vecchia",
  );
  eq(await configRow(), { mode: "spento", version: 3 });
  await rejects(
    () => mode(founder, { mode: "prepara", expected_version: 1, starting_credit_usd: 92.05 }, op1),
    "23505",
    "partner_idempotency_conflict",
  );
  await rejects(
    () => mode(consultant, { mode: "spento", expected_version: 1 }, op1),
    "23505",
    "partner_idempotency_conflict",
  );
  // Le scritture del worker non cambiano la versione; tornare a prepara toglie pausa e attesa.
  await asOwner(
    `update private.partner_assistant_config set last_tick_at = now(), paused_reason = 'credito',
       backoff_until = now() + interval '1 hour'`,
  );
  eq((await configRow()).version, 3, "Ultimo giro, pausa e attesa: versione invariata");
  await rejects(
    () => mode(founder, { mode: "prepara", expected_version: 2 }),
    "40001",
    "partner_changed",
  );
  eq((await mode(founder, { mode: "prepara", expected_version: 3 })).version, 4);
  const resumed = await config();
  eq(
    pick(resumed, ["mode", "credit", "paused_reason", "backoff_until", "updated_by"]),
    {
      mode: "prepara",
      credit: "92.05",
      paused_reason: null,
      backoff_until: null,
      updated_by: founder,
    },
    "prepara: pausa e attesa azzerate, credito invariato",
  );
  ok(resumed.last_tick_at, "prepara: l'ultimo giro resta");
  for (const credit of [10000.01, 1.234, -1, "92.05", true])
    await rejects(
      () => mode(founder, { mode: "prepara", expected_version: 4, starting_credit_usd: credit }),
      "22023",
      "invalid_partner_payload",
    );
  for (const payload of [
    { mode: "acceso", expected_version: 4 },
    { mode: "prepara" },
    { mode: "prepara", expected_version: "4" },
    { mode: "prepara", expected_version: 4, actor_id: assistant },
  ])
    await rejects(() => mode(founder, payload), "22023", "invalid_partner_payload");
  await rejects(
    () => mode(assistant, { mode: "spento", expected_version: 4 }),
    "42501",
    "partner_access_required",
  );
  eq(
    (await mode(founder, { mode: "prepara", expected_version: 4, starting_credit_usd: 10000 }))
      .version,
    5,
  );
  eq((await config()).credit, "10000.00");
  eq(
    (await mode(consultant, { mode: "spento", expected_version: 5, starting_credit_usd: 0 }))
      .version,
    6,
  );
  eq((await config()).credit, "0.00");
  await asOwner("update private.partner_assistant_config set handoff_to = null");
  await rejects(
    () => mode(consultant, { mode: "prepara", expected_version: 6 }),
    "55000",
    "partner_assistant_not_configured",
  );
  eq((await mode(consultant, { mode: "spento", expected_version: 6 })).version, 7);
  await asOwner(`update private.partner_assistant_config set handoff_to = '${founder}'`);
  eq(await configRow(), { mode: "spento", version: 7 });

  // 3. Regole: versione nuova solo sulla più alta; le bozze con regole vecchie tornano in scrittura.
  const p952 = await partner();
  const p953 = await partner();
  const p954 = await partner();
  const p955 = await partner();
  const p956 = await partner();
  const p957 = await partner();
  const p958 = await partner();
  const n954 = await note(p954);
  await addJob(p954, {
    status: "pronta",
    step: "controllo",
    attempts: 1,
    rewrites: 1,
    research_note_id: n954,
    draft_id: await draft(p954, n954),
  });
  const n955 = await note(p955);
  const d955 = await draft(p955, n955);
  await addJob(p955, {
    status: "in_coda",
    step: "controllo",
    attempts: 2,
    research_note_id: n955,
    draft_id: d955,
    lease_token: randomUUID(),
    lease_expires_at: new Date(Date.now() + 120000).toISOString(),
  });
  await addJob(p956, { status: "in_coda", step: "scrittura", attempts: 1 });
  const n957 = await note(p957);
  await addJob(p957, {
    status: "serve_tommaso",
    step: "controllo",
    attempts: 3,
    rewrites: 1,
    reason: "seconda_lettura",
    research_note_id: n957,
    draft_id: await draft(p957, n957),
  });
  await addJob(p958, {
    status: "attesa",
    step: "ricerca",
    next_attempt_at: new Date(Date.now() + 86400000).toISOString(),
  });
  const untouched = async () => [await job(p956.id), await job(p957.id), await job(p958.id)];
  const untouchedBefore = await untouched();
  await rejects(
    () => rules(founder, { body: "x", expected_version: 2 }),
    "40001",
    "partner_changed",
  );
  const opRules = randomUUID();
  const v2 = await rules(founder, { body: "Regole v2", expected_version: 1 }, opRules);
  eq(v2.version, 2);
  eq(Object.keys(v2).sort(), ["id", "replayed", "requeued", "version"]);
  eq(pick(v2, ["requeued", "replayed"]), { requeued: 2, replayed: false });
  eq(
    await one("select id, body, created_by from public.partner_assistant_rules where version = 2"),
    { id: v2.id, body: "Regole v2", created_by: founder },
  );
  eq(pick(await job(p954.id), REQUEUE_KEYS), requeued("scrittura"), "Bozza pronta: riscrittura");
  eq(
    pick(await job(p955.id), REQUEUE_KEYS),
    requeued("scrittura"),
    "In seconda lettura: riscrittura, lease rilasciata",
  );
  eq((await job(p955.id)).draft_id, d955, "La bozza vecchia resta nel registro");
  eq(await untouched(), untouchedBefore, "Scrittura, Serve Tommi e attesa: invariati");
  eq(
    await rules(founder, { body: "Regole v2", expected_version: 1 }, opRules),
    { ...v2, replayed: true },
    "Ripetizione delle regole",
  );
  eq(await rulesVersions(), [1, 2]);
  for (const body of ["", "   ", "y".repeat(100001)])
    await rejects(
      () => rules(founder, { body, expected_version: 2 }),
      "22023",
      "invalid_partner_payload",
    );
  await rejects(
    () => rules(assistant, { body: "Regole dell'assistente", expected_version: 2 }),
    "42501",
    "partner_access_required",
  );
  const v3 = await rules(consultant, { body: "Regole v3 dal team", expected_version: 2 });
  eq(pick(v3, ["version", "requeued"]), { version: 3, requeued: 0 }, "Anche il team le cambia");
  eq(await rulesVersions(), [1, 2, 3]);

  // 4. Interruttore per contatto.
  const stopped = await contact(consultant, { partner_id: p951.id, active: false });
  eq(stopped.partner_id, p951.id);
  eq(Object.keys(stopped).sort(), ["id", "partner_id", "replayed", "version"]);
  eq(pick(stopped, ["version", "replayed"]), { version: 1, replayed: false });
  eq((await statusAs(consultant)).counts.ferma, 1);
  const restarted = await contact(consultant, {
    partner_id: p951.id,
    active: true,
    reason: "  Ripreso dal team  ",
  });
  eq(pick(restarted, ["id", "version"]), { id: stopped.id, version: 2 }, "Upsert: versione + 1");
  eq(
    await one(
      "select active, reason, updated_by from public.partner_assistant_contacts where partner_id = $1",
      [p951.id],
    ),
    { active: true, reason: "Ripreso dal team", updated_by: consultant },
  );
  eq((await statusAs(consultant)).counts.ferma, 0);
  const n952old = await note(p952);
  await addJob(p952, {
    status: "serve_tommaso",
    step: "controllo",
    attempts: 3,
    rewrites: 1,
    reason: "troppi_tentativi",
    research_note_id: n952old,
    choice_note_id: await note(p952, "scelta"),
    draft_id: await draft(p952, n952old),
    next_attempt_at: new Date(Date.now() + 3600000).toISOString(),
  });
  await addJob(p953, {
    status: "serve_tommaso",
    step: "ricerca",
    attempts: 3,
    reason: "fuso_mancante",
  });
  eq((await contact(founder, { partner_id: p952.id, active: true })).version, 1);
  eq(
    pick(await job(p952.id), REQUEUE_KEYS),
    requeued("ricerca"),
    "Serve Tommi: il contatto torna all'assistente",
  );
  eq(
    pick(await job(p952.id), ["research_note_id", "choice_note_id", "draft_id"]),
    { research_note_id: null, choice_note_id: null, draft_id: null },
    "Riattivato: ricerca, scelta e bozza vecchie non sono più del lavoro",
  );
  await contact(founder, { partner_id: p953.id, active: false, reason: "Rapporto già in corso" });
  eq(
    pick(await job(p953.id), ["status", "reason"]),
    { status: "serve_tommaso", reason: "fuso_mancante" },
    "Fermarlo non tocca il lavoro",
  );
  await rejects(
    () => contact(consultant, { partner_id: randomUUID(), active: false }),
    "22023",
    "partner_not_found",
  );
  for (const payload of [
    { partner_id: p951.id, active: false, reason: "r".repeat(241) },
    { partner_id: p951.id },
    { partner_id: p951.id, active: "no" },
    { partner_id: "951", active: false },
    { partner_id: p951.id, active: false, version: 3 },
  ])
    await rejects(() => contact(consultant, payload), "22023", "invalid_partner_payload");
  await rejects(
    () => contact(assistant, { partner_id: p951.id, active: false }),
    "42501",
    "partner_access_required",
  );
  const audits = (
    await db.query(
      "select actor_id, old_data, new_data from public.audit_logs where table_name = 'partner_assistant_contacts' order by occurred_at, id",
    )
  ).rows;
  eq(audits.length, 4, "Una riga di audit per scrittura");
  eq(
    [
      ...new Set(
        audits.flatMap((a) => [...Object.keys(a.old_data ?? {}), ...Object.keys(a.new_data)]),
      ),
    ].sort(),
    ["_changed", "active", "partner_id", "version"],
    "Audit senza motivo né testi",
  );
  eq(
    audits.map((a) => a.actor_id).sort(),
    [consultant, consultant, founder, founder].sort(),
    "Audit con l'autore del comando",
  );

  // 5. Stato: chiavi esatte, spesa sul giorno di Roma, coda, da rivedere, ultimi eventi.
  await asOwner(
    `insert into private.partner_assistant_runs(operation_id, partner_id, step, model, input_tokens, output_tokens, web_searches, cost_usd, outcome, created_at)
     values (gen_random_uuid(), $1, 'ricerca', 'claude-opus-5-5', 1000, 200, 3, 1.25, 'ok', now()),
            (gen_random_uuid(), $1, 'estrazione', 'claude-opus-5-5', 500, 100, 0, 0.5, 'ok', now()),
            (gen_random_uuid(), null, 'ricerca', 'claude-opus-5-5', 900, 300, 2, 2, 'ok', now() - interval '3 days')`,
    [p951.id],
  );
  for (let i = 1; i <= 12; i++)
    await asOwner(
      `insert into private.partner_assistant_events(partner_id, step, outcome, created_at)
       values ($1, $2, $3, now() - $4::int * interval '1 minute')`,
      [i === 2 ? null : p951.id, i === 2 ? null : "ricerca", `evento_${i}`, i],
    );
  const status = await statusAs(consultant);
  eq(Object.keys(status).sort(), [
    "backoff_until",
    "configured",
    "counts",
    "last_events",
    "last_tick_at",
    "mode",
    "paused_reason",
    "spent_today_usd",
    "spent_usd",
    "starting_credit_usd",
    "to_review",
    "version",
  ]);
  eq(
    pick(status, [
      "mode",
      "configured",
      "paused_reason",
      "backoff_until",
      "version",
      "starting_credit_usd",
      "spent_usd",
      "spent_today_usd",
    ]),
    {
      mode: "spento",
      configured: true,
      paused_reason: null,
      backoff_until: null,
      version: 7,
      starting_credit_usd: 0,
      spent_usd: 3.75,
      spent_today_usd: 1.75,
    },
  );
  ok(typeof status.last_tick_at === "string", "Ultimo giro come data");
  eq(status.counts, { in_coda: 4, attesa: 1, pronta: 0, serve_tommaso: 2, ferma: 1 });
  eq(
    status.to_review.map((r) => Object.keys(r).sort()),
    [
      ["co", "name", "reason", "updated_at"],
      ["co", "name", "reason", "updated_at"],
    ],
  );
  eq(
    status.to_review.map((r) => pick(r, ["co", "name", "reason"])).sort((a, b) => a.co - b.co),
    [
      { co: p953.co, name: `Club sintetico ${p953.co}`, reason: "fuso_mancante" },
      { co: p957.co, name: `Club sintetico ${p957.co}`, reason: "seconda_lettura" },
    ],
  );
  eq(status.last_events.length, 10, "Ultimi dieci eventi");
  eq(Object.keys(status.last_events[0]).sort(), ["co", "created_at", "outcome", "step"]);
  eq(
    status.last_events.map((e) => e.outcome),
    Array.from({ length: 10 }, (_, i) => `evento_${i + 1}`),
    "Dal più recente",
  );
  eq(pick(status.last_events[0], ["co", "step"]), { co: p951.co, step: "ricerca" });
  eq(pick(status.last_events[1], ["co", "step"]), { co: null, step: null }, "Evento senza scheda");
  await asOwner(
    `with p as (
       insert into public.partners(id, co, name, origin, stage, created_by, sections, priority, contact_month)
       select gen_random_uuid(), 1000 + g, 'Rivista sintetica ' || g, 'team', 'da_contattare', $1,
         array['collab'], 'media', date_trunc('month', current_date)::date
       from generate_series(1, 52) g returning id, co)
     insert into public.partner_assistant_jobs(partner_id, status, step, attempts, reason, updated_at)
     select id, 'serve_tommaso', 'ricerca', 3, 'troppi_tentativi', now() - (co - 1000) * interval '1 minute' from p`,
    [founder],
  );
  const crowded = await statusAs(founder);
  eq(crowded.counts.serve_tommaso, 54);
  eq(crowded.to_review.length, 50, "Al massimo 50 da rivedere");
  eq(
    crowded.to_review.slice(0, 2).map((r) => r.co),
    [1052, 1051],
    "Da rivedere: chi aspetta da più tempo per primo",
  );
  await rejects(() => statusAs(assistant), "42501", "partner_access_required");

  // 6. Append-only: regole, note e bozze non si correggono e non si cancellano.
  await rejects(() => asOwner("update public.partner_assistant_rules set body = 'y'"), "42501");
  await rejects(
    () => asOwner("delete from public.partner_assistant_rules where version = 3"),
    "42501",
  );
  await rejects(
    () =>
      asOwner("update public.partner_assistant_notes set model = 'altro' where id = $1", [n954]),
    "42501",
  );
  await rejects(
    () =>
      asOwner("delete from public.partner_assistant_drafts where research_note_id = $1", [n954]),
    "42501",
  );
  // Il flag della cancellazione apre solo i DELETE, mai le correzioni.
  const withEraseFlag = async (fn) => {
    await db.exec("begin");
    try {
      await asOwner("select set_config('luckylap.partner_assistant.erase', 'on', true)");
      return await fn();
    } finally {
      await db.exec("rollback");
    }
  };
  await withEraseFlag(() =>
    rejects(
      () =>
        asOwner("update public.partner_assistant_notes set model = 'altro' where id = $1", [n954]),
      "42501",
    ),
  );
  eq(
    await withEraseFlag(
      async () =>
        (
          await asOwner("delete from public.partner_assistant_drafts where research_note_id = $1", [
            n954,
          ])
        ).affectedRows,
    ),
    1,
    "Con il flag acceso la bozza si cancella",
  );
  // Le ricevute dei comandi sono append-only come quelle dei comandi Partner, flag compreso.
  ok(
    (await value("select count(*)::int as v from private.partner_assistant_receipts")) > 0,
    "Ricevute presenti",
  );
  await rejects(
    () => asOwner("update private.partner_assistant_receipts set result = '{}'::jsonb"),
    "42501",
  );
  await rejects(() => asOwner("delete from private.partner_assistant_receipts"), "42501");
  await withEraseFlag(() =>
    rejects(() => asOwner("delete from private.partner_assistant_receipts"), "42501"),
  );

  // 7. Cancellazione definitiva del recapito: note e bozze del contatto spariscono, il lavoro riparte.
  const n951 = await note(p951);
  const c951 = await note(p951, "scelta");
  const d951 = await draft(p951, n951);
  await addJob(p951, {
    status: "pronta",
    step: "controllo",
    attempts: 2,
    rewrites: 1,
    research_note_id: n951,
    choice_note_id: c951,
    draft_id: d951,
    lease_token: randomUUID(),
    lease_expires_at: new Date(Date.now() + 60000).toISOString(),
  });
  const n952 = await note(p952);
  await draft(p952, n952);
  eq(await countNotesAndDrafts(p951.id), 3);
  const eraseSql = `update public.partner_contacts set value = null, link_value = null, label = '',
      research_value = null, active = false, erased_at = now(), erased_by = '${founder}',
      version = version + 1 where id = $1`;
  const eraseContactOf951 = () => asOwner(eraseSql, [p951.contactId]);
  await eraseContactOf951();
  eq(await countNotesAndDrafts(p951.id), 0);
  eq((await job(p951.id)).step, "ricerca");
  eq(
    pick(await job(p951.id), [...REQUEUE_KEYS, "research_note_id", "choice_note_id", "draft_id"]),
    { ...requeued("ricerca"), research_note_id: null, choice_note_id: null, draft_id: null },
    "Lavoro di nuovo in coda, senza riferimenti",
  );
  eq(await countNotesAndDrafts(p952.id), 5, "Gli altri contatti non cambiano");
  ok(
    (await value("select current_setting('luckylap.partner_assistant.erase', true) as v")) !== "on",
    "Il flag non resta acceso",
  );
  // Nello stesso giro, dopo la cancellazione, il registro resta append-only.
  await db.exec("begin");
  try {
    await asOwner(eraseSql, [p953.contactId]);
    ok(
      (await value("select current_setting('luckylap.partner_assistant.erase', true) as v")) !==
        "on",
      "Flag spento subito dopo la cancellazione",
    );
    await rejects(
      () => asOwner("delete from public.partner_assistant_notes where partner_id = $1", [p952.id]),
      "42501",
    );
  } finally {
    await db.exec("rollback");
  }
  // Toccare il recapito senza cancellarlo non cancella niente.
  await note(p953);
  await asOwner("update public.partner_contacts set label = 'Segreteria' where id = $1", [
    p953.contactId,
  ]);
  await as("authenticated", founder, () =>
    cmd("remove_partner_contact", {
      contact_id: p953.contactId,
      expected_version: 1,
      erase: false,
    }),
  );
  eq(await countNotesAndDrafts(p953.id), 1, "Recapito disattivato: la nota resta");
  // Con il comando del team: stessa cancellazione.
  await as("authenticated", consultant, () =>
    cmd("remove_partner_contact", {
      contact_id: p952.contactId,
      expected_version: 1,
      erase: true,
    }),
  );
  eq(await countNotesAndDrafts(p952.id), 0, "remove_partner_contact con erase: note e bozze via");
  eq(pick(await job(p952.id), REQUEUE_KEYS), requeued("ricerca"));

  // 8. Permessi: nessun ruolo client scrive, solo i membri leggono, funzioni interne chiuse.
  for (const t of PUBLIC_TABLES)
    for (const role of ["anon", "authenticated", "service_role"])
      eq(await canWrite(role, t), false, `${role} non scrive ${t}`);
  eq(await canSelect("anon", "public.partner_assistant_drafts"), false);
  for (const t of PUBLIC_TABLES) {
    eq(await canSelect("anon", t), false, `anon non legge ${t}`);
    eq(await canSelect("service_role", t), false, `service_role non legge ${t}`);
    eq(await canSelect("authenticated", t), true, `authenticated legge ${t}`);
    eq(
      await value("select relrowsecurity as v from pg_class where oid = $1::regclass", [t]),
      true,
      `RLS su ${t}`,
    );
  }
  for (const t of PRIVATE_TABLES)
    for (const role of ["anon", "authenticated", "service_role"]) {
      eq(await canSelect(role, t), false, `${role} non legge ${t}`);
      eq(await canWrite(role, t), false, `${role} non scrive ${t}`);
    }
  const countRules = () => value("select count(*)::int as v from public.partner_assistant_rules");
  eq(await as("authenticated", consultant, countRules), 3, "Il membro legge le regole");
  eq(await as("authenticated", assistant, countRules), 0, "Senza membership: nessuna riga");
  await rejects(
    () =>
      as("authenticated", consultant, () =>
        db.query(
          "insert into public.partner_assistant_rules(version, body, created_by) values (4, 'z', $1)",
          [consultant],
        ),
      ),
    "42501",
  );
  eq(
    await canExecute("authenticated", "private.partner_assistant_begin(uuid,text,uuid,jsonb)"),
    false,
  );
  for (const signature of [...MEMBER_FUNCTIONS, ...INTERNAL_FUNCTIONS]) {
    eq(
      await canExecute("authenticated", signature),
      MEMBER_FUNCTIONS.includes(signature),
      `authenticated su ${signature}`,
    );
    eq(await canExecute("anon", signature), false, `anon su ${signature}`);
    eq(await canExecute("service_role", signature), false, `service_role su ${signature}`);
  }
  const functions = await assistantFunctions(/partner_assistant/);
  eq(
    functions.map((f) => f.name).sort(),
    [...MEMBER_FUNCTIONS, ...INTERNAL_FUNCTIONS].map((s) => s.replace(/\(.*$/, "")).sort(),
    "Nessuna funzione in più",
  );
  eq(await searchPathEmpty(/partner_assistant/), true);
  eq(
    functions
      .filter((f) => f.prosecdef)
      .map((f) => f.name)
      .sort(),
    [
      "private.partner_assistant_begin",
      "private.partner_assistant_contact_erased",
      "private.partner_assistant_erase",
      "private.partner_assistant_finish",
      "private.read_partner_assistant_status",
      "private.save_partner_assistant_rules",
      "private.set_partner_assistant_contact",
      "private.set_partner_assistant_mode",
    ],
    "Security definer solo nelle funzioni private che scrivono o leggono le tabelle private",
  );
  console.log(`PASS ${checks} Assistente Partner synthetic checks passed.`);
} catch (error) {
  console.error(
    JSON.stringify({
      message: error.message,
      code: error.code,
      detail: error.detail,
      where: error.where,
      query: error.query,
      stack: error.stack?.split("\n").slice(0, 4).join(" | "),
    }),
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
