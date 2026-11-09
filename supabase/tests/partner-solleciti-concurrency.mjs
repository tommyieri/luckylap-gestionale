// test-db: postgres minimo 70
// Solleciti: lease unica, risposta prima di start, proof monouso, CAS e scadenza dopo un lock.
// PostgreSQL 17 locale con connessioni distinte, Auth e dati sintetici; nessun SMTP/IMAP/cloud.
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
function command(name, args) {
  const result = spawnSync(join(bin, name), args, {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.status !== 0) throw Error(`${name}: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
}
assert.match(command("postgres", ["--version"]), /PostgreSQL\) 17\./);
const directory = mkdtempSync("/private/tmp/luckylap-partner-followup-concurrency-");
const data = join(directory, "data"),
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
const ok = (actual, label) => {
  assert.ok(actual, label ?? "Condizione non verificata");
  checks++;
};
const scalar = async (client, sql, args = []) => (await client.query(sql, args)).rows[0]?.value;
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const AT = "2026-11-10T09:00:00Z";
const FOUNDER = randomUUID(),
  ASSISTANT = randomUUID(),
  WORKER = randomUUID();
const BODY =
  "Buongiorno,\nRiprendo la proposta della prima email per condividere un aggiornamento verificato sul vostro programma. La nuova attività offre un'occasione concreta per una piccola collezione dedicata, utile a dare continuità al rapporto con i soci e a lasciare un ricordo curato dell'incontro. Vi interessa approfondire questa possibilità?\nUn saluto,";
const SIGNATURE = "Nome Sintetico\nRuolo sintetico\n+39 000 000 0000\nhttps://brand.example.test";
const OPT_OUT = "Se preferite non ricevere altre email, scrivetemelo e non vi ricontattero.";

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
async function begin(client, role = "service_role") {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify(role === "authenticated" ? { role, sub: FOUNDER } : { role }),
  ]);
  await client.query("select set_config('luckylap.partner_assistant.now',$1,true)", [AT]);
  // Le gare ordinarie fissano entrambi i clock; l'ultimo caso usa il clock proof reale.
  await client.query("select set_config('luckylap.partner_followup.proof_now',$1,true)", [AT]);
  await client.query(`set local role ${role}`);
}
async function as(client, task, role = "service_role") {
  await begin(client, role);
  try {
    const result = await task();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
const rpc = (client, name, args) =>
  scalar(client, `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`, args);
const capture = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
async function successful(promise) {
  const result = await promise;
  if (result.error) throw result.error;
  return result.value;
}
async function waitBlocked(waitingPid, blockingPid) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = (
      await observer.query(
        "select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1",
        [waitingPid],
      )
    ).rows[0];
    if (state?.wait_event_type === "Lock" && state.blockers.includes(blockingPid)) {
      checks++;
      return;
    }
    await new Promise((done) => setTimeout(done, 20));
  }
  throw Error("L'attesa sul lock PostgreSQL non è stata osservata.");
}
const claim = (client) => rpc(client, "claim_partner_followup", [WORKER, 300]);
const check = async (c) => {
  const checkedAt = AT;
  return as(a, () =>
    rpc(a, "record_partner_followup_check", [
      c.lease_token,
      c.candidate.id,
      c.candidate.version,
      JSON.stringify({
        result: "clear",
        reason: null,
        checked_at: checkedAt,
        proof_sha256: sha(checkedAt),
        folder_count: 3,
        message_count: 0,
      }),
    ]),
  );
};
const release = (lease) =>
  as(a, () =>
    rpc(a, "release_partner_assistant_send", [
      lease,
      JSON.stringify({
        schema_version: 1,
        outcome: "test_completato",
        smtp_login: null,
        imap_login: null,
      }),
    ]),
  );
const state = (id) =>
  scalar(owner, "select send_status value from public.partner_assistant_messages where id=$1", [
    id,
  ]);
const conversation = (id) =>
  scalar(owner, "select to_jsonb(f) value from public.partner_assistant_followups f where id=$1", [
    id,
  ]);
const start = (client, c, message, proof) =>
  rpc(client, "start_partner_followup_send", [
    c.lease_token,
    message.message_row_id,
    proof.proof_id,
  ]);
function preparePayload(c, proof) {
  const d = c.candidate.draft;
  const messageId = `<${randomUUID()}@brand.example.test>`;
  const text = `${d.body}\n\n${d.signature}\n\n${OPT_OUT}`;
  const first = c.candidate.message_ids[0];
  const raw = `From: mittente@brand.example.test\r\nTo: ${c.candidate.address}\r\nSubject: ${d.subject}\r\nMessage-ID: ${messageId}\r\nIn-Reply-To: ${first}\r\nReferences: ${first}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(
    text,
    "utf8",
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
const prepare = (client, c, proof) =>
  rpc(client, "prepare_partner_followup_send", [
    randomUUID(),
    c.lease_token,
    c.candidate.id,
    JSON.stringify(preparePayload(c, proof)),
  ]);
async function draftPayload(id) {
  const f = await conversation(id);
  const snapshot = (
    await owner.query(
      `select p.version partner_version,k.version contact_version,
    (select max(version) from public.partner_assistant_rules) rules_version,d.language,m.subject
    from public.partners p join public.partner_contacts k on k.id=$2
    join public.partner_assistant_messages m on m.id=$3 join public.partner_assistant_drafts d on d.id=m.draft_id where p.id=$1`,
      [f.partner_id, f.contact_id, f.first_message_id],
    )
  ).rows[0];
  return {
    schema_version: 1,
    conversation_id: id,
    expected_version: Number(f.version),
    number: f.followups_sent + 1,
    partner_version: Number(snapshot.partner_version),
    contact_version: Number(snapshot.contact_version),
    address_sha256: f.address_sha256,
    rules_version: snapshot.rules_version,
    language: snapshot.language,
    subject: `Re: ${snapshot.subject}`,
    body: BODY,
    signature: SIGNATURE,
    research_text: "Fatto nuovo verificato presso una fonte sintetica ufficiale.",
    sources: ["https://club.example.test/novita"],
  };
}
const save = (client, payload) =>
  rpc(client, "save_partner_followup_draft", [randomUUID(), JSON.stringify(payload)]);
async function fixture(co) {
  const partner = randomUUID();
  await owner.query(
    `insert into public.partners(id,co,name,origin,stage,created_by,sections,priority,contact_month,country)
    values($1,$2,$3,'team','contattato',$4,array['club'],'media',date '2026-11-01','Italia')`,
    [partner, co, `Club Sintetico ${co}`, FOUNDER],
  );
  const contact = await scalar(
    owner,
    `insert into public.partner_contacts(partner_id,kind,value,link_value,verified,created_by,updated_by)
    values($1,'email',$2,$2,true,$3,$3) returning id value`,
    [partner, `info@club-${co}.example.test`, FOUNDER],
  );
  const research = await scalar(
    owner,
    `insert into public.partner_assistant_notes(partner_id,kind,content,sources,rules_version,model,operation_id,created_by)
    values($1,'ricerca','{"text":"Nessuna ricerca: bozza dal testo fisso per i club.","template":true}','{}',3,null,gen_random_uuid(),$2) returning id value`,
    [partner, ASSISTANT],
  );
  const choice = await scalar(
    owner,
    `insert into public.partner_assistant_notes(partner_id,kind,content,rules_version,model,operation_id,created_by)
    values($1,'scelta','{"contact_kind":"club","language":"it","register":"voi","timezone":"Europe/Rome","event_starts_on":"","request":"merch_cobranding","decision":{"kind":"scrivi"}}',3,null,gen_random_uuid(),$2) returning id value`,
    [partner, ASSISTANT],
  );
  const subject = `Club Sintetico ${co} e LuckyLap`;
  const draft = await scalar(
    owner,
    `insert into public.partner_assistant_drafts(partner_id,contact_id,partner_version,language,subject,body,signature,sha256,rules_version,research_note_id,choice_note_id,operation_id,created_by)
    select $1,$2,p.version,'it',$3,$4,$5,$6,3,$7,$8,gen_random_uuid(),$9 from public.partners p where p.id=$1 returning id value`,
    [
      partner,
      contact,
      subject,
      BODY,
      SIGNATURE,
      sha(`${subject}\n\n${BODY}\n\n${SIGNATURE}`),
      research,
      choice,
      ASSISTANT,
    ],
  );
  await owner.query(
    `insert into public.partner_assistant_jobs(partner_id,status,step,research_note_id,choice_note_id,draft_id)
    values($1,'inviata','controllo',$2,$3,$4)`,
    [partner, research, choice, draft],
  );
  const raw = `Subject: ${subject}\r\n\r\nTesto sintetico.`;
  await owner.query(
    `insert into public.partner_assistant_messages(partner_id,draft_id,kind,mode,send_status,message_id,to_address,subject,body,raw,sha256,rules_version,lease_token,send_day,sent_at,appended_at,operation_id,created_by,created_at)
    values($1,$2,'primo','invio','inviato',$3,$4,$5,$6,$7,$8,3,gen_random_uuid(),date '2026-11-02',timestamptz '2026-11-02T09:00:00Z',timestamptz '2026-11-02T09:01:00Z',gen_random_uuid(),$9,timestamptz '2026-11-02T08:59:00Z')`,
    [
      partner,
      draft,
      `<${randomUUID()}@brand.example.test>`,
      `info@club-${co}.example.test`,
      subject,
      BODY,
      raw,
      sha(raw),
      ASSISTANT,
    ],
  );
  await owner.query("select private.refresh_partner_followups()");
  const id = await scalar(
    owner,
    "select id value from public.partner_assistant_followups where partner_id=$1",
    [partner],
  );
  ok(id, "Conversazione creata dal primo invio sintetico");
  const payload = await draftPayload(id);
  const saved = await as(a, () => save(a, payload), "authenticated");
  eq(saved.number, 1, "Bozza approvata dalla RPC founder reale");
  return id;
}

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
  ok(pids.a !== pids.b, "Connessioni PostgreSQL distinte");
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
  const directoryUrl = new URL("../migrations/", import.meta.url),
    names = readdirSync(directoryUrl);
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
  ]) {
    const found = names.filter((name) => name.endsWith(suffix));
    assert.equal(found.length, 1, `Una migrazione ${suffix}`);
    await owner.query(readFileSync(new URL(found[0], directoryUrl), "utf8"));
  }
  for (const [user, name] of [
    [FOUNDER, "Fondatore sintetico"],
    [ASSISTANT, "Assistente sintetico"],
  ]) {
    await owner.query("insert into auth.users values($1)", [user]);
    await owner.query("insert into public.profiles(user_id,display_name) values($1,$2)", [
      user,
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
  eq(await scalar(owner, "select mode value from private.partner_followup_config"), "osserva");
  const enabled = await as(
    a,
    () =>
      rpc(a, "set_partner_followup_mode", [
        randomUUID(),
        JSON.stringify({ schema_version: 1, expected_version: 1, mode: "invio" }),
      ]),
    "authenticated",
  );
  eq(enabled.mode, "invio");

  // 1. Due claim realmente sovrapposte: il secondo processo osserva una sola lease.
  const c1Id = await fixture(7001);
  await begin(a);
  const c1 = await claim(a);
  eq(c1.status, "claimed");
  eq(c1.candidate.co, 7001);
  await begin(b);
  const duplicateClaim = capture(claim(b));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq((await successful(duplicateClaim)).reason, "occupato");
  await b.query("commit");
  eq(
    await scalar(owner, "select lease_token value from private.partner_assistant_mail_state"),
    c1.lease_token,
  );
  eq(await scalar(owner, "select count(*)::int value from private.partner_followup_leases"), 1);
  eq((await release(c1.lease_token)).status, "done");

  // 2. La risposta del team è confermata prima che start esca dal lock: nessun in_invio.
  await owner.query("update public.partner_assistant_followups set next_check_at=$2 where id=$1", [
    c1Id,
    AT,
  ]);
  const c2 = await as(a, () => claim(a));
  const p2 = await check(c2);
  eq(p2.status, "clear");
  const m2 = await as(a, () => prepare(a, c2, p2));
  eq(m2.status, "pronto");
  const second2 = await check(c2);
  eq(second2.status, "clear");
  await begin(a, "authenticated");
  await rpc(a, "record_partner_activity", [
    randomUUID(),
    JSON.stringify({
      schema_version: 1,
      partner_id: c2.candidate.partner_id,
      kind: "risposta",
      channel: "email",
      body: "Risposta sintetica registrata dal team.",
    }),
  ]);
  await begin(b);
  const blockedByReply = capture(start(b, c2, m2, second2));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  const afterReply = await successful(blockedByReply);
  ok(
    afterReply.status !== "in_invio",
    "Risposta committed prima di start impedisce l'autorizzazione",
  );
  await b.query("commit");
  eq(await state(m2.message_row_id), "scartato");
  eq((await conversation(c1Id)).status, "held");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_assistant_messages where kind='sollecito' and send_status='in_invio'",
    ),
    0,
  );
  await release(c2.lease_token);

  // 3. La stessa proof non prepara due MIME. La seconda proof avvia un solo invio.
  const c3Id = await fixture(7002);
  const c3 = await as(a, () => claim(a));
  eq(c3.candidate.id, c3Id);
  const p3 = await check(c3);
  eq(p3.status, "clear");
  await begin(a);
  const m3 = await prepare(a, c3, p3);
  eq(m3.status, "pronto");
  await begin(b);
  const duplicatePrepare = capture(prepare(b, c3, p3));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq((await successful(duplicatePrepare)).reason, "controllo_scaduto");
  await b.query("commit");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_assistant_messages where partner_id=$1 and kind='sollecito'",
      [c3.candidate.partner_id],
    ),
    1,
  );
  ok(
    await scalar(
      owner,
      "select used_at is not null value from private.partner_followup_proofs where id=$1",
      [p3.proof_id],
    ),
  );
  const second3 = await check(c3);
  eq(second3.status, "clear");
  ok(second3.proof_id !== p3.proof_id, "Proof nuova dopo il MIME");
  eq(
    await scalar(
      owner,
      "select prepared_message_id value from private.partner_followup_proofs where id=$1",
      [second3.proof_id],
    ),
    m3.message_row_id,
  );
  await begin(a);
  eq((await start(a, c3, m3, second3)).status, "in_invio");
  await begin(b);
  const duplicateStart = capture(start(b, c3, m3, second3));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  ok(
    (await successful(duplicateStart)).status !== "in_invio",
    "La stessa proof non autorizza due start",
  );
  await b.query("commit");
  eq(await state(m3.message_row_id), "in_invio");
  eq(
    await scalar(owner, "select private.partner_followup_sent(date '2026-11-10') value"),
    1,
    "Start FU riserva solo la quota dei solleciti",
  );
  eq(
    await scalar(owner, "select private.partner_assistant_first_sent(date '2026-11-10') value"),
    0,
    "FU non consuma i sei posti delle prime email",
  );
  for (const template of [true, false])
    eq(
      await scalar(
        owner,
        "select private.partner_assistant_flow_sent(date '2026-11-10',$1) value",
        [template],
      ),
      0,
      "FU non consuma le quote rigide 3+3 delle prime email",
    );
  ok(
    await scalar(
      owner,
      "select used_at is not null value from private.partner_followup_proofs where id=$1",
      [second3.proof_id],
    ),
  );
  const finishOperation = randomUUID();
  const uncertainPayload = JSON.stringify({
    message_row_id: m3.message_row_id,
    outcome: "incerto",
    smtp_code: null,
    enhanced_code: null,
    spam: false,
    reason: "smtp_incerto",
  });
  const finish = () =>
    as(a, () =>
      rpc(a, "finish_partner_followup_send", [c3.lease_token, finishOperation, uncertainPayload]),
    );
  eq((await finish()).send_status, "incerto");
  eq((await finish()).replayed, true);
  eq(
    await scalar(owner, "select private.partner_followup_sent(date '2026-11-10') value"),
    1,
    "Un FU incerto conta una volta nella quota separata anche dopo replay",
  );
  eq(await state(m3.message_row_id), "incerto");
  eq((await conversation(c3Id)).status, "held");
  eq((await conversation(c3Id)).reason, "invio_incerto");
  eq((await conversation(c3Id)).followups_sent, 0);
  await release(c3.lease_token);
  eq((await as(a, () => claim(a))).status, "idle", "Un incerto non torna in coda");
  // Il caso successivo è indipendente dalla normale attesa condivisa appena verificata.
  await owner.query("update private.partner_assistant_mail_state set next_send_after=null");

  // 4. Due salvataggi founder con lo stesso CAS: una sola revisione; proof e candidato vecchi no.
  const c4Id = await fixture(7003);
  const c4 = await as(a, () => claim(a));
  const p4 = await check(c4);
  eq(p4.status, "clear");
  const oldVersion = c4.candidate.version;
  const update = await draftPayload(c4Id);
  const oldDrafts = await scalar(
    owner,
    "select count(*)::int value from private.partner_followup_drafts where conversation_id=$1",
    [c4Id],
  );
  await begin(a, "authenticated");
  const changed = await save(a, update);
  eq(Number(changed.version), oldVersion + 1);
  await begin(b, "authenticated");
  const staleSave = capture(save(b, update));
  await waitBlocked(pids.b, pids.a);
  await a.query("commit");
  eq((await staleSave).error?.code, "40001");
  await b.query("rollback");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from private.partner_followup_drafts where conversation_id=$1",
      [c4Id],
    ),
    oldDrafts + 1,
  );
  eq((await check(c4)).status, "lease_persa");
  eq((await as(a, () => prepare(a, c4, p4))).status, "stop");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_assistant_messages where partner_id=$1 and kind='sollecito'",
      [c4.candidate.partner_id],
    ),
    0,
  );
  await release(c4.lease_token);
  await owner.query(
    "update public.partner_assistant_followups set next_check_at=$2::timestamptz+interval '1 day' where id=$1",
    [c4Id, AT],
  );

  // 5. Proof inizialmente valida che scade mentre start aspetta un lock: clock letto DOPO il lock.
  const c5Id = await fixture(7004);
  const c5 = await as(a, () => claim(a));
  eq(c5.candidate.id, c5Id);
  const p5 = await check(c5);
  const m5 = await as(a, () => prepare(a, c5, p5));
  eq(m5.status, "pronto");
  const second5 = await check(c5);
  eq(second5.status, "clear");
  await a.query("begin");
  await a.query("select 1 from private.partner_assistant_mail_state where singleton for update");
  await a.query(
    "update private.partner_followup_proofs set expires_at=clock_timestamp()+interval '1 second' where id=$1",
    [second5.proof_id],
  );
  await begin(b);
  await b.query("select set_config('luckylap.partner_followup.proof_now','',true)");
  eq(
    await scalar(
      b,
      "select nullif(current_setting('luckylap.partner_followup.proof_now',true),'') is null value",
    ),
    true,
    "Clock proof reale, senza override",
  );
  const expiringStart = capture(start(b, c5, m5, second5));
  await waitBlocked(pids.b, pids.a);
  await new Promise((done) => setTimeout(done, 2_000));
  await a.query("commit");
  eq((await successful(expiringStart)).reason, "controllo_scaduto");
  await b.query("commit");
  eq(await state(m5.message_row_id), "scartato");
  eq(
    await scalar(
      owner,
      "select count(*)::int value from public.partner_assistant_messages where kind='sollecito' and send_status='in_invio'",
    ),
    0,
  );
  await release(c5.lease_token);
  console.log(`PASS ${checks} solleciti concurrent checks; PostgreSQL 17 locale, dati sintetici.`);
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
