// test-db: postgres minimo 26
// Programma email: hold, prepare, start e CAS su PostgreSQL17 reale con connessioni distinte.
// Si osserva il blocco in pg_stat_activity; begin prima dello SMTP lo impedisce,
// start prima di begin rende il testo non più modificabile. Due save producono una revisione;
// erase non risuscita dati e un hold non ferma gli altri contatti.
// Cluster temporaneo, Auth e dati sintetici, nessun DSN o accesso cloud.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const [bin, modulePath] = process.argv.slice(2);
if (!bin?.startsWith("/") || !modulePath?.startsWith("/"))
  throw Error("Servono percorsi assoluti per PostgreSQL 17 e pg.");
const imported = await import(pathToFileURL(modulePath).href),
  Client = imported.Client ?? imported.default.Client;
const command = (name, args) => {
  const result = spawnSync(join(bin, name), args, {
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.status !== 0) throw Error(`${name}: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
};
assert.match(command("postgres", ["--version"]), /PostgreSQL\) 17\./);
const directory = mkdtempSync("/private/tmp/luckylap-partner-assistant-invio-"),
  data = join(directory, "data"),
  socket = join(directory, "socket");
mkdirSync(socket, { mode: 0o700 });
const clients = [];
let started = false,
  checks = 0;
let owner, a, b, observer;
const eq = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label ?? "Valori diversi");
  checks++;
};
const sha = (text) => createHash("sha256").update(text).digest("hex");
const scalar = async (client, sql, values = []) => (await client.query(sql, values)).rows[0].value;
async function connect() {
  const client = new Client({
    host: socket,
    port: 5432,
    user: "postgres",
    database: "postgres",
    ssl: false,
    statement_timeout: 15000,
  });
  await client.connect();
  clients.push(client);
  return client;
}
// Martedì 10 novembre 2026, 10:00 a Roma: la finestra è aperta.
const AT = "2026-11-10T09:00:00Z";
// Il JWT del worker, come PostgREST, con l'ora dell'assistente fissata nella transazione.
async function beginService(client) {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await client.query("select set_config('luckylap.partner_assistant.now', $1, true)", [AT]);
  await client.query("set local role service_role");
}
async function asService(client, fn) {
  await beginService(client);
  try {
    const result = await fn();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
const capture = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
async function success(promise) {
  const result = await promise;
  if (result.error) throw result.error;
  return result.value;
}
async function waitBlocked(waitingPid, blockingPid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const row = (
      await observer.query(
        "select wait_event_type, pg_blocking_pids(pid) blockers from pg_stat_activity where pid = $1",
        [waitingPid],
      )
    ).rows[0];
    if (row?.wait_event_type === "Lock" && row.blockers.includes(blockingPid)) {
      checks++;
      return;
    }
    await new Promise((done) => setTimeout(done, 20));
  }
  throw Error(
    `Nessuna attesa PostgreSQL reale osservata: ${waitingPid} non bloccato da ${blockingPid}.`,
  );
}

const WORKER = randomUUID();
const SIGNATURE = "Tommaso\nFounder, LuckyLap\nluckylap.com | Instagram @lucky.lap";
const OPT_OUT =
  "Se preferite non ricevere altre email da noi, basta rispondere e non scriveremo ancora.";
const claim = (client) =>
  scalar(client, "select public.claim_partner_assistant_send($1, 300, 0) value", [WORKER]);
const newId = () => `<${randomUUID()}@luckylap.example.test>`;
const approvedText = (c) => `${c.draft.body}\n\n${c.draft.signature}\n\n${OPT_OUT}`;
function payloadOf(c, messageId = newId()) {
  const text = approvedText(c);
  const body = Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, "$&\r\n");
  const raw =
    `From: "Tommaso | LuckyLap" <casella@luckylap.example.test>\r\nTo: ${c.address}\r\n` +
    `Subject: ${c.draft.subject}\r\nMessage-ID: ${messageId}\r\nMIME-Version: 1.0\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}`;
  return {
    schema_version: 1,
    job_id: c.job_id,
    draft_id: c.draft.draft_id,
    mode: c.mode,
    test_run_id: null,
    test_index: null,
    message_id: messageId,
    to_address: c.address,
    subject: c.draft.subject,
    text,
    opt_out: OPT_OUT,
    raw,
    mailbox_check: "vuota",
  };
}
const prepare = (client, lease, payload) =>
  scalar(client, "select public.prepare_partner_assistant_send($1, $2, $3::jsonb) value", [
    lease,
    randomUUID(),
    JSON.stringify(payload),
  ]);
const start = (client, lease, messageRowId) =>
  scalar(client, "select public.start_partner_assistant_send($1, $2) value", [lease, messageRowId]);
const finishSent = (client, lease, messageRowId) =>
  scalar(client, "select public.finish_partner_assistant_send($1, $2, $3::jsonb) value", [
    lease,
    randomUUID(),
    JSON.stringify({
      schema_version: 1,
      message_row_id: messageRowId,
      outcome: "inviato",
      smtp_code: 250,
      enhanced_code: null,
      spam: false,
      reason: null,
    }),
  ]);
const release = (lease) =>
  asService(a, () =>
    scalar(a, "select public.release_partner_assistant_send($1, $2::jsonb) value", [
      lease,
      JSON.stringify({ schema_version: 1, outcome: "fine", smtp_login: null, imap_login: null }),
    ]),
  );

try {
  command("initdb", [
    "-D",
    data,
    "-U",
    "postgres",
    "--auth=trust",
    "--no-locale",
    "--encoding=UTF8",
    "--no-sync",
    "-L",
    resolve(bin, "../share/postgresql"),
  ]);
  command("pg_ctl", [
    "-D",
    data,
    "-l",
    join(directory, "postgres.log"),
    "-o",
    `-k ${socket} -h '' -c fsync=off`,
    "-w",
    "start",
  ]);
  started = true;
  owner = await connect();
  a = await connect();
  b = await connect();
  observer = await connect();
  const pids = {
    a: await scalar(a, "select pg_backend_pid() value"),
    b: await scalar(b, "select pg_backend_pid() value"),
  };
  assert.notEqual(pids.a, pids.b);
  // auth.uid() come in produzione: request.jwt.claim.sub, poi request.jwt.claims->>'sub'.
  await owner.query(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create schema storage; create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb, unique(bucket_id, name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated; grant select, insert, update, delete on storage.objects to authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  const migrations = new URL("../migrations/", import.meta.url),
    names = readdirSync(migrations);
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
    "_assistente_partner_prova_allegati.sql",
    "_partner_programma_email.sql",
  ]) {
    const found = names.filter((name) => name.endsWith(suffix));
    assert.equal(found.length, 1, `Una sola migrazione ${suffix}`);
    await owner.query(readFileSync(new URL(found[0], migrations), "utf8"));
  }
  const founder = randomUUID(),
    assistant = randomUUID();
  for (const [user, name] of [
    [founder, "Fondatore sintetico"],
    [assistant, "Assistente"],
  ]) {
    await owner.query("insert into auth.users values ($1)", [user]);
    await owner.query("insert into public.profiles(user_id, display_name) values ($1, $2)", [
      user,
      name,
    ]);
  }
  await owner.query("insert into public.memberships(user_id, role) values ($1, 'founder')", [
    founder,
  ]);
  eq(
    await asService(a, () =>
      scalar(a, "select public.configure_partner_assistant($1, $2) value", [assistant, founder]),
    ),
    { configured: true },
  );
  await owner.query(
    `update private.partner_assistant_config set mode = 'invio', test_confirmed_at = now(),
       test_confirmed_by = $1`,
    [founder],
  );

  // Un contatto con la bozza pronta, come lo lascia la consegna 1 (di solito Europe/Rome, Italia).
  const ids = new Map();
  async function readyFirst(
    co,
    { researchDaysAgo = 1, tz = "Europe/Rome", country = "Italia" } = {},
  ) {
    const id = randomUUID();
    ids.set(co, id);
    await owner.query(
      `insert into public.partners(id, co, name, origin, stage, created_by, sections, priority, contact_month, country)
       values ($1, $2, $3, 'team', 'da_contattare', $4, array['collab'], 'media', date '2026-11-01', $5)`,
      [id, co, `Club Sintetico ${co}`, founder, country],
    );
    const contact = await scalar(
      owner,
      `insert into public.partner_contacts(partner_id, kind, value, link_value, created_by, updated_by)
       values ($1, 'email', $2, $2, $3, $3) returning id value`,
      [id, `info@club-${co}.example.test`, founder],
    );
    const research = await scalar(
      owner,
      `insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model, operation_id,
         created_by, created_at)
       values ($1, 'ricerca', '{"text": "Ricerca sintetica."}', 1, 'claude-opus-5-5', gen_random_uuid(), $2,
         $3::timestamptz - make_interval(days => $4)) returning id value`,
      [id, assistant, AT, researchDaysAgo],
    );
    const choice = await scalar(
      owner,
      `insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model, operation_id,
         created_by, created_at)
       values ($1, 'scelta', $2::jsonb, 1, 'claude-opus-5-5', gen_random_uuid(), $3,
         $4::timestamptz - interval '20 minutes') returning id value`,
      [
        id,
        JSON.stringify({
          contact_kind: "club",
          register: "voi",
          timezone: tz,
          event_starts_on: "",
          request: "merch_cobranding",
        }),
        assistant,
        AT,
      ],
    );
    const subject = `LuckyLap e Club Sintetico ${co}`;
    const body = `Testo sintetico della prima email per il CO ${co}.`;
    const digest = sha(`${subject}\n\n${body}\n\n${SIGNATURE}`);
    const draft = await scalar(
      owner,
      `insert into public.partner_assistant_drafts(partner_id, contact_id, partner_version, language, subject, body,
         signature, sha256, rules_version, research_note_id, operation_id, created_by, created_at)
       values ($1, $2, 1, 'it', $3, $4, $5, $6, (select max(version) from public.partner_assistant_rules), $7,
         gen_random_uuid(), $8,
         $9::timestamptz - interval '10 minutes') returning id value`,
      [id, contact, subject, body, SIGNATURE, digest, research, assistant, AT],
    );
    await owner.query(
      `insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model, operation_id,
         created_by, created_at)
       values ($1, 'controllo', jsonb_build_object('approved', true, 'problems', '[]'::jsonb, 'sha256', $2::text), 1,
         'claude-opus-5-5', gen_random_uuid(), $3, $4::timestamptz - interval '5 minutes')`,
      [id, digest, assistant, AT],
    );
    await owner.query(
      `insert into public.partner_assistant_jobs(partner_id, status, step, research_note_id, choice_note_id, draft_id)
       values ($1, 'pronta', 'controllo', $2, $3, $4)`,
      [id, research, choice, draft],
    );
    return id;
  }
  // Solo questi contatti in coda d'invio: gli altri lavori «pronta» hanno l'interruttore fermo.
  async function onlyQueue(...cos) {
    const wanted = cos.map((co) => ids.get(co));
    await owner.query(
      `insert into public.partner_assistant_contacts as s (partner_id, active, updated_by)
         select j.partner_id, j.partner_id = any($1::uuid[]), $2 from public.partner_assistant_jobs j
          where j.status = 'pronta' or j.partner_id = any($1::uuid[])
       on conflict (partner_id) do update set active = excluded.active`,
      [wanted, founder],
    );
  }
  const resetSendClock = () =>
    owner.query("update private.partner_assistant_mail_state set next_send_after = null");
  // Un giro d'invio del contatto: claim e prepare, confermati; la lease resta tenuta.
  async function prepared(co) {
    await onlyQueue(co);
    const claimed = await asService(a, () => claim(a));
    eq(claimed.candidate?.co, co, `CO ${co}: candidato`);
    const p = await asService(a, () =>
      prepare(a, claimed.lease_token, payloadOf(claimed.candidate)),
    );
    eq(p.status, "pronto", `CO ${co}: pronto`);
    return { lease: claimed.lease_token, row: p.message_row_id, candidate: claimed.candidate };
  }
  const messageStatus = (row) =>
    scalar(owner, "select send_status value from public.partner_assistant_messages where id = $1", [
      row,
    ]);
  const inFlight = () =>
    scalar(
      owner,
      "select count(*)::int value from public.partner_assistant_messages where send_status = 'in_invio'",
    );
  // Il JWT del founder, come PostgREST: claims locali e set local role authenticated.
  async function beginTeam(client) {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: founder, role: "authenticated" }),
    ]);
    await client.query("select set_config('luckylap.partner_assistant.now', $1, true)", [AT]);
    await client.query("set local role authenticated");
  }
  const teamCommand = (client, name, payload) =>
    scalar(client, `select public.${name}($1, $2::jsonb) value`, [
      randomUUID(),
      JSON.stringify({ schema_version: 1, ...payload }),
    ]);

  const releaseSend = () =>
    owner.query(
      "update private.partner_assistant_mail_state set lease_token=null,lease_expires_at=null,next_send_after=null",
    );
  // Gare tra editor umano e ultimo confine SMTP, su connessioni PostgreSQL distinte.
  const draftFor = (co) =>
    owner
      .query(
        `select j.id as job_id,d.id as draft_id,d.sha256 from public.partner_assistant_jobs j
    join public.partner_assistant_drafts d on d.id=j.draft_id where j.partner_id=$1`,
        [ids.get(co)],
      )
      .then((r) => r.rows[0]);
  const openEdit = (client, row, operation = randomUUID()) =>
    scalar(client, "select public.begin_partner_email_edit($1,$2::jsonb) value", [
      operation,
      JSON.stringify({
        schema_version: 1,
        job_id: row.job_id,
        expected_draft_id: row.draft_id,
        expected_sha256: row.sha256,
      }),
    ]);
  const saveEdit = (client, row, hold, operation = randomUUID()) =>
    scalar(client, "select public.save_partner_email_edit($1,$2::jsonb) value", [
      operation,
      JSON.stringify({
        schema_version: 1,
        hold_id: hold.holdId,
        expected_hold_version: hold.holdVersion,
        expected_draft_id: row.draft_id,
        expected_sha256: row.sha256,
        subject: "Oggetto modificato",
        body: "Testo sintetico approvato dalla persona.",
      }),
    ]);
  const cancelEdit = (client, row, hold) =>
    scalar(client, "select public.cancel_partner_email_edit($1,$2::jsonb) value", [
      randomUUID(),
      JSON.stringify({
        schema_version: 1,
        hold_id: hold.holdId,
        expected_hold_version: hold.holdVersion,
        expected_draft_id: row.draft_id,
      }),
    ]);
  const team = async (client, task) => {
    await beginTeam(client);
    try {
      const r = await task();
      await client.query("commit");
      return r;
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  };
  // 1. begin confermato prima di start: start aspetta la casella e poi non può partire.
  await readyFirst(7001);
  const g1 = await prepared(7001);
  const r1 = await draftFor(7001);
  await beginTeam(a);
  const h1 = await openEdit(a, r1);
  await beginService(b);
  const blockedStart = capture(start(b, g1.lease, g1.row));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq((await success(blockedStart)).status, "lease_persa");
  await b.query("commit");
  eq(await messageStatus(g1.row), "scartato");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.partner_email_edit_holds where closed_at is null",
    ),
    1,
  );
  await team(a, () => cancelEdit(a, r1, h1));
  await releaseSend();
  // 2. start confermato prima di begin: il testo è potenzialmente partito, il hold è rifiutato.
  await readyFirst(7002);
  const g2 = await prepared(7002);
  const r2 = await draftFor(7002);
  await beginService(a);
  eq((await start(a, g2.lease, g2.row)).status, "in_invio");
  await beginTeam(b);
  const lateEdit = capture(openEdit(b, r2));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  const denied = await lateEdit;
  eq(denied.error?.code, "55000");
  await b.query("rollback");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.partner_email_edit_holds where draft_id=$1",
      [r2.draft_id],
    ),
    0,
  );
  await asService(a, () => finishSent(a, g2.lease, g2.row));
  await releaseSend();
  await resetSendClock();
  // 3. prepare di un candidato letto prima del hold: aspetta e poi rifiuta senza messaggio.
  await readyFirst(7003);
  await onlyQueue(7003);
  const c3 = await asService(a, () => claim(a));
  const r3 = await draftFor(7003);
  await beginTeam(a);
  const h3 = await openEdit(a, r3);
  await beginService(b);
  const stalePrepare = capture(prepare(b, c3.lease_token, payloadOf(c3.candidate)));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq((await success(stalePrepare)).reason, "modifica_in_corso");
  await b.query("commit");
  // 4. Due salvataggi concorrenti: uno solo vince il CAS; una sola revisione aggiunta.
  const draftsBefore = await scalar(
    owner,
    "select count(*)::int value from public.partner_assistant_drafts where partner_id=$1",
    [ids.get(7003)],
  );
  await beginTeam(a);
  const saved = await saveEdit(a, r3, h3);
  await beginTeam(b);
  const duplicateSave = capture(saveEdit(b, r3, h3));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq((await duplicateSave).error?.code, "40001");
  await b.query("rollback");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_assistant_drafts where partner_id=$1",
      [ids.get(7003)],
    ),
    draftsBefore + 1,
  );
  eq(
    await scalar(owner, "select draft_id value from public.partner_assistant_jobs where id=$1", [
      r3.job_id,
    ]),
    saved.draftId,
  );
  await releaseSend();
  // 5. Il hold su A non ferma la presa di B, neppure con la lease del vecchio giro ancora attiva.
  const edited = await draftFor(7003);
  const h4 = await team(a, () => openEdit(a, edited));
  await readyFirst(7004);
  await onlyQueue(7003, 7004);
  const next = await asService(a, () => claim(a));
  eq(next.candidate?.co, 7004);
  await releaseSend();
  await team(a, () => cancelEdit(a, edited, h4));
  // 6. Cancellazione definitiva concorrente col salvataggio: non risuscita testo né hold.
  const h5 = await team(a, () => openEdit(a, edited));
  await owner.query("begin");
  await owner.query("select private.partner_assistant_erase($1)", [ids.get(7003)]);
  await beginTeam(b);
  const erasedSave = capture(saveEdit(b, edited, h5));
  await waitBlocked(pids.b, owner.processID);
  await owner.query("commit");
  eq((await erasedSave).error?.code, "40001");
  await b.query("rollback");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.partner_email_edit_holds where partner_id=$1",
      [ids.get(7003)],
    ),
    0,
  );
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_assistant_drafts where partner_id=$1",
      [ids.get(7003)],
    ),
    0,
  );
  const program = await team(a, () =>
    scalar(a, "select public.read_partner_email_program(date '2026-11-10',14) value"),
  );
  eq(program.counts, { total: 4, returned: 4, unpreparedTotal: 0, unpreparedReturned: 0 });
  eq(JSON.stringify(program).includes('"raw":'), false);
  console.log(
    `PASS ${checks} Programma email concurrent checks; PostgreSQL 17 reale, Auth/dati sintetici.`,
  );
} finally {
  // Un controllo fallito non deve lasciare transazioni aperte che bloccano la pulizia.
  for (const client of clients)
    try {
      await client.query("rollback");
    } catch {}
  for (const client of clients.reverse())
    try {
      await client.end();
    } catch {}
  try {
    if (started) command("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
