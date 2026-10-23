// test-db: pglite minimo 76
// Calendario solo per gli eventi a cui partecipiamo (20261023113212_partner_dates_only_agreed).
// Prima lo stato di produzione con la regola vecchia (date di schede senza accordo già nel
// calendario), poi la migrazione: pulizia, regola nuova sui cambi di stato, «Collega l'evento».
// Solo dati sintetici, Auth simulato, nessuna rete.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  production = randomUUID();
const migrations = new URL("../migrations/", import.meta.url);
const migration = (suffix) => {
  const names = readdirSync(migrations).filter((n) => n.endsWith(suffix));
  assert.equal(names.length, 1, `Una sola migrazione ${suffix}`);
  return readFileSync(new URL(names[0], migrations), "utf8");
};
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
const cmd = (kind, extra = {}, op = randomUUID()) =>
  as(
    async () =>
      (
        await db.query("select public.create_partner_work($1,$2::jsonb)r", [
          op,
          JSON.stringify({ schema_version: 1, kind, ...extra }),
        ])
      ).rows[0].r,
  );
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const value = async (sql, args = []) => (await one(sql, args))?.v;
let co = 100;
async function partner(stage, { dates = true, deadline = false } = {}) {
  const id = randomUUID();
  co++;
  await db.query(
    `insert into public.partners(id,co,name,origin,stage,created_by,sections,priority,contact_month,event_starts_on,event_ends_on,application_deadline)
     values($1,$2,$3,'team',$4,$5,array['eventi'],'media',date_trunc('month',current_date)::date,
     case when $6 then current_date+60 end,case when $6 then current_date+61 end,case when $7 then current_date+30 end)`,
    [id, co, `Raduno sintetico ${co}`, stage, founder, dates, deadline],
  );
  return id;
}
const link = (partnerId, kind = "event") =>
  one("select * from public.partner_work_links where partner_id=$1 and kind=$2", [partnerId, kind]);
const eventOf = async (partnerId, kind = "event") => {
  const row = await link(partnerId, kind);
  if (!row?.calendar_event_id) return null;
  return (
    (await one("select * from public.calendar_events where id=$1", [row.calendar_event_id])) ?? null
  );
};
const stage = (partnerId, next) =>
  db.query("update public.partners set stage=$2 where id=$1", [partnerId, next]);
