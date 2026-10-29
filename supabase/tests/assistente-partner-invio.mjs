// test-db: pglite minimo 370
// Assistente Partner, consegna 2a, compito 2 (_assistente_partner_invio.sql, sezione 2): calendario
// (finestra del destinatario, feste, 21 dicembre-7 gennaio), limiti del giorno, coda d'invio con la
// pulizia fino al candidato, lease della casella e RPC del worker (claim, skip, prepare, start,
// finish, copia in «Posta inviata», fermo, rilascio, variabili) e la lettura della pagina. L'ora
// dell'assistente è sempre quella del test (luckylap.partner_assistant.now), mai quella della CI; le
// lease usano l'ora vera. Migrazioni applicate in ordine su PGlite, auth.uid() come in produzione.
// Solo dati sintetici (CO da 951, domini example.test), nessun accesso cloud.
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
const between = (x, low, high) => x >= low && x <= high;
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const fixtureId = (n) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const founder = fixtureId(901),
  consultant = fixtureId(902),
  assistant = fixtureId(990);
const sha = (text) => createHash("sha256").update(text).digest("hex");
const MODEL = "claude-opus-5-5";

const migrations = new URL("../migrations/", import.meta.url);
const migration = (suffix) => {
  const names = readdirSync(migrations).filter((n) => n.endsWith(suffix));
  assert.equal(names.length, 1, `Una sola migrazione ${suffix}`);
  return readFileSync(new URL(names[0], migrations), "utf8");
};

const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const value = async (sql, args = []) => (await one(sql, args))?.v;
const fn = (expression) => value(`select ${expression} as v`);
const iso = (at) => (at instanceof Date ? at.toISOString() : at);

// Il proprietario del database: nessun ruolo client, nessun claim.
const asOwner = (sql, args) => (args ? db.query(sql, args) : db.exec(sql));

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
    if (now)
      await db.query("select set_config('luckylap.partner_assistant.now', $1, true)", [iso(now)]);
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
const cmd = (name, payload, op = randomUUID()) =>
  rpc(`select public.${name}($1, $2::jsonb) r`, [
    op,
    JSON.stringify({ schema_version: 1, ...payload }),
  ]);
const cmdAs = (actor, name, payload) =>
  as("authenticated", actor, () => cmd(name, payload), { now: lastAt });

// L'ora del test: ogni RPC d'invio senza ora esplicita gira all'ora dell'ultima chiamata con l'ora.
let lastAt = "2026-11-10T06:00:00Z";
const atTime = (at, fn) => as("service_role", null, fn, { now: at });
const WORKER = randomUUID();
let heldLease = null;

// Schede e contatti.
const ids = new Map();
const pid = (co) => {
  assert.ok(ids.has(co), `CO ${co} non creato`);
  return ids.get(co);
};
const draftIds = new Map();

async function scheda(co, { country = "Italia", email } = {}) {
  const partnerId = randomUUID();
  ids.set(co, partnerId);
  await asOwner(
    `insert into public.partners(id, co, name, origin, stage, created_by, sections, priority,
       contact_month, country)
     values ($1, $2, $3, 'team', 'da_contattare', $4, array['collab'], 'media', date '2026-11-01', $5)`,
    [partnerId, co, `Club Sintetico ${co}`, founder, country],
  );
  const address = email ?? `info@club-${co}.example.test`;
  await asOwner(
    `insert into public.partner_contacts(partner_id, kind, value, link_value, created_by, updated_by)
     values ($1, 'email', $2, $2, $3, $3)`,
    [partnerId, address, founder],
  );
  return partnerId;
}

// La scelta dell'estrazione: le chiavi dell'Appendice C più la richiesta.
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
const OPT_OUT =
  "Se preferite non ricevere altre email da noi, basta rispondere e non scriveremo ancora.";

// Un contatto con la bozza pronta, come lo lascia la consegna 1: scheda, recapito, ricerca, scelta,
// bozza con l'impronta di oggetto, testo e firma, seconda lettura approvata dopo la bozza e lavoro
// «pronta» al passo «controllo». Le date contano da lastAt, mai dall'ora vera.
async function readyFirst(
  co,
  {
    tz = "Europe/Rome",
    country = "Italia",
    sendPriority = 0,
    researchDaysAgo = 1,
    eventStartsOn = "",
    email,
  } = {},
) {
  const partnerId = await scheda(co, { country, email });
  if (sendPriority)
    await asOwner(
      `insert into public.partner_assistant_contacts(partner_id, active, send_priority, updated_by)
       values ($1, true, $2, $3)`,
      [partnerId, sendPriority, founder],
    );
  const at = iso(lastAt);
  const contactId = await value(
    "select id as v from public.partner_contacts where partner_id = $1 and kind = 'email'",
    [partnerId],
  );
  const research = await value(
    `insert into public.partner_assistant_notes(partner_id, kind, content, sources, rules_version, model,
       operation_id, created_by, created_at)
     values ($1, 'ricerca', jsonb_build_object('text', 'Ricerca sintetica del CO ' || $2::text),
       array['https://club.example.test/notizie'], 1, $3, gen_random_uuid(), $4,
       $5::timestamptz - make_interval(days => $6))
     returning id as v`,
    [partnerId, co, MODEL, assistant, at, researchDaysAgo],
  );
  const choice = choiceOf({
    timezone: tz,
    event_starts_on: eventStartsOn,
    ...(eventStartsOn ? { contact_kind: "evento", event_name: `Raduno Sintetico ${co}` } : {}),
  });
  const choiceId = await value(
    `insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model, operation_id,
       created_by, created_at)
     values ($1, 'scelta', $2::jsonb, 1, $3, gen_random_uuid(), $4, $5::timestamptz - interval '20 minutes')
     returning id as v`,
    [partnerId, JSON.stringify({ ...choice, decision: { kind: "scrivi" } }), MODEL, assistant, at],
  );
  const subject = `LuckyLap e Club Sintetico ${co}`;
  const body = `Testo sintetico della prima email per il CO ${co}.`;
  const digest = sha(`${subject}\n\n${body}\n\n${SIGNATURE}`);
  const draftId = await value(
    `insert into public.partner_assistant_drafts(partner_id, contact_id, partner_version, language, subject, body,
       signature, sha256, rules_version, research_note_id, operation_id, created_by, created_at)
     select $1, $2, p.version, 'it', $3, $4, $5, $6, (select max(version) from public.partner_assistant_rules),
       $7, gen_random_uuid(), $8,
       $9::timestamptz - interval '10 minutes'
       from public.partners p where p.id = $1
     returning id as v`,
    [partnerId, contactId, subject, body, SIGNATURE, digest, research, assistant, at],
  );
  await asOwner(
    `insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model, operation_id,
       created_by, created_at)
     values ($1, 'controllo', jsonb_build_object('approved', true, 'problems', '[]'::jsonb, 'sha256', $2::text), 1, $3,
       gen_random_uuid(), $4, $5::timestamptz - interval '5 minutes')`,
    [partnerId, digest, MODEL, assistant, at],
  );
  await asOwner(
    `insert into public.partner_assistant_jobs(partner_id, status, step, research_note_id, choice_note_id, draft_id)
     values ($1, 'pronta', 'controllo', $2, $3, $4)`,
    [partnerId, research, choiceId, draftId],
  );
  draftIds.set(partnerId, draftId);
  return partnerId;
}
// Un contatto che ha già ricevuto la prima email: bozza come readyFirst, lavoro «inviata».
async function sentPartner(co) {
  const partnerId = await readyFirst(co);
  await asOwner(
    "update public.partner_assistant_jobs set status = 'inviata' where partner_id = $1",
    [partnerId],
  );
  return partnerId;
}

