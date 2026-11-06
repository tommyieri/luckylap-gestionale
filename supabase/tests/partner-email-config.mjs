// test-db: pglite minimo 87
// Versioni della configurazione email, ruoli, ricevute e collegamento alle bozze.
// Auth e schede sintetiche. Nessuna connessione a Supabase o Claude.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) throw new Error("Passare il percorso esterno di PGlite.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const migrations = new URL("../migrations/", import.meta.url);
const fixtureConfig = JSON.parse(
  readFileSync(new URL("../../data/partner-email-config-v1.json", import.meta.url), "utf8"),
);
const founder = randomUUID(),
  colleague = randomUUID(),
  inactiveFounder = randomUUID(),
  outside = randomUUID(),
  assistant = randomUUID();

let checks = 0;
function eq(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  checks++;
}
async function rejects(task, code, message) {
  await assert.rejects(task, { code, ...(message ? { message } : {}) });
  checks++;
}
async function migration(suffix) {
  const files = readdirSync(migrations).filter((name) => name.endsWith(suffix));
  assert.equal(files.length, 1, suffix);
  await db.exec(readFileSync(new URL(files[0], migrations), "utf8"));
}
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const value = async (sql, args = []) => (await rows(sql, args))[0]?.v;

async function as(role, userId, task) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role, sub: userId }),
    ]);
    if (role) await db.exec(`set local role ${role}`);
    const result = await task();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

const signature = "Firma sintetica";
const subject = "Oggetto sintetico";
const body = "Una bozza sintetica per verificare la versione.";
const digest = createHash("sha256").update(`${subject}\n\n${body}\n\n${signature}`).digest("hex");

async function writingJob(co, sections = ["vendita"]) {
  const partnerId = randomUUID();
  await db.query(
    `insert into public.partners(id, co, name, origin, stage, created_by, sections, priority, contact_month)
     values ($1,$2,$3,'team','da_contattare',$4,$5,'media',date '2026-11-01')`,
    [partnerId, co, `Contatto sintetico ${co}`, founder, sections],
  );
  const contactId = await value(
    `insert into public.partner_contacts(partner_id,kind,value,link_value,created_by,updated_by)
     values ($1,'email',$2,$2,$3,$3) returning id as v`,
    [partnerId, `co${co}@partner.example.test`, founder],
  );
  const researchId = await value(
    `insert into public.partner_assistant_notes(partner_id,kind,content,rules_version,operation_id,created_by)
     values ($1,'ricerca',$2,1,gen_random_uuid(),$3) returning id as v`,
    [partnerId, { text: "Ricerca sintetica." }, assistant],
  );
  const lease = randomUUID();
  const jobId = await value(
    `insert into public.partner_assistant_jobs(partner_id,status,step,research_note_id,lease_token,lease_expires_at)
     values ($1,'in_coda','scrittura',$2,$3,clock_timestamp()+interval '5 minutes') returning id as v`,
    [partnerId, researchId, lease],
  );
  return { partnerId, contactId, lease, jobId };
}

function completeDraft(job, extra = {}, operation = randomUUID()) {
  return as("service_role", undefined, () =>
    value("select public.complete_partner_assistant_draft($1,$2) as v", [
      operation,
      {
        schema_version: 1,
        job_id: job.jobId,
        lease_token: job.lease,
        draft: {
          language: "it",
          subject,
          body,
          signature,
          sha256: digest,
          rules_version: 1,
          partner_version: 1,
          contact_id: job.contactId,
          ...extra,
        },
        checks_ok: true,
        failures: [],
      },
    ]),
  );
}

async function readContext(job, legacy = false) {
  const lease = randomUUID();
  await db.query(
    "update public.partner_assistant_jobs set lease_token=$2,lease_expires_at=clock_timestamp()+interval '5 minutes' where id=$1",
    [job.jobId, lease],
  );
  const name = legacy ? "context_partner_assistant_step" : "context_partner_assistant_email_step";
  return as("service_role", undefined, () =>
    value(`select public.${name}($1,$2) as v`, [job.jobId, lease]),
  );
}

function saveConfig({
  actor = founder,
  operation = randomUUID(),
  expected = 1,
  config = fixtureConfig,
  note = null,
  role = "service_role",
  userId,
} = {}) {
  return as(role, userId, () =>
    value("select public.save_partner_email_config($1,$2,$3,$4,$5) as v", [
      actor,
      operation,
      expected,
      config,
      note,
    ]),
  );
}

