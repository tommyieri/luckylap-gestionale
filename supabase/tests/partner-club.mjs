// test-db: pglite minimo 56
// Sezione «Club» del modulo Partner (_partner_sezione_club.sql): vincolo delle sezioni,
// private.partner_sections, comando save_partner e import della ricerca con il generatore vero.
// Prima lo stato di produzione (la sezione club rifiutata), poi la migrazione: i dati esistenti
// restano identici. Solo dati sintetici, Auth simulato, nessuna rete.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildPartnerImport } from "../generate-partner-import.mjs";

if (!process.argv[2])
  throw new Error("Passare il percorso esterno di @electric-sql/pglite/dist/index.js.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);

let checks = 0;
const eq = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks += 1;
};
const ok = (value, label) => {
  assert.ok(value, label);
  checks += 1;
};
async function rejects(fn, code, label) {
  let error;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  ok(error, `${label}: rifiutato`);
  eq(error.code, code, `${label}: codice ${code}`);
}

const migrations = new URL("../migrations/", import.meta.url);
function migration(suffix) {
  const found = readdirSync(migrations).filter((name) => name.endsWith(`_${suffix}.sql`));
  assert.equal(found.length, 1, `Una sola migrazione ${suffix}`);
  return readFileSync(new URL(found[0], migrations), "utf8");
}

const users = { founder: randomUUID(), production: randomUUID() };
const db = new PGlite();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
async function as(role, sql, params = []) {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: users[role], aal: "aal1" }),
    ]);
    await db.exec("set local role authenticated");
    const result = await db.query(sql, params);
    await db.exec("commit");
    return result.rows;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const cmd = async (role, name, payload) =>
  (
    await as(role, `select public.${name}($1, $2::jsonb) r`, [
      randomUUID(),
      JSON.stringify(payload),
    ])
  )[0].r;

// Repository Partner finto (lo stesso di partner.mjs) e import con il generatore vero.
const fixtureRoot = new URL("./fixtures/partner/", import.meta.url);
const fixtureText = (path) => readFileSync(new URL(path, fixtureRoot), "utf8");
const repository = () => ({
  partners: JSON.parse(fixtureText("site/data/partners.json")),
  variants: JSON.parse(fixtureText("research/bozze/varianti.json")),
  context: fixtureText("CONTESTO.md"),
});
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
async function runImport(built) {
  for (const batch of built.batches)
    await one("select private.stage_partner_research($1, $2) r", [batch.text, sha(batch.text)]);
  return (
    await one("select private.apply_partner_research($1, $2::text[]) r", [
      built.normalized,
      built.batches.map((b) => b.sha),
    ])
  ).r;
}
const sectionsOf = async (source) =>
  (await one("select sections from public.partners where source_key = $1", [source]))?.sections;
const fingerprint = async () =>
  (
    await one(
      "select md5(string_agg(to_jsonb(p)::text, '|' order by p.co)) v from public.partners p",
    )
  ).v;
let co = 900;
const insertRaw = (sections) =>
  db.query(
    `insert into public.partners(co, origin, name, sections, priority, contact_month, created_by)
     values ($1, 'team', $2, $3::text[], 'media', date_trunc('month', current_date)::date, $4)`,
    [++co, `Club sintetico ${co}`, sections, users.founder],
  );

