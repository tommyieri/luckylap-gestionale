// test-db: pglite minimo 94
// Riferimento ritirato: helper SQL, piano e messaggi canonici, senza parser MIME o accesso cloud.
// Lo stesso harness gira anche su PostgreSQL17: passare BIN e pg/lib/index.js invece di PGlite.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const [first, pgModule] = process.argv.slice(2);
if (!first) throw Error("Passare PGlite oppure BIN PostgreSQL17 e modulo pg.");
const realPostgres = Boolean(pgModule);
let db,
  client,
  directory,
  started = false;
const command = (name, args) => {
  const result = spawnSync(join(first, name), args, {
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.status !== 0) throw Error(`${name}: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
};
let checks = 0;
const eq = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const ok = (actual, label) => {
  assert.ok(actual, label);
  checks++;
};
async function fails(promise, code, message) {
  await assert.rejects(
    promise,
    (error) => error.code === code && (message === undefined || error.message === message),
  );
  checks++;
}

const fixtureId = (n) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const founder = fixtureId(901),
  assistant = fixtureId(990);
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const WORKER = randomUUID();
const MODEL = "modello-sintetico";
const SIGNATURE = "Nome Sintetico\nRuolo sintetico\nhttps://brand.example.test";

const migrations = new URL("../migrations/", import.meta.url);
const migration = (suffix) => {
  const names = readdirSync(migrations).filter((n) => n.endsWith(suffix));
  assert.equal(names.length, 1, `Una sola migrazione ${suffix}`);
  return readFileSync(new URL(names[0], migrations), "utf8");
};
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const value = async (sql, args = []) => (await one(sql, args))?.v;
const asOwner = (sql, args) => (args ? db.query(sql, args) : db.exec(sql));

// Martedì 10 novembre 2026: 9:00 UTC sono le 10 di Roma e di Berlino, le 4 di New York.
const TODAY = "2026-11-10";
const MORNING = `${TODAY}T09:00:00Z`;
const NEW_YORK_MORNING = `${TODAY}T14:45:00Z`;

async function as(role, sub, fn, { now, proofNow = now } = {}) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(sub ? { sub, role } : { role }),
    ]);
    if (now) {
      await db.query("select set_config('luckylap.partner_assistant.now', $1, true)", [now]);
      await db.query("select set_config('luckylap.partner_followup.proof_now', $1, true)", [
        proofNow,
      ]);
    }
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

const ids = new Map();
const draftIds = new Map();
async function ready(
  co,
  { club, tz = "Europe/Rome", country = "Italia", researchAt, bodyText, name, eventName = "" } = {},
) {
  const partnerId = randomUUID();
  ids.set(co, partnerId);
  await asOwner(
    `insert into public.partners(id, co, name, origin, stage, created_by, sections, priority,
       contact_month, country)
     values ($1, $2, $3, 'team', 'da_contattare', $4, $5::text[], 'media', date '2026-11-01', $6)`,
    [partnerId, co, name ?? `Club Sintetico ${co}`, founder, club ? ["club"] : ["collab"], country],
  );
  const contactId = await value(
    `insert into public.partner_contacts(partner_id, kind, value, link_value, created_by, updated_by)
     values ($1, 'email', $2, $2, $3, $3) returning id as v`,
    [partnerId, `info@club-${co}.example.test`, founder],
  );
  const at = researchAt ?? (club ? `${TODAY}T06:00:00Z` : "2026-11-09T06:00:00Z");
  const research = await value(
    `insert into public.partner_assistant_notes(partner_id, kind, content, sources, rules_version, model,
       operation_id, created_by, created_at)
     values ($1, 'ricerca', $2::jsonb, '{}', 1, $3, gen_random_uuid(), $4, $5::timestamptz)
     returning id as v`,
    [
      partnerId,
      JSON.stringify(
        club
          ? { text: "Nessuna ricerca: bozza dal testo fisso per i club.", template: true }
          : { text: `Ricerca sintetica del CO ${co}` },
      ),
      club ? null : MODEL,
      assistant,
      at,
    ],
  );
  const choice = await value(
    `insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model, operation_id,
       created_by, created_at)
     values ($1, 'scelta', $2::jsonb, 1, $3, gen_random_uuid(), $4, $5::timestamptz + interval '1 minute')
     returning id as v`,
    [
      partnerId,
      JSON.stringify({
        contact_kind: club ? "club" : "brand",
        language: "it",
        register: "voi",
        timezone: tz,
        event_starts_on: "",
        event_name: eventName,
        request: club ? "merch_cobranding" : "collab_capsule",
        decision: { kind: "scrivi" },
      }),
      MODEL,
      assistant,
      at,
    ],
  );
  const subject = `LuckyLap e Club Sintetico ${co}`;
  const body = bodyText ?? `Testo sintetico della prima email per il CO ${co}.`;
  const digest = sha(`${subject}\n\n${body}\n\n${SIGNATURE}`);
  const draftId = await value(
    `insert into public.partner_assistant_drafts(partner_id, contact_id, partner_version, language, subject, body,
       signature, sha256, rules_version, research_note_id, operation_id, created_by, created_at)
     select $1, $2, p.version, 'it', $3, $4, $5, $6, (select max(version) from public.partner_assistant_rules),
       $7, gen_random_uuid(), $8, $9::timestamptz + interval '2 minutes'
       from public.partners p where p.id = $1
     returning id as v`,
    [partnerId, contactId, subject, body, SIGNATURE, digest, research, assistant, at],
  );
  await asOwner(
    `insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model, operation_id,
       created_by, created_at)
     values ($1, 'controllo', jsonb_build_object('approved', true, 'problems', '[]'::jsonb, 'sha256', $2::text), 1,
       $3, gen_random_uuid(), $4, $5::timestamptz + interval '3 minutes')`,
    [partnerId, digest, MODEL, assistant, at],
  );
  await asOwner(
    `insert into public.partner_assistant_jobs(partner_id, status, step, research_note_id, choice_note_id, draft_id)
     values ($1, 'pronta', 'controllo', $2, $3, $4)`,
    [partnerId, research, choice, draftId],
  );
  draftIds.set(partnerId, draftId);
  return partnerId;
}

async function message(
  partner,
  {
    body = "Collaborazioni con alcuni Porsche Club in Italia.",
    subject = "Proposta sintetica",
    status = "pronto",
    kind = "primo",
    mode = "invio",
  } = {},
) {
  let run = null;
  if (mode === "prova")
    run = await value(
      "insert into private.partner_assistant_test_runs(draft_ids,recipients,requested_by) values($1::uuid[],1,$2) returning id v",
      [[draftIds.get(partner)], founder],
    );
  const raw = "Subject: Sintetico\r\n\r\nContenuto sintetico ASCII.";
  return value(
    `insert into public.partner_assistant_messages(partner_id,draft_id,kind,mode,send_status,message_id,to_address,
    subject,body,raw,sha256,rules_version,lease_token,send_day,sent_at,operation_id,created_by,followup_number,flow_template,test_run_id,test_index)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,gen_random_uuid(),date '2026-11-10',
    case when $5 in ('inviato','incerto') then timestamptz '2026-11-10 08:00Z' end,gen_random_uuid(),$12,
    case when $3='sollecito' then 1 end,case when $3='sollecito' then false end,$13,case when $4='prova' then 0 end) returning id v`,
    [
      partner,
      draftIds.get(partner),
      kind,
      mode,
      status,
      `<${randomUUID()}@brand.example.test>`,
      "destinatario@brand.example.test",
      subject,
      body,
      raw,
      sha(raw),
      assistant,
      run,
    ],
  );
}
try {
  if (realPostgres) {
    assert.match(command("postgres", ["--version"]), /PostgreSQL\) 17\./);
    directory = mkdtempSync("/private/tmp/luckylap-partner-riferimenti-");
    const socket = join(directory, "socket");
    mkdirSync(socket, { mode: 0o700 });
    command("initdb", [
      "-D",
      join(directory, "data"),
      "-U",
      "postgres",
      "--auth=trust",
      "--no-locale",
      "--encoding=UTF8",
    ]);
    command("pg_ctl", [
      "-D",
      join(directory, "data"),
      "-l",
      join(directory, "server.log"),
      "-o",
      `-F -k ${socket} -c listen_addresses=''`,
      "-w",
      "start",
    ]);
    started = true;
    const imported = await import(pathToFileURL(pgModule).href);
    const Client = imported.Client ?? imported.default.Client;
    client = new Client({
      host: socket,
      user: "postgres",
      database: "postgres",
      ssl: false,
      statement_timeout: 15000,
    });
    await client.connect();
    db = { exec: (sql) => client.query(sql), query: (sql, args) => client.query(sql, args) };
  } else {
    const { PGlite } = await import(pathToFileURL(first).href);
    db = new PGlite();
  }
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
    "_assistente_partner_club_generici.sql",
    "_assistente_partner_prova_allegati.sql",
    "_partner_programma_email.sql",
    "_partner_email_config_versions.sql",
    "_partner_email_config_seed.sql",
    "_partner_email_config_draft.sql",
    "_partner_email_config_context.sql",
    "_partner_email_format_track.sql",
    "_partner_lookbooks_aggiornati.sql",
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
  await asOwner(
    "update private.partner_assistant_config set mode = 'invio', test_confirmed_at = now(), test_confirmed_by = $1",
    [founder],
  );

  await db.exec(migration("_partner_quote_rigide.sql"));
  await db.exec(migration("_partner_solleciti_automatici.sql"));
  await db.exec(migration("_partner_calendario_2027.sql"));
  await db.exec(migration("_partner_invii_distribuiti.sql"));
  await db.exec(migration("_partner_piano_prestazioni.sql"));

  // Dati precedenti alla guardia: la migrazione non modifica bozze o messaggi storici.
  const BAD = "Caso Porsche Club Toscana: 150 magliette.";
  const bad = await ready(951, { bodyText: BAD });
  const eventAlias = await ready(957, {
    bodyText: "Proposta al Porsche Club Toscana per un evento sintetico.",
    eventName: "Porsche Club Toscana",
  });
  const clean = await ready(952, {});
  const recipient = await ready(953, { name: "Porsche Club Toscana Sintetico" });
  const pending = await message(bad, { body: BAD });
  const sendingPartner = await ready(954, {});
  const sending = await message(sendingPartner, { body: BAD, status: "in_invio" });
  const uncertainPartner = await ready(955, {});
  const uncertain = await message(uncertainPartner, { body: BAD, status: "in_invio" });
  const sentPartner = await ready(956, {});
  const sent = await message(sentPartner, { body: BAD, status: "inviato" });
  const before = await one(
    "select raw,sha256,body from public.partner_assistant_messages where id=$1",
    [sent],
  );
  const oldDraft = await one(
    "select subject,body,sha256 from public.partner_assistant_drafts where id=$1",
    [draftIds.get(bad)],
  );
  const oldConfig = await one(
    "select mode,daily_first_limit,paused_reason,version from private.partner_assistant_config where singleton",
  );
  const skipAcl = await value(
    "select proacl::text v from pg_proc where oid='private.skip_partner_assistant_send(uuid,uuid,text)'::regprocedure",
  );
  const snapshotAcl = await value(
    "select proacl::text v from pg_proc where oid='private.partner_send_snapshot(uuid,text,uuid,integer,timestamptz)'::regprocedure",
  );
  await db.exec(migration("_partner_riferimenti_generici.sql"));
  eq(
    await one("select subject,body,sha256 from public.partner_assistant_drafts where id=$1", [
      draftIds.get(bad),
    ]),
    oldDraft,
    "bozza precedente intatta",
  );
  eq(
    await one(
      "select mode,daily_first_limit,paused_reason,version from private.partner_assistant_config where singleton",
    ),
    oldConfig,
    "configurazione intatta",
  );
  eq(
    await value(
      "select proacl::text v from pg_proc where oid='private.skip_partner_assistant_send(uuid,uuid,text)'::regprocedure",
    ),
    skipAcl,
    "ACL skip preservati",
  );
  eq(
    await value(
      "select proacl::text v from pg_proc where oid='private.partner_send_snapshot(uuid,text,uuid,integer,timestamptz)'::regprocedure",
    ),
    snapshotAcl,
    "ACL snapshot preservati",
  );

  const helper = (text, names = []) =>
    value("select private.partner_assistant_retired_social_proof($1,$2::text[]) v", [text, names]);
  const positives = [
    "150 bespoke ones",
    "one hundred fifty custom-made ones",
    "HUNDERTFÜNFZIG BESTICKTE T-SHIRTS",
    "150 BRODÉES T-SHIRTS",
    "150 camisetas bordadas",
    "Porsche Club Toscana",
    "Porsche Club di Toscana",
    "Porsche Clubs in Tuscany",
    "Club Porsche de Toscane",
    "Tuscan Porsche Club",
    "Porsche-Club-Toskana",
    "150 magliette",
    "centocinquanta magliette",
    "cento-cinquanta magliette dedicate",
    "one hundred and fifty bespoke T-shirts",
    "a hundred fifty embroidered shirts",
    "hundertfünfzig individuell bestickte T-Shirts",
    "einhundertfuenfzig Clubshirts",
    "cent cinquante tee-shirts",
    "cent-cinquante t-shirts brodés",
    "ciento cincuenta camisetas bordadas",
    "150\u00a0T\u2011shirts",
    "150 brodées tee-shirts",
    "１５０ T-shirts",
  ];
  for (const text of positives)
    eq(await helper(text), true, `frammento sintetico vietato: ${text}`);
  const negatives = [
    "Porsche Club in Italia",
    "Una collaborazione con alcuni Porsche Club in Italia.",
    "Il modello 1500 e le magliette del club.",
    "1150 T-shirts",
    "1.150 magliette",
    "1,150 shirts",
    "La strada numero 150.",
    "Il 150 anniversario con magliette ricamate.",
    "150 anni di storia e magliette.",
    "150 years and T-shirts",
    "150 Jahre und T-Shirts",
    "150 ans et t-shirts",
    "150 años y camisetas",
    "Il calendario del 15.01.2050.",
    "Club Sintetico della Toscana",
    "Porsche Club Toscanaccio",
  ];
  for (const text of negatives)
    eq(await helper(text), false, `numero/regione non commerciali: ${text}`);
  eq(await helper(null), false, "testo nullo non contiene riferimenti");
  eq(
    await helper("Porsche Club Toscana e LuckyLap", ["Porsche Club Toscana"]),
    false,
    "identita completa esente",
  );
  eq(await helper("porsche club toscana", ["Porsche Club Toscana"]), false, "identita casefold");
  eq(
    await helper("Porsche Club Toscana: 150 magliette", ["Porsche Club Toscana"]),
    true,
    "quantita mai esente",
  );
  eq(
    await helper("Porsche Club Toscana", ["Porsche", "Club", "Toscana"]),
    true,
    "nomi parziali non esenti",
  );
  eq(
    await helper("Porsche Club Toscana", ["Club Sintetico"]),
    true,
    "altro destinatario non esente",
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    eq(
      await value(
        "select has_function_privilege($1,'private.partner_assistant_retired_social_proof(text,text[])','execute') v",
        [role],
      ),
      false,
      `helper revocato ${role}`,
    );
    eq(
      await value(
        "select has_function_privilege($1,'private.partner_assistant_retired_reference_guard()','execute') v",
        [role],
      ),
      false,
      `trigger revocato ${role}`,
    );
    await fails(
      as(role, role === "authenticated" ? founder : null, () => helper("Porsche Club Toscana")),
      "42501",
    );
  }
  eq(
    await value(
      "select count(*)::integer v from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid='private.partner_assistant_retired_social_proof(text,text[])'::regprocedure and a.grantee=0",
    ),
    0,
    "PUBLIC revocato",
  );

  // Il piano esclude una bozza vecchia ancora pronta, senza forzare una nuova scrittura.
  const at = "2026-11-10T09:00:00Z";
  eq(
    await value("select private.partner_send_snapshot($1,'primo',$2,0,$3::timestamptz) v", [
      bad,
      draftIds.get(bad),
      at,
    ]),
    null,
    "nessun piano per riferimento ritirato",
  );
  ok(
    await value("select private.partner_send_snapshot($1,'primo',$2,0,$3::timestamptz) v", [
      clean,
      draftIds.get(clean),
      at,
    ]),
    "bozza generica pulita pianificabile",
  );
  eq(
    await value("select status v from public.partner_assistant_jobs where partner_id=$1", [bad]),
    "pronta",
    "nessuna riscrittura del job durante snapshot",
  );

  for (const [kind, mode] of [
    ["primo", "invio"],
    ["primo", "prova"],
    ["sollecito", "invio"],
  ])
    for (const status of ["pronto", "in_invio"]) {
      await fails(
        message(clean, { kind, mode, status, body: "150 embroidered T-shirts" }),
        "22023",
        "retired_reference",
      );
      await fails(
        message(clean, { kind, mode, status, subject: "Porsche Club Toscana" }),
        "22023",
        "retired_reference",
      );
    }
  await fails(
    db.query("update public.partner_assistant_messages set send_status='in_invio' where id=$1", [
      pending,
    ]),
    "22023",
    "retired_reference",
  );
  eq(
    await value("select send_status v from public.partner_assistant_messages where id=$1", [
      pending,
    ]),
    "pronto",
    "avvio vecchio messaggio respinto atomico",
  );
  const safe = await message(clean, {});
  ok(safe, "nuovo messaggio generico pulito");
  eq(
    await value("select private.partner_send_snapshot($1,'primo',$2,0,$3::timestamptz) v", [
      eventAlias,
      draftIds.get(eventAlias),
      at,
    ]),
    null,
    "event_name non esenta il riferimento nel piano",
  );
  await fails(
    message(eventAlias, { body: "Proposta al Porsche Club Toscana per un evento sintetico." }),
    "22023",
    "retired_reference",
  );
  const identity = await message(recipient, { body: "Buongiorno Porsche Club Toscana Sintetico." });
  ok(identity, "nome ufficiale esente anche nel trigger");
  await fails(
    message(recipient, {
      kind: "sollecito",
      body: "Porsche Club Toscana Sintetico: 150 magliette",
    }),
    "22023",
    "retired_reference",
  );
  await db.query(
    "update public.partner_assistant_messages set send_status='inviato',sent_at=$2 where id=$1",
    [sending, at],
  );
  await db.query(
    "update public.partner_assistant_messages set send_status='incerto',sent_at=$2 where id=$1",
    [uncertain, at],
  );
  eq(
    await value("select send_status v from public.partner_assistant_messages where id=$1", [
      sending,
    ]),
    "inviato",
    "finish storico non bloccato",
  );
  eq(
    await value("select send_status v from public.partner_assistant_messages where id=$1", [
      uncertain,
    ]),
    "incerto",
    "incerto storico non bloccato",
  );
  await db.query(
    "update public.partner_assistant_messages set appended_at=clock_timestamp() where id=$1",
    [sent],
  );
  eq(
    await one("select raw,sha256,body from public.partner_assistant_messages where id=$1", [sent]),
    before,
    "storico conserva byte e testo",
  );
  await fails(
    db.query("update public.partner_assistant_messages set body='Testo cambiato' where id=$1", [
      sent,
    ]),
    "42501",
    "partner_assistant_message_immutable",
  );
  await fails(
    db.query("delete from public.partner_assistant_messages where id=$1", [sent]),
    "42501",
    "partner_assistant_message_immutable",
  );

  const job = await value("select id v from public.partner_assistant_jobs where partner_id=$1", [
    bad,
  ]);
  const lease = randomUUID();
  await db.query(
    "update private.partner_assistant_mail_state set lease_token=$1,lease_expires_at=clock_timestamp()+interval '5 minutes',candidate_draft_id=$2 where singleton",
    [lease, draftIds.get(bad)],
  );
  await db.query(
    "update public.partner_assistant_jobs set lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '5 minutes' where id=$1",
    [job],
  );
  const win = await value(
    "insert into private.partner_send_windows(opens_at,grid_end_at,latest_start_at,local_day) values(timestamptz '2026-11-10 08:00Z',timestamptz '2026-11-10 14:55Z',timestamptz '2026-11-10 14:58:30Z',date '2026-11-10') returning id v",
  );
  await db.query(
    "insert into private.partner_send_slots(window_id,partner_id,kind,draft_id,job_id,flow_template,snapshot,timezone,local_day,quota_day,planned_at,expires_at) values($1,$2,'primo',$3,$4,false,'{}','Europe/Rome',date '2026-11-10',date '2026-11-10',timestamptz '2026-11-10 09:00Z',timestamptz '2026-11-10 09:05Z')",
    [win, bad, draftIds.get(bad), job],
  );
  eq(
    await as(
      "service_role",
      null,
      () =>
        rpc("select public.skip_partner_assistant_send($1,$2,'riferimento_superato') r", [
          lease,
          job,
        ]),
      { now: at },
    ),
    { status: "done" },
    "skip autorizzato",
  );
  const after = await one(
    "select status,reason,draft_id,lease_token,lease_expires_at from public.partner_assistant_jobs where id=$1",
    [job],
  );
  eq(
    after,
    {
      status: "serve_tommaso",
      reason: "riferimento_superato",
      draft_id: draftIds.get(bad),
      lease_token: null,
      lease_expires_at: null,
    },
    "passaggio a Tommi senza nuova bozza",
  );
  eq(
    await value(
      "select lease_token::text v from private.partner_assistant_mail_state where singleton",
    ),
    lease,
    "lease casella conservata per release normale",
  );
  eq(
    await one("select status,reason from private.partner_send_slots where partner_id=$1", [bad]),
    { status: "skipped", reason: "riferimento_superato" },
    "slot invalidato dal normale skip",
  );
  eq(
    await value(
      "select count(*)::integer v from private.partner_assistant_events where partner_id=$1 and outcome='riferimento_superato'",
      [bad],
    ),
    1,
    "evento specifico senza chiamata Anthropic",
  );
  eq(
    await one("select subject,body,sha256 from public.partner_assistant_drafts where id=$1", [
      draftIds.get(bad),
    ]),
    oldDraft,
    "nessuna revisione implicita",
  );
  console.log(
    `PASS ${checks} riferimenti generici (${realPostgres ? "PostgreSQL17" : "PGlite"}); dati sintetici.`,
  );
} catch (error) {
  console.error(
    `Partner riferimenti generici: errore dopo ${checks} controlli: ${error.code ?? error.name}: ${error.message}`,
  );
  process.exitCode = 1;
} finally {
  if (realPostgres) {
    if (client) await client.end();
    if (started)
      command("pg_ctl", ["-D", join(directory, "data"), "-m", "immediate", "-w", "stop"]);
    if (directory) rmSync(directory, { recursive: true, force: true });
  } else if (db) await db.close();
}
