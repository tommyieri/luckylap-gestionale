// test-db: pglite minimo 387
// Solleciti automatici: prove fresche, quote separate, stato SMTP e arresto nel dubbio.
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
async function sent(n, { club, day = TODAY, kind = "primo", sendStatus = "inviato" }) {
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
         operation_id, created_by, followup_number, flow_template, created_at)
       values ($1, $2, $11, 'invio', $12, $3, $4, $5, $6, $7, $8, 1, gen_random_uuid(), $9::date,
         $9::date + time '08:40', case when $12='inviato' then $9::date + time '08:41' end, gen_random_uuid(), $10,
         case when $11='sollecito' then 1 end, case when $11='sollecito' then $13::boolean end,
         $9::date + time '08:39')`,
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

  eq(await value("select mode as v from private.partner_followup_config"), "osserva");
  for (const fn of [
    "claim_partner_followup(uuid,integer)",
    "record_partner_followup_check(uuid,uuid,bigint,jsonb)",
    "prepare_partner_followup_send(uuid,uuid,uuid,jsonb)",
    "start_partner_followup_send(uuid,uuid,uuid)",
    "finish_partner_followup_send(uuid,uuid,jsonb)",
  ]) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      eq(
        await value("select has_function_privilege($1,$2,'execute') as v", [role, `public.${fn}`]),
        role === "service_role",
      );
    }
  }
  eq(
    await value(
      "select has_function_privilege('service_role','private.save_partner_followup_draft_as_founder(uuid,uuid,jsonb)','execute') as v",
    ),
    false,
  );
  eq(
    await value(
      "select has_table_privilege('authenticated','public.partner_assistant_followups','select') as v",
    ),
    false,
  );

  for (const role of ["anon", "authenticated", "service_role"]) {
    eq(
      await value(
        "select has_function_privilege($1,'private.set_partner_followup_mode_as_founder(uuid,uuid,jsonb)','execute') as v",
        [role],
      ),
      false,
    );
    eq(
      await value(
        "select has_function_privilege($1,'private.partner_followup_sent(date)','execute') as v",
        [role],
      ),
      false,
    );
  }
  await assert.rejects(
    () =>
      value("select private.set_partner_followup_mode_as_founder($1,$2,$3::jsonb) as v", [
        assistant,
        randomUUID(),
        JSON.stringify({ schema_version: 1, expected_version: 1, mode: "invio" }),
      ]),
    { code: "42501" },
  );
  checks++;
  await db.exec("begin");
  try {
    const op = randomUUID();
    const payload = JSON.stringify({ schema_version: 1, expected_version: 1, mode: "invio" });
    const ownerMode = () =>
      value("select private.set_partner_followup_mode_as_founder($1,$2,$3::jsonb) as v", [
        founder,
        op,
        payload,
      ]);
    eq(await ownerMode(), { mode: "invio", version: 2, replayed: false });
    eq(await ownerMode(), { mode: "invio", version: 2, replayed: true });
    eq(await value("select updated_by as v from private.partner_followup_config"), founder);
  } finally {
    await db.exec("rollback");
  }
  eq(await value("select mode as v from private.partner_followup_config"), "osserva");

  // Le fixture storiche usano il tempo del caso, non quello del Mac. Il default originale
  // next_check_at=now() resta installato e viene verificato sul tempo reale del bootstrap.
  // Si normalizzano soltanto gli id appena creati: attese, backoff e lease preesistenti restano intatti.
  const initializeFollowupFixtures = async (partnerIds) => {
    eq(
      await value(
        "select count(*)::int as v from public.partner_assistant_followups where partner_id=any($1::uuid[])",
        [partnerIds],
      ),
      0,
      "fixture nuove, nessuna attesa preesistente",
    );
    const beforeWall = Date.parse(await value("select clock_timestamp() as v"));
    await as("postgres", null, () => db.exec("select private.refresh_partner_followups()"), {
      now,
    });
    const afterWall = Date.parse(await value("select clock_timestamp() as v"));
    const created = (
      await db.query(
        "select id,next_check_at from public.partner_assistant_followups where partner_id=any($1::uuid[])",
        [partnerIds],
      )
    ).rows;
    eq(created.length, partnerIds.length, "bootstrap completo delle sole fixture nuove");
    ok(
      created.every(
        (row) =>
          row.next_check_at !== null &&
          Date.parse(row.next_check_at) >= beforeWall &&
          Date.parse(row.next_check_at) <= afterWall,
      ),
      "default originale nel corretto intervallo reale",
    );
    const normalized = await asOwner(
      "update public.partner_assistant_followups set next_check_at=$2::timestamptz where id=any($1::uuid[]) returning id,next_check_at",
      [created.map((row) => row.id), now],
    );
    ok(
      normalized.rows.length === created.length &&
        normalized.rows.every((row) => Date.parse(row.next_check_at) === Date.parse(now)),
      "normalizzate al tempo del caso solo le fixture appena create",
    );
  };

  await asOwner("update private.partner_assistant_config set daily_first_limit=6");
  const [club] = await sent(1, { club: true, day: "2026-10-20" });
  await asOwner("update public.partners set stage='contattato' where id=$1", [club]);
  await initializeFollowupFixtures([club]);
  await asOwner(
    `select private.partner_log($1,$2,'inviato',$3,p_channel=>'email',p_message_kind=>'primo',p_origin=>'assistente',
    p_occurred_at=>'2026-10-20T08:40:00Z'::timestamptz)`,
    [randomUUID(), club, assistant],
  );
  const openTasks = () =>
    value(
      `select count(*)::int as v from public.tasks t join public.partner_work_links l on l.task_id=t.id
    where l.partner_id=$1 and l.kind='follow_up' and t.status<>'done'`,
      [club],
    );
  eq(await openTasks(), 1);
  let c = await claim();
  eq(await openTasks(), 1, "osserva conserva il promemoria manuale");
  eq(c.status, "claimed");
  eq(c.mode, "osserva");
  eq(c.candidate.send_allowed, false);
  eq(c.candidate.flow_template, true);
  eq(c.candidate.followups_sent, 0);
  eq(c.candidate.next_due_on, "2026-10-27");
  eq(c.candidate.draft, null);
  eq(c.candidate.addresses.length, 1);
  eq(c.candidate.message_ids.length, 1);
  const id = c.candidate.id;
  eq((await check(c)).status, "clear");
  await release();
  const saved = await save(id);
  eq(saved.number, 1);
  eq(saved.version, 2);
  const review = await one(
    `select n.model,n.content from private.partner_followup_drafts d join public.partner_assistant_notes n on n.id=d.review_id where d.draft_id=$1`,
    [saved.id],
  );
  eq(review.model, null);
  eq(review.content.approval_source, "founder_edit");
  eq(review.content.prepared_by, "codex");
  c = await claim();
  eq(c.candidate.draft.number, 1);
  eq(c.candidate.send_allowed, false);
  let pr = await check(c);
  eq((await prepare(c, pr)).reason, "osserva");
  await release();
  eq(
    (
      await team("set_partner_followup_mode", {
        schema_version: 1,
        expected_version: 1,
        mode: "invio",
      })
    ).mode,
    "invio",
  );
  await wake(id);
  c = await claim();
  eq(c.candidate.send_allowed, true);
  pr = await check(c);
  const pending = await prepare(c, pr);
  eq(pending.status, "pronto");
  eq(
    (
      await service("start_partner_followup_send", [
        c.lease_token,
        pending.message_row_id,
        pr.proof_id,
      ])
    ).reason,
    "controllo_scaduto",
    "la prima prova non vale per start",
  );
  await release();
  await wake(id);
  c = await claim();
  const m = await complete(c);
  eq((await finish(c, m, "inviato", m.finishOp)).replayed, true);
  eq((await conv(id)).followups_sent, 1);
  eq((await conv(id)).next_due_on, "2026-11-17");
  eq(await flowSent(true), 0, "FU Club non consuma il contatore delle prime Club");
  eq(await followupSent(), 1);
  eq(await firstSent(), 0);
  eq(await flowSent(false), 0);
  const oldConfig = await configSafe();
  async function configSafe() {
    return value("select daily_first_limit as v from private.partner_assistant_config");
  }
  const sentRow = await one("select * from public.partner_assistant_messages where id=$1", [
    m.message_row_id,
  ]);
  await assert.rejects(
    () =>
      asOwner("update public.partner_assistant_messages set flow_template=false where id=$1", [
        m.message_row_id,
      ]),
    { code: "42501" },
  );
  checks++;
  await assert.rejects(
    () =>
      asOwner("update public.partner_assistant_drafts set body='Mutazione' where id=$1", [
        sentRow.draft_id,
      ]),
    { code: "42501" },
  );
  checks++;
  eq(sentRow.kind, "sollecito");
  eq(sentRow.followup_number, 1);
  eq(sentRow.flow_template, true);
  eq(sentRow.lookbook, null);
  eq(
    await value(
      "select count(*)::integer as v from public.partner_activities where partner_id=$1 and message_kind='sollecito'",
      [club],
    ),
    1,
  );
  eq(
    await value(
      `select count(*)::integer as v from public.tasks t join public.partner_work_links l on l.task_id=t.id
    join public.partner_activities a on a.id=l.activity_id where l.partner_id=$1 and a.origin='assistente' and a.kind='inviato' and t.status<>'done'`,
      [club],
    ),
    0,
  );
  eq(oldConfig, 6);
  await release();

  // Ancora non dovuto: scansione continua, SMTP non autorizzato.
  await save(id);
  await wake(id);
  c = await claim();
  eq(c.candidate.send_allowed, false);
  pr = await check(c);
  eq((await prepare(c, pr)).reason, "non_scaduto");
  await release();
  // Il secondo sollecito rispetta l'offset originale e non richiede mutazioni del primo motore.
  now = "2026-11-17T09:00:00Z";
  await wake(id);
  c = await claim();
  eq(c.candidate.send_allowed, true);
  await complete(c);
  eq((await conv(id)).followups_sent, 2);
  eq((await conv(id)).next_due_on, "2026-12-04");
  await release();
  now = "2026-12-04T09:00:00Z";
  await save(id);
  c = await claim();
  await complete(c);
  eq((await conv(id)).followups_sent, 3);
  eq((await conv(id)).next_due_on, "2027-01-18");
  await release();
  now = "2027-01-18T09:00:00Z";
  await save(id);
  c = await claim();
  await complete(c);
  eq((await conv(id)).status, "complete");
  eq((await conv(id)).followups_sent, 4);
  eq((await conv(id)).next_due_on, null);
  await release();
  eq((await claim()).status, "idle", "nessun quinto sollecito");

  // Found blocca anche una bozza già preparata; nessuna nuova approvazione viene inventata.
  now = MORNING;
  const [other] = await sent(1, { club: false, day: "2026-11-02" });
  await asOwner("update public.partners set stage='contattato' where id=$1", [other]);
  await initializeFollowupFixtures([other]);
  c = await claim();
  const otherId = c.candidate.id;
  await release();
  await save(otherId);
  c = await claim();
  pr = await check(c);
  const foundPending = await prepare(c, pr);
  eq(foundPending.status, "pronto");
  eq((await check(c, "found", "risposta_trovata")).status, "blocked");
  eq((await conv(otherId)).status, "held");
  eq((await conv(otherId)).draft_id, null);
  eq(
    await value("select send_status as v from public.partner_assistant_messages where id=$1", [
      foundPending.message_row_id,
    ]),
    "scartato",
  );
  eq((await finish(c, foundPending, "scartato")).status, "done");
  await release();
  eq(
    await value(
      "select count(*)::int as v from public.tasks where title like 'Controllare risposta%'",
    ),
    1,
  );

  // Una prova incerta non autorizza invio e una bozza non valida torna da preparare.
  const [third] = await sent(1, { club: false, day: "2026-11-02" });
  await asOwner("update public.partners set stage='contattato' where id=$1", [third]);
  await initializeFollowupFixtures([third]);
  c = await claim();
  const thirdId = c.candidate.id;
  await release();
  await save(thirdId);
  c = await claim();
  eq((await check(c, "uncertain", "bozza_non_valida")).status, "retry");
  eq((await conv(thirdId)).status, "active");
  eq((await conv(thirdId)).draft_id, null);
  eq(
    await value(
      "select count(*)::int as v from private.partner_followup_drafts where conversation_id=$1 and invalidated_at is not null",
      [thirdId],
    ),
    1,
  );
  await release();
  await save(thirdId);
  c = await claim();
  pr = await check(c);
  const uncertainPending = await prepare(c, pr);
  const second = await check(c);
  eq(
    (
      await service("start_partner_followup_send", [
        c.lease_token,
        uncertainPending.message_row_id,
        second.proof_id,
      ])
    ).status,
    "in_invio",
  );
  const finishOp = randomUUID();
  const uncertain = await finish(c, uncertainPending, "incerto", finishOp);
  eq(uncertain.send_status, "incerto");
  eq((await finish(c, uncertainPending, "incerto", finishOp)).replayed, true);
  eq((await conv(thirdId)).status, "held");
  eq((await conv(thirdId)).followups_sent, 0);
  await release();
  eq((await claim()).status, "idle", "nessun retry SMTP di esito incerto");

  // Ogni controllo viene legato alla conversazione, alla versione e alla bozza correnti.
  const fresh = async (clubFlow = false) => {
    await resetSends();
    await release();
    now = MORNING;
    const [partner] = await sent(1, { club: clubFlow, day: "2026-10-20" });
    await asOwner("update public.partners set stage='contattato' where id=$1", [partner]);
    await initializeFollowupFixtures([partner]);
    let candidate = await claim();
    await release();
    await save(candidate.candidate.id);
    candidate = await claim();
    return candidate;
  };
  c = await fresh();
  const invalidVersion = await service("record_partner_followup_check", [
    c.lease_token,
    c.candidate.id,
    null,
    JSON.stringify({
      result: "clear",
      reason: null,
      checked_at: now,
      proof_sha256: sha("null"),
      folder_count: 3,
      message_count: 0,
    }),
  ]);
  eq(invalidVersion.status, "lease_persa");
  const incomplete = await service("record_partner_followup_check", [
    c.lease_token,
    c.candidate.id,
    c.candidate.version,
    JSON.stringify({
      result: "clear",
      reason: null,
      checked_at: now,
      proof_sha256: sha("folder"),
      folder_count: 2,
      message_count: 0,
    }),
  ]);
  eq(incomplete.status, "retry");
  eq((await conv(c.candidate.id)).reason, "controllo_incerto");
  const staleCheck = await service("record_partner_followup_check", [
    c.lease_token,
    c.candidate.id,
    c.candidate.version,
    JSON.stringify({
      result: "clear",
      reason: null,
      checked_at: "2026-11-10T08:58:00Z",
      proof_sha256: sha("stale"),
      folder_count: 3,
      message_count: 0,
    }),
  ]);
  eq(staleCheck.status, "retry");
  pr = await check(c);
  eq((await conv(c.candidate.id)).reason, null);
  now = "2026-11-10T09:00:31Z";
  eq((await prepare(c, pr)).reason, "controllo_scaduto", "prova scade a trenta secondi");
  pr = await check(c);
  const staged = await prepare(c, pr);
  eq(staged.status, "pronto");
  // Una prova valida non basta se il sesto sollecito è partito dopo prepare.
  await sent(6, { club: false, kind: "sollecito" });
  const latest = await check(c);
  eq(
    (
      await service("start_partner_followup_send", [
        c.lease_token,
        staged.message_row_id,
        latest.proof_id,
      ])
    ).reason,
    "limite",
    "il settimo sollecito si ferma anche all'ultimo controllo",
  );
  eq(await followupSent(), 6);
  eq(await firstSent(), 0);
  eq([await flowSent(true), await flowSent(false)], [0, 0]);
  await release();
  await wake(c.candidate.id);
  c = await claim();
  eq(c.status, "claimed", "quota FU piena non ferma il controllo delle risposte");
  eq(c.candidate.send_allowed, false);
  pr = await check(c);
  eq((await prepare(c, pr)).reason, "limite", "il settimo sollecito si ferma già a prepare");
  await release();

  // Sei prime esaurite non consumano i sei posti aggiuntivi per i solleciti.
  c = await fresh(true);
  await sent(3, { club: true });
  await sent(3, { club: false });
  eq(await firstSent(), 6);
  eq([await flowSent(true), await flowSent(false)], [3, 3]);
  const quotaFollowup = await complete(c);
  eq(await firstSent(), 6);
  eq(await followupSent(), 1, "un FU parte anche dopo tutte le sei prime");
  eq([await flowSent(true), await flowSent(false)], [3, 3]);
  await release();
  const firstProgram = await as(
    "authenticated",
    founder,
    () => value("select public.read_partner_email_program($1::date,1) as v", [TODAY]),
    { now },
  );
  eq(firstProgram.todaySent, { club: 3, altri: 3 });
  eq(firstProgram.sent.length, 6, "lo storico del calendario prime esclude il sollecito");
  eq(
    firstProgram.sent.some((x) => x.id === quotaFollowup.message_row_id),
    false,
  );

  // Nessun sottolimite di flusso sui solleciti: sei Club sono consentiti.
  c = await fresh(true);
  await sent(5, { club: true, kind: "sollecito" });
  await complete(c);
  eq(await followupSent(), 6, "anche sei solleciti Club nello stesso giorno");
  eq(await firstSent(), 0);
  eq([await flowSent(true), await flowSent(false)], [0, 0]);
  await release();
  // Il motore prime può fare una lease di sole copie: la fixture simula l'APPEND concluso.
  await asOwner(
    "update public.partner_assistant_messages set appended_at=sent_at where send_status='inviato' and appended_at is null",
  );
  const firstClubCo = nextCo++;
  await ready(firstClubCo, { club: true });
  eq(await candidateAt(now), firstClubCo, "sei FU non impediscono la prima email Club");
  await sent(3, { club: true });
  eq(await candidateAt(now), "limite", "tre prime Club restano un tetto rigido anche dopo sei FU");
  const firstOtherCo = nextCo++;
  await ready(firstOtherCo, { club: false });
  eq(await candidateAt(now), firstOtherCo, "restano disponibili i tre posti delle altre prime");
  await sent(3, { club: false });
  eq(await candidateAt(now), "limite", "sei prime e sei solleciti esauriscono quote indipendenti");
  eq(await firstSent(), 6);
  eq(await followupSent(), 6);
  eq([await flowSent(true), await flowSent(false)], [3, 3]);
  eq(await firstSent("2026-11-11"), 0);
  eq(await followupSent("2026-11-11"), 0);

  // In invio e incerto consumano solo il rispettivo contatore, come gli invii confermati.
  c = await fresh();
  for (const sendStatus of ["in_invio", "incerto", "inviato"]) {
    await sent(2, { club: false, kind: "sollecito", sendStatus });
  }
  eq(await followupSent(), 6);
  eq(await firstSent(), 0);
  eq(await flowSent(false), 0);
  eq(
    await value("select private.partner_followup_send_reason($1,$2::timestamptz) as v", [
      c.candidate.id,
      now,
    ]),
    "limite",
  );
  await sent(1, { club: true, kind: "sollecito", sendStatus: "pronto" });
  await sent(1, { club: true, kind: "sollecito", sendStatus: "scartato" });
  await sent(1, { club: true, kind: "sollecito", sendStatus: "respinto" });
  eq(await followupSent(), 6, "pronto, scartato e respinto non consumano un invio FU");
  await sent(1, { club: false, kind: "sollecito", day: "2026-11-11" });
  eq(await followupSent("2026-11-11"), 1);
  eq(await followupSent(), 6);
  await release();

  // Un intervento umano o la revoca prevalgono anche su una bozza già composta.
  c = await fresh();
  pr = await check(c);
  let blockedPending = await prepare(c, pr);
  await asOwner("update public.partner_assistant_contacts set active=false where partner_id=$1", [
    c.candidate.partner_id,
  ]);
  // Fixture senza interruttore precedente: la revoca viene aggiunta esplicitamente.
  await asOwner(
    `insert into public.partner_assistant_contacts(partner_id,active,updated_by) values($1,false,$2)
    on conflict(partner_id) do update set active=false`,
    [c.candidate.partner_id, founder],
  );
  eq((await check(c)).status, "blocked");
  eq((await conv(c.candidate.id)).reason, "assistente_fermo");
  await release();

  c = await fresh();
  await asOwner(
    `select private.partner_log(gen_random_uuid(),$1,'nota',$3,p_body=>'Intervento sintetico',p_origin=>'team',
    p_occurred_at=>$2::timestamptz)`,
    [c.candidate.partner_id, now, founder],
  );
  eq((await check(c)).status, "lease_persa", "il trigger ha gia invalidato la versione");
  eq((await conv(c.candidate.id)).reason, "attivita_team");
  eq(
    await value(
      "select reason as v from private.partner_followup_suppressions where address_sha256=private.partner_assistant_address_sha256($1)",
      [c.candidate.address],
    ),
    "manual",
  );
  const manualAddress = c.candidate.address;
  await release();
  await resetSends();
  const afterManual = await ready(6004, { club: false });
  await asOwner("update public.partner_contacts set value=$2,link_value=$2 where partner_id=$1", [
    afterManual,
    manualAddress,
  ]);
  eq(
    await value("select private.partner_assistant_eligible($1) as v", [afterManual]),
    false,
    "la soppressione manuale resta dopo rimozione della conversazione",
  );

  c = await fresh();
  await asOwner("update public.partners set stage='no' where id=$1", [c.candidate.partner_id]);
  eq((await check(c)).status, "blocked");
  eq((await conv(c.candidate.id)).status, "held");
  await release();

  c = await fresh();
  await asOwner(
    `update public.partner_contacts set value='nuovo@club.example.test',link_value='nuovo@club.example.test',version=version+1 where id=$1`,
    [c.candidate.contact_id],
  );
  eq((await check(c)).status, "blocked");
  eq((await conv(c.candidate.id)).reason, "recapito_cambiato");
  await release();

  // Recupero dopo interruzione: pronto viene scartato, in_invio resta incerto senza retry.
  c = await fresh();
  pr = await check(c);
  let interrupted = await prepare(c, pr);
  await release();
  await wake(c.candidate.id);
  let recovered = await claim();
  eq(
    await value("select send_status as v from public.partner_assistant_messages where id=$1", [
      interrupted.message_row_id,
    ]),
    "scartato",
  );
  eq((await conv(c.candidate.id)).status, "active");
  await release();
  await wake(c.candidate.id);
  c = await claim();
  pr = await check(c);
  interrupted = await prepare(c, pr);
  const beforeData = await check(c);
  eq(
    (
      await service("start_partner_followup_send", [
        c.lease_token,
        interrupted.message_row_id,
        beforeData.proof_id,
      ])
    ).status,
    "in_invio",
  );
  await release();
  recovered = await claim();
  eq(
    await value("select send_status as v from public.partner_assistant_messages where id=$1", [
      interrupted.message_row_id,
    ]),
    "incerto",
  );
  eq((await conv(c.candidate.id)).status, "held");
  eq(
    await value(
      `select next_send_after>$1::timestamptz+interval '239 seconds' as v from private.partner_assistant_mail_state`,
      [now],
    ),
    true,
  );
  eq(
    await value(
      `select next_send_after<$1::timestamptz+interval '661 seconds' as v from private.partner_assistant_mail_state`,
      [now],
    ),
    true,
  );
  eq(recovered.status, "idle");

  // Una risposta possibile ferma anche schede duplicate e alias verificati, senza bloccare il lavoro umano.
  c = await fresh();
  const originalAddress = c.candidate.address;
  await asOwner("update public.partner_contacts set verified=true where id=$1", [
    c.candidate.contact_id,
  ]);
  const alias = "alias-verificato@club.example.test";
  await asOwner(
    `insert into public.partner_contacts(partner_id,kind,value,link_value,verified,position,created_by,updated_by)
    values($1,'email',$2,$2,true,1,$3,$3)`,
    [c.candidate.partner_id, alias, founder],
  );
  const duplicate = await ready(6001, { club: false });
  const aliasDuplicate = await ready(6002, { club: false });
  await asOwner("update public.partner_contacts set value=$2,link_value=$2 where partner_id=$1", [
    duplicate,
    originalAddress,
  ]);
  await asOwner("update public.partner_contacts set value=$2,link_value=$2 where partner_id=$1", [
    aliasDuplicate,
    alias,
  ]);
  eq(await value("select private.partner_assistant_eligible($1) as v", [duplicate]), true);
  eq(await value("select private.partner_assistant_eligible($1) as v", [aliasDuplicate]), true);
  eq((await check(c, "found", "risposta_possibile")).status, "blocked");
  eq(await value("select private.partner_assistant_eligible($1) as v", [duplicate]), false);
  eq(await value("select private.partner_assistant_eligible($1) as v", [aliasDuplicate]), false);
  eq(
    await value("select private.partner_blocked($1) as v", [duplicate]),
    false,
    "il blocco riguarda soltanto l'automatismo",
  );
  const manual = await team("record_partner_activity", {
    schema_version: 1,
    partner_id: duplicate,
    kind: "nota",
    body: "Revisione umana sintetica",
  });
  ok(manual.id, "il team puo continuare a lavorare sul contatto");
  const suppressionCount = await value(
    "select count(*)::int as v from private.partner_followup_suppressions",
  );
  await release();
  await resetSends();
  eq(
    await value("select count(*)::int as v from private.partner_followup_suppressions"),
    suppressionCount,
    "le impronte restano dopo cancellazione dei messaggi",
  );
  const futureDuplicate = await ready(6003, { club: false });
  await asOwner("update public.partner_contacts set value=$2,link_value=$2 where partner_id=$1", [
    futureDuplicate,
    originalAddress,
  ]);
  eq(
    await value("select private.partner_assistant_eligible($1) as v", [futureDuplicate]),
    false,
    "una nuova scheda con lo stesso recapito resta esclusa",
  );

  // Letture protette: il dettaglio membro espone solo stato, la preparazione resta founder.
  c = await fresh();
  const summary = await as(
    "authenticated",
    founder,
    () => value("select public.read_partner_followup($1) as v", [c.candidate.partner_id]),
    { now },
  );
  eq(summary.status, "active");
  ok(!JSON.stringify(summary).includes(c.candidate.address));
  await release();
  await service("record_partner_followup_check", [
    randomUUID(),
    c.candidate.id,
    c.candidate.version,
    JSON.stringify({
      result: "clear",
      reason: null,
      checked_at: now,
      proof_sha256: sha("badlease"),
      folder_count: 3,
      message_count: 0,
    }),
  ]).then((x) => eq(x.status, "lease_persa"));
  await asOwner(
    "update private.partner_followup_drafts set invalidated_at=$2::timestamptz where draft_id=$1",
    [c.candidate.draft.draft_id, now],
  );
  const prep = await as(
    "authenticated",
    founder,
    () => value("select public.read_partner_followup_preparation_queue() as v"),
    { now },
  );
  ok(prep.items.some((x) => x.id === c.candidate.id));
  eq(
    await value(
      "select has_function_privilege('service_role','public.read_partner_followup_preparation_queue()','execute') as v",
    ),
    false,
  );

  const adminPrep = await value(
    "select private.read_partner_followup_preparation_queue_as_founder($1) as v",
    [founder],
  );
  eq(adminPrep, prep, "coda amministrativa e coda autenticata identiche");
  ok(adminPrep.items[0].name);
  eq(typeof adminPrep.items[0].porsche_community, "boolean");
  for (const role of ["anon", "authenticated", "service_role"]) {
    eq(
      await value(
        "select has_function_privilege($1,'private.read_partner_followup_preparation_queue_as_founder(uuid)','execute') as v",
        [role],
      ),
      false,
    );
  }
  await assert.rejects(
    () =>
      value("select private.read_partner_followup_preparation_queue_as_founder($1) as v", [
        assistant,
      ]),
    { code: "42501" },
  );
  checks++;

  // Assenza con rientro certo: rinvia senza sopprimere e continua a controllare risposte.
  c = await fresh();
  pr = await check(c);
  const beforeAbsence = await prepare(c, pr);
  eq(beforeAbsence.status, "pronto");
  const beforeAbsenceVersion = c.candidate.version;
  const beforeSuppressions = await value(
    "select count(*)::int as v from private.partner_followup_suppressions",
  );
  const beforeTasks = await value("select count(*)::int as v from public.tasks");
  const defer = (candidate, resumeOn, overrides = {}) =>
    service("record_partner_followup_check", [
      candidate.lease_token,
      candidate.candidate.id,
      candidate.candidate.version,
      JSON.stringify({
        result: "deferred",
        reason: "fuori_ufficio",
        checked_at: now,
        proof_sha256: sha("ooo" + now),
        folder_count: 3,
        message_count: 1,
        resume_on: resumeOn,
        ...overrides,
      }),
    ]);
  eq(await defer(c, "2026-11-20"), { status: "deferred", resume_on: "2026-11-20" });
  let absent = await conv(c.candidate.id);
  eq(absent.status, "active");
  eq(absent.reason, "fuori_ufficio");
  eq(absent.deferred_until, "2026-11-20");
  eq(absent.next_due_on, "2026-11-20");
  eq(absent.version, beforeAbsenceVersion + 1);
  eq(absent.draft_id, null);
  eq(
    await value("select send_status as v from public.partner_assistant_messages where id=$1", [
      beforeAbsence.message_row_id,
    ]),
    "scartato",
  );
  eq(
    await value("select count(*)::int as v from private.partner_followup_suppressions"),
    beforeSuppressions,
  );
  eq(
    await value("select count(*)::int as v from public.tasks"),
    beforeTasks,
    "OOO datata non crea compiti",
  );
  await release();
  await wake(c.candidate.id);
  c = await claim();
  eq(c.status, "claimed", "la scansione continua durante l'assenza");
  eq(c.candidate.send_allowed, false);
  const repeatedVersion = c.candidate.version;
  eq((await defer(c, "2026-11-20")).status, "deferred");
  eq(
    (await conv(c.candidate.id)).version,
    repeatedVersion,
    "stesso rientro non incrementa continuamente la versione",
  );
  eq((await defer(c, "2026-11-22", { folder_count: 2 })).status, "retry");
  eq(
    (await conv(c.candidate.id)).deferred_until,
    "2026-11-20",
    "copertura incompleta non prolunga la sospensione",
  );
  await assert.rejects(() => defer(c, TODAY), { code: "22023" });
  checks++;
  await assert.rejects(() => defer(c, "2028-01-01"), { code: "22023" });
  checks++;
  await assert.rejects(
    () =>
      service("record_partner_followup_check", [
        c.lease_token,
        c.candidate.id,
        c.candidate.version,
        JSON.stringify({
          result: "clear",
          reason: null,
          checked_at: now,
          proof_sha256: sha("badresume"),
          folder_count: 3,
          message_count: 0,
          resume_on: "2026-11-20",
        }),
      ]),
    { code: "22023" },
  );
  checks++;
  const noEarlyPrep = await as(
    "authenticated",
    founder,
    () => value("select public.read_partner_followup_preparation_queue() as v"),
    { now },
  );
  eq(
    noEarlyPrep.items.some((x) => x.id === c.candidate.id),
    false,
  );
  await release();
  now = "2026-11-19T09:00:00Z";
  const nearReturn = await as(
    "authenticated",
    founder,
    () => value("select public.read_partner_followup_preparation_queue() as v"),
    { now },
  );
  eq(
    nearReturn.items.some((x) => x.id === c.candidate.id),
    true,
    "bozza preparabile dal giorno prima del rientro",
  );
  const absenceId = c.candidate.id;
  now = "2026-11-20T09:00:00Z";
  await save(absenceId);
  c = await claim();
  eq(c.candidate.send_allowed, true, "al rientro resta necessario il nuovo controllo della posta");
  await complete(c);
  eq((await conv(absenceId)).followups_sent, 1);
  eq((await conv(absenceId)).deferred_until, null);
  await release();

  // Il giorno delle quote viene dal clock post-lock, anche attraversando mezzanotte a Roma.
  c = await fresh(true);
  await release();
  const midnightId = c.candidate.id;
  const sydneyChoice = await value(
    `insert into public.partner_assistant_notes(partner_id,kind,content,sources,rules_version,model,operation_id,created_by)
    select partner_id,'scelta',content||jsonb_build_object('timezone','Australia/Sydney'),sources,rules_version,null,gen_random_uuid(),created_by
    from public.partner_assistant_notes where id=(select choice_note_id from public.partner_assistant_followups where id=$1)
    returning id as v`,
    [midnightId],
  );
  await asOwner("update public.partner_assistant_followups set choice_note_id=$2 where id=$1", [
    midnightId,
    sydneyChoice,
  ]);
  await asOwner("update public.partners set country='Australia' where id=$1", [
    c.candidate.partner_id,
  ]);
  now = "2026-11-10T23:00:01Z"; // 00:00 Roma dell'11, 10:00 a Sydney.
  await save(midnightId);
  c = await claim();
  eq(c.candidate.send_allowed, true);
  pr = await check(c);
  const afterMidnight = await prepare(c, pr);
  eq(afterMidnight.status, "pronto");
  const midnightProof = await check(c);
  const startedAfterMidnight = await as(
    "service_role",
    null,
    () =>
      value("select public.start_partner_followup_send($1,$2,$3) as v", [
        c.lease_token,
        afterMidnight.message_row_id,
        midnightProof.proof_id,
      ]),
    { now: "2026-11-10T22:59:59Z", proofNow: now },
  );
  eq(startedAfterMidnight.status, "in_invio");
  eq(
    await value("select send_day::text as v from public.partner_assistant_messages where id=$1", [
      afterMidnight.message_row_id,
    ]),
    "2026-11-11",
  );
  eq(await flowSent(true, "2026-11-11"), 0);
  eq(await followupSent("2026-11-11"), 1);
  eq(await firstSent("2026-11-11"), 0);
  eq(await flowSent(true, TODAY), 0);
  await finish(c, afterMidnight);
  await release();

  // Configurazioni mancanti: nessun DTO claimed e nessuna autorizzazione SMTP.
  c = await fresh();
  pr = await check(c);
  const configuredPending = await prepare(c, pr);
  const configuredProof = await check(c);
  for (const table of ["private.partner_followup_config", "private.partner_assistant_config"]) {
    await db.exec("begin");
    try {
      await db.exec(`delete from ${table}`);
      await db.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ role: "service_role" }),
      ]);
      await db.query("select set_config('luckylap.partner_assistant.now',$1,true)", [now]);
      await db.query("select set_config('luckylap.partner_followup.proof_now',$1,true)", [now]);
      await db.exec("set local role service_role");
      eq(
        await value("select public.claim_partner_followup($1,300) as v", [WORKER]),
        { status: "idle", reason: "non_configurato" },
        `${table}: nessun candidato senza configurazione`,
      );
      const noStart = await value("select public.start_partner_followup_send($1,$2,$3) as v", [
        c.lease_token,
        configuredPending.message_row_id,
        configuredProof.proof_id,
      ]);
      eq(
        noStart,
        { status: "stop", reason: "osserva" },
        `${table}: fallimento chiuso prima dell'SMTP`,
      );
    } finally {
      await db.exec("rollback");
    }
  }
  eq(
    await value("select send_status as v from public.partner_assistant_messages where id=$1", [
      configuredPending.message_row_id,
    ]),
    "pronto",
    "le fixture negative ripristinano configurazioni e messaggio con rollback",
  );
  await release();

  // I solleciti pronti e inviabili precedono controlli piu vecchi senza bozza o non ancora dovuti.
  c = await fresh(true);
  const readyPriorityId = c.candidate.id;
  await release();
  const [olderDraftlessPartner] = await sent(1, { club: false, day: "2026-10-20" });
  const [olderFuturePartner] = await sent(1, { club: false, day: "2026-10-20" });
  await asOwner("update public.partners set stage='contattato' where id=any($1::uuid[])", [
    [olderDraftlessPartner, olderFuturePartner],
  ]);
  await initializeFollowupFixtures([olderDraftlessPartner, olderFuturePartner]);
  const olderDraftlessId = await value(
    "select id as v from public.partner_assistant_followups where partner_id=$1",
    [olderDraftlessPartner],
  );
  const olderFutureId = await value(
    "select id as v from public.partner_assistant_followups where partner_id=$1",
    [olderFuturePartner],
  );
  await save(olderFutureId);
  const restorePriorityTimes = async () => {
    await asOwner(
      "update public.partner_assistant_followups set next_check_at=$2::timestamptz where id=$1",
      [readyPriorityId, now],
    );
    await asOwner(
      "update public.partner_assistant_followups set next_check_at=$2::timestamptz-interval '2 hours' where id=$1",
      [olderDraftlessId, now],
    );
    await asOwner(
      "update public.partner_assistant_followups set next_check_at=$2::timestamptz-interval '1 hour',next_due_on=$3::date where id=$1",
      [olderFutureId, now, "2026-11-11"],
    );
  };
  await restorePriorityTimes();
  c = await claim();
  eq(
    c.candidate.id,
    readyPriorityId,
    "la bozza pronta non attende dietro la coda di sole scansioni",
  );
  eq(c.candidate.send_allowed, true);
  await release();
  await asOwner("update private.partner_followup_config set mode='osserva'");
  await restorePriorityTimes();
  c = await claim();
  eq(c.candidate.id, olderDraftlessId, "in osserva resta FIFO per ultimo controllo");
  eq(c.candidate.send_allowed, false);
  await release();
  await asOwner("update private.partner_followup_config set mode='invio'");

  // Un mittente del thread ferma un sollecito anche se il MIME è già pronto.
  c = await fresh();
  const replyCandidate = c.candidate;
  const replyProof = await check(c);
  const replyPending = await prepare(c, replyProof);
  eq(replyPending.status, "pronto");
  for (const suffix of [
    "_partner_calendario_2027.sql",
    "_partner_invii_distribuiti.sql",
    "_partner_piano_prestazioni.sql",
    "_partner_riferimenti_generici.sql",
    "_partner_solleciti_controlli_imap.sql",
    "_partner_risposte_solleciti.sql",
  ])
    await db.exec(migration(suffix));
  const reply = {
    message_id: "<risposta-sintetica@peer.example.test>",
    references: replyCandidate.message_ids,
    from_address: replyCandidate.address,
    received_at: "2026-11-10T08:55:00.000Z",
    subject: "Re: Proposta sintetica",
  };
  const registerReply = (payload = reply, expected = replyCandidate.version) =>
    service("record_partner_followup_reply", [
      c.lease_token,
      replyCandidate.id,
      expected,
      JSON.stringify(payload),
    ]);
  for (const fn of [
    "record_partner_followup_reply(uuid,uuid,bigint,jsonb)",
    "claim_partner_followup_reply_review(uuid,integer)",
  ]) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      eq(
        await value("select has_function_privilege($1,$2,'execute') as v", [role, `public.${fn}`]),
        role === "service_role",
      );
    }
  }
  const [foreignPartner] = await sent(1, { club: false, day: "2026-11-02" });
  const foreignMessageId = await value(
    "select message_id as v from public.partner_assistant_messages where partner_id=$1",
    [foreignPartner],
  );
  eq(
    (await registerReply({ ...reply, from_address: "estraneo@peer.example.test" })).status,
    "stale",
  );
  eq(
    (await registerReply({ ...reply, references: [foreignMessageId, ...reply.references] })).status,
    "stale",
  );
  await assert.rejects(() => registerReply({ ...reply, references: [reply.message_id] }), {
    code: "22023",
  });
  checks++;
  await assert.rejects(
    () => registerReply({ ...reply, references: [...reply.references, ...reply.references] }),
    {
      code: "22023",
    },
  );
  checks++;
  eq((await registerReply(reply, replyCandidate.version + 1)).status, "stale");
  await asOwner(
    `select private.partner_log(gen_random_uuid(),$1,'inviato',$2,p_channel=>'email',p_message_kind=>'primo',
      p_origin=>'assistente',p_occurred_at=>timestamptz '2026-10-20T08:40:00Z')`,
    [replyCandidate.partner_id, assistant],
  );
  eq((await registerReply()).status, "registered");
  eq((await registerReply()).status, "already_recorded");
  const recordedReply = await value(
    `select jsonb_agg(jsonb_build_object('origin',origin,'body',body,'channel',channel,
      'stage_after',stage_after)) as v from public.partner_activities where partner_id=$1 and kind='risposta'`,
    [replyCandidate.partner_id],
  );
  eq(recordedReply, [
    { origin: "assistente", body: reply.subject, channel: "email", stage_after: "risposto" },
  ]);
  eq((await conv(replyCandidate.id)).status, "replied");
  eq((await conv(replyCandidate.id)).reason, "risposta_registrata");
  eq(
    await value(
      `select t.status as v from public.partner_work_links l join public.tasks t on t.id=l.task_id
        where l.partner_id=$1 and l.kind='follow_up'`,
      [replyCandidate.partner_id],
    ),
    "done",
  );
  eq(
    await value("select send_status as v from public.partner_assistant_messages where id=$1", [
      replyPending.message_row_id,
    ]),
    "scartato",
  );
  eq((await finish(c, replyPending, "scartato")).status, "done");
  await release();

  // Una possibile risposta già fermata resta fuori dalla coda SMTP, anche durante il recupero.
  const [historicalPartner] = await sent(1, { club: false, day: "2026-11-02" });
  await asOwner("update public.partners set stage='contattato' where id=$1", [historicalPartner]);
  await initializeFollowupFixtures([historicalPartner]);
  c = await claim();
  eq(c.candidate.partner_id, historicalPartner);
  eq((await check(c, "found", "ambiguous")).status, "blocked");
  const historicalId = c.candidate.id;
  await release();
  await asOwner("update public.partners set stage='trattativa' where id=$1", [historicalPartner]);
  now = "2026-11-10T10:00:00Z";
  const reviewHistoricalReply = () => service("claim_partner_followup_reply_review", [WORKER, 300]);
  const slotPartner = await ready(9001, { club: false });
  const upcomingSlot = await value(
    `with w as (
       insert into private.partner_send_windows(opens_at,grid_end_at,latest_start_at,local_day)
       values ('2026-11-10T10:01:00Z','2026-11-10T15:55:00Z','2026-11-10T15:58:30Z','2026-11-10') returning id
     ) insert into private.partner_send_slots(window_id,partner_id,kind,draft_id,job_id,flow_template,
       snapshot,timezone,local_day,quota_day,planned_at,expires_at)
     select w.id,j.partner_id,'primo',j.draft_id,j.id,false,'{}','Europe/Rome','2026-11-10','2026-11-10',
       '2026-11-10T10:02:00Z','2026-11-10T10:07:00Z' from w cross join public.partner_assistant_jobs j
     where j.partner_id=$1 returning id as v`,
    [slotPartner],
  );
  eq(await reviewHistoricalReply(), { status: "idle", reason: "intervallo" });
  eq((await conv(historicalId)).reply_review_attempts, 0);
  await asOwner("update private.partner_send_slots set status='skipped' where id=$1", [
    upcomingSlot,
  ]);
  const historicalReview = await reviewHistoricalReply();
  eq(historicalReview.status, "claimed");
  eq(historicalReview.mode, "osserva");
  eq(historicalReview.candidate.id, historicalId);
  eq(historicalReview.candidate.draft, null);
  eq(historicalReview.candidate.send_allowed, false);
  eq((await conv(historicalId)).status, "held");
  const recordedHistorical = await service("record_partner_followup_reply", [
    historicalReview.lease_token,
    historicalId,
    historicalReview.candidate.version,
    JSON.stringify({
      ...reply,
      message_id: "<storica-sintetica@peer.example.test>",
      references: historicalReview.candidate.message_ids,
      from_address: historicalReview.candidate.address,
    }),
  ]);
  eq(recordedHistorical.status, "registered");
  eq((await conv(historicalId)).status, "replied");
  eq(
    await value("select stage as v from public.partners where id=$1", [historicalPartner]),
    "trattativa",
  );
  eq(
    await value("select status as v from public.tasks where description=$1", [
      `Partner CO ${historicalReview.candidate.co} · ambiguous`,
    ]),
    "done",
  );
  await release();
  eq((await reviewHistoricalReply()).status, "idle");

  // Se il team ha già registrato la risposta nel frattempo, il recupero non crea un duplicato.
  const [manualPartner] = await sent(1, { club: false, day: "2026-11-02" });
  await asOwner("update public.partners set stage='contattato' where id=$1", [manualPartner]);
  await initializeFollowupFixtures([manualPartner]);
  c = await claim();
  eq(c.candidate.partner_id, manualPartner);
  eq((await check(c, "found", "reply")).status, "blocked");
  await release();
  const manualActivity = await value(
    `select private.partner_log(gen_random_uuid(),$1,'risposta',$2,p_channel=>'email',
      p_body=>'Nota sintetica del team',p_occurred_at=>timestamptz '2026-11-10T08:56:00Z') as v`,
    [manualPartner, founder],
  );
  now = "2026-11-10T11:00:00Z";
  const interruptedReview = await reviewHistoricalReply();
  eq(interruptedReview.candidate.partner_id, manualPartner);
  await release();
  eq((await reviewHistoricalReply()).status, "idle");
  now = "2026-11-11T11:00:00Z";
  const manualReview = await reviewHistoricalReply();
  eq(manualReview.candidate.partner_id, manualPartner);
  eq((await conv(manualReview.candidate.id)).reply_review_attempts, 2);
  const manualReply = {
    ...reply,
    message_id: "<gia-registrata@peer.example.test>",
    references: manualReview.candidate.message_ids,
    from_address: manualReview.candidate.address,
  };
  eq(
    (
      await service("record_partner_followup_reply", [
        manualReview.lease_token,
        manualReview.candidate.id,
        manualReview.candidate.version,
        JSON.stringify(manualReply),
      ])
    ).status,
    "already_recorded",
  );
  eq(
    await value(
      "select jsonb_agg(id) as v from public.partner_activities where partner_id=$1 and kind='risposta'",
      [manualPartner],
    ),
    [manualActivity],
  );
  eq((await conv(manualReview.candidate.id)).status, "replied");
  await release();

  console.log(`PASS ${checks} controlli`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.close();
}