const events = () => value("select count(*)::int v from public.calendar_events");
let orders = 0;
async function sale(partnerId) {
  const order = randomUUID();
  orders++;
  await db.query(
    "insert into public.sales_orders(id,operation_id,payload_sha256,channel,occurred_at,operational_date,total_cents,payment_state,fulfillment_mode,fulfillment_state,created_by)values($1,$2,repeat('0',64),'direct',now(),(now()at time zone'Europe/Rome')::date,0,'unpaid','prepare','unfulfilled',$3)",
    [order, randomUUID(), founder],
  );
  const row = await link(partnerId);
  await db.query(
    "insert into public.partner_event_sales(event_id,order_id,partner_id,created_by)values($1,$2,$3,$4)",
    [row.calendar_event_id, order, partnerId, founder],
  );
}

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
  ])
    await db.exec(migration(suffix));
  for (const [id, role] of [
    [founder, "founder"],
    [production, "production"],
  ]) {
    await db.query("insert into auth.users values($1)", [id]);
    await db.query("insert into public.profiles(user_id,display_name)values($1,$2)", [
      id,
      `Persona sintetica ${role}`,
    ]);
    await db.query("insert into public.memberships(user_id,role)values($1,$2)", [id, role]);
  }

  // 1. Stato di oggi in produzione, con la regola vecchia (bastava stage <> 'no').
  const untouched = await partner("da_contattare", { deadline: true });
  const edited = await partner("contattato");
  const withSale = await partner("risposto");
  const agreed = await partner("chiuso", { deadline: true });
  const deletedByTeam = await partner("trattativa");
  const kept = await partner("da_contattare");
  const declined = await partner("no");
  eq(await events(), 8, "Regola vecchia: ogni scheda con date future, tranne «no», nel calendario");
  eq(await link(declined), undefined, "Regola vecchia: «Non interessato» già fuori");
  await db.query("update public.calendar_events set title='Titolo scritto dal team' where id=$1", [
    (await link(edited)).calendar_event_id,
  ]);
  await sale(withSale);
  await db.query("delete from public.calendar_events where id=$1", [
    (await link(deletedByTeam)).calendar_event_id,
  ]);
  eq((await link(deletedByTeam)).needs_review, true, "Cancellazione del team: da rivedere");
  const keptLink = await link(kept);
  await db.query("update public.calendar_events set title='Tenuto a mano' where id=$1", [
    keptLink.calendar_event_id,
  ]);
  await cmd("resolve", {
    link_id: keptLink.id,
    expected_version: Number((await link(kept)).version),
    keep_manual: true,
  });
  eq((await link(kept)).detached, true, "Modifiche manuali mantenute dal team");
  const agreedBefore = await eventOf(agreed);
  eq(await events(), 7);

  // 2. La migrazione: funzioni sostituite e pulizia.
  await db.exec(migration("_partner_dates_only_agreed.sql"));
  eq(await eventOf(untouched), null, "Evento automatico senza accordo: cancellato");
  eq(await eventOf(untouched, "deadline"), null, "Scadenza automatica senza accordo: cancellata");
  const cleaned = await link(untouched);
  eq(cleaned.source_snapshot, {}, "Collegamento azzerato");
  eq(cleaned.needs_review, false, "Niente da rivedere dopo la pulizia");
  eq((await eventOf(edited))?.title, "Titolo scritto dal team", "Evento modificato dal team resta");
  eq((await link(edited)).needs_review, true, "Evento modificato: da rivedere");
  ok(await eventOf(withSale), "Evento con vendite collegate resta");
  eq((await link(withSale)).needs_review, true, "Evento con vendite: da rivedere");
  eq(
    await value("select count(*)::int v from public.partner_event_sales"),
    1,
    "Vendita collegata intatta",
  );
  eq((await eventOf(agreed))?.id, agreedBefore.id, "Accordo fatto: l'evento resta lo stesso");
  eq((await eventOf(agreed))?.title, agreedBefore.title);
  ok(await eventOf(agreed, "deadline"), "Accordo fatto: anche la scadenza resta");
  eq((await link(agreed)).needs_review, false);
  const gone = await link(deletedByTeam);
  eq(gone.needs_review, false, "Senza accordo e già cancellato: niente da rivedere");
  eq(gone.source_snapshot, {});
  eq((await eventOf(kept))?.title, "Tenuto a mano", "Scelta «mantieni» del team rispettata");
  eq((await link(kept)).detached, true);
  eq(await link(declined), undefined);
  eq(await events(), 5, "Restano: accordo (2), modificato, con vendite, tenuto a mano");
  const repeat = await value("select count(*)::int v from public.audit_logs");
  await db.exec(
    "select private.sync_partner_work_dates(partner_id,null) from (select distinct partner_id from public.partner_work_links where source_key='dates') l",
  );
  eq(await events(), 5, "Pulizia ripetuta: nessun effetto");
  eq(
    await value("select count(*)::int v from public.audit_logs"),
    repeat,
    "Pulizia ripetuta: nessuna scrittura",
  );

  // 3. Regola nuova sui cambi di stato.
  const fresh = await partner("da_contattare", { deadline: true });
  eq(await link(fresh), undefined, "Scheda nuova senza accordo: niente appuntamento");
  eq(await events(), 5);
  await stage(fresh, "trattativa");
  eq(await link(fresh), undefined, "In trattativa: ancora fuori dal calendario");
  await stage(fresh, "chiuso");
  const created = await eventOf(fresh);
  ok(created, "Accordo fatto con date future: evento creato");
  eq(created.title, `Evento · Raduno sintetico ${co}`);
  eq(JSON.parse(created.description).allDay, true, "Giornata intera");
  eq(
    await value(
      "select ((starts_at at time zone 'Europe/Rome')::date-current_date) v from public.calendar_events where id=$1",
      [created.id],
    ),
    60,
    "Inizio alla mezzanotte di Roma del giorno dell'evento",
  );
  ok(await eventOf(fresh, "deadline"), "Accordo fatto: anche la scadenza");
  eq(await events(), 7);
  await stage(fresh, "risposto");
  eq(await eventOf(fresh), null, "Tolto l'accordo: evento cancellato");
  eq(await eventOf(fresh, "deadline"), null, "Tolto l'accordo: scadenza cancellata");
  eq((await link(fresh)).needs_review, false);
  eq(await events(), 5);
  await stage(fresh, "chiuso");
  const again = await eventOf(fresh);
  ok(again, "Di nuovo accordo: evento ricreato");
  eq(
    await value("select count(*)::int v from public.partner_work_links where partner_id=$1", [
      fresh,
    ]),
    2,
    "Stessi collegamenti, nessun doppione",
  );
  await db.query("update public.calendar_events set title='Stand confermato' where id=$1", [
    again.id,
  ]);
  await stage(fresh, "no");
  eq((await eventOf(fresh))?.title, "Stand confermato", "Modificato dal team: resta");
  eq((await link(fresh)).needs_review, true, "Modificato dal team: da rivedere");
  eq(await eventOf(fresh, "deadline"), null, "La scadenza non toccata va via");

  const soldOut = await partner("chiuso");
  ok(await eventOf(soldOut));
  await sale(soldOut);
  await stage(soldOut, "trattativa");
  ok(await eventOf(soldOut), "Con vendite collegate: resta");
  eq((await link(soldOut)).needs_review, true, "Con vendite collegate: da rivedere");

  const past = await partner("da_contattare", { dates: false });
  await db.query(
    "update public.partners set event_starts_on=current_date-10,event_ends_on=current_date-9 where id=$1",
    [past],
  );
  await stage(past, "chiuso");
  eq(await link(past), undefined, "Accordo su un evento passato: nessun appuntamento");

  // 4. «Collega l'evento» e «Usa date Partner» seguono la stessa regola.
  const notAgreed = await partner("trattativa");
  await rejects(() => cmd("event", { partner_id: notAgreed }), "22023", "partner_work_not_agreed");
  eq(await link(notAgreed), undefined, "Comando rifiutato: nessuna scrittura");
  eq(
    await value("select count(*)::int v from private.partner_work_receipts"),
    1,
    "Nessuna ricevuta per il comando rifiutato",
  );
  const undated = await partner("chiuso", { dates: false });
  await rejects(() => cmd("event", { partner_id: undated }), "22023", "partner_work_date_required");
  const linked = await cmd("event", { partner_id: agreed });
  eq(linked.target_id, (await link(agreed)).calendar_event_id, "Accordo fatto: comando riuscito");
  eq(linked.replayed, false);
  const review = await link(edited);
  await cmd("resolve", {
    link_id: review.id,
    expected_version: Number(review.version),
    keep_manual: false,
  });
  eq(await eventOf(edited), null, "«Usa date Partner» senza accordo: l'evento va via");
  eq((await link(edited)).needs_review, false);
  const sold = await link(withSale);
  await rejects(
    () =>
      cmd("resolve", {
        link_id: sold.id,
        expected_version: Number(sold.version),
        keep_manual: false,
      }),
    "22023",
    "partner_work_event_has_sales",
  );
  ok(await eventOf(withSale), "Vendite collegate: l'evento non si cancella");

  // 5. Stesse firme, attributi e permessi.
  for (const signature of [
    "private.sync_partner_work_dates(uuid,uuid,boolean,text)",
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
      "select count(*)::int v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in('sync_partner_work_dates','partner_work_command')",
    ),
    2,
    "Nessuna funzione duplicata",
  );
  for (const [signature, allowed] of [
    ["private.sync_partner_work_dates(uuid,uuid,boolean,text)", false],
    ["private.partner_work_command(uuid,jsonb)", true],
    ["public.create_partner_work(uuid,jsonb)", true],
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
  eq(orders, 2);
  console.log(`PASS ${checks} Partner dates only agreed synthetic checks passed.`);
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