// Un messaggio come proprietario, con giorno, ora d'invio e copia dove lo stato li chiede.
async function insertMessage({
  partner,
  mode = "invio",
  send_status = "pronto",
  test_run_id = null,
  test_index = null,
  send_day = null,
  sent_at = null,
  appended_at = null,
  to_address = null,
}) {
  const draftId = draftIds.get(partner);
  assert.ok(draftId, "Il contatto non ha una bozza");
  const co = [...ids].find(([, x]) => x === partner)[0];
  const subject = `LuckyLap e Club Sintetico ${co}`;
  const body = `Testo sintetico della prima email per il CO ${co}.\n\n${SIGNATURE}`;
  const raw = `Subject: ${subject}\r\n\r\n${body.replaceAll("\n", "\r\n")}\r\n`;
  return value(
    `insert into public.partner_assistant_messages(partner_id, draft_id, kind, mode, send_status, test_run_id,
       test_index, message_id, to_address, subject, body, raw, sha256, rules_version, lease_token, send_day,
       sent_at, appended_at, operation_id, created_by)
     values ($1, $2, 'primo', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, gen_random_uuid(),
       coalesce($13::date, case when $4 in ('in_invio', 'inviato', 'incerto', 'respinto')
         then (now() at time zone 'Europe/Rome')::date end),
       coalesce($14::timestamptz, case when $4 in ('inviato', 'incerto') then now() end), $15::timestamptz,
       gen_random_uuid(), $16)
     returning id as v`,
    [
      partner,
      draftId,
      mode,
      send_status,
      test_run_id,
      test_index,
      `<${randomUUID()}@luckylap.example.test>`,
      to_address ?? `info@club-${co}.example.test`,
      subject,
      body,
      raw,
      sha(raw),
      send_day,
      sent_at,
      appended_at,
      assistant,
    ],
  );
}

// Prime email vere di un giorno, già copiate in «Posta inviata», a contatti nuovi (CO da 2001).
let nextSyntheticCo = 2001;
async function realFirstSent(day, n) {
  for (let i = 0; i < n; i++) {
    const partner = await sentPartner(nextSyntheticCo++);
    await insertMessage({
      partner,
      send_status: "inviato",
      send_day: day,
      sent_at: `${day}T08:40:00Z`,
      appended_at: `${day}T08:41:00Z`,
    });
  }
}
const sendFirstsOn = realFirstSent;
// Prove già inviate e copiate in un giorno: ognuna con una sua prova vecchia (non è l'ultima).
async function sendTests(n, day) {
  const partner = await sentPartner(nextSyntheticCo++);
  for (let i = 0; i < n; i++) {
    const run = await value(
      `insert into private.partner_assistant_test_runs(draft_ids, recipients, requested_by, requested_at)
       values (array[$1::uuid], 1, $2, '2026-01-01T00:00:00Z') returning id as v`,
      [draftIds.get(partner), founder],
    );
    await insertMessage({
      partner,
      mode: "prova",
      send_status: "inviato",
      test_run_id: run,
      test_index: 0,
      send_day: day,
      sent_at: `${day}T09:00:00Z`,
      appended_at: `${day}T09:01:00Z`,
    });
  }
}
// Toglie tutti i messaggi, come la cancellazione definitiva (flag locale acceso).
const resetSends = () =>
  db.exec(`begin; set local luckylap.partner_assistant.erase = 'on';
    delete from public.partner_assistant_messages; commit;`);

// Configurazione e stato della casella, come proprietario.
const setModeOwner = (mode) =>
  asOwner("update private.partner_assistant_config set mode = $1", [mode]);
const confirmTestOwner = () =>
  asOwner(
    "update private.partner_assistant_config set test_confirmed_at = now(), test_confirmed_by = $1",
    [founder],
  );
const setDailyLimit = (n) =>
  asOwner("update private.partner_assistant_config set daily_first_limit = $1", [n]);
const resetSendClock = () =>
  asOwner("update private.partner_assistant_mail_state set next_send_after = null");
const expireLease = async () => {
  await asOwner(
    "update private.partner_assistant_mail_state set lease_expires_at = clock_timestamp() - interval '1 second'",
  );
  heldLease = null;
};
const mailState = () => one("select * from private.partner_assistant_mail_state");
const nextSendAfterMinutes = async (at) =>
  value(
    `select (extract(epoch from next_send_after - $1::timestamptz) / 60)::float8 as v
       from private.partner_assistant_mail_state`,
    [at],
  );
// Solo questi contatti in coda: l'interruttore attivo per loro e fermo per ogni altro lavoro «pronta».
async function onlyQueue(...cos) {
  const wanted = cos.map(pid);
  await asOwner(
    `insert into public.partner_assistant_contacts as s (partner_id, active, updated_by)
       select x, true, $2 from unnest($1::uuid[]) x
     on conflict (partner_id) do update set active = true`,
    [`{${wanted.join(",")}}`, founder],
  );
  await asOwner(
    `insert into public.partner_assistant_contacts as s (partner_id, active, updated_by)
       select j.partner_id, false, $2 from public.partner_assistant_jobs j
        where j.status = 'pronta' and not (j.partner_id = any($1::uuid[]))
     on conflict (partner_id) do update set active = false`,
    [`{${wanted.join(",")}}`, founder],
  );
}
// Il primo istante con la finestra di Roma aperta dopo next_send_after e dopo lastAt.
const nextOpen = async () =>
  iso(
    await value(
      `select private.partner_assistant_next_window(greatest($1::timestamptz,
         coalesce((select next_send_after from private.partner_assistant_mail_state), $1::timestamptz))) as v`,
      [iso(lastAt)],
    ),
  );

// RPC del worker.
async function claimAt(at, testRecipients = 0) {
  lastAt = iso(at);
  const r = await atTime(lastAt, () =>
    rpc("select public.claim_partner_assistant_send($1, $2, $3) r", [WORKER, 300, testRecipients]),
  );
  if (r.status === "claimed") heldLease = r.lease_token;
  return r;
}
async function release(payload) {
  if (!payload && !heldLease) return null;
  const r = await atTime(lastAt, () =>
    rpc("select public.release_partner_assistant_send($1, $2::jsonb) r", [
      heldLease ?? randomUUID(),
      JSON.stringify({
        schema_version: 1,
        ...(payload ?? { outcome: "fine", smtp_login: null, imap_login: null }),
      }),
    ]),
  );
  heldLease = null;
  return r;
}
async function candidateAt(at, co) {
  await release();
  await onlyQueue(co);
  const r = await claimAt(at);
  eq(r.candidate?.co, co, `Candidato atteso: CO ${co} (${r.status} ${r.reason ?? ""})`);
  return r.candidate;
}
const newId = () => `<${randomUUID()}@luckylap.example.test>`;
const newOp = () => randomUUID();
const approvedText = (c) => `${c.draft.body}\n\n${c.draft.signature}\n\n${OPT_OUT}`;
const mime = ({ to, subject, messageId, text }) => {
  const body = Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, "$&\r\n");
  return (
    `From: "Tommaso | LuckyLap" <casella@luckylap.example.test>\r\nTo: ${to}\r\n` +
    `Subject: ${subject}\r\nMessage-ID: ${messageId}\r\nMIME-Version: 1.0\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}`
  );
};
async function prepare(c, overrides = {}) {
  const { operation_id = newOp(), ...rest } = overrides;
  const payload = {
    schema_version: 1,
    job_id: c.job_id,
    draft_id: c.draft.draft_id,
    mode: c.mode,
    test_run_id: c.test_run_id,
    test_index: c.test_index,
    message_id: newId(),
    to_address: c.address,
    subject: c.draft.subject,
    text: approvedText(c),
    opt_out: OPT_OUT,
    mailbox_check: "vuota",
    ...rest,
  };
  payload.raw ??= mime({
    to: payload.to_address,
    subject: payload.subject,
    messageId: payload.message_id,
    text: payload.text,
  });
  return atTime(lastAt, () =>
    rpc("select public.prepare_partner_assistant_send($1, $2, $3::jsonb) r", [
      heldLease ?? randomUUID(),
      operation_id,
      JSON.stringify(payload),
    ]),
  );
}
const start = (p) =>
  atTime(lastAt, () =>
    rpc("select public.start_partner_assistant_send($1, $2) r", [
      heldLease ?? randomUUID(),
      p.message_row_id,
    ]),
  );
