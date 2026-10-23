// test-db: pglite minimo 138
// Partner e Oggi dopo P4-P6 (20261023140414_partner_oggi_fixes): solleciti dai file dei
// dispositivi, «contatti da fare» con la regola di «Adesso», «Collega l'evento» con date
// passate, permessi dei trigger del calendario e indici. Prima lo stato con le migrazioni già in
// produzione, poi la migrazione: nessuna riga cambia. Solo dati sintetici, Auth simulato.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

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
  ok(e, "Expected rejected command");
  eq(e.code, code, `Codice atteso ${code}`);
  if (message) eq(e.message, message);
};
const founder = randomUUID(),
  uploader = randomUUID(),
  production = randomUUID(),
  outsider = randomUUID();
const migrations = new URL("../migrations/", import.meta.url);
const migration = (suffix) => {
  const names = readdirSync(migrations).filter((n) => n.endsWith(suffix));
  assert.equal(names.length, 1, `Una sola migrazione ${suffix}`);
  return readFileSync(new URL(names[0], migrations), "utf8");
};
const fixture = JSON.parse(
  readFileSync(new URL("fixtures/partner-today/adesso.json", import.meta.url), "utf8"),
);
async function as(fn, id = founder) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: id }),
    ]);
    await db.exec("set local role authenticated");
    const out = await fn();
    await db.exec("commit");
    return out;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const rpc = (name, op, payload, actor = founder) =>
  as(
    async () =>
      (await db.query(`select public.${name}($1,$2::jsonb) r`, [op, JSON.stringify(payload)]))
        .rows[0].r,
    actor,
  );
const work = (kind, extra = {}, op = randomUUID(), actor = founder) =>
  rpc("create_partner_work", op, { schema_version: 1, kind, ...extra }, actor);
const today = (day, actor = founder) =>
  as(
    async () => (await db.query("select public.read_partner_today($1::date) r", [day])).rows[0].r,
    actor,
  );
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const value = async (sql, args = []) => (await one(sql, args))?.v;
const romeToday = async () => value("select ((now() at time zone 'Europe/Rome')::date)::text v");
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();

let co = 100;
async function partner({
  stage = "da_contattare",
  name,
  contactMonth = "date_trunc('month',current_date)::date",
  nextActionOn = null,
  starts = null,
  ends = null,
} = {}) {
  const id = randomUUID();
  co++;
  await db.query(
    `insert into public.partners(id,co,source_key,name,origin,stage,created_by,sections,priority,contact_month,next_action,next_action_on,event_starts_on,event_ends_on)
     values($1,$2,$3,$4,'research',$5,$6,array['eventi'],'media',${contactMonth},case when $7::date is null then null else 'Richiamare' end,$7::date,$8::date,$9::date)`,
    [
      id,
      co,
      `S${co}`,
      name ?? `Raduno sintetico ${co}`,
      stage,
      founder,
      nextActionOn,
      starts,
      ends,
    ],
  );
  return { id, co, key: `S${co}` };
}
const followUps = (partnerId, open = null) =>
  db.query(
    `select t.*,l.activity_id,l.created_by link_created_by from public.partner_work_links l join public.tasks t on t.id=l.task_id
     where l.kind='follow_up' and l.partner_id=$1 ${open === null ? "" : open ? "and t.status<>'done'" : "and t.status='done'"} order by t.created_at,t.id`,
    [partnerId],
  );
const openCount = async (partnerId) => (await followUps(partnerId, true)).rows.length;
const deviceFile = (device, exportedAt, stages) => {
  const text = JSON.stringify({ device, exportedAt, stages, nonce: randomUUID() });
  return {
    schema_version: 1,
    file_sha256: createHash("sha256").update(text).digest("hex"),
    device,
    exported_at: exportedAt,
    stages,
    texts: {},
    approaches: {},
    names: {},
  };
};
const fingerprint = async () =>
  (
    await db.query(
      `select (select md5(coalesce(string_agg(t::text,'|' order by t.id),'')) from public.tasks t) tasks,
              (select md5(coalesce(string_agg(e::text,'|' order by e.id),'')) from public.calendar_events e) events,
              (select md5(coalesce(string_agg(l::text,'|' order by l.id),'')) from public.partner_work_links l) links,
              (select md5(coalesce(string_agg(p::text,'|' order by p.id),'')) from public.partners p) partners,
              (select md5(coalesce(string_agg(a::text,'|' order by a.id),'')) from public.partner_activities a) activities,
              (select count(*)::int from public.audit_logs) audit`,
    )
  ).rows[0];

