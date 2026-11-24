// test-db: pglite minimo 119
// Priorità eventi, attestazione di esaurimento e sei primi invii complessivi, con dati sintetici.
// Migrazioni Partner attuali, Auth simulata e dati sintetici, nessun accesso cloud.
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
const TODAY = "2026-11-24";
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

// Il giro d'invio a quell'ora; la lease della casella si toglie subito, così il giro dopo non trova
// «occupato».
async function claimAt(at) {
  const r = await as(
    "service_role",
    null,
    () => rpc("select public.claim_partner_assistant_send($1, 300, 0) r", [WORKER]),
    { now: at },
  );
  await asOwner(
    "update private.partner_assistant_mail_state set lease_token = null, lease_expires_at = null",
  );
  return r;
}
const candidateAt = async (at) => {
  const r = await claimAt(at);
  return r.status === "claimed" ? r.candidate.co : r.reason;
};
const flowSent = (template, day = TODAY) =>
  value("select private.partner_assistant_flow_sent($1::date, $2) as v", [day, template]);
const share = (template, day = TODAY) =>
  value("select private.partner_assistant_flow_share($1::date, $2) as v", [day, template]);
const firstSent = (day = TODAY) =>
  value("select private.partner_assistant_first_sent($1::date) as v", [day]);
const followupSent = (day = TODAY) =>
  value("select private.partner_followup_sent($1::date) as v", [day]);

