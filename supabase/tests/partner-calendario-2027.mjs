// test-db: pglite minimo 152
// Calendario 2027: fonti ufficiali, guardie comuni e quarto sollecito sintetico di febbraio.
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

// Un contatto con la bozza pronta: un club con la nota di ricerca del testo fisso, oppure un altro
// contatto (collab) con la ricerca di Claude. La ricerca degli altri è più vecchia: nella coda d'invio
// vengono prima dei club.
const ids = new Map();
const draftIds = new Map();
async function ready(co, { club, tz = "Europe/Rome", country = "Italia", researchAt } = {}) {
  const partnerId = randomUUID();
  ids.set(co, partnerId);
  await asOwner(
    `insert into public.partners(id, co, name, origin, stage, created_by, sections, priority,
       contact_month, country)
     values ($1, $2, $3, 'team', 'da_contattare', $4, $5::text[], 'media', date '2026-11-01', $6)`,
    [partnerId, co, `Club Sintetico ${co}`, founder, club ? ["club"] : ["collab"], country],
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
        request: club ? "merch_cobranding" : "collab_capsule",
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

// Prime email vere già partite quel giorno, copiate in «Posta inviata», a contatti nuovi (CO da 2001).
let nextCo = 2001;
async function sent(n, { club, day = TODAY }) {
  const partners = [];
  for (let i = 0; i < n; i++) {
    const co = nextCo++;
    const partner = await ready(co, { club });
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
         operation_id, created_by)
       values ($1, $2, 'primo', 'invio', 'inviato', $3, $4, $5, $6, $7, $8, 1, gen_random_uuid(), $9::date,
         $9::date + time '08:40', $9::date + time '08:41', gen_random_uuid(), $10)`,
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
  let now = MORNING;
  const service = (fn, args = []) =>
    as(
      "service_role",
      null,
      () => value(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as v`, args),
      { now },
    );
  const team = (fn, payload, op = randomUUID()) =>
    as(
      "authenticated",
      founder,
      () => value(`select public.${fn}($1,$2::jsonb) as v`, [op, JSON.stringify(payload)]),
      { now },
    );
  const release = () =>
    asOwner(
      "update private.partner_assistant_mail_state set lease_token=null,lease_expires_at=null,next_send_after=null,backoff_until=null,stop_reason=null,day_stopped_on=null",
    );
  const conv = (id) =>
    value("select to_jsonb(f) as v from public.partner_assistant_followups f where id=$1", [id]);
  const claim = () => service("claim_partner_followup", [WORKER, 300]);
  const wake = (id) =>
    asOwner(
      "update public.partner_assistant_followups set next_check_at=$2::timestamptz where id=$1",
      [id, now],
    );
  const check = (c, result = "clear", reason = null) =>
    service("record_partner_followup_check", [
      c.lease_token,
      c.candidate.id,
      c.candidate.version,
      JSON.stringify({
        result,
        reason,
        checked_at: now,
        proof_sha256: sha(result + now),
        folder_count: 3,
        message_count: 0,
      }),
    ]);
  const body =
    "Buongiorno,\n\nRiprendo la proposta della prima email per condividere un aggiornamento verificato sul vostro programma. La nuova attività offre un'occasione concreta per una piccola collezione dedicata, utile a dare continuità al rapporto con i soci e a lasciare un ricordo curato dell'incontro. Possiamo valutare insieme una proposta semplice, adatta alle vostre esigenze. Vi interessa approfondire questa possibilità?\n\nUn saluto,";
  const signature = "Nome Sintetico\nRuolo sintetico\n+39 000 000 0000\nhttps://brand.example.test";
  const save = async (id) => {
    const f = await conv(id);
    const snap = await one(
      `select p.version partner_version,k.version contact_version,
      (select max(version) from public.partner_assistant_rules) rules_version,d.language,m.subject
      from public.partners p join public.partner_contacts k on k.id=$2
      join public.partner_assistant_messages m on m.id=$3 join public.partner_assistant_drafts d on d.id=m.draft_id where p.id=$1`,
      [f.partner_id, f.contact_id, f.first_message_id],
    );
    return team("save_partner_followup_draft", {
      schema_version: 1,
      conversation_id: id,
      expected_version: f.version,
      number: f.followups_sent + 1,
      partner_version: snap.partner_version,
      contact_version: snap.contact_version,
      address_sha256: f.address_sha256,
      rules_version: snap.rules_version,
      language: snap.language,
      subject: "Re: " + snap.subject,
      body,
      signature,
      research_text: "Fatto nuovo verificato presso una fonte sintetica ufficiale.",
      sources: ["https://club.example.test/novita"],
    });
  };
  const prepare = async (c, proof) => {
    const d = c.candidate.draft;
    const messageId = `<${randomUUID()}@brand.example.test>`;
    const optOut = "Se preferite non ricevere altre email, scrivetemelo e non vi ricontattero.";
    const text = d.body + "\n\n" + d.signature + "\n\n" + optOut;
    const first = c.candidate.message_ids[0];
    const raw = `From: mittente@brand.example.test\r\nTo: ${c.candidate.address}\r\nSubject: Esempio\r\nMessage-ID: ${messageId}\r\nIn-Reply-To: ${first}\r\nReferences: ${first}\r\n\r\nContenuto sintetico ASCII.`;
    return service("prepare_partner_followup_send", [
      randomUUID(),
      c.lease_token,
      c.candidate.id,
      JSON.stringify({
        expected_version: c.candidate.version,
        draft_id: d.draft_id,
        number: d.number,
        to_address: c.candidate.address,
        subject: d.subject,
        text,
        opt_out: optOut,
        raw,
        message_id: messageId,
        proof_id: proof.proof_id,
      }),
    ]);
  };
  const finish = (c, m, outcome = "inviato", op = randomUUID()) =>
    service("finish_partner_followup_send", [
      c.lease_token,
      op,
      JSON.stringify({
        message_row_id: m.message_row_id,
        outcome,
        smtp_code: outcome === "inviato" ? 250 : null,
        enhanced_code: null,
        spam: false,
        reason: null,
      }),
    ]);
  const complete = async (c) => {
    const pr = await check(c);
    eq(pr.status, "clear");
    const m = await prepare(c, pr);
    eq(m.status, "pronto", JSON.stringify(m));
    const second = await check(c);
    eq(second.status, "clear");
    eq(
      (
        await service("start_partner_followup_send", [
          c.lease_token,
          m.message_row_id,
          second.proof_id,
        ])
      ).status,
      "in_invio",
    );
    const finishOp = randomUUID();
    eq((await finish(c, m, "inviato", finishOp)).status, "done");
    return { ...m, finishOp };
  };

  // Stato precedente: il limite blocca anche un lunedì ordinario di febbraio.
  const beforeHolidays = await value(
    "select jsonb_agg(to_jsonb(h) order by country_code,day) v from private.partner_assistant_holidays h",
  );
  const beforeAliases = await value(
    "select jsonb_agg(to_jsonb(c) order by alias) v from private.partner_assistant_countries c",
  );
  const beforeAcl = await value(
    "select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'volatile',provolatile,'definer',prosecdef) v from pg_proc where oid='private.partner_assistant_holidays_until()'::regprocedure",
  );
  const open = (zone, country, at, margin = "90 seconds") =>
    value("select private.partner_assistant_window_open($1,$2,$3::timestamptz,$4::interval) v", [
      zone,
      country,
      at,
      margin,
    ]);
  eq(await open("Europe/Rome", "Italia", "2027-02-08T09:00:00Z"), false);
  eq(await value("select private.partner_assistant_holidays_until()::text v"), "2027-01-31");
  await db.exec(migration("_partner_calendario_2027.sql"));
  eq(await value("select private.partner_assistant_holidays_until()::text v"), "2027-12-31");
  eq(
    await value(
      "select jsonb_agg(to_jsonb(h) order by country_code,day) v from private.partner_assistant_holidays h where day<'2027-01-01'",
    ),
    beforeHolidays,
    "Storico 2026 identico",
  );
  eq(
    await value(
      "select jsonb_agg(to_jsonb(c) order by alias) v from private.partner_assistant_countries c",
    ),
    beforeAliases,
    "Alias invariati",
  );
  eq(await value("select count(*)::int v from private.partner_assistant_countries"), 39);
  eq(
    await value(
      "select count(distinct country_code)::int v from private.partner_assistant_countries",
    ),
    9,
  );
  eq(
    await value(
      "select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'volatile',provolatile,'definer',prosecdef) v from pg_proc where oid='private.partner_assistant_holidays_until()'::regprocedure",
    ),
    beforeAcl,
    "Identita e ACL funzione conservate",
  );
  const expected = {
    IT: ["03-29", "04-25", "05-01", "06-02", "08-15", "10-04", "11-01", "12-08"],
    GB: ["03-26", "03-29", "05-03", "05-31", "08-30", "12-27", "12-28"],
    DE: ["03-26", "03-29", "05-01", "05-06", "05-17", "10-03"],
    AT: ["03-29", "05-01", "05-06", "05-17", "05-27", "08-15", "10-26", "11-01", "12-08"],
    CH: ["05-06", "08-01"],
    FR: ["03-29", "05-01", "05-06", "05-08", "05-17", "07-14", "08-15", "11-01", "11-11"],
    ES: ["03-26", "05-01", "08-15", "10-12", "11-01", "12-06", "12-08"],
    BE: ["03-29", "05-01", "05-06", "05-17", "07-21", "08-15", "11-01", "11-11"],
    NL: ["03-26", "03-29", "04-27", "05-05", "05-06", "05-17"],
  };
  const countries = {
    IT: ["Europe/Rome", "Italia"],
    GB: ["Europe/London", "Regno Unito"],
    DE: ["Europe/Berlin", "Germania"],
    AT: ["Europe/Vienna", "Austria"],
    CH: ["Europe/Zurich", "Svizzera"],
    FR: ["Europe/Paris", "Francia"],
    ES: ["Europe/Madrid", "Spagna"],
    BE: ["Europe/Brussels", "Belgio"],
    NL: ["Europe/Amsterdam", "Paesi Bassi"],
  };
  for (const [code, dates] of Object.entries(expected)) {
    eq(
      await value(
        "select array_agg(to_char(day,'MM-DD') order by day) v from private.partner_assistant_holidays where country_code=$1 and day between date '2027-01-01' and date '2027-12-31'",
        [code],
      ),
      dates,
      code + " date verificate",
    );
    const [zone, country] = countries[code];
    for (const day of dates) {
      const at = await value("select ($1::date+time '10:00') at time zone $2 as v", [
        "2027-" + day,
        zone,
      ]);
      eq(await open(zone, country, at), false, code + " " + day + " chiuso");
    }
    eq(
      await open(zone, country, "2027-02-08T10:00:00Z", "0"),
      code === "GB",
      code + " fuso locale: ore11 chiuse sul continente",
    );
    eq(await open(zone, country, "2028-01-10T09:00:00Z"), false, code + " oltre copertura");
  }
  eq(
    await value(
      "select count(*)::int v from private.partner_assistant_holidays where day>='2027-01-01'",
    ),
    62,
  );
  eq(await value("select count(*)::int v from private.partner_assistant_holidays"), 73);
  eq(
    await open("Europe/Rome", "Italia", "2027-02-08T08:30:00Z"),
    true,
    "Nuova copertura a febbraio",
  );
  eq(await open("Europe/Rome", "Italia", "2027-02-08T08:29:59Z"), false);
  eq(await open("Europe/Rome", "Italia", "2027-02-08T09:58:29Z"), true, "Margine 90s entro11");
  eq(await open("Europe/Rome", "Italia", "2027-02-08T09:58:30Z"), false, "Margine arriva alle11");
  eq(await open("Europe/Rome", "Italia", "2027-02-07T09:00:00Z"), false, "Domenica");
  eq(await open("Europe/Rome", "Italia", "2027-02-06T09:00:00Z"), false, "Sabato");
  for (const at of [
    "2026-12-21T09:00:00Z",
    "2027-01-07T09:00:00Z",
    "2027-12-21T09:00:00Z",
    "2027-12-27T09:00:00Z",
    "2028-01-07T09:00:00Z",
  ])
    eq(await open("Europe/Rome", "Italia", at), false, "Blackout invariato");
  eq(await open("Europe/Rome", "Italia", "2027-01-08T09:00:00Z"), true);
  eq(
    await open("Europe/Rome", "Narnia", "2028-01-10T09:00:00Z"),
    false,
    "Hardstop anche paesi sconosciuti",
  );
  eq(
    await value(
      "select private.partner_assistant_next_window(timestamptz '2027-12-20T10:30:00Z') v",
    ),
    null,
  );
  eq(
    await open("Europe/London", "Regno Unito", "2027-03-30T08:30:00Z"),
    true,
    "Ora legale britannica",
  );
  eq(await open("Europe/Rome", "Italia", "2027-03-30T07:30:00Z"), true, "Ora legale continentale");
  for (const code of ["DE", "BE"])
    eq(
      await open(...countries[code], "2027-05-03T08:00:00Z"),
      true,
      "Nessun observedMonday inventato " + code,
    );
  for (const code of ["AT", "ES"])
    eq(
      await open(...countries[code], "2027-08-16T08:00:00Z"),
      true,
      "Nessun recupero nazionale16agosto " + code,
    );
  eq(
    await open("Europe/Zurich", "Svizzera", "2027-08-02T08:00:00Z"),
    true,
    "Nessun recupero svizzero comune2agosto",
  );
  eq(
    await value(
      "select exists(select 1 from private.partner_assistant_holidays where country_code='GB' and day='2027-12-27') v",
    ),
    true,
  );
  eq(
    await value(
      "select exists(select 1 from private.partner_assistant_holidays where country_code='GB' and day='2027-12-28') v",
    ),
    true,
  );
  eq(
    await open("Europe/London", "Regno Unito", "2027-12-27T10:00:00Z"),
    false,
    "ObservedChristmas e blackout",
  );
  eq(
    await open("Europe/London", "Regno Unito", "2027-12-28T10:00:00Z"),
    false,
    "ObservedBoxingDay e blackout",
  );
  eq(
    await open("Europe/Amsterdam", "Paesi Bassi", "2027-03-26T09:00:00Z"),
    false,
    "GoodFridayNL corretto",
  );
  eq(
    await value(
      "select jsonb_array_length(private.partner_email_windows(date '2027-02-08',1,'Europe/Rome','Italia')) v",
    ),
    1,
    "Previsioni usano lo stesso calendario",
  );
  eq(
    await value(
      "select private.partner_email_windows(date '2028-01-10',1,'Europe/Rome','Italia') v",
    ),
    [],
  );
  for (const role of ["anon", "authenticated", "service_role"])
    eq(
      await value(
        "select has_function_privilege($1,'private.partner_assistant_holidays_until()','execute') v",
        [role],
      ),
      false,
      "Nessun nuovo grant",
    );

  // Quarto sollecito da prima email sintetica9novembre: scade7febbraio, parte solo dal lunedi8.
  now = "2027-02-08T09:00:00Z";
  const [partner] = await sent(1, { club: true, day: "2026-11-09" });
  await asOwner("update public.partners set stage='contattato' where id=$1", [partner]);
  const discovered = await claim();
  eq(discovered.status, "claimed");
  await release();
  await asOwner(
    "update public.partner_assistant_followups set followups_sent=3,last_sent_at=timestamptz '2027-01-08T09:00:00Z',next_due_on=date '2027-02-07',next_check_at=$2 where id=$1",
    [discovered.candidate.id, now],
  );
  eq(await value("select (date '2026-11-09'+90)::text v"), "2027-02-07");
  const saved = await save(discovered.candidate.id);
  eq(saved.number, 4);
  await asOwner("update private.partner_assistant_config set daily_first_limit=6");
  // Le sei prime del giorno hanno esaurito il loro 3+3; il FU ha sei posti separati.
  await sent(3, { club: true, day: "2027-02-08" });
  await sent(3, { club: false, day: "2027-02-08" });
  eq(await value("select private.partner_assistant_first_sent(date '2027-02-08') v"), 6);
  eq(await flowSent(true, "2027-02-08"), 3);
  eq(await flowSent(false, "2027-02-08"), 3);
  eq(await value("select private.partner_followup_sent(date '2027-02-08') v"), 0);
  await team("set_partner_followup_mode", {
    schema_version: 1,
    expected_version: 1,
    mode: "invio",
  });
  const candidate = await claim();
  eq(candidate.candidate.draft.number, 4);
  eq(
    candidate.candidate.send_allowed,
    true,
    "90giorni e sei prime gia inviate non bloccano la quota FU separata",
  );
  const proof = await check(candidate);
  eq(proof.status, "clear");
  const pending = await prepare(candidate, proof);
  eq(pending.status, "pronto");
  const second = await check(candidate);
  eq(second.status, "clear");
  eq(
    (
      await service("start_partner_followup_send", [
        candidate.lease_token,
        pending.message_row_id,
        second.proof_id,
      ])
    ).status,
    "in_invio",
  );
  eq(
    await value("select send_day::text v from public.partner_assistant_messages where id=$1", [
      pending.message_row_id,
    ]),
    "2027-02-08",
  );
  eq(await value("select private.partner_assistant_first_sent(date '2027-02-08') v"), 6);
  eq(await value("select private.partner_followup_sent(date '2027-02-08') v"), 1);
  eq(await flowSent(true, "2027-02-08"), 3);
  eq(await flowSent(false, "2027-02-08"), 3);
  await finish(candidate, pending);
  eq((await conv(candidate.candidate.id)).status, "complete");
  eq((await conv(candidate.candidate.id)).followups_sent, 4);
  // Idempotenza della sola migrazione additiva: nessun raddoppio e storico ancora identico.
  await db.exec(migration("_partner_calendario_2027.sql"));
  eq(await value("select count(*)::int v from private.partner_assistant_holidays"), 73);
  console.log(
    `PASS ${checks} calendario Partner2027 checks; nove paesi, dati sintetici, nessuna posta.`,
  );
} finally {
  await db.close();
}
