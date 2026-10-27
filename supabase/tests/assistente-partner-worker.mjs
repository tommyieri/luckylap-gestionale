// test-db: pglite minimo 530
// Assistente Partner, compito 2 (_assistente_partner_worker.sql): coda dei contatti idonei, giri del
// worker con lease, contesto, checkpoint, costi, avanzamento dei passi, tentativi, pausa e permessi.
// Migrazioni applicate in ordine su PGlite, auth.uid() definita come in produzione, permessi
// predefiniti di Supabase sullo schema public. Le RPC si chiamano come service_role, con il JWT di
// PostgREST (claims locali e set local role). Solo dati sintetici (schede 951-970 di
// fixtures/partner-assistant/coda.json, domini example.test), nessun accesso cloud.
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
  formerFounder = fixtureId(903),
  assistant = fixtureId(990);
const PEOPLE = { founder, consultant };
const sha = (text) => createHash("sha256").update(text).digest("hex");
const MODEL = "claude-opus-5-5";

const migrations = new URL("../migrations/", import.meta.url);
const migration = (suffix) => {
  const names = readdirSync(migrations).filter((n) => n.endsWith(suffix));
  assert.equal(names.length, 1, `Una sola migrazione ${suffix}`);
  return readFileSync(new URL(names[0], migrations), "utf8");
};
const fixture = JSON.parse(
  readFileSync(new URL("fixtures/partner-assistant/coda.json", import.meta.url), "utf8"),
);

const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const value = async (sql, args = []) => (await one(sql, args))?.v;
// Il proprietario del database: nessun ruolo client, nessun claim.
const asOwner = (sql, args) => (args ? db.query(sql, args) : db.exec(sql));

// Un ruolo client con il suo JWT, come PostgREST: claims locali e set local role. Dentro una
// transazione già aperta con lo stesso ruolo (uidInside) la funzione gira nella stessa transazione.
const CLIENT_ROLES = new Set(["anon", "authenticated", "service_role"]);
let openRole = null;
async function as(role, sub, fn) {
  assert.ok(CLIENT_ROLES.has(role), `Ruolo sconosciuto: ${role}`);
  if (openRole) {
    assert.equal(role, openRole, "Transazione già aperta con un altro ruolo");
    return fn();
  }
  openRole = role;
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
  } finally {
    openRole = null;
  }
}
const asService = (fn) => as("service_role", null, fn);
const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r;
const teamCommand = (sub, name, payload) =>
  as("authenticated", sub, () =>
    rpc(`select public.${name}($1, $2::jsonb) r`, [
      randomUUID(),
      JSON.stringify({ schema_version: 1, ...payload }),
    ]),
  );

// RPC del worker.
const WORKER = randomUUID();
const configure = (actor, handoff) =>
  rpc("select public.configure_partner_assistant($1, $2) r", [actor, handoff]);
const claim = () =>
  asService(() => rpc("select public.claim_partner_assistant_step($1, $2) r", [WORKER, 360]));
const context = (j) =>
  asService(() =>
    rpc("select public.context_partner_assistant_step($1, $2) r", [j.job_id, j.lease_token]),
  );
const checkpoint = (j) =>
  asService(() =>
    rpc("select public.checkpoint_partner_assistant_step($1, $2) r", [j.job_id, j.lease_token]),
  );
const fail = (j, kind, reason) =>
  asService(() =>
    rpc("select public.fail_partner_assistant_step($1, $2, $3, $4) r", [
      j.job_id,
      j.lease_token,
      kind,
      reason,
    ]),
  );
const pause = (reason) =>
  asService(() => rpc("select public.pause_partner_assistant($1) r", [reason]));
const record = (payload, op = randomUUID()) =>
  asService(() =>
    rpc("select public.record_partner_assistant_call($1, $2::jsonb) r", [
      op,
      JSON.stringify({ schema_version: 1, ...payload }),
    ]),
  );
// Un nuovo invio dello stesso passo con la stessa lease riusa l'operazione, come farebbe il worker.
const operations = new Map();
const operationOf = (j, kind) => {
  const key = `${kind}:${j.job_id}:${j.lease_token}`;
  if (!operations.has(key)) operations.set(key, randomUUID());
  return operations.get(key);
};
const complete = (kind, j, fields, op = operationOf(j, kind)) =>
  asService(() =>
    rpc(`select public.complete_partner_assistant_${kind}($1, $2::jsonb) r`, [
      op,
      JSON.stringify({
        schema_version: 1,
        job_id: j.job_id,
        lease_token: j.lease_token,
        ...fields,
      }),
    ]),
  );
const research = {
  text: "Ricerca sintetica: sito, social e un raduno sintetico di ottobre.",
  sources: ["https://club.example.test/notizie", "https://club.example.test/raduno"],
  model: MODEL,
  rules_version: 1,
};
const completeResearch = (j, fields = research, op) => complete("research", j, fields, op);
// Appendice C più la richiesta.
const choiceOf = (overrides = {}) => ({
  contact_kind: "club",
  porsche_community: false,
  reason_it: "Club: si propone di parlare di un progetto futuro.",
  write_now: true,
  write_on: "",
  recipient_email: "",
  recipient_email_source: "",
  recipient_email_published_by_org: false,
  person_name: "",
  person_title: "",
  language: "en",
  register: "you",
  swiss: false,
  timezone: "Europe/London",
  fact_text: "Raduno sintetico di ottobre.",
  fact_date: "2026-10-01",
  fact_source: "https://club.example.test/raduno",
  event_name: "",
  event_starts_on: "",
  event_city: "",
  event_country: "",
  event_reachable: false,
  notes_it: "",
  request: "progetto_futuro",
  ...overrides,
});
const decided = (decision, choice = choiceOf()) => ({
  choice,
  decision,
  model: MODEL,
  rules_version: 1,
});
const scrivi = decided({ kind: "scrivi" });
const completeChoice = (j, fields = scrivi, op) => complete("choice", j, fields, op);
const SIGNATURE = "Tommaso\nFounder, LuckyLap\nluckylap.com | Instagram @lucky.lap";
let drafts = 0;
// Bozza costruita dal contesto, come il worker: recapito e versione della scheda del contesto.
const draftFields = (ctx, { checks_ok = true, failures, ...draft } = {}) => {
  drafts++;
  const subject = `LuckyLap e ${ctx.partner.name}`;
  const body = `Testo sintetico numero ${drafts} per il CO ${ctx.partner.co}.`;
  return {
    draft: {
      language: "en",
      subject,
      body,
      signature: SIGNATURE,
      sha256: sha(`${subject}\n\n${body}\n\n${SIGNATURE}`),
      rules_version: ctx.rules.version,
      partner_version: ctx.partner.version,
      contact_id: ctx.email.contact_id,
      ...draft,
    },
    checks_ok,
    failures: failures ?? (checks_ok ? [] : ["parola_vietata"]),
  };
};
const completeDraft = async (j, options, op) =>
  complete("draft", j, draftFields(await context(j), options), op);
// Seconda lettura: impronta e regole dal contesto, salvo quando il test le passa (lease già persa).
const reviewFields = (ctx, { approved, problems, sha256, rules_version } = {}) => ({
  approved,
  problems: problems ?? (approved ? [] : ["Il complimento iniziale è troppo generico."]),
  sha256: sha256 ?? ctx.draft.sha256,
  model: MODEL,
  rules_version: rules_version ?? ctx.rules.version,
});
const completeReview = async (j, options = {}, op) =>
  complete(
    "review",
    j,
    reviewFields(options.sha256 && options.rules_version ? null : await context(j), options),
    op,
  );