// Stessa operazione per lo stesso esito dello stesso messaggio: il secondo arrivo è una ripetizione.
const finishOps = new Map();
function finish(
  p,
  { outcome, smtp_code = null, enhanced_code = null, spam = false, reason = null },
  lease = heldLease,
) {
  const payload = {
    schema_version: 1,
    message_row_id: p.message_row_id,
    outcome,
    smtp_code,
    enhanced_code,
    spam,
    reason,
  };
  const key = JSON.stringify(payload);
  if (!finishOps.has(key)) finishOps.set(key, randomUUID());
  return atTime(lastAt, () =>
    rpc("select public.finish_partner_assistant_send($1, $2, $3::jsonb) r", [
      lease ?? randomUUID(),
      finishOps.get(key),
      key,
    ]),
  );
}
const finishAt = (at, p, outcome) => {
  lastAt = iso(at);
  return finish(p, outcome);
};
const recordAppend = (p, { found }) =>
  atTime(lastAt, () =>
    rpc("select public.record_partner_assistant_append($1, $2, $3::jsonb) r", [
      heldLease ?? randomUUID(),
      p.message_row_id,
      JSON.stringify({ schema_version: 1, found }),
    ]),
  );
const skip = (c, reason) =>
  atTime(lastAt, () =>
    rpc("select public.skip_partner_assistant_send($1, $2, $3) r", [
      heldLease ?? randomUUID(),
      c?.job_id ?? null,
      reason,
    ]),
  );
const pauseSend = (reason) =>
  atTime(lastAt, () =>
    rpc("select public.pause_partner_assistant_send($1, $2) r", [
      heldLease ?? randomUUID(),
      reason,
    ]),
  );
const recordEnv = (payload) =>
  atTime(lastAt, () =>
    rpc("select public.record_partner_assistant_environment($1::jsonb) r", [
      JSON.stringify({ schema_version: 1, ...payload }),
    ]),
  );
// Fino a start compreso, tenendo la lease: il risultato di prepare.
async function sendUntilStart(co, at) {
  if (!ids.has(co)) await readyFirst(co);
  const c = await candidateAt(at, co);
  const p = await prepare(c);
  eq(p.status, "pronto", `CO ${co}: pronto (${p.reason ?? ""})`);
  eq((await start(p)).status, "in_invio", `CO ${co}: in invio`);
  return p;
}
async function sendAll(co, { at, append = true }) {
  const p = await sendUntilStart(co, at);
  eq((await finish(p, { outcome: "inviato", smtp_code: 250 })).send_status, "inviato");
  if (append) await recordAppend(p, { found: false });
  await release();
  return p;
}

// Comandi del team.
const dncAs = (actor, partnerId) =>
  cmdAs(actor, "set_partner_do_not_contact", {
    partner_id: partnerId,
    active: true,
    reason: "Motivo sintetico",
  });
const switchOff = (partnerId) =>
  cmdAs(consultant, "set_partner_assistant_contact", { partner_id: partnerId, active: false });
const resumeAsFounder = () => cmdAs(founder, "resume_partner_assistant_send", {});
const startTestAs = async (actor, payload) =>
  (await cmdAs(actor, "start_partner_assistant_test", payload)).test_run_id;
const sendAs = (actor) =>
  as("authenticated", actor, () => rpc("select public.read_partner_assistant_send() r"), {
    now: lastAt,
  });
// Come save_partner_assistant_rules su un solo lavoro: torna alla scrittura.
const requeueJob = (partnerId) =>
  asOwner(
    `update public.partner_assistant_jobs set status = 'in_coda', step = 'scrittura', attempts = 0, rewrites = 0,
       reason = null, next_attempt_at = now(), updated_at = now()
     where partner_id = $1`,
    [partnerId],
  );
const setJobOwner = (partnerId, { rewrites }) =>
  asOwner("update public.partner_assistant_jobs set rewrites = $2 where partner_id = $1", [
    partnerId,
    rewrites,
  ]);
// Il recapito della bozza non è più attivo; la scheda resta idonea con un'altra email.
async function deactivateDraftContact(partnerId) {
  await asOwner(
    `insert into public.partner_contacts(partner_id, kind, value, link_value, position, created_by, updated_by)
     values ($1, 'email', 'segreteria@club-965.example.test', 'segreteria@club-965.example.test', 1, $2, $2)`,
    [partnerId, founder],
  );
  await asOwner(
    `update public.partner_contacts c set active = false from public.partner_assistant_drafts d
      where d.id = $1 and c.id = d.contact_id`,
    [draftIds.get(partnerId)],
  );
}

// La cancellazione definitiva di un recapito, come remove_partner_contact con «cancella».
const eraseContactOf = (partnerId) =>
  asOwner(
    `update public.partner_contacts set value = null, link_value = null, label = '', research_value = null,
       active = false, erased_at = now(), erased_by = $2, version = version + 1
     where partner_id = $1 and kind = 'email'`,
    [partnerId, founder],
  );
const countDrafts = (partnerId) =>
  value("select count(*)::int as v from public.partner_assistant_drafts where partner_id = $1", [
    partnerId,
  ]);

// Letture del proprietario.
const job = (partnerId) =>
  one(
    `select status, step, reason, draft_id, rewrites, attempts, research_note_id, choice_note_id
       from public.partner_assistant_jobs where partner_id = $1`,
    [partnerId],
  );
const partner = (partnerId) => one("select stage from public.partners where id = $1", [partnerId]);
const message = (p) =>
  one("select * from public.partner_assistant_messages where id = $1", [p.message_row_id]);
const messageText = (p, column) =>
  value(
    `select case when $2 = 'sent_at' then to_char(sent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"')
       else send_day::text end as v from public.partner_assistant_messages where id = $1`,
    [p.message_row_id, column],
  );
const stateText = (column) =>
  value(
    `select case when $1 = 'imap_login_at'
       then to_char(imap_login_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"')
       else failures_day::text end as v from private.partner_assistant_mail_state`,
    [column],
  );
const lastMessage = async (partnerId) => ({
  message_row_id: await value(
    `select id as v from public.partner_assistant_messages where partner_id = $1
      order by created_at desc, id desc limit 1`,
    [partnerId],
  ),
});
const liveMessages = (partnerId) =>
  value(
    `select count(*)::int as v from public.partner_assistant_messages
      where partner_id = $1 and send_status in ('pronto', 'in_invio', 'inviato', 'incerto')`,
    [partnerId],
  );
const lastEvent = () =>
  one(
    "select partner_id, step, outcome from private.partner_assistant_events order by created_at desc, id desc limit 1",
  );
const eventCount = (outcome) =>
  value("select count(*)::int as v from private.partner_assistant_events where outcome = $1", [
    outcome,
  ]);
const activities = async (partnerId) =>
  (
    await db.query(
      `select kind, origin, message_kind, channel, body, stage_before, stage_after
         from public.partner_activities where partner_id = $1 order by created_at, id`,
      [partnerId],
    )
  ).rows;
const activityCount = async (partnerId) => (await activities(partnerId)).length;
const followUps = async (partnerId) =>
  (
    await db.query(
      `select t.id, t.title, t.assigned_to, t.created_by from public.partner_work_links l
         join public.tasks t on t.id = l.task_id
        where l.kind = 'follow_up' and l.partner_id = $1 order by t.created_at, t.id`,
      [partnerId],
    )
  ).rows;
const followUpTask = async (partnerId) => (await followUps(partnerId)).at(-1);
const followUpTaskCount = async (partnerId) => (await followUps(partnerId)).length;
// Le coppie (CO, indice) che la prova manderebbe ancora, nell'ordine.
const testPairsInOrder = async (run, recipients) =>
  (
    await db.query(
      `select j.co, t.test_index from private.partner_assistant_test_pairs($1, $2) t
         join public.partners j on j.id = t.partner_id`,
      [run, recipients],
    )
  ).rows.map((r) => [r.co, r.test_index]);

// Calendario.
const open = (tz, country, at) =>
  fn(`private.partner_assistant_window_open('${tz}', '${country}', '${at}')`);
