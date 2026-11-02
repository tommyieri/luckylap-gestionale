// test-db: pglite minimo 42
// Assistente Partner, ricerca ancora valida alla data di ripresa
// (_assistente_partner_ricerca_valida.sql): un contatto che torna dall'attesa con una ricerca di meno
// di 14 giorni riparte dall'estrazione, senza pagare una ricerca nuova. Vale anche per i lavori già
// tornati alla ricerca prima della migrazione. Migrazioni applicate in ordine su PGlite. Solo dati
// sintetici (CO da 951, domini example.test), nessun accesso cloud.
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

const fixtureId = (n) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const founder = fixtureId(901),
  assistant = fixtureId(990);
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const WORKER = randomUUID();
const MODEL = "claude-opus-5-5";

const migrations = new URL("../migrations/", import.meta.url);
const migration = (suffix) => {
  const names = readdirSync(migrations).filter((n) => n.endsWith(suffix));
  assert.equal(names.length, 1, `Una sola migrazione ${suffix}`);
  return readFileSync(new URL(names[0], migrations), "utf8");
};
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const value = async (sql, args = []) => (await one(sql, args))?.v;
const asOwner = (sql, args) => (args ? db.query(sql, args) : db.exec(sql));

async function as(role, sub, fn) {
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
const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r;
const worker = (name, payload, op = randomUUID()) =>
  as("service_role", null, () =>
    rpc(`select public.${name}($1, $2::jsonb) r`, [
      op,
      JSON.stringify({ schema_version: 1, ...payload }),
    ]),
  );
const claim = () =>
  as("service_role", null, () =>
    rpc("select public.claim_partner_assistant_step($1, 360) r", [WORKER]),
  );
const context = (job) =>
  as("service_role", null, () =>
    rpc("select public.context_partner_assistant_step($1, $2) r", [job.job_id, job.lease_token]),
  );
// Un giro di presa, poi la lease si toglie: il giro dopo non trova «occupato».
const tick = async () => {
  const claimed = await claim();
  await asOwner(
    "update public.partner_assistant_jobs set lease_token = null, lease_expires_at = null",
  );
  return claimed;
};

const ids = new Map();
async function scheda(co, { sections = ["collab"], country = "Germania" } = {}) {
  const partnerId = randomUUID();
  ids.set(co, partnerId);
  await asOwner(
    `insert into public.partners(id, co, name, origin, stage, created_by, sections, priority, contact_month, country)
     values ($1, $2, $3, 'team', 'da_contattare', $4, $5::text[], 'media', date '2026-11-01', $6)`,
    [partnerId, co, `Contatto Sintetico ${co}`, founder, sections, country],
  );
  await asOwner(
    `insert into public.partner_contacts(partner_id, kind, value, link_value, created_by, updated_by)
     values ($1, 'email', $2, $2, $3, $3)`,
    [partnerId, `info@contatto-${co}.example.test`, founder],
  );
  return partnerId;
}
const researchNote = (partnerId, age, content = { text: "Ricerca sintetica." }) =>
  value(
    `insert into public.partner_assistant_notes(partner_id, kind, content, sources, rules_version, model, operation_id,
       created_by, created_at)
     values ($1, 'ricerca', $2::jsonb, '{}', 1, $3, gen_random_uuid(), $4, now() - $5::interval)
     returning id as v`,
    [partnerId, JSON.stringify(content), MODEL, assistant, age],
  );
const choiceNote = (partnerId, age) =>
  value(
    `insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model, operation_id,
       created_by, created_at)
     values ($1, 'scelta', '{"decision": {"kind": "attendi"}}'::jsonb, 1, $2, gen_random_uuid(), $3, now() - $4::interval)
     returning id as v`,
    [partnerId, MODEL, assistant, age],
  );
const ROME_TODAY = "(now() at time zone 'Europe/Rome')::date";
/** Un contatto in attesa, con la ricerca dell'età data e la data a `days` giorni da oggi. */
async function waiting(co, age, days = 0, options) {
  const partnerId = await scheda(co, options);
  const research = await researchNote(partnerId, age);
  const choice = await choiceNote(partnerId, age);
  await asOwner(
    `insert into public.partner_assistant_jobs(partner_id, status, step, write_on, research_note_id, choice_note_id)
     values ($1, 'attesa', 'estrazione', ${ROME_TODAY} + $2::integer, $3, $4)`,
    [partnerId, days, research, choice],
  );
  return { partnerId, research, choice };
}
/** Un lavoro già tornato alla ricerca, con o senza la nota di prima. */
async function queued(co, age, { attempts = 0, content, status = "in_coda", reason = null } = {}) {
  const partnerId = await scheda(co);
  const research = age ? await researchNote(partnerId, age, content) : null;
  await asOwner(
    `insert into public.partner_assistant_jobs(partner_id, status, step, attempts, reason, research_note_id)
     values ($1, $2, 'ricerca', $3, $4, $5)`,
    [partnerId, status, attempts, reason, research],
  );
  return { partnerId, research };
}
const jobOf = (co) =>
  one(
    `select status, step, attempts, rewrites, write_on::text as write_on, research_note_id, choice_note_id, draft_id,
       lease_token, reason from public.partner_assistant_jobs where partner_id = $1`,
    [ids.get(co)],
  );
const researchCount = (co) =>
  value(
    "select count(*)::int as v from public.partner_assistant_notes where partner_id = $1 and kind = 'ricerca'",
    [ids.get(co)],
  );
// L'interruttore della scheda: un contatto fermo esce dalla coda.
const stop = (co) =>
  asOwner(
    `insert into public.partner_assistant_contacts(partner_id, active, updated_by) values ($1, false, $2)
     on conflict (partner_id) do update set active = false`,
    [ids.get(co), founder],
  );
const choiceFields = (overrides = {}) => ({
  contact_kind: "club",
  porsche_community: false,
  reason_it: "Motivo sintetico.",
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
  fact_source: "https://contatto.example.test/raduno",
  event_name: "",
  event_starts_on: "",
  event_city: "",
  event_country: "",
  event_reachable: false,
  notes_it: "",
  request: "merch_cobranding",
  ...overrides,
});
const completeChoice = (job, decision, choice = choiceFields()) =>
  worker("complete_partner_assistant_choice", {
    job_id: job.job_id,
    lease_token: job.lease_token,
    choice,
    decision,
    model: MODEL,
    rules_version: 1,
  });

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
    "_assistente_partner_worker.sql",
    "_assistente_partner_invio.sql",
    "_partner_sezione_club.sql",
    "_assistente_partner_modello.sql",
    "_assistente_partner_due_lavori.sql",
    "_assistente_partner_ricerca_valida.sql",
  ])
    await db.exec(migration(suffix));
  for (const [userId, name, role] of [
    [founder, "Fondatore sintetico", "founder"],
    [assistant, "Assistente", null],
  ]) {
    await asOwner("insert into auth.users values ($1)", [userId]);
    await asOwner("insert into public.profiles(user_id, display_name) values ($1, $2)", [
      userId,
      name,
    ]);
    if (role)
      await asOwner("insert into public.memberships(user_id, role, active) values ($1, $2, true)", [
        userId,
        role,
      ]);
  }
  eq(
    await as("service_role", null, () =>
      rpc("select public.configure_partner_assistant($1, $2) r", [assistant, founder]),
    ),
    { configured: true },
  );
  await asOwner("update private.partner_assistant_config set mode = 'prepara'");

  // 1. Permessi: la presa del lavoro resta solo a service_role, con le stesse protezioni.
  for (const fn of [
    "private.claim_partner_assistant_step(uuid, integer)",
    "public.claim_partner_assistant_step(uuid, integer)",
  ])
    for (const role of ["anon", "authenticated", "service_role"])
      eq(
        await value(`select has_function_privilege($1, $2, 'execute') as v`, [role, fn]),
        role === "service_role",
        `${fn} per ${role}`,
      );
  ok(
    await value(
      `select prosecdef and proconfig @> array['search_path=""'] as v from pg_proc
       where oid = 'private.claim_partner_assistant_step(uuid, integer)'::regprocedure`,
    ),
    "Security definer e search_path vuoto",
  );

  // 2. Il percorso intero: dall'attesa all'estrazione, senza una ricerca nuova.
  const first = await waiting(951, "5 days");
  const claimed = await claim();
  eq(claimed.status, "claimed");
  eq(claimed.job.step, "estrazione", "La data è arrivata: si riparte dall'estrazione");
  let row = await jobOf(951);
  eq(
    [row.status, row.step, row.attempts, row.rewrites, row.write_on, row.reason, row.draft_id],
    ["in_coda", "estrazione", 0, 0, null, null, null],
  );
  eq(row.research_note_id, first.research, "La stessa ricerca");
  eq(row.choice_note_id, null, "La scelta vecchia non vale più: si rifà con la data di oggi");
  eq(await researchCount(951), 1, "Nessuna ricerca nuova");
  const read = await context(claimed.job);
  eq(read.research.note_id, first.research, "Il contesto dà la ricerca di prima");
  eq(read.research.text, "Ricerca sintetica.");
  eq(read.choice, null);
  // L'estrazione decide di aspettare ancora: si torna in attesa, e di nuovo niente ricerca.
  const later = await value(`select (${ROME_TODAY} + 3)::text as v`);
  eq(
    await completeChoice(
      claimed.job,
      { kind: "attendi", write_on: later },
      choiceFields({ write_now: false, write_on: later }),
    ),
    { status: "done", job_status: "attesa", step: "estrazione", replayed: false },
  );
  eq((await tick()).reason, "vuota", "In attesa fino al giorno giusto");
  await asOwner(
    `update public.partner_assistant_jobs set write_on = ${ROME_TODAY} where partner_id = $1`,
    [first.partnerId],
  );
  const again = await claim();
  eq(again.job.step, "estrazione", "Un'altra data: ancora l'estrazione");
  eq(await researchCount(951), 1, "Ancora nessuna ricerca nuova");
  // L'estrazione decide di scrivere: si prosegue come dopo una ricerca appena fatta.
  eq(await completeChoice(again.job, { kind: "scrivi" }), {
    status: "done",
    job_status: "in_coda",
    step: "scrittura",
    replayed: false,
  });
  row = await jobOf(951);
  eq([row.step, row.research_note_id], ["scrittura", first.research]);
  ok(row.choice_note_id, "La scelta nuova");
  await stop(951);

  // 3. Un club con il testo fisso e una ricerca vera di prima: il modello si compone dall'estrazione.
  const club = await waiting(952, "5 days", 0, { sections: ["club"] });
  const clubJob = await claim();
  eq([clubJob.job.partner_id, clubJob.job.step], [club.partnerId, "estrazione"]);
  const subject = "T-Shirts für die Mitglieder";
  const body =
    "Sehr geehrte Damen und Herren,\n\nTesto sintetico del modello.\n\nVielen Dank und freundliche Grüße";
  const signature = "Tommaso Ieri\nGründer, LuckyLap\n+39 000 000 0001\nhttps://luckylap.com";
  eq(
    await worker("complete_partner_assistant_template", {
      job_id: clubJob.job.job_id,
      lease_token: clubJob.job.lease_token,
      template_version: 1,
      register: "sie",
      timezone: "Europe/Berlin",
      porsche_community: true,
      swiss: false,
      draft: {
        language: "de",
        subject,
        body,
        signature,
        sha256: sha(`${subject}\n\n${body}\n\n${signature}`),
        rules_version: await value(
          "select max(version)::int as v from public.partner_assistant_rules",
        ),
        partner_version: await value(
          "select version::int as v from public.partners where id = $1",
          [club.partnerId],
        ),
        contact_id: await value(
          "select id as v from public.partner_contacts where partner_id = $1 and kind = 'email'",
          [club.partnerId],
        ),
      },
      checks_ok: true,
      failures: [],
    }),
    { status: "done", job_status: "in_coda", step: "controllo", replayed: false },
    "Il modello si salva anche dall'estrazione",
  );
  await stop(952);

  // 4. Tutti i casi nello stesso giro.
  const young = await waiting(953, "13 days 23 hours");
  const past = await waiting(954, "1 day", -3);
  const old = await waiting(955, "14 days 1 minute");
  const future = await waiting(956, "5 days", 1);
  const returned = await queued(957, "5 days", { attempts: 2 });
  await queued(958, null);
  const stale = await queued(959, "20 days");
  const tommi = await queued(960, "5 days", {
    status: "serve_tommaso",
    reason: "troppi_tentativi",
  });
  await queued(961, "5 days", { content: { text: "Bozza dal testo fisso.", template: true } });
  eq((await tick()).status, "claimed");

  row = await jobOf(953);
  eq(
    [row.status, row.step, row.research_note_id, row.choice_note_id, row.write_on],
    ["in_coda", "estrazione", young.research, null, null],
    "13 giorni e 23 ore: la ricerca vale",
  );
  row = await jobOf(954);
  eq(
    [row.status, row.step, row.research_note_id],
    ["in_coda", "estrazione", past.research],
    "Una data già passata vale come quella di oggi",
  );
  row = await jobOf(955);
  eq(
    [row.status, row.step, row.research_note_id, row.choice_note_id, row.write_on],
    ["in_coda", "ricerca", old.research, old.choice, null],
    "14 giorni e un minuto: si rifà la ricerca",
  );
  row = await jobOf(956);
  eq(
    [row.status, row.step, row.research_note_id, row.choice_note_id],
    ["attesa", "estrazione", future.research, future.choice],
    "La data non è arrivata: non cambia niente",
  );
  ok(row.write_on, "La data resta");
  row = await jobOf(957);
  eq(
    [row.status, row.step, row.research_note_id, row.attempts],
    ["in_coda", "estrazione", returned.research, 0],
    "Già tornato alla ricerca prima della migrazione: riparte dall'estrazione",
  );
  row = await jobOf(958);
  eq([row.status, row.step, row.research_note_id], ["in_coda", "ricerca", null], "Contatto nuovo");
  row = await jobOf(959);
  eq(
    [row.status, row.step, row.research_note_id],
    ["in_coda", "ricerca", stale.research],
    "Ricerca di 20 giorni: si rifà, con il margine per l'invio",
  );
  row = await jobOf(960);
  eq(
    [row.status, row.step, row.reason, row.research_note_id],
    ["serve_tommaso", "ricerca", "troppi_tentativi", tommi.research],
    "Un lavoro di Tommi non si tocca",
  );
  row = await jobOf(961);
  eq(
    [row.status, row.step, row.research_note_id, row.choice_note_id],
    ["in_coda", "ricerca", null, null],
    "Note del modello su un contatto che non lo usa più: si riparte dalla ricerca, senza note",
  );
  for (const co of [953, 954, 955, 956, 957, 958, 959, 960, 961]) await stop(co);

  // 5. Una ricerca in corso non si tocca; a lease scaduta il lavoro riparte dall'estrazione.
  const leased = await queued(962, "5 days");
  await asOwner(
    `update public.partner_assistant_jobs set lease_token = gen_random_uuid(),
       lease_expires_at = clock_timestamp() + interval '5 minutes' where partner_id = $1`,
    [leased.partnerId],
  );
  eq((await claim()).reason, "occupato");
  row = await jobOf(962);
  eq(row.step, "ricerca", "Con la lease attiva il passo resta");
  ok(row.lease_token, "La lease resta");
  await asOwner(
    `update public.partner_assistant_jobs set lease_expires_at = clock_timestamp() - interval '1 second'
     where partner_id = $1`,
    [leased.partnerId],
  );
  const resumed = await tick();
  eq([resumed.status, resumed.job.step], ["claimed", "estrazione"]);
  row = await jobOf(962);
  eq([row.step, row.attempts, row.research_note_id], ["estrazione", 0, leased.research]);

  console.log(`PASS ${checks} controlli`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.close();
}