try {
  await db.exec(
    `create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;create function auth.uid()returns uuid language sql stable as $$select(auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;create schema storage;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to authenticated;`,
  );
  for (const suffix of [
    "_initial_schema.sql",
    "_sales_ecosystem.sql",
    "_brand_assets_and_development.sql",
    "_partner_module.sql",
    "_partner_work_links.sql",
    "_partner_dates_only_agreed.sql",
  ])
    await db.exec(migration(suffix));
  for (const [id, role] of [
    [founder, "founder"],
    [uploader, "logistics"],
    [production, "production"],
    [outsider, null],
  ]) {
    await db.query("insert into auth.users values($1)", [id]);
    await db.query("insert into public.profiles(user_id,display_name)values($1,$2)", [
      id,
      `Persona sintetica ${role ?? "esterna"}`,
    ]);
    if (role)
      await db.query("insert into public.memberships(user_id,role)values($1,$2)", [id, role]);
  }

  // 1. Stato di produzione prima della migrazione: un file già importato non ha solleciti.
  const before = await partner();
  const oldImport = await rpc(
    "import_partner_device_file",
    randomUUID(),
    deviceFile("telefono", days(-12), { [before.key]: "contattato" }),
    uploader,
  );
  eq(oldImport.stages_applied, 1, "Regola vecchia: lo stato del file si applica");
  eq((await followUps(before.id)).rows.length, 0, "Regola vecchia: file senza sollecito");
  const agreedPast = await partner({ starts: "2026-05-02", ends: "2026-05-03" });
  await db.query("update public.partners set stage='chiuso' where id=$1", [agreedPast.id]);
  eq(
    await value("select count(*)::int v from public.partner_work_links where partner_id=$1", [
      agreedPast.id,
    ]),
    0,
    "Accordo su un evento passato: nessun collegamento automatico",
  );
  await rejects(
    () => work("event", { partner_id: agreedPast.id }),
    "22023",
    "partner_work_source_missing",
  );
  const futureAgreed = await partner({ starts: days(40).slice(0, 10) });
  await db.query("update public.partners set stage='chiuso' where id=$1", [futureAgreed.id]);
  const futureLink = await one(
    "select * from public.partner_work_links where partner_id=$1 and kind='event'",
    [futureAgreed.id],
  );
  ok(futureLink?.calendar_event_id, "Accordo con data futura: appuntamento creato");
  const fingerprintBefore = await fingerprint();

  // 2. La migrazione: funzioni sostituite, nessuna riga toccata, nessun backfill.
  await db.exec(migration("_partner_oggi_fixes.sql"));
  eq(await fingerprint(), fingerprintBefore, "Migrazione: nessuna riga cambia");
  eq(
    (await followUps(before.id)).rows.length,
    0,
    "Nessun sollecito creato per i file già importati",
  );

  // 3. File dei dispositivi (decisione 30).
  const a = await partner({ name: "Club sintetico A" });
  const b = await partner({ name: "Club sintetico B" });
  const blocked = await partner({ name: "Club sintetico bloccato" });
  await db.query(
    "insert into public.partner_do_not_contact(partner_id,active,reason,created_by)values($1,true,'Blocco sintetico',$2)",
    [blocked.id, founder],
  );
  const phoneAt = days(-10);
  const phone = deviceFile("telefono", phoneAt, {
    [a.key]: "contattato",
    [b.key]: "contattato",
    [blocked.key]: "contattato",
  });
  const phoneOp = randomUUID();
  const imported = await rpc("import_partner_device_file", phoneOp, phone, uploader);
  eq(imported.stages_applied, 3);
  const [aFollow] = (await followUps(a.id)).rows;
  ok(aFollow, "«Contattato» dal file: sollecito creato");
  eq(aFollow.title, "Sollecito · Club sintetico A");
  eq(aFollow.status, "todo");
  eq(aFollow.assigned_to, uploader, "Assegnato a chi ha caricato il file");
  eq(aFollow.created_by, uploader);
  eq(aFollow.link_created_by, uploader);
  eq(aFollow.description, `Partner CO ${a.co} · /partner?co=${a.co}#lead-${a.co}`);
  eq(
    await value(
      "select ((t.due_at at time zone 'Europe/Rome')::date-(a.occurred_at at time zone 'Europe/Rome')::date) v from public.tasks t,public.partner_activities a where t.id=$1 and a.id=$2",
      [aFollow.id, aFollow.activity_id],
    ),
    7,
    "Scadenza: 7 giorni dopo la data dell'esportazione",
  );
  eq(
    await value(
      "select (due_at at time zone 'Europe/Rome')::time::text v from public.tasks where id=$1",
      [aFollow.id],
    ),
    "00:00:00",
    "Alla mezzanotte di Roma",
  );
  eq(
    await value("select occurred_at=$2::timestamptz v from public.partner_activities where id=$1", [
      aFollow.activity_id,
      phoneAt,
    ]),
    true,
    "L'attività del file ha la data dell'esportazione",
  );
  ok(Date.parse(aFollow.due_at) < Date.now(), "Esportazione di 10 giorni fa: già in ritardo");
  eq(await openCount(b.id), 1);
  eq((await followUps(blocked.id)).rows.length, 0, "Da non contattare: nessun sollecito");
  const romeDay = await romeToday();
  const mine = await today(romeDay, uploader);
  eq(mine.reminder_count, 2, "Oggi: i solleciti in ritardo di chi ha caricato il file");
  eq(
    mine.reminders.map((r) => r.partner_id).sort(),
    [a.id, b.id].sort(),
    "Oggi: ogni sollecito porta il suo contatto",
  );
  eq((await today(romeDay, founder)).reminder_count, 0, "Non sono di chi non ha caricato il file");

  const tasksAfterPhone = await value("select count(*)::int v from public.tasks");
  const again = await rpc("import_partner_device_file", randomUUID(), phone, uploader);
  eq(again.replayed, true, "Stesso file: resoconto di allora");
  eq(await value("select count(*)::int v from public.tasks"), tasksAfterPhone, "Nessun doppione");
  eq(
    (await rpc("import_partner_device_file", phoneOp, phone, uploader)).replayed,
    true,
    "Stesso invio ripetuto: nessun effetto",
  );
  eq(await value("select count(*)::int v from public.tasks"), tasksAfterPhone);

  const computerAt = days(-5);
  const computer = deviceFile("computer", computerAt, {
    [a.key]: "contattato",
    [b.key]: "risposto",
  });
  const second = await rpc("import_partner_device_file", randomUUID(), computer, uploader);
  eq(second.stages_applied, 1, "Stesso stato da un altro file: ignorato");
  eq(await value("select count(*)::int v from public.tasks"), tasksAfterPhone, "Niente di nuovo");
  eq(await openCount(a.id), 1, "Il sollecito di A resta uno");
  eq(await openCount(b.id), 0, "«Risposto» dal file chiude il sollecito");
  eq((await followUps(b.id, false)).rows.length, 1);

  const sent = await rpc("record_partner_activity", randomUUID(), {
    schema_version: 1,
    partner_id: a.id,
    kind: "inviato",
    message_kind: "sollecito",
    channel: "email",
  });
  ok(sent.activity_id);
  eq(await openCount(a.id), 1, "Un solo sollecito aperto per contatto");
  const [aTeam] = (await followUps(a.id, true)).rows;
  eq(aTeam.assigned_to, founder, "Il nuovo invio del team riassegna a chi ha inviato");
  eq(aTeam.activity_id, sent.activity_id);
  eq((await followUps(a.id, false)).rows[0].id, aFollow.id, "Il sollecito del file è chiuso");

  const late = deviceFile("telefono", days(-8), { [a.key]: "risposto" });
  eq((await rpc("import_partner_device_file", randomUUID(), late, uploader)).stages_applied, 1);
  eq(await openCount(a.id), 1, "Una risposta più vecchia dal file non chiude un invio più recente");

  const tasksNow = await value("select count(*)::int v from public.tasks");
  await db.query(
    `insert into public.partner_activities(operation_id,partner_id,partner_name,partner_co,kind,origin,occurred_at,message_kind,created_by)
     values($1,$2,'Club sintetico A',$3,'inviato','file',$4,'primo',$5)`,
    [randomUUID(), a.id, a.co, days(-20), uploader],
  );
  eq(
    await value("select count(*)::int v from public.tasks"),
    tasksNow,
    "Invio più vecchio dal file: nessun sollecito",
  );
  eq(await openCount(a.id), 1, "…e il sollecito del team resta aperto");

  const twin = await partner({ name: "Club sintetico doppio" });
  const twinAt = days(-3);
  for (const op of [randomUUID(), randomUUID()])
    await db.query(
      `insert into public.partner_activities(operation_id,partner_id,partner_name,partner_co,kind,origin,occurred_at,message_kind,created_by)
       values($1,$2,'Club sintetico doppio',$3,'inviato','file',$4,'primo',$5)`,
      [op, twin.id, twin.co, twinAt, uploader],
    );
  eq(
    (await followUps(twin.id)).rows.length,
    1,
    "Due righe del file con la stessa data: un sollecito",
  );
  eq(await openCount(twin.id), 1, "…e resta aperto");

  const deal = await partner({ name: "Club sintetico accordo" });
  await rpc(
    "import_partner_device_file",
    randomUUID(),
    deviceFile("telefono", days(-6), { [deal.key]: "contattato" }),
    uploader,
  );
  eq(await openCount(deal.id), 1);
  await rpc(
    "import_partner_device_file",
    randomUUID(),
    deviceFile("computer", days(-2), { [deal.key]: "chiuso" }),
    uploader,
  );
  eq(await openCount(deal.id), 0, "«Accordo fatto» dal file chiude il sollecito");
  const declined = await partner({ name: "Club sintetico rifiuto", stage: "no" });
  await db.query(
    `insert into public.partner_activities(operation_id,partner_id,partner_name,partner_co,kind,origin,occurred_at,message_kind,created_by)
     values($1,$2,'Club sintetico rifiuto',$3,'inviato','file',$4,'primo',$5)`,
    [randomUUID(), declined.id, declined.co, days(-1), uploader],
  );
  eq((await followUps(declined.id)).rows.length, 0, "«Non interessato»: nessun sollecito dal file");
  const newer = await partner({ name: "Club sintetico già sentito" });
  await rpc("record_partner_activity", randomUUID(), {
    schema_version: 1,
    partner_id: newer.id,
    kind: "risposta",
  });
  await db.query(
    `insert into public.partner_activities(operation_id,partner_id,partner_name,partner_co,kind,origin,occurred_at,message_kind,created_by)
     values($1,$2,'Club sintetico già sentito',$3,'inviato','file',$4,'primo',$5)`,
    [randomUUID(), newer.id, newer.co, days(-4), uploader],
  );
  eq((await followUps(newer.id)).rows.length, 0, "Attività del team più recente: nessun sollecito");
  eq(
    await value(
      "select count(*)::int v from (select l.partner_id from public.partner_work_links l join public.tasks t on t.id=l.task_id where l.kind='follow_up' and t.status<>'done' group by l.partner_id having count(*)>1) x",
    ),
    0,
    "Mai due solleciti aperti per lo stesso contatto",
  );
  eq(
    await value(
      "select count(*)=count(distinct activity_id) v from public.partner_work_links where kind='follow_up'",
    ),
    true,
    "Un collegamento per attività",
  );
  const reply = await rpc("record_partner_activity", randomUUID(), {
    schema_version: 1,
    partner_id: a.id,
    kind: "risposta",
  });
  eq(reply.stage, "risposto");
  eq(await openCount(a.id), 0, "«Ha risposto» chiude il sollecito");

  // 4. «Contatti da fare» con la regola di «Adesso» (decisione 33), sugli stessi dati del test
  //    di Partner (src/lib/partner/periods.test.ts).
  const day = fixture.today;
  const countBefore = (await today(day)).contact_count;
  for (const row of fixture.partners) {
    const id = randomUUID();
    const before = (await today(day)).contact_count;
    await db.query(
      `insert into public.partners(id,co,source_key,name,origin,stage,created_by,sections,priority,contact_month,next_action,next_action_on,research_removed_at)
       values($1,$2,$3,$4,'research',$5,$6,array['vendita'],'media',$7::date,case when $8::date is null then null else 'Richiamare' end,$8::date,case when $9 then now() end)`,
      [
        id,
        row.co,
        `T${row.co}`,
        `Contatto sintetico ${row.co}`,
        row.stage,
        founder,
        row.contact_month,
        row.next_action_on,
        row.removed === true,
      ],
    );
    if (row.blocked)
      await db.query(
        "insert into public.partner_do_not_contact(partner_id,active,reason,created_by)values($1,true,'Blocco sintetico',$2)",
        [id, founder],
      );
    eq(
      (await today(day)).contact_count - before,
      row.today ? 1 : 0,
      `CO ${row.co}: ${row.today ? "in" : "fuori da"} Oggi`,
    );
  }
  eq(
    (await today(day)).contact_count - countBefore,
    fixture.expected_today,
    "Oggi conta come «Adesso» di Partner (stessi dati del test Vitest)",
  );
  eq(
    fixture.partners.filter((row) => row.today).length,
    fixture.expected_today,
    "Fixture coerente",
  );
  eq(
    await value(
      `select count(*)::int v from public.partners p where p.co between 801 and 899
        and p.stage not in('chiuso','no') and p.research_removed_at is null and not private.partner_blocked(p.id)
        and(p.next_action_on<=$1::date or(p.next_action_on is null and p.stage='da_contattare' and p.contact_month<=date_trunc('month',$1::date)::date))`,
      [day],
    ),
    fixture.expected_old_rule,
    "La regola di prima (solo il mese in corso) ne contava meno",
  );
  await rejects(() => today(day, outsider), "42501");

  // 5. «Collega l'evento» con l'evento già passato.
  const linked = await work("event", { partner_id: agreedPast.id });
  ok(linked.target_id, "Accordo fatto e date passate: l'evento entra in calendario");
  const pastEvent = await one("select * from public.calendar_events where id=$1", [
    linked.target_id,
  ]);
  eq(pastEvent.title, `Evento · Raduno sintetico ${agreedPast.co}`);
  eq(JSON.parse(pastEvent.description).allDay, true, "Giornata intera");
  eq(JSON.parse(pastEvent.description).typeLabel, "Evento partner");
  eq(
    await value(
      "select (starts_at at time zone 'Europe/Rome')::text v from public.calendar_events where id=$1",
      [pastEvent.id],
    ),
    "2026-05-02 00:00:00",
  );
  eq(
    await value(
      "select (ends_at at time zone 'Europe/Rome')::text v from public.calendar_events where id=$1",
      [pastEvent.id],
    ),
    "2026-05-04 00:00:00",
    "Fine alla mezzanotte dopo l'ultimo giorno",
  );
  const pastLink = await one(
    "select * from public.partner_work_links where partner_id=$1 and kind='event'",
    [agreedPast.id],
  );
  eq(pastLink.calendar_event_id, pastEvent.id);
  eq(pastLink.source_key, "dates");
  eq(pastLink.needs_review, false);
  eq(
    pastLink.source_snapshot,
    {
      title: pastEvent.title,
      description: pastEvent.description,
      starts_at: pastLink.source_snapshot.starts_at,
      ends_at: pastLink.source_snapshot.ends_at,
    },
    "Fotografia dell'appuntamento salvata",
  );
  const auditBefore = await value("select count(*)::int v from public.audit_logs");
  await db.query("select private.sync_partner_work_dates($1,null)", [agreedPast.id]);
  eq(
    await value("select count(*)::int v from public.audit_logs"),
    auditBefore,
    "Stesso formato della sincronizzazione: nessuna riscrittura",
  );
  const eventsBefore = await value("select count(*)::int v from public.calendar_events");
  const pressed = await work("event", { partner_id: agreedPast.id });
  eq(pressed.target_id, pastEvent.id, "Secondo tocco: stesso appuntamento");
  eq(await value("select count(*)::int v from public.calendar_events"), eventsBefore);
  const op = randomUUID();
  await rejects(
    () => work("event", { partner_id: randomUUID() }, op),
    "22023",
    "partner_work_source_missing",
  );
  const order = randomUUID();
  await db.query(
    "insert into public.sales_orders(id,operation_id,payload_sha256,channel,occurred_at,operational_date,total_cents,payment_state,fulfillment_mode,fulfillment_state,created_by)values($1,$2,repeat('0',64),'direct',now(),(now()at time zone'Europe/Rome')::date,0,'unpaid','prepare','unfulfilled',$3)",
    [order, randomUUID(), founder],
  );
  await work("link_sale", { partner_id: agreedPast.id, event_id: pastEvent.id, order_id: order });
  eq(
    await value("select count(*)::int v from public.partner_event_sales where event_id=$1", [
      pastEvent.id,
    ]),
    1,
    "Vendita collegata all'evento passato",
  );
  await db.query("update public.partners set event_ends_on='2026-05-04' where id=$1", [
    agreedPast.id,
  ]);
  eq(
    await value(
      "select (ends_at at time zone 'Europe/Rome')::date::text v from public.calendar_events where id=$1",
      [pastEvent.id],
    ),
    "2026-05-05",
    "Una modifica della scheda aggiorna lo stesso appuntamento",
  );
  const otherPast = await partner({ starts: "2026-06-10" });
  await db.query("update public.partners set stage='chiuso' where id=$1", [otherPast.id]);
  await db.query("update public.partners set name='Raduno sintetico rinominato' where id=$1", [
    otherPast.id,
  ]);
  eq(
    await value("select count(*)::int v from public.partner_work_links where partner_id=$1", [
      otherPast.id,
    ]),
    0,
    "La sincronizzazione automatica salta ancora le date passate",
  );
  const talking = await partner({ stage: "trattativa", starts: "2026-06-10" });
  await rejects(
    () => work("event", { partner_id: talking.id }),
    "22023",
    "partner_work_not_agreed",
  );
  const undated = await partner({ stage: "chiuso" });
  await rejects(
    () => work("event", { partner_id: undated.id }),
    "22023",
    "partner_work_date_required",
  );
  const removed = await partner({ starts: "2026-06-12" });
  await db.query(
    "update public.partners set stage='chiuso',research_removed_at=now() where id=$1",
    [removed.id],
  );
  await rejects(
    () => work("event", { partner_id: removed.id }),
    "22023",
    "partner_work_source_missing",
  );
  eq(
    await value("select count(*)::int v from public.partner_work_links where partner_id=$1", [
      removed.id,
    ]),
    0,
    "Fuori dalla ricerca: niente appuntamento",
  );

  // 6. Trigger del calendario senza EXECUTE per i client: scattano lo stesso.
  for (const signature of [
    "private.partner_calendar_changed()",
    "private.partner_calendar_deleted()",
  ])
    for (const role of ["authenticated", "anon"])
      eq(
        await value("select has_function_privilege($1,$2,'execute') v", [role, signature]),
        false,
        `${signature}: niente execute per ${role}`,
      );
  const linkBefore = await one("select * from public.partner_work_links where id=$1", [
    futureLink.id,
  ]);
  await as(() =>
    db.query("update public.calendar_events set title='Stand sintetico confermato' where id=$1", [
      futureLink.calendar_event_id,
    ]),
  );
  const changed = await one("select * from public.partner_work_links where id=$1", [futureLink.id]);
  eq(changed.needs_review, true, "Modifica di un membro: il trigger scatta");
  eq(Number(changed.version), Number(linkBefore.version) + 1);
  await as(() =>
    db.query("delete from public.calendar_events where id=$1", [futureLink.calendar_event_id]),
  );
  const deleted = await one("select * from public.partner_work_links where id=$1", [futureLink.id]);
  eq(deleted.calendar_event_id, null, "Cancellazione di un membro: collegamento senza evento");
  eq(Number(deleted.version), Number(changed.version) + 1, "Cancellazione: nuova versione");
  eq(deleted.needs_review, true);
  const third = await partner({ starts: days(50).slice(0, 10) });
  await db.query("update public.partners set stage='chiuso' where id=$1", [third.id]);
  const thirdLink = await one(
    "select * from public.partner_work_links where partner_id=$1 and kind='event'",
    [third.id],
  );
  await as(() =>
    db.query("delete from public.calendar_events where id=$1", [thirdLink.calendar_event_id]),
  );
  eq(
    (await one("select needs_review from public.partner_work_links where id=$1", [thirdLink.id]))
      .needs_review,
    true,
    "Cancellazione di un membro: il trigger before delete scatta",
  );

  // 7. Indici delle chiavi esterne.
  for (const [table, column] of [
    ["partner_work_links", "activity_id"],
    ["partner_work_links", "project_id"],
    ["partner_work_links", "created_by"],
    ["partner_event_sales", "order_id"],
    ["partner_event_sales", "partner_id"],
    ["partner_event_sales", "created_by"],
  ])
    eq(
      await value(
        `select exists(select 1 from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=i.indkey[0]
          where i.indrelid=('public.'||$1)::regclass and a.attname=$2 and i.indpred is null) v`,
        [table, column],
      ),
      true,
      `Indice su ${table}.${column}`,
    );

  // 8. Stesse firme, attributi e permessi delle funzioni sostituite.
  for (const signature of [
    "private.partner_work_activity_trigger()",
    "private.partner_today(date)",
    "private.partner_work_command(uuid,jsonb)",
  ]) {
    const fn = await one("select prosecdef,proconfig from pg_proc where oid=$1::regprocedure", [
      signature,
    ]);
    eq(fn.prosecdef, true, `${signature}: security definer`);
    eq(fn.proconfig, ['search_path=""'], `${signature}: search_path vuoto`);
  }
  eq(
    await value(
      "select count(*)::int v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in('partner_work_activity_trigger','partner_today','partner_work_command','sync_partner_work_dates')",
    ),
    4,
    "Nessuna funzione duplicata",
  );
  for (const [signature, allowed] of [
    ["private.partner_work_activity_trigger()", false],
    ["private.partner_today(date)", true],
    ["public.read_partner_today(date)", true],
    ["private.partner_work_command(uuid,jsonb)", true],
    ["public.create_partner_work(uuid,jsonb)", true],
    ["private.sync_partner_work_dates(uuid,uuid,boolean,text)", false],
  ]) {
    eq(
      await value("select has_function_privilege('authenticated',$1,'execute') v", [signature]),
      allowed,
      `${signature}: execute per authenticated`,
    );
    eq(
      await value("select has_function_privilege('anon',$1,'execute') v", [signature]),
      false,
      `${signature}: niente execute per anon`,
    );
  }
  console.log(`PASS ${checks} Partner and Today fixes synthetic checks passed.`);
} catch (error) {
  console.error(
    JSON.stringify({
      message: error.message,
      code: error.code,
      detail: error.detail,
      where: error.where,
      query: error.query,
      stack: error.stack?.split("\n").slice(0, 4).join(" | "),
    }),
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
