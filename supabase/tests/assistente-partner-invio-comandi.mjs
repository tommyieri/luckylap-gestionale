// test-db: pglite minimo 241
// Assistente Partner, consegna 2a, compito 1 (_assistente_partner_invio.sql, sezione 1): limite delle
// prime email, conferma della prova, priorità d'invio, stato della casella con variabili e accessi,
// messaggi con la guardia, ordine d'invio, «Manda la prova», «Riprendi l'invio», modalità «prova» e
// «invio», interruttore, regole, cancellazione definitiva e promemoria di sollecito per l'origine
// «assistente». Migrazioni applicate in ordine su PGlite, auth.uid() come in produzione, permessi
// predefiniti di Supabase sullo schema public. Solo dati sintetici (schede 951-970 di
// fixtures/partner-assistant/coda.json, poi CO da 971 in su, domini example.test), nessun accesso
// cloud.
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
const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));

const fixtureId = (n) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const founder = fixtureId(901),
  consultant = fixtureId(902),
  formerFounder = fixtureId(903),
  assistant = fixtureId(990);
const PEOPLE = { founder, consultant };
const sha = (text) => createHash("sha256").update(text).digest("hex");
const MODEL = "claude-opus-5-5";
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();

const migrations = new URL("../migrations/", import.meta.url);
const migration = (suffix) => {
  const names = readdirSync(migrations).filter((n) => n.endsWith(suffix));
  assert.equal(names.length, 1, `Una sola migrazione ${suffix}`);
  return readFileSync(new URL(names[0], migrations), "utf8");
};
const fixture = JSON.parse(
  readFileSync(new URL("fixtures/partner-assistant/coda.json", import.meta.url), "utf8"),
);
// Le 23 chiavi della scelta (Appendice C), lette dal codice: la nota «scelta» di prova le ha tutte.
const CHOICE_KEYS = [
  ...readFileSync(
    new URL("../../src/lib/partner-assistant/choice-fields.ts", import.meta.url),
    "utf8",
  )
    .match(/PARTNER_ASSISTANT_CHOICE_KEYS = \[([\s\S]*?)\]/)[1]
    .matchAll(/"([a-z_]+)"/g),
].map((m) => m[1]);

const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const value = async (sql, args = []) => (await one(sql, args))?.v;

// La versione della configurazione, riletta dopo ogni transazione: v() la dà ai payload.
let configVersion = null;
const v = () => configVersion;
const refreshVersion = async () => {
  configVersion = await value("select version::int as v from private.partner_assistant_config");
};
// Il proprietario del database: nessun ruolo client, nessun claim.
const asOwner = async (sql, args) => {
  try {
    return args ? await db.query(sql, args) : await db.exec(sql);
  } finally {
    await refreshVersion();
  }
};

// Un ruolo client con il suo JWT, come PostgREST: claims locali e set local role. Con now, l'ora
// dell'assistente (private.partner_assistant_now) è quella, solo in questa transazione.
const CLIENT_ROLES = new Set(["anon", "authenticated", "service_role"]);
async function as(role, sub, fn, { now } = {}) {
  assert.ok(CLIENT_ROLES.has(role), `Ruolo sconosciuto: ${role}`);
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(sub ? { sub, role } : { role }),
    ]);
    if (now) await db.query("select set_config('luckylap.partner_assistant.now', $1, true)", [now]);
    await db.exec(`set local role ${role}`);
    const out = await fn();
    await db.exec("commit");
    return out;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  } finally {
    await refreshVersion();
  }
}
const asService = (fn) => as("service_role", null, fn);
const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r;
const cmd = (name, payload, op = randomUUID()) =>
  rpc(`select public.${name}($1, $2::jsonb) r`, [
    op,
    JSON.stringify({ schema_version: 1, ...payload }),
  ]);
const cmd_founder = (name, payload, options) =>
  as("authenticated", founder, () => cmd(name, payload), options);
const cmd_consultant = (name, payload) => as("authenticated", consultant, () => cmd(name, payload));

// Schede e contatti.
const ids = new Map();
const p = (co) => {
  assert.ok(ids.has(co), `CO ${co} non creato`);
  return ids.get(co);
};
const coOf = (partnerId) => [...ids].find(([, x]) => x === partnerId)?.[0];
const draftIds = new Map();
const draftOf = (co) => draftIds.get(p(co));

const rankingCos = async (day) =>
  (
    await db.query("select co from private.partner_assistant_ranking($1::date) order by rank", [
      day,
    ])
  ).rows.map((r) => r.co);
const setPriority = (co, priority) =>
  asOwner(
    `insert into public.partner_assistant_contacts as s (partner_id, active, send_priority, updated_by)
       values ($1, true, $2, $3)
     on conflict (partner_id) do update set send_priority = excluded.send_priority`,
    [p(co), priority, founder],
  );
const configRow = () =>
  one(
    `select mode, version::int as version, daily_first_limit, test_confirmed_at, test_confirmed_by,
       paused_reason, backoff_until, starting_credit_usd::text as starting_credit_usd
       from private.partner_assistant_config`,
  );
const mailState = () => one("select * from private.partner_assistant_mail_state");
const lastEvent = () =>
  one(
    "select partner_id, step, outcome from private.partner_assistant_events order by created_at desc, id desc limit 1",
  );
const job = (partnerId) =>
  one(
    `select status, step, reason, draft_id, research_note_id, choice_note_id
       from public.partner_assistant_jobs where partner_id = $1`,
    [partnerId],
  );
const switchRow = (partnerId) =>
  one(
    `select active, reason, send_priority, version::int as version
       from public.partner_assistant_contacts where partner_id = $1`,
    [partnerId],
  );
const setSwitch = (partnerId, active) =>
  cmd_consultant("set_partner_assistant_contact", { partner_id: partnerId, active });
// Lavoro del contatto come proprietario: crea la riga se manca, altrimenti cambia stato e motivo.
const setJob = (partnerId, { status, reason = null, step = null }) =>
  asOwner(
    `insert into public.partner_assistant_jobs(partner_id, status, step, reason)
       values ($1, $2, coalesce($3, 'controllo'), $4)
     on conflict (partner_id) do update set status = excluded.status, reason = excluded.reason,
       step = coalesce($3, public.partner_assistant_jobs.step), updated_at = now()`,
    [partnerId, status, step, reason],
  );
const countRows = async (partnerId, tables) => {
  let total = 0;
  for (const t of tables)
    total += await value(
      `select count(*)::int as v from public.partner_assistant_${t} where partner_id = $1`,
      [partnerId],
    );
  return total;
};
const eraseContactOf = (partnerId) =>
  asOwner(
    `update public.partner_contacts set value = null, link_value = null, label = '', research_value = null,
       active = false, erased_at = now(), erased_by = $2, version = version + 1
     where partner_id = $1 and kind = 'email'`,
    [partnerId, founder],
  );

