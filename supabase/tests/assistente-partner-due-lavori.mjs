// test-db: pglite minimo 41
// Assistente Partner, due lavori d'invio (_assistente_partner_due_lavori.sql): il limite del giorno
// diviso a metà tra i club con il testo fisso e gli altri contatti (con 5: 3 agli altri e 2 ai club;
// con 10: 5 e 5), un lavoro con la sua metà già mandata che lascia i posti all'altro finché l'altro ha
// email pronte, e i posti liberi a chi ne ha se l'altro non ne ha. Migrazioni applicate in ordine su
// PGlite, l'ora dell'assistente fissata in ogni transazione. Solo dati sintetici (CO da 951, domini
// example.test), nessun accesso cloud.
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
const MODEL = "claude-opus-5-5";
const SIGNATURE = "Tommaso\nFounder, LuckyLap\nluckylap.com | Instagram @lucky.lap";

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
const flowSent = (template) =>
  value("select private.partner_assistant_flow_sent($1::date, $2) as v", [TODAY, template]);
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
        contact_kind: "club",
        language: "it",
        register: "voi",
        timezone: tz,
        event_starts_on: "",
        request: "merch_cobranding",
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
  for (const co of [951, 952, 961, 962]) await setActive(co, cos.includes(co));
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

  // 1. Permessi: le funzioni nuove a nessun ruolo client, la claim ancora solo a service_role.
  for (const [fn, roles] of [
    ["private.partner_assistant_flow_sent(date, boolean)", []],
    ["private.partner_assistant_flow_share(date, boolean)", []],
    ["private.claim_partner_assistant_send(uuid, integer, integer)", ["service_role"]],
    ["public.claim_partner_assistant_send(uuid, integer, integer)", ["service_role"]],
  ])
    for (const role of ["anon", "authenticated", "service_role"])
      eq(
        await value("select has_function_privilege($1, $2, 'execute') as v", [role, fn]),
        roles.includes(role),
        `${role} su ${fn}`,
      );
  eq(
    await value(
      "select prosecdef and proconfig @> array['search_path=\"\"'] as v from pg_proc where oid = 'private.claim_partner_assistant_send(uuid, integer, integer)'::regprocedure",
    ),
    true,
    "claim ancora security definer con search_path vuoto",
  );

  // 2. La metà del limite: senza invii veri il limite è 5, 2 ai club e 3 agli altri.
  eq([await share(true), await share(false)], [2, 3]);

  // La coda: due altri contatti in Italia (ricerca di ieri, prima nella coda) e due club, uno a
  // Berlino e uno a New York.
  await ready(951, { club: false });
  await ready(952, { club: false });
  await ready(961, { club: true, tz: "Europe/Berlin", country: "Germania" });
  await ready(962, { club: true, tz: "America/New_York", country: "Stati Uniti" });
  eq(
    (
      await db.query(
        `select p.co from private.partner_assistant_send_order() o join public.partners p on p.id = o.partner_id
         order by o.rank`,
      )
    ).rows.map((r) => r.co),
    [951, 952, 961, 962],
    "l'ordine della coda d'invio non cambia",
  );

  // 3. Nessun invio oggi: parte il primo della coda.
  eq(await candidateAt(MORNING), 951);

  // 4. Gli altri hanno già le loro 3: tocca al club di Berlino, anche se gli altri vengono prima.
  await sent(3, { club: false });
  eq([await flowSent(false), await flowSent(true)], [3, 0]);
  eq(await candidateAt(MORNING), 961);
  // Con un solo club pronto a New York, la mattina di Roma non parte niente: i posti dei club
  // restano ai club, che partono quando si apre la loro finestra.
  await only(951, 952, 962);
  eq(await candidateAt(MORNING), "fuori_finestra");
  eq(await candidateAt(NEW_YORK_MORNING), 962);
  // Senza club pronti gli altri usano anche i posti dei club.
  await only(951, 952);
  eq(await candidateAt(MORNING), 951);
  // 3 + 2: il limite del giorno, per tutti.
  await only(951, 952, 961, 962);
  await sent(2, { club: true });
  eq([await flowSent(false), await flowSent(true)], [3, 2]);
  eq(await claimAt(MORNING), { status: "idle", reason: "limite" });

  // 5. I club hanno già i loro 2: tocca agli altri; senza altri pronti, i club usano i posti liberi.
  await resetSends();
  await sent(2, { club: true });
  eq(await candidateAt(MORNING), 951);
  await only(961, 962);
  eq(await candidateAt(MORNING), 961);
  await only(951, 952, 961, 962);
  // 2 + 2: gli altri hanno ancora un posto.
  await sent(2, { club: false });
  eq(await candidateAt(MORNING), 951);
  // 2 + 3: il limite del giorno.
  await sent(1, { club: false });
  eq(await candidateAt(MORNING), "limite");
  eq([await flowSent(false), await flowSent(true)], [3, 2]);

  // 6. Un altro contatto con la ricerca scaduta: esce dalla coda nello stesso giro, e con i club al
  // completo il giro dice «limite»; al giro dopo gli altri non hanno più email pronte e i club
  // usano i posti liberi.
  await resetSends();
  await sent(2, { club: true });
  await only(961, 962);
  await ready(953, { club: false, researchAt: "2026-10-01T06:00:00Z" });
  eq(await candidateAt(MORNING), "limite");
  eq(
    await value(
      "select status || '/' || step as v from public.partner_assistant_jobs where partner_id = $1",
      [ids.get(953)],
    ),
    "in_coda/ricerca",
  );
  eq(await candidateAt(MORNING), 961);

  // 7. Un messaggio senza bozza (recapito cancellato) conta per il lavoro della scheda.
  await resetSends();
  const [erased] = await sent(1, { club: true });
  await asOwner("select private.partner_assistant_erase($1)", [erased]);
  eq(
    await value(
      "select draft_id is null as v from public.partner_assistant_messages where partner_id = $1",
      [erased],
    ),
    true,
  );
  eq([await flowSent(true), await flowSent(false)], [1, 0]);

  // 8. Dopo la prima settimana il limite della pagina: 10 dà 5 e 5, 7 dà 3 ai club e 4 agli altri.
  await resetSends();
  await sent(1, { club: false, day: "2026-10-30" });
  await asOwner("update private.partner_assistant_config set daily_first_limit = 10");
  eq([await share(true), await share(false)], [5, 5]);
  await asOwner("update private.partner_assistant_config set daily_first_limit = 7");
  eq([await share(true), await share(false)], [3, 4]);
  await asOwner("update private.partner_assistant_config set daily_first_limit = 10");
  await only(951, 952, 961, 962);
  await sent(4, { club: false });
  eq(await candidateAt(MORNING), 951, "4 su 5: gli altri hanno ancora un posto");
  await sent(1, { club: false });
  eq(await candidateAt(MORNING), 961, "5 su 5: tocca ai club");
  await sent(5, { club: true });
  eq(await claimAt(MORNING), { status: "idle", reason: "limite" }, "10: il limite del giorno");

  // 9. In «Prepara» il giro d'invio non fa niente, come prima.
  await asOwner("update private.partner_assistant_config set mode = 'prepara'");
  eq(await claimAt(MORNING), { status: "idle", reason: "prepara" });
  ok(checks > 0);

  console.log(`PASS ${checks} controlli`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.close();
}
