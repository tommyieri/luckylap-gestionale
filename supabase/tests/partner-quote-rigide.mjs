// test-db: pglite minimo 56
// Quote rigide: limite 6, tetto 3 per gruppo anche con altra coda vuota o fuori finestra.
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

async function as(role, sub, fn, { now } = {}) {
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

  // CREATE OR REPLACE deve conservare ACL, configurazione e dati già presenti.
  const definition = () =>
    one(
      `select prosecdef,proconfig,proacl from pg_proc
     where oid='private.claim_partner_assistant_send(uuid,integer,integer)'::regprocedure`,
    );
  const config = () => value("select to_jsonb(c) as v from private.partner_assistant_config c");
  const beforeDefinition = await definition();
  const beforeConfig = await config();
  await db.exec(migration("_partner_quote_rigide.sql"));
  eq(await definition(), beforeDefinition, "ACL e security definer conservati");
  eq(await config(), beforeConfig, "la migrazione non cambia impostazioni");
  for (const [fn, roles] of [
    ["private.partner_assistant_flow_sent(date,boolean)", []],
    ["private.partner_assistant_flow_share(date,boolean)", []],
    ["private.claim_partner_assistant_send(uuid,integer,integer)", ["service_role"]],
    ["public.claim_partner_assistant_send(uuid,integer,integer)", ["service_role"]],
  ]) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      eq(
        await value("select has_function_privilege($1,$2,'execute') as v", [role, fn]),
        roles.includes(role),
        `${role} su ${fn}`,
      );
    }
  }
  eq(beforeDefinition.prosecdef, true);
  eq(beforeDefinition.proconfig, ['search_path=""']);

  // I primi sette giorni conservano 5 totali, divisi 2/3.
  eq([await share(true), await share(false)], [2, 3]);
  // Un invio storico sintetico porta l'orologio oltre il periodo iniziale.
  await sent(1, { club: false, day: "2026-10-30" });
  await asOwner("update private.partner_assistant_config set daily_first_limit=6");
  eq(await value("select private.partner_assistant_first_limit($1::date) as v", [TODAY]), 6);
  eq([await share(true), await share(false)], [3, 3]);
  await asOwner("update private.partner_assistant_config set daily_first_limit=7");
  eq([await share(true), await share(false)], [3, 4], "limite dispari conserva la ripartizione");
  await asOwner("update private.partner_assistant_config set daily_first_limit=6");

  await ready(951, { club: false });
  await ready(952, { club: false });
  await ready(961, { club: true, tz: "Europe/Berlin", country: "Germania" });
  await ready(962, { club: true, tz: "America/New_York", country: "Stati Uniti" });
  const expectedOrder = [951, 952, 961, 962];
  eq(
    (
      await db.query(`select p.co from private.partner_assistant_send_order() o
    join public.partners p on p.id=o.partner_id order by o.rank`)
    ).rows.map((x) => x.co),
    expectedOrder,
  );
  eq([await flowSent(true), await flowSent(false)], [0, 0]);
  eq(await candidateAt(MORNING), 951, "nessun invio: ordine esistente");

  // Tre Altri: il quarto resta fermo anche senza Club disponibili.
  await sent(3, { club: false });
  eq([await flowSent(true), await flowSent(false)], [0, 3]);
  await only(951, 952);
  eq(await candidateAt(MORNING), "limite", "quarta email Altri bloccata con coda Club vuota");
  eq(await candidateAt(NEW_YORK_MORNING), "limite", "nessun prestito dei tre posti Club");
  eq(await flowSent(false), 3, "claim non incrementa i contatori");
  await only(951, 952, 961, 962);
  eq(await candidateAt(MORNING), 961, "Club conserva i suoi tre posti");
  await only(951, 952, 962);
  eq(await candidateAt(MORNING), "fuori_finestra", "quota Club riservata fuori finestra");
  eq(await candidateAt(NEW_YORK_MORNING), 962, "Club parte nella propria finestra");
  await sent(3, { club: true });
  eq([await flowSent(true), await flowSent(false)], [3, 3]);
  eq(
    await claimAt(MORNING),
    { status: "idle", reason: "limite" },
    "tre piu tre: tetto complessivo",
  );

  // Anche se oggi erano già partiti quattro Altri, il cambio impedisce il quinto.
  await resetSends();
  await sent(1, { club: false, day: "2026-10-30" });
  await sent(4, { club: false });
  await only(951, 952);
  eq(await candidateAt(MORNING), "limite", "quinto Altri bloccato dopo abbassamento");
  await only(951, 952, 961, 962);
  eq(await candidateAt(MORNING), 961, "restano i posti Club entro il totale sei");

  // Simmetria: tre Club non diventano quattro o sei quando gli Altri sono vuoti.
  await resetSends();
  await sent(1, { club: false, day: "2026-10-30" });
  await sent(3, { club: true });
  await only(961, 962);
  eq(await candidateAt(MORNING), "limite", "quarto Club bloccato con coda Altri vuota");
  eq(await candidateAt(NEW_YORK_MORNING), "limite", "nessun prestito dei tre posti Altri");
  await only(951, 952, 961, 962);
  eq(await candidateAt(MORNING), 951, "Altri conserva i propri posti");
  await sent(3, { club: false });
  eq(await candidateAt(MORNING), "limite");
  eq(await value("select private.partner_assistant_first_sent($1::date) as v", [TODAY]), 6);

  // Il conteggio riparte dal giorno di Roma successivo, senza toccare i messaggi storici.
  const tomorrow = "2026-11-11";
  eq([await flowSent(true, tomorrow), await flowSent(false, tomorrow)], [0, 0]);
  eq([await share(true, tomorrow), await share(false, tomorrow)], [3, 3]);
  eq(await candidateAt(`${tomorrow}T09:00:00Z`), 951, "nuovo giorno: Altri riparte");
  await only(961, 962);
  eq(await candidateAt(`${tomorrow}T09:00:00Z`), 961, "nuovo giorno: Club riparte");
  eq(
    [await flowSent(true), await flowSent(false)],
    [3, 3],
    "gli invii del giorno prima restano registrati",
  );

  // Le 20 bozze Club pronte sono scorte per più giorni, non invii già effettuati.
  await resetSends();
  await sent(1, { club: false, day: "2026-10-30" });
  const clubQueue = [961, 962];
  for (let co = 970; co < 988; co++) {
    await ready(co, { club: true });
    clubQueue.push(co);
  }
  await only(...clubQueue);
  const readyClubCount = () =>
    value(`select count(*)::int as v
    from private.partner_assistant_send_order() o
    join public.partner_assistant_drafts d on d.id=o.draft_id
    where private.partner_assistant_is_template(d.research_note_id)`);
  eq(await readyClubCount(), 20);
  eq([await flowSent(true), await flowSent(false)], [0, 0]);
  eq(await candidateAt(MORNING), 961, "venti pronte non esauriscono la quota");
  await sent(3, { club: true });
  eq(await candidateAt(MORNING), "limite", "venti pronte non autorizzano il quarto invio");
  eq(await readyClubCount(), 20, "la quota conserva le bozze per domani");
  eq(await candidateAt(`${tomorrow}T09:00:00Z`), 961);

  // Una riga non valida conserva il percorso di ritorno in ricerca e non libera quote altrui.
  await ready(953, { club: false, researchAt: "2026-10-01T06:00:00Z" });
  await only(953, ...clubQueue);
  eq(await candidateAt(MORNING), "limite");
  eq(
    await value(
      "select status||'/'||step as v from public.partner_assistant_jobs where partner_id=$1",
      [ids.get(953)],
    ),
    "in_coda/ricerca",
  );
  eq(await candidateAt(MORNING), "limite", "Club pieno anche dopo rimozione Altri scaduto");

  await asOwner("update private.partner_assistant_config set mode='prepara'");
  eq(await claimAt(MORNING), { status: "idle", reason: "prepara" });
  ok(checks >= 55);
  console.log(`PASS ${checks} controlli`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.close();
}
