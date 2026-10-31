// test-db: pglite minimo 96
// Assistente Partner, modalità modello per i club (_assistente_partner_modello.sql): la bozza del testo
// fisso composta dal codice e salvata con nota di ricerca sostitutiva e scelta, la seconda lettura che
// manda a Tommi una bozza del modello bocciata, il tetto di 20 bozze del modello pronte nella presa del
// lavoro. Migrazioni applicate in ordine su PGlite, auth.uid() come in produzione. Solo dati sintetici
// (CO da 951, domini example.test), nessun accesso cloud.
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
const rejects = async (fn, code, message) => {
  let e;
  try {
    await fn();
  } catch (x) {
    e = x;
  }
  ok(e, `Atteso un errore ${code}`);
  eq(e.code, code, `Codice atteso ${code} (${e.message})`);
  if (message) eq(e.message, message);
};

const fixtureId = (n) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const founder = fixtureId(901),
  assistant = fixtureId(990);
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const WORKER = randomUUID();
const PHONE = "+39 000 000 0001";

const migrations = new URL("../migrations/", import.meta.url);
const migration = (suffix) => {
  const names = readdirSync(migrations).filter((n) => n.endsWith(suffix));
  assert.equal(names.length, 1, `Una sola migrazione ${suffix}`);
  return readFileSync(new URL(names[0], migrations), "utf8");
};
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const value = async (sql, args = []) => (await one(sql, args))?.v;
const asOwner = (sql, args) => (args ? db.query(sql, args) : db.exec(sql));

async function as(role, sub, fn) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(sub ? { sub, role } : { role }),
    ]);
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
const worker = (name, payload, op = randomUUID()) =>
  as("service_role", null, () =>
    rpc(`select public.${name}($1, $2::jsonb) r`, [
      op,
      JSON.stringify({ schema_version: 1, ...payload }),
    ]),
  );
const claim = () =>
  as("service_role", null, () =>
    rpc("select public.claim_partner_assistant_step($1, 360) r", [WORKER]),
  );
const context = (job) =>
  as("service_role", null, () =>
    rpc("select public.context_partner_assistant_step($1, $2) r", [job.job_id, job.lease_token]),
  );

// Schede e contatti.
const ids = new Map();
async function scheda(co, { sections = ["club"], country = "Germania", priority = "media" } = {}) {
  const partnerId = randomUUID();
  ids.set(co, partnerId);
  await asOwner(
    `insert into public.partners(id, co, name, origin, stage, created_by, sections, priority, contact_month, country)
     values ($1, $2, $3, 'team', 'da_contattare', $4, $5::text[], $6, date '2026-11-01', $7)`,
    [partnerId, co, `Porsche Club Sintetico ${co}`, founder, sections, priority, country],
  );
  await asOwner(
    `insert into public.partner_contacts(partner_id, kind, value, link_value, created_by, updated_by)
     values ($1, 'email', $2, $2, $3, $3)`,
    [partnerId, `info@club-${co}.example.test`, founder],
  );
  return partnerId;
}
const jobOf = (co) =>
  one("select * from public.partner_assistant_jobs where partner_id = $1", [ids.get(co)]);
const contactOf = (co) =>
  value("select id as v from public.partner_contacts where partner_id = $1 and kind = 'email'", [
    ids.get(co),
  ]);
const versionOf = (co) =>
  value("select version::int as v from public.partners where id = $1", [ids.get(co)]);
const rulesVersion = () =>
  value("select max(version)::int as v from public.partner_assistant_rules");

/** Il payload della bozza del modello, come lo manda il worker: impronta su oggetto, corpo e firma. */
async function templatePayload(job, co, overrides = {}) {
  const subject =
    overrides.subject ?? `T-Shirts für die Mitglieder des Porsche Club Sintetico ${co}`;
  const body =
    overrides.body ??
    "Sehr geehrte Damen und Herren,\n\nTesto sintetico del modello.\n\nVielen Dank und freundliche Grüße";
  const signature =
    overrides.signature ?? `Tommaso Ieri\nGründer, LuckyLap\n${PHONE}\nhttps://luckylap.com`;
  const draft = {
    language: "de",
    subject,
    body,
    signature,
    sha256: sha(`${subject}\n\n${body}\n\n${signature}`),
    rules_version: await rulesVersion(),
    partner_version: await versionOf(co),
    contact_id: await contactOf(co),
    ...overrides.draft,
  };
  return {
    job_id: job.job_id,
    lease_token: job.lease_token,
    template_version: 1,
    register: "sie",
    timezone: "Europe/Berlin",
    porsche_community: true,
    swiss: false,
    draft,
    checks_ok: true,
    failures: [],
    ...overrides.top,
  };
}
const review = (job, draftSha, approved, problems = []) =>
  worker("complete_partner_assistant_review", {
    job_id: job.job_id,
    lease_token: job.lease_token,
    approved,
    problems,
    sha256: draftSha,
    model: approved || problems[0] !== "regole_superate" ? "claude-opus-5-5" : null,
    rules_version: 1,
  });