try {
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  await db.exec(migration("initial_schema"));
  await db.exec(migration("partner_module"));
  for (const [role, id] of Object.entries(users)) {
    await db.query("insert into auth.users values ($1)", [id]);
    await db.query("insert into public.profiles(user_id, display_name) values ($1, $2)", [
      id,
      role,
    ]);
    await db.query(
      "insert into public.memberships(user_id, role, active, finance_access) values ($1, $2, true, false)",
      [id, role],
    );
  }
  await runImport(buildPartnerImport({ ...repository(), commit: "f6ad90c" }));
  eq(
    (await one("select count(*)::int n from public.partners")).n,
    6,
    "Import della ricerca sintetica: 6 contatti",
  );

  // 1. Stato di produzione: la sezione club non esiste ancora.
  await rejects(() => insertRaw(["club"]), "23514", "Prima della migrazione, sezione club");
  await rejects(
    () => one("select private.partner_sections($1::jsonb) r", ['["club"]']),
    "22023",
    "Prima della migrazione, partner_sections con club",
  );
  const before = await fingerprint();

  // 2. Migrazione: dati identici, vincolo con lo stesso nome, permessi invariati.
  await db.exec(migration("partner_sezione_club"));
  eq(await fingerprint(), before, "Contatti identici dopo la migrazione");
  eq(
    (
      await q(
        "select conname from pg_constraint where conrelid = 'public.partners'::regclass and contype = 'c' and conname like '%sections%'",
      )
    ).map((r) => r.conname),
    ["partners_sections_check"],
    "Un solo vincolo delle sezioni, con il nome di prima",
  );
  for (const role of ["anon", "authenticated", "service_role"])
    eq(
      (
        await one(
          "select has_function_privilege($1, 'private.partner_sections(jsonb)', 'execute') v",
          [role],
        )
      ).v,
      false,
      `${role} non esegue private.partner_sections`,
    );

  // 3. Vincolo della tabella.
  for (const sections of [
    ["club"],
    ["eventi", "club"],
    ["vendita", "eventi", "collab", "club"],
    ["club", "collab", "eventi", "vendita"],
  ]) {
    await insertRaw(sections);
    ok(true, `Vincolo: ${sections.join(", ")} ammesso`);
  }
  for (const sections of [
    [],
    ["clubs"],
    ["club", "club"],
    ["club", "vendita", "club"],
    ["vendita", "eventi", "club", "club"],
    ["vendita", "eventi", "collab", "club", "vendita"],
  ])
    await rejects(() => insertRaw(sections), "23514", `Vincolo: [${sections.join(", ")}]`);

  // 4. private.partner_sections: ordine canonico e rifiuti.
  const canonical = async (input) =>
    (await one("select private.partner_sections($1::jsonb) r", [JSON.stringify(input)])).r;
  eq(await canonical(["club"]), ["club"], "partner_sections: solo club");
  eq(await canonical(["club", "vendita"]), ["vendita", "club"], "partner_sections: club in fondo");
  eq(
    await canonical(["club", "collab", "eventi", "vendita"]),
    ["vendita", "eventi", "collab", "club"],
    "partner_sections: quattro sezioni in ordine canonico",
  );
  for (const input of [
    [],
    ["club", "club"],
    ["clubs"],
    [1],
    "club",
    ["vendita", "eventi", "collab", "club", "altro"],
  ])
    await rejects(
      () => canonical(input),
      "22023",
      `partner_sections: ${JSON.stringify(input)} rifiutato`,
    );

  // 5. Comando del team: contatto nuovo nella sezione Club, e Club aggiunto a una scheda.
  const created = await cmd("production", "save_partner", {
    schema_version: 1,
    partner_id: null,
    name: "Porsche Club Sintetico Estero",
    country: "Germania",
    type_label: "Club e registri",
    sections: ["club"],
    priority: "alta",
    contact_month: "2026-11",
  });
  ok(created.id, "save_partner: contatto nuovo creato");
  eq(
    (await one("select sections from public.partners where id = $1", [created.id])).sections,
    ["club"],
    "save_partner: sezione club salvata",
  );
  const l002 = await one(
    "select id, version::int version from public.partners where source_key = 'L002'",
  );
  await cmd("founder", "save_partner", {
    schema_version: 1,
    partner_id: l002.id,
    expected_version: l002.version,
    sections: ["club", "eventi"],
  });
  eq(
    await sectionsOf("L002"),
    ["eventi", "club"],
    "save_partner: Club aggiunto in ordine canonico",
  );
  await rejects(
    () =>
      cmd("production", "save_partner", {
        schema_version: 1,
        partner_id: null,
        name: "Club sbagliato",
        sections: ["clubs"],
        priority: "media",
        contact_month: "2026-11",
      }),
    "22023",
    "save_partner: sezione sconosciuta",
  );
  eq(
    (await one("select count(*)::int n from public.partner_activities where kind = 'nuovo'")).n,
    1,
    "Registro: una riga per il contatto nuovo",
  );

  // 6. Import della ricerca con un club: contatto nuovo solo Club, un altro con Club in più.
  const repo = repository();
  const base = repo.partners.leads.find((lead) => lead.id === "n004");
  repo.partners.leads.push({
    ...base,
    id: "c007",
    co: 7,
    window: "subito",
    month: "2026-11",
    name: "Ferrari Club Sintetico Sette",
    country: "Svizzera",
    type: "Club e registri",
    sections: ["club"],
    idea: { club: "Maglietta co-firmata con il logo del club ricamato sulla manica." },
    web: "https://club-sette.example.test",
    email: "segreteria@club-sette.example.test",
    email_ok: true,
    phone: "",
    whatsapp: "",
    ig: "",
    form: "",
    brand_page: "",
    sources: ["https://club-sette.example.test/kontakt"],
  });
  const l006 = repo.partners.leads.find((lead) => lead.id === "L006");
  l006.sections = ["club", ...l006.sections];
  const built = buildPartnerImport({ ...repo, commit: "a1b2c3d" });
  eq(built.report.by_section.club, 2, "Generatore: due contatti nella sezione Club");
  const second = await runImport(built);
  ok(second, "Import con la sezione Club applicato");
  eq(await sectionsOf("c007"), ["club"], "Import: contatto nuovo solo Club");
  eq(
    await sectionsOf("L006"),
    ["vendita", "eventi", "collab", "club"],
    "Import: Club aggiunto in ordine canonico",
  );
  eq(
    (
      await one(
        "select research -> 'idea' ->> 'club' v from public.partners where source_key = 'c007'",
      )
    ).v,
    "Maglietta co-firmata con il logo del club ricamato sulla manica.",
    "Import: idea della sezione Club nella ricerca",
  );
  eq(
    (
      await one(
        "select count(*)::int n from public.partner_contacts c join public.partners p on p.id = c.partner_id where p.source_key = 'c007' and c.kind = 'email' and c.active",
      )
    ).n,
    1,
    "Import: email del club attiva",
  );
  eq(
    await sectionsOf("L002"),
    ["eventi", "club"],
    "Import: la scheda cambiata dal team resta del team",
  );
  eq(
    (
      await one(
        "select count(*)::int n from public.partner_import_differences d join public.partners p on p.id = d.partner_id where p.source_key = 'L002' and d.field = 'sections' and d.status = 'open'",
      )
    ).n,
    0,
    "Import: nessuna differenza dove la ricerca non cambia le sezioni",
  );
  // Il team legge i contatti Club come gli altri: 4 inseriti dal vincolo, 2 dai comandi, 2 dall'import.
  eq(
    (
      await as(
        "production",
        "select count(*)::int n from public.partners where 'club' = any(sections)",
      )
    )[0].n,
    8,
    "Il team legge i contatti della sezione Club",
  );
  console.log(`PASS ${checks} Partner sezione Club synthetic checks passed.`);
} finally {
  await db.close();
}
