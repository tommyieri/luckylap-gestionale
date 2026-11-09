// test-db: postgres minimo 254
// Piano persistente: concorrenza reale, slot scaduti, monitoraggio, fusi e quote Roma.
// Cluster PostgreSQL 17 temporaneo, Auth simulata e soli dati sintetici; nessuna rete o SMTP.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const [bin, modulePath] = process.argv.slice(2);
if (!bin?.startsWith("/") || !modulePath?.startsWith("/"))
  throw Error("Servono percorsi assoluti di PostgreSQL 17 e pg.");
const imported = await import(pathToFileURL(modulePath).href);
const Client = imported.Client ?? imported.default.Client;
const command = (name, args) => {
  const result = spawnSync(join(bin, name), args, {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.status !== 0) throw Error(`${name}: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
};
assert.match(command("postgres", ["--version"]), /PostgreSQL\) 17\./);
const directory = mkdtempSync("/private/tmp/luckylap-partner-email-slots-");
const data = join(directory, "data"),
  socket = join(directory, "socket");
mkdirSync(socket, { mode: 0o700 });
const clients = [];
let started = false,
  checks = 0,
  owner,
  a,
  b,
  observer;
const eq = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const ok = (actual, label) => {
  assert.ok(actual, label);
  checks++;
};
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const scalar = async (client, sql, args = []) => (await client.query(sql, args)).rows[0]?.value;
const FOUNDER = randomUUID(),
  ASSISTANT = randomUUID(),
  WORKER = randomUUID();
const DAY = "2026-11-10",
  BEFORE = `${DAY}T07:00:00Z`;
const BODY =
  "Buongiorno,\nRiprendo la proposta della prima email per condividere un aggiornamento verificato sul vostro programma. La nuova attività offre un'occasione concreta per una piccola collezione dedicata, utile a dare continuità al rapporto con i soci e a lasciare un ricordo curato dell'incontro. Vi interessa approfondire questa possibilità?\nUn saluto,";
const SIGNATURE = "Nome Sintetico\nRuolo sintetico\n+39 000 000 0000\nhttps://brand.example.test";
const OPT_OUT = "Se preferite non ricevere altre email, scrivetemelo e non vi ricontattero.";
const capture = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
async function success(promise) {
  const r = await promise;
  if (r.error) throw r.error;
  return r.value;
}
async function connect() {
  const client = new Client({
    host: socket,
    port: 5432,
    user: "postgres",
    database: "postgres",
    ssl: false,
    statement_timeout: 15_000,
  });
  await client.connect();
  clients.push(client);
  return client;
}
async function begin(client, at = BEFORE, role = "service_role") {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify(role === "authenticated" ? { role, sub: FOUNDER } : { role }),
  ]);
  await client.query(
    "select set_config('luckylap.partner_assistant.now',$1,true),set_config('luckylap.partner_followup.proof_now',$1,true)",
    [at],
  );
  await client.query(`set local role ${role}`);
}
async function as(client, fn, at = BEFORE, role = "service_role") {
  await begin(client, at, role);
  try {
    const result = await fn();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
const rpc = (client, name, args) =>
  scalar(client, `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`, args);
const firstClaim = (client) => rpc(client, "claim_partner_assistant_send", [WORKER, 300, 0]);
const followupClaim = (client) => rpc(client, "claim_partner_followup", [WORKER, 300]);
const release = (lease, at) =>
  as(
    a,
    () =>
      rpc(a, "release_partner_assistant_send", [
        lease,
        JSON.stringify({
          schema_version: 1,
          outcome: "test_completato",
          smtp_login: null,
          imap_login: null,
        }),
      ]),
    at,
  );
function firstPayload(c) {
  const text = `${c.draft.body}\n\n${c.draft.signature}\n\n${OPT_OUT}`,
    messageId = `<${randomUUID()}@brand.example.test>`;
  const raw = `From: mittente@brand.example.test\r\nTo: ${c.address}\r\nSubject: ${c.draft.subject}\r\nMessage-ID: ${messageId}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(
    text,
  )
    .toString("base64")
    .replace(/.{1,76}/gu, "$&\r\n")}`;
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
const prepareFirst = (client, c) =>
  rpc(client, "prepare_partner_assistant_send", [
    c.lease_token,
    randomUUID(),
    JSON.stringify(firstPayload(c.candidate)),
  ]);
const startFirst = (client, c, m) =>
  rpc(client, "start_partner_assistant_send", [c.lease_token, m.message_row_id]);
const finishFirst = (client, c, m) =>
  rpc(client, "finish_partner_assistant_send", [
    c.lease_token,
    randomUUID(),
    JSON.stringify({
      schema_version: 1,
      message_row_id: m.message_row_id,
      outcome: "inviato",
      smtp_code: 250,
      enhanced_code: null,
      spam: false,
      reason: null,
    }),
  ]);
const recordClear = (c, at) =>
  as(
    a,
    () =>
      rpc(a, "record_partner_followup_check", [
        c.lease_token,
        c.candidate.id,
        c.candidate.version,
        JSON.stringify({
          result: "clear",
          reason: null,
          checked_at: at,
          proof_sha256: sha(at),
          folder_count: 3,
          message_count: 0,
        }),
      ]),
    at,
  );
function followupPayload(c, proof) {
  const d = c.candidate.draft,
    text = `${d.body}\n\n${d.signature}\n\n${OPT_OUT}`,
    messageId = `<${randomUUID()}@brand.example.test>`,
    first = c.candidate.message_ids[0];
  const raw = `From: mittente@brand.example.test\r\nTo: ${c.candidate.address}\r\nSubject: ${d.subject}\r\nMessage-ID: ${messageId}\r\nIn-Reply-To: ${first}\r\nReferences: ${first}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(
    text,
  )
    .toString("base64")
    .replace(/.{1,76}/gu, "$&\r\n")}`;
  return {
    expected_version: c.candidate.version,
    draft_id: d.draft_id,
    number: d.number,
    to_address: c.candidate.address,
    subject: d.subject,
    text,
    opt_out: OPT_OUT,
    raw,
    message_id: messageId,
    proof_id: proof.proof_id,
  };
}
const prepareFollowup = (client, c, proof) =>
  rpc(client, "prepare_partner_followup_send", [
    randomUUID(),
    c.lease_token,
    c.candidate.id,
    JSON.stringify(followupPayload(c, proof)),
  ]);
const startFollowup = (client, c, m, proof) =>
  rpc(client, "start_partner_followup_send", [c.lease_token, m.message_row_id, proof.proof_id]);
async function waitBlocked(waitingPid, blockingPid) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const row = (
      await observer.query(
        "select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1",
        [waitingPid],
      )
    ).rows[0];
    if (row?.wait_event_type === "Lock" && row.blockers.includes(blockingPid)) {
      checks++;
      return;
    }
    await new Promise((done) => setTimeout(done, 20));
  }
  throw Error("Attesa su lock PostgreSQL non osservata.");
}
const plan = (at) =>
  as(
    owner,
    () => scalar(owner, "select private.refresh_partner_send_plan() value"),
    at,
    "postgres",
  );
const slots = () =>
  owner
    .query(
      `select s.*,s.planned_at::text planned_text,s.expires_at::text expires_text,
  s.local_day::text local_day_text,s.quota_day::text quota_day_text,
  (s.planned_at at time zone s.timezone)::date::text actual_local_day,
  (s.planned_at at time zone 'Europe/Rome')::date::text actual_quota_day,
  (s.planned_at at time zone s.timezone)::time::text local_time
  from private.partner_send_slots s where status='scheduled' order by planned_at,partner_id`,
    )
    .then((r) => r.rows);
async function reset() {
  // Solo questo cluster usa e getta: nessun DSN viene mai accettato dal programma.
  await owner.query(
    "truncate public.partners cascade; truncate private.partner_send_windows cascade",
  );
  await owner.query(
    "update private.partner_assistant_mail_state set lease_token=null,lease_expires_at=null,candidate_draft_id=null,stop_reason=null,day_stopped_on=null,backoff_until=null,next_send_after=null where singleton",
  );
}
async function ready(
  co,
  { club = false, tz = "Europe/Rome", country = "Italia", at = BEFORE, sent = false } = {},
) {
  const id = randomUUID(),
    stamp = new Date(Date.parse(at) - 60 * 60 * 1000).toISOString();
  await owner.query(
    `insert into public.partners(id,co,name,origin,stage,created_by,sections,priority,contact_month,country)
    values($1,$2,$3,'team',$4,$5,$6::text[],'media',date '2026-11-01',$7)`,
    [
      id,
      co,
      `Partner Sintetico ${co}`,
      sent ? "contattato" : "da_contattare",
      FOUNDER,
      club ? ["club"] : ["collab"],
      country,
    ],
  );
  const contact = await scalar(
    owner,
    `insert into public.partner_contacts(partner_id,kind,value,link_value,verified,created_by,updated_by)
    values($1,'email',$2,$2,true,$3,$3) returning id value`,
    [id, `info@partner-${co}.example.test`, FOUNDER],
  );
  const research = await scalar(
    owner,
    `insert into public.partner_assistant_notes(partner_id,kind,content,sources,rules_version,model,operation_id,created_by,created_at)
    values($1,'ricerca',$2::jsonb,'{}',3,$3,gen_random_uuid(),$4,$5) returning id value`,
    [
      id,
      JSON.stringify(
        club
          ? { text: "Nessuna ricerca: bozza dal testo fisso per i club.", template: true }
          : { text: "Ricerca sintetica verificata." },
      ),
      club ? null : "claude-opus-5-5",
      ASSISTANT,
      stamp,
    ],
  );
  const choice = await scalar(
    owner,
    `insert into public.partner_assistant_notes(partner_id,kind,content,rules_version,model,operation_id,created_by,created_at)
    values($1,'scelta',$2::jsonb,3,null,gen_random_uuid(),$3,$4) returning id value`,
    [
      id,
      JSON.stringify({
        contact_kind: club ? "club" : "brand",
        language: "it",
        register: "voi",
        timezone: tz,
        event_starts_on: "",
        request: club ? "merch_cobranding" : "collab_capsule",
        decision: { kind: "scrivi" },
      }),
      ASSISTANT,
      stamp,
    ],
  );
  const subject = `Partner Sintetico ${co} e LuckyLap`,
    digest = sha(`${subject}\n\n${BODY}\n\n${SIGNATURE}`);
  const draft = await scalar(
    owner,
    `insert into public.partner_assistant_drafts(partner_id,contact_id,partner_version,language,subject,body,signature,sha256,rules_version,research_note_id,choice_note_id,operation_id,created_by,created_at)
    select $1,$2,p.version,'it',$3,$4,$5,$6,(select max(version) from public.partner_assistant_rules),$7,$8,gen_random_uuid(),$9,$10
    from public.partners p where p.id=$1 returning id value`,
    [id, contact, subject, BODY, SIGNATURE, digest, research, choice, ASSISTANT, stamp],
  );
  await owner.query(
    `insert into public.partner_assistant_notes(partner_id,kind,content,rules_version,model,operation_id,created_by,created_at)
    values($1,'controllo',jsonb_build_object('approved',true,'problems','[]'::jsonb,'sha256',$2::text),3,'claude-opus-5-5',gen_random_uuid(),$3,$4)`,
    [id, digest, ASSISTANT, stamp],
  );
  await owner.query(
    `insert into public.partner_assistant_jobs(partner_id,status,step,research_note_id,choice_note_id,draft_id)
    values($1,$2,'controllo',$3,$4,$5)`,
    [id, sent ? "inviata" : "pronta", research, choice, draft],
  );
  if (sent) {
    const firstAt = new Date(Date.parse(at) - 8 * 86400000).toISOString(),
      raw = `Subject: ${subject}\r\n\r\nTesto sintetico.`;
    await owner.query(
      `insert into public.partner_assistant_messages(partner_id,draft_id,kind,mode,send_status,message_id,to_address,subject,body,raw,sha256,rules_version,lease_token,send_day,sent_at,appended_at,operation_id,created_by,created_at)
      values($1,$2,'primo','invio','inviato',$3,$4,$5,$6,$7,$8,3,gen_random_uuid(),($9::timestamptz at time zone 'Europe/Rome')::date,$9,$9,gen_random_uuid(),$10,$9)`,
      [
        id,
        draft,
        `<${randomUUID()}@brand.example.test>`,
        `info@partner-${co}.example.test`,
        subject,
        BODY,
        raw,
        sha(raw),
        firstAt,
        ASSISTANT,
      ],
    );
  }
  return { id, draft, contact, subject };
}
async function followup(co, options = {}) {
  const fixture = await ready(co, { club: true, ...options, sent: true });
  const at = options.at ?? BEFORE;
  await as(owner, () => owner.query("select private.refresh_partner_followups()"), at, "postgres");
  const f = await scalar(
    owner,
    "select to_jsonb(f) value from public.partner_assistant_followups f where partner_id=$1",
    [fixture.id],
  );
  ok(f, "Conversazione generata dal primo invio");
  const versions = (
    await owner.query(
      `select p.version partner_version,k.version contact_version,(select max(version) from public.partner_assistant_rules) rules_version
    from public.partners p join public.partner_contacts k on k.partner_id=p.id where p.id=$1`,
      [fixture.id],
    )
  ).rows[0];
  const payload = {
    schema_version: 1,
    conversation_id: f.id,
    expected_version: Number(f.version),
    number: 1,
    partner_version: Number(versions.partner_version),
    contact_version: Number(versions.contact_version),
    address_sha256: f.address_sha256,
    rules_version: versions.rules_version,
    language: "it",
    subject: `Re: ${fixture.subject}`,
    body: BODY,
    signature: SIGNATURE,
    research_text: "Fatto nuovo verificato presso una fonte sintetica ufficiale.",
    sources: ["https://club.example.test/novita"],
  };
  const saved = await as(
    a,
    () => rpc(a, "save_partner_followup_draft", [randomUUID(), JSON.stringify(payload)]),
    at,
    "authenticated",
  );
  eq(saved.number, 1, "Approvazione founder tramite RPC ordinaria");
  return { ...fixture, conversation: f.id };
}
async function bootstrap() {
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
  await owner.query(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid $$;
    grant usage on schema auth to anon,authenticated,service_role;
    create schema storage; create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security; grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
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
    "_assistente_partner_club_generici.sql",
    "_assistente_partner_prova_allegati.sql",
    "_partner_programma_email.sql",
    "_partner_email_config_versions.sql",
    "_partner_email_config_seed.sql",
    "_partner_email_config_draft.sql",
    "_partner_email_config_context.sql",
    "_partner_email_format_track.sql",
    "_partner_lookbooks_aggiornati.sql",
    "_partner_quote_rigide.sql",
    "_partner_solleciti_automatici.sql",
    "_partner_calendario_2027.sql",
    "_partner_invii_distribuiti.sql",
    "_partner_piano_prestazioni.sql",
  ]) {
    const found = names.filter((name) => name.endsWith(suffix));
    eq(found.length, 1, `Una migrazione ${suffix}`);
    await owner.query(readFileSync(new URL(found[0], migrations), "utf8"));
  }
  for (const [id, name] of [
    [FOUNDER, "Fondatore sintetico"],
    [ASSISTANT, "Assistente sintetico"],
  ]) {
    await owner.query("insert into auth.users values($1)", [id]);
    await owner.query("insert into public.profiles(user_id,display_name) values($1,$2)", [
      id,
      name,
    ]);
  }
  await owner.query(
    "insert into public.memberships(user_id,role,active) values($1,'founder',true)",
    [FOUNDER],
  );
  eq(await as(a, () => rpc(a, "configure_partner_assistant", [ASSISTANT, FOUNDER])), {
    configured: true,
  });
  await owner.query(
    "update private.partner_assistant_config set mode='invio',daily_first_limit=6,test_confirmed_at=now(),test_confirmed_by=$1",
    [FOUNDER],
  );
  eq(
    (
      await as(
        a,
        () =>
          rpc(a, "set_partner_followup_mode", [
            randomUUID(),
            JSON.stringify({ schema_version: 1, expected_version: 1, mode: "invio" }),
          ]),
        BEFORE,
        "authenticated",
      )
    ).mode,
    "invio",
  );
}

try {
  await bootstrap();
  const pids = {
    a: await scalar(a, "select pg_backend_pid() value"),
    b: await scalar(b, "select pg_backend_pid() value"),
  };
  ok(pids.a !== pids.b, "Connessioni reali distinte");

  // Dodici candidati effettivi, senza inventare dodici posti quando la coda è più corta.
  for (let i = 0; i < 3; i++)
    await ready(8100 + i, { club: true, tz: i === 1 ? "Europe/Paris" : "Europe/Rome" });
  for (let i = 0; i < 3; i++) await ready(8200 + i);
  for (let i = 0; i < 6; i++) await followup(8300 + i);
  await plan(BEFORE);
  const twelve = await slots();
  eq(twelve.length, 12, "Tre Club, tre altri e sei solleciti pronti");
  eq(
    new Set(twelve.map((s) => s.window_id)).size,
    1,
    "Roma e Parigi condividono la stessa finestra UTC e giorno locale",
  );
  eq(twelve.filter((s) => s.kind === "primo").length, 6);
  eq(twelve.filter((s) => s.kind === "sollecito").length, 6);
  eq(
    twelve.filter((s) => s.kind === "primo" && s.flow_template).length,
    3,
    "Tre prime Club riservate",
  );
  eq(
    twelve.filter((s) => s.kind === "primo" && !s.flow_template).length,
    3,
    "Tre prime altri senza prestito di quota",
  );
  eq(
    await scalar(owner, "select private.partner_assistant_first_sent($1::date) value", [DAY]),
    0,
    "Le prenotazioni non sono falsi invii",
  );
  eq(await scalar(owner, "select private.partner_followup_sent($1::date) value", [DAY]), 0);
  const times = twelve.map((s) => Date.parse(s.planned_at));
  eq(times[0], Date.parse(`${DAY}T08:00:00Z`), "Prima posizione alle09 locali");
  eq(times.at(-1), Date.parse(`${DAY}T14:55:00Z`), "Ultimo target alle15:55 locali");
  for (let i = 1; i < times.length; i++)
    ok(
      Math.abs(times[i] - times[0] - ((times.at(-1) - times[0]) * i) / 11) <= 1000,
      "Griglia equidistante con arrotondamento massimo1s",
    );
  for (const s of twelve) {
    eq(s.local_day_text, s.actual_local_day, "Giorno locale conservato");
    eq(s.quota_day_text, s.actual_quota_day, "Quota del giorno Roma dell'istante");
    ok(Date.parse(s.expires_at) - Date.parse(s.planned_at) <= 300000, "Tolleranza massima5min");
  }
  // Pianificazioni sovrapposte si serializzano sullo stesso lock della casella.
  await begin(a, BEFORE, "postgres");
  await a.query("select private.refresh_partner_send_plan()");
  await begin(b, BEFORE, "postgres");
  const secondPlanner = capture(b.query("select private.refresh_partner_send_plan()"));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  await success(secondPlanner);
  await b.query("commit");
  eq(
    (await slots()).map((s) => [s.id, s.planned_text]),
    twelve.map((s) => [s.id, s.planned_text]),
    "Replay non duplica né sposta gli slot",
  );
  eq(
    await scalar(owner, "select lease_token value from private.partner_assistant_mail_state"),
    null,
    "Pianificare non prenota una lease SMTP",
  );
  const publicPlan = await as(
    a,
    () => rpc(a, "read_partner_send_plan", [DAY]),
    BEFORE,
    "authenticated",
  );
  eq(publicPlan.day, DAY, "RPC membro legge il giorno di quota Roma richiesto");
  eq(publicPlan.slots.length, 12);
  for (const row of publicPlan.slots)
    eq(
      Object.keys(row).sort(),
      [
        "id",
        "kind",
        "partner_id",
        "co",
        "name",
        "timezone",
        "local_day",
        "planned_at",
        "expires_at",
        "status",
        "reason",
      ].sort(),
      "DTO pubblico privo di snapshot, recapiti, token e MIME",
    );

  await reset();
  for (let i = 0; i < 3; i++) await ready(8350 + i, { club: true });
  for (let i = 0; i < 3; i++) await ready(8360 + i);
  for (let i = 0; i < 5; i++) await followup(8370 + i);
  await plan(BEFORE);
  const eleven = await slots(),
    elevenTimes = eleven.map((s) => Date.parse(s.planned_at));
  eq(eleven.length, 11, "Con undici candidati nessun dodicesimo posto fisso");
  for (let i = 1; i < elevenTimes.length; i++)
    ok(
      Math.abs(
        elevenTimes[i] - elevenTimes[0] - ((elevenTimes.at(-1) - elevenTimes[0]) * i) / 10,
      ) <= 1000,
      "Griglia N11 regolare",
    );

  // La griglia dipende dal numero effettivo, anche quando il piano nasce a giornata iniziata.
  await reset();
  await ready(8400);
  await plan(BEFORE);
  const one = await slots();
  eq(one.length, 1, "Una sola bozza non prenota dodici posizioni");
  eq(Date.parse(one[0].planned_at), Date.parse(`${DAY}T11:27:30Z`), "N1 al centro09–15:55");
  eq(
    (await as(a, () => firstClaim(a), BEFORE)).status,
    "idle",
    "La pianificazione futura non prenota la casella",
  );
  eq(
    await scalar(owner, "select lease_token value from private.partner_assistant_mail_state"),
    null,
  );
  const late = `${DAY}T10:00:00Z`;
  await reset();
  await ready(8401, { at: late });
  await ready(8402, { at: late });
  await plan(late);
  const two = await slots();
  eq(two.length, 2, "Due candidati effettivi");
  eq(
    Date.parse(two[0].planned_at),
    Date.parse(late) + 120000,
    "Piano tardivo: primo slot non prima di adesso+2min",
  );
  eq(Date.parse(two[1].planned_at), Date.parse(`${DAY}T14:55:00Z`));
  ok(
    two.every((s) => Date.parse(s.planned_at) > Date.parse(late)),
    "Nessuno slot retroattivo",
  );

  // Il controllo periodico già eseguito non deve nascondere un invio il cui slot è arrivato.
  await reset();
  const dueFollowup = await followup(8500);
  await plan(BEFORE);
  const fuSlot = (await slots())[0],
    due = new Date(fuSlot.planned_at).toISOString();
  await owner.query(
    "update public.partner_assistant_followups set next_check_at=$2::timestamptz+interval '30 minutes' where id=$1",
    [dueFollowup.conversation, due],
  );
  const dueClaim = await as(a, () => followupClaim(a), due);
  eq(dueClaim.status, "claimed", "Slot dovuto anche con prossimo monitoraggio futuro");
  eq(dueClaim.candidate.id, dueFollowup.conversation);
  eq(dueClaim.candidate.send_allowed, true);
  const incomplete = await as(
    a,
    () =>
      rpc(a, "record_partner_followup_check", [
        dueClaim.lease_token,
        dueClaim.candidate.id,
        dueClaim.candidate.version,
        JSON.stringify({
          result: "uncertain",
          reason: "followup_scan_incomplete",
          checked_at: due,
          proof_sha256: sha(`${dueClaim.candidate.id}:uncertain:${due}`),
          folder_count: 0,
          message_count: 0,
        }),
      ]),
    due,
  );
  eq(incomplete.status, "retry", "Il piano non trasforma una lettura incompleta in autorizzazione");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.partner_followup_proofs where used_at is null",
    ),
    0,
    "Nessuna proof utilizzabile inventata dal piano",
  );
  await release(dueClaim.lease_token, due);

  // Un primo nel futuro non riserva la casella a danno di un FU già dovuto in un altro fuso.
  await reset();
  const early = `${DAY}T00:00:00Z`;
  const tokyo = await followup(8550, { tz: "Asia/Tokyo", country: "Narnia", at: early });
  await ready(8551, { at: early });
  await plan(early);
  const separate = await slots(),
    tokyoSlot = separate.find((s) => s.partner_id === tokyo.id),
    futureFirst = separate.find((s) => s.kind === "primo");
  ok(
    Date.parse(tokyoSlot.planned_at) < Date.parse(futureFirst.planned_at),
    "FU locale dovuto prima del primo in Roma",
  );
  const tokyoDue = new Date(tokyoSlot.planned_at).toISOString();
  const notYet = await as(a, () => firstClaim(a), tokyoDue);
  eq(notYet.status, "idle", "Il primo futuro lascia il worker procedere ai solleciti");
  eq(
    await scalar(owner, "select lease_token value from private.partner_assistant_mail_state"),
    null,
  );
  await begin(a, tokyoDue);
  const tokyoClaim = await followupClaim(a);
  eq(tokyoClaim.status, "claimed");
  eq(tokyoClaim.candidate.id, tokyo.conversation);
  eq(tokyoClaim.candidate.send_allowed, true);
  await begin(b, tokyoDue);
  const parallelFirst = capture(firstClaim(b));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq((await success(parallelFirst)).reason, "occupato", "Unica lease condivisa tra primo e FU");
  await b.query("commit");
  eq(
    await scalar(owner, "select lease_token value from private.partner_assistant_mail_state"),
    tokyoClaim.lease_token,
  );
  await release(tokyoClaim.lease_token, tokyoDue);

  // Superare la tolleranza cancella lo slot: nessuna compressione degli altri in un recupero a raffica.
  await reset();
  await ready(8560);
  await ready(8561);
  await plan(BEFORE);
  const beforeMiss = await slots(),
    missed = beforeMiss[0],
    kept = beforeMiss[1];
  const tooLate = new Date(Date.parse(missed.expires_at) + 1000).toISOString();
  eq(
    (await as(a, () => firstClaim(a), tooLate)).status,
    "idle",
    "Slot oltre tolleranza non recuperato immediatamente",
  );
  const missedStatus = await scalar(
    owner,
    "select status value from private.partner_send_slots where id=$1",
    [missed.id],
  );
  ok(["expired", "skipped"].includes(missedStatus), "Slot mancato reso non eseguibile");
  const remaining = await slots();
  const same = remaining.find((s) => s.id === kept.id);
  ok(same, "Lo slot successivo resta prenotato");
  eq(same.planned_text, kept.planned_text, "Nessun riavvicinamento dello slot successivo");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_assistant_messages where send_status='in_invio'",
    ),
    0,
  );

  // Una risposta confermata dopo il piano prevale sullo slot e sulle due proof del controllo.
  await reset();
  const replying = await followup(8570);
  await plan(BEFORE);
  const replySlot = (await slots())[0],
    replyAt = new Date(replySlot.planned_at).toISOString();
  const replyClaim = await as(a, () => followupClaim(a), replyAt);
  eq(replyClaim.status, "claimed");
  const proof1 = await recordClear(replyClaim, replyAt);
  eq(proof1.status, "clear");
  const replyMessage = await as(a, () => prepareFollowup(a, replyClaim, proof1), replyAt);
  eq(replyMessage.status, "pronto");
  const proof2 = await recordClear(replyClaim, replyAt);
  eq(proof2.status, "clear");
  ok(proof2.proof_id !== proof1.proof_id, "Due prove distinte anche con un piano");
  await begin(a, replyAt, "authenticated");
  await rpc(a, "record_partner_activity", [
    randomUUID(),
    JSON.stringify({
      schema_version: 1,
      partner_id: replying.id,
      kind: "risposta",
      channel: "email",
      body: "Risposta sintetica registrata dal team.",
    }),
  ]);
  await begin(b, replyAt);
  const blockedReply = capture(startFollowup(b, replyClaim, replyMessage, proof2));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  const replyStop = await success(blockedReply);
  ok(replyStop.status !== "in_invio", "Risposta committed mentre start attende impedisce SMTP");
  await b.query("commit");
  eq(
    await scalar(
      owner,
      "select send_status value from public.partner_assistant_messages where id=$1",
      [replyMessage.message_row_id],
    ),
    "scartato",
  );
  eq(
    await scalar(owner, "select private.partner_followup_sent($1::date) value", [DAY]),
    0,
    "Nessuna quota consumata da slot annullato",
  );
  await release(replyClaim.lease_token, replyAt);

  // Il giorno locale può essere ieri mentre la quota appartiene già al nuovo giorno di Roma.
  await reset();
  const midnight = "2026-11-09T23:30:00Z";
  await ready(8600, { tz: "Pacific/Honolulu", country: "Narnia", at: midnight });
  await ready(8601, { tz: "Europe/Rome", at: midnight });
  await plan(midnight);
  const crossing = await slots(),
    hawaii = crossing.find((s) => s.timezone === "Pacific/Honolulu");
  ok(hawaii, "Finestra ancora disponibile nel giorno locale precedente");
  eq(hawaii.local_day_text, "2026-11-09", "Giorno locale precedente conservato");
  eq(hawaii.quota_day_text, "2026-11-10", "Quota conteggiata sul giorno Roma dell'invio");
  eq(
    new Set(crossing.map((s) => s.window_id)).size,
    2,
    "Giorno locale e finestra differenti non sono fusi insieme",
  );
  for (const s of crossing)
    eq(s.quota_day_text, s.actual_quota_day, "Nessuna quota dedotta dal solo giorno locale");

  // Conversioni attraverso DST: si costruiscono i giorni civili, mai aggiungendo24h all'UTC.
  for (const [day, romeOpen, newYorkOpen] of [
    ["2027-03-12", "08:00:00Z", "14:00:00Z"],
    ["2027-03-16", "08:00:00Z", "13:00:00Z"],
    ["2027-03-30", "07:00:00Z", "13:00:00Z"],
    ["2027-10-29", "07:00:00Z", "13:00:00Z"],
    ["2027-11-02", "08:00:00Z", "13:00:00Z"],
    ["2027-11-09", "08:00:00Z", "14:00:00Z"],
  ]) {
    await reset();
    const at = `${day}T05:00:00Z`;
    await ready(8700, { tz: "Europe/Rome", country: "Narnia", at });
    await ready(8701, { tz: "America/New_York", country: "Narnia", at });
    await plan(at);
    const windows = (
      await owner.query(
        "select opens_at,local_day::text as day from private.partner_send_windows w where exists(select 1 from private.partner_send_slots s where s.window_id=w.id and s.status='scheduled') order by opens_at",
      )
    ).rows;
    eq(
      windows.map((w) => new Date(w.opens_at).toISOString()),
      [`${day}T${romeOpen}`, `${day}T${newYorkOpen}`].map((v) => new Date(v).toISOString()),
      `DST indipendente Europa/USA ${day}`,
    );
    ok(
      windows.every((w) => w.day === day),
      "Giorni locali corretti prima e dopo il cambio d'ora",
    );
  }

  // La data OOO riguarda il destinatario: Roma può essere già al17 mentre Honolulu è al16.
  // Anche un client che registrasse erroneamente clear non può anticipare il rientro.
  await reset();
  const oooAt = "2026-11-16T23:30:00Z";
  const absent = await followup(8750, { tz: "Pacific/Honolulu", country: "Narnia", at: oooAt });
  await owner.query(
    "update public.partner_assistant_followups set deferred_until=date '2026-11-17',next_due_on=date '2026-11-17',reason='fuori_ufficio' where id=$1",
    [absent.conversation],
  );
  await plan(oooAt);
  eq(
    (await slots()).filter((s) => s.partner_id === absent.id && s.local_day_text === "2026-11-16")
      .length,
    0,
    "Nessuno slot il16locale prima del rientro17",
  );
  const absentClaim = await as(a, () => followupClaim(a), oooAt);
  eq(absentClaim.status, "claimed", "Il monitoraggio resta disponibile durante OOO");
  eq(absentClaim.candidate.send_allowed, false);
  const deferred = await as(
    a,
    () =>
      rpc(a, "record_partner_followup_check", [
        absentClaim.lease_token,
        absentClaim.candidate.id,
        absentClaim.candidate.version,
        JSON.stringify({
          result: "deferred",
          reason: "fuori_ufficio",
          checked_at: oooAt,
          proof_sha256: sha(oooAt),
          folder_count: 3,
          message_count: 1,
          resume_on: "2026-11-17",
        }),
      ]),
    oooAt,
  );
  eq(deferred.status, "deferred", "Rientro17 accettato: futuro locale anche se oggiRoma è17");
  const wrongClear = await recordClear(absentClaim, oooAt);
  eq(
    wrongClear.status,
    "clear",
    "La scansione completa può registrare una proof senza autorizzare SMTP",
  );
  eq(
    await scalar(
      owner,
      "select deferred_until::text value from public.partner_assistant_followups where id=$1",
      [absent.conversation],
    ),
    "2026-11-17",
    "Clear prima del17locale non annulla il rinvio",
  );
  eq(
    await as(
      owner,
      () =>
        scalar(owner, "select private.partner_followup_send_reason($1) value", [
          absent.conversation,
        ]),
      oooAt,
      "postgres",
    ),
    "fuori_ufficio",
  );
  const premature = await as(a, () => prepareFollowup(a, absentClaim, wrongClear), oooAt);
  ok(premature.status !== "pronto", "Nessun MIME autorizzato prima del rientro locale");
  eq(premature.reason, "fuori_ufficio");
  await release(absentClaim.lease_token, oooAt);
  const returnedAt = "2026-11-17T19:00:00Z";
  const returned = await as(a, () => followupClaim(a), returnedAt);
  eq(returned.status, "claimed");
  eq((await recordClear(returned, returnedAt)).status, "clear");
  eq(
    await scalar(
      owner,
      "select deferred_until::text value from public.partner_assistant_followups where id=$1",
      [absent.conversation],
    ),
    null,
    "Rinvio rimosso soltanto quando il17locale è arrivato",
  );
  eq(
    await scalar(
      owner,
      "select next_due_on::text value from public.partner_assistant_followups where id=$1",
      [absent.conversation],
    ),
    "2026-11-17",
    "Cadenza Roma invariata",
  );
  await release(returned.lease_token, returnedAt);

  // I due minuti sono un intervallo dall'esito reale, separato dall'ora prenotata nello slot.
  await reset();
  await ready(8800);
  await ready(8801);
  await plan(BEFORE);
  const spacingSlots = await slots(),
    spacingAt = new Date(spacingSlots[0].planned_at).toISOString();
  await begin(a, spacingAt);
  const spacingClaim = await firstClaim(a);
  eq(spacingClaim.status, "claimed");
  ok(
    Date.parse(spacingClaim.candidate.send_not_after) <=
      Date.parse(spacingSlots[0].expires_at) + 90000,
    "Deadline trasporto limitata dalla tolleranza dello slot",
  );
  await begin(b, spacingAt);
  const competingFu = capture(followupClaim(b));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq((await success(competingFu)).reason, "occupato", "La lease primo impedisce un FU sovrapposto");
  await b.query("commit");
  const spacingMessage = await as(a, () => prepareFirst(a, spacingClaim), spacingAt);
  eq(spacingMessage.status, "pronto");
  eq(
    (await as(a, () => startFirst(a, spacingClaim, spacingMessage), spacingAt)).status,
    "in_invio",
  );
  const finishAt = new Date(Date.parse(spacingAt) + 30000).toISOString();
  eq(
    (await as(a, () => finishFirst(a, spacingClaim, spacingMessage), finishAt)).send_status,
    "inviato",
  );
  eq(
    await scalar(
      owner,
      "select extract(epoch from next_send_after-$1::timestamptz)::integer value from private.partner_assistant_mail_state",
      [finishAt],
    ),
    120,
    "Invio reale: cooldown esattamente2min, senza jitter4–11",
  );
  eq(await scalar(owner, "select private.partner_assistant_first_sent($1::date) value", [DAY]), 1);
  eq(
    await scalar(owner, "select private.partner_followup_sent($1::date) value", [DAY]),
    0,
    "Il primo non consuma la quota FU",
  );
  eq(
    await scalar(owner, "select status value from private.partner_send_slots where id=$1", [
      spacingSlots[0].id,
    ]),
    "sent",
    "Piano e ricevuta riconciliati nella stessa transazione",
  );
  await release(spacingClaim.lease_token, finishAt);

  // Un contesto cambiato dopo il piano non si autorizza con un vecchio snapshot.
  await reset();
  const changed = await ready(8810);
  await plan(BEFORE);
  const changeSlot = (await slots())[0],
    changeAt = new Date(changeSlot.planned_at).toISOString();
  const changedClaim = await as(a, () => firstClaim(a), changeAt);
  eq(changedClaim.status, "claimed");
  const changedMessage = await as(a, () => prepareFirst(a, changedClaim), changeAt);
  eq(changedMessage.status, "pronto");
  await begin(a, changeAt, "postgres");
  await a.query("select 1 from private.partner_assistant_mail_state where singleton for update");
  await a.query("update public.partner_contacts set version=version+1 where id=$1", [
    changed.contact,
  ]);
  await begin(b, changeAt);
  const changedStart = capture(startFirst(b, changedClaim, changedMessage));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  ok(
    (await success(changedStart)).status !== "in_invio",
    "Cambio versione committed prima dello start invalida lo snapshot",
  );
  await b.query("commit");
  eq(
    await scalar(
      owner,
      "select send_status value from public.partner_assistant_messages where id=$1",
      [changedMessage.message_row_id],
    ),
    "scartato",
  );
  await release(changedClaim.lease_token, changeAt);

  // Regressione prestazioni PostgreSQL: nessun FU pronto, molte prime e storia note distribuite
  // tra fusi. Il primo gruppo riserva3+3; gli altri non devono esplorare griglie/capacità FU
  // inesistenti, né rileggere tutti i contesti dopo che la quota Roma è già prenotata.
  await reset();
  const crowdedAt = `${DAY}T00:00:00Z`;
  await ready(8900, { sent: true, at: crowdedAt }); // Superata la prima settimana, limite effettivo6.
  const timezones = [
    "Pacific/Auckland",
    "Australia/Sydney",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Europe/Rome",
    "Europe/London",
    "America/New_York",
  ];
  const crowded = [];
  let performanceCo = 8901;
  for (const tz of timezones)
    for (let i = 0; i < 12; i++)
      crowded.push(
        await ready(performanceCo++, { club: i < 6, tz, country: "Narnia", at: crowdedAt }),
      );
  await owner.query(
    `insert into public.partner_assistant_notes(partner_id,kind,content,sources,rules_version,model,operation_id,created_by,created_at)
    select ($1::uuid[])[(i%cardinality($1::uuid[]))+1],'ricerca',jsonb_build_object('text','Storia sintetica della ricerca '||i::text),
      '{}',3,'claude-opus-5-5',gen_random_uuid(),$2,$3::timestamptz-interval '30 days'
    from generate_series(0,79) i`,
    [crowded.map((f) => f.id), ASSISTANT, crowdedAt],
  );
  eq(
    await scalar(
      owner,
      "select count(*)::integer value from public.partner_assistant_jobs where status='pronta'",
    ),
    84,
    "Carico realistico: almeno56 prime pronte, sette fusi distinti",
  );
  eq(
    await scalar(
      owner,
      "select count(*)::integer value from public.partner_assistant_followups where status='active' and draft_id is not null",
    ),
    0,
    "Nessun FU pronto da cui ricavare capacità fantasma",
  );
  const measuredPlan = async () => {
    const startedAt = performance.now();
    await as(
      owner,
      async () => {
        await owner.query("set local statement_timeout='5s'");
        await owner.query("select private.refresh_partner_send_plan()");
      },
      crowdedAt,
      "postgres",
    );
    const elapsed = performance.now() - startedAt;
    ok(elapsed < 5000, "Planner multi-fuso entro5s, sotto il budget RPC15s");
    return elapsed;
  };
  const firstPlanMs = await measuredPlan();
  const crowdedSlots = await slots(),
    todayCrowded = crowdedSlots.filter((s) => s.quota_day_text === DAY);
  eq(
    todayCrowded.length,
    6,
    "Le prenotazioni dei fusi precedenti esauriscono le sei prime del giorno Roma",
  );
  eq(todayCrowded.filter((s) => s.flow_template).length, 3);
  eq(todayCrowded.filter((s) => !s.flow_template).length, 3);
  eq(
    new Set(todayCrowded.map((s) => s.timezone)).size,
    1,
    "Gli altri fusi non prendono quote già prenotate",
  );
  eq(
    crowdedSlots.filter((s) => s.kind === "sollecito").length,
    0,
    "Zero FU non genera slot o capacità aggiuntiva",
  );
  const perQuotaDay = (
    await owner.query(
      "select quota_day::text as day,count(*)::integer total,count(*) filter(where flow_template)::integer club from private.partner_send_slots where status='scheduled' group by quota_day order by quota_day",
    )
  ).rows;
  ok(perQuotaDay.length > 0, "Il caso esercita almeno un giorno di prenotazioni");
  for (const row of perQuotaDay) {
    ok(
      row.total <= 6,
      "Massimo sei prime prenotate per giorno Roma anche con finestre locali che attraversano mezzanotte",
    );
    ok(row.club <= 3 && row.total - row.club <= 3, "Nessun trasferimento della quota Club/altri");
  }
  eq(
    await scalar(owner, "select private.partner_assistant_first_sent($1::date) value", [DAY]),
    0,
    "Pianificazione senza falsi invii reali",
  );
  const replayPlanMs = await measuredPlan();
  eq(
    (await slots()).map((s) => [s.id, s.planned_text]),
    crowdedSlots.map((s) => [s.id, s.planned_text]),
    "Replay con84prime e storia note non sposta né duplica il piano",
  );
  console.log(
    `Planner multi-fuso84prime/0FU: ${Math.round(firstPlanMs)}ms, replay${Math.round(replayPlanMs)}ms; budget5000ms.`,
  );

  // Clock sintetico che AVANZA sul tempo reale, solo nel cluster usa-e-getta. Nessun bypass
  // entra nella migrazione: planner, prepare, start e tutte le guardie sono quelli distribuiti.
  // Si evita che il test dipenda dal giorno/ora in cui viene eseguita la CI.
  await reset();
  await ready(8820);
  await plan(BEFORE);
  const expiringSlot = (await slots())[0],
    expiringAt = new Date(Date.parse(expiringSlot.expires_at) - 5000).toISOString();
  const expiringClaim = await as(a, () => firstClaim(a), expiringAt);
  eq(expiringClaim.status, "claimed");
  const expiringMessage = await as(a, () => prepareFirst(a, expiringClaim), expiringAt);
  eq(expiringMessage.status, "pronto");
  const base = new Date(Date.parse(expiringSlot.expires_at) - 1000).toISOString();
  // Quote da valori del test, non da input esterni; il timestamp corrente è catturato dal server.
  await owner.query(
    `create table private.slot_test_clock as select $1::timestamptz baseline,clock_timestamp() started_at`,
    [base],
  );
  await owner.query(`create or replace function private.partner_followup_proof_now() returns timestamptz
    language sql volatile security definer set search_path='' as $$
    select case when nullif(current_setting('luckylap.partner_followup.proof_now',true),'') is not null
      then current_setting('luckylap.partner_followup.proof_now',true)::timestamptz
      else baseline+(clock_timestamp()-started_at) end from private.slot_test_clock $$`);
  await begin(a, expiringAt, "postgres");
  await a.query("select 1 from private.partner_assistant_mail_state where singleton for update");
  await begin(b, expiringAt);
  await b.query("select set_config('luckylap.partner_followup.proof_now','',true)");
  const expiringStart = capture(startFirst(b, expiringClaim, expiringMessage));
  await waitBlocked(pids.b, pids.a);
  await new Promise((done) => setTimeout(done, 2000));
  await a.query("commit");
  const expiredResult = await success(expiringStart);
  ok(expiredResult.status !== "in_invio", "Slot scaduto durante il lock non autorizza SMTP");
  eq(
    expiredResult.reason,
    "slot_scaduto",
    "Ora dello slot riletta dopo il lock, non all'inizio della transazione",
  );
  await b.query("commit");
  eq(
    await scalar(
      owner,
      "select send_status value from public.partner_assistant_messages where id=$1",
      [expiringMessage.message_row_id],
    ),
    "scartato",
  );
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_assistant_messages where send_status='in_invio'",
    ),
    0,
  );
  await release(expiringClaim.lease_token, expiringAt);
  console.log(`PASS ${checks} piano email concurrent checks; PostgreSQL17 locale, dati sintetici.`);
} finally {
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
