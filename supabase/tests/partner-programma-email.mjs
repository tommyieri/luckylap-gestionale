// test-db: pglite minimo 176
// Programma email: snapshot completo e finestre Roma/DST, dettagli senza MIME, hold persistenti,
// revisione append-only e protezione del testo manuale. Permessi, CAS, ricevute, erase e limiti.
// Auth e dati sintetici, nessuna rete o chiamata a Claude.
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
    "_partner_programma_email.sql",
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
  const read = (from = "2026-11-10", days = 14, sub = founder) =>
    as("authenticated", sub, () =>
      value("select public.read_partner_email_program($1::date,$2::integer) as v", [from, days]),
    );
  const detail = (kind, id, sub = founder) =>
    as("authenticated", sub, () =>
      value("select public.read_partner_email_detail($1,$2) as v", [kind, id]),
    );
  const beginEdit = (row, op = randomUUID()) =>
    team(
      "begin_partner_email_edit",
      { job_id: row.job, expected_draft_id: row.draft, expected_sha256: row.digest },
      op,
    );
  const saveEdit = (row, h, changes = {}, op = randomUUID()) =>
    team(
      "save_partner_email_edit",
      {
        hold_id: h.holdId,
        expected_hold_version: h.holdVersion,
        expected_draft_id: row.draft,
        expected_sha256: row.digest,
        subject: "Oggetto modificato",
        body: "Il testo scelto e approvato dalla persona. Una proposta?",
        ...changes,
      },
      op,
    );
  const cancelEdit = (row, h, op = randomUUID()) =>
    team(
      "cancel_partner_email_edit",
      { hold_id: h.holdId, expected_hold_version: h.holdVersion, expected_draft_id: row.draft },
      op,
    );
  await mode("invio", { preserve_preparation_pause: true });
  const first = await ready(true),
    second = await ready(false);
  const queued = await ready(false, { sections: ["vendita"] });
  await db.query(
    "update public.partner_assistant_jobs set status='in_coda',step='ricerca',draft_id=null where id=$1",
    [queued.job],
  );
  const withoutJob = randomUUID();
  await db.query(
    `insert into public.partners(id,co,name,origin,stage,created_by,sections,priority,contact_month)
    values($1,1301,'Contatto sintetico senza lavoro','team','da_contattare',$2,array['vendita'],'media',date '2026-11-01')`,
    [withoutJob, founder],
  );
  await db.query(
    `insert into public.partner_contacts(partner_id,kind,value,link_value,created_by,updated_by)
    values($1,'email','new@unprepared.example.test','new@unprepared.example.test',$2,$2)`,
    [withoutJob, founder],
  );
  const snapshot = await read();
  eq(snapshot.counts, { total: 3, returned: 3, unpreparedTotal: 1, unpreparedReturned: 1 });
  eq(snapshot.items.length, 3);
  eq(snapshot.unprepared.length, 1);
  eq(snapshot.unprepared[0].partnerId, withoutJob);
  eq(snapshot.unprepared[0].flow, "altri");
  ok(!Object.hasOwn(snapshot.unprepared[0], "jobId"));
  eq(snapshot.config.mode, "invio");
  eq(snapshot.config.pausedReason, "credito");
  eq(snapshot.todaySent, { club: 0, altri: 0 });
  eq(snapshot.sent, []);
  eq(snapshot.items.find((x) => x.jobId === queued.job).draft, null);
  eq(snapshot.items.find((x) => x.jobId === queued.job).windows, []);
  const w = snapshot.items.find((x) => x.jobId === first.job).windows[0];
  eq(w.day, "2026-11-10");
  eq(new Date(w.start).toISOString(), "2026-11-10T08:30:00.000Z");
  eq(new Date(w.end).toISOString(), "2026-11-10T09:58:30.000Z");
  const south = await value(
    "select private.partner_email_windows(date '2026-11-08',1,'Pacific/Auckland','Nuova Zelanda') as v",
  );
  eq(south.length, 1);
  eq(south[0].day, "2026-11-08");
  eq(new Date(south[0].start).toISOString(), "2026-11-08T20:30:00.000Z");
  const split = await value(
    "select private.partner_email_windows(date '2026-11-09',2,'Australia/Sydney','Australia') as v",
  );
  ok(split.length >= 2);
  for (const x of split) {
    ok(new Date(x.start) < new Date(x.end));
    ok(["2026-11-09", "2026-11-10"].includes(x.day));
  }
  eq(
    await value(
      "select private.partner_email_windows(date '2026-12-08',1,'Europe/Rome','Italia') as v",
    ),
    [],
  );
  eq(
    await value(
      "select private.partner_email_windows(date '2027-02-01',1,'Europe/London','Regno Unito') as v",
    ),
    [],
  );
  const dst = await value(
    "select private.partner_email_windows(date '2026-10-23',4,'Europe/London','Regno Unito') as v",
  );
  eq(dst.length, 2);
  eq(new Date(dst[0].start).toISOString(), "2026-10-23T08:30:00.000Z");
  eq(new Date(dst[1].start).toISOString(), "2026-10-26T09:30:00.000Z");
  await rejects(() => read("2026-11-10", 91), "22023");
  await rejects(() => read("2026-11-10", 0), "22023");
  await rejects(() => read("2026-11-10", 14, randomUUID()), "42501");
  eq((await read("2026-11-10", 14, member)).items.length, 3);
  const shown = await detail("job", first.job);
  eq(shown.draftId, first.draft);
  eq(shown.subject, first.subject);
  eq(shown.editable, true);
  eq(shown.signature, first.signature);
  ok(!Object.hasOwn(shown, "raw"));
  eq(shown.hold, null);
  eq((await detail("job", queued.job)).body, null);
  eq((await detail("draft", first.draft, member)).whyNotEditable, "solo_founder");
  await rejects(
    () =>
      team(
        "begin_partner_email_edit",
        { job_id: first.job, expected_draft_id: first.draft, expected_sha256: first.digest },
        randomUUID(),
        member,
      ),
    "42501",
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    eq(
      await value(
        "select has_table_privilege($1,'private.partner_email_edit_holds','select,insert,update,delete') as v",
        [role],
      ),
      false,
    );
    for (const name of [
      "read_partner_email_program(date,integer)",
      "read_partner_email_detail(text,uuid)",
      "begin_partner_email_edit(uuid,jsonb)",
      "save_partner_email_edit(uuid,jsonb)",
      "cancel_partner_email_edit(uuid,jsonb)",
    ])
      eq(
        await value("select has_function_privilege($1,$2,'execute') as v", [
          role,
          "public." + name,
        ]),
        role === "authenticated",
      );
    for (const name of [
      "partner_email_draft_held(uuid)",
      "partner_email_manual_draft(uuid)",
      "partner_email_edit_reason(uuid)",
      "partner_email_windows(date,integer,text,text)",
    ])
      eq(
        await value("select has_function_privilege($1,$2,'execute') as v", [
          role,
          "private." + name,
        ]),
        false,
      );
  }
  await release();
  const candidate = await claim(0);
  eq(candidate.candidate.job_id, first.job);
  const pending = await prepare(candidate.candidate, candidate.lease_token, {
    to_address: candidate.candidate.address,
  });
  eq(pending.status, "pronto");
  const beginOp = randomUUID(),
    hold = await beginEdit(first, beginOp);
  eq(hold.id, hold.holdId);
  eq(hold.version, 1);
  eq((await beginEdit(first, beginOp)).replayed, true);
  eq(
    (await beginEdit(first)).holdId,
    hold.holdId,
    "Un secondo accesso della stessa persona recupera il hold",
  );
  eq(
    await value("select send_status as v from public.partner_assistant_messages where id=$1", [
      pending.message_row_id,
    ]),
    "scartato",
  );
  eq(await value("select private.partner_email_draft_held($1) as v", [first.draft]), true);
  eq((await read()).items.find((x) => x.jobId === first.job).hold.id, hold.holdId);
  eq((await detail("job", first.job)).hold.id, hold.holdId);
  eq(
    (
      await prepare(candidate.candidate, candidate.lease_token, {
        to_address: candidate.candidate.address,
      })
    ).reason,
    "modifica_in_corso",
  );
  eq(
    (await worker("start_partner_assistant_send", [candidate.lease_token, pending.message_row_id]))
      .status,
    "lease_persa",
  );
  await release();
  const next = await claim(0);
  eq(next.candidate.job_id, second.job, "Gli altri invii continuano");
  await rejects(() => saveEdit(first, hold, { expected_sha256: "0".repeat(64) }), "40001");
  eq(await value("select private.partner_email_draft_held($1) as v", [first.draft]), true);
  await rejects(() => saveEdit(first, hold, { subject: "Oggetto\nHeader" }), "22023");
  eq(await value("select private.partner_email_draft_held($1) as v", [first.draft]), true);
  const before = await one(
    "select research_note_id,rules_version,created_at from public.partner_assistant_drafts where id=$1",
    [first.draft],
  );
  const old = await one("select * from public.partner_assistant_drafts where id=$1", [first.draft]);
  const saveOp = randomUUID(),
    saved = await saveEdit(first, hold, {}, saveOp);
  eq(saved.status, "pronta");
  eq(saved.holdClosed, true);
  eq((await saveEdit(first, hold, {}, saveOp)).replayed, true);
  await rejects(() => saveEdit(first, hold), "40001");
  const edited = await one("select * from public.partner_assistant_drafts where id=$1", [
    saved.draftId,
  ]);
  eq(await one("select * from public.partner_assistant_drafts where id=$1", [first.draft]), old);
  eq(edited.research_note_id, before.research_note_id);
  eq(edited.rules_version, before.rules_version);
  eq(edited.sha256, sha(`${edited.subject}\n\n${edited.body}\n\n${edited.signature}`));
  eq(edited.created_by, founder);
  eq(edited.signature, old.signature);
  const review = await one(
    "select * from public.partner_assistant_notes where kind='controllo' and operation_id=$1",
    [saveOp],
  );
  eq(review.model, null);
  eq(review.content.approval_source, "founder_edit");
  eq(review.content.sha256, edited.sha256);
  eq(review.content.previous_draft_id, first.draft);
  eq(review.created_by, founder);
  eq(await value("select private.partner_email_draft_held($1) as v", [first.draft]), false);
  const editedRow = { ...first, draft: saved.draftId, digest: saved.sha256 };
  const secondHold = await beginEdit(editedRow);
  await rejects(() => cancelEdit(first, hold), "40001");
  const cancelOp = randomUUID();
  eq((await cancelEdit(editedRow, secondHold, cancelOp)).resumeState, "pronta");
  eq((await cancelEdit(editedRow, secondHold, cancelOp)).replayed, true);
  await release();
  const newCandidate = await claim(0);
  eq(newCandidate.candidate.draft.draft_id, saved.draftId);
  const newMessage = await prepare(newCandidate.candidate, newCandidate.lease_token, {
    to_address: newCandidate.candidate.address,
  });
  eq(newMessage.status, "pronto");
  eq(
    (
      await worker("start_partner_assistant_send", [
        newCandidate.lease_token,
        newMessage.message_row_id,
      ])
    ).status,
    "in_invio",
  );
  await rejects(() => beginEdit(editedRow), "55000");
  await worker("finish_partner_assistant_send", [
    newCandidate.lease_token,
    randomUUID(),
    {
      schema_version: 1,
      message_row_id: newMessage.message_row_id,
      outcome: "inviato",
      smtp_code: 250,
      enhanced_code: null,
      spam: false,
      reason: null,
    },
  ]);
  const sentDetail = await detail("sent", newMessage.message_row_id);
  eq(sentDetail.editable, false);
  eq(sentDetail.signature, null);
  ok(sentDetail.body.startsWith(edited.body));
  ok(sentDetail.body.includes(edited.signature));
  ok(!Object.hasOwn(sentDetail, "raw"));
  eq((await read()).sent.length, 2);
  const afterConfig = await one("select mode,paused_reason from private.partner_assistant_config");
  eq(afterConfig, { mode: "invio", paused_reason: "credito" });
  // Un cambiamento di contesto durante il hold non riattiva la vecchia bozza con Annulla.
  const h2 = await beginEdit(second);
  await db.query("update public.partners set version=version+1 where id=$1", [second.partner]);
  await rejects(() => saveEdit(second, h2), "40001");
  eq((await cancelEdit(second, h2)).resumeState, "serve_tommaso");
  eq(
    await value("select status as v from public.partner_assistant_jobs where id=$1", [second.job]),
    "serve_tommaso",
  );
  // La cancellazione dei dati porta con sé hold e testo; la vecchia finestra non può risalvarli.
  const erased = await ready(true),
    eraseHold = await beginEdit(erased);
  await db.query("select private.partner_assistant_erase($1)", [erased.partner]);
  eq(
    await value(
      "select count(*)::int as v from private.partner_email_edit_holds where partner_id=$1",
      [erased.partner],
    ),
    0,
  );
  await rejects(() => saveEdit(erased, eraseHold), "40001");
  // Una ricerca scaduta non paga una ricomposizione di una bozza modificata da Tommi.
  const exp = await ready(true),
    expHold = await beginEdit(exp);
  const expEdit = await saveEdit(exp, expHold);
  await db.query("select private.partner_assistant_send_move($1,$2,'ricerca_scaduta')", [
    exp.partner,
    expEdit.draftId,
  ]);
  eq(
    await value("select status as v from public.partner_assistant_jobs where id=$1", [exp.job]),
    "serve_tommaso",
  );
  eq(
    await value("select draft_id as v from public.partner_assistant_jobs where id=$1", [exp.job]),
    expEdit.draftId,
  );
  // Scheda o preferenza email cambiate dopo prepare: la bozza manuale non parte più.
  for (const change of ["scheda", "email"]) {
    const r = await ready(true),
      h = await beginEdit(r),
      savedManual = await saveEdit(r, h);
    await db.query(
      `insert into public.partner_assistant_contacts(partner_id,active,updated_by)
      select partner_id,partner_id=$1,$2 from public.partner_assistant_jobs where status='pronta'
      on conflict(partner_id) do update set active=excluded.active`,
      [r.partner, founder],
    );
    await release();
    const picked = await claim(0);
    eq(picked.candidate.draft.draft_id, savedManual.draftId);
    const preparedManual = await prepare(picked.candidate, picked.lease_token, {
      to_address: picked.candidate.address,
    });
    eq(preparedManual.status, "pronto");
    if (change === "scheda")
      await db.query("update public.partners set version=version+1 where id=$1", [r.partner]);
    else
      await db.query(
        `insert into public.partner_contacts(partner_id,kind,value,link_value,verified,created_by,updated_by)
      values($1,'email','new@preference.example.test','new@preference.example.test',true,$2,$2)`,
        [r.partner, founder],
      );
    eq((await read()).items.find((x) => x.jobId === r.job).reason, "bozza_manuale_da_rivedere");
    eq(
      (
        await worker("start_partner_assistant_send", [
          picked.lease_token,
          preparedManual.message_row_id,
        ])
      ).reason,
      "bozza_manuale_da_rivedere",
    );
    eq(
      await value("select status as v from public.partner_assistant_jobs where id=$1", [r.job]),
      "serve_tommaso",
    );
    eq(
      await value("select send_status as v from public.partner_assistant_messages where id=$1", [
        preparedManual.message_row_id,
      ]),
      "scartato",
    );
    await release();
  }
  for (const phase of ["claim", "prepare"]) {
    const r = await ready(true),
      h = await beginEdit(r),
      savedManual = await saveEdit(r, h);
    await db.query(
      `insert into public.partner_assistant_contacts(partner_id,active,updated_by)
      select partner_id,partner_id=$1,$2 from public.partner_assistant_jobs where status='pronta'
      on conflict(partner_id) do update set active=excluded.active`,
      [r.partner, founder],
    );
    await release();
    let picked;
    if (phase === "prepare") picked = await claim(0);
    await db.query("update public.partners set version=version+1 where id=$1", [r.partner]);
    if (phase === "claim") eq((await claim(0)).candidate ?? null, null);
    else
      eq(
        (
          await prepare(picked.candidate, picked.lease_token, {
            to_address: picked.candidate.address,
          })
        ).reason,
        "bozza_manuale_da_rivedere",
      );
    eq(
      await value("select status as v from public.partner_assistant_jobs where id=$1", [r.job]),
      "serve_tommaso",
    );
    eq(
      await value("select draft_id as v from public.partner_assistant_jobs where id=$1", [r.job]),
      savedManual.draftId,
    );
    await release();
  }
  const heldRules = await ready(false, { sections: ["collab"] }),
    heldRulesHold = await beginEdit(heldRules);
  const heldRulesOriginal = heldRules.draft;
  const rules = await ready(true),
    rulesHold = await beginEdit(rules);
  const rulesEdit = await saveEdit(rules, rulesHold);
  await team("save_partner_assistant_rules", {
    expected_version: 1,
    body: "Regole sintetiche cambiate.",
  });
  eq(
    await value("select status as v from public.partner_assistant_jobs where id=$1", [rules.job]),
    "serve_tommaso",
  );
  eq(
    await value("select draft_id as v from public.partner_assistant_jobs where id=$1", [rules.job]),
    rulesEdit.draftId,
  );
  eq(
    await value("select status as v from public.partner_assistant_jobs where id=$1", [
      heldRules.job,
    ]),
    "serve_tommaso",
  );
  eq(
    await value("select draft_id as v from public.partner_assistant_jobs where id=$1", [
      heldRules.job,
    ]),
    heldRulesOriginal,
  );
  eq(await value("select private.partner_email_draft_held($1) as v", [heldRulesOriginal]), true);
  await rejects(
    () => team("set_partner_assistant_contact", { partner_id: heldRules.partner, active: true }),
    "55000",
    "partner_email_edit_active",
  );
  await db.query("update public.partner_assistant_jobs set status='in_coda' where id=$1", [
    heldRules.job,
  ]);
  await worker("claim_partner_assistant_step", [randomUUID(), 360]);
  eq(
    await value("select lease_token is null as v from public.partner_assistant_jobs where id=$1", [
      heldRules.job,
    ]),
    true,
  );
  eq(
    await value("select draft_id as v from public.partner_assistant_jobs where id=$1", [
      heldRules.job,
    ]),
    heldRulesOriginal,
  );
  await db.exec("update public.partner_assistant_jobs set lease_token=null,lease_expires_at=null");
  eq((await cancelEdit(heldRules, heldRulesHold)).resumeState, "serve_tommaso");
  eq(await value("select count(*)::int as v from private.partner_assistant_runs"), 0);
  // Il programma non tronca né i lavori né lo storico quando supera il limite dichiarato.
  await db.query(
    `with inserted as (insert into public.partners(co,name,origin,stage,created_by,sections,priority,contact_month)
    select 10000+i,'Contatto sintetico '||i,'team','da_contattare',$1,array['collab'],'media',date '2026-11-01'
      from generate_series(1,2001) i returning id)
    insert into public.partner_assistant_jobs(partner_id,status,step) select id,'in_coda','ricerca' from inserted`,
    [founder],
  );
  await rejects(() => read(), "54000", "partner_email_program_too_large");
  await db.exec("delete from public.partners where co>=10000");
  const bulkRun = await value(
    "insert into private.partner_assistant_test_runs(draft_ids,recipients,requested_by) values($1,1,$2) returning id as v",
    [[rulesEdit.draftId], founder],
  );
  await db.query(
    `insert into public.partner_assistant_messages(partner_id,draft_id,kind,mode,send_status,test_run_id,test_index,
    message_id,to_address,subject,body,raw,sha256,rules_version,lease_token,operation_id,created_by,created_at)
    select $1,$2,'primo','prova','scartato',$3,0,'<'||gen_random_uuid()||'@bulk.example.test>',
      'proof@bulk.example.test','Oggetto sintetico','Corpo sintetico','raw sintetico',
      encode(sha256(convert_to('raw sintetico','UTF8')),'hex'),1,gen_random_uuid(),gen_random_uuid(),$4,'2026-11-10T09:00:00Z'
      from generate_series(1,2001)`,
    [rules.partner, rulesEdit.draftId, bulkRun, assistant],
  );
  await rejects(() => read("2026-11-01", 90), "54000", "partner_email_program_too_large");
  console.log(`PASS ${checks} controlli`);
} catch (error) {
  console.error(error.message, error.code, error.where ?? error.stack);
  process.exitCode = 1;
} finally {
  await db.close();
}