// Un contatto con la bozza pronta: un club con la nota di ricerca del testo fisso, oppure un altro
// contatto (collab) con la ricerca di Claude. La ricerca degli altri è più vecchia: nella coda d'invio
// vengono prima dei club.
const ids = new Map();
const draftIds = new Map();
async function ready(
  co,
  {
    club,
    event = false,
    tz = "Europe/Rome",
    country = "Italia",
    researchAt,
    cardEventStartsOn = null,
  } = {},
) {
  const partnerId = randomUUID();
  ids.set(co, partnerId);
  await asOwner(
    `insert into public.partners(id, co, name, origin, stage, created_by, sections, priority,
       contact_month, country, event_starts_on)
     values ($1, $2, $3, 'team', 'da_contattare', $4, $5::text[], 'media', date '2026-11-01', $6, $7)`,
    [
      partnerId,
      co,
      `Contatto Sintetico ${co}`,
      founder,
      event ? ["eventi"] : club ? ["club"] : ["collab"],
      country,
      cardEventStartsOn,
    ],
  );
  const contactId = await value(
    `insert into public.partner_contacts(partner_id, kind, value, link_value, created_by, updated_by)
     values ($1, 'email', $2, $2, $3, $3) returning id as v`,
    [partnerId, `info@club-${co}.example.test`, founder],
  );
  const at = researchAt ?? (club ? `${TODAY}T06:00:00Z` : "2026-11-24T06:00:00Z");
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
        contact_kind: event ? "evento" : club ? "club" : "brand",
        language: "it",
        register: "voi",
        timezone: tz,
        event_starts_on: event ? "2027-05-20" : "",
        ...(event ? { event_country: country } : {}),
        request: event ? "stand_evento" : club ? "merch_cobranding" : "collab_capsule",
        decision: { kind: "scrivi" },
      }),
      MODEL,
      assistant,
      at,
    ],
  );
  const subject = `LuckyLap e Club Sintetico ${co}`;
  const body = `Testo sintetico della prima email per il CO ${co}.`;
  const digest = sha(`${subject}\n\n${body}\n\n${SIGNATURE}`);
  const draftId = await value(
    `insert into public.partner_assistant_drafts(partner_id, contact_id, partner_version, language, subject, body,
       signature, sha256, rules_version, research_note_id, operation_id, created_by, created_at, choice_note_id)
     select $1, $2, p.version, 'it', $3, $4, $5, $6, (select max(version) from public.partner_assistant_rules),
       $7, gen_random_uuid(), $8, $9::timestamptz + interval '2 minutes', $10
       from public.partners p where p.id = $1
     returning id as v`,
    [partnerId, contactId, subject, body, SIGNATURE, digest, research, assistant, at, choice],
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

// Prime email vere già partite quel giorno, copiate in «Posta inviata», a contatti nuovi (CO da 2001).
let nextCo = 2001;
async function sent(
  n,
  {
    club,
    day = TODAY,
    kind = "primo",
    sendStatus = "inviato",
    tz = "Europe/Rome",
    country = "Italia",
  },
) {
  const partners = [];
  for (let i = 0; i < n; i++) {
    const co = nextCo++;
    const partner = await ready(co, { club, tz, country });
    await asOwner(
      "update public.partner_assistant_jobs set status = 'inviata' where partner_id = $1",
      [partner],
    );
    const subject = `LuckyLap e Club Sintetico ${co}`;
    const body = `Testo sintetico della prima email per il CO ${co}.\n\n${SIGNATURE}`;
    const raw = `Subject: ${subject}\r\n\r\n${body.replaceAll("\n", "\r\n")}\r\n`;
    await asOwner(
      `insert into public.partner_assistant_messages(partner_id, draft_id, kind, mode, send_status, message_id,
         to_address, subject, body, raw, sha256, rules_version, lease_token, send_day, sent_at, appended_at,
         operation_id, created_by, followup_number, flow_template)
       values ($1, $2, $11, 'invio', $12, $3, $4, $5, $6, $7, $8, 1, gen_random_uuid(), $9::date,
         $9::date + time '08:40', case when $12='inviato' then $9::date + time '08:41' end, gen_random_uuid(), $10,
         case when $11='sollecito' then 1 end, case when $11='sollecito' then $13::boolean end)`,
      [
        partner,
        draftIds.get(partner),
        `<${randomUUID()}@luckylap.example.test>`,
        `info@club-${co}.example.test`,
        subject,
        body,
        raw,
        sha(raw),
        day,
        assistant,
        kind,
        sendStatus,
        club,
      ],
    );
    partners.push(partner);
  }
  return partners;
}
// Toglie tutti i messaggi, come la cancellazione definitiva (flag locale acceso).
const resetSends = () =>
  db.exec(`begin; set local luckylap.partner_assistant.erase = 'on';
    delete from public.partner_assistant_messages; commit;`);
// L'interruttore della scheda: un contatto fermo esce dalla coda d'invio.
const setActive = (co, active) =>
  asOwner(
    `insert into public.partner_assistant_contacts(partner_id, active, updated_by) values ($1, $2, $3)
     on conflict (partner_id) do update set active = excluded.active`,
    [ids.get(co), active, founder],
  );
const only = async (...cos) => {
  for (const co of ids.keys()) await setActive(co, cos.includes(co));
};

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
    [fixtureId(902), "Consulente sintetico", "consultant"],
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
  await db.exec(migration("_partner_solleciti_controlli_imap.sql"));
  await db.exec(migration("_partner_prime_eventi_ue_uk.sql"));
  const followupBefore = await value(
    "select pg_get_functiondef('private.partner_followup_reason(uuid,boolean)'::regprocedure) as v",
  );
  await db.exec(migration("_partner_eventi_priorita_fallback.sql"));
  let now = "2026-11-24T07:00:00Z";
  const run = (sql, args = [], at = now) =>
    as("postgres", null, () => value(sql, args), { now: at });
  const fallback = (at = now) =>
    run("select private.partner_event_fallback_check($1::timestamptz) is not null as v", [at], now);
  const catalog = () =>
    run("select private.partner_event_priority_catalog_sha256($1::date) as v", [TODAY]);
  const pending = () =>
    run("select private.partner_event_priority_pending($1::date) as v", [TODAY]);
  const auditPayload = async (patch = {}) => ({
    schema_version: 1,
    checked_on: TODAY,
    expected_catalog_sha256: await catalog(),
    exhausted: true,
    reason:
      "Catalogo e fonti ufficiali sintetiche ricontrollati: nessun evento contattabile residuo.",
    official_sources: ["https://event.example.test/calendar-2027"],
    ...patch,
  });
  const audit = async (patch = {}, actor = founder, op = randomUUID()) =>
    as(
      "authenticated",
      actor,
      () =>
        rpc("select public.record_partner_event_exhaustion($1,$2::jsonb) r", [
          op,
          JSON.stringify(patch),
        ]),
      { now },
    );
  const bad = async (fn, pattern) => {
    await assert.rejects(fn, pattern);
    checks++;
  };
  const snapshot = (id, at = `${TODAY}T09:00:00Z`) =>
    run("select private.partner_send_snapshot($1,'primo',$2,0,$3::timestamptz) as v", [
      id,
      draftIds.get(id),
      at,
    ]);
  const policy = (id, at = `${TODAY}T09:00:00Z`) =>
    run("select private.partner_first_policy_allows($1,$2::timestamptz) as v", [
      draftIds.get(id),
      at,
    ]);
  const program = (at = now) =>
    as(
      "authenticated",
      founder,
      () => rpc("select public.read_partner_email_program($1,3) r", [TODAY]),
      { now: at },
    );
  const programItem = async (id, at = now) =>
    (await program(at)).items.find((row) => row.partnerId === id);
  const refresh = () =>
    as("postgres", null, () => db.exec("select private.refresh_partner_send_plan()"), { now });
  const slots = (day = TODAY) =>
    db
      .query(
        "select * from private.partner_send_slots where status='scheduled' and kind='primo' and quota_day=$1::date order by planned_at",
        [day],
      )
      .then((r) => r.rows);
  const resetPlan = async () => {
    await only();
    await resetSends();
    await db.exec(
      "delete from private.partner_send_slots; delete from private.partner_send_windows",
    );
  };
  const fresh = (options = {}) =>
    ready(nextCo++, { club: false, researchAt: `${TODAY}T07:10:00Z`, ...options });
  const setStage = (id, stage) =>
    asOwner("update public.partners set stage=$2 where id=$1", [id, stage]);
  const replaceChoice = async (id, patch) => {
    const note = await value(
      `insert into public.partner_assistant_notes(partner_id,kind,content,sources,rules_version,model,operation_id,created_by)
      select n.partner_id,'scelta',n.content||$2::jsonb,n.sources,n.rules_version,n.model,gen_random_uuid(),n.created_by
      from public.partner_assistant_jobs j join public.partner_assistant_notes n on n.id=j.choice_note_id
      where j.partner_id=$1 returning id v`,
      [id, JSON.stringify(patch)],
    );
    const clone = await value(
      `insert into public.partner_assistant_drafts(partner_id,contact_id,partner_version,language,subject,body,
      signature,sha256,rules_version,research_note_id,operation_id,created_by,created_at,choice_note_id)
      select d.partner_id,d.contact_id,d.partner_version,d.language,d.subject,d.body,d.signature,d.sha256,d.rules_version,
        d.research_note_id,gen_random_uuid(),d.created_by,d.created_at,$2
      from public.partner_assistant_jobs j join public.partner_assistant_drafts d on d.id=j.draft_id where j.partner_id=$1 returning id v`,
      [id, note],
    );
    await asOwner(
      "update public.partner_assistant_jobs set choice_note_id=$2,draft_id=$3 where partner_id=$1",
      [id, note, clone],
    );
    draftIds.set(id, clone);
  };
  const approveEvent = async (id) => {
    const d = await one(
      "select d.id,d.sha256,p.version from public.partner_assistant_jobs j join public.partners p on p.id=j.partner_id join public.partner_assistant_drafts d on d.id=j.draft_id where p.id=$1",
      [id],
    );
    return as(
      "authenticated",
      founder,
      () =>
        rpc("select public.approve_partner_event_first_draft($1,$2::jsonb) r", [
          randomUUID(),
          JSON.stringify({
            schema_version: 1,
            partner_id: id,
            draft_id: d.id,
            expected_partner_version: d.version,
            expected_sha256: d.sha256,
            official_sources: ["https://event.example.test/2027/exhibitors"],
          }),
        ]),
      { now },
    );
  };

  eq(await fallback(), false, "la migrazione non accende il fallback");
  eq(await run("select private.partner_assistant_flow_share($1,true) v", [TODAY]), 0);
  eq(await run("select private.partner_assistant_flow_share($1,false) v", [TODAY]), 6);
  eq(await run("select private.partner_assistant_flow_share('2026-11-17',true) v"), 2);
  eq(await run("select private.partner_assistant_flow_share('2026-11-17',false) v"), 3);
  eq(await run("select private.partner_assistant_flow_share('2026-11-18',true) v"), 0);
  eq(await run("select private.partner_assistant_flow_share('2026-11-18',false) v"), 6);
  eq(await run("select private.partner_assistant_first_limit($1) v", [TODAY]), 6);
  eq(await pending(), 0);
  eq((await program()).config.eventPriorityFrom, TODAY);
  eq(
    (
      await as(
        "authenticated",
        founder,
        () => rpc("select public.read_partner_assistant_send() r"),
        { now },
      )
    ).event_priority_from,
    TODAY,
  );
  const input = await auditPayload();
  for (const role of ["anon", "service_role"])
    await bad(
      () =>
        as(
          role,
          null,
          () =>
            rpc("select public.record_partner_event_exhaustion($1,$2::jsonb) r", [
              randomUUID(),
              JSON.stringify(input),
            ]),
          { now },
        ),
      /permission denied/,
    );
  await bad(() => audit(input, fixtureId(902)), /partner_assistant_founder_required/);
  await bad(() => audit({ ...input, checked_on: "2026-11-23" }), /invalid_partner_payload/);
  await bad(() => audit({ ...input, official_sources: [] }), /invalid_partner_payload/);
  await bad(
    () => audit({ ...input, official_sources: ["http://event.example.test"] }),
    /invalid_partner_payload/,
  );
  await bad(() => audit({ ...input, reason: "Coda vuota" }), /invalid_partner_payload/);
  await bad(
    () => audit({ ...input, expected_catalog_sha256: "0".repeat(64) }),
    /partner_event_catalog_changed/,
  );

  const future = await fresh({ event: true });
  eq(await pending(), 1);
  await asOwner(
    "update public.partner_assistant_jobs set status='in_coda',draft_id=null where partner_id=$1",
    [future],
  );
  eq(await pending(), 1, "conta anche un evento senza bozza pronta");
  await bad(async () => audit(await auditPayload()), /partner_events_still_contactable/);
  // Una vecchia scelta non prevale su un'edizione futura aggiornata nella scheda.
  const oldChoiceEvent = await fresh({ event: true });
  await replaceChoice(oldChoiceEvent, { event_starts_on: "2026-05-20" });
  await asOwner(
    "update public.partners set event_starts_on='2027-05-20',version=version+1 where id=$1",
    [oldChoiceEvent],
  );
  await asOwner(
    "update public.partner_assistant_jobs set status='in_coda',draft_id=null where partner_id=$1",
    [oldChoiceEvent],
  );
  eq(await pending(), 2, "la scelta2026 senza bozza non nasconde la scheda2027");
  await bad(async () => audit(await auditPayload()), /partner_events_still_contactable/);
  await setStage(oldChoiceEvent, "contattato");
  const oldBrand = await fresh({ event: true });
  await replaceChoice(oldBrand, {
    contact_kind: "brand",
    request: "collab_capsule",
    event_starts_on: "2026-05-20",
  });
  await asOwner(
    "update public.partners set event_starts_on='2027-05-20',version=version+1 where id=$1",
    [oldBrand],
  );
  eq(
    await pending(),
    2,
    "la classificazione brand di una versione vecchia non nasconde l'evento aggiornato",
  );
  await asOwner(
    "update public.partner_assistant_jobs set status='in_coda',draft_id=null where partner_id=$1",
    [oldBrand],
  );
  eq(await pending(), 2, "anche senza bozza la classificazione precedente resta da verificare");
  await setStage(oldBrand, "contattato");
  await setStage(future, "contattato");
  eq(await pending(), 0);

  const old = await ready(nextCo++, { club: false });
  const op = randomUUID();
  const proofInput = await auditPayload();
  const proof = await audit(proofInput, founder, op);
  eq(proof.exhausted, true);
  eq((await audit(proofInput, founder, op)).replayed, true);
  await bad(
    () => audit({ ...proofInput, reason: proofInput.reason + " Modificato." }, founder, op),
    /partner_idempotency_conflict/,
  );
  eq(await fallback(), true);
  eq(await policy(old), false, "non riattiva le vecchie bozze");
  eq(await snapshot(old), null);
  eq((await programItem(old)).fallbackWindow, null, "il programma non sblocca la vecchia bozza");
  eq(await run("select private.partner_assistant_flow_share($1,true) v", [TODAY]), 6);
  eq(await run("select private.partner_assistant_flow_share($1,false) v", [TODAY]), 6);
  eq(
    await run("select private.partner_assistant_eligible($1) v", [old]),
    true,
    "si può rifare la ricerca, non spedire la vecchia bozza",
  );
  await bad(
    () =>
      asOwner("update private.partner_event_exhaustion_checks set reason=reason||' aggiornato'"),
    /partner_event_exhaustion_immutable/,
  );
  await bad(
    () => asOwner("delete from private.partner_event_exhaustion_checks"),
    /partner_event_exhaustion_immutable/,
  );

  const shop = await fresh({ cardEventStartsOn: "2026-05-20" });
  const club = await fresh({ club: true });
  now = `${TODAY}T07:30:00Z`;
  ok(await snapshot(shop));
  ok(await snapshot(club));
  const shopProgram = await programItem(shop);
  eq(shopProgram.eventStartsOn, null, "la data scheda passata non scade una proposta non evento");
  const clubProgram = await programItem(club);
  ok(shopProgram.fallbackWindow);
  ok(clubProgram.fallbackWindow);
  eq(Date.parse(shopProgram.fallbackWindow.start), Date.parse(`${TODAY}T07:00:00Z`));
  eq(Date.parse(shopProgram.fallbackWindow.end), Date.parse(proof.valid_until));
  eq(shopProgram.eventApproved, false, "fallback e approvazione evento sono distinti");
  eq(clubProgram.fallbackWindow, shopProgram.fallbackWindow);
  const previousBrand = await fresh();
  eq(await fallback(), true);
  const catalogBeforeUpdate = await catalog();
  await asOwner(
    "update public.partners set sections=array['eventi']::text[],event_starts_on='2027-05-20',version=version+1 where id=$1",
    [previousBrand],
  );
  await asOwner(
    "update public.partner_assistant_jobs set status='in_coda',draft_id=null where partner_id=$1",
    [previousBrand],
  );
  eq(await pending(), 1);
  ok(
    (await catalog()) !== catalogBeforeUpdate,
    "la vecchia classificazione non mantiene l'impronta vuota",
  );
  eq(await fallback(), false, "l'attestazione precedente viene invalidata dalla scheda aggiornata");
  eq(await snapshot(club), null);
  eq((await programItem(club)).fallbackWindow, null, "il programma recepisce il nuovo candidato");
  await setStage(previousBrand, "contattato");
  eq(await fallback("2026-11-25T09:00:00Z"), true);
  eq(await fallback("2026-11-26T09:00:00Z"), false);
  eq(
    await policy(shop, "2026-11-26T09:00:00Z"),
    false,
    "la scadenza vale al futuro istante dello slot",
  );
  eq(await snapshot(shop, "2026-11-26T09:00:00Z"), null);
  eq((await programItem(shop, "2026-11-26T09:00:00Z")).fallbackWindow, null);
  eq(await snapshot(shop, `${TODAY}T07:59:00Z`), null, "finestra locale conservata");
  await asOwner("update public.partners set version=version+1 where id=$1", [shop]);
  eq(await snapshot(shop), null, "contesto scheda cambiato");
  eq((await programItem(shop)).fallbackWindow, null, "la versione invalida anche il programma");
  await asOwner("update public.partners set version=version-1 where id=$1", [shop]);
  ok(await snapshot(shop));
  await asOwner("update public.memberships set active=false where user_id=$1", [founder]);
  eq(await fallback(), false, "la verifica appartiene a un founder ancora attivo");
  await asOwner("update public.memberships set active=true where user_id=$1", [founder]);
  ok(await snapshot(shop));

  const incoming = await fresh({ event: true });
  eq(await pending(), 1);
  eq(await fallback(), false);
  eq(await snapshot(club), null, "evento nuovo prima del fallback");
  await bad(async () => audit(await auditPayload()), /partner_events_still_contactable/);
  const eventDraft = await one(
    "select d.id,d.sha256,p.version from public.partner_assistant_jobs j join public.partners p on p.id=j.partner_id join public.partner_assistant_drafts d on d.id=j.draft_id where p.id=$1",
    [incoming],
  );
  await as(
    "authenticated",
    founder,
    () =>
      rpc("select public.approve_partner_event_first_draft($1,$2::jsonb) r", [
        randomUUID(),
        JSON.stringify({
          schema_version: 1,
          partner_id: incoming,
          draft_id: eventDraft.id,
          expected_partner_version: eventDraft.version,
          expected_sha256: eventDraft.sha256,
          official_sources: ["https://event.example.test/2027/exhibitors"],
        }),
      ]),
    { now },
  );
  ok(await snapshot(incoming), "l'evento rimane inviabile durante il fallback sospeso");
  eq((await programItem(incoming)).eventApproved, true);
  eq((await programItem(incoming)).fallbackWindow, null, "l'evento non usa la finestra fallback");
  await setStage(incoming, "contattato");
  eq(await pending(), 0);
  const outside = await fresh({ event: true, country: "Svizzera" });
  eq(await pending(), 0);
  eq(await snapshot(outside), null, "un evento extra UE non diventa una proposta non evento");
  await setStage(outside, "no");

  // Modifica di un contatto pertinente, anche manuale, richiede una nuova verifica.
  const held = await fresh({ event: true });
  await setActive(nextCo - 1, false);
  eq(await pending(), 0);
  eq(await fallback(), false, "cambia l'impronta del catalogo anche senza nuovo pronto");
  const second = await audit(await auditPayload());
  eq(second.exhausted, true);
  eq(await fallback(), true);
  eq(await snapshot(club), null, "una nuova attestazione richiede testi successivi");
  await asOwner("update public.partner_contacts set version=version+1 where partner_id=$1", [held]);
  eq(await fallback(), false, "recapito del catalogo cambiato");
  await audit(await auditPayload());
  const finalAt = new Date(new Date(now).getTime() + 60_000).toISOString();
  const freshShop = await fresh({ researchAt: finalAt });
  now = `${TODAY}T07:40:00Z`;
  ok(await snapshot(freshShop));
  await audit(await auditPayload({ exhausted: false }));
  eq(await fallback(), false);
  eq(await snapshot(freshShop), null, "revoca senza cambiare interruttori");
  eq((await programItem(freshShop)).fallbackWindow, null);

  const unknown = await fresh({ event: true });
  await replaceChoice(unknown, { event_starts_on: "" });
  eq(await pending(), 0, "data futura non annunciata: resta in verifica");
  eq((await approveEvent(unknown)).approved, true);
  eq(await run("select private.partner_event_first_approved($1) v", [draftIds.get(unknown)]), true);
  eq(await snapshot(unknown), null, "l'approvazione non inventa la data futura mancante");
  eq((await programItem(unknown)).eventApproved, true, "l'approvazione resta editoriale");
  eq((await programItem(unknown)).eventStartsOn, null);
  await asOwner(
    "update public.partners set event_starts_on='2027-05-20',version=version+1 where id=$1",
    [unknown],
  );
  eq(
    (await programItem(unknown)).eventStartsOn,
    "2027-05-20",
    "il programma usa la data scheda quando la scelta è vuota",
  );
  eq(
    (await programItem(unknown)).eventApproved,
    false,
    "la versione nuova richiede una nuova approvazione",
  );
  await setStage(unknown, "no");
  const taggedShop = await fresh({ event: true });
  await replaceChoice(taggedShop, { contact_kind: "negozio", request: "vendita_negozio" });
  eq(await pending(), 0, "il tag Eventi su un negozio non certifica una manifestazione");
  await audit(await auditPayload());
  const manual = await fresh({ event: true });
  await asOwner(
    `insert into public.partner_activities(operation_id,partner_id,partner_name,partner_co,kind,origin,body,created_by)
    select gen_random_uuid(),id,name,co,'nota','team','Candidatura gestita manualmente dal team sintetico.',$2 from public.partners where id=$1`,
    [manual, founder],
  );
  eq(await run("select private.partner_assistant_base_eligible($1) v", [manual]), false);
  eq(await pending(), 0, "la gestione manuale continua a escludere il contatto automatico");
  eq(await fallback(), false, "nuova scheda pertinente impone revisione dell'impronta");

  // Sei prime totali, libere dalla vecchia suddivisione rigida 3+3.
  await resetPlan();
  now = `${TODAY}T07:00:00Z`;
  await audit(await auditPayload());
  for (let i = 0; i < 8; i++) await fresh({ club: true });
  now = `${TODAY}T07:30:00Z`;
  await refresh();
  let rows = await slots();
  eq(rows.length, 6);
  ok(rows.every((x) => x.flow_template));
  eq(new Set(rows.map((x) => x.partner_id)).size, 6);
  ok(rows.every((x) => new Date(x.planned_at) >= new Date(`${TODAY}T08:00:00Z`)));
  ok(rows.every((x) => new Date(x.expires_at) <= new Date(`${TODAY}T14:58:30Z`)));
  const frozen = rows.map((x) => [x.id, new Date(x.planned_at).toISOString()]);
  now = `${TODAY}T08:05:00Z`;
  await fresh({ club: false });
  await refresh();
  eq(
    (await slots()).map((x) => [x.id, new Date(x.planned_at).toISOString()]),
    frozen.slice(1),
    "apertura già congelata: lo slot scaduto non è recuperato",
  );
  eq(
    await value("select status as v from private.partner_send_slots where id=$1", [frozen[0][0]]),
    "expired",
  );

  await resetPlan();
  now = `${TODAY}T07:00:00Z`;
  await audit(await auditPayload());
  for (let i = 0; i < 5; i++) {
    await fresh({ club: true });
    await fresh({ club: false });
  }
  now = `${TODAY}T07:30:00Z`;
  await refresh();
  rows = await slots();
  eq(rows.length, 6, "classi miste condividono sei, non dodici posti");
  ok(rows.some((x) => x.flow_template));
  ok(rows.some((x) => !x.flow_template));
  await refresh();
  eq(
    (await slots()).map((x) => x.id),
    rows.map((x) => x.id),
    "ricalcolo idempotente",
  );

  await resetPlan();
  now = `${TODAY}T07:00:00Z`;
  await audit(await auditPayload());
  await sent(2, { club: true });
  await sent(1, { club: false, sendStatus: "incerto" });
  for (let i = 0; i < 5; i++) {
    await fresh({ club: true });
    await fresh({ club: false });
  }
  now = `${TODAY}T07:30:00Z`;
  await refresh();
  rows = await slots();
  eq(await firstSent(), 3, "l'incerto occupa già un posto");
  eq(rows.length, 3, "tre posti residui complessivi");

  await resetPlan();
  now = `${TODAY}T07:00:00Z`;
  await audit(await auditPayload());
  for (let i = 0; i < 5; i++)
    await fresh({ club: true, tz: "Europe/London", country: "Regno Unito" });
  for (let i = 0; i < 5; i++)
    await fresh({ club: false, tz: "Europe/Berlin", country: "Germania" });
  now = `${TODAY}T07:30:00Z`;
  await refresh();
  rows = await slots();
  eq(rows.length, 6, "le due finestre UTC prenotano sulla stessa quota Roma");
  eq(new Set(rows.map((x) => x.window_id)).size, 2);
  ok(rows.some((x) => x.timezone === "Europe/London"));
  ok(rows.some((x) => x.timezone === "Europe/Berlin"));
  eq(new Set(rows.map((x) => new Date(x.quota_day).toISOString().slice(0, 10))), new Set([TODAY]));
  await refresh();
  eq((await slots()).length, 6, "le prenotazioni precedenti vengono contate una sola volta");

  eq(
    await value(
      "select pg_get_functiondef('private.partner_followup_reason(uuid,boolean)'::regprocedure) as v",
    ),
    followupBefore,
    "nessuna modifica alle regole dei solleciti",
  );
  eq(await run("select private.partner_assistant_first_limit($1) v", [TODAY]), 6);
  console.log(`PASS ${checks} controlli`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.close();
}