// Schede della coda.
const ids = new Map();
const id = (co) => {
  assert.ok(ids.has(co), `CO ${co} non nella fixture`);
  return ids.get(co);
};
const coOf = (partnerId) => [...ids].find(([, v]) => v === partnerId)?.[0];
const job = (co) =>
  one(
    `select id, status, step, attempts, rewrites, reason, write_on::text as write_on, lease_token,
       lease_expires_at, research_note_id, choice_note_id, draft_id, next_attempt_at <= now() as due,
       next_attempt_at > now() + interval '9 minutes' as waits
     from public.partner_assistant_jobs where partner_id = $1`,
    [id(co)],
  );
const configRow = () =>
  one(
    `select mode, actor_id, handoff_to, paused_reason, backoff_until > now() + interval '9 minutes' as waits,
       last_tick_at, version::int as version from private.partner_assistant_config`,
  );
const queue = async (day) =>
  (await db.query("select co from private.partner_assistant_queue($1)", [day])).rows.map(
    (r) => r.co,
  );
const notes = async (co, kind) =>
  (
    await db.query(
      `select id, content, sources, rules_version, model, created_by from public.partner_assistant_notes
        where partner_id = $1 and kind = $2 order by created_at, id`,
      [id(co), kind],
    )
  ).rows;
const outcomes = async (co) =>
  (
    await db.query(
      `select step, outcome from private.partner_assistant_events where partner_id = $1
        order by created_at, id`,
      [id(co)],
    )
  ).rows.map((r) => `${r.step}:${r.outcome}`);
const activeLeases = () =>
  value(
    "select count(*)::int as v from public.partner_assistant_jobs where lease_expires_at > clock_timestamp()",
  );

// Prende proprio il lavoro di quel contatto: gli altri pronti aspettano, il suo è pronto subito.
async function claimOnly(co) {
  const away = (
    await asOwner(
      `update public.partner_assistant_jobs set next_attempt_at = now() + interval '1 day'
        where partner_id <> $1 and status = 'in_coda' and next_attempt_at <= now() returning partner_id`,
      [id(co)],
    )
  ).rows.map((r) => r.partner_id);
  await asOwner(
    "update public.partner_assistant_jobs set next_attempt_at = now() where partner_id = $1 and next_attempt_at > now()",
    [id(co)],
  );
  try {
    return await claim();
  } finally {
    if (away.length)
      await asOwner(
        "update public.partner_assistant_jobs set next_attempt_at = now() where partner_id = any($1::uuid[])",
        [`{${away.join(",")}}`],
      );
  }
}
async function claimJob(co) {
  const result = await claimOnly(co);
  assert.equal(
    result.status,
    "claimed",
    `Lavoro del CO ${co} non preso: ${JSON.stringify(result)}`,
  );
  assert.equal(result.job.partner_id, id(co), `Preso un altro lavoro invece del CO ${co}`);
  return result.job;
}
// Per i contesti di più contatti la lease si imposta come proprietario.
async function contextLeasedAsOwner(co) {
  const token = randomUUID();
  const jobId = await value(
    `update public.partner_assistant_jobs set lease_token = $2, lease_expires_at = now() + interval '5 minutes'
      where partner_id = $1 returning id as v`,
    [id(co), token],
  );
  try {
    return await context({ job_id: jobId, lease_token: token });
  } finally {
    await asOwner(
      "update public.partner_assistant_jobs set lease_token = null, lease_expires_at = null where partner_id = $1",
      [id(co)],
    );
  }
}
async function expireLeaseAndClaim(co) {
  await claimJob(co);
  await asOwner(
    "update public.partner_assistant_jobs set lease_expires_at = now() - interval '1 second' where partner_id = $1",
    [id(co)],
  );
  return claimJob(co);
}
// auth.uid() e i claims letti nella stessa transazione della RPC, dopo la RPC. Prima della RPC un
// request.jwt.claim.sub di un altro profilo, come un vecchio claim lasciato da PostgREST.
let claimsInside;
const uidInside = (fn) =>
  asService(async () => {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [founder]);
    await fn();
    claimsInside = await value("select current_setting('request.jwt.claims', true)::jsonb as v");
    return value("select auth.uid() as v");
  });
// Ricerca, scelta e bozza senza problemi: il lavoro arriva alla seconda lettura con la lease.
async function toReview(co) {
  await completeResearch(await claimJob(co));
  await completeChoice(await claimJob(co));
  await completeDraft(await claimJob(co));
  return claimJob(co);
}
// L'ordine in cui i giri prendono i lavori pronti: a ogni giro il lavoro preso si mette da parte
// (pronto domani, senza lease) e il giro dopo prende il successivo. Alla fine lease e attese
// tornano come prima, al microsecondo.
async function claimOrder() {
  const saved = (
    await db.query(
      `select id, lease_token, lease_expires_at::text as lease_expires_at, next_attempt_at::text as next_attempt_at
         from public.partner_assistant_jobs`,
    )
  ).rows;
  await asOwner(
    "update public.partner_assistant_jobs set lease_token = null, lease_expires_at = null where lease_token is not null",
  );
  const order = [];
  try {
    for (let i = 0; i <= saved.length; i++) {
      const r = await claim();
      if (r.status !== "claimed") {
        eq(r, { status: "idle", reason: "vuota" }, "Dopo l'ultimo lavoro pronto la coda è vuota");
        break;
      }
      order.push(coOf(r.job.partner_id));
      await asOwner(
        `update public.partner_assistant_jobs set lease_token = null, lease_expires_at = null,
           next_attempt_at = now() + interval '1 day' where id = $1`,
        [r.job.job_id],
      );
    }
  } finally {
    for (const s of saved)
      await asOwner(
        `update public.partner_assistant_jobs set lease_token = $2, lease_expires_at = $3::timestamptz,
           next_attempt_at = $4::timestamptz where id = $1`,
        [s.id, s.lease_token, s.lease_expires_at, s.next_attempt_at],
      );
  }
  return order;
}
// Lo stato di un passo: il lavoro, le sue note, bozze ed eventi, le ricevute di tutti.
const stepState = async (co) => ({
  ...(await one(
    `select status, step, attempts, rewrites, reason, write_on::text as write_on, research_note_id,
       choice_note_id, draft_id, lease_token, coalesce(lease_expires_at > clock_timestamp(), false) as leased
       from public.partner_assistant_jobs where partner_id = $1`,
    [id(co)],
  )),
  notes: await value(
    "select count(*)::int as v from public.partner_assistant_notes where partner_id = $1",
    [id(co)],
  ),
  drafts: await value(
    "select count(*)::int as v from public.partner_assistant_drafts where partner_id = $1",
    [id(co)],
  ),
  events: await outcomes(co),
  receipts: await value("select count(*)::int as v from private.partner_assistant_receipts"),
});
// La guardia di un complete_*, con un payload che altrimenti farebbe avanzare il passo: con un
// altro token o con la lease scaduta risponde lease_persa e non tocca niente; con il contatto
// seguito dal team durante il passo risponde non_idoneo, rilascia la lease e scrive l'evento, ma
// non salva note né bozze e non avanza (niente «pronta»). Nessuna ricevuta. Poi il contatto torna
// libero e un giro nuovo riprende lo stesso passo.
async function guardHolds(kind, co, j, fields) {
  const send = (lease) => complete(kind, lease, fields, randomUUID());
  const before = await stepState(co);
  eq([before.step, before.leased], [j.step, true], `${kind}: passo ${j.step} con la lease`);
  eq(await send({ ...j, lease_token: randomUUID() }), { status: "lease_persa" }, `${kind}: token`);
  eq(await stepState(co), before, `${kind}: con un altro token il passo non avanza`);
  await asOwner(
    "update public.partner_assistant_jobs set lease_expires_at = now() - interval '1 second' where partner_id = $1",
    [id(co)],
  );
  eq(await send(j), { status: "lease_persa" }, `${kind}: lease scaduta, stesso token`);
  await asOwner(
    "update public.partner_assistant_jobs set lease_expires_at = now() + interval '5 minutes' where partner_id = $1",
    [id(co)],
  );
  eq(await stepState(co), before, `${kind}: con la lease scaduta il passo non avanza`);
  await asOwner("update public.partners set owner_id = $2 where id = $1", [id(co), consultant]);
  eq(await send(j), { status: "non_idoneo" }, `${kind}: contatto seguito dal team`);
  eq(
    await stepState(co),
    {
      ...before,
      lease_token: null,
      leased: false,
      events: [...before.events, `${j.step}:non_idoneo`],
    },
    `${kind}: contatto non più idoneo, il passo non avanza e la lease si rilascia`,
  );
  await asOwner("update public.partners set owner_id = null where id = $1", [id(co)]);
  const again = await claimJob(co);
  eq(again.step, j.step, `${kind}: un giro nuovo riprende lo stesso passo`);
  return again;
}

