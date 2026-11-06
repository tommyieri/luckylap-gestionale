// test-db: pglite minimo 205
// Prova ufficiale dei club con lookbook: coppia pronta, metadati immutabili, MIME grande solo in prova,
// pause preservate, compatibilità delle prove precedenti e recupero delle copie entro 4 MiB.
// Solo dati sintetici; nessuna rete, nessun PDF reale, nessuna chiamata a Claude.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) throw new Error("Passare il percorso esterno di PGlite.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const eq = (a, b, m) => {
  assert.deepEqual(a, b, m);
  checks++;
};
const ok = (a, m) => {
  assert.ok(a, m);
  checks++;
};
const rejects = async (task, code, message) => {
  let error;
  try {
    await task();
  } catch (e) {
    error = e;
  }
  ok(error, `Atteso errore ${code}`);
  eq(error.code, code);
  if (message) eq(error.message, message);
};
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const value = async (sql, args = []) => (await one(sql, args))?.v;
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const founder = "70000000-0000-4000-8000-000000000901";
const assistant = "70000000-0000-4000-8000-000000000990";
const member = "70000000-0000-4000-8000-000000000902";
let NOW = "2026-11-10T09:00:00Z";
const LOOKBOOK = {
  porsche_club: {
    code: "porsche_club",
    bytes: 2592305,
    sha256: "541ddb3b20f7daa46ef428c64ae5618996711409d1819e5dfd37e8cec8831f77",
  },
  club: {
    code: "club",
    bytes: 2444810,
    sha256: "923cf52ae33ba5dfc8e9271d1157a64719a925a14750ee96a0bd0eeb686942b1",
  },
};
const migration = (suffix) => {
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir).filter((n) => n.endsWith(suffix));
  assert.equal(files.length, 1, suffix);
  return readFileSync(new URL(files[0], dir), "utf8");
};
async function as(role, sub, task) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify(sub ? { role, sub } : { role }),
    ]);
    await db.query("select set_config('luckylap.partner_assistant.now',$1,true)", [NOW]);
    await db.exec(`set local role ${role}`);
    const result = await task();
    await db.exec("commit");
    return result;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const team = (name, payload, operation = randomUUID(), sub = founder) =>
  as("authenticated", sub, () =>
    value(`select public.${name}($1,$2::jsonb) as v`, [
      operation,
      JSON.stringify({ schema_version: 1, ...payload }),
    ]),
  );