// Scheda «Club Sintetico <co>» del team, con un'email attiva.
async function scheda(co, { country = "Italia", email, sourceKey = null } = {}) {
  const partnerId = randomUUID();
  ids.set(co, partnerId);
  await asOwner(
    `insert into public.partners(id, co, source_key, name, origin, stage, created_by, sections, priority,
       contact_month, country)
     values ($1, $2, $3, $4, case when $3::text is null then 'team' else 'research' end, 'da_contattare', $5,
       array['collab'], 'media', date '2026-11-01', $6)`,
    [partnerId, co, sourceKey, `Club Sintetico ${co}`, founder, country],
  );
  const address = email ?? `info@club-${co}.example.test`;
  await asOwner(
    `insert into public.partner_contacts(partner_id, kind, value, link_value, created_by, updated_by)
     values ($1, 'email', $2, $2, $3, $3)`,
    [partnerId, address, founder],
  );
  return partnerId;
}

// La scelta dell'estrazione: le 23 chiavi dell'Appendice C più la richiesta.
const choiceOf = (overrides = {}) => ({
  contact_kind: "club",
  porsche_community: false,
  reason_it: "Club: si propongono magliette co-firmate.",
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
  fact_text: "Raduno sintetico di ottobre.",
  fact_date: "2026-10-01",
  fact_source: "https://club.example.test/raduno",
  event_name: "",
  event_starts_on: "",
  event_city: "",
  event_country: "",
  event_reachable: false,
  notes_it: "",
  request: "merch_cobranding",
  ...overrides,
});
const SIGNATURE = "Tommaso\nFounder, LuckyLap\nluckylap.com | Instagram @lucky.lap";

// Un contatto con la bozza pronta, come lo lascia la consegna 1: scheda, recapito, ricerca, scelta,
// bozza con l'impronta di oggetto, testo e firma, seconda lettura approvata con quell'impronta e
// lavoro «pronta» al passo «controllo». Tutto come proprietario, scritto dall'assistente.
async function readyFirst(
  co,
  {
    tz = "Europe/Rome",
    country = "Italia",
    sendPriority = 0,
    researchDaysAgo = 3,
    eventStartsOn = "",
    email,
  } = {},
) {
  const partnerId = await scheda(co, { country, email });
  if (sendPriority) await setPriority(co, sendPriority);
  const contactId = await value(
    "select id as v from public.partner_contacts where partner_id = $1 and kind = 'email'",
    [partnerId],
  );
  const research = await value(
    `insert into public.partner_assistant_notes(partner_id, kind, content, sources, rules_version, model,
       operation_id, created_by, created_at)
     values ($1, 'ricerca', jsonb_build_object('text', 'Ricerca sintetica del CO ' || $2::text), array['https://club.example.test/notizie'],
       1, $3, gen_random_uuid(), $4, now() - make_interval(days => $5))
     returning id as v`,
    [partnerId, co, MODEL, assistant, researchDaysAgo],
  );
  const choice = choiceOf({
    timezone: tz,
    event_starts_on: eventStartsOn,
    ...(eventStartsOn ? { contact_kind: "evento", event_name: `Raduno Sintetico ${co}` } : {}),
  });
  const choiceId = await value(
    `insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model, operation_id,
       created_by)
     values ($1, 'scelta', $2::jsonb, 1, $3, gen_random_uuid(), $4) returning id as v`,
    [partnerId, JSON.stringify({ ...choice, decision: { kind: "scrivi" } }), MODEL, assistant],
  );
  const subject = `LuckyLap e Club Sintetico ${co}`;
  const body = `Testo sintetico della prima email per il CO ${co}.`;
  const digest = sha(`${subject}\n\n${body}\n\n${SIGNATURE}`);
  const draftId = await value(
    `insert into public.partner_assistant_drafts(partner_id, contact_id, partner_version, language, subject, body,
       signature, sha256, rules_version, research_note_id, operation_id, created_by)
     select $1, $2, p.version, 'it', $3, $4, $5, $6, 1, $7, gen_random_uuid(), $8
       from public.partners p where p.id = $1
     returning id as v`,
    [partnerId, contactId, subject, body, SIGNATURE, digest, research, assistant],
  );
  await asOwner(
    `insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model, operation_id,
       created_by)
     values ($1, 'controllo', jsonb_build_object('approved', true, 'problems', '[]'::jsonb, 'sha256', $2::text), 1, $3,
       gen_random_uuid(), $4)`,
    [partnerId, digest, MODEL, assistant],
  );
  await asOwner(
    `insert into public.partner_assistant_jobs(partner_id, status, step, research_note_id, choice_note_id, draft_id)
     values ($1, 'pronta', 'controllo', $2, $3, $4)`,
    [partnerId, research, choiceId, draftId],
  );
  draftIds.set(partnerId, draftId);
  return partnerId;
}

// Una prova a mano, come proprietario.
const newTestRun = (drafts) =>
  value(
    `insert into private.partner_assistant_test_runs(draft_ids, recipients, requested_by)
     values ($1::uuid[], 1, $2) returning id as v`,
    [`{${drafts.join(",")}}`, founder],
  );
const runDrafts = (runId) =>
  value(
    "select array_to_json(draft_ids) as v from private.partner_assistant_test_runs where id = $1",
    [runId],
  );
// Un messaggio come proprietario, con giorno e ora d'invio dove lo stato li chiede.
async function insertMessage({
  partner,
  kind = "primo",
  mode = "invio",
  send_status = "pronto",
  test_run_id,
  test_index,
  raw,
  sha256,
  to_address,
}) {
  const co = coOf(partner);
  const draftId = draftIds.get(partner);
  assert.ok(draftId, `Il CO ${co} non ha una bozza`);
  if (mode === "prova") {
    test_index ??= 0;
    test_run_id ??= await newTestRun([draftId]);
  }
  const subject = `LuckyLap e Club Sintetico ${co}`;
  const body = `Testo sintetico della prima email per il CO ${co}.\n\n${SIGNATURE}`;
  raw ??= `Subject: ${subject}\r\n\r\n${body.replaceAll("\n", "\r\n")}\r\n`;
  sha256 ??= sha(raw);
  to_address ??= `info@club-${co}.example.test`;
  return value(
    `insert into public.partner_assistant_messages(partner_id, draft_id, kind, mode, send_status, test_run_id,
       test_index, message_id, to_address, subject, body, raw, sha256, rules_version, lease_token, send_day,
       sent_at, operation_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1, gen_random_uuid(),
       case when $5 in ('in_invio', 'inviato', 'incerto', 'respinto') then (now() at time zone 'Europe/Rome')::date end,
       case when $5 in ('inviato', 'incerto') then now() end, gen_random_uuid(), $14)
     returning id as v`,
    [
      partner,
      draftId,
      kind,
      mode,
      send_status,
      test_run_id ?? null,
      test_index ?? null,
      `<${randomUUID()}@luckylap.example.test>`,
      to_address,
      subject,
      body,
      raw,
      sha256,
      assistant,
    ],
  );
}
// Lo stato in avanti, con giorno e ora d'invio come li scriverebbe il worker.
const forward = (id, status) =>
  `update public.partner_assistant_messages set send_status = '${status}',
     send_day = coalesce(send_day, (now() at time zone 'Europe/Rome')::date),
     sent_at = case when '${status}' in ('inviato', 'incerto') then coalesce(sent_at, now()) else sent_at end,
     updated_at = now()
   where id = '${id}'`;