const lastEvent = (co) =>
  one(
    "select step, outcome from private.partner_assistant_events where partner_id = $1 order by created_at desc, id desc limit 1",
    [ids.get(co)],
  );

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
  await asOwner("update private.partner_assistant_config set mode = 'prepara' where singleton");

  // 1. Permessi: la RPC nuova solo a service_role, gli aiuti a nessun ruolo client.
  for (const [fn, roles] of [
    ["private.complete_partner_assistant_template(uuid, jsonb)", ["service_role"]],
    ["public.complete_partner_assistant_template(uuid, jsonb)", ["service_role"]],
    ["private.partner_assistant_lock_any_step(uuid, uuid, text[])", []],
    ["private.partner_assistant_is_template(uuid)", []],
    ["private.complete_partner_assistant_review(uuid, jsonb)", ["service_role"]],
    ["private.claim_partner_assistant_step(uuid, integer)", ["service_role"]],
  ])
    for (const role of ["anon", "authenticated", "service_role"])
      eq(
        await value("select has_function_privilege($1, $2, 'execute') as v", [role, fn]),
        roles.includes(role),
        `${role} su ${fn}`,
      );
  eq(
    await value(
      "select prosecdef and proconfig @> array['search_path=\"\"'] as v from pg_proc where oid = 'private.complete_partner_assistant_template(uuid, jsonb)'::regprocedure",
    ),
    true,
    "security definer con search_path vuoto",
  );
  await rejects(
    () =>
      as("authenticated", founder, () =>
        rpc("select public.complete_partner_assistant_template($1, '{}'::jsonb) r", [randomUUID()]),
      ),
    "42501",
  );

  // 2. Un club alla ricerca: bozza del modello, note e lavoro in una transazione.
  await scheda(951);
  let claimed = await claim();
  eq(claimed.status, "claimed");
  let job = claimed.job;
  eq(job.step, "ricerca");
  const op = randomUUID();
  const payload = await templatePayload(job, 951);
  const done = await worker("complete_partner_assistant_template", payload, op);
  eq(done, { status: "done", job_status: "in_coda", step: "controllo", replayed: false });
  let row = await jobOf(951);
  eq(
    [row.status, row.step, row.attempts, row.rewrites, row.lease_token, row.reason],
    ["in_coda", "controllo", 0, 0, null, null],
  );
  const research = await one("select * from public.partner_assistant_notes where id = $1", [
    row.research_note_id,
  ]);
  eq([research.kind, research.model, research.sources], ["ricerca", null, []]);
  eq([research.content.template, research.content.template_version], [true, 1]);
  ok(research.content.text.startsWith("Nessuna ricerca: bozza dal testo fisso per i club"));
  const choice = await one("select * from public.partner_assistant_notes where id = $1", [
    row.choice_note_id,
  ]);
  eq(choice.kind, "scelta");
  eq(
    Object.keys(choice.content).length,
    25,
    "le 24 chiavi della scelta (richiesta compresa) e la decisione",
  );
  eq(
    [
      choice.content.contact_kind,
      choice.content.request,
      choice.content.language,
      choice.content.register,
      choice.content.timezone,
      choice.content.porsche_community,
      choice.content.swiss,
      choice.content.recipient_email,
      choice.content.reason_it,
    ],
    [
      "club",
      "merch_cobranding",
      "de",
      "sie",
      "Europe/Berlin",
      true,
      false,
      "",
      "Testo fisso per i club, versione 1, approvato da Tommaso.",
    ],
  );
  eq(choice.content.decision, { kind: "scrivi" });
  const draft = await one("select * from public.partner_assistant_drafts where id = $1", [
    row.draft_id,
  ]);
  eq(
    [draft.research_note_id, draft.sha256, draft.language, draft.created_by],
    [row.research_note_id, payload.draft.sha256, "de", assistant],
  );
  eq(
    await value("select private.partner_assistant_is_template($1) as v", [draft.research_note_id]),
    true,
  );
  eq(await lastEvent(951), { step: "ricerca", outcome: "modello" });
  eq(
    await value(
      "select count(*)::int as v from public.partner_assistant_notes where partner_id = $1",
      [ids.get(951)],
    ),
    2,
    "solo ricerca e scelta: nessuna nota controllo",
  );
  // La stessa operazione ripetuta: la ricevuta, niente di nuovo; con un altro payload: conflitto.
  eq(await worker("complete_partner_assistant_template", payload, op), { ...done, replayed: true });
  eq(await value("select count(*)::int as v from public.partner_assistant_drafts"), 1);
  await rejects(
    () => worker("complete_partner_assistant_template", { ...payload, swiss: true }, op),
    "23505",
  );

  // 3. Al controllo il contesto rilegge la nota sostitutiva e la scelta del modello.
  claimed = await claim();
  job = claimed.job;
  eq([claimed.status, job.step], ["claimed", "controllo"]);
  const ctx = await context(job);
  eq(ctx.status, "ok");
  eq(ctx.choice.content.reason_it, "Testo fisso per i club, versione 1, approvato da Tommaso.");
  ok(ctx.research.text.startsWith("Nessuna ricerca"));
  eq(ctx.draft.draft_id, draft.id);

  // 4. Bozza del modello bocciata: a Tommi, nessuna riscrittura.
  eq(await review(job, draft.sha256, false, ["Il nome del club è scritto male."]), {
    status: "done",
    job_status: "serve_tommaso",
    step: "controllo",
    replayed: false,
  });
  row = await jobOf(951);
  eq([row.status, row.reason, row.rewrites], ["serve_tommaso", "modello_bocciato", 0]);
  eq(await lastEvent(951), { step: "controllo", outcome: "modello_bocciato" });

  // 5. Approvata con l'impronta: pronta, e la coda d'invio la vede (si unisce alla nota sostitutiva).
  await scheda(952);
  job = (await claim()).job;
  const p952 = await templatePayload(job, 952);
  await worker("complete_partner_assistant_template", p952);
  job = (await claim()).job;
  eq(job.step, "controllo");
  eq((await review(job, p952.draft.sha256, true)).job_status, "pronta");
  eq(
    (await all("select partner_id from private.partner_assistant_send_order()")).map(
      (r) => r.partner_id,
    ),
    [ids.get(952)],
  );

  // 6. Regole cambiate: torna in scrittura e si ricompone con il modello, senza Claude.
  await scheda(953);
  job = (await claim()).job;
  const p953 = await templatePayload(job, 953);
  await worker("complete_partner_assistant_template", p953);
  job = (await claim()).job;
  eq((await review(job, p953.draft.sha256, false, ["regole_superate"])).step, "scrittura");
  row = await jobOf(953);
  eq([row.status, row.step, row.rewrites], ["in_coda", "scrittura", 0]);
  job = (await claim()).job;
  eq(job.step, "scrittura");
  eq(
    (await worker("complete_partner_assistant_template", await templatePayload(job, 953))).step,
    "controllo",
  );
  eq(await lastEvent(953), { step: "scrittura", outcome: "modello" });
  job = (await claim()).job;
  await review(
    job,
    (
      await one(
        "select d.sha256 from public.partner_assistant_drafts d join public.partner_assistant_jobs j on j.draft_id = d.id where j.partner_id = $1",
        [ids.get(953)],
      )
    ).sha256,
    true,
  );

  // 7. Contesto cambiato a metà passo: niente scritto, lease rilasciata, nessun tentativo.
  await scheda(954);
  const notesBefore = await value("select count(*)::int as v from public.partner_assistant_notes");
  for (const [label, change, undo] of [
    [
      "sezione",
      "update public.partners set sections = array['collab'] where co = 954",
      "update public.partners set sections = array['club'] where co = 954",
    ],
    ["scheda", "update public.partners set version = version + 1 where co = 954", null],
  ]) {
    job = (await claim()).job;
    const p = await templatePayload(job, 954);
    await asOwner(change);
    eq(
      await worker("complete_partner_assistant_template", p),
      { status: "contesto_cambiato" },
      label,
    );
    row = await jobOf(954);
    eq([row.lease_token, row.attempts, row.status], [null, 0, "in_coda"], label);
    eq(await lastEvent(954), { step: "ricerca", outcome: "contesto_cambiato" }, label);
    if (undo) await asOwner(undo);
  }
  job = (await claim()).job;
  const otherContact = await value(
    `insert into public.partner_contacts(partner_id, kind, value, link_value, verified, created_by, updated_by)
     values ($1, 'email', 'altro@club-954.example.test', 'altro@club-954.example.test', true, $2, $2)
     returning id as v`,
    [ids.get(954), founder],
  );
  ok(otherContact);
  eq(
    await worker(
      "complete_partner_assistant_template",
      await templatePayload(job, 954, { draft: { contact_id: await contactOf(954) } }),
    ),
    { status: "contesto_cambiato" },
    "email cambiata",
  );
  eq(await value("select count(*)::int as v from public.partner_assistant_notes"), notesBefore);

  // 8. Payload non validi: errore d'uso, niente scritto.
  job = (await claim()).job;
  const base = await templatePayload(job, 954, {
    draft: {
      contact_id: await value("select contact_id as v from private.partner_assistant_email($1)", [
        ids.get(954),
      ]),
    },
  });
  for (const [, bad] of [
    ["registro non della lingua", { ...base, register: "vous" }],
    ["fuso inesistente", { ...base, timezone: "Mars/Base" }],
    ["impronta diversa", { ...base, draft: { ...base.draft, sha256: "a".repeat(64) } }],
    ["controlli ok con problemi", { ...base, failures: ["lunghezza"] }],
    ["chiave in più", { ...base, extra: true }],
  ])
    await rejects(
      () => worker("complete_partner_assistant_template", bad),
      "22023",
      `invalid_partner_payload`,
    );

  // 9. Controlli del codice falliti: bozza salvata, nota controllo, a Tommi senza riscrittura.
  eq(
    await worker("complete_partner_assistant_template", {
      ...base,
      checks_ok: false,
      failures: ["lunghezza"],
    }),
    { status: "done", job_status: "serve_tommaso", step: "controllo", replayed: false },
  );
  row = await jobOf(954);
  eq([row.reason, row.rewrites], ["modello_controlli", 0]);
  eq(
    (
      await one(
        "select content from public.partner_assistant_notes where partner_id = $1 and kind = 'controllo'",
        [ids.get(954)],
      )
    ).content,
    { approved: false, problems: ["lunghezza"] },
  );
  eq(await lastEvent(954), { step: "ricerca", outcome: "modello_controlli" });

  // 10. Passo sbagliato e lease persa.
  await scheda(955);
  job = (await claim()).job;
  const p955 = await templatePayload(job, 955);
  eq(await worker("complete_partner_assistant_template", { ...p955, lease_token: randomUUID() }), {
    status: "lease_persa",
  });
  await worker("complete_partner_assistant_template", p955);
  job = (await claim()).job;
  eq(job.step, "controllo");
  await rejects(
    () =>
      worker("complete_partner_assistant_template", {
        ...p955,
        job_id: job.job_id,
        lease_token: job.lease_token,
      }),
    "22023",
    "invalid_partner_payload",
  );
  await review(job, p955.draft.sha256, true);

  // 11. Una bozza scritta da Claude bocciata: riscrittura come prima.
  await scheda(956, { sections: ["collab"] });
  job = (await claim()).job;
  await worker("complete_partner_assistant_research", {
    job_id: job.job_id,
    lease_token: job.lease_token,
    text: "Ricerca sintetica.",
    sources: [],
    model: "claude-opus-5-5",
    rules_version: 1,
  });
  eq(
    await value(
      "select private.partner_assistant_is_template(research_note_id) as v from public.partner_assistant_jobs where partner_id = $1",
      [ids.get(956)],
    ),
    false,
  );
  await asOwner(
    "update public.partner_assistant_jobs set status = 'serve_tommaso', reason = 'troppi_tentativi' where partner_id = $1",
    [ids.get(956)],
  );

  // 12. Tetto: con 20 bozze del modello pronte i club prima del controllo aspettano; gli altri no.
  // Già pronte: 952, 953 e 955. Altre 17 portano a 20.
  for (let co = 960; co < 977; co++) {
    await scheda(co, { priority: "alta" });
    job = (await claim()).job;
    const p = await templatePayload(job, co);
    await worker("complete_partner_assistant_template", p);
    job = (await claim()).job;
    await review(job, p.draft.sha256, true);
  }
  eq(
    await value(
      "select count(*)::int as v from public.partner_assistant_jobs where status = 'pronta'",
    ),
    20,
    "20 bozze del modello pronte",
  );
  await scheda(990);
  eq(await claim(), { status: "idle", reason: "vuota" }, "un club alla ricerca aspetta");
  row = await jobOf(990);
  eq([row.status, row.step], ["in_coda", "ricerca"], "il lavoro c'è, fermo in coda");
  await scheda(991, { sections: ["collab"] });
  const other = await claim();
  eq([other.status, other.job.partner_id], ["claimed", ids.get(991)], "un contatto non club passa");
  await worker("complete_partner_assistant_research", {
    job_id: other.job.job_id,
    lease_token: other.job.lease_token,
    text: "Ricerca sintetica.",
    sources: [],
    model: "claude-opus-5-5",
    rules_version: 1,
  });
  await asOwner(
    "update public.partner_assistant_jobs set status = 'serve_tommaso', reason = 'troppi_tentativi' where partner_id = $1",
    [ids.get(991)],
  );
  // Una pronta che esce (inviata) libera il posto.
  await asOwner(
    "update public.partner_assistant_jobs set status = 'inviata' where partner_id = $1",
    [ids.get(960)],
  );
  const freed = await claim();
  eq([freed.status, freed.job.partner_id, freed.job.step], ["claimed", ids.get(990), "ricerca"]);

  console.log(
    `PASS ${checks} Assistente Partner modalità modello per i club: PGlite con dati sintetici.`,
  );
} finally {
  await db.close();
}