const canExecute = (role, signature) =>
  value("select has_function_privilege($1, $2, 'EXECUTE') as v", [role, signature]);
const canInsert = (role, table) =>
  value("select has_table_privilege($1, $2, 'INSERT') as v", [role, table]);
const canWrite = (role, table) =>
  value(
    `select has_table_privilege($1, $2, 'INSERT') or has_table_privilege($1, $2, 'UPDATE')
       or has_table_privilege($1, $2, 'DELETE') or has_table_privilege($1, $2, 'TRUNCATE') as v`,
    [role, table],
  );
const assistantFunctions = async () =>
  (
    await db.query(
      `select n.nspname || '.' || p.proname as name, p.proconfig, p.prosecdef,
         n.nspname || '.' || p.proname || '(' || replace(oidvectortypes(p.proargtypes), ' ', '') || ')' as signature
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.proname like '%partner_assistant%' order by 1`,
    )
  ).rows;

const WORKER_RPCS = [
  "configure_partner_assistant(uuid,uuid)",
  "claim_partner_assistant_step(uuid,integer)",
  "context_partner_assistant_step(uuid,uuid)",
  "checkpoint_partner_assistant_step(uuid,uuid)",
  "record_partner_assistant_call(uuid,jsonb)",
  "complete_partner_assistant_research(uuid,jsonb)",
  "complete_partner_assistant_choice(uuid,jsonb)",
  "complete_partner_assistant_draft(uuid,jsonb)",
  "complete_partner_assistant_review(uuid,jsonb)",
  "fail_partner_assistant_step(uuid,uuid,text,text)",
  "pause_partner_assistant(text)",
];
const WORKER_HELPERS = [
  "private.partner_assistant_service_required()",
  "private.partner_assistant_as_actor()",
  "private.partner_assistant_eligible(uuid)",
  "private.partner_assistant_ranking(date)",
  "private.partner_assistant_queue(date)",
  "private.partner_assistant_email(uuid)",
  "private.partner_assistant_lock_step(uuid,uuid,text)",
];
// Le funzioni del compito 1, per controllare che la nuova migrazione non le tocchi.
const TEAM_FUNCTIONS = [
  "private.set_partner_assistant_mode(uuid,jsonb)",
  "public.set_partner_assistant_mode(uuid,jsonb)",
  "private.set_partner_assistant_contact(uuid,jsonb)",
  "public.set_partner_assistant_contact(uuid,jsonb)",
  "private.save_partner_assistant_rules(uuid,jsonb)",
  "public.save_partner_assistant_rules(uuid,jsonb)",
  "private.read_partner_assistant_status()",
  "public.read_partner_assistant_status()",
];
const TEAM_INTERNAL = [
  "private.partner_assistant_begin(uuid,text,uuid,jsonb)",
  "private.partner_assistant_finish(uuid,text,uuid,jsonb,jsonb)",
  "private.partner_assistant_append_only()",
  "private.partner_assistant_erase(uuid)",
  "private.partner_assistant_contact_erased()",
];
const PARTNER_TABLES = [
  "public.partners",
  "public.partner_contacts",
  "public.partner_message_variants",
  "public.partner_message_revisions",
  "public.partner_activities",
  "public.partner_do_not_contact",
  "public.partner_research_imports",
  "public.partner_device_imports",
  "public.partner_import_differences",
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
    "_assistente_partner.sql",
  ])
    await db.exec(migration(suffix));

  // 1. La migrazione: transazione unica, nessuna estensione.
  const sql = migration("_assistente_partner_worker.sql");
  ok(/^begin;$/m.test(sql) && /^commit;\s*$/m.test(sql), "Migrazione tra begin e commit");
  eq(/create\s+extension/i.test(sql), false, "Nessuna estensione nuova");
  await db.exec(sql);

  for (const [userId, name, role, active] of [
    [founder, "Fondatore sintetico", "founder", true],
    [consultant, "Consulente sintetico", "consultant", true],
    [formerFounder, "Fondatore sintetico non attivo", "founder", false],
    [assistant, "Assistente", null, null],
  ]) {
    await asOwner("insert into auth.users values ($1)", [userId]);
    await asOwner("insert into public.profiles(user_id, display_name) values ($1, $2)", [
      userId,
      name,
    ]);
    if (role)
      await asOwner("insert into public.memberships(user_id, role, active) values ($1, $2, $3)", [
        userId,
        role,
        active,
      ]);
  }
  for (const p of fixture.partners) {
    const partnerId = randomUUID();
    ids.set(p.co, partnerId);
    await asOwner(
      `insert into public.partners(id, co, name, origin, stage, created_by, sections, priority, contact_month,
         country, owner_id, research_removed_at)
       values ($1, $2, $3, 'team', $4, $5, string_to_array($6, ','), $7, ($8 || '-01')::date, $9, $10,
         case when $11 then now() end)`,
      [
        partnerId,
        p.co,
        p.name,
        p.stage ?? "da_contattare",
        founder,
        p.sections.join(","),
        p.priority,
        p.contact_month,
        p.country,
        p.owner ? PEOPLE[p.owner] : null,
        p.research_removed === true,
      ],
    );
    for (const c of p.contacts) {
      const erased = c.erased === true;
      await asOwner(
        `insert into public.partner_contacts(partner_id, kind, value, link_value, verified, active, position,
           erased_at, erased_by, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, case when $8 then now() end, case when $8 then $9::uuid end, $9, $9)`,
        [
          partnerId,
          c.kind,
          erased ? null : c.value,
          erased ? null : (c.link_value ?? c.value),
          c.verified === true,
          !erased && c.active !== false,
          c.position ?? 0,
          erased,
          founder,
        ],
      );
    }
    for (const a of p.activities ?? [])
      await asOwner(
        `insert into public.partner_activities(operation_id, partner_id, partner_name, partner_co, kind, origin, created_by)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [partnerId, p.name, p.co, a.kind, a.origin, founder],
      );
    if (p.do_not_contact)
      await asOwner(
        "insert into public.partner_do_not_contact(partner_id, domain, reason, created_by) values ($1, $2, 'Motivo sintetico', $3)",
        [p.do_not_contact.partner ? partnerId : null, p.do_not_contact.domain ?? null, founder],
      );
    if (p.assistant)
      await asOwner(
        "insert into public.partner_assistant_contacts(partner_id, active, updated_by) values ($1, $2, $3)",
        [partnerId, p.assistant.active, founder],
      );
  }

  // 2. La coda: idonei senza lavoro, prima il periodo, poi priorità, mese e CO.
  eq(await queue(fixture.today), [951, 952, 957, 953, 954, 955, 969, 956, 968, 970]);
  eq(
    await queue(fixture.today),
    fixture.partners
      .filter((p) => p.expected)
      .sort((a, b) => a.expected - b.expected)
      .map((p) => p.co),
    "Ordine atteso della fixture",
  );
  eq(
    await queue("2026-08-01"),
    [957, 953, 951, 952, 955, 969, 956, 954, 968, 970],
    "Il periodo dipende dal giorno passato",
  );
  for (const p of fixture.partners.filter((p) => !p.expected))
    eq(
      await value("select private.partner_assistant_eligible($1) as v", [id(p.co)]),
      false,
      `${p.co} fuori: ${p.excluded}`,
    );
  eq(await value("select private.partner_assistant_eligible($1) as v", [randomUUID()]), false);
  for (const p of fixture.partners.filter((p) => p.expected))
    eq(
      await value("select address as v from private.partner_assistant_email($1)", [id(p.co)]),
      p.address,
      `${p.co}: indirizzo da link_value`,
    );
  eq(
    await one("select verified from private.partner_assistant_email($1)", [id(953)]),
    { verified: true },
    "953: prima la verificata, anche in posizione 1",
  );

  // 3. Configurazione e giri a vuoto.
  eq(await claim(), { status: "idle", reason: "spento" });
  ok((await configRow()).last_tick_at, "Ultimo giro registrato anche a vuoto");
  await asOwner("update private.partner_assistant_config set mode = 'prepara'");
  eq(await claim(), { status: "idle", reason: "non_configurato" });
  for (const [actor, handoff] of [
    [consultant, founder],
    [assistant, consultant],
    [assistant, formerFounder],
    [randomUUID(), founder],
    [null, founder],
    [assistant, null],
  ])
    await rejects(
      () => asService(() => configure(actor, handoff)),
      "22023",
      "invalid_partner_assistant_configuration",
    );
  await rejects(
    () => configure(assistant, founder),
    "42501",
    "partner_assistant_worker_access_required",
  );
  await rejects(() => as("authenticated", founder, () => configure(assistant, founder)), "42501");
  eq(await asService(() => configure(assistant, founder)), { configured: true });
  eq(
    await one("select actor_id, handoff_to from private.partner_assistant_config"),
    { actor_id: assistant, handoff_to: founder },
    "Profilo dell'assistente e di chi riceve i passaggi",
  );
  eq((await configRow()).version, 1, "La configurazione del worker non cambia la versione");
  await asOwner("update private.partner_assistant_config set paused_reason = 'credito'");
  eq(await claim(), { status: "idle", reason: "pausa" });
  await asOwner(
    "update private.partner_assistant_config set paused_reason = null, backoff_until = now() + interval '1 hour'",
  );
  eq(await claim(), { status: "idle", reason: "attesa" });
  await asOwner(
    "update private.partner_assistant_config set backoff_until = now() - interval '1 second'",
  );
  eq(
    await value("select count(*)::int as v from public.partner_assistant_jobs"),
    0,
    "Un giro a vuoto non crea lavori",
  );

  // 4. Primo giro: un lavoro per ogni contatto in coda, preso il primo.
  // La coda del giorno di Roma, quello del giro, letta prima che i lavori esistano.
  const queueToday = await queue(
    await value("select ((now() at time zone 'Europe/Rome')::date)::text as v"),
  );
  eq(queueToday.length, 10, "Coda del giorno: dieci contatti");
  const first = await claim();
  eq(Object.keys(first).sort(), ["job", "status"]);
  eq(Object.keys(first.job).sort(), [
    "attempts",
    "job_id",
    "lease_expires_at",
    "lease_token",
    "partner_id",
    "rewrites",
    "step",
  ]);
  const j = first.job;
  eq(j.partner_id, id(951));
  eq(j.attempts, 0);
  eq([first.status, j.step, j.rewrites], ["claimed", "ricerca", 0]);
  eq(j.job_id, (await job(951)).id);
  ok(new Date(j.lease_expires_at) > new Date(Date.now() + 300000), "Lease di 360 secondi");
  eq(
    await one(
      `select count(*)::int as n, count(*) filter (where status = 'in_coda' and step = 'ricerca')::int as ricerca
         from public.partner_assistant_jobs`,
    ),
    { n: 10, ricerca: 10 },
    "Dieci lavori in coda dalla ricerca",
  );
  eq(await queue(fixture.today), [], "Chi ha un lavoro esce dalla coda");
  eq((await claim()).reason, "occupato");
  eq(await activeLeases(), 1, "Mai due lease attive");
  // Con più lavori pronti il giro li prende nell'ordine della coda, non per CO né per inserimento.
  // Le due coppie valgono in ogni giorno: 957 (settembre) e 953 (ottobre) hanno la stessa
  // priorità; 955 (alta, gennaio) e 969 (media, febbraio) sono nello stesso periodo o 955 prima.
  const claimed = await claimOrder();
  eq(claimed, queueToday, "Il giro prende i lavori nell'ordine della coda");
  ok(claimed.indexOf(957) < claimed.indexOf(953), "957 prima di 953");
  ok(claimed.indexOf(955) < claimed.indexOf(969), "955 prima di 969");
  eq(
    await one(
      `select lease_token, lease_expires_at = $2::timestamptz as same from public.partner_assistant_jobs
        where partner_id = $1`,
      [id(951), j.lease_expires_at],
    ),
    { lease_token: j.lease_token, same: true },
    "Lease del primo giro rimessa com'era",
  );
  eq(await activeLeases(), 1);

  // Contesto, con le chiavi esatte.
  const c951 = await context(j);
  eq(Object.keys(c951).sort(), [
    "choice",
    "draft",
    "email",
    "last_review",
    "partner",
    "research",
    "rules",
    "status",
    "today",
  ]);
  eq(Object.keys(c951.partner).sort(), [
    "application_deadline",
    "city",
    "co",
    "contact_month",
    "country",
    "event_ends_on",
    "event_starts_on",
    "name",
    "priority",
    "research",
    "sections",
    "type_label",
    "version",
  ]);
  eq(c951.status, "ok");
  eq(
    c951.today,
    await value("select ((now() at time zone 'Europe/Rome')::date)::text as v"),
    "Giorno di Roma",
  );
  eq(c951.partner, {
    co: 951,
    name: "Porsche Club Sintetico Nord",
    city: "",
    country: "Regno Unito",
    type_label: "",
    sections: ["collab"],
    priority: "alta",
    contact_month: "2026-11-01",
    event_starts_on: null,
    event_ends_on: null,
    application_deadline: null,
    version: 1,
    research: {},
  });
  eq((await context(j)).email.address, "segreteria@pc-nord.example.test");
  eq(Object.keys(c951.email).sort(), ["address", "contact_id", "verified"]);
  eq(
    c951.email.contact_id,
    await value(
      "select id as v from public.partner_contacts where partner_id = $1 and kind = 'email'",
      [id(951)],
    ),
  );
  eq(c951.email.verified, true);
  eq(Object.keys(c951.rules).sort(), ["body", "version"]);
  eq(c951.rules.version, 1);
  ok(
    c951.rules.body.startsWith("# Regole dell'assistente Partner, versione 1"),
    "Regole in vigore",
  );
  eq(
    [c951.research, c951.choice, c951.draft, c951.last_review],
    [null, null, null, null],
    "Ancora niente note né bozze",
  );
  eq((await contextLeasedAsOwner(953)).email.address, "titolare@negozio-tre.example.test");
  eq((await contextLeasedAsOwner(970)).email.address, "info@raduno-20.example.test");
  eq(await context({ ...j, lease_token: randomUUID() }), { status: "lease_persa" });
  eq(await checkpoint(j), { status: "ok" });

  // Il testo della ricerca è limitato anche in byte: 30.000 caratteri da 3 byte stanno nei 60.000
  // caratteri ma non nei 60.000 byte, e la nota supererebbe i 64 KiB (23514). Errore di payload,
  // niente scritto, lease intatta. Al limite (20.000 caratteri da 3 byte) la nota si salva: prova in
  // una transazione annullata, così la ricerca resta quella qui sotto.
  const beforeBytes = await stepState(951);
  await rejects(
    () => completeResearch(j, { ...research, text: "€".repeat(30000) }, randomUUID()),
    "22023",
    "invalid_partner_payload",
  );
  eq(await stepState(951), beforeBytes, "Testo oltre i 60.000 byte: niente scritto");
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    await db.exec("set local role service_role");
    eq(
      (
        await rpc("select public.complete_partner_assistant_research($1, $2::jsonb) r", [
          randomUUID(),
          JSON.stringify({
            schema_version: 1,
            job_id: j.job_id,
            lease_token: j.lease_token,
            ...research,
            text: "€".repeat(20000),
          }),
        ])
      ).status,
      "done",
      "60.000 byte: la nota sta nei 64 KiB",
    );
  } finally {
    await db.exec("rollback");
  }
  eq(await stepState(951), beforeBytes, "Prova al limite annullata");

  // 5. Ricerca: dentro le RPC auth.uid() è l'assistente, il ruolo resta service_role.
  eq(
    await uidInside(() => completeResearch(j, research)),
    assistant,
    "auth.uid() è l'assistente dentro le RPC",
  );
  eq(claimsInside, { role: "service_role", sub: assistant }, "Claim role conservato");
  eq(
    await asService(() => value("select auth.uid() as v")),
    null,
    "Il claim dell'assistente non esce dalla transazione",
  );
  eq((await completeResearch(j, research)).replayed, true);
  eq(await completeResearch(j, research), {
    status: "done",
    job_status: "in_coda",
    step: "estrazione",
    replayed: true,
  });
  await rejects(
    () => completeResearch(j, { ...research, text: "Un altro testo." }),
    "23505",
    "partner_idempotency_conflict",
  );
  const r951 = await notes(951, "ricerca");
  eq(r951.length, 1, "Una sola nota di ricerca");
  eq(
    r951[0],
    {
      id: r951[0].id,
      content: { text: research.text },
      sources: research.sources,
      rules_version: 1,
      model: MODEL,
      created_by: assistant,
    },
    "Nota ricerca dell'assistente",
  );
  const after951 = await job(951);
  eq(
    [
      after951.status,
      after951.step,
      after951.attempts,
      after951.lease_token,
      after951.lease_expires_at,
    ],
    ["in_coda", "estrazione", 0, null, null],
    "Ricerca salvata: estrazione, lease rilasciata",
  );
  eq(after951.research_note_id, r951[0].id);
  eq(
    await one(
      "select command_kind, actor_id from private.partner_assistant_receipts where operation_id = $1",
      [operationOf(j, "research")],
    ),
    { command_kind: "complete_partner_assistant_research", actor_id: assistant },
    "Ricevuta con l'attore dell'assistente",
  );
  eq(await outcomes(951), ["ricerca:salvata"]);
  eq(await activeLeases(), 0);
  // Payload non validi: chiavi, testo, fonti.
  for (const bad of [
    { ...research, text: "x".repeat(60001) },
    { ...research, text: "   " },
    { ...research, sources: ["http://club.example.test/notizie"] },
    { ...research, sources: Array.from({ length: 41 }, (_, i) => `https://example.test/${i}`) },
    { ...research, sources: "https://club.example.test" },
    { ...research, rules_version: 0 },
    { ...research, extra: true },
    (({ model, ...rest }) => rest)(research),
  ])
    await rejects(() => completeResearch(j, bad, randomUUID()), "22023", "invalid_partner_payload");
  eq(
    (await completeResearch(j, research, randomUUID())).status,
    "lease_persa",
    "Senza ricevuta e senza lease",
  );

  // 6. Costi: una riga per chiamata, idempotente per operation_id.
  const call = {
    partner_id: id(951),
    step: "ricerca",
    model: MODEL,
    input_tokens: 12000,
    output_tokens: 3000,
    cache_write_5m_tokens: 0,
    cache_write_1h_tokens: 6000,
    cache_read_tokens: 4000,
    web_searches: 5,
    cost_usd: 0.169,
    outcome: "ok",
  };
  const opCall = randomUUID();
  eq(await record(call, opCall), { status: "ok", replayed: false });
  eq(await record(call, opCall), { status: "ok", replayed: true });
  await rejects(
    () => record({ ...call, cost_usd: 0.2 }, opCall),
    "23505",
    "partner_idempotency_conflict",
  );
  eq(
    await one(
      `select partner_id, step, model, input_tokens::int, output_tokens::int, cache_write_5m_tokens::int,
         cache_write_1h_tokens::int, cache_read_tokens::int, web_searches, cost_usd::text, outcome
         from private.partner_assistant_runs where operation_id = $1`,
      [opCall],
    ),
    { ...call, cost_usd: "0.169000" },
  );
  eq((await record({ ...call, partner_id: randomUUID(), outcome: "credito" })).status, "ok");
  eq(
    await value(
      "select count(*)::int as v from private.partner_assistant_runs where partner_id is null and outcome = 'credito'",
    ),
    1,
    "Chiamata di un contatto sparito: il costo resta",
  );
  for (const bad of [
    { ...call, input_tokens: -1 },
    { ...call, cost_usd: -0.01 },
    { ...call, cost_usd: "0.1" },
    { ...call, step: "invio" },
    { ...call, outcome: "Non va" },
    { ...call, web_searches: 1.5 },
    (({ cache_read_tokens, ...rest }) => rest)(call),
    { ...call, extra: 1 },
  ])
    await rejects(() => record(bad), "22023", "invalid_partner_payload");

  // 7. Il team segue il contatto durante il passo: niente avanzamento, lease rilasciata.
  await completeResearch(await claimJob(952));
  const j952 = await claimJob(952);
  eq(j952.step, "estrazione");
  await asOwner("update private.partner_assistant_config set mode = 'spento'");
  eq(await checkpoint(j952), { status: "stop", reason: "spento" });
  await asOwner(
    "update private.partner_assistant_config set mode = 'prepara', paused_reason = 'errore_claude'",
  );
  eq(await checkpoint(j952), { status: "stop", reason: "pausa" });
  await asOwner(
    "update private.partner_assistant_config set paused_reason = null, backoff_until = now() + interval '5 minutes'",
  );
  eq(await checkpoint(j952), { status: "stop", reason: "attesa" });
  await asOwner("update private.partner_assistant_config set backoff_until = null");
  eq(await checkpoint({ ...j952, lease_token: randomUUID() }), {
    status: "stop",
    reason: "lease_persa",
  });
  eq(await checkpoint(j952), { status: "ok" });
  await asOwner(`update public.partners set owner_id = '${consultant}' where co = 952`);
  eq((await checkpoint(j952)).reason, "non_idoneo");
  eq((await completeChoice(j952, scrivi)).status, "non_idoneo");
  eq(await completeChoice(j952, scrivi), { status: "lease_persa" }, "La lease non c'è più");
  const after952 = await job(952);
  eq(
    [after952.status, after952.step, after952.lease_token, after952.choice_note_id],
    ["in_coda", "estrazione", null, null],
    "Il passo non avanza",
  );
  eq((await notes(952, "scelta")).length, 0, "Nessuna scelta salvata");
  eq(await outcomes(952), ["ricerca:salvata", "estrazione:non_idoneo"]);
  eq(await claimOnly(952), { status: "idle", reason: "vuota" }, "Seguito dal team: non si prende");

  // 8. Tentativi: tre risposte non valide e il contatto passa a Tommi.
  const fails957 = [];
  for (let i = 0; i < 3; i++) {
    fails957.push(await fail(await claimJob(957), "riprova", "risposta_non_valida"));
    if (i === 0) eq((await job(957)).waits, true, "Riprova tra dieci minuti");
  }
  eq(fails957, [
    { status: "done", job_status: "in_coda", attempts: 1 },
    { status: "done", job_status: "in_coda", attempts: 2 },
    { status: "done", job_status: "serve_tommaso", attempts: 3 },
  ]);
  eq((await job(957)).status, "serve_tommaso");
  eq((await job(957)).reason, "troppi_tentativi");
  eq((await job(957)).lease_token, null);
  eq(await outcomes(957), [
    "ricerca:risposta_non_valida",
    "ricerca:risposta_non_valida",
    "ricerca:risposta_non_valida",
  ]);
  const j953 = await claimJob(953);
  eq(await fail({ ...j953, lease_token: randomUUID() }, "riprova", "timeout"), {
    status: "lease_persa",
  });
  for (const [kind, reason] of [
    ["ritenta", "timeout"],
    ["riprova", "Timeout"],
    ["riprova", null],
    [null, "timeout"],
  ])
    await rejects(() => fail(j953, kind, reason), "22023", "invalid_partner_payload");
  eq((await fail(j953, "attesa", "claude_attesa")).attempts, 0);
  eq(
    [(await job(953)).attempts, (await job(953)).waits, (await configRow()).waits],
    [0, true, true],
    "Attesa per tutti, senza tentativi",
  );
  eq(await claim(), { status: "idle", reason: "attesa" });
  await asOwner("update private.partner_assistant_config set backoff_until = null");
  eq((await fail(await claimJob(954), "rilascia", "non_idoneo")).attempts, 0);
  eq(
    [(await job(954)).attempts, (await job(954)).due, (await job(954)).lease_token],
    [0, true, null],
    "Rilascio: nessun tentativo, nessuna attesa",
  );
  const again954 = await claimJob(954);
  eq(again954.attempts, 0, "Il giro non tocca i tentativi");
  await fail(again954, "rilascia", "non_idoneo");
  const j955 = await expireLeaseAndClaim(955);
  eq(j955.attempts, 1, "lease scaduta = tentativo fallito");
  eq(await outcomes(955), ["ricerca:lease_scaduta"]);
  await asOwner(
    "update public.partner_assistant_jobs set lease_expires_at = now() - interval '1 second' where partner_id = $1",
    [id(955)],
  );
  eq(
    await completeResearch(j955),
    { status: "lease_persa" },
    "Lease scaduta, stesso token: il passo non avanza",
  );
  eq(await checkpoint(j955), { status: "stop", reason: "lease_persa" });
  eq((await claimJob(955)).attempts, 2, "Seconda lease scaduta");
  await asOwner(
    "update public.partner_assistant_jobs set lease_expires_at = now() - interval '1 second' where partner_id = $1",
    [id(955)],
  );
  eq((await claimOnly(955)).reason, "vuota");
  eq(
    [(await job(955)).status, (await job(955)).reason, (await job(955)).attempts],
    ["serve_tommaso", "troppi_tentativi", 3],
    "Terza lease scaduta: passa a Tommi",
  );

  // 9. Scelta e bozza: due controlli falliti e il contatto passa a Tommi.
  const jc = await claimJob(951);
  const cc = await context(jc);
  eq(Object.keys(cc.research).sort(), ["created_at", "note_id", "sources", "text"]);
  eq(
    { ...cc.research, created_at: null },
    { note_id: r951[0].id, text: research.text, sources: research.sources, created_at: null },
  );
  for (const bad of [
    decided({ kind: "scrivi", extra: 1 }),
    decided({ kind: "attendi", write_on: cc.today }),
    decided({ kind: "attendi" }),
    decided({ kind: "blocca", reason: "altro" }),
    decided({ kind: "manda" }),
    decided({ kind: "scrivi" }, choiceOf({ request: "regalo" })),
    decided({ kind: "scrivi" }, choiceOf({ contact_kind: "altro" })),
    decided({ kind: "scrivi" }, choiceOf({ write_on: "27/10/2026" })),
    decided({ kind: "scrivi" }, choiceOf({ swiss: "no" })),
    decided({ kind: "scrivi" }, choiceOf({ notes_it: null })),
    decided({ kind: "scrivi" }, (({ timezone, ...rest }) => rest)(choiceOf())),
    decided({ kind: "scrivi" }, { ...choiceOf(), extra: "" }),
  ])
    await rejects(() => completeChoice(jc, bad, randomUUID()), "22023", "invalid_partner_payload");
  eq(await completeChoice(jc, scrivi), {
    status: "done",
    job_status: "in_coda",
    step: "scrittura",
    replayed: false,
  });
  const s951 = await notes(951, "scelta");
  eq(s951.length, 1);
  eq(
    s951[0].content,
    { ...choiceOf(), decision: { kind: "scrivi" } },
    "Scelta con richiesta e decisione",
  );
  eq((await job(951)).choice_note_id, s951[0].id);
  const jw = await claimJob(951);
  const cw = await context(jw);
  eq(cw.choice, { note_id: s951[0].id, content: s951[0].content });
  eq(cw.draft, null);
  await rejects(() => completeChoice(jw, scrivi, randomUUID()), "22023", "invalid_partner_payload");
  const otherContact = await value(
    "select id as v from public.partner_contacts where partner_id = $1",
    [id(952)],
  );
  await rejects(
    () => completeDraft(jw, { contact_id: otherContact }, randomUUID()),
    "22023",
    "invalid_partner_payload",
  );
  // Solo il recapito scelto per il contatto, quello del contesto: un'altra email dello stesso
  // contatto (non attiva, senza link_value, oppure attiva ma non scelta) è un payload non valido.
  const extraContacts = (
    await asOwner(
      `insert into public.partner_contacts(partner_id, kind, value, link_value, active, position, created_by,
         updated_by)
       values ($1, 'email', 'vecchia@pc-nord.example.test', 'vecchia@pc-nord.example.test', false, 1, $2, $2),
         ($1, 'email', 'scritta male pc-nord.example.test', null, true, 2, $2, $2),
         ($1, 'email', 'altra@pc-nord.example.test', 'altra@pc-nord.example.test', true, 3, $2, $2)
       returning id`,
      [id(951), founder],
    )
  ).rows.map((r) => r.id);
  eq(
    (await context(jw)).email.contact_id,
    cw.email.contact_id,
    "Le email in più non cambiano il recapito scelto",
  );
  const beforeContacts = await stepState(951);
  for (const contactId of extraContacts)
    await rejects(
      () => completeDraft(jw, { contact_id: contactId }, randomUUID()),
      "22023",
      "invalid_partner_payload",
    );
  eq(await stepState(951), beforeContacts, "Recapito diverso da quello scelto: niente scritto");
  await asOwner("delete from public.partner_contacts where id = any($1::uuid[])", [
    `{${extraContacts.join(",")}}`,
  ]);
  for (const bad of [
    { checks_ok: true, failures: ["lunghezza"] },
    { checks_ok: false, failures: [] },
    { checks_ok: false, failures: ["Parola vietata"] },
    { language: "pt" },
    { sha256: "ABC" },
    { body: " " },
  ])
    await rejects(() => completeDraft(jw, bad, randomUUID()), "22023", "invalid_partner_payload");
  eq((await notes(951, "controllo")).length, 0, "Payload rifiutati: niente salvato");
  eq((await completeDraft(jw, { checks_ok: false })).job_status, "in_coda");
  const w951 = await job(951);
  eq(
    [w951.step, w951.rewrites, w951.attempts, w951.lease_token],
    ["scrittura", 1, 0, null],
    "Prima riscrittura",
  );
  eq(
    (await notes(951, "controllo")).map((n) => n.content),
    [{ approved: false, problems: ["parola_vietata"] }],
    "Nota controllo con i problemi",
  );
  const jw2 = await claimJob(951);
  const cw2 = await context(jw2);
  eq(Object.keys(cw2.draft).sort(), [
    "body",
    "created_at",
    "draft_id",
    "language",
    "rules_version",
    "sha256",
    "signature",
    "subject",
  ]);
  eq(cw2.draft.draft_id, w951.draft_id);
  eq(cw2.last_review, { approved: false, problems: ["parola_vietata"] });
  eq(
    (await completeDraft(jw2, { checks_ok: false, failures: ["lunghezza", "domande"] })).job_status,
    "serve_tommaso",
  );
  eq((await job(951)).reason, "controlli_falliti");
  eq(
    await one(
      `select count(*)::int as n, count(distinct contact_id)::int as contacts, bool_and(created_by = $2) as assistant,
         bool_and(research_note_id = $3) as research from public.partner_assistant_drafts where partner_id = $1`,
      [id(951), assistant, r951[0].id],
    ),
    { n: 2, contacts: 1, assistant: true, research: true },
    "Due bozze dell'assistente sullo stesso recapito",
  );
  eq(await outcomes(951), [
    "ricerca:salvata",
    "estrazione:scrivi",
    "scrittura:riscrittura",
    "scrittura:controlli_falliti",
  ]);
  eq(await claimOnly(951), { status: "idle", reason: "vuota" }, "Passato a Tommi: non si prende");

  // 10. Seconda lettura: regole superate, impronta sbagliata, poi pronta.
  const jr2 = await toReview(969);
  eq(jr2.step, "controllo");
  eq((await context(jr2)).last_review, null, "Bozza nuova: nessuna seconda lettura ancora");
  eq(
    (await completeReview(jr2, { approved: false, problems: ["regole_superate"] })).step,
    "scrittura",
  );
  eq(
    [(await job(969)).status, (await job(969)).rewrites],
    ["in_coda", 0],
    "Regole superate: riscrittura senza consumare",
  );
  const jr0 = await claimJob(969);
  eq((await context(jr0)).last_review, { approved: false, problems: ["regole_superate"] });
  await completeDraft(jr0);
  const jr = await claimJob(969);
  eq((await context(jr)).last_review, null, "La seconda lettura della bozza vecchia non conta");
  const wrong = "0".repeat(64);
  eq((await completeReview(jr, { approved: true, sha256: wrong })).job_status, "in_coda");
  eq(
    [(await job(969)).step, (await job(969)).rewrites],
    ["scrittura", 1],
    "Impronta diversa: riscrittura",
  );
  const jr1 = await claimJob(969);
  eq((await context(jr1)).last_review, {
    approved: true,
    problems: [],
  });
  await completeDraft(jr1);
  const jr3 = await claimJob(969);
  const ctx969 = await context(jr3);
  const right = ctx969.draft.sha256;
  // Il team segue il contatto durante una seconda lettura approvata: non diventa «pronta».
  const jr4 = await guardHolds("review", 969, jr3, reviewFields(ctx969, { approved: true }));
  eq((await completeReview(jr4, { approved: true, sha256: right })).job_status, "pronta");
  const ready = await job(969);
  eq(
    [ready.status, ready.step, ready.lease_token, ready.attempts],
    ["pronta", "controllo", null, 0],
  );
  const reviews969 = (await notes(969, "controllo")).map((n) => n.content);
  eq(
    reviews969.map((c) => [c.approved, c.problems]),
    [
      [false, ["regole_superate"]],
      [true, []],
      [true, []],
    ],
    "Tre seconde letture salvate",
  );
  eq([reviews969[1].sha256, reviews969[2].sha256], [wrong, right], "Impronta nella nota");
  eq(await outcomes(969), [
    "ricerca:salvata",
    "estrazione:scrivi",
    "scrittura:controlli_superati",
    "controllo:regole_superate",
    "scrittura:controlli_superati",
    "controllo:riscrittura",
    "scrittura:controlli_superati",
    "controllo:non_idoneo",
    "controllo:pronta",
  ]);
  // Seconda lettura fallita due volte: passa a Tommi.
  const jn = await toReview(970);
  eq((await completeReview(jn, { approved: false })).job_status, "in_coda");
  // Il team segue il contatto durante la scrittura: la bozza non si salva e non va al controllo.
  const jd970 = await claimJob(970);
  await completeDraft(await guardHolds("draft", 970, jd970, draftFields(await context(jd970))));
  eq((await completeReview(await claimJob(970), { approved: false })).job_status, "serve_tommaso");
  eq((await job(970)).reason, "seconda_lettura");
  eq(
    (await notes(970, "controllo"))[0].content.problems,
    ["Il complimento iniziale è troppo generico."],
    "I problemi della seconda lettura restano come testo",
  );

  // 11. Attendere o bloccare. Sul 968 anche la guardia di ricerca e scelta.
  await completeResearch(await guardHolds("research", 968, await claimJob(968), research));
  const blocca968 = decided(
    { kind: "blocca", reason: "fatto_mancante" },
    choiceOf({ fact_text: "" }),
  );
  eq(
    await completeChoice(
      await guardHolds("choice", 968, await claimJob(968), blocca968),
      blocca968,
    ),
    { status: "done", job_status: "serve_tommaso", step: "estrazione", replayed: false },
  );
  eq((await job(968)).reason, "fatto_mancante");
  await completeResearch(await claimJob(956));
  const later = await value("select (((now() at time zone 'Europe/Rome')::date) + 40)::text as v");
  const waiting = await completeChoice(
    await claimJob(956),
    decided(
      { kind: "attendi", write_on: later },
      choiceOf({
        contact_kind: "evento",
        write_now: false,
        write_on: later,
        request: "banco_evento",
      }),
    ),
  );
  eq(waiting.job_status, "attesa");
  eq([(await job(956)).status, (await job(956)).write_on], ["attesa", later]);
  eq((await claimOnly(956)).reason, "vuota", "In attesa fino al giorno giusto");
  await asOwner(
    "update public.partner_assistant_jobs set write_on = (now() at time zone 'Europe/Rome')::date where partner_id = $1",
    [id(956)],
  );
  const j956 = await claimJob(956);
  eq(
    [j956.step, (await job(956)).status, (await job(956)).write_on],
    ["ricerca", "in_coda", null],
    "Il giorno giusto: si rifà la ricerca",
  );
  await completeResearch(j956);
  const fresh956 = await job(956);
  eq(
    [fresh956.step, fresh956.research_note_id, fresh956.choice_note_id],
    ["estrazione", (await notes(956, "ricerca"))[1].id, null],
    "Ricerca nuova: la scelta vecchia non vale più",
  );
  // «Non contattare» durante l'estrazione.
  const j956b = await claimJob(956);
  await asOwner(
    "insert into public.partner_do_not_contact(partner_id, reason, created_by) values ($1, 'Motivo sintetico', $2)",
    [id(956), founder],
  );
  eq((await checkpoint(j956b)).reason, "non_idoneo");
  eq((await completeChoice(j956b)).status, "non_idoneo");
  eq((await notes(956, "scelta")).length, 1, "Nessuna nuova scelta salvata");

  // 12. Il team ferma il contatto, poi cancella il recapito durante il passo.
  const j954 = await claimJob(954);
  await teamCommand(founder, "set_partner_assistant_contact", {
    partner_id: id(954),
    active: false,
  });
  eq((await completeResearch(j954)).status, "non_idoneo");
  eq((await job(954)).lease_token, null);
  await teamCommand(founder, "set_partner_assistant_contact", {
    partner_id: id(954),
    active: true,
  });
  const j954b = await claimJob(954);
  await asOwner(
    `update public.partner_contacts set value = null, link_value = null, label = '', active = false,
       erased_at = now(), erased_by = $2, version = version + 1 where partner_id = $1`,
    [id(954), founder],
  );
  eq(await completeResearch(j954b), { status: "lease_persa" }, "Cancellazione: lease tolta");
  eq((await notes(954, "ricerca")).length, 0);

  // Regole nuove durante la seconda lettura: il lavoro torna in scrittura e la lease si perde.
  const j953r = await toReview(953);
  const sha953 = (await context(j953r)).draft.sha256;
  const rulesV2 = await teamCommand(founder, "save_partner_assistant_rules", {
    body: "Regole sintetiche, versione 2",
    expected_version: 1,
  });
  eq(rulesV2.requeued, 2, "In seconda lettura (953) e pronta (969)");
  eq(await completeReview(j953r, { approved: true, sha256: sha953, rules_version: 1 }), {
    status: "lease_persa",
  });
  eq([(await job(953)).step, (await job(969)).status], ["scrittura", "in_coda"]);
  eq((await context(await claimJob(953))).rules.version, 2, "Il contesto porta le regole nuove");

  // 13. Pausa: ogni lease rilasciata, nessun tentativo consumato.
  const leased953 = await job(953);
  ok(leased953.lease_token, "953 in lavorazione");
  await rejects(() => pause("altro"), "22023", "invalid_partner_payload");
  eq(await pause("credito"), { status: "done", paused_reason: "credito" });
  eq((await pause("credito")).paused_reason, "credito");
  eq((await claim()).reason, "pausa");
  eq(
    [(await job(953)).lease_token, (await job(953)).attempts],
    [null, leased953.attempts],
    "Pausa: lease rilasciata, tentativi invariati",
  );
  eq((await configRow()).paused_reason, "credito");
  eq(await activeLeases(), 0);

  // 14. Ogni passaggio a Tommi ha un motivo.
  eq(
    (
      await db.query(
        `select p.co, j.reason from public.partner_assistant_jobs j join public.partners p on p.id = j.partner_id
          where j.status = 'serve_tommaso' order by p.co`,
      )
    ).rows,
    [
      { co: 951, reason: "controlli_falliti" },
      { co: 955, reason: "troppi_tentativi" },
      { co: 957, reason: "troppi_tentativi" },
      { co: 968, reason: "fatto_mancante" },
      { co: 970, reason: "seconda_lettura" },
    ],
  );
  await rejects(
    () =>
      asOwner(
        "update public.partner_assistant_jobs set reason = null where status = 'serve_tommaso'",
      ),
    "23514",
  );
  const statusRead = await as("authenticated", founder, () =>
    rpc("select public.read_partner_assistant_status() r"),
  );
  eq(
    statusRead.to_review.every((r) => typeof r.reason === "string"),
    true,
    "Da rivedere: sempre con il motivo",
  );
  eq(statusRead.paused_reason, "credito");

  // 15. Permessi.
  eq(await canExecute("authenticated", "public.claim_partner_assistant_step(uuid,integer)"), false);
  eq(await canInsert("service_role", "public.partners"), false);
  eq(await canInsert("service_role", "public.partner_activities"), false);
  await rejects(() => asService(() => configure(consultant, founder)), "22023");
  await rejects(() => asService(() => configure(assistant, consultant)), "22023");
  for (const signature of WORKER_RPCS)
    for (const schema of ["private", "public"]) {
      const f = `${schema}.${signature}`;
      eq(await canExecute("service_role", f), true, `service_role esegue ${f}`);
      eq(await canExecute("authenticated", f), false, `authenticated non esegue ${f}`);
      eq(await canExecute("anon", f), false, `anon non esegue ${f}`);
    }
  for (const f of WORKER_HELPERS)
    for (const role of ["anon", "authenticated", "service_role"])
      eq(await canExecute(role, f), false, `${role} non esegue ${f}`);
  for (const f of TEAM_FUNCTIONS) eq(await canExecute("authenticated", f), true, `Membri su ${f}`);
  for (const f of [...TEAM_FUNCTIONS, ...TEAM_INTERNAL])
    eq(await canExecute("service_role", f), false, `service_role non esegue ${f}`);
  for (const t of PARTNER_TABLES)
    eq(await canWrite("service_role", t), false, `service_role non scrive ${t}`);
  eq(
    (
      await db.query(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'partner%'
            and has_table_privilege('service_role', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')`,
      )
    ).rows,
    [],
    "Nessuna tabella public.partner* scrivibile da service_role",
  );
  eq(
    await value("select has_schema_privilege('service_role', 'private', 'USAGE') as v"),
    true,
    "service_role usa lo schema private",
  );
  await rejects(
    () =>
      asService(() =>
        db.query(
          `insert into public.partner_activities(operation_id, partner_id, partner_name, partner_co, kind, created_by)
           values (gen_random_uuid(), $1, 'x', 951, 'nota', $2)`,
          [id(951), founder],
        ),
      ),
    "42501",
  );
  await rejects(
    () => asOwner("select public.claim_partner_assistant_step($1, 360)", [WORKER]),
    "42501",
    "partner_assistant_worker_access_required",
  );
  await rejects(
    () =>
      as("authenticated", founder, () =>
        rpc("select public.claim_partner_assistant_step($1, 360) r", [WORKER]),
      ),
    "42501",
  );
  await rejects(
    () => asService(() => rpc("select public.claim_partner_assistant_step($1, 5) r", [WORKER])),
    "22023",
    "invalid_partner_payload",
  );
  const functions = await assistantFunctions();
  eq(
    functions.map((f) => f.signature).sort(),
    [
      ...WORKER_RPCS.flatMap((s) => [`private.${s}`, `public.${s}`]),
      ...WORKER_HELPERS,
      ...TEAM_FUNCTIONS,
      ...TEAM_INTERNAL,
    ].sort(),
    "Nessuna funzione in più",
  );
  eq(
    functions.every((f) => JSON.stringify(f.proconfig) === JSON.stringify(['search_path=""'])),
    true,
    "search_path vuoto ovunque",
  );
  eq(
    functions
      .filter((f) => f.prosecdef && WORKER_RPCS.some((s) => f.signature.includes(s.split("(")[0])))
      .map((f) => f.name)
      .sort(),
    WORKER_RPCS.map((s) => `private.${s.split("(")[0]}`).sort(),
    "Security definer solo nelle RPC private del worker",
  );
  eq(
    functions
      .filter((f) => WORKER_HELPERS.some((h) => h.startsWith(`${f.name}(`)))
      .every((f) => !f.prosecdef),
    true,
    "Funzioni di supporto security invoker",
  );
  console.log(`PASS ${checks} Assistente Partner worker synthetic checks passed.`);
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