try {
  // Come negli altri harness, si riproducono i grant automatici di Supabase.
  // Il ruolo servizio qui non salta la RLS, così si verifica anche la sua policy di lettura.
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create role service_role nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create schema storage;
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text,
      metadata jsonb, unique(bucket_id, name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
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
    "_assistente_partner_club_generici.sql",
    "_assistente_partner_prova_allegati.sql",
    "_partner_programma_email.sql",
  ]) {
    await migration(suffix);
  }
  for (const [id, name, role, active] of [
    [founder, "Fondatore sintetico", "founder", true],
    [colleague, "Collega sintetico", "production", true],
    [inactiveFounder, "Fondatore inattivo sintetico", "founder", false],
    [outside, "Persona fuori dal team sintetica", null, false],
    [assistant, "Assistente sintetico", null, false],
  ]) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("insert into public.profiles(user_id, display_name) values($1,$2)", [id, name]);
    if (role) {
      await db.query("insert into public.memberships(user_id, role, active) values($1,$2,$3)", [
        id,
        role,
        active,
      ]);
    }
  }
  await db.query(
    "update private.partner_assistant_config set mode='prepara',actor_id=$1,handoff_to=$2",
    [assistant, founder],
  );

  const oldJob = await writingJob(951);
  eq((await completeDraft(oldJob)).step, "controllo");
  const reviewLease = randomUUID();
  await db.query(
    "update public.partner_assistant_jobs set lease_token=$2,lease_expires_at=clock_timestamp()+interval '5 minutes' where id=$1",
    [oldJob.jobId, reviewLease],
  );
  eq(
    (
      await as("service_role", undefined, () =>
        value("select public.complete_partner_assistant_review($1,$2) as v", [
          randomUUID(),
          {
            schema_version: 1,
            job_id: oldJob.jobId,
            lease_token: reviewLease,
            approved: true,
            problems: [],
            sha256: digest,
            model: "modello-sintetico",
            rules_version: 1,
          },
        ]),
      )
    ).job_status,
    "pronta",
  );
  const jobBefore = await value(
    "select to_jsonb(j) as v from public.partner_assistant_jobs j where id=$1",
    [oldJob.jobId],
  );
  const draftBefore = await value(
    "select to_jsonb(d) as v from public.partner_assistant_drafts d where id=$1",
    [jobBefore.draft_id],
  );
  const rulesBefore = await rows("select * from public.partner_assistant_rules order by version");

  for (const suffix of [
    "_partner_email_config_versions.sql",
    "_partner_email_config_seed.sql",
    "_partner_email_config_draft.sql",
    "_partner_email_config_context.sql",
  ]) {
    await migration(suffix);
  }

  const table = "public.partner_email_config_versions";
  const rpc = "public.save_partner_email_config(uuid,uuid,integer,jsonb,text)";
  const contextRpc = "public.context_partner_assistant_email_step(uuid,uuid)";
  for (const role of ["anon", "authenticated", "service_role"])
    eq(
      await value("select has_function_privilege($1,$2,'EXECUTE') as v", [role, contextRpc]),
      role === "service_role",
    );
  const versions = (role, userId) =>
    as(role, userId, async () =>
      (await rows(`select version from ${table} order by version`)).map((r) => r.version),
    );
  for (const role of ["anon", "authenticated", "service_role"]) {
    eq(
      await value("select has_table_privilege($1,$2,'SELECT') as v", [role, table]),
      role !== "anon",
    );
    eq(
      await value("select has_function_privilege($1,$2,'EXECUTE') as v", [role, rpc]),
      role === "service_role",
    );
    for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      eq(await value("select has_table_privilege($1,$2,$3) as v", [role, table, privilege]), false);
    }
  }
  eq(await versions("authenticated", founder), [1]);
  eq(await versions("authenticated", colleague), [1]);
  eq(await versions("authenticated", inactiveFounder), []);
  eq(await versions("authenticated", outside), []);
  eq(await versions("service_role"), [1]);
  await rejects(() => versions("anon"), "42501");
  eq(
    await rows(`select version, config, note, created_by, operation_id from ${table}`),
    [
      {
        version: 1,
        config: fixtureConfig,
        note: "Configurazione iniziale della prima email.",
        created_by: null,
        operation_id: null,
      },
    ],
    "Il seed SQL coincide con il file JSON",
  );
  await rejects(() => saveConfig({ role: "authenticated", userId: founder }), "42501");
  await rejects(
    () => saveConfig({ actor: colleague }),
    "42501",
    "partner_assistant_founder_required",
  );
  await rejects(
    () => saveConfig({ actor: inactiveFounder }),
    "42501",
    "partner_assistant_founder_required",
  );
  await rejects(
    () => saveConfig({ actor: outside }),
    "42501",
    "partner_assistant_founder_required",
  );
  await rejects(() => saveConfig({ actor: null }), "42501", "partner_assistant_founder_required");

  const operation = randomUUID();
  const config = {
    ...fixtureConfig,
    tono: "  Riga sintetica con accento: qualità.\nSeconda riga.  ",
  };
  const note = "  Nota di prova.\nSu due righe.  ";
  const second = await saveConfig({ operation, config, note });
  eq(Object.keys(second).sort(), ["config", "created_at", "created_by", "note", "version"]);
  eq(second.version, 2);
  eq(second.config, { ...config, meta: { ...config.meta, versione: 2 } });
  eq(second.note, note);
  eq(second.created_by, founder);
  eq(Number.isFinite(Date.parse(second.created_at)), true);
  eq(await value(`select operation_id as v from ${table} where version=2`), operation);
  await rejects(
    () => saveConfig({ operation, config, note: "Nota diversa." }),
    "23505",
    "partner_idempotency_conflict",
  );
  await rejects(() => saveConfig({ config, note }), "40001", "partner_email_config_changed");
  await rejects(() => saveConfig({ expected: 2 }), "22023", "invalid_partner_email_config");
  await rejects(
    () => saveConfig({ expected: 2, config: { ...second.config, blocchi: {} } }),
    "22023",
    "invalid_partner_email_config",
  );
  await rejects(
    () => saveConfig({ expected: 2, config: second.config, note: "n".repeat(1001) }),
    "22023",
    "invalid_partner_email_config",
  );
  const third = await saveConfig({ expected: 2, config: second.config });
  eq(third.version, 3);
  eq(third.config, { ...second.config, meta: { ...second.config.meta, versione: 3 } });
  eq(
    await saveConfig({ operation, config, note }),
    second,
    "Il replay torna alla riga originale dopo altri salvataggi",
  );
  eq(await versions("authenticated", colleague), [1, 2, 3]);

  const withErase = (sql) =>
    as(null, undefined, async () => {
      await db.exec("select set_config('luckylap.partner_assistant.erase','on',true)");
      await db.exec(sql);
    });
  await rejects(() => withErase(`update ${table} set note='Mutazione' where version=1`), "42501");
  await rejects(() => withErase(`delete from ${table} where version=1`), "42501");
  eq(await rows("select * from public.partner_assistant_rules order by version"), rulesBefore);
  eq(
    await value("select to_jsonb(j) as v from public.partner_assistant_jobs j where id=$1", [
      oldJob.jobId,
    ]),
    jobBefore,
  );
  eq(
    await value("select to_jsonb(d) as v from public.partner_assistant_drafts d where id=$1", [
      jobBefore.draft_id,
    ]),
    {
      ...draftBefore,
      config_version: null,
      config_day: null,
    },
  );

  const draftVersion = (job) =>
    value(
      `select d.config_version as v from public.partner_assistant_drafts d
     join public.partner_assistant_jobs j on j.draft_id=d.id where j.id=$1`,
      [job.jobId],
    );
  const legacy = await writingJob(952);
  eq((await completeDraft(legacy)).step, "controllo");
  eq(await draftVersion(legacy), null);
  const legacyContext = await readContext(legacy);
  eq(Object.hasOwn(legacyContext.draft, "config_version"), false);
  eq(Object.hasOwn(legacyContext.draft, "config_day"), false);
  const current = await writingJob(953);
  const draftOperation = randomUUID();
  await rejects(() => completeDraft(current, { config_version: 999 }, draftOperation), "23503");
  eq(await draftVersion(current), undefined, "La FK fallita non scrive una bozza o il puntatore");
  await rejects(() => completeDraft(current, { config_version: null }, draftOperation), "22023");
  eq((await completeDraft(current, { config_version: 2 }, draftOperation)).step, "controllo");
  eq(
    await draftVersion(current),
    2,
    "Una scrittura conserva la propria versione anche se non è più l'ultima",
  );
  eq((await completeDraft(current, { config_version: 2 }, draftOperation)).replayed, true);
  const versionContext = await readContext(current);
  eq(versionContext.draft.config_version, 2);
  eq(Object.hasOwn(versionContext.draft, "config_day"), false);
  const club = await writingJob(954, ["club"]);
  await rejects(() => completeDraft(club, { config_version: 2 }), "22023");
  eq(await draftVersion(club), undefined);

  const configured = await writingJob(955);
  const today = await value("select ((now() at time zone 'Europe/Rome')::date)::text as v");
  await rejects(() => completeDraft(configured, { config_day: today }), "22023");
  await rejects(
    () => completeDraft(configured, { config_version: 2, config_day: "2026-02-30" }),
    "22023",
  );
  eq((await completeDraft(configured, { config_version: 2, config_day: today })).step, "controllo");
  const configuredContext = await readContext(configured);
  eq(configuredContext.draft.config_version, 2);
  eq(configuredContext.draft.config_day, today);
  const { config_version: _version, config_day: _day, ...legacyDraft } = configuredContext.draft;
  eq((await readContext(configured, true)).draft, legacyDraft);

  const midnight = await writingJob(956);
  const yesterday = await value("select ((now() at time zone 'Europe/Rome')::date - 1)::text as v");
  eq(await completeDraft(midnight, { config_version: 2, config_day: yesterday }), {
    status: "contesto_cambiato",
  });
  eq(await draftVersion(midnight), undefined);
  eq(
    await value(
      "select jsonb_build_array(lease_token, attempts) as v from public.partner_assistant_jobs where id=$1",
      [midnight.jobId],
    ),
    [null, 0],
  );

  const extraction = await writingJob(957);
  await db.query("update public.partner_assistant_jobs set step='estrazione' where id=$1", [
    extraction.jobId,
  ]);
  const condition = { format: "negozio", condition_hash: "a".repeat(64) };
  const completeChoice = (evidence, operation = randomUUID()) =>
    as("service_role", undefined, () =>
      value("select public.complete_partner_assistant_choice($1,$2) as v", [
        operation,
        {
          schema_version: 1,
          job_id: extraction.jobId,
          lease_token: extraction.lease,
          choice: {
            contact_kind: "negozio",
            porsche_community: false,
            reason_it: "Motivo sintetico.",
            write_now: true,
            write_on: "",
            recipient_email: "",
            recipient_email_source: "",
            recipient_email_published_by_org: false,
            person_name: "",
            person_title: "",
            language: "it",
            register: "voi",
            swiss: false,
            timezone: "Europe/Rome",
            fact_text: "Fatto sintetico.",
            fact_date: "",
            fact_source: "",
            event_name: "",
            event_starts_on: "",
            event_city: "",
            event_country: "",
            event_reachable: false,
            notes_it: "",
            request: "vendita_negozio",
          },
          decision: { kind: "scrivi" },
          model: "modello-sintetico",
          rules_version: 1,
          possibility_evidence: evidence,
        },
      ]),
    );
  await rejects(() => completeChoice(null), "22023");
  await rejects(() => completeChoice([{ ...condition, format: "club" }]), "22023");
  await rejects(() => completeChoice([{ ...condition, condition_hash: "A".repeat(64) }]), "22023");
  await rejects(() => completeChoice(Array(161).fill(condition)), "22023");
  const extractionOperation = randomUUID();
  eq((await completeChoice([condition], extractionOperation)).step, "scrittura");
  eq((await completeChoice([condition], extractionOperation)).replayed, true);
  const extractedChoice = (await readContext(extraction)).choice.content;
  eq(extractedChoice.possibility_evidence, [condition]);
  const { possibility_evidence: _evidence, ...legacyChoice } = extractedChoice;
  eq((await readContext(extraction, true)).choice.content, legacyChoice);

  console.log(`PASS ${checks} controlli`);
} catch (error) {
  console.error(error.message, error.code, error.where ?? error.stack);
  process.exitCode = 1;
} finally {
  await db.close();
}