const worker = (name, args = []) =>
  as("service_role", null, () =>
    value(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as v`, args),
  );
const claim = (recipients = 5) =>
  worker("claim_partner_assistant_send", [randomUUID(), 300, recipients]);
const release = () =>
  db.exec(
    "update private.partner_assistant_mail_state set lease_token=null,lease_expires_at=null,next_send_after=null,backoff_until=null,stop_reason=null,day_stopped_on=null",
  );
const mode = async (next, extra = {}) =>
  team("set_partner_assistant_mode", {
    mode: next,
    expected_version: await value("select version as v from private.partner_assistant_config"),
    ...extra,
  });
let nextCo = 951;
const readyRows = [];
async function ready(
  porsche,
  {
    version = 3,
    review = true,
    currentRules = true,
    sections = ["club"],
    partnerCurrent = true,
    emailCurrent = true,
  } = {},
) {
  const partner = randomUUID(),
    co = nextCo++;
  await db.query(
    `insert into public.partners(id,co,name,origin,stage,created_by,sections,priority,country,contact_month)
    values($1,$2,$3,'team','da_contattare',$4,$5,'media','Germania',date '2026-11-01')`,
    [partner, co, `Club sintetico ${co}`, founder, sections],
  );
  const contact = await value(
    `insert into public.partner_contacts(partner_id,kind,value,link_value,created_by,updated_by)
    values($1,'email',$2,$2,$3,$3) returning id as v`,
    [partner, `club-${co}@club.example.test`, founder],
  );
  const research = await value(
    `insert into public.partner_assistant_notes(partner_id,kind,content,rules_version,operation_id,created_by,created_at)
    values($1,'ricerca',$2,1,gen_random_uuid(),$3,'2026-11-09T06:00:00Z') returning id as v`,
    [
      partner,
      { text: "Nota sintetica del modello.", template: true, template_version: version },
      assistant,
    ],
  );
  const choice = await value(
    `insert into public.partner_assistant_notes(partner_id,kind,content,rules_version,operation_id,created_by)
    values($1,'scelta',$2,1,gen_random_uuid(),$3) returning id as v`,
    [
      partner,
      {
        contact_kind: "club",
        request: "merch_cobranding",
        timezone: "Europe/Berlin",
        language: "it",
        register: "voi",
        porsche_community: porsche,
        event_starts_on: "",
      },
      assistant,
    ],
  );
  const subject = `Proposta sintetica ${co}`,
    body = "Testo sintetico approvato per il club. Una proposta?",
    signature = "Nome Sintetico\nRuolo sintetico\nhttps://club.example.test";
  const digest = sha(`${subject}\n\n${body}\n\n${signature}`);
  const draft = await value(
    `insert into public.partner_assistant_drafts(partner_id,contact_id,partner_version,language,subject,body,signature,sha256,rules_version,research_note_id,operation_id,created_by,created_at)
    values($1,$2,$3,'it',$4,$5,$6,$7,$8,$9,gen_random_uuid(),$10,'2026-11-09T06:02:00Z') returning id as v`,
    [
      partner,
      contact,
      partnerCurrent ? 1 : 2,
      subject,
      body,
      signature,
      digest,
      currentRules ? 1 : 2,
      research,
      assistant,
    ],
  );
  if (review)
    await db.query(
      `insert into public.partner_assistant_notes(partner_id,kind,content,rules_version,model,operation_id,created_by,created_at)
    values($1,'controllo',$2,1,'claude-opus-5-5',gen_random_uuid(),$3,'2026-11-09T06:03:00Z')`,
      [partner, { approved: true, problems: [], sha256: digest }, assistant],
    );
  const job = await value(
    `insert into public.partner_assistant_jobs(partner_id,status,step,research_note_id,choice_note_id,draft_id)
    values($1,'pronta','controllo',$2,$3,$4) returning id as v`,
    [partner, research, choice, draft],
  );
  if (!emailCurrent)
    await db.query(
      `insert into public.partner_contacts(partner_id,kind,value,link_value,verified,created_by,updated_by)
    values($1,'email',$2,$2,true,$3,$3)`,
      [partner, `new-${co}@club.example.test`, founder],
    );
  const r = { partner, co, draft, job, subject, body, signature, digest, porsche };
  readyRows.push(r);
  return r;
}
const start = (extra = {}, operation = randomUUID(), sub = founder) =>
  team(
    "start_partner_assistant_test",
    { drafts: 2, recipients: 4, club_lookbooks: true, ...extra },
    operation,
    sub,
  );
const runCount = () => value("select count(*)::int as v from private.partner_assistant_test_runs");
const finishTest = async (id) => {
  await db.query(
    "update private.partner_assistant_test_runs set requested_at=now()-interval '1 day' where id=$1",
    [id],
  );
  await db.exec(
    "update private.partner_assistant_mail_state set env_test_ok=false,env_test_count=0",
  );
};
async function prepare(
  c,
  lease,
  { size = 100, lookbook = c.lookbook, mode = c.mode, rawSize, ...changes } = {},
) {
  const optOut = "Una frase sintetica per non ricevere altre email.";
  const id = `<${randomUUID()}@club.example.test>`;
  const prefix = `MIME-Version: 1.0\r\nMessage-ID: ${id}\r\n\r\n`;
  const raw = prefix + "x".repeat(Math.max(0, (rawSize ?? size) - prefix.length));
  const input = {
    schema_version: 1,
    job_id: c.job_id,
    draft_id: c.draft.draft_id,
    mode,
    test_run_id: c.test_run_id,
    test_index: c.test_index,
    message_id: id,
    to_address: `proof-${c.test_index ?? 0}@recipient.example.test`,
    subject: c.draft.subject,
    text: `${c.draft.body}\n\n${c.draft.signature}\n\n${optOut}`,
    opt_out: optOut,
    raw,
    mailbox_check: "vuota",
    ...changes,
  };
  if (lookbook !== undefined) input.lookbook = lookbook;
  return worker("prepare_partner_assistant_send", [lease, randomUUID(), input]);
}
async function send(c, lease, size) {
  const p = await prepare(c, lease, { size });
  eq(p.status, "pronto");
  const begun = await worker("start_partner_assistant_send", [lease, p.message_row_id]);
  eq(begun.status, "in_invio");
  const f = await worker("finish_partner_assistant_send", [
    lease,
    randomUUID(),
    {
      schema_version: 1,
      message_row_id: p.message_row_id,
      outcome: "inviato",
      smtp_code: 250,
      enhanced_code: null,
      spam: false,
      reason: null,
    },
  ]);
  eq(f.status, "done");
  return p.message_row_id;
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
    "_assistente_partner_prova_allegati.sql",
  ])
    await db.exec(migration(suffix));
  for (const [id, name, role] of [
    [founder, "Fondatore sintetico", "founder"],
    [assistant, "Assistente sintetico", null],
    [member, "Membro sintetico", "production"],
  ]) {
    await db.query("insert into auth.users values($1)", [id]);
    await db.query("insert into public.profiles(user_id,display_name) values($1,$2)", [id, name]);
    if (role)
      await db.query("insert into public.memberships(user_id,role,active) values($1,$2,true)", [
        id,
        role,
      ]);
  }
  await db.query(
    "update private.partner_assistant_config set mode='prova',actor_id=$1,handoff_to=$2,paused_reason='credito',backoff_until=now()+interval '10 minutes',test_confirmed_at=now(),test_confirmed_by=$2",
    [assistant, founder],
  );
  const pause = await one(
    "select paused_reason,backoff_until from private.partner_assistant_config",
  );
  await mode("invio", { preserve_preparation_pause: true });
  eq(await one("select paused_reason,backoff_until from private.partner_assistant_config"), pause);
  await mode("prova", { preserve_preparation_pause: true });
  eq(await one("select paused_reason,backoff_until from private.partner_assistant_config"), pause);
  await rejects(() => mode("prova", { preserve_preparation_pause: "yes" }), "22023");
  await mode("prepara");
  eq(await one("select paused_reason,backoff_until from private.partner_assistant_config"), {
    paused_reason: null,
    backoff_until: null,
  });
  await mode("prova");
  await rejects(() => start({ drafts: 1 }), "22023");
  await rejects(() => start({ club_lookbooks: "yes" }), "22023");
  await rejects(() => start({}, randomUUID(), member), "42501");
  await rejects(() => start(), "55000", "partner_assistant_test_club_pair_missing");
  eq(await runCount(), 0);
  const porsche = await ready(true);
  // Una bozza non corrente non completa la coppia, anche se precede quella buona nella coda.
  for (const options of [
    { version: 2 },
    { review: false },
    { currentRules: false },
    { partnerCurrent: false },
    { emailCurrent: false },
    { sections: ["club", "eventi"] },
  ])
    await ready(false, options);
  await rejects(() => start(), "55000", "partner_assistant_test_club_pair_missing");
  eq(await runCount(), 0);
  const other = await ready(false);
  const operation = randomUUID(),
    r = await start({}, operation);
  eq(r.drafts, 2);
  eq(r.recipients, 4);
  eq((await start({}, operation)).replayed, true);
  eq(await runCount(), 1);
  const run = await one("select * from private.partner_assistant_test_runs where id=$1", [r.id]);
  eq(run.draft_ids, [porsche.draft, other.draft]);
  eq(run.lookbooks, { [porsche.draft]: LOOKBOOK.porsche_club, [other.draft]: LOOKBOOK.club });
  eq(
    await value("select count(*)::int as v from private.partner_assistant_test_pairs($1,4)", [
      r.id,
    ]),
    8,
  );
  await rejects(() => start({ recipients: 3 }, operation), "23505");

  await rejects(() => start(), "55000", "prova_in_corso");
  await rejects(
    () =>
      db.query("update private.partner_assistant_test_runs set lookbooks='{}' where id=$1", [r.id]),
    "42501",
  );
  await rejects(
    () =>
      db.query("update private.partner_assistant_test_runs set recipients=3 where id=$1", [r.id]),
    "42501",
  );
  await rejects(
    () =>
      db.query(
        "update private.partner_assistant_test_runs set draft_ids=array[$1::uuid,$1::uuid] where id=$2",
        [porsche.draft, r.id],
      ),
    "42501",
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const fn of [
      "private.partner_assistant_test_lookbook(text)",
      "private.partner_assistant_send_lookbook(uuid,text,uuid)",
      "private.partner_assistant_test_lookbooks_guard()",
    ])
      eq(await value("select has_function_privilege($1,$2,'execute') as v", [role, fn]), false);
    for (const table of [
      "private.partner_assistant_test_runs",
      "public.partner_assistant_messages",
    ])
      eq(
        await value("select has_table_privilege($1,$2,'insert,update,delete') as v", [role, table]),
        false,
      );
    eq(
      await value(
        "select has_function_privilege($1,'public.start_partner_assistant_test(uuid,jsonb)','execute') as v",
        [role],
      ),
      role === "authenticated",
    );
    eq(
      await value(
        "select has_function_privilege($1,'public.claim_partner_assistant_send(uuid,integer,integer)','execute') as v",
        [role],
      ),
      role === "service_role",
    );
  }
  let taken = await claim(4);
  eq(taken.candidate.draft.draft_id, porsche.draft);
  eq(taken.candidate.lookbook, LOOKBOOK.porsche_club);
  eq(
    (await prepare(taken.candidate, taken.lease_token, { lookbook: null })).reason,
    "allegato_prova",
  );
  eq(
    (await prepare(taken.candidate, taken.lease_token, { lookbook: LOOKBOOK.club })).reason,
    "allegato_prova",
  );
  for (const metadata of [
    { ...LOOKBOOK.porsche_club, bytes: 1 },
    { ...LOOKBOOK.porsche_club, sha256: "0".repeat(64) },
    { ...LOOKBOOK.porsche_club, extra: true },
  ])
    await rejects(
      () => prepare(taken.candidate, taken.lease_token, { lookbook: metadata }),
      "22023",
    );
  await rejects(() => prepare(taken.candidate, taken.lease_token, { rawSize: 4194305 }), "22023");
  const sentIds = [];
  for (let i = 0; i < 8; i++) {
    if (i) {
      await release();
      taken = await claim(4);
    }
    eq(taken.candidate.lookbook, i < 4 ? LOOKBOOK.porsche_club : LOOKBOOK.club);
    eq(taken.candidate.test_index, i % 4);
    ok(taken.appends.reduce((n, a) => n + Buffer.byteLength(a.raw), 0) <= 4194304);
    sentIds.push(await send(taken.candidate, taken.lease_token, i === 0 ? 4194304 : 3600000));
  }
  eq(
    await value("select count(*)::int as v from private.partner_assistant_test_pairs($1,4)", [
      r.id,
    ]),
    0,
  );
  eq(
    await value(
      "select count(*)::int as v from public.partner_assistant_messages where test_run_id=$1 and send_status='inviato'",
      [r.id],
    ),
    8,
  );
  await rejects(
    () =>
      db.query("update public.partner_assistant_messages set lookbook=null where id=$1", [
        sentIds[0],
      ]),
    "42501",
  );
  await rejects(
    () =>
      db.query("update public.partner_assistant_messages set lookbook=$2 where id=$1", [
        sentIds[0],
        LOOKBOOK.club,
      ]),
    "42501",
  );
  // Copie grandi: al più tre, e mai oltre quattro MiB nello stesso giro.
  for (let i = 0; i < 8; i++) {
    await release();
    const pending = await claim(4);
    eq(pending.appends.length, 1);
    ok(Buffer.byteLength(pending.appends[0].raw) <= 4194304);
    eq(
      (
        await worker("record_partner_assistant_append", [
          pending.lease_token,
          pending.appends[0].message_row_id,
          { schema_version: 1, found: false },
        ])
      ).status,
      "done",
    );
  }
  await release();
  eq((await claim(4)).status, "idle");
  const visible = await as("authenticated", founder, () =>
    value("select public.read_partner_assistant_send() as v"),
  );
  eq(visible.test_run.club_lookbooks, true);
  // Cinque destinatari restano supportati: due bozze, dieci coppie, sempre sotto il limite15.
  await finishTest(r.id);
  const five = await start({ recipients: 5 });
  eq(
    await value("select count(*)::int as v from private.partner_assistant_test_pairs($1,5)", [
      five.id,
    ]),
    10,
  );
  for (let i = 0; i < 3; i++) {
    await release();
    const small = await claim(5);
    await send(small.candidate, small.lease_token, 1000);
  }
  await release();
  const three = await claim(0);
  eq(three.appends.length, 3);
  eq(
    three.appends.reduce((sum, m) => sum + Buffer.byteLength(m.raw), 0),
    3000,
  );
  for (const append of three.appends)
    await worker("record_partner_assistant_append", [
      three.lease_token,
      append.message_row_id,
      { schema_version: 1, found: false },
    ]);
  await finishTest(five.id);
  const old = await start({ drafts: 1, recipients: 1, club_lookbooks: false });
  eq(
    await value("select lookbooks as v from private.partner_assistant_test_runs where id=$1", [
      old.id,
    ]),
    {},
  );
  const oldVisible = await as("authenticated", founder, () =>
    value("select public.read_partner_assistant_send() as v"),
  );
  ok(!Object.hasOwn(oldVisible.test_run, "club_lookbooks"));
  await release();
  const oldClaim = await claim(1);
  ok(!Object.hasOwn(oldClaim.candidate, "lookbook"));
  eq(
    (await prepare(oldClaim.candidate, oldClaim.lease_token, { lookbook: LOOKBOOK.porsche_club }))
      .reason,
    "allegato_prova",
  );
  await rejects(
    () => prepare(oldClaim.candidate, oldClaim.lease_token, { rawSize: 65537 }),
    "22023",
  );
  eq((await prepare(oldClaim.candidate, oldClaim.lease_token, { size: 65536 })).status, "pronto");
  // La cancellazione definitiva non riscrive la mappa congelata e non è bloccata dal suo trigger.
  await release();
  await db.query("select private.partner_assistant_erase($1)", [porsche.partner]);
  eq(
    await value(
      "select count(*)::int as v from public.partner_assistant_drafts where partner_id=$1",
      [porsche.partner],
    ),
    0,
  );
  eq(
    await value("select lookbooks as v from private.partner_assistant_test_runs where id=$1", [
      r.id,
    ]),
    run.lookbooks,
  );
  // Attivazione reale sul giorno di Roma, indipendente dal fuso del destinatario.
  const realPorsche = await ready(true),
    realOther = await ready(false),
    regular = await ready(false, { sections: ["collab"] });
  async function metadata(row, at) {
    await db.exec("begin");
    try {
      await db.query("select set_config('luckylap.partner_assistant.now',$1,true)", [at]);
      const m = await value(
        "select private.partner_assistant_send_lookbook($1,'invio',null) as v",
        [row.draft],
      );
      await db.exec("commit");
      return m;
    } catch (e) {
      await db.exec("rollback");
      throw e;
    }
  }
  for (const row of [realPorsche, realOther, regular])
    eq(await metadata(row, "2026-11-03T22:59:59Z"), null);
  eq(await metadata(realPorsche, "2026-11-03T23:00:00Z"), LOOKBOOK.porsche_club);
  eq(await metadata(realOther, "2026-11-03T23:00:00Z"), LOOKBOOK.club);
  eq(await metadata(regular, "2026-11-03T23:00:00Z"), null);
  for (const row of readyRows.filter(
    (x) => ![realPorsche.partner, realOther.partner, regular.partner].includes(x.partner),
  ))
    await db.query(
      "insert into public.partner_assistant_contacts(partner_id,active,updated_by) values($1,false,$2) on conflict(partner_id) do update set active=false",
      [row.partner, founder],
    );
  await mode("invio", { preserve_preparation_pause: true });
  // Prepare il3nov, start il4nov: il messaggio senzaPDF si scarta, la bozza resta pronta.
  NOW = "2026-11-03T09:00:00Z";
  await release();
  let real = await claim(0);
  ok(!Object.hasOwn(real.candidate, "lookbook"));
  const address = real.candidate.address;
  eq(
    (
      await prepare(real.candidate, real.lease_token, {
        lookbook: LOOKBOOK.porsche_club,
        to_address: address,
      })
    ).reason,
    "allegato_prova",
  );
  const pre = await prepare(real.candidate, real.lease_token, { to_address: address });
  eq(pre.status, "pronto");
  NOW = "2026-11-04T09:00:00Z";
  const mismatch = await worker("start_partner_assistant_send", [
    real.lease_token,
    pre.message_row_id,
  ]);
  eq(mismatch, { status: "stop", reason: "allegato_cambiato" });
  eq(
    await value("select status as v from public.partner_assistant_jobs where id=$1", [
      real.candidate.job_id,
    ]),
    "pronta",
  );
  await release();
  real = await claim(0);
  eq(real.candidate.lookbook, LOOKBOOK.porsche_club);
  const accepted = await prepare(real.candidate, real.lease_token, {
    rawSize: 3600000,
    to_address: real.candidate.address,
  });
  eq(accepted.status, "pronto");
  eq(
    (await worker("start_partner_assistant_send", [real.lease_token, accepted.message_row_id]))
      .status,
    "in_invio",
  );
  eq(
    await value("select lookbook as v from public.partner_assistant_messages where id=$1", [
      accepted.message_row_id,
    ]),
    real.candidate.lookbook,
  );
  eq(
    (
      await worker("finish_partner_assistant_send", [
        real.lease_token,
        randomUUID(),
        {
          schema_version: 1,
          message_row_id: accepted.message_row_id,
          outcome: "inviato",
          smtp_code: 250,
          enhanced_code: null,
          spam: false,
          reason: null,
        },
      ])
    ).status,
    "done",
  );
  await db.query("select private.partner_assistant_erase($1)", [realPorsche.partner]);
  const erased = await one(
    "select draft_id,erased_at,lookbook,raw from public.partner_assistant_messages where id=$1",
    [accepted.message_row_id],
  );
  eq(erased.draft_id, null);
  ok(erased.erased_at);
  eq(erased.lookbook, LOOKBOOK.porsche_club);
  eq(erased.raw, "Dato cancellato.");
  // Anche il PDF degli altri club passa prepare. Se la scheda cambia sezione prima dello SMTP,
  // start scarta il MIME allegato e lascia il lavoro pronto per ricomporlo.
  await release();
  const realClub = await claim(0);
  eq(realClub.candidate.lookbook, LOOKBOOK.club);
  const clubPrepared = await prepare(realClub.candidate, realClub.lease_token, {
    rawSize: 3600000,
    to_address: realClub.candidate.address,
  });
  eq(clubPrepared.status, "pronto");
  await db.query("update public.partners set sections=array['collab'] where id=$1", [
    realOther.partner,
  ]);
  eq(
    await worker("start_partner_assistant_send", [
      realClub.lease_token,
      clubPrepared.message_row_id,
    ]),
    { status: "stop", reason: "allegato_cambiato" },
  );
  eq(
    await value("select status as v from public.partner_assistant_jobs where id=$1", [
      realOther.job,
    ]),
    "pronta",
  );
  eq(
    await value(
      "select count(*)::int as v from public.partner_assistant_messages where mode='invio' and send_status in ('inviato','incerto','in_invio')",
    ),
    1,
    "Le prove e gli scarti non consumano la quota reale",
  );
  // I contatti ordinari restano solo testo anche dopo il4nov e rifiutano metadata o MIMEgrande.
  for (const row of [realPorsche, realOther])
    await db.query(
      "insert into public.partner_assistant_contacts(partner_id,active,updated_by) values($1,false,$2) on conflict(partner_id) do update set active=false",
      [row.partner, founder],
    );
  await release();
  const plain = await claim(0);
  ok(!Object.hasOwn(plain.candidate, "lookbook"));
  eq(
    (
      await prepare(plain.candidate, plain.lease_token, {
        lookbook: LOOKBOOK.club,
        to_address: plain.candidate.address,
      })
    ).reason,
    "allegato_prova",
  );
  await rejects(
    () =>
      prepare(plain.candidate, plain.lease_token, {
        rawSize: 65537,
        to_address: plain.candidate.address,
      }),
    "22023",
  );
  eq(await value("select count(*)::int as v from private.partner_assistant_runs"), 0);
  await db.exec(migration("_partner_lookbooks_aggiornati.sql"));
  eq(await value("select private.partner_assistant_test_lookbook('porsche_club') as v"), {
    code: "porsche_club",
    bytes: 2590257,
    sha256: "3af4b265bb2c10f3442ad4a0ec8b9059b66a2a5033d11c886de79a412fa14e10",
  });
  eq(await value("select private.partner_assistant_test_lookbook('club') as v"), {
    code: "club",
    bytes: 2442753,
    sha256: "e9e926aa0bb3bb8c4b374eeb72becd6054bcce225d677f671d28f657a4650a36",
  });
  eq(
    await value(
      "update public.partner_assistant_messages set appended_at=now() where id=$1 returning lookbook as v",
      [accepted.message_row_id],
    ),
    LOOKBOOK.porsche_club,
    "L'aggiornamento dello storico conserva l'impronta dell'allegato precedente",
  );
  ok(
    (
      await db.query(
        "update private.partner_assistant_test_runs set lookbooks=lookbooks where lookbooks <> '{}'::jsonb returning id",
      )
    ).rows.length > 0,
    "La mappa congelata delle prove precedenti resta valida",
  );
  console.log(`PASS ${checks} controlli`);
} catch (error) {
  console.error(error.message, error.code, error.where ?? error.stack);
  process.exitCode = 1;
} finally {
  await db.close();
}