const code = (country) =>
  value("select private.partner_assistant_country_code($1) as v", [country]);
const holidayCounts = async () =>
  Object.fromEntries(
    (
      await db.query(
        "select country_code, count(*)::int as n from private.partner_assistant_holidays group by 1",
      )
    ).rows.map((r) => [r.country_code, r.n]),
  );
const holidaysBetween = (from, to) =>
  value(
    "select bool_and(day between $1::date and $2::date) as v from private.partner_assistant_holidays",
    [from, to],
  );
const holidaysOutside = (from, to) =>
  value(
    `select not bool_or(to_char(day, 'MM-DD') >= $1 or to_char(day, 'MM-DD') <= $2) as v
       from private.partner_assistant_holidays`,
    [from, to],
  );
const nextWindow = (at) =>
  value(
    `select to_char(private.partner_assistant_next_window($1::timestamptz) at time zone 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') as v`,
    [at],
  );
const firstLimit = (day) => fn(`private.partner_assistant_first_limit('${day}'::date)`);

const canExecute = (role, signature) =>
  value("select has_function_privilege($1, $2, 'EXECUTE') as v", [role, signature]);
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

const CANDIDATE_KEYS = [
  "address",
  "choice",
  "co",
  "draft",
  "job_id",
  "mode",
  "name",
  "partner_id",
  "register",
  "test_index",
  "test_run_id",
];
const DRAFT_KEYS = [
  "body",
  "created_at",
  "draft_id",
  "language",
  "rules_version",
  "sha256",
  "signature",
  "subject",
];
const SEND_KEYS = [
  "backoff_until",
  "daily_first_limit",
  "day_stopped_on",
  "env_checked_at",
  "env_mailbox_ok",
  "env_test_count",
  "env_test_ok",
  "first_limit_today",
  "first_real_send_on",
  "first_sent_today",
  "imap_login_at",
  "imap_login_code",
  "last_outcome",
  "last_tick_at",
  "next_send_after",
  "next_window_rome",
  "priorities",
  "ready",
  "recent",
  "smtp_login_at",
  "smtp_login_code",
  "stop_reason",
  "stopped_at",
  "test_confirmed_at",
  "test_confirmed_by",
  "test_limit",
  "test_run",
  "test_sent_today",
  "window_open_rome",
];
const SEND_RPC_SIGNATURES = [
  "claim_partner_assistant_send(uuid,integer,integer)",
  "skip_partner_assistant_send(uuid,uuid,text)",
  "prepare_partner_assistant_send(uuid,uuid,jsonb)",
  "start_partner_assistant_send(uuid,uuid)",
  "finish_partner_assistant_send(uuid,uuid,jsonb)",
  "record_partner_assistant_append(uuid,uuid,jsonb)",
  "pause_partner_assistant_send(uuid,text)",
  "release_partner_assistant_send(uuid,jsonb)",
  "record_partner_assistant_environment(jsonb)",
];
const SECTION_2_HELPERS = [
  "private.partner_assistant_country_code(text)",
  "private.partner_assistant_valid_timezone(text)",
  "private.partner_assistant_window_open(text,text,timestamptz)",
  "private.partner_assistant_next_window(timestamptz)",
  "private.partner_assistant_address(text)",
  "private.partner_assistant_first_real_day()",
  "private.partner_assistant_first_limit(date)",
  "private.partner_assistant_first_sent(date)",
  "private.partner_assistant_test_sent(date)",
  "private.partner_assistant_mail_guard(uuid,boolean)",
  "private.partner_assistant_count_failure(text)",
  "private.partner_assistant_test_pairs(uuid,integer)",
  "private.partner_assistant_send_move(uuid,uuid,text)",
];
const SECTION_2_FUNCTIONS = [
  ...SECTION_2_HELPERS,
  ...SEND_RPC_SIGNATURES.flatMap((f) => [`private.${f}`, `public.${f}`]),
  "private.read_partner_assistant_send()",
  "public.read_partner_assistant_send()",
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
    "_assistente_partner_invio.sql",
  ])
    await db.exec(migration(suffix));

  for (const [userId, name, role] of [
    [founder, "Fondatore sintetico", "founder"],
    [consultant, "Consulente sintetico", "consultant"],
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

  // Calendario: finestra del destinatario, feste e paesi.
  eq(await open("Europe/Rome", "Italia", "2026-11-10T08:29:00Z"), false); // 9:29
  eq(await open("Europe/Rome", "Italia", "2026-11-10T08:30:00Z"), true); // 9:30
  eq(await open("Europe/Rome", "Italia", "2026-11-10T09:59:00Z"), true); // 10:59
  eq(await open("Europe/Rome", "Italia", "2026-11-10T10:00:00Z"), false); // 11:00
  eq(
    await open("Europe/Rome", "Italia", "2026-10-29T08:30:00Z"),
    true,
    "giovedì 29 ottobre, ora solare",
  );
  eq(await open("Europe/London", "Regno Unito", "2026-11-10T09:30:00Z"), true);
  eq(await open("Europe/London", "Regno Unito", "2026-11-10T08:30:00Z"), false);
  eq(await open("Europe/Rome", "Italia", "2026-10-31T09:00:00Z"), false, "sabato");
  eq(await open("Europe/Rome", "Italia", "2026-12-08T09:00:00Z"), false);
  eq(await open("Europe/London", "Regno Unito", "2026-12-08T10:00:00Z"), true);
  eq(await open("Europe/Paris", "Francia", "2026-11-11T09:00:00Z"), false);
  eq(await open("Europe/Rome", "Italia", "2026-11-11T09:00:00Z"), true);
  eq(await open("Europe/Rome", "", "2026-12-08T09:00:00Z"), true, "senza paese nessuna festa");
  eq(await open("", "Italia", "2026-11-10T08:30:00Z"), true, "senza fuso: Roma");
  eq(await open("Mars/Base", "Italia", "2026-11-10T08:30:00Z"), true);
  eq(await open("Europe/Rome", "Italia", "2026-12-21T09:00:00Z"), false);
  eq(await open("Europe/Rome", "Italia", "2027-01-07T09:00:00Z"), false);
  eq(await open("Europe/Rome", "Italia", "2027-01-08T09:00:00Z"), true);
  eq(await code(" Regno Unito "), "GB");
  eq(await code("germania"), "DE");
  eq(await code("Narnia"), null);
  eq(await code(""), null);
  eq(await fn("private.partner_assistant_valid_timezone('Europe/Rome')"), true);
  eq(await fn("private.partner_assistant_valid_timezone('Mars/Base')"), false);
  eq(await fn("private.partner_assistant_valid_timezone('UTC; drop table x')"), false);
  eq(await fn("private.partner_assistant_valid_timezone(null)"), false);
  eq(await holidayCounts(), { IT: 2, AT: 2, FR: 2, ES: 3, BE: 2 });
  ok(await holidaysBetween("2026-10-29", "2027-01-31"));
  ok(await holidaysOutside("12-21", "01-07"));
  eq(
    await nextWindow("2026-10-31T10:00:00Z"),
    "2026-11-02T08:30:00+00:00",
    "sabato: lunedì alle 9:30",
  );
  eq(await nextWindow("2026-11-10T09:00:00Z"), "2026-11-10T09:00:00+00:00", "finestra aperta");
  eq(
    await nextWindow("2026-12-18T10:30:00Z"),
    "2027-01-08T08:30:00+00:00",
    "dopo le feste di fine anno",
  );
  eq(
    await fn("private.partner_assistant_address(' Info@Club.Example.Test ')"),
    "info@club.example.test",
  );
  eq(await fn("private.partner_assistant_address('o''neil@club.example.test')"), null);
  eq(await fn(`private.partner_assistant_address('${"a".repeat(65)}@club.example.test')`), null);

  // Limiti delle prime email: 5 nei primi 7 giorni dal primo invio vero, poi daily_first_limit.
  eq(await firstLimit("2026-10-29"), 5);
  await realFirstSent("2026-10-29", 5);
  eq(await fn("private.partner_assistant_first_real_day()::text"), "2026-10-29");
  eq(await fn("private.partner_assistant_first_sent('2026-10-29'::date)"), 5);
  eq(await firstLimit("2026-11-04"), 5);
  eq(await firstLimit("2026-11-05"), 10);
  await setDailyLimit(15);
  eq(await firstLimit("2026-11-05"), 15);
  await resetSends();
  await setDailyLimit(10);
  eq(await fn("private.partner_assistant_first_real_day()"), null);

  // modalità
  await setModeOwner("prepara");
  eq((await claimAt("2026-11-10T08:30:00Z")).reason, "prepara");
  await setModeOwner("spento");
  eq((await claimAt("2026-11-10T08:30:00Z")).reason, "spento");
  eq((await mailState()).lease_token, null, "idle: nessuna lease");
  await confirmTestOwner();
  await setModeOwner("invio");
  // argomenti
  await rejects(
    () =>
      atTime(lastAt, () =>
        rpc("select public.claim_partner_assistant_send($1, 30, 0) r", [WORKER]),
      ),
    "22023",
  );
  await rejects(
    () =>
      atTime(lastAt, () =>
        rpc("select public.claim_partner_assistant_send($1, 300, 6) r", [WORKER]),
      ),
    "22023",
  );
  await readyFirst(951);
  await readyFirst(952, { sendPriority: 9 });
  eq((await claimAt("2026-11-10T06:00:00Z")).reason, "fuori_finestra", "7:00 a Roma");
  ok((await mailState()).last_tick_at, "ogni giro segna l'ora");
  const claimed = await claimAt("2026-11-10T08:30:00Z");
  eq([claimed.status, claimed.mode, claimed.appends], ["claimed", "invio", []]);
  const c = claimed.candidate;
  eq(c.co, 952, "send_priority prima");
  eq(Object.keys(c).sort(), CANDIDATE_KEYS);
  eq(Object.keys(c.draft).sort(), DRAFT_KEYS);
  eq(c.address, "info@club-952.example.test");
  eq([c.test_run_id, c.test_index], [null, null]);
  eq(Object.keys(c.choice).sort(), ["contact_kind", "event_starts_on", "request"]);
  eq(c.choice, { contact_kind: "club", event_starts_on: "", request: "merch_cobranding" });
  eq([c.register, c.name, c.mode], ["voi", "Club Sintetico 952", "invio"]);
  ok(c.draft.created_at);
  eq((await mailState()).lease_token, claimed.lease_token, "la lease è nello stato della casella");
  eq((await claimAt("2026-11-10T08:30:30Z")).reason, "occupato");
  eq(
    (await prepare(c, { mailbox_check: "trovata" })).reason,
    "casella",
    "in invio solo dopo un controllo vuoto",
  );
  eq((await prepare(c, { mailbox_check: "incerta" })).reason, "casella");
  await rejects(() => prepare(c, { mailbox_check: "forse" }), "22023");
  await rejects(() => prepare(c, { message_id: "<senza-uuid@luckylap.example.test>" }), "22023");
  const p = await prepare(c);
  eq(p.status, "pronto");
  const prepared = await message(p);
  eq(pick(prepared, ["send_status", "mode", "kind", "to_address", "send_day", "sent_at"]), {
    send_status: "pronto",
    mode: "invio",
    kind: "primo",
    to_address: "info@club-952.example.test",
    send_day: null,
    sent_at: null,
  });
  eq(prepared.body, approvedText(c), "il testo è quello composto, frase di uscita compresa");
  eq(prepared.lease_token, claimed.lease_token);
  eq(prepared.created_by, assistant);
  eq((await prepare(c, { message_id: newId(), operation_id: newOp() })).reason, "doppione");
  eq(await liveMessages(pid(952)), 1);
  eq(
    await atTime(lastAt, () =>
      rpc("select public.start_partner_assistant_send($1, $2) r", [randomUUID(), p.message_row_id]),
    ),
    { status: "lease_persa" },
    "un'altra lease non parte",
  );
  eq((await start(p)).status, "in_invio");
  eq(await messageText(p, "send_day"), "2026-11-10", "giorno di Roma");
  eq(
    (await finishAt("2026-11-10T08:31:00Z", p, { outcome: "inviato", smtp_code: 250 })).send_status,
    "inviato",
  );
  eq((await finish(p, { outcome: "inviato", smtp_code: 250 })).replayed, true);
  eq(pick(await message(p), ["send_status", "smtp_code", "outcome"]), {
    send_status: "inviato",
    smtp_code: 250,
    outcome: null,
  });
  eq(await messageText(p, "sent_at"), "2026-11-10T08:31:00+00:00", "ora dell'assistente");
  eq((await partner(pid(952))).stage, "contattato");
  eq(pick(await job(pid(952)), ["status", "reason"]), { status: "inviata", reason: null });
  eq((await activities(pid(952))).at(-1), {
    kind: "inviato",
    origin: "assistente",
    message_kind: "primo",
    channel: "email",
    body: "",
    stage_before: "da_contattare",
    stage_after: "contattato",
  });
  eq(await activityCount(pid(952)), 1, "una sola riga di registro");
  eq((await followUpTask(pid(952))).assigned_to, founder);
  eq((await followUpTask(pid(952))).created_by, assistant);
  ok(between(await nextSendAfterMinutes("2026-11-10T08:31:00Z"), 4, 11));
  await rejects(
    () => release({ outcome: "inviato", smtp_login: "ok", imap_login: "ok", altro: 1 }),
    "22023",
  );
  await release({ outcome: "inviato", smtp_login: "ok", imap_login: "ok" });
  eq(
    pick(await mailState(), ["smtp_login_code", "imap_login_code", "last_outcome", "lease_token"]),
    { smtp_login_code: "ok", imap_login_code: "ok", last_outcome: "inviato", lease_token: null },
  );
  ok((await mailState()).smtp_login_at);
  eq(await stateText("imap_login_at"), "2026-11-10T08:31:00+00:00");
  const a = await claimAt("2026-11-10T08:32:00Z");
  eq(
    [a.status, a.candidate, a.appends.map((x) => x.message_row_id)],
    ["claimed", null, [p.message_row_id]],
    "copia in Posta inviata da fare, intervallo in corso",
  );
  eq(Object.keys(a.appends[0]).sort(), ["message_id", "message_row_id", "raw", "sent_at"]);
  eq(a.appends[0].raw, prepared.raw);
  await recordAppend(p, { found: false });
  await release();
  ok((await message(p)).appended_at);
  eq((await claimAt("2026-11-10T08:33:00Z")).reason, "intervallo");

  // impronta e testo dopo la firma: un contatto per caso, perché impronta passa il lavoro a Tommi
  await readyFirst(953);
  const c953 = await candidateAt("2026-11-10T09:00:00Z", 953);
  eq(
    (await prepare(c953, { text: approvedText(c953) + "\n\nhttps://altro.example.test" })).reason,
    "impronta",
  );
  eq((await job(pid(953))).reason, "impronta");
  eq((await job(pid(953))).status, "serve_tommaso");
  await readyFirst(954);
  const c954 = await candidateAt("2026-11-10T09:05:00Z", 954);
  eq(
    (await prepare(c954, { subject: "[Prova] " + c954.draft.subject })).reason,
    "impronta",
    "l'oggetto è quello della bozza",
  );
  await readyFirst(959);
  const c959 = await candidateAt("2026-11-10T09:10:00Z", 959);
  eq(
    (await prepare(c959, { opt_out: "Chiama il 333 0000000" })).reason,
    "impronta",
    "frase di uscita fuori forma",
  );
  // La frase di uscita si controlla anche quando il testo la contiene davvero.
  for (const [co, optOut] of [
    [991, "Chiamate il numero 333 per non ricevere altre email da noi."],
    [992, "Per non ricevere altre email da noi visitate https://club.example.test"],
    [993, "Per non ricevere altre email scrivete a info@club.example.test oggi."],
    [994, "Rispondete pure."],
  ]) {
    await readyFirst(co);
    const cx = await candidateAt("2026-11-10T09:12:00Z", co);
    eq(
      (
        await prepare(cx, {
          opt_out: optOut,
          text: `${cx.draft.body}\n\n${cx.draft.signature}\n\n${optOut}`,
        })
      ).reason,
      "impronta",
      `frase di uscita fuori forma: ${optOut}`,
    );
  }
  await readyFirst(982);
  const c982 = await candidateAt("2026-11-10T09:12:00Z", 982);
  const mid982 = newId();
  eq(
    (
      await prepare(c982, {
        message_id: mid982,
        raw: mime({
          to: c982.address,
          subject: c982.draft.subject,
          messageId: newId(),
          text: approvedText(c982),
        }),
      })
    ).reason,
    "impronta",
    "il raw porta il Message-ID del messaggio",
  );
  // Fuoco 3: fermi tra prepare e SMTP
  await readyFirst(955);
  const q = await prepare(await candidateAt("2026-11-10T09:15:00Z", 955));
  await setModeOwner("spento");
  eq((await start(q)).status, "stop");
  eq((await message(q)).send_status, "scartato");
  eq((await message(q)).outcome, "modalita_cambiata");
  await setModeOwner("invio");
  await readyFirst(956);
  const r956 = await prepare(await candidateAt("2026-11-10T09:20:00Z", 956));
  await dncAs(consultant, pid(956));
  eq(
    await start(r956),
    { status: "stop", reason: "non_idoneo" },
    "Non contattare dopo la preparazione",
  );
  await readyFirst(973);
  const r973 = await prepare(await candidateAt("2026-11-10T09:25:00Z", 973));
  await switchOff(pid(973));
  eq((await start(r973)).status, "stop");
  await readyFirst(974);
  const r974 = await prepare(await candidateAt("2026-11-10T09:30:00Z", 974));
  await requeueJob(pid(974));
  eq(
    await start(r974),
    { status: "stop", reason: "bozza_cambiata" },
    "regole nuove salvate dopo prepare",
  );
  eq((await message(r974)).send_status, "scartato");
  await readyFirst(987);
  const r987 = await prepare(await candidateAt("2026-11-10T09:35:00Z", 987));
  await pauseSend("casella");
  eq((await mailState()).stop_reason, "casella");
  eq((await lastEvent()).outcome, "fermo_casella");
  eq(await start(r987), { status: "stop", reason: "fermo" }, "credenziali IMAP rifiutate");
  await rejects(() => pauseSend("rimbalzi"), "22023");
  await resumeAsFounder();
  await readyFirst(997);
  const r997 = await prepare(await candidateAt("2026-11-10T09:59:00Z", 997)); // 10:59 a Roma
  lastAt = "2026-11-10T10:00:00Z";
  eq(
    await start(r997),
    { status: "stop", reason: "finestra_chiusa" },
    "la finestra chiude tra prepare e start",
  );
  // Fuoco 4: giro morto dopo start
  await readyFirst(957);
  const u = await prepare(await candidateAt("2026-11-11T08:40:00Z", 957));
  await start(u);
  const deadLease = heldLease;
  await expireLease();
  await claimAt("2026-11-11T09:00:00Z");
  eq(
    await finish(u, { outcome: "inviato", smtp_code: 250 }, deadLease),
    { status: "lease_persa" },
    "il giro morto torna dopo la ripresa: niente da registrare",
  );
  eq((await message(u)).send_status, "incerto");
  eq((await message(u)).outcome, "in_invio_abbandonato");
  ok((await message(u)).sent_at);
  eq((await job(pid(957))).reason, "invio_incerto");
  eq((await job(pid(957))).status, "serve_tommaso");
  ok((await eventCount("invio_abbandonato")) >= 1);
  await rejects(
    () => insertMessage({ partner: pid(957), mode: "invio", send_status: "pronto" }),
    "23505",
  ); // mai una seconda prima email
  await readyFirst(958);
  const w = await prepare(await candidateAt("2026-11-11T09:10:00Z", 958));
  const expiredLease = heldLease;
  await expireLease();
  eq(
    await atTime(lastAt, () =>
      rpc("select public.start_partner_assistant_send($1, $2) r", [expiredLease, w.message_row_id]),
    ),
    { status: "lease_persa" },
    "lease scaduta: start non parte",
  );
  await claimAt("2026-11-11T09:20:00Z");
  eq((await message(w)).send_status, "scartato");
  eq((await message(w)).outcome, "pronto_abbandonato");
  eq((await job(pid(958))).status, "pronta");
  // Fuoco 1: stesso indirizzo su due schede, anche prima della copia in Posta inviata
  await resetSendClock();
  await readyFirst(960, { email: "info@raduno-960.example.test" });
  await sendAll(960, { at: "2026-11-11T09:30:00Z", append: false });
  await readyFirst(961, { email: "info@raduno-960.example.test" });
  await onlyQueue(961);
  await claimAt("2026-11-11T09:45:00Z");
  eq((await job(pid(961))).reason, "conversazione_esistente");
  eq(await liveMessages(pid(961)), 0);
  await recordAppend(await lastMessage(pid(960)), { found: false });
  await release();
  // …e anche quando l'altra email arriva tra claim e prepare.
  await readyFirst(998, { email: "info@raduno-998.example.test" });
  await readyFirst(999, { email: "info@raduno-998.example.test" });
  const c998 = await candidateAt(await nextOpen(), 998);
  await insertMessage({
    partner: pid(999),
    send_status: "inviato",
    send_day: "2026-11-11",
    sent_at: "2026-11-11T09:00:00Z",
    appended_at: "2026-11-11T09:01:00Z",
    to_address: "info@raduno-998.example.test",
  });
  eq((await prepare(c998)).reason, "conversazione_esistente");
  eq(pick(await job(pid(998)), ["status", "reason"]), {
    status: "serve_tommaso",
    reason: "conversazione_esistente",
  });
  await release();
  // Fuoco 2: indirizzi della scheda
  await readyFirst(962, { email: "Info@Club-962.Example.Test" });
  eq((await candidateAt(await nextOpen(), 962)).address, "info@club-962.example.test");
  await release();
  await readyFirst(963, { email: "o'neil@club-963.example.test" });
  await onlyQueue(963);
  await claimAt(await nextOpen());
  eq((await job(pid(963))).reason, "indirizzo_non_valido");
  // pulizia, fino al candidato, oltre le prime 20 righe
  await readyFirst(964, { researchDaysAgo: 22 });
  await onlyQueue(964);
  await claimAt(await nextOpen());
  eq(
    [(await job(pid(964))).status, (await job(pid(964))).step, (await job(pid(964))).draft_id],
    ["in_coda", "ricerca", null],
  );
  eq(pick(await job(pid(964)), ["research_note_id", "choice_note_id", "attempts", "rewrites"]), {
    research_note_id: null,
    choice_note_id: null,
    attempts: 0,
    rewrites: 0,
  });
  await readyFirst(965);
  await deactivateDraftContact(pid(965));
  await onlyQueue(965);
  await claimAt(await nextOpen());
  eq(pick(await job(pid(965)), ["status", "step", "draft_id"]), {
    status: "in_coda",
    step: "scrittura",
    draft_id: null,
  });
  await readyFirst(988);
  await asOwner(
    "insert into public.partner_assistant_rules(version, body, created_by) values (2, 'Regole v2', $1)",
    [founder],
  );
  await onlyQueue(988);
  await claimAt(await nextOpen());
  eq(pick(await job(pid(988)), ["status", "step", "draft_id"]), {
    status: "in_coda",
    step: "scrittura",
    draft_id: draftIds.get(pid(988)),
  });
  eq(await eventCount("regole_superate"), 1);
  for (let co = 1001; co <= 1021; co++)
    await readyFirst(co, { tz: "America/Los_Angeles", researchDaysAgo: 10 }); // 21 righe con la finestra chiusa
  await readyFirst(975, { email: "o'hara@club-975.example.test", researchDaysAgo: 5 });
  await readyFirst(976, { researchDaysAgo: 1 });
  await onlyQueue(...range(1001, 1021), 975, 976);
  await release();
  eq((await claimAt(await nextOpen())).candidate.co, 976);
  eq(
    (await job(pid(975))).reason,
    "indirizzo_non_valido",
    "la riga oltre le prime 20 è pulita prima del candidato",
  );
  eq((await job(pid(1001))).status, "pronta", "finestra chiusa: la riga resta");
  await release();
  await readyFirst(989, { researchDaysAgo: 30 });
  await onlyQueue(989, ...range(1001, 1021));
  eq(
    (await claimAt(await nextOpen())).reason,
    "fuori_finestra",
    "dopo una riga spostata, una riga chiusa resta chiusa",
  );
  eq((await job(pid(989))).step, "ricerca");
  // Q15: un evento già iniziato non parte e non sale in testa alla coda
  await readyFirst(977, { eventStartsOn: "2026-11-09" });
  await readyFirst(978, { eventStartsOn: "2026-12-20" });
  await onlyQueue(977, 978);
  await release();
  const c978 = (await claimAt(await nextOpen())).candidate;
  eq(c978.co, 978);
  eq(c978.choice.event_starts_on, "2026-12-20");
  eq(
    [(await job(pid(977))).status, (await job(pid(977))).reason],
    ["serve_tommaso", "bozza_scaduta"],
  );
  // limiti del giorno e capacità
  await release();
  const erasedCo = nextSyntheticCo;
  await sendFirstsOn("2026-11-12", 5);
  eq((await claimAt("2026-11-12T09:30:00Z")).reason, "limite");
  // Cancellazione definitiva dopo l'invio: la riga resta, senza indirizzo né testi, e conta ancora
  // per il limite del giorno, il primo giorno vero e la guardia sullo stesso indirizzo.
  const erasedRow = await one(
    `select id, send_day::text, sent_at from public.partner_assistant_messages where partner_id = $1`,
    [pid(erasedCo)],
  );
  await eraseContactOf(pid(erasedCo));
  await eraseContactOf(pid(952)); // il primo invio vero, del 10 novembre
  const erased = await one("select * from public.partner_assistant_messages where id = $1", [
    erasedRow.id,
  ]);
  eq(pick(erased, ["mode", "send_status", "to_address", "subject", "body", "raw", "draft_id"]), {
    mode: "invio",
    send_status: "inviato",
    to_address: "cancellato@cancellato.invalid",
    subject: "Dato cancellato",
    body: "Dato cancellato.",
    raw: "Dato cancellato.",
    draft_id: null,
  });
  eq(erased.sha256, sha("Dato cancellato."));
  eq(erased.address_sha256, sha(`info@club-${erasedCo}.example.test`), "l'impronta dell'indirizzo");
  ok(erased.erased_at);
  eq(
    [
      await value(
        "select send_day::text as v from public.partner_assistant_messages where id = $1",
        [erased.id],
      ),
      erased.sent_at,
    ],
    [erasedRow.send_day, erasedRow.sent_at],
  );
  eq(await countDrafts(pid(erasedCo)), 0, "la bozza è cancellata");
  eq(
    pick(await job(pid(erasedCo)), ["status", "reason", "draft_id"]),
    {
      status: "inviata",
      reason: null,
      draft_id: null,
    },
    "il lavoro «inviata» non torna indietro",
  );
  eq(await fn("private.partner_assistant_first_sent('2026-11-12'::date)"), 5);
  eq(await fn("private.partner_assistant_first_real_day()::text"), "2026-11-10");
  eq((await claimAt("2026-11-12T09:40:00Z")).reason, "limite", "il limite resta pieno");
  await release();
  await readyFirst(1101, { email: `info@club-${erasedCo}.example.test` });
  await onlyQueue(1101);
  await resetSendClock();
  await claimAt("2026-11-13T08:30:00Z");
  eq(
    pick(await job(pid(1101)), ["status", "reason"]),
    { status: "serve_tommaso", reason: "conversazione_esistente" },
    "lo stesso indirizzo su un'altra scheda resta bloccato dopo la cancellazione",
  );
  await release();
  // Il giro d'invio non copia in «Posta inviata» una riga cancellata.
  const p1102 = await sentPartner(1102);
  const unappended = await insertMessage({
    partner: p1102,
    send_status: "inviato",
    send_day: "2026-11-13",
    sent_at: "2026-11-13T08:31:00Z",
  });
  await eraseContactOf(p1102);
  const ap1102 = await claimAt("2026-11-13T08:35:00Z");
  eq(
    (ap1102.appends ?? []).some((x) => x.message_row_id === unappended),
    false,
    "nessuna copia della riga cancellata",
  );
  await release();
  // esiti SMTP, tutti martedì 17 novembre
  await resetSendClock();
  await finish(await sendUntilStart(966, "2026-11-17T08:31:00Z"), {
    outcome: "respinto",
    smtp_code: 550,
    enhanced_code: "5.1.1",
    spam: false,
  });
  eq((await job(pid(966))).reason, "indirizzo_non_valido");
  eq((await mailState()).hard_failures, 1);
  eq(await stateText("failures_day"), "2026-11-17");
  ok(between(await nextSendAfterMinutes("2026-11-17T08:31:00Z"), 4, 11), "anche dopo un rifiuto");
  await resetSendClock();
  await finish(await sendUntilStart(967, "2026-11-17T08:40:00Z"), {
    outcome: "respinto",
    smtp_code: 554,
    enhanced_code: "5.5.0",
    spam: false,
  });
  eq((await job(pid(967))).reason, "invio_rifiutato");
  eq((await mailState()).stop_reason, "rimbalzi", "due rifiuti definitivi nello stesso giorno");
  eq(await eventCount("fermo_rimbalzi"), 1);
  await release();
  eq((await claimAt("2026-11-17T08:50:00Z")).reason, "fermo");
  await resumeAsFounder();
  await resetSendClock();
  await finish(await sendUntilStart(968, "2026-11-17T08:55:00Z"), {
    outcome: "respinto",
    smtp_code: 554,
    enhanced_code: "5.7.1",
    spam: true,
  });
  eq((await mailState()).stop_reason, "rimbalzi");
  await resumeAsFounder();
  for (const t of ["09:00", "09:05", "09:10"]) {
    await resetSendClock();
    await finish(await sendUntilStart(969, `2026-11-17T${t}:00Z`), {
      outcome: "scartato",
      reason: "smtp_temporaneo",
      smtp_code: 450,
    });
  }
  eq((await job(pid(969))).status, "pronta", "4.x.x: si riprova");
  eq((await mailState()).soft_failures, 3);
  eq(await eventCount("fermo_oggi"), 1);
  await release();
  eq((await claimAt("2026-11-17T09:20:00Z")).reason, "fermo_oggi");
  ok((await claimAt("2026-11-18T08:30:00Z")).candidate);
  await resetSendClock();
  await finish(await sendUntilStart(970, "2026-11-18T08:40:00Z"), {
    outcome: "scartato",
    reason: "smtp_credenziali",
  });
  eq((await mailState()).stop_reason, "casella");
  eq((await job(pid(970))).status, "pronta");
  await resumeAsFounder();
  await resetSendClock();
  await finish(await sendUntilStart(971, "2026-11-18T08:45:00Z"), { outcome: "incerto" });
  eq((await job(pid(971))).reason, "invio_incerto");
  ok((await message(await lastMessage(pid(971)))).sent_at);
  await resetSendClock();
  await finish(await sendUntilStart(979, "2026-11-18T08:50:00Z"), {
    outcome: "scartato",
    reason: "smtp_bloccato",
  });
  eq((await mailState()).stop_reason, "rimbalzi");
  eq((await job(pid(979))).status, "pronta", "bloccato non tocca il contatto");
  await resumeAsFounder();
  await rejects(
    () => finish({ message_row_id: randomUUID() }, { outcome: "scartato", reason: "boh" }),
    "22023",
  );
  // Fuoco 5: «non so» della casella
  await resetSendClock();
  await readyFirst(972);
  await skip(await candidateAt("2026-11-18T09:00:00Z", 972), "casella_incerta");
  eq((await job(pid(972))).status, "pronta", "il lavoro resta");
  await release();
  eq((await claimAt("2026-11-18T09:10:00Z")).reason, "attesa");
  ok((await claimAt("2026-11-18T09:16:00Z")).candidate);
  await skip(await candidateAt("2026-11-18T09:17:00Z", 972), "conversazione_esistente");
  eq((await job(pid(972))).reason, "conversazione_esistente");
  await resetSendClock();
  const p983 = await sendAll(983, { at: "2026-11-18T09:20:00Z", append: false });
  const ap = await claimAt("2026-11-18T09:35:00Z");
  eq(ap.appends.length, 1);
  await skip(null, "casella_incerta");
  await release(); // copia arretrata non chiusa: attesa senza lavoro
  eq(
    (await claimAt("2026-11-18T09:45:00Z")).status,
    "idle",
    "in attesa niente appends: il passo con Claude può girare",
  );
  eq(
    (await claimAt("2026-11-18T09:51:00Z")).appends.length,
    1,
    "dopo 15 minuti la copia si riprova",
  );
  await recordAppend(p983, { found: true });
  await release();
  await rejects(() => skip(null, "conversazione_esistente"), "22023");
  await rejects(() => skip({ job_id: randomUUID() }, "altro"), "22023");
  // Q15: bozza scaduta dal ricontrollo del compito 5
  await resetSendClock();
  await readyFirst(984);
  await skip(await candidateAt("2026-11-19T08:30:00Z", 984), "bozza_scaduta");
  eq(pick(await job(pid(984)), ["status", "step", "rewrites", "draft_id"]), {
    status: "in_coda",
    step: "scrittura",
    rewrites: 1,
    draft_id: null,
  });
  await readyFirst(985);
  await setJobOwner(pid(985), { rewrites: 1 });
  await skip(await candidateAt("2026-11-19T08:35:00Z", 985), "bozza_scaduta");
  eq(
    [(await job(pid(985))).status, (await job(pid(985))).reason],
    ["serve_tommaso", "bozza_scaduta"],
    "la seconda volta a Tommi",
  );
  await asOwner(`update private.partner_assistant_config set paused_reason = 'credito'`);
  await readyFirst(986);
  await skip(await candidateAt("2026-11-19T08:40:00Z", 986), "bozza_scaduta");
  eq((await job(pid(986))).reason, "bozza_scaduta", "senza credito niente riscrittura");
  await asOwner(`update private.partner_assistant_config set paused_reason = null`);
  await release();
  // prova, dopo gli invii veri: next_send_after non è nel futuro
  await setModeOwner("prova");
  await resetSendClock();
  await readyFirst(980);
  await readyFirst(981);
  await onlyQueue(980, 981);
  const run = await startTestAs(founder, { drafts: 2, recipients: 3 });
  eq((await claimAt("2026-11-19T20:00:00Z", 0)).reason, "vuota", "nessun indirizzo di prova");
  const t0 = (await claimAt("2026-11-19T20:00:00Z", 3)).candidate;
  eq(
    [t0.co, t0.test_index, t0.mode, t0.test_run_id],
    [980, 0, "prova", run],
    "prova: niente finestra",
  );
  ok(t0.address);
  eq(
    (await prepare(t0, { to_address: "info@club-981.example.test" })).reason,
    "destinatario_prova",
  );
  eq((await prepare(t0, { mode: "invio" })).reason, "modalita_cambiata");
  eq(
    (await prepare(t0, { to_address: "prova1@example.test", test_index: 3 })).reason,
    "modalita_cambiata",
    "indice oltre gli indirizzi della prova",
  );
  const tp = await prepare(t0, { to_address: "prova1@example.test", mailbox_check: "trovata" });
  eq(tp.status, "pronto", "in prova il controllo non blocca");
  eq((await lastEvent()).outcome, "prova_casella_trovata");
  await start(tp);
  await finish(tp, { outcome: "inviato", smtp_code: 250 });
  eq((await lastEvent()).outcome, "prova_inviata");
  await recordAppend(tp, { found: false });
  await release();
  eq((await job(pid(980))).status, "pronta");
  eq((await partner(pid(980))).stage, "da_contattare");
  eq(await activityCount(pid(980)), 0);
  eq(await followUpTaskCount(pid(980)), 0);
  eq((await claimAt("2026-11-19T20:02:00Z", 3)).reason, "intervallo");
  eq(await testPairsInOrder(run, 3), [
    [980, 1],
    [980, 2],
    [981, 0],
    [981, 1],
    [981, 2],
  ]);
  eq(
    await testPairsInOrder(run, 2),
    [
      [980, 1],
      [981, 0],
      [981, 1],
    ],
    "indirizzi di prova scesi a 2: l'indice 2 non parte",
  );
  await requeueJob(pid(981));
  eq(
    await testPairsInOrder(run, 3),
    [
      [980, 1],
      [980, 2],
    ],
    "bozza cambiata: la coppia non parte",
  );
  await sendTests(15, "2026-11-20");
  eq((await claimAt("2026-11-20T15:00:00Z", 3)).reason, "limite");
  // variabili e accessi
  await recordEnv({ mailbox_ok: true, test_ok: true, test_count: 4 });
  eq(pick(await sendAs(consultant), ["env_mailbox_ok", "env_test_ok", "env_test_count"]), {
    env_mailbox_ok: true,
    env_test_ok: true,
    env_test_count: 4,
  });
  ok((await sendAs(consultant)).env_checked_at);
  await rejects(() => recordEnv({ mailbox_ok: true, test_ok: true, test_count: 6 }), "22023");
  await rejects(() => recordEnv({ mailbox_ok: true, test_ok: false, test_count: 2 }), "22023");
  await rejects(
    () => release({ outcome: "fine", smtp_login: "Login OK", imap_login: null }),
    "22023",
  );
  // lettura
  const read = await sendAs(consultant);
  eq(Object.keys(read).sort(), SEND_KEYS);
  eq(JSON.stringify(read.recent).includes("@"), false);
  eq(read.recent.length, 20);
  eq(Object.keys(read.recent[0]).sort(), ["at", "co", "mode", "name", "status", "subject"]);
  eq(pick(read, ["test_limit", "test_sent_today", "first_real_send_on", "daily_first_limit"]), {
    test_limit: 15,
    test_sent_today: 15,
    first_real_send_on: "2026-11-10",
    daily_first_limit: 10,
  });
  eq(read.test_confirmed_by, "Fondatore sintetico");
  eq(pick(read.test_run, ["drafts", "recipients", "sent"]), { drafts: 2, recipients: 3, sent: 1 });
  eq([read.window_open_rome, read.ready], [false, 1]);
  eq(new Date(read.next_window_rome).toISOString(), "2026-11-23T08:30:00.000Z", "lunedì alle 9:30");
  eq(
    (await sendAs(consultant)).priorities.map((x) => x.co),
    [952],
  );
  await rejects(() => sendAs(null), "42501");
  // permessi
  for (const f of SEND_RPC_SIGNATURES) {
    eq(await canExecute("service_role", `public.${f}`), true);
    eq(await canExecute("service_role", `private.${f}`), true);
    eq(await canExecute("authenticated", `public.${f}`), false);
    eq(await canExecute("anon", `public.${f}`), false);
  }
  eq(await canExecute("authenticated", "public.read_partner_assistant_send()"), true);
  eq(await canExecute("anon", "public.read_partner_assistant_send()"), false);
  eq(await canExecute("service_role", "public.read_partner_assistant_send()"), false);
  for (const f of SECTION_2_HELPERS)
    for (const role of ["anon", "authenticated", "service_role"])
      eq(await canExecute(role, f), false, `${f}: nessun grant a ${role}`);
  await rejects(
    () =>
      as("authenticated", founder, () =>
        rpc("select public.claim_partner_assistant_send($1, 300, 0) r", [WORKER]),
      ),
    "42501",
  );
  eq(await searchPathEmpty(SECTION_2_FUNCTIONS), true);
  console.log(`PASS ${checks} Assistente Partner invio synthetic checks passed.`);
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
