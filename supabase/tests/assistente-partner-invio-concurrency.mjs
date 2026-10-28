// test-db: postgres minimo 1
// Assistente Partner, consegna 2a, compito 2: le RPC d'invio su PostgreSQL 17 reale (lock,
// transazioni e permessi veri). Due giri d'invio insieme: uno solo prende la casella; due prepare
// dello stesso lavoro: un solo messaggio vivo. Tra prepare e SMTP un «Non contattare», un «Ferma
// l'assistente» o regole nuove ancora da confermare fanno aspettare start, che poi non parte (Fuoco
// 3). finish e «Segna inviato» sulla stessa scheda, e il giro d'invio con quello di Claude, non vanno
// in deadlock. L'ora dell'assistente è fissata in ogni client (martedì 10 novembre 2026, 10:00 a
// Roma), mai quella della CI. Cluster usa e getta in /private/tmp su socket privata, Auth e dati solo
// sintetici, nessun DSN o accesso cloud.
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

  // Un contatto con la bozza pronta, come lo lascia la consegna 1 (Europe/Rome, Italia).
  const ids = new Map();
  async function readyFirst(co, { researchDaysAgo = 1 } = {}) {
    const id = randomUUID();
    ids.set(co, id);
    await owner.query(
      `insert into public.partners(id, co, name, origin, stage, created_by, sections, priority, contact_month, country)
       values ($1, $2, $3, 'team', 'da_contattare', $4, array['collab'], 'media', date '2026-11-01', 'Italia')`,
      [id, co, `Club Sintetico ${co}`, founder],
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
          timezone: "Europe/Rome",
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
       values ($1, $2, 1, 'it', $3, $4, $5, $6, 1, $7, gen_random_uuid(), $8,
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
    await client.query("set local role authenticated");
  }
  const teamCommand = (client, name, payload) =>
    scalar(client, `select public.${name}($1, $2::jsonb) value`, [
      randomUUID(),
      JSON.stringify({ schema_version: 1, ...payload }),
    ]);

  // 1. Due giri d'invio insieme: il primo tiene la casella, il secondo aspetta davvero e poi trova
  // la lease attiva. Una sola lease.
  await readyFirst(951);
  await onlyQueue(951);
  await beginService(a);
  const first = await claim(a);
  eq([first.status, first.candidate?.co], ["claimed", 951]);
  await beginService(b);
  const second = capture(claim(b));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq(await success(second), { status: "idle", reason: "occupato" });
  await b.query("commit");
  eq(
    await scalar(owner, "select lease_token::text value from private.partner_assistant_mail_state"),
    first.lease_token,
    "Una sola lease: quella del primo giro",
  );
  for (let round = 0; round < 3; round++) {
    await release(
      await scalar(
        owner,
        "select lease_token::text value from private.partner_assistant_mail_state",
      ),
    );
    const results = await Promise.all([asService(a, () => claim(a)), asService(b, () => claim(b))]);
    eq(
      results.map((r) => (r.status === "claimed" ? "claimed" : r.reason)).sort(),
      ["claimed", "occupato"],
      `Giro ${round + 1}: una sola casella`,
    );
  }
  const lease951 = await scalar(
    owner,
    "select lease_token::text value from private.partner_assistant_mail_state",
  );

  // 2. Due prepare dello stesso lavoro con due Message-ID (stessa lease): uno pronto, l'altro
  // doppione. Un solo messaggio vivo.
  await beginService(a);
  const p1 = await prepare(a, lease951, payloadOf(first.candidate));
  eq(p1.status, "pronto");
  await beginService(b);
  const p2 = capture(prepare(b, lease951, payloadOf(first.candidate)));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq(await success(p2), { status: "rifiutato", reason: "doppione" });
  await b.query("commit");
  eq(
    await scalar(
      owner,
      `select count(*)::int value from public.partner_assistant_messages
        where partner_id = $1 and send_status in ('pronto', 'in_invio', 'inviato', 'incerto')`,
      [ids.get(951)],
    ),
    1,
    "Un solo messaggio vivo",
  );

  // 3. «Non contattare» del team aperto sulla scheda: start aspetta il contatto, poi non parte.
  await beginTeam(a);
  await teamCommand(a, "set_partner_do_not_contact", {
    partner_id: ids.get(951),
    active: true,
    reason: "Motivo sintetico",
  });
  await beginService(b);
  const stopped = capture(start(b, lease951, p1.message_row_id));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq(await success(stopped), { status: "stop", reason: "non_idoneo" });
  await b.query("commit");
  eq(await messageStatus(p1.message_row_id), "scartato", "Fuoco 3: niente parte");
  await release(lease951);

  // 4. «Ferma l'assistente» aperto: start aspetta la configurazione, poi non parte.
  await readyFirst(952);
  const g952 = await prepared(952);
  const version = await scalar(
    owner,
    "select version::int value from private.partner_assistant_config",
  );
  await beginTeam(a);
  await teamCommand(a, "set_partner_assistant_mode", { mode: "spento", expected_version: version });
  await beginService(b);
  const off = capture(start(b, g952.lease, g952.row));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq(await success(off), { status: "stop", reason: "modalita_cambiata" });
  await b.query("commit");
  eq(await messageStatus(g952.row), "scartato");
  eq(await inFlight(), 0);
  await owner.query("update private.partner_assistant_config set mode = 'invio'");
  await release(g952.lease);

  // 5. finish(inviato) e «Segna inviato» del team sulla stessa scheda, nei due ordini: nessun
  // deadlock, entrambi finiscono, una riga «inviato» per transazione.
  async function startedSend(co) {
    await resetSendClock();
    await readyFirst(co);
    const g = await prepared(co);
    eq((await asService(a, () => start(a, g.lease, g.row))).status, "in_invio");
    return g;
  }
  const sentRows = (co) =>
    owner.query(
      `select operation_id, count(*)::int as n from public.partner_activities
        where partner_id = $1 and kind = 'inviato' group by operation_id`,
      [ids.get(co)],
    );
  for (const [co, workerFirst] of [
    [953, true],
    [954, false],
  ]) {
    const g = await startedSend(co);
    const [worker, team] = workerFirst ? [a, b] : [b, a];
    const [workerPid, teamPid] = workerFirst ? [pids.a, pids.b] : [pids.b, pids.a];
    let finished, recorded;
    if (workerFirst) {
      await beginService(worker);
      finished = { value: await finishSent(worker, g.lease, g.row) };
      await beginTeam(team);
      recorded = capture(
        teamCommand(team, "record_partner_activity", { partner_id: ids.get(co), kind: "inviato" }),
      );
      await waitBlocked(teamPid, workerPid);
      await worker.query("commit");
      recorded = await recorded;
      await team.query(recorded.error ? "rollback" : "commit");
    } else {
      await beginTeam(team);
      recorded = {
        value: await teamCommand(team, "record_partner_activity", {
          partner_id: ids.get(co),
          kind: "inviato",
        }),
      };
      await beginService(worker);
      finished = capture(finishSent(worker, g.lease, g.row));
      await waitBlocked(workerPid, teamPid);
      await team.query("commit");
      finished = await finished;
      await worker.query(finished.error ? "rollback" : "commit");
    }
    eq(
      [finished.error?.code ?? null, recorded.error?.code ?? null],
      [null, null],
      `CO ${co}: nessun 40P01, nessun errore`,
    );
    eq(finished.value.send_status, "inviato");
    eq(recorded.value.stage, "contattato");
    const rows = (await sentRows(co)).rows;
    eq(
      [rows.length, rows.every((r) => r.n === 1)],
      [2, true],
      `CO ${co}: una riga «inviato» per transazione`,
    );
    await release(g.lease);
  }

  // 6. Il giro d'invio e quello di Claude insieme, con lavori scaduti e una pulizia da fare (ricerca
  // vecchia): nessun 40P01, entrambi finiscono, nei due ordini e lanciati insieme.
  await resetSendClock();
  const claimStep = (client) =>
    scalar(client, "select public.claim_partner_assistant_step($1, 360) value", [WORKER]);
  async function setupRace(round) {
    await readyFirst(960 + round, { researchDaysAgo: 22 });
    await readyFirst(970 + round);
    await onlyQueue(960 + round, 970 + round);
    await owner.query(
      `update public.partner_assistant_jobs set lease_token = null, lease_expires_at = null
        where lease_token is not null`,
    );
    const stale = await readyFirst(980 + round);
    await owner.query(
      `update public.partner_assistant_jobs set status = 'in_coda', step = 'ricerca', lease_token = gen_random_uuid(),
         lease_expires_at = now() - interval '1 second' where partner_id = $1`,
      [stale],
    );
  }
  const releaseSend = async () => {
    const lease = await scalar(
      owner,
      "select lease_token::text value from private.partner_assistant_mail_state",
    );
    if (lease) await release(lease);
  };
  for (const [round, order] of [
    [0, "invio prima"],
    [1, "Claude prima"],
  ]) {
    await setupRace(round);
    const [sendClient, stepClient] = order === "invio prima" ? [a, b] : [b, a];
    const [sendPid, stepPid] = order === "invio prima" ? [pids.a, pids.b] : [pids.b, pids.a];
    let sent, stepped;
    if (order === "invio prima") {
      await beginService(sendClient);
      sent = { value: await claim(sendClient) };
      await beginService(stepClient);
      stepped = capture(claimStep(stepClient));
      await waitBlocked(stepPid, sendPid);
      await sendClient.query("commit");
      stepped = await stepped;
      await stepClient.query(stepped.error ? "rollback" : "commit");
    } else {
      await beginService(stepClient);
      stepped = { value: await claimStep(stepClient) };
      await beginService(sendClient);
      sent = capture(claim(sendClient));
      await waitBlocked(sendPid, stepPid);
      await stepClient.query("commit");
      sent = await sent;
      await sendClient.query(sent.error ? "rollback" : "commit");
    }
    eq(
      [sent.error?.code ?? null, stepped.error?.code ?? null],
      [null, null],
      `${order}: nessun 40P01`,
    );
    eq(sent.value.candidate?.co, 970 + round, `${order}: il candidato dopo la pulizia`);
    eq(stepped.value.status, "claimed", `${order}: il giro di Claude prende un lavoro`);
    eq(
      await scalar(
        owner,
        "select step value from public.partner_assistant_jobs where partner_id = $1",
        [ids.get(960 + round)],
      ),
      "ricerca",
      `${order}: ricerca scaduta pulita`,
    );
    await releaseSend();
  }
  for (let round = 2; round < 5; round++) {
    await setupRace(round);
    const results = await Promise.all([
      capture(asService(a, () => claim(a))),
      capture(asService(b, () => claimStep(b))),
    ]);
    eq(
      results.map((r) => r.error?.code ?? null),
      [null, null],
      `Lanciati insieme ${round - 1}: nessun 40P01`,
    );
    await releaseSend();
  }

  // 7. Regole nuove salvate dopo un prepare riuscito e non ancora confermate: start aspetta il
  // lavoro, poi trova la bozza cambiata e non parte.
  await resetSendClock();
  await readyFirst(990);
  const g990 = await prepared(990);
  const rules = await scalar(
    owner,
    "select max(version)::int value from public.partner_assistant_rules",
  );
  await beginTeam(a);
  eq(
    (
      await teamCommand(a, "save_partner_assistant_rules", {
        body: "Regole v2",
        expected_version: rules,
      })
    ).replayed,
    false,
  );
  await beginService(b);
  const changed = capture(start(b, g990.lease, g990.row));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq(await success(changed), { status: "stop", reason: "bozza_cambiata" });
  await b.query("commit");
  eq(await messageStatus(g990.row), "scartato");
  eq(await inFlight(), 0, "Nessun messaggio in invio");
  console.log(
    `PASS ${checks} Assistente Partner invio concurrent checks; PostgreSQL 17 reale, pids ${pids.a}/${pids.b}, Auth/dati sintetici.`,
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