// Modalità e giri del worker.
const setMode = (mode) =>
  cmd_founder("set_partner_assistant_mode", { mode, expected_version: v() });
const setModeOwner = (mode) =>
  asOwner("update private.partner_assistant_config set mode = $1", [mode]);
const WORKER = randomUUID();
let lastClaim = null;
const claimStep = async () => {
  const r = await asService(() =>
    rpc("select public.claim_partner_assistant_step($1, $2) r", [WORKER, 360]),
  );
  if (r.job) lastClaim = r.job;
  return r;
};
const releaseStep = () =>
  asService(() =>
    rpc("select public.fail_partner_assistant_step($1, $2, 'rilascia', 'fermato') r", [
      lastClaim.job_id,
      lastClaim.lease_token,
    ]),
  );
const checkpointStep = () =>
  asService(() =>
    rpc("select public.checkpoint_partner_assistant_step($1, $2) r", [
      lastClaim.job_id,
      lastClaim.lease_token,
    ]),
  );
const checkpointReason = async () => (await checkpointStep()).reason;
async function claimStepAfterSetMode(mode) {
  await setModeOwner(mode);
  const r = await claimStep();
  if (r.status === "claimed") await releaseStep();
  return r;
}

// Registro: righe come le scrivono i comandi, con l'ora indicata.
const logAs = (actor, partnerId, { kind, origin = "team", at = null, stageAfter = null }) =>
  asOwner(
    `select private.partner_log(gen_random_uuid(), $1, $2::text, $3,
       p_stage_before => case when $5::text is null then null else 'da_contattare' end, p_stage_after => $5::text,
       p_channel => case when $2::text = 'inviato' then 'email' end,
       p_message_kind => case when $2::text = 'inviato' then 'primo' end,
       p_origin => $4::text, p_occurred_at => $6::timestamptz)`,
    [partnerId, kind, actor, origin, stageAfter, at],
  );
// Come finish della sezione 2: stato «Contattato» e riga «inviato» con origine «assistente», scritti
// dall'assistente.
async function assistantFirstSend(partnerId, at) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: assistant, role: "service_role" }),
    ]);
    const op = randomUUID();
    await db.query("select private.apply_partner_stage($1, 'contattato', $2, $3, false)", [
      partnerId,
      assistant,
      op,
    ]);
    await db.query(
      `select private.partner_log($1, $2, 'inviato', $3, p_stage_before => 'da_contattare',
         p_stage_after => 'contattato', p_channel => 'email', p_message_kind => 'primo',
         p_origin => 'assistente', p_occurred_at => $4::timestamptz)`,
      [op, partnerId, assistant, at],
    );
    await db.exec("commit");
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const teamSend = (partnerId, at, actor = consultant) =>
  logAs(actor, partnerId, { kind: "inviato", at });
const teamBackdatedSend = (partnerId, at, actor = consultant) =>
  logAs(actor, partnerId, { kind: "inviato", at });
const teamReply = (partnerId, at = "2026-10-30T09:00:00Z", actor = consultant) =>
  logAs(actor, partnerId, { kind: "risposta", at });
const followUps = async (partnerId) =>
  (
    await db.query(
      `select t.id, t.title, t.description, t.status, t.assigned_to, t.created_by, l.created_by as link_created_by,
         to_char(t.due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as due_at
         from public.partner_work_links l join public.tasks t on t.id = l.task_id
        where l.kind = 'follow_up' and l.partner_id = $1 order by t.created_at, t.id`,
      [partnerId],
    )
  ).rows;
const followUpTask = async (partnerId) => (await followUps(partnerId)).at(-1);
const followUpTaskCount = async (partnerId) => (await followUps(partnerId)).length;
const todayAs = (sub, day) =>
  as("authenticated", sub, () => rpc("select public.read_partner_today($1::date) r", [day]));
const deviceFile = (device, exportedAt, stages) => {
  const text = JSON.stringify({ device, exportedAt, stages, nonce: randomUUID() });
  return {
    schema_version: 1,
    file_sha256: sha(text),
    device,
    exported_at: exportedAt,
    stages,
    texts: {},
    approaches: {},
    names: {},
  };
};

// I casi di partner-oggi-fixes.mjs sulla definizione nuova del trigger: sollecito dal file, invio
// retrodatato, chiusura con «Non contattare» e con «chiuso».
async function rerunOggiFixesCases() {
  const fromFile = await scheda(995, { sourceKey: "S995" });
  const exportedAt = days(-10);
  const imported = await cmd_consultant(
    "import_partner_device_file",
    deviceFile("telefono", exportedAt, { S995: "contattato" }),
  );
  eq(imported.stages_applied, 1, "File: lo stato si applica");
  const fileTask = await followUpTask(fromFile);
  eq(
    pick(fileTask, [
      "title",
      "status",
      "assigned_to",
      "created_by",
      "link_created_by",
      "description",
    ]),
    {
      title: "Sollecito · Club Sintetico 995",
      status: "todo",
      assigned_to: consultant,
      created_by: consultant,
      link_created_by: consultant,
      description: "Partner CO 995 · /partner?co=995#lead-995",
    },
    "«Contattato» dal file: sollecito a chi ha caricato il file",
  );
  eq(
    await value(
      `select ((t.due_at at time zone 'Europe/Rome')::date - ($2::timestamptz at time zone 'Europe/Rome')::date)
         || ' ' || (t.due_at at time zone 'Europe/Rome')::time::text as v from public.tasks t where t.id = $1`,
      [fileTask.id, exportedAt],
    ),
    "7 00:00:00",
    "Scadenza alla mezzanotte di Roma, 7 giorni dopo l'esportazione",
  );

  const backdated = await scheda(996);
  await teamSend(backdated, days(-1));
  eq(await followUpTaskCount(backdated), 1, "Invio del team: un sollecito");
  await teamBackdatedSend(backdated, days(-5));
  await asOwner(
    `insert into public.partner_activities(operation_id, partner_id, partner_name, partner_co, kind, origin,
       occurred_at, message_kind, created_by)
     values (gen_random_uuid(), $1, 'Club Sintetico 996', 996, 'inviato', 'file', $2::timestamptz, 'primo', $3)`,
    [backdated, days(-6), consultant],
  );
  eq(await followUpTaskCount(backdated), 1, "Invii retrodatati (team e file): nessun sollecito");
  eq((await followUpTask(backdated)).status, "todo", "…e quello del ciclo recente resta aperto");

  const blocked = await scheda(997);
  await teamSend(blocked, days(-1));
  eq((await followUpTask(blocked)).status, "todo");
  await cmd_consultant("set_partner_do_not_contact", {
    partner_id: blocked,
    active: true,
    reason: "Motivo sintetico",
  });
  eq((await followUpTask(blocked)).status, "done", "«Non contattare» chiude il sollecito");

  const agreed = await scheda(998);
  await teamSend(agreed, days(-1));
  await asOwner("select private.apply_partner_stage($1, 'chiuso', $2, gen_random_uuid(), true)", [
    agreed,
    founder,
  ]);
  eq((await followUpTask(agreed)).status, "done", "«chiuso» chiude il sollecito");
}

