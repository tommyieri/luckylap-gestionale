// test-db: pglite minimo 315
// Modifica editoriale una tantum delle bozze Club già pronte: cinque lingue, append-only,
// provenienza dell'approvazione, scadenza originale, contesti superati, posta, atomicità e ripetizione.
// Solo dati sintetici, nessuna rete o chiamata a Claude. Gli oggetti SQL sono quelli delle migrazioni.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (!process.argv[2])
  throw new Error("Passare il percorso esterno di @electric-sql/pglite/dist/index.js.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const eq = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const ok = (actual, message) => {
  assert.ok(actual, message);
  checks++;
};
const rejects = async (fn, message) => {
  let error;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  ok(error, `Atteso ${message}`);
  eq(error.code, "55000");
  eq(error.message, message);
};
const fixtureId = (n) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const founder = fixtureId(901);
const assistant = fixtureId(990);
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const migrations = new URL("../migrations/", import.meta.url);
const migration = (suffix) => {
  const names = readdirSync(migrations).filter((name) => name.endsWith(suffix));
  assert.equal(names.length, 1, `Una sola migrazione ${suffix}`);
  return readFileSync(new URL(names[0], migrations), "utf8");
};
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const value = async (sql, args = []) => (await one(sql, args))?.v;
const editorialSql = migration("_assistente_partner_club_generici.sql");
const applyEditorial = async () => {
  try {
    await db.exec(editorialSql);
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
};
const TEXT = {
  it: [
    "Abbiamo già avviato collaborazioni con alcuni Porsche Club in Italia: per il Porsche Club Toscana abbiamo realizzato 150 magliette dedicate ai soci, con il logo del club ricamato sulla manica.",
    "Abbiamo già avviato alcune collaborazioni con Porsche Club in Italia, realizzando magliette dedicate ai soci con il logo del club ricamato sulla manica.",
  ],
  en: [
    "We have already started working with several Porsche Clubs in Italy: for the Porsche Club Toscana we made 150 T-shirts for its members, with the club logo embroidered on the sleeve.",
    "We have already started working with some Porsche Clubs in Italy, creating T-shirts for their members with the club logo embroidered on the sleeve.",
  ],
  de: [
    "Wir arbeiten bereits mit einigen Porsche Clubs in Italien zusammen: Für den Porsche Club Toscana haben wir 150 T-Shirts für die Mitglieder gefertigt, mit dem Clublogo auf dem Ärmel gestickt.",
    "Wir haben bereits einige Kooperationen mit Porsche Clubs in Italien begonnen und T-Shirts für die Mitglieder mit dem auf den Ärmel gestickten Clublogo gefertigt.",
  ],
  fr: [
    "Nous avons déjà lancé des collaborations avec plusieurs Porsche Clubs en Italie : pour le Porsche Club Toscana, nous avons réalisé 150 t-shirts dédiés aux membres, avec le logo du club brodé sur la manche.",
    "Nous avons déjà lancé quelques collaborations avec des Porsche Clubs en Italie, en réalisant des t-shirts dédiés aux membres avec le logo du club brodé sur la manche.",
  ],
  es: [
    "Ya hemos empezado a colaborar con varios Porsche Club en Italia: para el Porsche Club Toscana hicimos 150 camisetas dedicadas a los socios, con el logotipo del club bordado en la manga.",
    "Ya hemos iniciado algunas colaboraciones con Porsche Club en Italia, realizando camisetas dedicadas a los socios con el logotipo del club bordado en la manga.",
  ],
};

let nextCo = 951;
const fixtures = [];
async function ready(language = "it", options = {}) {
  const co = nextCo++;
  const partner = randomUUID();
  const signature = "Nome Sintetico\nRuolo sintetico\n+39 000 000 0001\nhttps://club.example.test";
  const subject = `Proposta sintetica per il club ${co}`;
  const body =
    options.body ??
    `Saluto sintetico,\n\n${TEXT[language][0]}\n\nTesto e marca invariati: 300 SL, F40, 512 TR, 964 e GT3 RS.\n\nUna proposta?\n\nSaluto finale,`;
  await db.query(
    `insert into public.partners(id, co, name, origin, stage, created_by, sections, priority, country,
       contact_month) values ($1, $2, $3, 'team', 'da_contattare', $4, $5, 'media', 'Germania', date '2026-11-01')`,
    [partner, co, `Club Sintetico ${co}`, founder, options.sections ?? ["club"]],
  );
  const contact = await value(
    `insert into public.partner_contacts(partner_id, kind, value, link_value, created_by, updated_by)
     values ($1, 'email', $2, $2, $3, $3) returning id as v`,
    [partner, `club-${co}@club.example.test`, founder],
  );
  const research = await value(
    `insert into public.partner_assistant_notes(partner_id, kind, content, sources, rules_version, model,
       operation_id, created_by, created_at)
     values ($1, 'ricerca', $2::jsonb, '{}', 1, null, gen_random_uuid(), $3,
       now() - $4::interval) returning id as v`,
    [
      partner,
      JSON.stringify({
        text: "Nota sostitutiva sintetica del modello, versione 2.",
        template: options.template ?? true,
        template_version: options.templateVersion ?? 2,
      }),
      assistant,
      options.researchAge ?? "2 days",
    ],
  );
  const choice = await value(
    `insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model,
       operation_id, created_by, created_at)
     values ($1, 'scelta', $2::jsonb, 1, null, gen_random_uuid(), $3, now() - interval '1 day') returning id as v`,
    [
      partner,
      JSON.stringify({
        contact_kind: "club",
        request: "merch_cobranding",
        timezone: "Europe/Berlin",
        language,
        register: language === "it" ? "voi" : "you",
        event_starts_on: "",
        reason_it: "Testo fisso per i club, versione 2, approvato da Tommaso.",
      }),
      assistant,
    ],
  );
  const digest = options.badDigest ? "0".repeat(64) : sha(`${subject}\n\n${body}\n\n${signature}`);
  const draft = await value(
    `insert into public.partner_assistant_drafts(partner_id, contact_id, partner_version, language,
       subject, body, signature, sha256, rules_version, research_note_id, operation_id, created_by, created_at)
     values ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, gen_random_uuid(), $10, now() - interval '12 hours')
     returning id as v`,
    [
      partner,
      contact,
      language,
      subject,
      body,
      signature,
      digest,
      options.rulesVersion ?? 1,
      research,
      assistant,
    ],
  );
  let review = null;
  if (!options.noReview)
    review = await value(
      `insert into public.partner_assistant_notes(partner_id, kind, content, rules_version, model,
         operation_id, created_by, created_at)
       values ($1, 'controllo', $2::jsonb, 1, $5, gen_random_uuid(), $3,
         now() - $4::interval) returning id as v`,
      [
        partner,
        JSON.stringify({
          approved: true,
          problems: [],
          sha256: options.badReview ? "f".repeat(64) : digest,
        }),
        assistant,
        options.reviewAge ?? "11 hours",
        Object.hasOwn(options, "reviewModel") ? options.reviewModel : "claude-opus-5-5",
      ],
    );
  await db.query(
    `insert into public.partner_assistant_jobs(partner_id, status, step, research_note_id, choice_note_id,
       draft_id, reason) values ($1, $2, 'controllo', $3, $4, $5,
       case when $2 = 'serve_tommaso' then 'modello_bocciato' else null end)`,
    [partner, options.status ?? "pronta", research, choice, draft],
  );
  if (options.inactive)
    await db.query(
      "insert into public.partner_assistant_contacts(partner_id, active, updated_by) values ($1, false, $2)",
      [partner, founder],
    );
  if (options.newVersion)
    await db.query("update public.partners set version = version + 1 where id = $1", [partner]);
  if (options.newEmail)
    await db.query(
      `insert into public.partner_contacts(partner_id, kind, value, link_value, verified, created_by, updated_by)
       values ($1, 'email', $2, $2, true, $3, $3)`,
      [partner, `new-${co}@club.example.test`, founder],
    );
  const fixture = {
    co,
    partner,
    contact,
    research,
    choice,
    draft,
    review,
    language,
    subject,
    body,
    signature,
  };
  fixtures.push(fixture);
  return fixture;
}
const job = (fixture) =>
  value("select to_jsonb(j) as v from public.partner_assistant_jobs j where partner_id = $1", [
    fixture.partner,
  ]);
const active = (fixture, enabled) =>
  db.query(
    `insert into public.partner_assistant_contacts(partner_id, active, updated_by) values ($1, $2, $3)
     on conflict (partner_id) do update set active = excluded.active`,
    [fixture.partner, enabled, founder],
  );
const snapshot = () =>
  one(`select
    (select jsonb_agg(to_jsonb(n) order by n.id) from public.partner_assistant_notes n) as notes,
    (select jsonb_agg(to_jsonb(d) order by d.id) from public.partner_assistant_drafts d) as drafts,
    (select jsonb_agg(to_jsonb(j) order by j.partner_id) from public.partner_assistant_jobs j) as jobs,
    (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb) from private.partner_assistant_events e) as events`);
async function message(fixture, status, mode = "prova", { previousDraft = false } = {}) {
  const messageDraft = previousDraft
    ? await value(
        `insert into public.partner_assistant_drafts(partner_id, contact_id, partner_version, language,
       subject, body, signature, sha256, rules_version, research_note_id, operation_id, created_by)
     select partner_id, contact_id, partner_version, language, subject, body, signature, sha256,
       rules_version, research_note_id, gen_random_uuid(), created_by
       from public.partner_assistant_drafts where id = $1 returning id as v`,
        [fixture.draft],
      )
    : fixture.draft;
  let run = null;
  if (mode === "prova")
    run = await value(
      `insert into private.partner_assistant_test_runs(draft_ids, recipients, requested_by)
       values ($1, 1, $2) returning id as v`,
      [[fixture.draft], founder],
    );
  const raw = "MIME-Version: 1.0\r\n\r\nTesto sintetico\r\n";
  await db.query(
    `insert into public.partner_assistant_messages(partner_id, draft_id, kind, mode, send_status,
       test_run_id, test_index, message_id, to_address, subject, body, raw, sha256, rules_version,
       lease_token, operation_id, created_by, send_day, sent_at, appended_at)
     values ($1, $2, 'primo', $3, $4, $5, $6, $7, $8, 'Oggetto sintetico', 'Corpo sintetico', $9,
       $10, 1, gen_random_uuid(), gen_random_uuid(), $11,
       case when $4 in ('pronto', 'scartato') then null else current_date end,
       case when $4 in ('inviato', 'incerto') then now() else null end,
       case when $4 = 'inviato' then now() else null end)`,
    [
      fixture.partner,
      messageDraft,
      mode,
      status,
      run,
      mode === "prova" ? 0 : null,
      `<${randomUUID()}@club.example.test>`,
      `club-${fixture.co}@club.example.test`,
      raw,
      sha(raw),
      assistant,
    ],
  );
}

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
  ])
    await db.exec(migration(suffix));
  for (const [id, name, role] of [
    [founder, "Fondatore sintetico", "founder"],
    [assistant, "Assistente sintetico", null],
  ]) {
    await db.query("insert into auth.users values ($1)", [id]);
    await db.query("insert into public.profiles(user_id, display_name) values ($1, $2)", [
      id,
      name,
    ]);
    if (role)
      await db.query(
        "insert into public.memberships(user_id, role, active) values ($1, $2, true)",
        [id, role],
      );
  }
  await db.query(
    "update private.partner_assistant_config set mode = 'invio', actor_id = $1, handoff_to = $2, paused_reason = 'credito'",
    [assistant, founder],
  );
  const valid = [];
  for (const language of Object.keys(TEXT)) valid.push(await ready(language));
  const skipped = [];
  for (const options of [
    { status: "inviata" },
    { status: "serve_tommaso" },
    { status: "attesa" },
    { template: false },
    { templateVersion: 3 },
    { sections: ["collab"] },
    { sections: ["club", "eventi"] },
    { inactive: true },
    { rulesVersion: 2 },
    { newVersion: true },
    { newEmail: true },
    { noReview: true },
    { badReview: true },
    { reviewModel: null },
    { reviewAge: "13 hours" },
    { researchAge: "21 days 1 minute" },
    { badDigest: true },
  ])
    skipped.push(await ready("it", options));
  for (const status of ["pronto", "in_invio", "inviato", "incerto", "scartato", "respinto"]) {
    const fixture = await ready();
    await message(fixture, status);
    skipped.push(fixture);
  }
  for (const status of ["pronto", "in_invio", "inviato", "incerto"]) {
    const fixture = await ready();
    await message(fixture, status, "invio", { previousDraft: true });
    skipped.push(fixture);
  }
  const malformed = [];
  for (const body of [
    "Testo diverso, senza la frase approvata.",
    `${TEXT.it[0]}\n${TEXT.it[0]}`,
    `${TEXT.it[0]}\nUn'altra frase su Toscana.`,
    `${TEXT.it[0]}\nNumero rimasto: 150.`,
  ])
    malformed.push(await ready("it", { body, inactive: true }));

  // Una lease attiva, anche di un altro lavoro, impone di riprovare a casella libera.
  for (const table of ["private.partner_assistant_mail_state", "public.partner_assistant_jobs"]) {
    await db.exec(
      `update ${table} set lease_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '5 minutes'`,
    );
    const before = await snapshot();
    await rejects(applyEditorial, "partner_assistant_club_editorial_busy");
    eq(await snapshot(), before, "Nessuna modifica con lease attiva");
    await db.exec(`update ${table} set lease_token = null, lease_expires_at = null`);
  }
  await db.query("update private.partner_assistant_config set handoff_to = $1", [assistant]);
  const beforeFounder = await snapshot();
  await rejects(applyEditorial, "partner_assistant_club_editorial_founder_required");
  eq(await snapshot(), beforeFounder, "Nessuna approvazione attribuita a un profilo non founder");
  await db.query("update private.partner_assistant_config set handoff_to = $1", [founder]);
  await db.query("update public.memberships set active = false where user_id = $1", [founder]);
  await rejects(applyEditorial, "partner_assistant_club_editorial_founder_required");
  await db.query("update public.memberships set active = true where user_id = $1", [founder]);

  // Non approvare differenze aggiuntive: un errore annulla anche eventuali righe già copiate.
  for (const fixture of malformed) {
    await active(fixture, true);
    const before = await snapshot();
    await rejects(applyEditorial, "partner_assistant_club_editorial_text_changed");
    eq(await snapshot(), before, "Modifica atomica: niente righe parziali");
    await active(fixture, false);
  }

  const original = await snapshot();
  const configBefore = await one("select * from private.partner_assistant_config");
  const mailBefore = await one("select * from private.partner_assistant_mail_state");
  const partnersBefore = (await db.query("select * from public.partners order by id")).rows;
  const messagesBefore = (
    await db.query("select * from public.partner_assistant_messages order by id")
  ).rows;
  await applyEditorial();
  eq(
    await one("select * from private.partner_assistant_config"),
    configBefore,
    "Modalità e pausa credito restano identiche",
  );
  eq(
    await one("select * from private.partner_assistant_mail_state"),
    mailBefore,
    "La casella non cambia",
  );
  eq(
    (await db.query("select * from public.partners order by id")).rows,
    partnersBefore,
    "Schede e updated_at non cambiano",
  );
  eq(
    (await db.query("select * from public.partner_assistant_messages order by id")).rows,
    messagesBefore,
    "MIME e invii non cambiano",
  );
  eq(
    await value("select count(*)::int as v from private.partner_assistant_runs"),
    0,
    "Nessuna spesa o chiamata a Claude",
  );
  const after = await snapshot();
  eq(after.notes.length - original.notes.length, valid.length * 3);
  eq(after.drafts.length - original.drafts.length, valid.length);
  eq(after.events.length - original.events.length, valid.length);
  for (const old of original.notes)
    eq(
      await value("select to_jsonb(n) as v from public.partner_assistant_notes n where id = $1", [
        old.id,
      ]),
      old,
      "Nota originale immutata",
    );
  for (const old of original.drafts)
    eq(
      await value("select to_jsonb(d) as v from public.partner_assistant_drafts d where id = $1", [
        old.id,
      ]),
      old,
      "Bozza originale immutata",
    );

  for (const fixture of valid) {
    const changed = await job(fixture);
    const draft = await one("select * from public.partner_assistant_drafts where id = $1", [
      changed.draft_id,
    ]);
    const research = await one("select * from public.partner_assistant_notes where id = $1", [
      changed.research_note_id,
    ]);
    const choice = await one("select * from public.partner_assistant_notes where id = $1", [
      changed.choice_note_id,
    ]);
    const review = await one(
      "select * from public.partner_assistant_notes where kind = 'controllo' and content ->> 'sha256' = $1 and partner_id = $2",
      [draft.sha256, fixture.partner],
    );
    eq(changed.status, "pronta");
    eq(
      draft.body,
      fixture.body.replace(...TEXT[fixture.language]),
      "Solo la frase approvata cambia nell'intero corpo",
    );
    eq(
      [draft.subject, draft.signature, draft.language, draft.contact_id, draft.partner_version],
      [fixture.subject, fixture.signature, fixture.language, fixture.contact, 1],
    );
    ok(!/Toscana|150/iu.test(draft.body));
    eq(draft.sha256, sha(`${draft.subject}\n\n${draft.body}\n\n${draft.signature}`));
    eq(
      new Date(research.created_at).getTime(),
      new Date(original.notes.find((row) => row.id === fixture.research).created_at).getTime(),
      "Il TTL non riparte",
    );
    eq(research.content.template_version, 3);
    ok(
      /^Nessuna ricerca: bozza dal testo fisso per i club/u.test(research.content.text),
      "Il blocco UI riconosce il modello",
    );
    eq(research.content.approval_source, "founder_editorial");
    eq(research.content.previous_research_note_id, fixture.research);
    eq([choice.content.template_version, choice.content.approval_source], [3, "founder_editorial"]);
    eq(choice.content.previous_choice_note_id, fixture.choice);
    eq(
      choice.content.reason_it,
      "Testo fisso per i club, versione 3, approvato da Tommaso.",
      "Il worker riconosce la scelta del modello",
    );
    eq(
      [review.content.approved, review.content.problems, review.content.sha256],
      [true, [], draft.sha256],
    );
    eq(
      [review.content.previous_draft_id, review.content.previous_review_id],
      [fixture.draft, fixture.review],
    );
    eq([review.model, review.content.approval_source], [null, "founder_editorial"]);
    eq(
      [research.created_by, choice.created_by, draft.created_by, review.created_by],
      [founder, founder, founder, founder],
    );
    ok(new Date(review.created_at) >= new Date(draft.created_at));
    eq(
      await value(
        "select research_at as v from private.partner_assistant_send_order() where partner_id = $1",
        [fixture.partner],
      ),
      research.created_at,
    );
  }
  for (const fixture of [...skipped, ...malformed])
    eq(
      await job(fixture),
      original.jobs.find((row) => row.partner_id === fixture.partner),
      "Lavoro escluso intatto",
    );
  await applyEditorial();
  eq(await snapshot(), after, "Ripetere la migrazione non aggiunge altre versioni");

  // L'approvazione editoriale è riconosciuta dalla prepare esistente, senza nuova lettura di Claude.
  const changed = await job(valid[0]);
  const draft = await one("select * from public.partner_assistant_drafts where id = $1", [
    changed.draft_id,
  ]);
  const run = await value(
    "insert into private.partner_assistant_test_runs(draft_ids, recipients, requested_by) values ($1, 1, $2) returning id as v",
    [[draft.id], founder],
  );
  const lease = randomUUID();
  await db.query("update private.partner_assistant_config set mode = 'prova'");
  await db.query(
    "update private.partner_assistant_mail_state set lease_token = $1, lease_expires_at = clock_timestamp() + interval '5 minutes'",
    [lease],
  );
  const optOut = "Una frase sintetica per non ricevere altre email.";
  const messageId = `<${randomUUID()}@club.example.test>`;
  const payload = {
    schema_version: 1,
    job_id: changed.id,
    draft_id: draft.id,
    mode: "prova",
    test_run_id: run,
    test_index: 0,
    message_id: messageId,
    to_address: "proof@recipient.example.test",
    subject: draft.subject,
    text: `${draft.body}\n\n${draft.signature}\n\n${optOut}`,
    opt_out: optOut,
    raw: `MIME-Version: 1.0\r\nMessage-ID: ${messageId}\r\n\r\nTesto MIME sintetico\r\n`,
    mailbox_check: "vuota",
  };
  await db.exec("begin");
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await db.exec("set local role service_role");
  const prepared = await value(
    "select public.prepare_partner_assistant_send($1, $2, $3::jsonb) as v",
    [lease, randomUUID(), JSON.stringify(payload)],
  );
  await db.exec("commit");
  eq(prepared.status, "pronto", "L'impronta approvata da Tommi passa la prepare esistente");
  eq(await value("select count(*)::int as v from private.partner_assistant_runs"), 0);
  console.log(`PASS ${checks} controlli`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.close();
}
