// test-db: pglite minimo 96
// Piano effettivo: quote, snapshot, finestre locali e scadenze senza recuperi a raffica.
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
const firstSent = (day = TODAY) =>
  value("select private.partner_assistant_first_sent($1::date) as v", [day]);
const followupSent = (day = TODAY) =>
  value("select private.partner_followup_sent($1::date) as v", [day]);

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
  let now = "2026-11-10T07:00:00Z";
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

  await asOwner("update private.partner_assistant_config set daily_first_limit=6");
  await asOwner("update private.partner_followup_config set mode='invio'");
  for (let i = 0; i < 6; i++) {
    const [p] = await sent(1, { club: i < 3, day: "2026-10-20" });
    await asOwner("update public.partners set stage='contattato' where id=$1", [p]);
  }
  await as("postgres", null, () => db.exec("select private.refresh_partner_followups()"), { now });
  const fs = (
    await db.query("select id from public.partner_assistant_followups order by partner_id")
  ).rows;
  for (const f of fs) await save(f.id);
  for (let i = 0; i < 6; i++)
    await ready(100 + i, { club: i < 3, tz: i % 2 ? "Europe/Paris" : "Europe/Rome" });
  const refresh = () =>
    as("postgres", null, () => db.exec("select private.refresh_partner_send_plan()"), { now });
  const slots = () =>
    db
      .query(
        "select * from private.partner_send_slots where status='scheduled' and quota_day='2026-11-10' order by planned_at",
      )
      .then((r) => r.rows);
  await refresh();
  let rows = await slots();
  eq(rows.length, 12);
  eq(rows.filter((x) => x.kind === "primo" && x.flow_template).length, 3);
  eq(rows.filter((x) => x.kind === "primo" && !x.flow_template).length, 3);
  eq(rows.filter((x) => x.kind === "sollecito").length, 6);
  eq(new Set(rows.map((x) => x.window_id)).size, 1, "Roma e Parigi condividono una sola griglia");
  eq(new Date(rows[0].planned_at).toISOString(), "2026-11-10T08:00:00.000Z");
  eq(new Date(rows.at(-1).planned_at).toISOString(), "2026-11-10T14:55:00.000Z");
  const original = rows.map((x) => [x.id, new Date(x.planned_at).toISOString()]);
  await refresh();
  eq(
    (await slots()).map((x) => [x.id, new Date(x.planned_at).toISOString()]),
    original,
    "un refresh identico preserva id e orari",
  );
  now = "2026-11-10T08:06:00Z";
  await refresh();
  rows = await slots();
  eq(rows.length, 11, "il primo slot scaduto non viene recuperato");
  eq(
    rows.map((x) => [x.id, new Date(x.planned_at).toISOString()]),
    original.slice(1),
    "dopo apertura gli slot futuri restano fissi",
  );
  eq(
    await value("select status as v from private.partner_send_slots where id=$1", [original[0][0]]),
    "expired",
  );
  const ui = await as(
    "authenticated",
    founder,
    () => value("select public.read_partner_send_plan($1::date) as v", [TODAY]),
    { now },
  );
  eq(ui.slots.length, 12);
  eq(Object.keys(ui).sort(), ["day", "generated_at", "mode", "slots"]);
  ok(ui.slots.every((x) => !("address" in x) && !("raw" in x) && !("body" in x)));
  for (const role of ["anon", "authenticated", "service_role"]) {
    eq(
      await value("select has_table_privilege($1,'private.partner_send_slots','select') as v", [
        role,
      ]),
      false,
    );
    eq(
      await value(
        "select has_function_privilege($1,'public.read_partner_send_plan(date)','execute') as v",
        [role],
      ),
      role === "authenticated",
    );
  }
  // Uno slot FU dovuto deve prevalere sul timer di osservazione, anche con prime future.
  let dueFu = rows.find((x) => x.kind === "sollecito");
  now = new Date(new Date(dueFu.planned_at).getTime() + 1000).toISOString();
  await asOwner(
    "update public.partner_assistant_followups set next_check_at=$1::timestamptz+interval '2 hours'",
    [now],
  );
  const firstIdle = await service("claim_partner_assistant_send", [WORKER, 300, 0]);
  eq(firstIdle.status, "idle");
  let claimed = await claim();
  eq(claimed.status, "claimed");
  eq(claimed.candidate.partner_id, dueFu.partner_id);
  ok(typeof claimed.candidate.send_not_after === "string");
  const sentFu = await complete(claimed);
  eq(
    await value("select status as v from private.partner_send_slots where message_row_id=$1", [
      sentFu.message_row_id,
    ]),
    "sent",
  );
  eq(
    await value(
      "select next_send_after=$1::timestamptz+interval '2 minutes' as v from private.partner_assistant_mail_state",
      [now],
    ),
    true,
  );
  eq(await followupSent(), 1);
  eq(await firstSent(), 0);
  await release();

  const resetPlan = async () => {
    await release();
    await resetSends();
    await only();
    await asOwner(
      "delete from private.partner_send_slots;delete from private.partner_send_windows",
    );
  };
  // Pianificazione tardiva: nessun target passato e nessuna griglia da dodici posti fittizi.
  await resetPlan();
  now = "2026-11-10T09:30:00Z";
  for (let i = 0; i < 3; i++) await ready(nextCo++, { club: false });
  await refresh();
  rows = await slots();
  eq(rows.length, 3);
  eq(new Date(rows[0].planned_at).toISOString(), "2026-11-10T09:32:00.000Z");
  eq(new Date(rows.at(-1).planned_at).toISOString(), "2026-11-10T14:55:00.000Z");
  eq(new Date(rows[0].expires_at).getTime() - new Date(rows[0].planned_at).getTime(), 300000);
  eq(new Date(rows.at(-1).expires_at).toISOString(), "2026-11-10T14:58:30.000Z");
  const lateRows = rows.map((x) => [x.id, new Date(x.planned_at).toISOString()]);
  await ready(nextCo++, { club: true });
  await refresh();
  eq(
    (await slots()).map((x) => [x.id, new Date(x.planned_at).toISOString()]),
    lateRows,
    "una bozza aggiunta dopo apertura non sposta la griglia",
  );

  // Con N=1 si usa il centro dell'intervallo; finish non puo inventare un invio da MIME pronto.
  await resetPlan();
  now = "2026-11-10T07:00:00Z";
  const lone = await ready(nextCo++, { club: false });
  await refresh();
  rows = await slots();
  eq(rows.length, 1);
  eq(new Date(rows[0].planned_at).toISOString(), "2026-11-10T11:27:30.000Z");
  now = new Date(rows[0].planned_at).toISOString();
  let firstClaim = await service("claim_partner_assistant_send", [WORKER, 300, 0]);
  eq(firstClaim.candidate.partner_id, lone);
  ok(typeof firstClaim.candidate.send_not_after === "string");
  const cd = firstClaim.candidate.draft;
  const id1 = `<${randomUUID()}@brand.example.test>`;
  const opt = "Se preferite non ricevere altre email, scrivetemelo e non vi ricontattero.";
  const raw = `From: sender@brand.example.test\r\nMessage-ID: ${id1}\r\n\r\nTesto sintetico.`;
  let firstPrepared = await service("prepare_partner_assistant_send", [
    firstClaim.lease_token,
    randomUUID(),
    JSON.stringify({
      schema_version: 1,
      job_id: firstClaim.candidate.job_id,
      draft_id: cd.draft_id,
      mode: "invio",
      test_run_id: null,
      test_index: null,
      message_id: id1,
      to_address: firstClaim.candidate.address,
      subject: cd.subject,
      text: cd.body + "\n\n" + cd.signature + "\n\n" + opt,
      opt_out: opt,
      raw,
      mailbox_check: "vuota",
    }),
  ]);
  eq(firstPrepared.status, "pronto", JSON.stringify(firstPrepared));
  const firstFinish = (outcome, reason, op = randomUUID()) =>
    service("finish_partner_assistant_send", [
      firstClaim.lease_token,
      op,
      JSON.stringify({
        schema_version: 1,
        message_row_id: firstPrepared.message_row_id,
        outcome,
        smtp_code: outcome === "inviato" ? 250 : null,
        enhanced_code: null,
        spam: false,
        reason,
      }),
    ]);
  eq((await firstFinish("inviato", null)).status, "lease_persa");
  eq(
    await value("select send_status as v from public.partner_assistant_messages where id=$1", [
      firstPrepared.message_row_id,
    ]),
    "pronto",
  );
  const finishOp = randomUUID();
  eq((await firstFinish("scartato", "smtp_credenziali", finishOp)).status, "done");
  eq((await firstFinish("scartato", "smtp_credenziali", finishOp)).replayed, true);
  eq(
    await value("select status as v from private.partner_send_slots where id=$1", [rows[0].id]),
    "skipped",
  );
  await release();
  await refresh();
  eq(
    (await slots()).length,
    0,
    "il fallimento pre-SMTP non viene ritentato nella stessa giornata locale",
  );

  // Finestra australiana a cavallo di Roma: ieri pieno, oggi dodici posti reali disponibili.
  await resetPlan();
  now = "2026-11-10T12:00:00Z";
  await sent(3, { club: true });
  await sent(3, { club: false });
  await sent(6, { club: false, kind: "sollecito" });
  const auF = [];
  for (let i = 0; i < 6; i++) {
    const [p] = await sent(1, {
      club: i < 3,
      day: "2026-10-20",
      tz: "Australia/Sydney",
      country: "Australia",
    });
    await asOwner("update public.partners set stage='contattato' where id=$1", [p]);
    auF.push(p);
  }
  await as("postgres", null, () => db.exec("select private.refresh_partner_followups()"), { now });
  for (const p of auF)
    await save(
      await value("select id as v from public.partner_assistant_followups where partner_id=$1", [
        p,
      ]),
    );
  for (let i = 0; i < 6; i++)
    await ready(nextCo++, { club: i < 3, tz: "Australia/Sydney", country: "Australia" });
  await refresh();
  const au = (
    await db.query(
      "select * from private.partner_send_slots where status='scheduled' order by planned_at",
    )
  ).rows;
  eq(au.length, 12, "non si riduce artificialmente a un solo contatto dopo mezzanotte");
  eq(new Set(au.map((x) => new Date(x.quota_day).toISOString().slice(0, 10))).size, 1);
  eq(new Date(au[0].quota_day).toISOString().slice(0, 10), "2026-11-11");
  eq(new Date(au[0].planned_at).toISOString(), "2026-11-10T23:00:00.000Z");
  eq(new Date(au.at(-1).planned_at).toISOString(), "2026-11-11T04:55:00.000Z");
  eq(au.filter((x) => x.kind === "primo" && x.flow_template).length, 3);
  eq(au.filter((x) => x.kind === "primo" && !x.flow_template).length, 3);
  eq(au.filter((x) => x.kind === "sollecito").length, 6);
  eq(await firstSent(), 6);
  eq(await followupSent(), 6);
  eq(await firstSent("2026-11-11"), 0);
  eq(await followupSent("2026-11-11"), 0);
  // Entrambe le quote Roma libere non creano ventiquattro invii nello stesso giorno locale.
  await asOwner(
    "update public.partner_assistant_messages set send_day=date '2026-11-09' where send_day=date '2026-11-10'",
  );
  for (let i = 0; i < 6; i++)
    await ready(nextCo++, { club: i < 3, tz: "Australia/Sydney", country: "Australia" });
  const extraF = [];
  for (let i = 0; i < 6; i++) {
    const [p] = await sent(1, {
      club: i < 3,
      day: "2026-10-20",
      tz: "Australia/Sydney",
      country: "Australia",
    });
    await asOwner("update public.partners set stage='contattato' where id=$1", [p]);
    extraF.push(p);
  }
  await as("postgres", null, () => db.exec("select private.refresh_partner_followups()"), { now });
  for (const p of extraF)
    await save(
      await value("select id as v from public.partner_assistant_followups where partner_id=$1", [
        p,
      ]),
    );
  await refresh();
  const perWindow = (
    await db.query(
      "select window_id, count(*)::int n,count(*) filter(where kind='primo' and flow_template)::int club,count(*) filter(where kind='primo' and not flow_template)::int altri,count(*) filter(where kind='sollecito')::int fu from private.partner_send_slots where status='scheduled' group by window_id",
    )
  ).rows;
  ok(perWindow.length > 0);
  ok(
    perWindow.every((x) => x.n <= 12 && x.club <= 3 && x.altri <= 3 && x.fu <= 6),
    "ogni finestra locale conserva 3+3+6 anche con due RomaDay disponibili",
  );
  // Cento bozze reali sintetiche: il planner seleziona le quote e non costruisce cento slot.
  await resetPlan();
  now = "2026-11-10T07:00:00Z";
  await sent(1, { club: false, day: "2026-10-20" });
  for (let i = 0; i < 100; i++) await ready(nextCo++, { club: i % 2 === 0 });
  const plannerStarted = performance.now();
  await refresh();
  const plannerMs = performance.now() - plannerStarted;
  const hundredToday = await slots();
  eq(hundredToday.length, 6);
  eq(hundredToday.filter((x) => x.flow_template).length, 3);
  eq(hundredToday.filter((x) => !x.flow_template).length, 3);
  eq(
    await value(
      "select count(distinct partner_id)::integer as v from private.partner_send_slots where status='scheduled'",
    ),
    12,
    "due finestre materializzano due selezioni distinte di sei prime",
  );
  // Rientro OOO nel giorno locale: Roma e gia al 17, Honolulu e ancora al 16.
  await resetPlan();
  now = "2026-11-16T23:30:00Z";
  const [honolulu] = await sent(1, {
    club: true,
    day: "2026-10-20",
    tz: "Pacific/Honolulu",
    country: "USA",
  });
  await asOwner("update public.partners set stage='contattato' where id=$1", [honolulu]);
  await as("postgres", null, () => db.exec("select private.refresh_partner_followups()"), { now });
  const hId = await value(
    "select id as v from public.partner_assistant_followups where partner_id=$1",
    [honolulu],
  );
  await save(hId);
  let hc = await claim();
  const deferred = await service("record_partner_followup_check", [
    hc.lease_token,
    hc.candidate.id,
    hc.candidate.version,
    JSON.stringify({
      result: "deferred",
      reason: "fuori_ufficio",
      checked_at: now,
      proof_sha256: sha("OOO locale Honolulu"),
      folder_count: 3,
      message_count: 1,
      resume_on: "2026-11-17",
    }),
  ]);
  eq(
    deferred,
    { status: "deferred", resume_on: "2026-11-17" },
    "il 17 e futuro nel fuso del destinatario, anche se coincide con oggi Roma",
  );
  await release();
  await save(hId);
  await wake(hId);
  hc = await claim();
  eq(hc.candidate.send_allowed, false);
  eq((await check(hc)).status, "clear");
  eq(
    new Date((await conv(hId)).deferred_until).toISOString().slice(0, 10),
    "2026-11-17",
    "clear del 16 locale non cancella il rientro del 17",
  );
  eq(
    await value("select private.partner_send_snapshot($1,'sollecito',$2,1,$3::timestamptz) as v", [
      honolulu,
      hc.candidate.draft.draft_id,
      now,
    ]),
    null,
    "il piano non prenota un invio nel giorno prima del rientro locale",
  );
  eq(
    await value("select private.partner_followup_send_reason($1,$2::timestamptz) as v", [hId, now]),
    "fuori_ufficio",
  );
  await release();
  now = "2026-11-17T19:00:00Z";
  await wake(hId);
  hc = await claim();
  eq((await check(hc)).status, "clear");
  eq(
    (await conv(hId)).deferred_until,
    null,
    "solo il giorno locale di rientro puo eliminare il rinvio dopo full clear",
  );
  ok(
    await value(
      "select private.partner_send_snapshot($1,'sollecito',$2,1,$3::timestamptz) is not null as v",
      [honolulu, hc.candidate.draft.draft_id, now],
    ),
  );
  await release();
  const returnSlot = await one(
    "select planned_at from private.partner_send_slots where conversation_id=$1 and status='scheduled' order by planned_at limit 1",
    [hId],
  );
  now = new Date(new Date(returnSlot.planned_at).getTime() + 1000).toISOString();
  await wake(hId);
  hc = await claim();
  eq(hc.candidate.send_allowed, true);
  await complete(hc);
  eq(
    (await conv(hId)).followups_sent,
    1,
    "il rientro riprende con slot, scansioni e doppia prova ordinari",
  );
  await release();
  // Una revisione della prima prima delle 09:00 rientra nel piano; dopo apertura perde lo slot.
  await resetPlan();
  now = "2026-11-10T07:00:00Z";
  const revisionPartner = await ready(nextCo++, { club: false });
  await refresh();
  const priorSlot = (await slots())[0];
  const reviseFirst = async () => {
    const d = await value(
      "select draft_id as v from public.partner_assistant_jobs where partner_id=$1",
      [revisionPartner],
    );
    const next = await value(
      `insert into public.partner_assistant_drafts
      select (jsonb_populate_record(null::public.partner_assistant_drafts,to_jsonb(d)||jsonb_build_object('id',gen_random_uuid(),'operation_id',gen_random_uuid()))).*
      from public.partner_assistant_drafts d where d.id=$1 returning id as v`,
      [d],
    );
    await asOwner("update public.partner_assistant_jobs set draft_id=$2 where partner_id=$1", [
      revisionPartner,
      next,
    ]);
    return next;
  };
  const revised = await reviseFirst();
  await refresh();
  const restored = (await slots())[0];
  eq(
    await value("select reason as v from private.partner_send_slots where id=$1", [priorSlot.id]),
    "ripianificato",
  );
  eq(restored.draft_id, revised, "la nuova revisione valida rientra prima dell'apertura");
  ok(restored.id !== priorSlot.id);
  eq(new Date(restored.planned_at).toISOString(), new Date(priorSlot.planned_at).toISOString());
  now = "2026-11-10T08:01:00Z";
  await reviseFirst();
  await refresh();
  eq(
    await value("select reason as v from private.partner_send_slots where id=$1", [restored.id]),
    "contesto_cambiato",
  );
  eq((await slots()).length, 0, "dopo le 09:00 la nuova revisione non recupera lo slot del giorno");

  // Stessa finestra UTC, giorni locali diversi sulla linea internazionale del cambio data.
  await resetPlan();
  now = "2026-11-10T18:00:00Z";
  const hawaii = await ready(nextCo++, { club: false, tz: "Pacific/Honolulu", country: "USA" });
  const kiribati = await ready(nextCo++, {
    club: false,
    tz: "Pacific/Kiritimati",
    country: "Kiribati",
  });
  await refresh();
  const dateline = (
    await db.query(`select s.id,s.partner_id,s.local_day,s.window_id,w.opens_at
    from private.partner_send_slots s join private.partner_send_windows w on w.id=s.window_id
    where s.status='scheduled' and w.opens_at='2026-11-10T19:00:00Z'::timestamptz order by s.partner_id`)
  ).rows;
  eq(dateline.length, 2, "entrambi i gruppi hanno una prenotazione viva senza sovrascriversi");
  eq(new Set(dateline.map((x) => x.window_id)).size, 2);
  eq(new Set(dateline.map((x) => new Date(x.local_day).toISOString().slice(0, 10))).size, 2);
  eq(new Set(dateline.map((x) => x.partner_id)), new Set([hawaii, kiribati]));
  const datelineIds = dateline.map((x) => x.id).sort();
  await refresh();
  eq(
    (
      await db.query(
        "select id from private.partner_send_slots where id=any($1::uuid[]) and status='scheduled'",
        [datelineIds],
      )
    ).rows
      .map((x) => x.id)
      .sort(),
    datelineIds,
    "ripetere il planner non cancella il primo gruppo quando legge il secondo",
  );
  console.log(`planner_100_candidates_ms=${Math.round(plannerMs)}`);
  console.log(`PASS ${checks} controlli`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.close();
}