const canExecute = (role, signature) =>
  value("select has_function_privilege($1, $2, 'EXECUTE') as v", [role, signature]);
const canSelect = (role, table) =>
  value("select has_table_privilege($1, $2, 'SELECT') as v", [role, table]);
const canWrite = (role, table) =>
  value(
    `select has_table_privilege($1, $2, 'INSERT') or has_table_privilege($1, $2, 'UPDATE')
       or has_table_privilege($1, $2, 'DELETE') or has_table_privilege($1, $2, 'TRUNCATE') as v`,
    [role, table],
  );
// Ogni funzione dell'elenco esiste e ha search_path vuoto.
const searchPathEmpty = async (signatures) => {
  const rows = (
    await db.query(
      `select s, p.proconfig from jsonb_array_elements_text($1::jsonb) s
         left join pg_proc p on p.oid = to_regprocedure(s)`,
      [JSON.stringify(signatures)],
    )
  ).rows;
  return rows.every((r) => JSON.stringify(r.proconfig) === JSON.stringify(['search_path=""']));
};

const TEAM_COMMANDS = [
  "start_partner_assistant_test",
  "confirm_partner_assistant_test",
  "set_partner_assistant_send_priority",
  "resume_partner_assistant_send",
  "set_partner_assistant_settings",
];
const NEW_HELPERS = [
  "private.partner_assistant_now()",
  "private.partner_assistant_rome_day(timestamptz)",
  "private.partner_assistant_message_guard()",
  "private.partner_assistant_send_order()",
];
const REPLACED_FUNCTIONS = [
  "private.partner_assistant_ranking(date)",
  "private.partner_assistant_erase(uuid)",
  "private.partner_work_activity_trigger()",
  "private.claim_partner_assistant_step(uuid,integer)",
  "private.checkpoint_partner_assistant_step(uuid,uuid)",
  "private.set_partner_assistant_mode(uuid,jsonb)",
  "private.set_partner_assistant_contact(uuid,jsonb)",
  "private.save_partner_assistant_rules(uuid,jsonb)",
];
const NEW_AND_REPLACED_FUNCTIONS = [
  ...NEW_HELPERS,
  ...TEAM_COMMANDS.flatMap((f) => [`private.${f}(uuid,jsonb)`, `public.${f}(uuid,jsonb)`]),
  ...REPLACED_FUNCTIONS,
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
    "_assistente_partner_worker.sql",
  ])
    await db.exec(migration(suffix));

  // 1. La migrazione: transazione unica, nessuna estensione, nessuna dichiarazione di IA.
  const sql = migration("_assistente_partner_invio.sql");
  ok(/^begin;$/m.test(sql) && /^commit;\s*$/m.test(sql), "Migrazione tra begin e commit");
  eq(/create\s+extension/i.test(sql), false, "Nessuna estensione nuova");
  eq(/ai_disclosure/i.test(sql), false, "niente dichiarazione di IA");
  ok(
    /^-- Codici d'errore \(messaggio = codice\): /m.test(sql),
    "Riga dei codici d'errore in testa",
  );
  await db.exec(sql);
  await refreshVersion();

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
  eq(
    await asService(() =>
      rpc("select public.configure_partner_assistant($1, $2) r", [assistant, founder]),
    ),
    { configured: true },
  );
  for (const f of fixture.partners) {
    const partnerId = randomUUID();
    ids.set(f.co, partnerId);
    await asOwner(
      `insert into public.partners(id, co, name, origin, stage, created_by, sections, priority, contact_month,
         country, owner_id, research_removed_at)
       values ($1, $2, $3, 'team', $4, $5, string_to_array($6, ','), $7, ($8 || '-01')::date, $9, $10,
         case when $11 then now() end)`,
      [
        partnerId,
        f.co,
        f.name,
        f.stage ?? "da_contattare",
        founder,
        f.sections.join(","),
        f.priority,
        f.contact_month,
        f.country,
        f.owner ? PEOPLE[f.owner] : null,
        f.research_removed === true,
      ],
    );
    for (const c of f.contacts) {
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
    for (const a of f.activities ?? [])
      await asOwner(
        `insert into public.partner_activities(operation_id, partner_id, partner_name, partner_co, kind, origin, created_by)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [partnerId, f.name, f.co, a.kind, a.origin, founder],
      );
    if (f.do_not_contact)
      await asOwner(
        "insert into public.partner_do_not_contact(partner_id, domain, reason, created_by) values ($1, $2, 'Motivo sintetico', $3)",
        [f.do_not_contact.partner ? partnerId : null, f.do_not_contact.domain ?? null, founder],
      );
    if (f.assistant)
      await asOwner(
        "insert into public.partner_assistant_contacts(partner_id, active, updated_by) values ($1, $2, $3)",
        [partnerId, f.assistant.active, founder],
      );
  }

  // 2. Classifica, prima di ogni readyFirst: con priorità 0 l'ordine dei CO di coda.json è quello
  //    di oggi; send_priority mette un contatto per primo anche nella preparazione con Claude.
  const expectedOrder = fixture.partners
    .filter((f) => f.expected)
    .sort((a, b) => a.expected - b.expected)
    .map((f) => f.co);
  const fixtureCos = new Set(fixture.partners.map((f) => f.co));
  eq(
    (await rankingCos("2026-10-27")).filter((co) => fixtureCos.has(co)),
    expectedOrder,
  );
  await setPriority(expectedOrder.at(-1), 9);
  eq((await rankingCos("2026-10-27"))[0], expectedOrder.at(-1), "send_priority per prima");
  await setPriority(expectedOrder.at(-1), 0);
  eq(await rankingCos("2026-10-27"), expectedOrder, "Priorità tolta: l'ordine di prima");

  // 3. Dati nuovi: valori iniziali e vincoli.
  eq(pick(await configRow(), ["daily_first_limit", "test_confirmed_at", "test_confirmed_by"]), {
    daily_first_limit: 10,
    test_confirmed_at: null,
    test_confirmed_by: null,
  });
  eq(
    pick(await mailState(), [
      "stop_reason",
      "lease_token",
      "soft_failures",
      "hard_failures",
      "day_stopped_on",
    ]),
    {
      stop_reason: null,
      lease_token: null,
      soft_failures: 0,
      hard_failures: 0,
      day_stopped_on: null,
    },
  );
  eq(
    pick(await mailState(), [
      "env_checked_at",
      "env_mailbox_ok",
      "env_test_ok",
      "env_test_count",
      "smtp_login_code",
      "imap_login_code",
    ]),
    {
      env_checked_at: null,
      env_mailbox_ok: null,
      env_test_ok: null,
      env_test_count: null,
      smtp_login_code: null,
      imap_login_code: null,
    },
  );
  ok((await mailState()).id, "Lo stato della casella ha un id");
  eq(
    await value("select count(*)::int as v from private.partner_assistant_mail_state"),
    1,
    "Una sola riga",
  );
  await rejects(
    () => asOwner("insert into private.partner_assistant_mail_state default values"),
    "23505",
  );
  await rejects(
    () => asOwner("update private.partner_assistant_config set daily_first_limit = 16"),
    "23514",
  );
  await rejects(
    () => asOwner("update public.partner_assistant_contacts set send_priority = 10"),
    "23514",
  );
  await rejects(
    () =>
      asOwner(
        "update private.partner_assistant_mail_state set env_test_ok = true, env_test_count = 0",
      ),
    "23514",
  );
  await rejects(
    () =>
      asOwner(
        "update private.partner_assistant_mail_state set env_test_ok = false, env_test_count = 2",
      ),
    "23514",
  );
  await rejects(
    () => asOwner("update private.partner_assistant_mail_state set env_test_ok = true"),
    "23514",
  ); // nemmeno a metà, con il conteggio nullo
  await asOwner(
    "update private.partner_assistant_mail_state set env_test_ok = true, env_test_count = 3, smtp_login_code = 'ok'",
  );
  await rejects(
    () => asOwner("update private.partner_assistant_mail_state set smtp_login_code = 'Rifiutato'"),
    "23514",
  );
  await rejects(
    () => asOwner("update private.partner_assistant_mail_state set stop_reason = 'credito'"),
    "23514",
  );
  await asOwner(
    "update private.partner_assistant_mail_state set env_test_ok = null, env_test_count = null, smtp_login_code = null",
  );
  await scheda(971);
  await setJob(p(971), { status: "inviata" });
  eq((await job(p(971))).status, "inviata", "Stato nuovo del lavoro");
  await rejects(() => setJob(p(971), { status: "spedita" }), "23514");
  await rejects(() => logAs(assistant, p(971), { kind: "nota", origin: "robot" }), "23514");
  await logAs(assistant, p(971), { kind: "nota", origin: "assistente" });
  eq(
    await value(
      "select count(*)::int as v from public.partner_activities where partner_id = $1 and origin = 'assistente'",
      [p(971)],
    ),
    1,
    "Origine «assistente» ammessa",
  );

  // 4. Messaggi: «mai due volte», la prova non conta, testo grezzo e impronta, guardia.
  eq(CHOICE_KEYS.length, 23, "Le 23 chiavi della scelta");
  eq(
    Object.keys(choiceOf())
      .filter((k) => k !== "request")
      .sort(),
    [...CHOICE_KEYS].sort(),
    "La scelta di prova ha le chiavi del codice",
  );
  await readyFirst(972);
  await readyFirst(973);
  const m = await insertMessage({ partner: p(972), mode: "invio", send_status: "pronto" });
  ok(m, "Prima email vera preparata");
  await rejects(
    () => insertMessage({ partner: p(972), mode: "invio", send_status: "pronto" }),
    "23505",
  ); // una sola prima email vera
  await insertMessage({ partner: p(972), mode: "prova", test_index: 0 }); // la prova non conta
  await rejects(() => insertMessage({ partner: p(973), raw: "Subject: è" }), "23514"); // raw solo ASCII
  await rejects(() => insertMessage({ partner: p(973), sha256: "0".repeat(64) }), "23514");
  await rejects(
    () => insertMessage({ partner: p(973), to_address: "Info@Club.example.test" }),
    "23514",
  );
  await rejects(
    () => insertMessage({ partner: p(973), to_address: "o'neil@club.example.test" }),
    "23514",
  );
  const anyRun = await newTestRun([draftOf(972)]);
  await rejects(
    () => insertMessage({ partner: p(973), mode: "invio", test_run_id: anyRun, test_index: 0 }),
    "23514",
  ); // un invio vero non appartiene a una prova
  await rejects(() => insertMessage({ partner: p(973), mode: "invio", test_index: 2 }), "23514");
  await rejects(() => insertMessage({ partner: p(973), kind: "sollecito" }), "23514");
  await rejects(
    () => asOwner(`update public.partner_assistant_messages set body = 'x' where id = '${m}'`),
    "42501",
  );
  await rejects(
    () =>
      asOwner(
        `update public.partner_assistant_messages set send_status = 'inviato', sent_at = now(), send_day = current_date where id = '${m}'`,
      ),
    "42501",
    "partner_assistant_message_immutable",
  ); // pronto → inviato salta in_invio
  await rejects(
    () =>
      asOwner(`update public.partner_assistant_messages set appended_at = now() where id = '${m}'`),
    "42501",
  ); // la copia in «Posta inviata» solo su un inviato
  await asOwner(forward(m, "in_invio"));
  await asOwner(forward(m, "inviato"));
  await asOwner(
    `update public.partner_assistant_messages set smtp_code = 250, enhanced_code = '2.0.0', outcome = 'inviato',
       appended_at = now() where id = '${m}'`,
  );
  await rejects(
    () =>
      asOwner(
        `update public.partner_assistant_messages set appended_at = now() + interval '1 minute' where id = '${m}'`,
      ),
    "42501",
  );
  await rejects(() => asOwner(forward(m, "pronto")), "42501");
  await rejects(() => asOwner(forward(m, "incerto")), "42501");
  await rejects(
    () => asOwner(`delete from public.partner_assistant_messages where id = '${m}'`),
    "42501",
  );
  eq(
    await value(
      "select send_status || ' ' || smtp_code || ' ' || (appended_at is not null) as v from public.partner_assistant_messages where id = $1",
      [m],
    ),
    "inviato 250 true",
    "Il messaggio resta inviato",
  );
  // Fuori dalla coda d'invio: 972 è partito, 973 resta a Tommi.
  await setJob(p(972), { status: "inviata" });
  await setJob(p(973), { status: "serve_tommaso", reason: "controlli_falliti" });

  // 5. Modalità «prova» e «invio».
  await rejects(
    () =>
      as("authenticated", consultant, () =>
        cmd("set_partner_assistant_mode", { mode: "prova", expected_version: v() }),
      ),
    "42501",
  );
  eq(
    (
      await as("authenticated", founder, () =>
        cmd("set_partner_assistant_mode", { mode: "prova", expected_version: v() }),
      )
    ).mode,
    "prova",
  );
  await rejects(
    () =>
      as("authenticated", founder, () =>
        cmd("set_partner_assistant_mode", { mode: "invio", expected_version: v() }),
      ),
    "55000",
    "partner_assistant_test_required",
  );
  await asOwner(
    "update private.partner_assistant_config set paused_reason = 'credito', backoff_until = now() + interval '1 hour'",
  );
  const modeResult = await as("authenticated", founder, () =>
    cmd("set_partner_assistant_mode", {
      mode: "prova",
      expected_version: v(),
      starting_credit_usd: 80.5,
    }),
  );
  eq(Object.keys(modeResult).sort(), ["id", "mode", "replayed", "version"], "Forma di oggi");
  eq((await configRow()).paused_reason, null, "prova toglie la pausa");
  eq((await configRow()).backoff_until, null, "…e l'attesa");
  eq((await configRow()).starting_credit_usd, "80.50");
  eq(
    (
      await as("authenticated", consultant, () =>
        cmd("set_partner_assistant_mode", { mode: "spento", expected_version: 1 }),
      )
    ).mode,
    "spento",
    "Spento vince anche con una versione vecchia",
  );
  await asOwner("update private.partner_assistant_config set handoff_to = null");
  await rejects(() => setMode("prova"), "55000", "partner_assistant_not_configured");
  await asOwner("update private.partner_assistant_config set handoff_to = $1", [founder]);

  // 6. Limite dopo la prima settimana.
  await rejects(
    () =>
      cmd_consultant("set_partner_assistant_settings", {
        expected_version: v(),
        daily_first_limit: 8,
      }),
    "42501",
  );
  await rejects(
    () =>
      cmd_founder("set_partner_assistant_settings", {
        expected_version: v(),
        daily_first_limit: 16,
      }),
    "22023",
  );
  await rejects(
    () =>
      cmd_founder("set_partner_assistant_settings", {
        expected_version: v(),
        daily_first_limit: 0,
      }),
    "22023",
  );
  await rejects(
    () =>
      cmd_founder("set_partner_assistant_settings", {
        expected_version: v() - 1,
        daily_first_limit: 8,
      }),
    "40001",
  );
  const lim = await cmd_founder("set_partner_assistant_settings", {
    expected_version: v(),
    daily_first_limit: 8,
  });
  eq([lim.daily_first_limit, (await configRow()).daily_first_limit, lim.version], [8, 8, v()]);
  ok(lim.id);
  eq(Object.keys(lim).sort(), ["daily_first_limit", "id", "replayed", "version"]);

  // 7. «Manda la prova».
  await rejects(
    () => cmd_founder("start_partner_assistant_test", { drafts: 2, recipients: 3 }),
    "55000",
    "partner_assistant_test_mode_required",
  );
  await setMode("prova");
  await rejects(
    () => cmd_consultant("start_partner_assistant_test", { drafts: 2, recipients: 3 }),
    "42501",
  );
  await rejects(
    () => cmd_founder("start_partner_assistant_test", { drafts: 4, recipients: 3 }),
    "22023",
  );
  await rejects(
    () => cmd_founder("start_partner_assistant_test", { drafts: 1, recipients: 6 }),
    "22023",
  );
  await rejects(
    () => cmd_founder("start_partner_assistant_test", { drafts: 0, recipients: 1 }),
    "22023",
  );
  await rejects(
    () => cmd_founder("start_partner_assistant_test", { drafts: 1, recipients: 1, extra: true }),
    "22023",
  );
  await rejects(
    () => cmd_founder("start_partner_assistant_test", { drafts: 1, recipients: 1 }),
    "55000",
    "partner_assistant_test_empty",
  );
  await readyFirst(980);
  await readyFirst(981, { sendPriority: 9 });
  await readyFirst(992, { sendPriority: 9, eventStartsOn: "2026-10-01" });
  const runsBefore = await value(
    "select count(*)::int as v from private.partner_assistant_test_runs",
  );
  const run = await cmd_founder("start_partner_assistant_test", { drafts: 3, recipients: 3 });
  eq(Object.keys(run).sort(), ["drafts", "id", "recipients", "replayed", "test_run_id"]);
  eq(run.id, run.test_run_id);
  eq(run.drafts, 2);
  eq(run.recipients, 3);
  eq(
    await runDrafts(run.test_run_id),
    [draftOf(981), draftOf(980)],
    "send_priority prima, evento già iniziato escluso",
  );
  eq(
    pick(
      await one(
        "select recipients, requested_by from private.partner_assistant_test_runs where id = $1",
        [run.test_run_id],
      ),
      ["recipients", "requested_by"],
    ),
    { recipients: 3, requested_by: founder },
  );
  eq(pick(await lastEvent(), ["partner_id", "step", "outcome"]), {
    partner_id: null,
    step: "invio",
    outcome: "prova_avviata",
  });
  // L'ora dell'assistente decide quali eventi sono già iniziati; con l'evento ancora da venire la
  // data più vicina viene prima, a pari send_priority.
  const early = await cmd_founder(
    "start_partner_assistant_test",
    { drafts: 3, recipients: 1 },
    { now: "2026-09-30T10:00:00Z" },
  );
  eq(await runDrafts(early.test_run_id), [draftOf(992), draftOf(981), draftOf(980)]);
  eq(
    await value("select count(*)::int as v from private.partner_assistant_test_runs"),
    runsBefore + 2,
  );
  const replayOp = randomUUID();
  const first = await as("authenticated", founder, () =>
    cmd("start_partner_assistant_test", { drafts: 1, recipients: 1 }, replayOp),
  );
  const again = await as("authenticated", founder, () =>
    cmd("start_partner_assistant_test", { drafts: 1, recipients: 1 }, replayOp),
  );
  eq([again.replayed, again.id], [true, first.id], "Stessa operazione: stessa prova");
  eq(
    await value("select count(*)::int as v from private.partner_assistant_test_runs"),
    runsBefore + 3,
    "…e nessuna riga in più",
  );
  // L'ora: senza impostazione è now(); il giorno è quello di Roma.
  await db.exec("begin");
  try {
    eq(await value("select private.partner_assistant_now() = now() as v"), true);
    await db.query(
      "select set_config('luckylap.partner_assistant.now', '2026-10-28T23:30:00Z', true)",
    );
    eq(
      await value(
        `select private.partner_assistant_now() = timestamptz '2026-10-28T23:30:00Z' as v`,
      ),
      true,
    );
    eq(
      await value(
        "select private.partner_assistant_rome_day(private.partner_assistant_now())::text as v",
      ),
      "2026-10-29",
    );
  } finally {
    await db.exec("rollback");
  }

  // 8. «La prova è arrivata in posta in arrivo».
  await rejects(
    () => cmd_founder("confirm_partner_assistant_test", { expected_version: v() }),
    "55000",
    "partner_assistant_test_missing",
  );
  await insertMessage({
    partner: p(980),
    mode: "prova",
    test_run_id: run.test_run_id,
    test_index: 0,
    send_status: "inviato",
  });
  await rejects(
    () => cmd_consultant("confirm_partner_assistant_test", { expected_version: v() }),
    "42501",
  );
  await rejects(
    () => cmd_founder("confirm_partner_assistant_test", { expected_version: v() - 1 }),
    "40001",
  );
  const conf = await cmd_founder("confirm_partner_assistant_test", { expected_version: v() });
  ok(conf.test_confirmed_at);
  eq(Object.keys(conf).sort(), ["id", "replayed", "test_confirmed_at", "version"]);
  eq(conf.version, v());
  eq((await configRow()).test_confirmed_by, founder);
  eq(
    (await cmd_founder("set_partner_assistant_mode", { mode: "invio", expected_version: v() }))
      .mode,
    "invio",
  );

  // 9. «Manda per primo».
  await scheda(982);
  await scheda(983);
  await rejects(
    () =>
      cmd_consultant("set_partner_assistant_send_priority", {
        partner_id: p(982),
        send_priority: 9,
      }),
    "42501",
  );
  await rejects(
    () =>
      cmd_founder("set_partner_assistant_send_priority", { partner_id: p(982), send_priority: 10 }),
    "22023",
  );
  await rejects(
    () =>
      cmd_founder("set_partner_assistant_send_priority", {
        partner_id: randomUUID(),
        send_priority: 9,
      }),
    "22023",
    "partner_not_found",
  );
  const priority = await cmd_founder("set_partner_assistant_send_priority", {
    partner_id: p(982),
    send_priority: 9,
  });
  eq(priority.send_priority, 9);
  eq(Object.keys(priority).sort(), ["id", "partner_id", "replayed", "send_priority", "version"]);
  eq([priority.partner_id, priority.version], [p(982), 1]);
  eq((await switchRow(p(982))).active, true, "riga nuova: attivo");
  await setSwitch(p(983), false);
  const stopped = await cmd_founder("set_partner_assistant_send_priority", {
    partner_id: p(983),
    send_priority: 9,
  });
  eq((await switchRow(p(983))).active, false, "la priorità non riaccende un contatto fermo");
  eq([stopped.version, (await switchRow(p(983))).send_priority], [2, 9]);

  // 10. «Riprendi l'invio».
  await asOwner(
    `update private.partner_assistant_mail_state set stop_reason = 'rimbalzi', stopped_at = now(), hard_failures = 2,
       soft_failures = 3, day_stopped_on = current_date, backoff_until = now() + interval '1 day'`,
  );
  await rejects(() => cmd_consultant("resume_partner_assistant_send", {}), "42501");
  await rejects(() => cmd_founder("resume_partner_assistant_send", { force: true }), "22023");
  const versionBeforeResume = v();
  const resumed = await cmd_founder("resume_partner_assistant_send", {});
  eq([resumed.status, resumed.id], ["ripreso", (await mailState()).id]);
  eq(Object.keys(resumed).sort(), ["id", "replayed", "status"]);
  eq(
    pick(await mailState(), [
      "stop_reason",
      "lease_token",
      "soft_failures",
      "hard_failures",
      "day_stopped_on",
      "stopped_at",
      "backoff_until",
    ]),
    {
      stop_reason: null,
      lease_token: null,
      soft_failures: 0,
      hard_failures: 0,
      day_stopped_on: null,
      stopped_at: null,
      backoff_until: null,
    },
  );
  eq(pick(await lastEvent(), ["step", "outcome"]), { step: "invio", outcome: "invio_ripreso" });
  eq(v(), versionBeforeResume, "La configurazione non cambia");

  // 11. Giro dei passi in prova e invio.
  for (const mode of ["prova", "invio"]) {
    await setModeOwner(mode);
    eq((await claimStep()).status, "claimed", `Il passo con Claude gira anche in «${mode}»`);
    eq(await checkpointStep(), { status: "ok" }, `Checkpoint in «${mode}»: si va avanti`);
    await releaseStep();
  }
  await setModeOwner("spento");
  eq((await claimStep()).reason, "spento");
  eq(await checkpointReason(), "spento");
  eq(
    Object.keys(await claimStepAfterSetMode("invio")).sort(),
    ["job", "status"],
    "stessa forma della consegna 1",
  );

  // 12. Interruttore e regole.
  for (const co of [984, 985, 986]) await scheda(co);
  await setJob(p(984), { status: "serve_tommaso", reason: "conversazione_esistente" });
  await setJob(p(985), { status: "serve_tommaso", reason: "invio_incerto" });
  await setJob(p(986), { status: "serve_tommaso", reason: "troppi_tentativi" });
  for (const id of [p(984), p(985), p(986)])
    await cmd_consultant("set_partner_assistant_contact", { partner_id: id, active: true });
  eq(
    [(await job(p(984))).status, (await job(p(985))).status, (await job(p(986))).status],
    ["serve_tommaso", "serve_tommaso", "in_coda"],
  );
  eq((await job(p(985))).reason, "invio_incerto", "Il motivo resta");
  await readyFirst(987);
  await readyFirst(988);
  await insertMessage({ partner: p(987), mode: "invio", send_status: "in_invio" });
  // Un messaggio solo preparato non protegge la bozza: start lo scarta (bozza_cambiata).
  await readyFirst(974);
  await insertMessage({ partner: p(974), mode: "invio", send_status: "pronto" });
  await readyFirst(993);
  await insertMessage({ partner: p(993), mode: "invio", send_status: "inviato" });
  await setJob(p(993), { status: "inviata" });
  await readyFirst(979);
  await setJob(p(979), { status: "inviata" }); // senza messaggio: conta solo lo stato
  const saved = await cmd_consultant("save_partner_assistant_rules", {
    body: "Regole v2",
    expected_version: 1,
  });
  eq(saved.version, 2);
  eq((await job(p(987))).status, "pronta", "un messaggio in invio protegge la bozza");
  eq(
    [(await job(p(974))).status, (await job(p(974))).step],
    ["in_coda", "scrittura"],
    "un messaggio solo preparato non la protegge",
  );
  eq((await job(p(988))).step, "scrittura");
  eq(
    [(await job(p(993))).status, (await job(p(993))).step],
    ["inviata", "controllo"],
    "un lavoro inviata non torna in scrittura",
  );
  eq([(await job(p(979))).status, (await job(p(979))).step], ["inviata", "controllo"]);

  // 13. Cancellazione definitiva.
  await readyFirst(989);
  await insertMessage({ partner: p(989), mode: "invio", send_status: "pronto" });
  await insertMessage({ partner: p(989), mode: "prova", test_index: 1 });
  await eraseContactOf(p(989));
  eq(await countRows(p(989), ["messages", "drafts", "notes"]), 0);
  eq((await job(p(989))).reason, "dato_cancellato");
  await readyFirst(994);
  await insertMessage({ partner: p(994), mode: "invio", send_status: "in_invio" });
  await eraseContactOf(p(994));
  eq(
    (await job(p(994))).reason,
    "invio_incerto",
    "cancellata tra start e finish: l'email può essere partita",
  );
  eq(await countRows(p(994), ["messages", "drafts", "notes"]), 0);
  await cmd_consultant("set_partner_assistant_contact", { partner_id: p(994), active: true });
  eq((await job(p(994))).status, "serve_tommaso", "l'interruttore non la riprende");
  await readyFirst(999);
  await setJob(p(999), { status: "serve_tommaso", reason: "troppi_tentativi" });
  const uncertain = await insertMessage({ partner: p(999), mode: "invio", send_status: "pronto" });
  await asOwner(forward(uncertain, "in_invio"));
  await asOwner(forward(uncertain, "incerto"));
  await eraseContactOf(p(999));
  eq(
    (await job(p(999))).reason,
    "invio_incerto",
    "esito incerto: invio_incerto anche su un lavoro già di Tommi",
  );

  // 14. Registro e promemoria per Tommi.
  await scheda(990);
  await scheda(991);
  await assistantFirstSend(p(990), "2026-10-29T08:40:00Z"); // come finish: apply_partner_stage + partner_log(origin 'assistente') come assistente
  const t = await followUpTask(p(990));
  eq(
    [t.title, t.assigned_to, t.created_by, t.due_at],
    ["Sollecito · Club Sintetico 990", founder, assistant, "2026-11-04T23:00:00+00:00"],
  );
  eq([t.link_created_by, t.description], [assistant, "Partner CO 990 · /partner?co=990#lead-990"]);
  eq(
    (await todayAs(founder, "2026-11-05")).reminders.map((r) => r.co),
    [990],
    "nell'Oggi di Tommi",
  );
  await teamSend(p(991), "2026-10-29T09:00:00Z");
  eq((await followUpTask(p(991))).assigned_to, consultant, "invio del team: come oggi");
  await teamBackdatedSend(p(990), "2026-10-28T12:00:00Z");
  eq(await followUpTaskCount(p(990)), 1, "l'invio dell'assistente è il più recente");
  eq((await followUpTask(p(990))).status, "todo");
  await teamReply(p(990));
  eq((await followUpTask(p(990))).status, "done", "una risposta chiude il promemoria");
  await rerunOggiFixesCases();

  // 15. Permessi.
  for (const f of TEAM_COMMANDS) {
    eq(await canExecute("authenticated", `public.${f}(uuid,jsonb)`), true, `Membri su ${f}`);
    eq(await canExecute("anon", `public.${f}(uuid,jsonb)`), false, `anon non esegue ${f}`);
    eq(
      await canExecute("service_role", `public.${f}(uuid,jsonb)`),
      false,
      `service_role non esegue ${f}`,
    );
  }
  for (const f of NEW_HELPERS)
    for (const role of ["anon", "authenticated", "service_role"])
      eq(await canExecute(role, f), false, `${role} non esegue ${f}`);
  for (const r of ["anon", "authenticated", "service_role"])
    eq(await canWrite(r, "public.partner_assistant_messages"), false);
  eq(await canSelect("authenticated", "public.partner_assistant_messages"), true);
  eq(await canSelect("anon", "public.partner_assistant_messages"), false);
  for (const t of ["partner_assistant_mail_state", "partner_assistant_test_runs"])
    for (const r of ["anon", "authenticated", "service_role"])
      eq(await canSelect(r, `private.${t}`), false, `${r} non legge private.${t}`);
  eq(await canExecute("service_role", "private.partner_work_activity_trigger()"), false);
  eq(await canExecute("authenticated", "private.partner_work_activity_trigger()"), false);
  eq(
    await value(
      "select bool_and(c.relrowsecurity) as v from pg_class c where c.oid in ('public.partner_assistant_messages'::regclass, 'private.partner_assistant_test_runs'::regclass, 'private.partner_assistant_mail_state'::regclass)",
    ),
    true,
    "RLS sulle tabelle nuove",
  );
  eq(
    (
      await as(
        "authenticated",
        consultant,
        async () =>
          (await db.query("select count(*)::int as n from public.partner_assistant_messages")).rows,
      )
    )[0].n > 0,
    true,
    "I membri leggono i messaggi",
  );
  eq(
    await as("authenticated", randomUUID(), () =>
      value("select count(*)::int as v from public.partner_assistant_messages"),
    ),
    0,
    "Chi non è membro non legge niente",
  );
  eq(await searchPathEmpty(NEW_AND_REPLACED_FUNCTIONS), true);
  eq(
    (
      await db.query(
        `select n.nspname || '.' || p.proname as name, p.prosecdef from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where p.proname = any($1::text[]) order by 1`,
        [`{${TEAM_COMMANDS.join(",")}}`],
      )
    ).rows
      .map((r) => `${r.name}:${r.prosecdef}`)
      .sort(),
    TEAM_COMMANDS.flatMap((f) => [`private.${f}:true`, `public.${f}:false`]).sort(),
    "Comandi security definer, wrapper invoker",
  );
  console.log(`PASS ${checks} Assistente Partner invio, comandi synthetic checks passed.`);
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
