// test-db: pglite minimo 74
// Posta IONOS: cursore, collegamento dei moduli, deduplica comune e nessuna nuova autorizzazione SMTP.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) throw Error("Serve il percorso assoluto di PGlite.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const founder = randomUUID();
const assistant = randomUUID();
const worker = randomUUID();
const start = "2026-11-18T09:00:00.000Z";
let now = start;
let checks = 0;
const eq = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label ?? "Valori diversi");
  checks++;
};
const ok = (value, label) => {
  assert.ok(value, label ?? "Condizione non verificata");
  checks++;
};
const query = (sql, args = []) => db.query(sql, args);
const sha = (text) => createHash("sha256").update(text).digest("hex");
const scalar = async (sql, args = []) => (await query(sql, args)).rows[0]?.v;
const migrationDirectory = new URL("../migrations/", import.meta.url);
function migration(suffix) {
  const names = readdirSync(migrationDirectory).filter((name) => name.endsWith(suffix));
  assert.equal(names.length, 1, suffix);
  return readFileSync(new URL(names[0], migrationDirectory), "utf8");
}
async function as(role, fn) {
  await db.exec("begin");
  try {
    await query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(role === "authenticated" ? { role, sub: founder } : { role }),
    ]);
    await query("select set_config('luckylap.partner_followup.proof_now', $1, true)", [now]);
    await query("select set_config('luckylap.partner_assistant.now', $1, true)", [now]);
    await db.exec(`set local role ${role}`);
    const value = await fn();
    await db.exec("commit");
    return value;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const rpc = (name, args) =>
  as("service_role", () =>
    scalar(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) v`, args),
  );
const claim = () => rpc("claim_partner_ionos_inbox", [worker, 60]);
const release = (lease, outcome = "inbox_osservata") =>
  rpc("release_partner_ionos_inbox", [lease, outcome]);
const message = (number, overrides = {}) => ({
  message_id: `<inbox-${number}@peer.example.test>`,
  from_address: "referente@agenzia.example.test",
  received_at: now,
  subject: "CLASSIC VILLAGE E SUPERCAR 2027 · informazioni espositori",
  automatic: false,
  ...overrides,
});
const payload = (messages, expected, last, validity = "101") => ({
  folder: { path: "INBOX", uid_validity: validity, expected_last_uid: expected, last_uid: last },
  messages,
});
const record = (lease, messages, expected, last, validity) =>
  rpc("record_partner_ionos_inbox", [lease, payload(messages, expected, last, validity)]);
async function fixture(
  co,
  name,
  {
    address,
    form = true,
    stage = "contattato",
    active = true,
    verified = true,
    contactedAt = "2026-11-17T10:00:00Z",
  } = {},
) {
  const id = randomUUID();
  await query(
    `insert into public.partners(id, co, name, origin, stage, created_by, sections, country, priority, contact_month)
     values ($1,$2,$3,'team',$4,$5,array['eventi'],'Italia','media','2026-11-01')`,
    [id, co, name, stage, founder],
  );
  await query(
    "insert into public.partner_assistant_contacts(partner_id,active,updated_by) values ($1,$2,$3)",
    [id, active, founder],
  );
  if (address)
    await query(
      `insert into public.partner_contacts(partner_id,kind,value,link_value,verified,created_by,updated_by)
       values ($1,'email',$2,$2,$4,$3,$3)`,
      [id, address, founder, verified],
    );
  await query(
    `select private.partner_log($1,$2,'inviato',$3,p_channel=>$4,p_message_kind=>'primo',
      p_occurred_at=>$5)`,
    [randomUUID(), id, founder, form ? "form" : "email", contactedAt],
  );
  return id;
}
const stage = (id) => scalar("select stage v from public.partners where id=$1", [id]);
const activityCount = (id) =>
  scalar(
    "select count(*)::int v from public.partner_activities where partner_id=$1 and kind='risposta'",
    [id],
  );
const taskStatus = (id) =>
  scalar(
    "select t.status v from public.tasks t join public.partner_work_links l on l.task_id=t.id where l.partner_id=$1 and l.kind='follow_up' order by t.created_at desc limit 1",
    [id],
  );
async function smtpOriginal(partner, address) {
  const research = await scalar(
    `insert into public.partner_assistant_notes(partner_id,kind,content,rules_version,operation_id,created_by)
    values ($1,'ricerca','{}',1,gen_random_uuid(),$2) returning id v`,
    [partner, assistant],
  );
  const contact = await scalar(
    "select id v from public.partner_contacts where partner_id=$1 and kind='email' limit 1",
    [partner],
  );
  const draft = await scalar(
    `insert into public.partner_assistant_drafts(partner_id,contact_id,partner_version,language,subject,body,signature,sha256,rules_version,research_note_id,operation_id,created_by)
    select $1,$2,p.version,'it','Proposta sintetica','Testo sintetico','Firma sintetica',$3,1,$4,gen_random_uuid(),$5 from public.partners p where p.id=$1 returning id v`,
    [partner, contact, sha("Bozza sintetica"), research, assistant],
  );
  const id = `<${randomUUID()}@brand.example.test>`;
  const raw = "Subject: Proposta sintetica\r\n\r\nTesto sintetico\r\n";
  await query(
    `insert into public.partner_assistant_messages(partner_id,draft_id,kind,mode,send_status,message_id,to_address,subject,body,raw,sha256,rules_version,lease_token,send_day,sent_at,operation_id,created_by)
    values ($1,$2,'primo','invio','inviato',$3,$4,'Proposta sintetica','Testo sintetico',$5,$6,1,gen_random_uuid(),'2026-11-17','2026-11-17T11:00:00Z',gen_random_uuid(),$7)`,
    [partner, draft, id, address, raw, sha(raw), assistant],
  );
  return id;
}

try {
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}') $$;
    create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid $$;
    grant usage on schema auth to anon,authenticated,service_role;
    create schema storage; create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
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
    "_partner_riferimenti_generici.sql",
    "_partner_solleciti_controlli_imap.sql",
    "_partner_risposte_solleciti.sql",
    "_partner_ionos_inbox.sql",
  ])
    await db.exec(migration(suffix));
  for (const [id, name] of [
    [founder, "Fondatore sintetico"],
    [assistant, "Assistente sintetico"],
  ]) {
    await query("insert into auth.users values ($1)", [id]);
    await query("insert into public.profiles(user_id,display_name) values ($1,$2)", [id, name]);
  }
  await query("insert into public.memberships(user_id,role,active) values ($1,'founder',true)", [
    founder,
  ]);
  await query(
    "update private.partner_assistant_config set actor_id=$1,handoff_to=$2,mode='invio'",
    [assistant, founder],
  );
  const form = await fixture(801, "Classic Village 2027", { active: false });
  const email = await fixture(802, "Museum Boutique", {
    address: "shop@museum.example.test",
    form: false,
  });
  const closed = await fixture(803, "Closed Festival", {
    address: "closed@peer.example.test",
    stage: "no",
  });
  const discussion = await fixture(804, "Active Discussion", {
    address: "talk@peer.example.test",
    stage: "trattativa",
  });
  const duplicate = await fixture(805, "Second Festival", { address: "shared@peer.example.test" });
  await fixture(806, "Third Festival", { address: "shared@peer.example.test" });
  const late = await fixture(807, "Ancient Expo 2027", {
    address: "late@peer.example.test",
    contactedAt: "2026-05-01T10:00:00Z",
  });
  const unverified = await fixture(808, "Unverified Expo", {
    address: "unverified@peer.example.test",
    verified: false,
    form: false,
  });
  const otherThread = await smtpOriginal(discussion, "talk@peer.example.test");
  eq(
    await scalar("select private.partner_ionos_subject_alias('Rétro Festival 2027 (Paris)') v"),
    "retro festival",
  );
  eq(await scalar("select private.partner_ionos_subject_alias('Porsche Club') v"), null);
  for (const role of ["anon", "authenticated"])
    await assert
      .rejects(as(role, () => scalar("select public.claim_partner_ionos_inbox($1,60) v", [worker])))
      .then(() => checks++);
  await assert
    .rejects(as("service_role", () => scalar("select * from private.partner_ionos_inbox_state")))
    .then(() => checks++);
  let c = await claim();
  eq(c.status, "claimed");
  eq(new Date(c.activated_at).toISOString(), start);
  eq(c.cursors, [{ path: "INBOX", uid_validity: null, last_uid: 0 }]);
  eq(c.candidates.length, 8);
  eq(c.candidates.find((x) => x.partner_id === unverified).addresses, []);
  eq(c.candidates.find((x) => x.partner_id === form).subject_alias, "classic village");
  eq((await claim()).reason, "occupato");
  eq(await record(randomUUID(), [], 0, 0), { status: "lease_persa" });
  const old = message(1, { received_at: "2026-11-18T08:59:59Z" });
  eq(await record(c.lease_token, [old], 0, 1), {
    status: "recorded",
    registered: 0,
    review: 0,
    ignored: 1,
  });
  eq(await activityCount(form), 0);
  now = "2026-11-18T09:01:00Z";
  eq(
    await record(
      c.lease_token,
      [message(2, { body_excerpt: "Il referente è disponibile per le condizioni espositive." })],
      1,
      2,
    ),
    { status: "recorded", registered: 1, review: 0, ignored: 0 },
  );
  eq(await stage(form), "risposto");
  eq(await activityCount(form), 1);
  eq(
    await scalar(
      "select count(*)::int v from public.partner_contacts where partner_id=$1 and kind='email' and label='Risposta ricevuta in IONOS' and not verified and active",
      [form],
    ),
    1,
  );
  ok(
    (
      await scalar(
        "select addresses v from private.partner_ionos_candidates() where partner_id=$1",
        [form],
      )
    ).includes("referente@agenzia.example.test"),
  );
  eq(await taskStatus(form), "done");
  eq(
    await scalar("select active v from public.partner_assistant_contacts where partner_id=$1", [
      form,
    ]),
    false,
  );
  eq(
    await scalar(
      "select count(*)::int v from public.partner_assistant_followups where partner_id=$1",
      [form],
    ),
    0,
  );
  eq(
    await scalar(
      "select count(*)::int v from public.partner_assistant_messages where partner_id=$1",
      [form],
    ),
    0,
  );
  eq(await record(c.lease_token, [message(2)], 2, 3), {
    status: "recorded",
    registered: 0,
    review: 0,
    ignored: 1,
  });
  eq(await activityCount(form), 1);
  eq(
    await record(
      c.lease_token,
      [message(3, { subject: "Nuovo oggetto dal referente già riconosciuto" })],
      3,
      4,
    ),
    {
      status: "recorded",
      registered: 1,
      review: 0,
      ignored: 0,
    },
  );
  eq(await activityCount(form), 2, "Una seconda email è una seconda attività");
  eq(
    await record(
      c.lease_token,
      [message(4, { from_address: "shop@museum.example.test", subject: "Nuovo oggetto" })],
      4,
      5,
    ),
    { status: "recorded", registered: 1, review: 0, ignored: 0 },
  );
  eq(await stage(email), "risposto");
  eq(await taskStatus(email), "done");
  eq(
    await record(
      c.lease_token,
      [
        message(5, { from_address: "closed@peer.example.test", subject: "Ulteriori informazioni" }),
        message(6, { from_address: "talk@peer.example.test", subject: "Aggiornamento" }),
      ],
      5,
      7,
    ),
    { status: "recorded", registered: 2, review: 0, ignored: 0 },
  );
  eq(await stage(closed), "no");
  eq(await stage(discussion), "trattativa");
  eq(
    await record(
      c.lease_token,
      [message(7, { from_address: "shared@peer.example.test", subject: "Proposta" })],
      7,
      8,
    ),
    { status: "recorded", registered: 0, review: 1, ignored: 0 },
  );
  eq(await activityCount(duplicate), 0);
  eq(
    await scalar(
      "select count(*)::int v from public.tasks where title like 'Controllare risposta IONOS · %'",
    ),
    1,
  );
  eq(
    await record(
      c.lease_token,
      [message(7, { from_address: "shared@peer.example.test", subject: "Proposta" })],
      8,
      9,
    ),
    { status: "recorded", registered: 0, review: 0, ignored: 1 },
  );
  eq(
    await scalar(
      "select count(*)::int v from public.tasks where title like 'Controllare risposta IONOS · %'",
    ),
    1,
  );
  eq(await record(c.lease_token, [message(8, { automatic: true })], 9, 10), {
    status: "recorded",
    registered: 0,
    review: 0,
    ignored: 1,
  });
  eq(await activityCount(form), 2);
  eq(
    await record(
      c.lease_token,
      [
        message(9, {
          from_address: "newsletter@unrelated.example.test",
          subject: "Unrelated newsletter",
        }),
      ],
      10,
      11,
    ),
    {
      status: "recorded",
      registered: 0,
      review: 0,
      ignored: 1,
    },
  );
  eq(await record(c.lease_token, [], 0, 12), { status: "lease_persa" });
  eq(await scalar("select last_uid::int v from private.partner_ionos_inbox_cursors"), 11);
  eq(await record(c.lease_token, [], 11, 2, "102"), {
    status: "recorded",
    registered: 0,
    review: 0,
    ignored: 0,
  });
  eq(await scalar("select last_uid::int v from private.partner_ionos_inbox_cursors"), 2);
  eq(await release(c.lease_token), { status: "done" });
  eq((await claim()).reason, "intervallo");
  now = "2026-11-18T09:02:01Z";
  c = await claim();
  eq(c.cursors, [{ path: "INBOX", uid_validity: "102", last_uid: 2 }]);
  eq(new Date(c.activated_at).toISOString(), start);
  eq(
    await record(
      c.lease_token,
      [
        message(10, {
          from_address: "late@peer.example.test",
          subject: "Risposta dopo molti mesi",
        }),
      ],
      2,
      3,
      "102",
    ),
    { status: "recorded", registered: 1, review: 0, ignored: 0 },
  );
  eq(await stage(late), "risposto");
  eq(await activityCount(late), 1);
  eq(
    await record(
      c.lease_token,
      [message(11, { from_address: "unverified@peer.example.test", subject: "Informazioni" })],
      3,
      4,
      "102",
    ),
    { status: "recorded", registered: 0, review: 0, ignored: 1 },
  );
  eq(await stage(unverified), "contattato");
  await assert
    .rejects(record(c.lease_token, [message(12, { subject: "Oggetto\nnon valido" })], 4, 5, "102"))
    .then(() => checks++);
  eq(await scalar("select last_uid::int v from private.partner_ionos_inbox_cursors"), 4);
  await assert
    .rejects(
      record(
        c.lease_token,
        Array.from({ length: 51 }, (_, index) => message(100 + index)),
        4,
        55,
        "102",
      ),
    )
    .then(() => checks++);
  eq(await scalar("select last_uid::int v from private.partner_ionos_inbox_cursors"), 4);

  // La vecchia RPC continua a fare le sue verifiche su una ricevuta ignorata dal lettore nuovo.
  // Qui si sostituisce soltanto il delegato, il cui comportamento completo ha il proprio harness.
  const legacyDefinition = await scalar(
    "select pg_get_functiondef('public.record_partner_followup_reply_before_ionos(uuid,uuid,bigint,jsonb)'::regprocedure) v",
  );
  await db.exec(`create or replace function public.record_partner_followup_reply_before_ionos(
    p_lease_token uuid,p_conversation_id uuid,p_expected_version bigint,p_reply jsonb)
    returns jsonb language plpgsql security definer set search_path='' as $$
    begin return '{"status":"legacy_called"}'::jsonb; end $$`);
  eq(
    await rpc("record_partner_followup_reply", [
      c.lease_token,
      randomUUID(),
      1,
      { message_id: message(9).message_id },
    ]),
    { status: "legacy_called" },
  );
  eq(
    await rpc("record_partner_followup_reply", [
      c.lease_token,
      randomUUID(),
      1,
      { message_id: message(2).message_id },
    ]),
    { status: "stale" },
  );
  await db.exec(legacyDefinition);
  eq(
    await scalar(
      "select has_function_privilege('service_role','public.record_partner_followup_reply_before_ionos(uuid,uuid,bigint,jsonb)','execute') v",
    ),
    false,
  );
  eq(
    await scalar(
      "select has_function_privilege('service_role','public.record_partner_followup_reply(uuid,uuid,bigint,jsonb)','execute') v",
    ),
    true,
  );
  eq(
    await record(
      c.lease_token,
      [
        message(20, {
          from_address: "shop@museum.example.test",
          subject: "Riferimenti discordanti",
          references: [otherThread],
        }),
      ],
      4,
      5,
      "102",
    ),
    { status: "recorded", registered: 0, review: 1, ignored: 0 },
  );
  eq(await activityCount(email), 1);
  eq(await activityCount(discussion), 1);
  eq(
    await record(
      c.lease_token,
      [
        message(21, {
          from_address: "unknown@another.example.test",
          subject: "Solo un riferimento",
          references: [otherThread],
        }),
      ],
      5,
      6,
      "102",
    ),
    { status: "recorded", registered: 0, review: 1, ignored: 0 },
  );
  eq(await activityCount(discussion), 1);
  eq(
    await scalar(
      "select count(*)::int v from public.partner_contacts where partner_id=$1 and value='unknown@another.example.test'",
      [discussion],
    ),
    0,
  );
  now = "2027-03-01T10:00:00Z";
  eq(
    await record(
      c.lease_token,
      [message(13, { subject: "Conferma del referente dopo più di novanta giorni" })],
      6,
      7,
      "102",
    ),
    { status: "recorded", registered: 1, review: 0, ignored: 0 },
  );
  eq(await activityCount(form), 3);
  eq(await release(c.lease_token, "inbox_incerta"), { status: "done" });
  eq(
    await scalar("select imap_login_code v from private.partner_assistant_mail_state"),
    "imap_verifica_incompleta",
  );
  eq(await release(c.lease_token), { status: "lease_persa" });
  console.log(
    `PASS ${checks} controlli acquisizione IONOS; PGlite, dati sintetici, nessuna posta.`,
  );
} catch (error) {
  console.error(
    error.message,
    error.where ?? "",
    error.query ?? "",
    error.stack?.split("\n").slice(-5).join("\n"),
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
