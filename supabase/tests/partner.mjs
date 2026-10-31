// test-db: pglite minimo 343
// Partner (P2): migrazione partner_module su PGlite, con i soli dati sintetici del repository
// Partner finto in fixtures/partner (domini example.test, numeri +39 000 000 00xx). Auth simulato,
// nessun accesso cloud. Cinque gruppi, ognuno su un database nuovo: schema e sicurezza, import
// della ricerca, comandi del team, file dei dispositivi, generatore offline. I lotti dell'import
// vengono dal generatore vero (supabase/generate-partner-import.mjs); il gruppo 5 lo esegue anche
// da riga di comando su un repository git usa e getta, in una cartella temporanea poi cancellata.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RESEARCH_KEYS,
  WINDOWS,
  buildPartnerImport,
  linkValue,
} from "../generate-partner-import.mjs";

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
async function caught(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return null;
}
async function fails(promise, code, message, label) {
  const error = await caught(promise);
  assert.ok(error, `${label}: nessun errore`);
  assert.equal(error.code, code, `${label}: codice ${error.code} (${error.message})`);
  if (message instanceof RegExp) assert.match(error.message, message, label);
  else if (message) assert.equal(error.message, message, label);
  checks += 1;
  return error;
}

const ROLES = [
  "founder",
  "production",
  "finance",
  "logistics",
  "consultant",
  "outsider",
  "inactive",
];
const users = Object.fromEntries(
  ROLES.map((role, index) => [
    role,
    `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ]),
);
const TABLES = [
  "partners",
  "partner_contacts",
  "partner_message_variants",
  "partner_message_revisions",
  "partner_activities",
  "partner_do_not_contact",
  "partner_research_imports",
  "partner_device_imports",
  "partner_import_differences",
];
const COMMANDS = [
  "set_partner_state",
  "save_partner",
  "record_partner_activity",
  "save_partner_message",
  "restore_partner_message",
  "save_partner_contact",
  "remove_partner_contact",
  "set_partner_do_not_contact",
  "resolve_partner_difference",
  "import_partner_device_file",
];
// Colonne che possono finire in audit_logs (02 §2.3, senza i lookbook).
const AUDITED = {
  partners: [
    "co",
    "source_key",
    "name",
    "stage",
    "owner_id",
    "next_action_on",
    "chosen_approach",
    "contact_month",
    "priority",
    "sections",
    "research_removed_at",
    "version",
  ],
  partner_contacts: ["partner_id", "kind", "active", "verified", "erased_at", "version"],
  partner_message_variants: [
    "partner_id",
    "approach",
    "channel",
    "language",
    "lookbook_code",
    "current_revision_id",
    "original_changed_at",
    "research_removed_at",
    "version",
  ],
  partner_message_revisions: ["variant_id", "revision_no", "kind", "created_by"],
  partner_activities: [
    "partner_id",
    "partner_name",
    "partner_co",
    "kind",
    "origin",
    "occurred_at",
    "message_kind",
    "channel",
    "approach",
    "stage_before",
    "stage_after",
    "owner_after",
    "next_action_on",
  ],
  partner_do_not_contact: ["partner_id", "domain", "active"],
  partner_research_imports: [
    "source_commit",
    "partners_total",
    "partners_new",
    "partners_updated",
    "partners_removed",
    "variants_total",
    "differences_new",
  ],
  partner_device_imports: [
    "device",
    "exported_at",
    "stages_applied",
    "texts_applied",
    "approaches_applied",
    "differences",
  ],
  partner_import_differences: [
    "origin",
    "partner_id",
    "variant_id",
    "contact_id",
    "field",
    "status",
  ],
};

const migrationsDirectory = new URL("../migrations/", import.meta.url);
function migration(suffix) {
  const found = readdirSync(migrationsDirectory).filter((name) => name.endsWith(`_${suffix}.sql`));
  assert.equal(found.length, 1, `Una sola migrazione ${suffix}`);
  return readFileSync(new URL(found[0], migrationsDirectory), "utf8");
}

// ---------------------------------------------------------------------------
// Repository Partner finto e lotti dell'import
// ---------------------------------------------------------------------------

const fixtureRoot = new URL("./fixtures/partner/", import.meta.url);
const fixtureText = (path) => readFileSync(new URL(path, fixtureRoot), "utf8");
function repository() {
  return {
    partners: JSON.parse(fixtureText("site/data/partners.json")),
    varianti: JSON.parse(fixtureText("research/bozze/varianti.json")),
    context: fixtureText("CONTESTO.md"),
  };
}
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
// Lotti dell'import con il generatore vero (supabase/generate-partner-import.mjs, funzione pura).
// Ordine: periodo del sito, poi il suo CO. Ogni .sql entro batchBytes.
function buildResearchImport({ partners, varianti, context, commit, batchBytes = 40000 }) {
  return buildPartnerImport({ partners, variants: varianti, context, commit, batchBytes });
}

function devicePayload(text) {
  const file = JSON.parse(text);
  return {
    schema_version: 1,
    file_sha256: sha(text),
    device: file.dispositivo,
    exported_at: file.esportato,
    stages: file.stato,
    texts: file.testi,
    approaches: file.approccio,
    names: file.contatti,
  };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

async function q(db, sql, params = []) {
  return (await db.query(sql, params)).rows;
}
async function one(db, sql, params = []) {
  return (await q(db, sql, params))[0];
}
async function as(db, role, sql, params = []) {
  await db.exec("begin");
  try {
    if (role !== "anon") {
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: users[role], aal: "aal1" }),
      ]);
    }
    await db.exec(`set local role ${role === "anon" ? "anon" : "authenticated"}`);
    const result = await db.query(sql, params);
    await db.exec("commit");
    return result.rows;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const cmdText = async (db, role, name, payloadText, operation = randomUUID()) =>
  (await as(db, role, `select public.${name}($1, $2::jsonb) r`, [operation, payloadText]))[0].r;
const cmd = (db, role, name, payload, operation = randomUUID()) =>
  cmdText(db, role, name, JSON.stringify(payload), operation);
const preview = async (db, role, payload) =>
  (
    await as(db, role, "select public.preview_partner_device_file($1::jsonb) r", [
      JSON.stringify(payload),
    ])
  )[0].r;
// Come il file .sql del generatore: il testo del lotto e il suo SHA-256.
const stage = async (db, text, expected = sha(text)) =>
  (await one(db, "select private.stage_partner_research($1, $2) r", [text, expected])).r;
const apply = async (db, built, shas = built.batches.map((b) => b.sha)) =>
  (
    await one(db, "select private.apply_partner_research($1, $2::text[]) r", [
      built.normalized,
      shas,
    ])
  ).r;
async function runImport(db, built) {
  for (const batch of built.batches) await stage(db, batch.text);
  return apply(db, built);
}
const count = async (db, table, where = "true", params = []) =>
  (await one(db, `select count(*)::int n from ${table} where ${where}`, params)).n;
const partnerIds = async (db) =>
  Object.fromEntries(
    (await q(db, "select source_key, id from public.partners where source_key is not null")).map(
      (r) => [r.source_key, r.id],
    ),
  );
const version = async (db, table, id) =>
  (await one(db, `select version::int v from public.${table} where id = $1`, [id])).v;
const pick = (object, keys) => Object.fromEntries(keys.map((key) => [key, object[key]]));

async function freshDb({ withImport = true } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  await db.exec(migration("initial_schema"));
  await db.exec(migration("partner_module"));
  for (const role of ROLES) {
    await db.query("insert into auth.users values ($1)", [users[role]]);
    if (role === "outsider") continue;
    await db.query("insert into public.profiles(user_id, display_name) values ($1, $2)", [
      users[role],
      role,
    ]);
    await db.query(
      "insert into public.memberships(user_id, role, active, finance_access) values ($1, $2, $3, false)",
      [users[role], role === "inactive" ? "consultant" : role, role !== "inactive"],
    );
  }
  if (withImport) await runImport(db, buildResearchImport({ ...repository(), commit: "f6ad90c" }));
  return db;
}

// Audit senza recapiti né testi: solo le colonne elencate, nessuna email, nessun numero, nessun testo.
async function auditPrivacy(db, label) {
  const rows = await q(
    db,
    "select table_name, operation, record_key, old_data, new_data from public.audit_logs where table_name like 'partner%'",
  );
  const extra = new Set();
  for (const row of rows) {
    for (const key of [...Object.keys(row.old_data ?? {}), ...Object.keys(row.new_data ?? {})]) {
      if (key !== "_changed" && !AUDITED[row.table_name].includes(key))
        extra.add(`${row.table_name}.${key}`);
    }
  }
  eq([...extra], [], `${label}: audit con le sole colonne elencate`);
  // Il dominio bloccato è una colonna conservata (02 §2.3): è il sito di un'azienda, non un recapito.
  const text = JSON.stringify(
    rows.map((row) =>
      row.table_name === "partner_do_not_contact"
        ? {
            ...row,
            old_data: { ...row.old_data, domain: null },
            new_data: { ...row.new_data, domain: null },
          }
        : row,
    ),
  );
  eq(
    ["@", "example.test", "+39", "000 000", "390000000"].filter((needle) => text.includes(needle)),
    [],
    `${label}: nessuna email, nessun sito, nessun telefono nell'audit`,
  );
  eq(
    ["Hallo", "Hello", "Testo", "Nota", "sintetic", "Cosa dire", "contattato da noi"].filter(
      (needle) => text.includes(needle),
    ),
    [],
    `${label}: nessun testo dei messaggi, delle note o dei motivi nell'audit`,
  );
}

// Una riga di registro per contatto e operazione, attribuita a chi ha eseguito il comando.
async function oneActivityPerCommand(db, label) {
  const rows = await q(
    db,
    `select r.operation_id, r.command_kind, r.result ->> 'activity_id' activity, count(a.id)::int n,
       count(*) filter (where a.created_by <> r.actor_id)::int foreign_actor
     from private.partner_command_receipts r left join public.partner_activities a on a.operation_id = r.operation_id
     where r.command_kind <> 'import_partner_device_file' group by 1, 2, 3`,
  );
  eq(
    rows.filter((r) => r.n !== (r.activity ? 1 : 0) || r.foreign_actor > 0),
    [],
    `${label}: una riga di registro per comando, con l'attore della sessione`,
  );
}

try {
  // -------------------------------------------------------------------------
  // 1. Schema e sicurezza
  // -------------------------------------------------------------------------
  {
    const db = await freshDb();
    checks += 2; // migrazioni initial_schema e partner_module applicate su PGlite
    for (const table of TABLES) {
      eq(
        await one(
          db,
          `select c.relrowsecurity rls,
             has_table_privilege('authenticated', c.oid, 'select') as read,
             has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate,references,trigger') as write,
             has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger') anon,
             exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
               and p.policyname = 'member_read' and p.cmd = 'SELECT' and p.roles = '{authenticated}') policy,
             exists (select 1 from pg_trigger t join pg_proc f on f.oid = t.tgfoid
               where t.tgrelid = c.oid and f.proname = 'audit_change_keys') audit
           from pg_class c where c.oid = $1::regclass`,
          [`public.${table}`],
        ),
        { rls: true, read: true, write: false, anon: false, policy: true, audit: true },
        `${table}: RLS, sola lettura per i membri, nessun privilegio ad anon, audit con chiavi`,
      );
    }
    for (const table of ["partner_command_receipts", "partner_import_staging"]) {
      eq(
        await one(
          db,
          `select c.relrowsecurity rls,
             has_table_privilege('authenticated', c.oid, 'select,insert,update,delete') auth,
             has_table_privilege('anon', c.oid, 'select,insert,update,delete') anon,
             has_table_privilege('service_role', c.oid, 'select,insert,update,delete') service
           from pg_class c where c.oid = $1::regclass`,
          [`private.${table}`],
        ),
        { rls: true, auth: false, anon: false, service: false },
        `private.${table}: RLS attiva, nessun ruolo client`,
      );
    }
    const functions = await q(
      db,
      `select n.nspname "schema", p.proname "name", p.oid::regprocedure::text signature, p.prosecdef definer,
         coalesce(p.proconfig, '{}') config,
         has_function_privilege('authenticated', p.oid, 'execute') auth,
         has_function_privilege('anon', p.oid, 'execute') anon,
         has_function_privilege('service_role', p.oid, 'execute') service
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and (p.proname like '%partner%' or p.proname = 'audit_change_keys')
       order by 1, 2`,
    );
    ok(functions.length >= 45, `Funzioni del modulo presenti (${functions.length})`);
    eq(
      functions.filter((f) => !f.config.includes('search_path=""')).map((f) => f.signature),
      [],
      "Ogni funzione ha search_path vuoto",
    );
    const exposed = [...COMMANDS, "preview_partner_device_file"].flatMap((name) => [
      `private.${name}`,
      `public.${name}`,
    ]);
    eq(
      functions
        .filter((f) => f.auth)
        .map((f) => `${f.schema}.${f.name}`)
        .sort(),
      exposed.sort(),
      "authenticated esegue solo i comandi e l'anteprima",
    );
    eq(
      functions.filter((f) => f.anon || f.service).map((f) => f.signature),
      [],
      "anon e service_role non eseguono nessuna funzione Partner",
    );
    eq(
      functions.filter((f) => f.schema === "public" && f.definer).map((f) => f.name),
      [],
      "I wrapper pubblici sono security invoker",
    );
    eq(
      functions
        .filter(
          (f) => f.schema === "private" && exposed.includes(`private.${f.name}`) && !f.definer,
        )
        .map((f) => f.name),
      [],
      "I comandi privati sono security definer",
    );
    for (const name of ["stage_partner_research", "apply_partner_research"]) {
      const f = functions.find((x) => x.name === name);
      eq(
        [f.definer, f.auth, f.anon, f.service],
        [false, false, false, false],
        `${name}: security invoker, nessun ruolo client`,
      );
    }
    eq(
      await one(
        db,
        `select has_function_privilege('authenticated', 'private.is_member()', 'execute') member,
           has_function_privilege('authenticated', 'public.adjust_stock(uuid,uuid,uuid,bigint,text)', 'execute') stock`,
      ),
      { member: true, stock: true },
      "I grant delle funzioni esistenti non cambiano",
    );
    await fails(
      as(db, "anon", "select id from public.partners"),
      "42501",
      /permission denied/,
      "anon non legge i contatti",
    );
    eq(
      (await as(db, "consultant", "select count(*)::int n from public.partners"))[0].n,
      6,
      "Un membro legge tutti i contatti",
    );
    for (const role of ["outsider", "inactive"]) {
      eq(
        await as(
          db,
          role,
          `select (select count(*) from public.partners)::int partners, (select count(*) from public.partner_contacts)::int contacts,
             (select count(*) from public.partner_message_variants)::int variants,
             (select count(*) from public.partner_research_imports)::int imports`,
        ),
        [{ partners: 0, contacts: 0, variants: 0, imports: 0 }],
        `${role}: nessuna riga leggibile`,
      );
      for (const name of COMMANDS) {
        await fails(
          cmd(db, role, name, {}),
          "42501",
          "partner_access_required",
          `${role}: ${name} rifiutato prima di leggere il payload`,
        );
      }
      await fails(
        preview(db, role, {}),
        "42501",
        "partner_access_required",
        `${role}: anteprima rifiutata`,
      );
    }
    for (const [sql, label] of [
      [
        "insert into public.partners(co, origin, name, sections, priority, contact_month) values (99, 'team', 'Falso', '{vendita}', 'alta', '2026-11-01')",
        "insert diretto",
      ],
      ["update public.partners set stage = 'chiuso'", "update diretto"],
      ["delete from public.partner_contacts", "delete diretto"],
      ["select * from private.partner_command_receipts", "lettura delle ricevute"],
    ]) {
      await fails(
        as(db, "founder", sql),
        "42501",
        /permission denied/,
        `Membro: ${label} rifiutato`,
      );
    }

    // Una riga in ogni tabella append-only, poi update e delete rifiutati anche al proprietario.
    const ids = await partnerIds(db);
    const variant = await one(
      db,
      "select id, version::int version from public.partner_message_variants where partner_id = $1 and approach = 'collab'",
      [ids.L001],
    );
    await cmd(db, "founder", "save_partner_message", {
      schema_version: 1,
      partner_id: ids.L001,
      approach: "collab",
      expected_version: variant.version,
      subject: "Oggetto del team",
      body: "Testo del team, sintetico.",
      follow_up: "",
      confirm_email: "",
    });
    await cmd(
      db,
      "founder",
      "import_partner_device_file",
      devicePayload(fixtureText("exports/luckylap-partner-2026-10-21-computer.json")),
    );
    for (const [table, column] of [
      ["public.partner_message_revisions", "created_at"],
      ["public.partner_activities", "created_at"],
      ["public.partner_research_imports", "applied_at"],
      ["public.partner_device_imports", "imported_at"],
      ["private.partner_command_receipts", "created_at"],
    ]) {
      ok((await count(db, table)) > 0, `${table}: almeno una riga da proteggere`);
      await fails(
        q(db, `update ${table} set ${column} = now()`),
        "42501",
        /append-only/,
        `${table}: update rifiutato`,
      );
      await fails(
        q(db, `delete from ${table}`),
        "42501",
        /append-only/,
        `${table}: delete rifiutato`,
      );
    }
    const audit = await q(
      db,
      "select table_name, operation, record_key, new_data from public.audit_logs where table_name like 'partner%'",
    );
    ok(
      audit.some(
        (r) => r.table_name === "partner_activities" && r.record_key.partner_id && r.record_key.id,
      ),
      "record_key del registro con id e partner_id",
    );
    ok(
      audit.some((r) => r.table_name === "partner_message_revisions" && r.record_key.variant_id),
      "record_key delle revisioni con variant_id",
    );
    ok(
      audit
        .filter((r) => r.operation === "UPDATE")
        .every((r) => Array.isArray(r.new_data._changed) && r.new_data._changed.length > 0),
      "Gli UPDATE registrano i nomi delle colonne cambiate",
    );
    await auditPrivacy(db, "Schema");
    await db.close();
  }

  // -------------------------------------------------------------------------
  // 2. Import della ricerca
  // -------------------------------------------------------------------------
  {
    const db = await freshDb({ withImport: false });
    const data = repository();
    eq(
      data.partners.leads.filter((l) => l.variants).map((l) => [l.id, l.variants]),
      data.varianti.contacts.map((c) => [c.id, c.variants]),
      "Fixture: varianti uguali in partners.json e varianti.json",
    );
    const built = buildResearchImport({ ...data, commit: "f6ad90c", batchBytes: 6000 });
    ok(
      built.batches.length >= 2 && built.batches.every((b) => Buffer.byteLength(b.text) <= 6000),
      `Lotti entro la dimensione massima (${built.batches.length})`,
    );
    const staged = [];
    for (const batch of built.batches) staged.push(await stage(db, batch.text));
    eq(
      staged.map((s) => [s.staged, s.payload_sha256, s.batch_count]),
      built.batches.map((b) => [true, b.sha, built.batches.length]),
      "Lotti registrati, SHA-256 uguale a quello del generatore",
    );
    eq(
      (await stage(db, built.batches[0].text)).staged,
      false,
      "Stesso lotto ripetuto: nessun effetto",
    );
    await fails(
      stage(db, built.batches[0].text.replace("Garage Sintetico Uno", "Garage Diverso")),
      "22023",
      "partner_batch_conflict",
      "Stesso indice con testo diverso",
    );
    const badPriority = JSON.parse(built.batches[0].text);
    badPriority.partners[0].priority = "altissima";
    const error = await fails(
      stage(db, JSON.stringify(badPriority)),
      "22023",
      "invalid_partner_research",
      "Priorità fuori elenco",
    );
    eq(error.detail, "Contatto L001: dati non validi.", "L'errore cita il codice, non i dati");
    const badSections = JSON.parse(built.batches[0].text);
    badSections.partners[0].sections = ["vendita", "vendita"];
    await fails(
      stage(db, JSON.stringify(badSections)),
      "22023",
      "invalid_partner_research",
      "Sezioni ripetute",
    );
    const badVariant = JSON.parse(built.batches[0].text);
    badVariant.partners[0].variants[0].language = "jp";
    await fails(
      stage(db, JSON.stringify(badVariant)),
      "22023",
      "invalid_partner_research",
      "Lingua fuori elenco",
    );
    await fails(stage(db, "{non è json"), "22023", "invalid_partner_research", "Lotto non JSON");
    // Il generatore rifiuta un import vuoto: il lotto si scrive a mano per provare il database.
    const emptyText = JSON.stringify({
      ...JSON.parse(built.batches[0].text),
      normalized_sha256: sha("import vuoto"),
      source_commit: "c3d4e5f",
      batch_index: 1,
      batch_count: 1,
      partners: [],
    });
    const empty = {
      normalized: sha("import vuoto"),
      batches: [{ text: emptyText, sha: sha(emptyText) }],
    };
    await fails(
      runImport(db, empty),
      "22023",
      "invalid_partner_research",
      "Import senza contatti: rifiutato",
    );
    const otherCommit = buildResearchImport({ ...data, commit: "b2c3d4e", batchBytes: 6000 });
    const [otherFirst] = otherCommit.batches;
    await fails(
      stage(db, otherFirst.text.replace("Garage Sintetico Uno", "Garage Alterato"), otherFirst.sha),
      "22023",
      "partner_batch_altered",
      "Lotto arrivato alterato: rifiutato",
    );
    eq(
      await count(db, "private.partner_import_staging", "normalized_sha256 = $1", [
        otherCommit.normalized,
      ]),
      0,
      "Lotto alterato: nessuna riga in transito",
    );
    eq(
      (await stage(db, otherFirst.text, otherFirst.sha)).staged,
      true,
      "Lo stesso file rimandato: lotto registrato, senza altre scritture",
    );
    await fails(
      stage(db, otherFirst.text, "abc"),
      "22023",
      "invalid_partner_research",
      "SHA-256 atteso non valido",
    );
    await fails(apply(db, otherCommit), "22023", "partner_import_incomplete", "Lotto mancante");
    await fails(
      apply(db, built, built.batches.map((b) => b.sha).reverse()),
      "22023",
      "partner_import_incomplete",
      "SHA-256 dei lotti in ordine sbagliato",
    );
    eq(await count(db, "public.partners"), 0, "Import rifiutato: nessuna scrittura");

    const report = await apply(db, built);
    eq(
      pick(report, [
        "partners_total",
        "partners_new",
        "partners_updated",
        "partners_removed",
        "variants_total",
        "variants_new",
        "differences_new",
        "replayed",
      ]),
      {
        partners_total: 6,
        partners_new: 6,
        partners_updated: 0,
        partners_removed: 0,
        variants_total: 8,
        variants_new: 8,
        differences_new: 0,
        replayed: false,
      },
      "Primo import: resoconto",
    );
    eq(
      await q(
        db,
        "select source_key, co, contact_month::text as month, sections, stage, origin, created_by from public.partners order by co",
      ),
      [
        ["L001", 1, "2026-10-01", ["vendita", "collab"]],
        ["L002", 2, "2026-11-01", ["eventi"]],
        ["n003", 3, "2026-12-01", ["collab"]],
        ["n004", 4, "2027-02-01", ["eventi", "collab"]],
        ["n005", 5, "2027-04-01", ["vendita"]],
        ["L006", 6, "2027-07-01", ["vendita", "eventi", "collab"]],
      ].map(([source_key, co, month, sections]) => ({
        source_key,
        co,
        month,
        sections,
        stage: "da_contattare",
        origin: "research",
        created_by: null,
      })),
      "CO 1…6 nell'ordine della ricerca; mese dal periodo se manca; sezioni in ordine canonico",
    );
    eq(
      await q(
        db,
        `select p.source_key, c.kind, c.link_value, c.verified, c.position from public.partner_contacts c
           join public.partners p on p.id = c.partner_id order by p.co, c.position`,
      ),
      [
        ["L001", "email", "info@garage-uno.example.test", true, 0],
        ["L001", "phone", "+390000000001", false, 1],
        ["L001", "instagram", "@garage_uno", false, 3],
        ["L001", "web", "https://www.garage-uno.example.test/", false, 6],
        ["L002", "email", "info@raduno-due.example.test", false, 0],
        ["L002", "instagram", "@radunodue", false, 3],
        ["L002", "form", "https://raduno-due.example.test/espositori", false, 4],
        ["L002", "web", "https://raduno-due.example.test", false, 6],
        ["n003", "phone", "+390000000003", false, 1],
        ["n003", "whatsapp", "+390000000004", false, 2],
        ["n003", "instagram", "@club_registro_tre", false, 3],
        ["n003", "web", "https://club-tre.example.test/", false, 6],
        ["n004", "email", "studio@quattro.example.test", false, 0],
        ["n004", "instagram", "@creator.quattro", false, 3],
        ["n004", "brand_page", "https://brand.example.test/quattro", false, 5],
        ["n004", "web", "https://quattro.example.test/", false, 6],
        ["n005", "web", "https://cinque.example.test/shop", false, 6],
        ["L006", "email", "segreteria@club-sei.example.test", true, 0],
        ["L006", "phone", null, false, 1],
        ["L006", "web", null, false, 6],
      ].map(([source_key, kind, link_value, verified, position]) => ({
        source_key,
        kind,
        link_value,
        verified,
        position,
      })),
      "Recapiti per slot: primo telefono, primo indirizzo, Instagram con note o da link, testo senza link",
    );
    eq(
      await one(
        db,
        `select value, research_value = value same from public.partner_contacts c join public.partners p on p.id = c.partner_id
           where p.source_key = 'L002' and c.kind = 'email'`,
      ),
      {
        value:
          "info@raduno-due.example.test, stampa@raduno-due.example.test; booking@raduno-due.example.test",
        same: true,
      },
      "Il testo intero resta nella scheda; research_value è la base del confronto",
    );
    const l001 = await one(
      db,
      "select research, research_base, research_removed_at from public.partners where source_key = 'L001'",
    );
    eq(
      l001.research_base,
      {
        name: "Garage Sintetico Uno",
        city: "Monaco",
        country: "Germania",
        type_label: "Concept store car-culture",
        sections: ["vendita", "collab"],
        priority: "alta",
        contact_month: "2026-10-01",
        event_starts_on: null,
        event_ends_on: null,
        preferred_channel: "email",
      },
      "research_base con i valori importati",
    );
    eq(
      [
        l001.research.skipped_it,
        "draft" in l001.research,
        l001.research.route,
        l001.research_removed_at,
      ],
      [
        "Media scartato: il negozio non ha una rivista.",
        false,
        "Email al titolare. Poi una telefonata dopo una settimana.",
        null,
      ],
      "research con i testi della ricerca e skipped_it, senza draft",
    );
    eq(
      await one(
        db,
        `select v.lookbook_code, v.origin, v.current_revision_id, v.original_body like 'Hello,%' body
           from public.partner_message_variants v join public.partners p on p.id = v.partner_id
           where p.source_key = 'L006' and v.approach = 'media'`,
      ),
      { lookbook_code: null, origin: "research", current_revision_id: null, body: true },
      "Variante: lookbook vuoto diventa nullo, vale l'originale",
    );
    eq(
      await one(
        db,
        `select batch_count, source_commit, source_generated::text as generated, context_md = $1 context,
           partners_total, variants_total from public.partner_research_imports`,
        [data.context],
      ),
      {
        batch_count: built.batches.length,
        source_commit: "f6ad90c",
        generated: "2026-10-21",
        context: true,
        partners_total: 6,
        variants_total: 8,
      },
      "Riga dell'import con commit, contatori e CONTESTO.md",
    );
    eq(
      await count(db, "private.partner_import_staging", "normalized_sha256 = $1", [
        built.normalized,
      ]),
      0,
      "Lotti in transito cancellati dopo l'applicazione",
    );
    const versionsBefore = await q(db, "select id, version::int from public.partners order by co");
    const replay = await apply(db, built);
    eq(
      [replay.replayed, replay.import_id, replay.partners_new],
      [true, report.import_id, 6],
      "Stesso import: replayed con il resoconto di allora",
    );
    eq(
      await q(db, "select id, version::int from public.partners order by co"),
      versionsBefore,
      "Stesso import: nessuna modifica",
    );
    eq(
      [
        (await stage(db, built.batches[0].text)).already_applied,
        await count(db, "private.partner_import_staging", "normalized_sha256 = $1", [
          built.normalized,
        ]),
      ],
      [true, 0],
      "Lotto di un import già applicato: non torna in transito",
    );
    ok(
      (await q(db, "select actor_id from public.audit_logs where table_name = 'partners'")).every(
        (r) => r.actor_id === null,
      ),
      "L'import della ricerca è del sistema (attore nullo)",
    );

    // Modifiche del team prima del secondo import.
    const ids = await partnerIds(db);
    const v = async (source) => version(db, "partners", ids[source]);
    await cmd(db, "founder", "save_partner", {
      schema_version: 1,
      partner_id: ids.n003,
      expected_version: await v("n003"),
      city: "Torino Nord",
    });
    await cmd(db, "founder", "save_partner", {
      schema_version: 1,
      partner_id: ids.n004,
      expected_version: await v("n004"),
      country: "Inghilterra",
    });
    await cmd(db, "founder", "save_partner", {
      schema_version: 1,
      partner_id: ids.n005,
      expected_version: await v("n005"),
      type_label: "Shop curato",
    });
    const contact = async (source, kind) =>
      one(
        db,
        "select id, version::int version from public.partner_contacts where partner_id = $1 and kind = $2",
        [ids[source], kind],
      );
    const l001Phone = await contact("L001", "phone");
    await cmd(db, "production", "remove_partner_contact", {
      schema_version: 1,
      contact_id: l001Phone.id,
      expected_version: l001Phone.version,
      erase: true,
    });
    const n003Phone = await contact("n003", "phone");
    const n003Collab = async () =>
      one(
        db,
        "select to_text, cc_text, version::int version from public.partner_message_variants where partner_id = $1 and approach = 'collab'",
        [ids.n003],
      );
    const collabBefore = await n003Collab();
    const erasedPhone = await cmd(db, "production", "remove_partner_contact", {
      schema_version: 1,
      contact_id: n003Phone.id,
      expected_version: n003Phone.version,
      erase: true,
    });
    eq(
      [collabBefore.to_text, erasedPhone.messages_cleaned, await n003Collab()],
      ["+39 000 000 0003", 1, { to_text: "", cc_text: "", version: collabBefore.version + 1 }],
      "Cancella il dato: tolto anche dai destinatari dei messaggi",
    );
    const strip = async (to, erased, kind) =>
      (
        await one(
          db,
          "select private.partner_strip_recipients($1, private.partner_recipient_items($2, $3)) r",
          [to, erased, kind],
        )
      ).r;
    eq(
      [
        await strip(
          "info@raduno-due.example.test, stampa@raduno-due.example.test; booking@raduno-due.example.test",
          "Stampa@raduno-due.example.test",
          "email",
        ),
        await strip(
          "Sede +39 000 000 0001; Magazzino +39 000 000 0002",
          "000 000 0002 (magazzino)",
          "phone",
        ),
        await strip("info@garage_uno.example.test", "@garage_uno", "instagram"),
        await strip(
          "https://www.raduno-due.example.test/espositori/",
          "https://raduno-due.example.test/espositori",
          "form",
        ),
        await strip("segreteria@club-sei.example.test", "info@club-sei.example.test", "email"),
      ],
      [
        "info@raduno-due.example.test, booking@raduno-due.example.test",
        "Sede +39 000 000 0001",
        "info@garage_uno.example.test",
        "",
        "segreteria@club-sei.example.test",
      ],
      "Destinatari: si toglie solo la voce del dato cancellato, anche scritta in altro modo",
    );
    const l002Ig = await contact("L002", "instagram");
    await cmd(db, "production", "remove_partner_contact", {
      schema_version: 1,
      contact_id: l002Ig.id,
      expected_version: l002Ig.version,
      erase: false,
    });
    const l006Email = await contact("L006", "email");
    await cmd(db, "finance", "save_partner_contact", {
      schema_version: 1,
      contact_id: l006Email.id,
      partner_id: ids.L006,
      expected_version: l006Email.version,
      kind: "email",
      value: "presidenza@club-sei.example.test",
    });
    const vendita = await one(
      db,
      "select id, version::int version, original_subject subject, original_follow_up follow_up from public.partner_message_variants where partner_id = $1 and approach = 'vendita'",
      [ids.L001],
    );
    const teamText = "Hallo,\n\nTesto del team per la vendita.\n\nViele Grüße\nEttore";
    await cmd(db, "logistics", "save_partner_message", {
      schema_version: 1,
      partner_id: ids.L001,
      approach: "vendita",
      expected_version: vendita.version,
      subject: vendita.subject,
      body: teamText,
      follow_up: vendita.follow_up,
      confirm_email: "",
    });
    await cmd(db, "consultant", "set_partner_do_not_contact", {
      schema_version: 1,
      partner_id: ids.L002,
      active: true,
      reason: "Ha chiesto di non essere contattato da noi",
      include_domain: true,
    });

    const second = structuredClone(data);
    const lead = (d, id) => d.partners.leads.find((l) => l.id === id);
    const variantOf = (d, id, approach) => [
      lead(d, id).variants.find((x) => x.approach === approach),
      d.varianti.contacts.find((c) => c.id === id).variants.find((x) => x.approach === approach),
    ];
    lead(second, "L001").name = "Garage Sintetico Uno Monaco";
    lead(second, "n004").country = "UK";
    lead(second, "n005").type = "Shop curato";
    lead(second, "L002").ig = "@radunodue_ufficiale";
    lead(second, "n003").web = "https://club-tre.example.test/nuovo";
    lead(second, "n004").brand_page = "";
    for (const x of variantOf(second, "L001", "vendita"))
      x.body = "Hallo,\n\nNeuer Originaltext.\n\nViele Grüße\nTommi";
    for (const x of variantOf(second, "L001", "collab")) x.subject = "A shirt together, again";
    lead(second, "L006").variants = lead(second, "L006").variants.filter(
      (x) => x.approach !== "media",
    );
    const l006Variants = second.varianti.contacts.find((c) => c.id === "L006");
    l006Variants.variants = l006Variants.variants.filter((x) => x.approach !== "media");
    second.partners.leads.push({
      ...structuredClone(lead(data, "n005")),
      id: "n007",
      name: "Negozio Sintetico Sette",
      window: "subito",
      month: "2026-11",
      web: "https://shop.raduno-due.example.test/negozio",
      sources: [],
      co: 3,
    });
    const built2 = buildResearchImport({ ...second, commit: "0a1b2c3d4e" });
    for (const batch of built2.batches) await db.exec(batch.sql);
    eq(
      await count(db, "private.partner_import_staging", "normalized_sha256 = $1", [
        built2.normalized,
      ]),
      built2.batches.length,
      "Lotti registrati dai file .sql con quotatura dollaro",
    );
    const report2 = await apply(db, built2);
    eq(
      pick(report2, [
        "partners_total",
        "partners_new",
        "partners_updated",
        "partners_removed",
        "variants_total",
        "variants_new",
        "variants_updated",
        "differences_new",
        "new_codes",
        "erased_skipped",
      ]),
      {
        partners_total: 7,
        partners_new: 1,
        partners_updated: 6,
        partners_removed: 0,
        variants_total: 7,
        variants_new: 0,
        variants_updated: 3,
        differences_new: 3,
        new_codes: [{ source_key: "n007", co: 7 }],
        erased_skipped: [
          { source_key: "L001", slot: "phone" },
          { source_key: "n003", slot: "phone" },
          { source_key: "n003", approach: "collab" },
        ],
      },
      "Secondo import: resoconto",
    );
    eq(
      await n003Collab(),
      { to_text: "", cc_text: "", version: collabBefore.version + 1 },
      "Dato cancellato: l'import non lo rimette nei destinatari",
    );
    eq(
      report2.blocked_codes.sort(),
      ["L002", "n007"],
      "Dominio in lista «non contattare»: segnalato",
    );
    const field = async (source, column) =>
      await one(
        db,
        `select ${column}::text value, research_base ->> '${column}' base from public.partners where source_key = $1`,
        [source],
      );
    eq(
      await field("L001", "name"),
      { value: "Garage Sintetico Uno Monaco", base: "Garage Sintetico Uno Monaco" },
      "Cambiato solo dalla ricerca: aggiornato",
    );
    eq(
      await field("n003", "city"),
      { value: "Torino Nord", base: "Torino" },
      "Cambiato solo dal team: resta",
    );
    eq(
      await field("n005", "type_label"),
      { value: "Shop curato", base: "Shop curato" },
      "Stesso cambio da entrambi: nessuna differenza",
    );
    eq(
      await field("n004", "country"),
      { value: "Inghilterra", base: "UK" },
      "Cambiato da entrambi: resta il valore del team",
    );
    const openDiffs = async () =>
      q(
        db,
        `select p.source_key, d.field, d.origin, d.team_value, d.incoming_value from public.partner_import_differences d
           join public.partners p on p.id = d.partner_id where d.status = 'open' order by p.co, d.field`,
      );
    eq(
      (await openDiffs()).map((d) => [d.source_key, d.field, d.origin]),
      [
        ["L001", "message", "research"],
        ["L002", "contact", "research"],
        ["n004", "country", "research"],
      ],
      "Differenze aperte: messaggio, recapito, campo",
    );
    eq(
      (await openDiffs()).find((d) => d.field === "country"),
      {
        source_key: "n004",
        field: "country",
        origin: "research",
        team_value: "Inghilterra",
        incoming_value: "UK",
      },
      "Differenza con valore del team e valore in arrivo",
    );
    eq(
      await one(
        db,
        "select value, link_value, erased_at is not null erased, active from public.partner_contacts where id = $1",
        [l001Phone.id],
      ),
      { value: null, link_value: null, erased: true, active: false },
      "Recapito cancellato: mai ripristinato",
    );
    eq(
      await one(
        db,
        "select active, research_value, value from public.partner_contacts where id = $1",
        [l002Ig.id],
      ),
      {
        active: false,
        research_value: "@radunodue_ufficiale",
        value: "@radunodue (circa 12k follower, profilo ufficiale)",
      },
      "Recapito rimosso dal team e ricerca diversa: resta rimosso, differenza",
    );
    eq(
      await one(
        db,
        "select value, link_value, active from public.partner_contacts where partner_id = $1 and kind = 'web'",
        [ids.n003],
      ),
      {
        value: "https://club-tre.example.test/nuovo",
        link_value: "https://club-tre.example.test/nuovo",
        active: true,
      },
      "Recapito non toccato: aggiornato con il nuovo link",
    );
    eq(
      await one(
        db,
        "select active, research_value from public.partner_contacts where partner_id = $1 and kind = 'brand_page'",
        [ids.n004],
      ),
      { active: false, research_value: null },
      "Recapito sparito dalla ricerca e non toccato: disattivato",
    );
    eq(
      await one(db, "select value from public.partner_contacts where id = $1", [l006Email.id]),
      { value: "presidenza@club-sei.example.test" },
      "Recapito modificato dal team e ricerca invariata: resta quello del team",
    );
    const venditaAfter = await one(
      db,
      `select v.original_body, v.original_changed_at is not null changed, r.body current_body
         from public.partner_message_variants v join public.partner_message_revisions r on r.id = v.current_revision_id
         where v.id = $1`,
      [vendita.id],
    );
    eq(
      venditaAfter,
      {
        original_body: "Hallo,\n\nNeuer Originaltext.\n\nViele Grüße\nTommi",
        changed: true,
        current_body: teamText,
      },
      "Originale cambiato con un testo del team: original_changed_at, resta in uso il testo del team",
    );
    eq(
      await one(
        db,
        "select original_subject, current_revision_id, original_changed_at from public.partner_message_variants where partner_id = $1 and approach = 'collab'",
        [ids.L001],
      ),
      {
        original_subject: "A shirt together, again",
        current_revision_id: null,
        original_changed_at: null,
      },
      "Originale cambiato senza testo del team: vale il nuovo originale",
    );
    eq(
      await one(
        db,
        "select research_removed_at is not null removed from public.partner_message_variants where partner_id = $1 and approach = 'media'",
        [ids.L006],
      ),
      { removed: true },
      "Variante sparita dalla ricerca: resta, con research_removed_at",
    );
    eq(
      await one(db, "select co, stage from public.partners where source_key = 'n007'"),
      { co: 7, stage: "da_contattare" },
      "Contatto nuovo: CO successivo",
    );

    // Terzo import: differenza aggiornata, contatto assente, contatto nuovo.
    const third = structuredClone(second);
    lead(third, "n004").country = "Gran Bretagna";
    third.partners.leads = third.partners.leads.filter((l) => l.id !== "n005");
    third.partners.leads.push({
      ...structuredClone(lead(data, "n005")),
      id: "n008",
      name: "Negozio Sintetico Otto",
      co: 2,
    });
    const report3 = await runImport(db, buildResearchImport({ ...third, commit: "1b2c3d4" }));
    eq(
      pick(report3, ["partners_new", "partners_removed", "differences_new", "new_codes"]),
      {
        partners_new: 1,
        partners_removed: 1,
        differences_new: 1,
        new_codes: [{ source_key: "n008", co: 8 }],
      },
      "Terzo import: un contatto assente, uno nuovo con CO 8, una differenza nuova",
    );
    eq(
      await q(
        db,
        `select d.status, d.incoming_value from public.partner_import_differences d join public.partners p on p.id = d.partner_id
           where p.source_key = 'n004' and d.field = 'country' order by d.created_at, d.status`,
      ),
      [
        { status: "superseded", incoming_value: "UK" },
        { status: "open", incoming_value: "Gran Bretagna" },
      ],
      "Differenza aperta aggiornata, non duplicata",
    );
    eq(
      await one(
        db,
        "select research_removed_at is not null removed, co, stage from public.partners where source_key = 'n005'",
      ),
      { removed: true, co: 5, stage: "da_contattare" },
      "Contatto assente: research_removed_at, niente cancellato",
    );
    eq(await count(db, "public.partners"), 8, "Nessun contatto cancellato");
    const report4 = await runImport(
      db,
      buildResearchImport({
        ...third,
        partners: { ...third.partners, leads: [...third.partners.leads, lead(second, "n005")] },
        commit: "2c3d4e5",
      }),
    );
    eq(
      [
        report4.partners_new,
        report4.partners_removed,
        await one(
          db,
          "select research_removed_at, co from public.partners where source_key = 'n005'",
        ),
      ],
      [0, 0, { research_removed_at: null, co: 5 }],
      "Contatto tornato: research_removed_at azzerato, stesso CO",
    );

    // Risoluzione delle differenze.
    const diffId = async (source, fieldName) =>
      (
        await one(
          db,
          `select d.id from public.partner_import_differences d join public.partners p on p.id = d.partner_id
             where p.source_key = $1 and d.field = $2 and d.status = 'open'`,
          [source, fieldName],
        )
      ).id;
    const countryDiff = await diffId("n004", "country");
    await fails(
      cmd(db, "founder", "resolve_partner_difference", {
        schema_version: 1,
        difference_id: countryDiff,
        choice: "kept_team",
        expected_version: 1,
      }),
      "40001",
      "partner_changed",
      "Differenza con versione vecchia",
    );
    const keep = await cmd(db, "founder", "resolve_partner_difference", {
      schema_version: 1,
      difference_id: countryDiff,
      choice: "kept_team",
      expected_version: await v("n004"),
    });
    eq(
      [
        keep.choice,
        (await field("n004", "country")).value,
        await one(
          db,
          "select status, resolved_by from public.partner_import_differences where id = $1",
          [countryDiff],
        ),
      ],
      ["kept_team", "Inghilterra", { status: "kept_team", resolved_by: users.founder }],
      "Tieni il nostro: valore del team, differenza chiusa",
    );
    await fails(
      cmd(db, "founder", "resolve_partner_difference", {
        schema_version: 1,
        difference_id: countryDiff,
        choice: "used_incoming",
        expected_version: await v("n004"),
      }),
      "22023",
      "partner_difference_closed",
      "Differenza già chiusa",
    );
    const igDiff = await diffId("L002", "contact");
    await cmd(db, "production", "resolve_partner_difference", {
      schema_version: 1,
      difference_id: igDiff,
      choice: "used_incoming",
      expected_version: await version(db, "partner_contacts", l002Ig.id),
    });
    eq(
      await one(db, "select active, value, link_value from public.partner_contacts where id = $1", [
        l002Ig.id,
      ]),
      { active: true, value: "@radunodue_ufficiale", link_value: "@radunodue_ufficiale" },
      "Usa il nuovo (recapito): valore della ricerca, recapito attivo",
    );
    const messageDiff = await diffId("L001", "message");
    await cmd(db, "consultant", "resolve_partner_difference", {
      schema_version: 1,
      difference_id: messageDiff,
      choice: "used_incoming",
      expected_version: await version(db, "partner_message_variants", vendita.id),
    });
    eq(
      await one(
        db,
        "select current_revision_id, original_changed_at from public.partner_message_variants where id = $1",
        [vendita.id],
      ),
      { current_revision_id: null, original_changed_at: null },
      "Usa il nuovo (messaggio): torna l'originale aggiornato",
    );
    eq(
      (
        await q(
          db,
          `select a.kind from public.partner_activities a join public.partner_import_differences d on d.resolved_by = a.created_by
             and d.partner_id = a.partner_id where d.id = any($1::uuid[]) and a.kind = 'differenza'`,
          [[countryDiff, igDiff, messageDiff]],
        )
      ).length,
      3,
      "Una riga «differenza» per ogni risoluzione",
    );
    eq(await openDiffs(), [], "Nessuna differenza aperta");
    await oneActivityPerCommand(db, "Import");
    await auditPrivacy(db, "Import");
    await db.close();
  }

  // -------------------------------------------------------------------------
  // 3. Comandi del team
  // -------------------------------------------------------------------------
  {
    const db = await freshDb();
    const ids = await partnerIds(db);
    const today = (await one(db, "select (now() at time zone 'Europe/Rome')::date::text d")).d;
    const day = (offset) => {
      const date = new Date(`${today}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    const activities = (operation) =>
      q(
        db,
        `select kind, origin, message_kind, channel, approach, stage_before, stage_after, owner_after,
           next_action_on::text, body, created_by from public.partner_activities where operation_id = $1`,
        [operation],
      );

    // Stato, responsabile, prossima azione, approccio: tutti e cinque i ruoli attivi.
    const P4 = ids.n004;
    let v4 = await version(db, "partners", P4);
    for (const [role, change, kind] of [
      ["founder", { stage: "contattato" }, "stato"],
      ["production", { owner_id: users.production }, "responsabile"],
      [
        "finance",
        { next_action: "Richiamare lo studio", next_action_on: "2026-11-05" },
        "prossima_azione",
      ],
      ["logistics", { chosen_approach: "collab" }, "approccio"],
      ["consultant", { stage: "risposto", owner_id: null }, "stato"],
    ]) {
      const operation = randomUUID();
      const result = await cmd(
        db,
        role,
        "set_partner_state",
        { schema_version: 1, partner_id: P4, expected_version: v4, ...change },
        operation,
      );
      eq(
        [result.version, result.replayed],
        [v4 + 1, false],
        `${role}: scheda aggiornata, versione +1`,
      );
      eq(
        (await activities(operation)).map((a) => [a.kind, a.created_by]),
        [[kind, users[role]]],
        `${role}: una riga «${kind}» attribuita a chi agisce`,
      );
      v4 += 1;
    }
    eq(
      await one(
        db,
        "select stage, owner_id, next_action, next_action_on::text, chosen_approach, approach_from_file_at from public.partners where id = $1",
        [P4],
      ),
      {
        stage: "risposto",
        owner_id: null,
        next_action: "Richiamare lo studio",
        next_action_on: "2026-11-05",
        chosen_approach: "collab",
        approach_from_file_at: null,
      },
      "Scheda dopo i cinque comandi",
    );
    await fails(
      cmd(db, "founder", "set_partner_state", {
        schema_version: 1,
        partner_id: P4,
        expected_version: v4 - 1,
        stage: "trattativa",
      }),
      "40001",
      "partner_changed",
      "Versione vecchia",
    );
    eq(
      (await one(db, "select stage from public.partners where id = $1", [P4])).stage,
      "risposto",
      "Versione vecchia: nessuna modifica",
    );
    const replayOperation = randomUUID();
    const replayPayload = {
      schema_version: 1,
      partner_id: P4,
      expected_version: v4,
      stage: "trattativa",
    };
    const first = await cmd(db, "founder", "set_partner_state", replayPayload, replayOperation);
    eq(
      await cmd(db, "founder", "set_partner_state", replayPayload, replayOperation),
      { ...first, replayed: true },
      "Stessa operazione e stesso payload: stesso risultato",
    );
    eq((await activities(replayOperation)).length, 1, "Ripetizione: una sola riga di registro");
    await fails(
      cmd(
        db,
        "founder",
        "set_partner_state",
        { ...replayPayload, stage: "chiuso" },
        replayOperation,
      ),
      "23505",
      "partner_idempotency_conflict",
      "Stessa operazione, payload diverso",
    );
    await fails(
      cmd(db, "production", "set_partner_state", replayPayload, replayOperation),
      "23505",
      "partner_idempotency_conflict",
      "Stessa operazione, altro utente",
    );
    v4 += 1;
    for (const role of ["inactive", "outsider"]) {
      await fails(
        cmd(db, "founder", "set_partner_state", {
          schema_version: 1,
          partner_id: P4,
          expected_version: v4,
          owner_id: users[role],
        }),
        "22023",
        "partner_owner_inactive",
        `Responsabile ${role}: rifiutato`,
      );
    }
    for (const [payload, label] of [
      [{ schema_version: 1, partner_id: P4, stage: "chiuso" }, "senza versione attesa"],
      [
        { schema_version: 1, partner_id: P4, expected_version: v4, stage: "chiuso", foo: 1 },
        "chiave non ammessa",
      ],
      [
        { schema_version: 2, partner_id: P4, expected_version: v4, stage: "chiuso" },
        "schema_version 2",
      ],
      [
        { schema_version: 1, partner_id: P4, expected_version: v4, stage: "boh" },
        "stato sconosciuto",
      ],
      [
        { schema_version: 1, partner_id: P4, expected_version: v4, next_action: "Solo testo" },
        "prossima azione senza data",
      ],
      [
        {
          schema_version: 1,
          partner_id: P4,
          expected_version: v4,
          next_action: "Testo",
          next_action_on: null,
        },
        "prossima azione con data nulla",
      ],
      [{ schema_version: 1, partner_id: P4, expected_version: v4 }, "nessun campo da cambiare"],
      [
        { schema_version: 1, partner_id: P4, expected_version: String(v4), stage: "chiuso" },
        "versione come testo",
      ],
      [
        { schema_version: 1, partner_id: "CO 4", expected_version: v4, stage: "chiuso" },
        "id non valido",
      ],
      [
        {
          schema_version: 1,
          partner_id: P4,
          expected_version: v4,
          next_action: "Testo",
          next_action_on: "2026-02-30",
        },
        "data inesistente",
      ],
    ]) {
      await fails(
        cmd(db, "founder", "set_partner_state", payload),
        "22023",
        "invalid_partner_payload",
        `Payload ${label}`,
      );
    }
    await fails(
      cmd(db, "founder", "set_partner_state", {
        schema_version: 1,
        partner_id: randomUUID(),
        expected_version: 1,
        stage: "chiuso",
      }),
      "22023",
      "partner_not_found",
      "Contatto inesistente",
    );
    const noop = await cmd(db, "founder", "set_partner_state", {
      schema_version: 1,
      partner_id: P4,
      expected_version: v4,
      stage: "trattativa",
    });
    eq(
      [noop.version, noop.activity_id],
      [v4, null],
      "Nessun cambiamento: nessuna riga, stessa versione",
    );

    // Registro: inviato, risposta, chiamata, incontro, nota.
    const P5 = ids.n005;
    const sentOperation = randomUUID();
    const sent = await cmd(
      db,
      "logistics",
      "record_partner_activity",
      { schema_version: 1, partner_id: P5, kind: "inviato", approach: "vendita", channel: "email" },
      sentOperation,
    );
    eq(
      [
        (await activities(sentOperation))[0],
        await one(db, "select stage, chosen_approach from public.partners where id = $1", [P5]),
      ],
      [
        {
          kind: "inviato",
          origin: "team",
          message_kind: "primo",
          channel: "email",
          approach: "vendita",
          stage_before: "da_contattare",
          stage_after: "contattato",
          owner_after: null,
          next_action_on: null,
          body: "",
          created_by: users.logistics,
        },
        { stage: "contattato", chosen_approach: "vendita" },
      ],
      "Segna inviato: da contattare → contattato, approccio scelto",
    );
    eq(sent.stage, "contattato", "Il risultato riporta lo stato");
    eq(
      (
        await cmd(db, "consultant", "record_partner_activity", {
          schema_version: 1,
          partner_id: P5,
          kind: "risposta",
          channel: "email",
        })
      ).stage,
      "risposto",
      "Ha risposto: contattato → risposto",
    );
    for (const [kind, channel] of [
      ["chiamata", "phone"],
      ["incontro", "visita"],
    ]) {
      eq(
        (
          await cmd(db, "finance", "record_partner_activity", {
            schema_version: 1,
            partner_id: P5,
            kind,
            channel,
          })
        ).stage,
        "risposto",
        `${kind}: lo stato non cambia`,
      );
    }
    const followUp = randomUUID();
    await cmd(
      db,
      "logistics",
      "record_partner_activity",
      {
        schema_version: 1,
        partner_id: P5,
        kind: "inviato",
        message_kind: "sollecito",
        channel: "email",
        approach: "vendita",
      },
      followUp,
    );
    eq(
      pick((await activities(followUp))[0], [
        "kind",
        "message_kind",
        "stage_before",
        "stage_after",
      ]),
      {
        kind: "inviato",
        message_kind: "sollecito",
        stage_before: "risposto",
        stage_after: "risposto",
      },
      "Segna sollecito inviato: stato invariato dopo la risposta",
    );
    const noteOperation = randomUUID();
    await cmd(
      db,
      "production",
      "record_partner_activity",
      { schema_version: 1, partner_id: P5, kind: "nota", body: "  Nota interna del team  " },
      noteOperation,
    );
    eq((await activities(noteOperation))[0].body, "Nota interna del team", "Nota con il testo");
    const yesterday = await cmd(db, "production", "record_partner_activity", {
      schema_version: 1,
      partner_id: P5,
      kind: "nota",
      body: "Nota di ieri",
      occurred_on: day(-1),
    });
    eq(
      (
        await one(
          db,
          "select (occurred_at at time zone 'Europe/Rome')::text t from public.partner_activities where id = $1",
          [yesterday.activity_id],
        )
      ).t,
      `${day(-1)} 12:00:00`,
      "Giorno passato: mezzogiorno di Roma",
    );
    for (const [payload, label] of [
      [{ schema_version: 1, partner_id: P5, kind: "nota" }, "nota senza testo"],
      [{ schema_version: 1, partner_id: P5, kind: "nota", body: "   " }, "nota vuota"],
      [
        { schema_version: 1, partner_id: P5, kind: "risposta", occurred_on: day(1) },
        "giorno futuro",
      ],
      [
        { schema_version: 1, partner_id: P5, kind: "risposta", occurred_on: day(-366) },
        "oltre un anno fa",
      ],
      [
        { schema_version: 1, partner_id: P5, kind: "nota", body: "x", message_kind: "primo" },
        "tipo di messaggio fuori da inviato",
      ],
      [{ schema_version: 1, partner_id: P5, kind: "stato" }, "tipo non ammesso"],
      [{ schema_version: 1, partner_id: P5, kind: "inviato", channel: "ig" }, "canale non ammesso"],
      [
        { schema_version: 1, partner_id: P5, kind: "nota", body: "Testo\u0007con controllo" },
        "carattere di controllo",
      ],
    ]) {
      await fails(
        cmd(db, "founder", "record_partner_activity", payload),
        "22023",
        "invalid_partner_payload",
        `Registro: ${label}`,
      );
    }

    // Lista «non contattare».
    const P6 = ids.L006;
    await fails(
      cmd(db, "founder", "set_partner_do_not_contact", {
        schema_version: 1,
        partner_id: P6,
        active: true,
        reason: "no",
      }),
      "22023",
      "invalid_partner_payload",
      "Motivo troppo corto",
    );
    await fails(
      cmd(db, "founder", "set_partner_do_not_contact", {
        schema_version: 1,
        partner_id: P6,
        active: true,
        reason: "Chiede solo posta",
        include_domain: true,
      }),
      "22023",
      "partner_domain_unavailable",
      "Blocco del dominio senza un sito utilizzabile",
    );
    const block = await cmd(db, "founder", "set_partner_do_not_contact", {
      schema_version: 1,
      partner_id: P6,
      active: true,
      reason: "Ha chiesto di non essere contattato da noi",
    });
    eq(
      [block.active, block.blocked, typeof block.activity_id],
      [true, true, "string"],
      "Contatto bloccato",
    );
    for (const kind of ["inviato", "chiamata", "incontro"]) {
      await fails(
        cmd(db, "production", "record_partner_activity", {
          schema_version: 1,
          partner_id: P6,
          kind,
        }),
        "55000",
        "partner_do_not_contact",
        `Contatto bloccato: ${kind} rifiutato`,
      );
    }
    eq(
      (
        await cmd(db, "production", "record_partner_activity", {
          schema_version: 1,
          partner_id: P6,
          kind: "nota",
          body: "Annotazione ammessa",
        })
      ).stage,
      "da_contattare",
      "Contatto bloccato: nota ammessa",
    );
    const lift = await cmd(db, "consultant", "set_partner_do_not_contact", {
      schema_version: 1,
      partner_id: P6,
      active: false,
    });
    eq(
      [
        lift.blocked,
        await one(db, "select active, lifted_by from public.partner_do_not_contact where id = $1", [
          block.block_id,
        ]),
      ],
      [false, { active: false, lifted_by: users.consultant }],
      "Blocco tolto, con chi l'ha tolto",
    );
    await fails(
      cmd(db, "consultant", "set_partner_do_not_contact", {
        schema_version: 1,
        partner_id: P6,
        active: false,
      }),
      "22023",
      "partner_not_blocked",
      "Togliere un blocco inesistente",
    );

    // private.apply_partner_stage come la chiamano i comandi di altri moduli (05: record_partner_outcome).
    const stageOperation = randomUUID();
    const stageVersion = await version(db, "partners", P6);
    eq(
      (
        await one(db, "select private.apply_partner_stage($1, 'chiuso', $2, $3)::int v", [
          P6,
          users.founder,
          stageOperation,
        ])
      ).v,
      stageVersion + 1,
      "apply_partner_stage con quattro argomenti: versione +1",
    );
    eq(
      (await activities(stageOperation)).map((a) => [
        a.kind,
        a.stage_before,
        a.stage_after,
        a.created_by,
      ]),
      [["stato", "da_contattare", "chiuso", users.founder]],
      "apply_partner_stage scrive la sua riga «stato» con l'operation_id",
    );
    eq(
      [
        (
          await one(db, "select private.apply_partner_stage($1, 'chiuso', $2, $3)::int v", [
            P6,
            users.founder,
            randomUUID(),
          ])
        ).v,
        await count(db, "public.partner_activities", "partner_id = $1 and kind = 'stato'", [P6]),
      ],
      [stageVersion + 1, 1],
      "apply_partner_stage con lo stato già uguale: nessun effetto",
    );
    const silentOperation = randomUUID();
    await q(db, "select private.apply_partner_stage($1, 'no', $2, $3, false)", [
      P6,
      users.founder,
      silentOperation,
    ]);
    eq(
      [
        (await one(db, "select stage from public.partners where id = $1", [P6])).stage,
        await count(db, "public.partner_activities", "operation_id = $1", [silentOperation]),
      ],
      ["no", 0],
      "apply_partner_stage con p_log false: il chiamante scrive la sua riga",
    );
    await fails(
      q(db, "select private.apply_partner_stage($1, 'chiuso', $2, null)", [P6, users.founder]),
      "22023",
      "invalid_partner_payload",
      "apply_partner_stage con la riga di registro richiede operation_id",
    );
    await fails(
      q(db, "select private.apply_partner_stage($1, 'chiuso', $2)", [P6, users.founder]),
      "42883",
      null,
      "apply_partner_stage senza operation_id non esiste",
    );

    // Contatto nuovo del team e blocco per dominio.
    const team = await cmd(db, "production", "save_partner", {
      schema_version: 1,
      partner_id: null,
      name: "  Negozio del team  ",
      sections: ["collab", "vendita"],
      priority: "media",
      contact_month: "2026-12",
    });
    eq([team.co, team.version], [7, 1], "Contatto del team: CO successivo");
    eq(
      await one(
        db,
        "select name, origin, source_key, stage, sections, contact_month::text as month, preferred_channel, created_by from public.partners where id = $1",
        [team.id],
      ),
      {
        name: "Negozio del team",
        origin: "team",
        source_key: null,
        stage: "da_contattare",
        sections: ["vendita", "collab"],
        month: "2026-12-01",
        preferred_channel: "web",
        created_by: users.production,
      },
      "Contatto del team: valori normalizzati, creato da chi lo aggiunge",
    );
    const teamEmail = await cmd(db, "production", "save_partner_contact", {
      schema_version: 1,
      contact_id: null,
      partner_id: team.id,
      expected_version: null,
      kind: "email",
      value: "Ordini: ordini@garage-uno.example.test",
      label: "Ordini",
    });
    eq(
      await one(
        db,
        "select link_value, label, position, research_slot, created_by from public.partner_contacts where id = $1",
        [teamEmail.id],
      ),
      {
        link_value: "ordini@garage-uno.example.test",
        label: "Ordini",
        position: 0,
        research_slot: null,
        created_by: users.production,
      },
      "Recapito del team con link calcolato",
    );
    const domainBlock = await cmd(db, "founder", "set_partner_do_not_contact", {
      schema_version: 1,
      partner_id: ids.L001,
      active: true,
      reason: "Chiede solo contatti dal distributore",
      include_domain: true,
    });
    eq(
      (
        await one(db, "select domain from public.partner_do_not_contact where id = $1", [
          domainBlock.block_id,
        ])
      ).domain,
      "garage-uno.example.test",
      "Dominio del sito senza www.",
    );
    await fails(
      cmd(db, "logistics", "record_partner_activity", {
        schema_version: 1,
        partner_id: team.id,
        kind: "inviato",
      }),
      "55000",
      "partner_do_not_contact",
      "Bloccato per dominio dell'email",
    );
    await cmd(db, "founder", "set_partner_do_not_contact", {
      schema_version: 1,
      partner_id: ids.L001,
      active: false,
    });
    eq(
      (
        await cmd(db, "logistics", "record_partner_activity", {
          schema_version: 1,
          partner_id: team.id,
          kind: "inviato",
        })
      ).stage,
      "contattato",
      "Blocco del dominio tolto: inviato ammesso",
    );

    // Scheda.
    let tv = await version(db, "partners", team.id);
    const card = await cmd(db, "logistics", "save_partner", {
      schema_version: 1,
      partner_id: team.id,
      expected_version: tv,
      name: "Negozio del team, Milano",
      city: "Milano",
    });
    eq(
      [
        card.version,
        (
          await one(db, "select kind from public.partner_activities where id = $1", [
            card.activity_id,
          ])
        ).kind,
      ],
      [tv + 1, "scheda"],
      "Scheda modificata: riga «scheda»",
    );
    await fails(
      cmd(db, "logistics", "save_partner", {
        schema_version: 1,
        partner_id: team.id,
        expected_version: tv,
        name: "Nome vecchio",
      }),
      "40001",
      "partner_changed",
      "Scheda con versione vecchia",
    );
    tv += 1;
    await fails(
      cmd(db, "logistics", "save_partner", {
        schema_version: 1,
        partner_id: team.id,
        expected_version: tv,
        event_starts_on: "2027-05-10",
        event_ends_on: "2027-05-09",
      }),
      "22023",
      "invalid_partner_payload",
      "Fine dell'evento prima dell'inizio",
    );
    const deadline = await cmd(db, "logistics", "save_partner", {
      schema_version: 1,
      partner_id: team.id,
      expected_version: tv,
      application_deadline: "2026-11-30",
    });
    eq(deadline.version, tv + 1, "Scadenza della candidatura: versione +1");
    tv += 1;
    const unchanged = await cmd(db, "logistics", "save_partner", {
      schema_version: 1,
      partner_id: team.id,
      expected_version: tv,
      city: "Milano",
    });
    eq([unchanged.version, unchanged.activity_id], [tv, null], "Scheda invariata: nessuna riga");
    for (const [payload, label] of [
      [
        {
          schema_version: 1,
          partner_id: null,
          name: "X",
          sections: ["vendita"],
          contact_month: "2026-12",
        },
        "creazione senza priorità",
      ],
      [
        {
          schema_version: 1,
          partner_id: null,
          name: "X",
          sections: [],
          priority: "alta",
          contact_month: "2026-12",
        },
        "nessuna sezione",
      ],
      [
        {
          schema_version: 1,
          partner_id: null,
          name: "X",
          sections: ["vendita", "vendita"],
          priority: "alta",
          contact_month: "2026-12",
        },
        "sezione ripetuta",
      ],
      [
        {
          schema_version: 1,
          partner_id: null,
          name: "X",
          sections: ["vendita"],
          priority: "alta",
          contact_month: "2026-13",
        },
        "mese inesistente",
      ],
      [
        {
          schema_version: 1,
          partner_id: null,
          name: "   ",
          sections: ["vendita"],
          priority: "alta",
          contact_month: "2026-12",
        },
        "nome vuoto",
      ],
      [{ schema_version: 1, partner_id: team.id, name: "X" }, "modifica senza versione"],
      [
        {
          schema_version: 1,
          partner_id: null,
          expected_version: 1,
          name: "X",
          sections: ["vendita"],
          priority: "alta",
          contact_month: "2026-12",
        },
        "creazione con versione",
      ],
    ]) {
      await fails(
        cmd(db, "founder", "save_partner", payload),
        "22023",
        "invalid_partner_payload",
        `Scheda: ${label}`,
      );
    }

    // Recapiti.
    await fails(
      cmd(db, "finance", "save_partner_contact", {
        schema_version: 1,
        contact_id: null,
        partner_id: team.id,
        expected_version: null,
        kind: "phone",
        value: "chiamare in negozio",
      }),
      "22023",
      "partner_contact_unusable",
      "Recapito senza valore utilizzabile",
    );
    const phone = await cmd(db, "finance", "save_partner_contact", {
      schema_version: 1,
      contact_id: null,
      partner_id: team.id,
      expected_version: null,
      kind: "phone",
      value: "+39 000 000 0042",
    });
    eq(
      await one(
        db,
        "select link_value, position, version::int from public.partner_contacts where id = $1",
        [phone.id],
      ),
      { link_value: "+390000000042", position: 1, version: 1 },
      "Telefono: solo cifre e + iniziale",
    );
    await fails(
      cmd(db, "finance", "save_partner_contact", {
        schema_version: 1,
        contact_id: phone.id,
        partner_id: team.id,
        expected_version: 2,
        kind: "phone",
        value: "+39 000 000 0043",
      }),
      "40001",
      "partner_changed",
      "Recapito con versione vecchia",
    );
    const phone2 = await cmd(db, "finance", "save_partner_contact", {
      schema_version: 1,
      contact_id: phone.id,
      partner_id: team.id,
      expected_version: 1,
      kind: "phone",
      value: "+39 000 000 0043",
    });
    eq(
      [
        phone2.version,
        (await one(db, "select link_value from public.partner_contacts where id = $1", [phone.id]))
          .link_value,
      ],
      [2, "+390000000043"],
      "Recapito modificato",
    );
    await fails(
      cmd(db, "finance", "save_partner_contact", {
        schema_version: 1,
        contact_id: phone.id,
        partner_id: team.id,
        expected_version: 2,
        kind: "whatsapp",
        value: "+39 000 000 0043",
      }),
      "22023",
      "invalid_partner_payload",
      "Il tipo di un recapito non cambia",
    );
    const removed = await cmd(db, "finance", "remove_partner_contact", {
      schema_version: 1,
      contact_id: phone.id,
      expected_version: 2,
      erase: false,
    });
    eq(
      [
        removed.version,
        await one(db, "select active, value from public.partner_contacts where id = $1", [
          phone.id,
        ]),
      ],
      [3, { active: false, value: "+39 000 000 0043" }],
      "Rimosso: recuperabile",
    );
    const restored = await cmd(db, "finance", "save_partner_contact", {
      schema_version: 1,
      contact_id: phone.id,
      partner_id: team.id,
      expected_version: 3,
      kind: "phone",
      value: "+39 000 000 0043",
    });
    eq(
      [
        restored.version,
        (await one(db, "select active from public.partner_contacts where id = $1", [phone.id]))
          .active,
      ],
      [4, true],
      "Recapito recuperato",
    );
    const erased = await cmd(db, "consultant", "remove_partner_contact", {
      schema_version: 1,
      contact_id: phone.id,
      expected_version: 4,
      erase: true,
    });
    eq(
      [
        erased.erased,
        await one(
          db,
          "select value, link_value, label, active, erased_by from public.partner_contacts where id = $1",
          [phone.id],
        ),
      ],
      [
        true,
        { value: null, link_value: null, label: "", active: false, erased_by: users.consultant },
      ],
      "Cancella il dato: valore sparito",
    );
    await fails(
      cmd(db, "consultant", "save_partner_contact", {
        schema_version: 1,
        contact_id: phone.id,
        partner_id: team.id,
        expected_version: 5,
        kind: "phone",
        value: "+39 000 000 0044",
      }),
      "22023",
      "partner_contact_erased",
      "Un dato cancellato non si riscrive",
    );
    await fails(
      cmd(db, "consultant", "remove_partner_contact", {
        schema_version: 1,
        contact_id: phone.id,
        expected_version: 5,
        erase: true,
      }),
      "22023",
      "partner_contact_erased",
      "Un dato cancellato non si cancella due volte",
    );

    // Messaggi: revisioni, ripristino, variante del team.
    const variant = await one(
      db,
      `select id, version::int version, original_subject subject, original_body body, original_follow_up follow_up,
         original_confirm_email confirm_email, channel from public.partner_message_variants where partner_id = $1 and approach = 'vendita'`,
      [ids.L001],
    );
    const original = pick(variant, ["subject", "body", "follow_up", "confirm_email"]);
    const message = (expected, texts, role = "finance") =>
      cmd(db, role, "save_partner_message", {
        schema_version: 1,
        partner_id: ids.L001,
        approach: "vendita",
        expected_version: expected,
        ...texts,
      });
    const edit1 = await message(variant.version, {
      ...original,
      body: "Hallo,\n\nPrima versione del team.\n\nViele Grüße\nEttore",
    });
    eq(
      [
        edit1.version,
        await one(
          db,
          "select revision_no, kind, created_by from public.partner_message_revisions where id = $1",
          [edit1.revision_id],
        ),
        (
          await one(
            db,
            "select current_revision_id from public.partner_message_variants where id = $1",
            [variant.id],
          )
        ).current_revision_id,
      ],
      [
        variant.version + 1,
        { revision_no: 1, kind: "edit", created_by: users.finance },
        edit1.revision_id,
      ],
      "Prima revisione: in uso",
    );
    const same = await message(edit1.version, {
      ...original,
      body: "Hallo,\n\nPrima versione del team.\n\nViele Grüße\nEttore",
    });
    eq(
      [same.version, same.revision_id, same.activity_id],
      [edit1.version, null, null],
      "Stesso testo: nessuna revisione",
    );
    await fails(
      message(variant.version, { ...original, body: "Testo su versione vecchia" }),
      "40001",
      "partner_changed",
      "Messaggio con versione vecchia",
    );
    const edit2 = await message(
      edit1.version,
      { ...original, subject: "Oggetto del team" },
      "production",
    );
    eq(
      (
        await one(db, "select revision_no from public.partner_message_revisions where id = $1", [
          edit2.revision_id,
        ])
      ).revision_no,
      2,
      "Revisioni numerate",
    );
    const back = await message(edit2.version, original, "logistics");
    eq(
      [
        await one(
          db,
          "select kind, revision_no, subject, body from public.partner_message_revisions where id = $1",
          [back.revision_id],
        ),
        (
          await one(
            db,
            "select current_revision_id from public.partner_message_variants where id = $1",
            [variant.id],
          )
        ).current_revision_id,
      ],
      [{ kind: "restore", revision_no: 3, subject: null, body: null }, null],
      "Testo uguale all'originale: ripristino",
    );
    eq(
      (
        await q(
          db,
          "select kind from public.partner_activities where id = any($1::uuid[]) order by created_at",
          [[edit1.activity_id, edit2.activity_id, back.activity_id]],
        )
      ).map((a) => a.kind),
      ["messaggio", "messaggio", "ripristino"],
      "Registro: messaggio, messaggio, ripristino",
    );
    const noRestore = await cmd(db, "founder", "restore_partner_message", {
      schema_version: 1,
      variant_id: variant.id,
      expected_version: back.version,
    });
    eq(
      [noRestore.version, noRestore.revision_id],
      [back.version, null],
      "Ripristino con l'originale già in uso: nessun effetto",
    );
    const edit3 = await message(back.version, { ...original, follow_up: "Sollecito del team" });
    const restore = await cmd(db, "consultant", "restore_partner_message", {
      schema_version: 1,
      variant_id: variant.id,
      expected_version: edit3.version,
    });
    eq(
      [
        restore.version,
        await one(
          db,
          "select kind, revision_no from public.partner_message_revisions where id = $1",
          [restore.revision_id],
        ),
      ],
      [edit3.version + 1, { kind: "restore", revision_no: 5 }],
      "Ripristina l'originale: revisione «restore»",
    );
    await fails(
      cmd(db, "consultant", "restore_partner_message", {
        schema_version: 1,
        variant_id: variant.id,
        expected_version: edit3.version,
      }),
      "40001",
      "partner_changed",
      "Ripristino con versione vecchia",
    );
    const collab = await one(
      db,
      "select id from public.partner_message_variants where partner_id = $1 and approach = 'collab'",
      [ids.L001],
    );
    const collabRevision = await one(
      db,
      "select id from public.partner_message_revisions where variant_id = $1 limit 1",
      [collab.id],
    );
    ok(!collabRevision, "Variante collab senza revisioni");
    await fails(
      q(db, "update public.partner_message_variants set current_revision_id = $1 where id = $2", [
        edit1.revision_id,
        collab.id,
      ]),
      "23503",
      /partner_message_variants_current_revision/,
      "Il testo in uso appartiene alla stessa variante",
    );
    const newVariant = await cmd(db, "consultant", "save_partner_message", {
      schema_version: 1,
      partner_id: P4,
      approach: "media",
      expected_version: null,
      channel: "dm",
      language: "it",
      subject: "",
      body: "Ciao, testo sintetico per Instagram.",
      follow_up: "",
      confirm_email: "",
    });
    eq(
      await one(
        db,
        "select origin, channel, language, original_body, current_revision_id is not null as current from public.partner_message_variants where id = $1",
        [newVariant.id],
      ),
      { origin: "team", channel: "dm", language: "it", original_body: "", current: true },
      "Variante nuova del team",
    );
    for (const [payload, code, messageText, label] of [
      [
        { expected_version: null, channel: "dm", language: "it", body: "Ancora" },
        "40001",
        "partner_changed",
        "variante già creata da un collega",
      ],
      [
        { approach: "su_misura", expected_version: null, language: "it", body: "Senza canale" },
        "22023",
        "invalid_partner_payload",
        "variante nuova senza canale",
      ],
      [
        {
          approach: "su_misura",
          expected_version: null,
          channel: "dm",
          language: "it",
          body: "  ",
        },
        "22023",
        "invalid_partner_payload",
        "testi vuoti",
      ],
      [
        {
          expected_version: newVariant.version,
          channel: "dm",
          body: "Canale su variante esistente",
        },
        "22023",
        "invalid_partner_payload",
        "canale su una variante esistente",
      ],
    ]) {
      await fails(
        cmd(db, "consultant", "save_partner_message", {
          schema_version: 1,
          partner_id: P4,
          approach: "media",
          subject: "",
          follow_up: "",
          confirm_email: "",
          ...payload,
        }),
        code,
        messageText,
        `Messaggio: ${label}`,
      );
    }
    await fails(
      cmd(db, "consultant", "restore_partner_message", {
        schema_version: 1,
        variant_id: newVariant.id,
        expected_version: newVariant.version,
      }),
      "22023",
      "partner_message_no_original",
      "Una variante del team non ha un originale",
    );
    await oneActivityPerCommand(db, "Comandi");
    await auditPrivacy(db, "Comandi");
    await db.close();
  }

  // -------------------------------------------------------------------------
  // 4. File dei dispositivi
  // -------------------------------------------------------------------------
  {
    const db = await freshDb();
    const ids = await partnerIds(db);
    const phoneText = fixtureText("exports/luckylap-partner-2026-10-20-telefono.json");
    const computerText = fixtureText("exports/luckylap-partner-2026-10-21-computer.json");
    const phone = devicePayload(phoneText);
    // Lavoro del team prima dei file: uno stato su n003, un testo su L002.
    await cmd(db, "founder", "set_partner_state", {
      schema_version: 1,
      partner_id: ids.n003,
      expected_version: 1,
      stage: "trattativa",
    });
    const evento = await one(
      db,
      `select id, version::int version, original_subject subject, original_body body, original_follow_up follow_up,
         original_confirm_email confirm_email from public.partner_message_variants where partner_id = $1 and approach = 'evento'`,
      [ids.L002],
    );
    const teamTexts = {
      ...pick(evento, ["subject", "follow_up", "confirm_email"]),
      body: "Hello,\n\nTesto del team per lo stand.\n\nBest regards\nGabriele",
    };
    await cmd(db, "production", "save_partner_message", {
      schema_version: 1,
      partner_id: ids.L002,
      approach: "evento",
      expected_version: evento.version,
      ...teamTexts,
    });
    const counts = async () =>
      one(
        db,
        `select (select count(*) from public.partner_device_imports)::int imports, (select count(*) from public.partner_activities)::int activities,
           (select count(*) from public.partner_message_revisions)::int revisions, (select count(*) from public.partner_import_differences)::int differences,
           (select sum(version) from public.partners)::int versions`,
      );
    const before = await counts();
    const plan = await preview(db, "consultant", phone);
    eq(
      [plan.file, plan.plan, plan.already_imported],
      [
        { stages: 5, texts: 3, approaches: 2 },
        {
          stages_applied: 2,
          texts_applied: 1,
          approaches_applied: 2,
          differences: 2,
          ignored: 1,
          unknown: 2,
        },
        false,
      ],
      "Anteprima del file del telefono: conteggi",
    );
    eq(
      [
        plan.differences.map((d) => [d.kind, d.source_key]).sort(),
        plan.names_changed.map((n) => [n.source_key, n.co]),
        plan.unknown_keys,
      ],
      [
        [
          ["stage", "n003"],
          ["text", "L002"],
        ],
        [["L002", 2]],
        ["Z999"],
      ],
      "Anteprima: differenze, nomi diversi, codici sconosciuti",
    );
    ok(
      !JSON.stringify(plan).includes("Oggetto scritto sul telefono"),
      "Anteprima senza testi dei messaggi",
    );
    eq(await counts(), before, "Anteprima senza scritture");

    const phoneOperation = randomUUID();
    const imported = await cmd(
      db,
      "consultant",
      "import_partner_device_file",
      phone,
      phoneOperation,
    );
    eq(
      pick(imported, [
        "stages_applied",
        "texts_applied",
        "approaches_applied",
        "differences",
        "ignored",
        "unknown",
        "replayed",
      ]),
      {
        stages_applied: 2,
        texts_applied: 1,
        approaches_applied: 2,
        differences: 2,
        ignored: 1,
        unknown: 2,
        replayed: false,
      },
      "Import del telefono: resoconto uguale all'anteprima",
    );
    eq(
      await one(
        db,
        "select device, exported_at = $1::timestamptz exported, stages_applied, differences, unknown, imported_by from public.partner_device_imports where id = $2",
        [phone.exported_at, imported.id],
      ),
      {
        device: "telefono",
        exported: true,
        stages_applied: 2,
        differences: 2,
        unknown: 2,
        imported_by: users.consultant,
      },
      "Una riga in partner_device_imports con i contatori",
    );
    eq(
      await one(
        db,
        `select stage, stage_from_file_at = $2::timestamptz stage_file, chosen_approach, approach_from_file_at = $2::timestamptz approach_file
           from public.partners where id = $1`,
        [ids.L001, phone.exported_at],
      ),
      { stage: "contattato", stage_file: true, chosen_approach: "vendita", approach_file: true },
      "Stato e approccio applicati su un contatto da contattare",
    );
    eq(
      await one(
        db,
        `select r.kind, r.file_exported_at = $2::timestamptz exported, r.body, r.subject = v.original_subject same_subject
           from public.partner_message_variants v join public.partner_message_revisions r on r.id = v.current_revision_id
           where v.partner_id = $1 and v.approach = 'vendita'`,
        [ids.L001, phone.exported_at],
      ),
      { kind: "file", exported: true, body: phone.texts["L001|vendita|body"], same_subject: true },
      "Testo del file come revisione «file», i campi assenti dall'originale",
    );
    eq(
      await q(
        db,
        `select p.source_key, a.kind, a.origin, a.message_kind, a.approach, a.channel, a.stage_before, a.stage_after,
           a.occurred_at = $2::timestamptz exported, a.created_by
         from public.partner_activities a join public.partners p on p.id = a.partner_id where a.operation_id = $1 order by p.co`,
        [phoneOperation, phone.exported_at],
      ),
      [
        {
          source_key: "L001",
          kind: "inviato",
          origin: "file",
          message_kind: "primo",
          approach: "vendita",
          channel: "email",
          stage_before: "da_contattare",
          stage_after: "contattato",
          exported: true,
          created_by: users.consultant,
        },
        {
          source_key: "L002",
          kind: "risposta",
          origin: "file",
          message_kind: null,
          approach: "evento",
          channel: null,
          stage_before: "da_contattare",
          stage_after: "risposto",
          exported: true,
          created_by: users.consultant,
        },
      ],
      "Una riga per contatto toccato: «inviato» con la data di esportazione per i contattati",
    );
    eq(
      await q(
        db,
        `select p.source_key, d.field, d.origin, d.device_import_id = $1 linked, d.team_value, d.incoming_value ->> 'subject' subject
           from public.partner_import_differences d join public.partners p on p.id = d.partner_id where d.status = 'open' order by p.co`,
        [imported.id],
      ),
      [
        {
          source_key: "L002",
          field: "message",
          origin: "file",
          linked: true,
          team_value: teamTexts,
          subject: "Oggetto scritto sul telefono",
        },
        {
          source_key: "n003",
          field: "stage",
          origin: "file",
          linked: true,
          team_value: "trattativa",
          subject: null,
        },
      ],
      "Stato e testo del team mai sovrascritti: differenze",
    );
    eq(
      await one(
        db,
        "select p.stage, r.body from public.partners p, public.partner_message_variants v join public.partner_message_revisions r on r.id = v.current_revision_id where p.id = $1 and v.id = $2",
        [ids.n003, evento.id],
      ),
      { stage: "trattativa", body: teamTexts.body },
      "Nel gestionale restano i valori del team",
    );
    eq(
      await one(db, "select stage, version::int from public.partners where id = $1", [ids.n004]),
      { stage: "da_contattare", version: 1 },
      "«Da contattare» nel file: ignorato",
    );
    const afterPhone = await counts();
    eq(
      await cmd(db, "consultant", "import_partner_device_file", phone, phoneOperation),
      { ...imported, replayed: true },
      "Stessa operazione: stesso resoconto",
    );
    const again = await cmd(db, "founder", "import_partner_device_file", phone);
    eq(
      [again.replayed, again.id],
      [true, imported.id],
      "Stesso file con un'altra operazione: resoconto di allora",
    );
    eq(await counts(), afterPhone, "Stesso file due volte: nessuna scrittura");

    const computer = devicePayload(computerText);
    const computerOperation = randomUUID();
    const imported2 = await cmd(
      db,
      "founder",
      "import_partner_device_file",
      computer,
      computerOperation,
    );
    eq(
      pick(imported2, [
        "stages_applied",
        "texts_applied",
        "approaches_applied",
        "differences",
        "ignored",
        "unknown",
      ]),
      {
        stages_applied: 3,
        texts_applied: 1,
        approaches_applied: 1,
        differences: 0,
        ignored: 0,
        unknown: 0,
      },
      "File più recente: vince su quello del telefono",
    );
    eq(
      await q(
        db,
        "select source_key, stage, chosen_approach from public.partners where source_key in ('L001', 'L002', 'L006') order by co",
      ),
      [
        { source_key: "L001", stage: "trattativa", chosen_approach: "collab" },
        { source_key: "L002", stage: "trattativa", chosen_approach: "evento" },
        { source_key: "L006", stage: "no", chosen_approach: null },
      ],
      "Stati e approccio del file più recente",
    );
    eq(
      await one(
        db,
        "select r.body, r.revision_no from public.partner_message_variants v join public.partner_message_revisions r on r.id = v.current_revision_id where v.partner_id = $1 and v.approach = 'vendita'",
        [ids.L001],
      ),
      { body: computer.texts["L001|vendita|body"], revision_no: 2 },
      "Testo del file più recente su quello del file precedente",
    );
    eq(
      (
        await q(
          db,
          "select p.source_key, a.kind from public.partner_activities a join public.partners p on p.id = a.partner_id where a.operation_id = $1 order by p.co",
          [computerOperation],
        )
      ).map((a) => [a.source_key, a.kind]),
      [
        ["L001", "risposta"],
        ["L002", "risposta"],
        ["L006", "stato"],
      ],
      "Tipo di riga secondo lo stato applicato",
    );
    const older = JSON.stringify({ stage: "older" });
    const olderPayload = {
      schema_version: 1,
      file_sha256: sha(older),
      device: "telefono",
      exported_at: "2026-10-19T10:00:00.000Z",
      stages: { L001: "chiuso", L006: "chiuso" },
      texts: { "L001|vendita|body": "Testo vecchio" },
      approaches: { L001: "vendita" },
      names: {},
    };
    const olderOperation = randomUUID();
    eq(
      pick(await cmd(db, "logistics", "import_partner_device_file", olderPayload, olderOperation), [
        "stages_applied",
        "texts_applied",
        "approaches_applied",
        "differences",
        "ignored",
      ]),
      { stages_applied: 0, texts_applied: 0, approaches_applied: 0, differences: 0, ignored: 4 },
      "File più vecchio: superato, ignorato",
    );
    eq(
      await count(db, "public.partner_activities", "operation_id = $1", [olderOperation]),
      0,
      "File più vecchio: nessuna riga di registro",
    );
    await cmd(db, "finance", "set_partner_state", {
      schema_version: 1,
      partner_id: ids.n004,
      expected_version: 1,
      chosen_approach: "evento",
    });
    await cmd(db, "finance", "set_partner_state", {
      schema_version: 1,
      partner_id: ids.L006,
      expected_version: await version(db, "partners", ids.L006),
      stage: "risposto",
    });
    const late = JSON.stringify({ stage: "late" });
    const latePayload = {
      schema_version: 1,
      file_sha256: sha(late),
      device: "computer",
      exported_at: "2026-10-21T20:00:00.000Z",
      stages: { L006: "chiuso" },
      texts: {},
      approaches: { n004: "collab" },
      names: {},
    };
    eq(
      pick(await cmd(db, "logistics", "import_partner_device_file", latePayload), [
        "stages_applied",
        "approaches_applied",
        "differences",
        "ignored",
      ]),
      { stages_applied: 0, approaches_applied: 0, differences: 1, ignored: 1 },
      "Stato e approccio scelti dal team: mai sovrascritti",
    );
    eq(
      await q(
        db,
        "select source_key, stage, chosen_approach from public.partners where source_key in ('n004', 'L006') order by co",
      ),
      [
        { source_key: "n004", stage: "da_contattare", chosen_approach: "evento" },
        { source_key: "L006", stage: "risposto", chosen_approach: null },
      ],
      "Valori del team dopo il file",
    );
    eq(await count(db, "public.partner_device_imports"), 4, "Una riga per file importato");

    const stageDiff = await one(
      db,
      "select id from public.partner_import_differences where partner_id = $1 and field = 'stage' and status = 'open'",
      [ids.n003],
    );
    const resolveOperation = randomUUID();
    await cmd(
      db,
      "founder",
      "resolve_partner_difference",
      {
        schema_version: 1,
        difference_id: stageDiff.id,
        choice: "used_incoming",
        expected_version: await version(db, "partners", ids.n003),
      },
      resolveOperation,
    );
    eq(
      [
        await one(db, "select stage, stage_from_file_at from public.partners where id = $1", [
          ids.n003,
        ]),
        pick(
          (
            await q(
              db,
              "select kind, stage_before, stage_after from public.partner_activities where operation_id = $1",
              [resolveOperation],
            )
          )[0],
          ["kind", "stage_before", "stage_after"],
        ),
      ],
      [
        { stage: "contattato", stage_from_file_at: null },
        { kind: "differenza", stage_before: "trattativa", stage_after: "contattato" },
      ],
      "Usa il nuovo (stato): stato del file, una riga «differenza»",
    );
    const messageDiff = await one(
      db,
      "select id from public.partner_import_differences where variant_id = $1 and status = 'open'",
      [evento.id],
    );
    await cmd(db, "production", "resolve_partner_difference", {
      schema_version: 1,
      difference_id: messageDiff.id,
      choice: "kept_team",
      expected_version: await version(db, "partner_message_variants", evento.id),
    });
    eq(
      await one(
        db,
        "select r.body, d.status from public.partner_message_variants v join public.partner_message_revisions r on r.id = v.current_revision_id, public.partner_import_differences d where v.id = $1 and d.id = $2",
        [evento.id, messageDiff.id],
      ),
      { body: teamTexts.body, status: "kept_team" },
      "Tieni il nostro (testo): resta il testo del team",
    );

    for (const [payloadText, label] of [
      [JSON.stringify({ ...phone, file_sha256: "abc" }), "SHA-256 non valido"],
      [JSON.stringify({ ...phone, device: "tablet" }), "dispositivo sconosciuto"],
      [JSON.stringify({ ...phone, exported_at: "ieri" }), "data di esportazione non valida"],
      [JSON.stringify({ ...phone, vista: null }), "chiave «vista» nel payload normalizzato"],
      [
        JSON.stringify(phone).replace('"stages":{', '"stages":{"__proto__":"contattato",'),
        "chiave __proto__",
      ],
      [JSON.stringify({ ...phone, stages: { L001: "boh" } }), "stato sconosciuto"],
      [JSON.stringify({ ...phone, approaches: { L001: "negozio" } }), "approccio sconosciuto"],
      [
        JSON.stringify({ ...phone, texts: { "L001|vendita|titolo": "x" } }),
        "campo di testo sconosciuto",
      ],
      [
        JSON.stringify({ ...phone, texts: { "L001|vendita|subject": "x".repeat(301) } }),
        "testo troppo lungo",
      ],
      [JSON.stringify({ ...phone, texts: { "L001|vendita|body": 12 } }), "testo non stringa"],
      [
        JSON.stringify({
          ...phone,
          names: Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`K${i}`, "Nome"])),
        }),
        "più di 2000 voci",
      ],
    ]) {
      await fails(
        cmdText(db, "founder", "import_partner_device_file", payloadText),
        "22023",
        "invalid_partner_payload",
        `File: ${label}`,
      );
    }
    await oneActivityPerCommand(db, "File");
    await auditPrivacy(db, "File");
    await db.close();
  }

  // -------------------------------------------------------------------------
  // 5. Generatore offline (supabase/generate-partner-import.mjs)
  // -------------------------------------------------------------------------
  {
    const data = repository();
    const build = (overrides = {}, commit = "f6ad90c") =>
      buildPartnerImport({
        partners: data.partners,
        variants: data.varianti,
        context: data.context,
        commit,
        ...overrides,
      });
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const built = build();
    const again = build();
    eq(
      [again.normalized, again.batches.map((b) => b.sql), again.applySql],
      [built.normalized, built.batches.map((b) => b.sql), built.applySql],
      "Generatore: SHA-256 e file stabili a parità di dati",
    );
    ok(
      build({}, "b2c3d4e").normalized !== built.normalized,
      "Generatore: un altro commit è un altro import",
    );
    for (const batchBytes of [40000, 6000, 4000]) {
      const sized = build({ batchBytes });
      const texts = sized.batches.map((b) => JSON.parse(b.text));
      ok(
        sized.normalized === built.normalized &&
          sized.batches.every(
            (b) => Buffer.byteLength(b.sql, "utf8") <= batchBytes && b.sha === sha(b.text),
          ) &&
          texts.every((t, i) => t.batch_index === i + 1 && t.batch_count === texts.length) &&
          same(
            texts.flatMap((t) => t.partners),
            built.entries,
          ) &&
          texts.map((t) => t.context_md ?? "").join("") === data.context,
        `Generatore: .sql entro ${batchBytes} byte (${sized.batches.length} lotti), stessi contatti e CONTESTO.md`,
      );
    }
    const [first] = built.batches;
    const tag = /\$(partner_[0-9a-fx]+)\$/.exec(first.sql)?.[1];
    ok(
      tag &&
        first.sql.startsWith("-- Import Partner") &&
        first.sql.includes(
          `select private.stage_partner_research($${tag}$${first.text}$${tag}$, '${first.sha}');`,
        ) &&
        !first.text.includes(`$${tag}$`),
      "Generatore: il .sql contiene il lotto esatto e il suo SHA-256, tra quotature dollaro assenti dal testo",
    );
    eq(
      built.applySql.trim().split("\n").at(-1),
      `select private.apply_partner_research('${built.normalized}', array[${built.batches.map((b) => `'${b.sha}'`).join(", ")}]::text[]);`,
      "Generatore: il file apply elenca lo SHA-256 di ogni lotto",
    );
    eq(
      built.entries.map((e) => [e.source_key, e.contact_month]),
      [
        ["L001", "2026-10-01"],
        ["L002", "2026-11-01"],
        ["n003", "2026-12-01"],
        ["n004", "2027-02-01"],
        ["n005", "2027-04-01"],
        ["L006", "2027-07-01"],
      ],
      "Generatore: ordine per periodo e CO del sito; mese vuoto dal periodo",
    );
    const leadsWith = (id, patch) => ({
      ...data.partners,
      leads: data.partners.leads.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });
    eq(
      WINDOWS.map(
        (window) =>
          build({ partners: leadsWith("L001", { month: "", window, co: 99 }) }).entries.find(
            (e) => e.source_key === "L001",
          ).contact_month,
      ),
      ["2026-11-01", "2026-12-01", "2027-02-01", "2027-04-01", "2027-07-01"],
      "Generatore: senza mese, +1, +2, +4, +6, +9 mesi dalla data della ricerca",
    );
    eq(
      ["L001", "n003"].map((key) =>
        built.entries.find((e) => e.source_key === key).contacts.map((c) => [c.slot, c.verified]),
      ),
      [
        [
          ["email", true],
          ["phone", false],
          ["instagram", false],
          ["web", false],
        ],
        [
          ["phone", false],
          ["whatsapp", false],
          ["instagram", false],
          ["web", false],
        ],
      ],
      "Generatore: recapiti per slot (ig → instagram), email verificata da email_ok, vuoti esclusi",
    );
    const l001 = built.entries[0];
    ok(
      !JSON.stringify(built.entries).includes('"draft"') &&
        l001.research.skipped_it === "Media scartato: il negozio non ha una rivista." &&
        Object.keys(l001.research).every((k) => [...RESEARCH_KEYS, "skipped_it"].includes(k)) &&
        l001.variants.map((v) => v.approach).join() === "vendita,collab",
      "Generatore: draft non importato, skipped_it da varianti.json, solo i testi della ricerca",
    );

    const errors = [];
    const rejectsBuild = (overrides, pattern, label) => {
      let error = null;
      try {
        build(overrides);
      } catch (caught) {
        error = caught;
      }
      ok(error && pattern.test(error.message), `Generatore: ${label} (${error?.message})`);
      if (error) errors.push(error.message);
    };
    // Variante cambiata in entrambi i file (resta coerente) oppure in uno solo.
    const withVariant = (id, approach, patch, both = true) => {
      const partners = structuredClone(data.partners);
      const varianti = structuredClone(data.varianti);
      Object.assign(
        partners.leads.find((l) => l.id === id).variants.find((v) => v.approach === approach),
        patch,
      );
      if (both)
        Object.assign(
          varianti.contacts.find((c) => c.id === id).variants.find((v) => v.approach === approach),
          patch,
        );
      return { partners, variants: varianti };
    };
    const rebuild =
      /diverse da research\/bozze\/varianti\.json: rilanciare python3 tools\/build_data\.py/;
    rejectsBuild(
      withVariant("L001", "vendita", { body: "Hallo, anders." }, false),
      rebuild,
      "varianti diverse tra i due file → errore",
    );
    rejectsBuild(
      { partners: leadsWith("L002", { variants: undefined }) },
      rebuild,
      "varianti tolte da partners.json ma non da varianti.json → errore",
    );
    rejectsBuild(
      { partners: leadsWith("n004", { draft: { id: "n004", body: "Hello" } }) },
      /n004: ha un draft ma nessuna variante/,
      "draft senza varianti → errore",
    );
    rejectsBuild(
      { partners: leadsWith("L001", { priority: "altissima" }) },
      /L001: priorità non valido/,
      "priorità fuori elenco",
    );
    rejectsBuild(
      { partners: leadsWith("L001", { sections: ["vendita", "vendita"] }) },
      /L001: sezioni non valide/,
      "sezioni ripetute",
    );
    rejectsBuild(
      { partners: leadsWith("L001", { channel: "fax" }) },
      /L001: canale preferito non valido/,
      "canale preferito fuori elenco",
    );
    rejectsBuild(
      withVariant("L001", "collab", { language: "jp" }),
      /L001, variante collab: lingua non valido/,
      "lingua della variante fuori elenco",
    );
    rejectsBuild(
      withVariant("L002", "evento", { lookbook: "catalogo" }),
      /L002, variante evento: lookbook non valido/,
      "lookbook fuori elenco",
    );
    rejectsBuild(
      withVariant("L001", "vendita", { body: "x".repeat(8001) }),
      /campo body oltre i limiti/,
      "testo oltre 8000 caratteri",
    );
    rejectsBuild(
      { partners: leadsWith("L002", { sources: ["ftp://raduno-due.example.test/"] }) },
      /L002: le fonti devono essere indirizzi http\(s\)/,
      "fonte non http(s)",
    );
    rejectsBuild(
      { partners: leadsWith("L002", { date_start: "2027-02-30" }) },
      /L002: date_start non è una data reale/,
      "data non reale",
    );
    rejectsBuild(
      { partners: leadsWith("L001", { month: "2026-13" }) },
      /L001: mese di contatto non valido/,
      "mese non valido",
    );
    rejectsBuild(
      { partners: leadsWith("L001", { why: "Riga\u0007campanello" }) },
      /L001: caratteri di controllo/,
      "caratteri di controllo",
    );
    rejectsBuild(
      { partners: leadsWith("L001", { name: "N".repeat(241) }) },
      /L001: campo name oltre i limiti/,
      "nome oltre 240 caratteri",
    );
    rejectsBuild(
      {
        partners: {
          ...data.partners,
          leads: [...data.partners.leads, { ...data.partners.leads[0], co: 9 }],
        },
      },
      /Contatto L001 ripetuto/,
      "codice ripetuto",
    );
    rejectsBuild(
      { partners: { ...data.partners, leads: [] } },
      /nessun contatto/,
      "nessun contatto",
    );
    rejectsBuild(
      { batchBytes: 2500 },
      /da solo supera --batch-bytes/,
      "contatto più grande del lotto",
    );
    rejectsBuild(
      { batchBytes: 100 },
      /--batch-bytes deve essere un intero/,
      "lotto troppo piccolo",
    );
    rejectsBuild(
      { commit: "xyz" },
      /Commit del repository Partner non valido/,
      "commit non valido",
    );
    eq(
      errors.filter((message) => /@|example\.test|\+39|000 000|Hallo|Hello|Garage/.test(message)),
      [],
      "Generatore: gli errori citano codici e campi, mai recapiti, nomi o testi",
    );
    eq(
      ["@", "example.test", "+39", "000 000", "Hallo", "Garage"].filter((needle) =>
        JSON.stringify(built.report).includes(needle),
      ),
      [],
      "Generatore: il resoconto ha solo conteggi e codici",
    );
    eq(
      pick(built.report, [
        "partners_total",
        "variants_total",
        "by_section",
        "contacts_without_link_value",
        "drafts_not_imported",
      ]),
      {
        partners_total: 6,
        variants_total: 8,
        by_section: { vendita: 3, eventi: 3, collab: 4, club: 0 },
        contacts_without_link_value: [
          { source_key: "L006", slot: "phone" },
          { source_key: "L006", slot: "web" },
        ],
        drafts_not_imported: 1,
      },
      "Generatore: conteggi del resoconto",
    );

    // CONTESTO.md più grande di un lotto: diviso tra i primi lotti, riunito dal database.
    {
      const longContext = `${data.context}\n`.repeat(25);
      const split = build({ context: longContext, batchBytes: 6000 });
      ok(
        split.batches.filter((b) => JSON.parse(b.text).context_md !== undefined).length >= 3,
        "Generatore: CONTESTO.md lungo diviso in più lotti",
      );
      const db = await freshDb({ withImport: false });
      for (const batch of split.batches) await db.exec(batch.sql);
      await db.exec(split.applySql);
      eq(
        await one(
          db,
          "select context_md = $1 as same, batch_count from public.partner_research_imports",
          [longContext],
        ),
        { same: true, batch_count: split.batches.length },
        "Generatore: il database riunisce CONTESTO.md nell'ordine dei lotti",
      );
      await db.close();
    }

    // Riga di comando su un repository git usa e getta con i file del fixture.
    const GENERATOR = fileURLToPath(new URL("../generate-partner-import.mjs", import.meta.url));
    const temp = mkdtempSync(join(tmpdir(), "luckylap-partner-generatore-"));
    try {
      const repo = join(temp, "luckylap-partner");
      cpSync(fileURLToPath(fixtureRoot), repo, { recursive: true });
      const gitEnv = {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Harness Partner",
        GIT_AUTHOR_EMAIL: "harness@example.test",
        GIT_COMMITTER_NAME: "Harness Partner",
        GIT_COMMITTER_EMAIL: "harness@example.test",
      };
      const gitIn = (cwd, ...args) =>
        execFileSync("git", ["-C", cwd, ...args], {
          env: gitEnv,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      gitIn(temp, "init", "-q", repo);
      gitIn(repo, "add", "-A");
      gitIn(repo, "commit", "-q", "-m", "Repository Partner sintetico");
      const commit = gitIn(repo, "rev-parse", "HEAD").trim();
      const outputs = [];
      const run = (...args) => {
        const result = spawnSync(process.execPath, [GENERATOR, ...args], { encoding: "utf8" });
        outputs.push(result.stdout, result.stderr);
        return result;
      };

      const out = join(temp, "uscita", "partner-import");
      const result = run("--partner-repo", repo, "--output-dir", out, "--batch-bytes", "6000");
      ok(
        result.status === 0 && /6 contatti, 8 varianti, \d+ lotti/.test(result.stdout),
        `CLI: generazione riuscita (${result.stderr.trim()})`,
      );
      const expected = build({ batchBytes: 6000 }, commit);
      const prefix = `2026-10-21-${expected.normalized.slice(0, 8)}`;
      const batchFile = (index) => `${prefix}-${String(index).padStart(2, "0")}.sql`;
      const names = readdirSync(out).sort();
      eq(
        names,
        [
          ...expected.batches.map((b) => batchFile(b.index)),
          `${prefix}-apply.sql`,
          `${prefix}.report.json`,
        ].sort(),
        "CLI: un .sql per lotto, il file apply e il resoconto",
      );
      eq(
        [statSync(out).mode & 0o777, ...names.map((n) => statSync(join(out, n)).mode & 0o777)],
        [0o700, ...names.map(() => 0o600)],
        "CLI: cartella 0700, file 0600",
      );
      eq(
        [
          ...expected.batches.map((b) => readFileSync(join(out, batchFile(b.index)), "utf8")),
          readFileSync(join(out, `${prefix}-apply.sql`), "utf8"),
        ],
        [...expected.batches.map((b) => b.sql), expected.applySql],
        "CLI: file uguali alla funzione pura con il commit del repository",
      );
      const report = JSON.parse(readFileSync(join(out, `${prefix}.report.json`), "utf8"));
      eq(
        [report.source_commit, report.batch_count, report.files.apply, report.files.batches],
        [
          commit,
          expected.batches.length,
          `${prefix}-apply.sql`,
          expected.batches.map((b) => batchFile(b.index)),
        ],
        "CLI: resoconto con commit, numero di lotti e nomi dei file",
      );
      const db = await freshDb({ withImport: false });
      for (const name of report.files.batches) await db.exec(readFileSync(join(out, name), "utf8"));
      await db.exec(readFileSync(join(out, report.files.apply), "utf8"));
      eq(
        await one(
          db,
          `select (select count(*)::int from public.partners) partners,
             (select count(*)::int from public.partner_message_variants) variants,
             (select source_commit from public.partner_research_imports) source_commit,
             (select count(*)::int from private.partner_import_staging) staging`,
        ),
        { partners: 6, variants: 8, source_commit: commit, staging: 0 },
        "CLI: i .sql applicati in ordine, poi apply: import completo, transito vuoto",
      );
      const byKey = (a, b) => (a.join("|") < b.join("|") ? -1 : 1);
      eq(
        (
          await q(
            db,
            "select p.source_key, c.kind, c.link_value from public.partner_contacts c join public.partners p on p.id = c.partner_id",
          )
        )
          .map((r) => [r.source_key, r.kind, r.link_value])
          .sort(byKey),
        expected.entries
          .flatMap((e) => e.contacts.map((c) => [e.source_key, c.slot, linkValue(c.slot, c.value)]))
          .sort(byKey),
        "CLI: il resoconto calcola link_value come private.partner_link_value",
      );
      await db.close();

      const before = names.map((n) => readFileSync(join(out, n), "utf8"));
      const repeat = run("--partner-repo", repo, "--output-dir", out, "--batch-bytes", "6000");
      ok(
        repeat.status === 1 &&
          /già un import con gli stessi dati/.test(repeat.stderr) &&
          readdirSync(out).length === names.length &&
          names.every((n, i) => readFileSync(join(out, n), "utf8") === before[i]),
        "CLI: secondo run nella stessa cartella rifiutato, nessun file sovrascritto",
      );
      const sub = run("--partner-repo", join(repo, "site"), "--output-dir", join(temp, "sotto"));
      ok(
        sub.status === 1 &&
          /radice di un repository git/.test(sub.stderr) &&
          !existsSync(join(temp, "sotto")),
        "CLI: --partner-repo deve essere la radice del repository",
      );
      const inside = join(repo, "uscita");
      const notIgnored = run("--partner-repo", repo, "--output-dir", inside);
      ok(
        notIgnored.status === 1 &&
          /non è ignorata/.test(notIgnored.stderr) &&
          !existsSync(inside) &&
          gitIn(repo, "status", "--porcelain") === "",
        "CLI: cartella dentro un repository e non ignorata: rifiutata e rimossa",
      );
      const open = join(temp, "aperta");
      mkdirSync(open);
      chmodSync(open, 0o755);
      const openRun = run("--partner-repo", repo, "--output-dir", open);
      ok(
        openRun.status === 1 && /privata/.test(openRun.stderr) && readdirSync(open).length === 0,
        "CLI: cartella di output non privata rifiutata",
      );
      const usage = run("--partner-repo", repo);
      const badSize = run(
        "--partner-repo",
        repo,
        "--output-dir",
        join(temp, "x"),
        "--batch-bytes",
        "40kb",
      );
      ok(
        usage.status === 1 &&
          /^Uso: /.test(usage.stderr) &&
          badSize.status === 1 &&
          /--batch-bytes deve essere un intero/.test(badSize.stderr),
        "CLI: argomenti mancanti o non validi",
      );
      writeFileSync(join(repo, "appunti.txt"), "bozza\n");
      const dirtyOut = join(temp, "sporco");
      const dirty = run("--partner-repo", repo, "--output-dir", dirtyOut);
      ok(
        dirty.status === 1 &&
          /modifiche non committate/.test(dirty.stderr) &&
          !existsSync(dirtyOut),
        "CLI: repository Partner con modifiche rifiutato, nessuna cartella creata",
      );
      rmSync(join(repo, "appunti.txt"));
      // Come nel gestionale: .private/ ignorata dentro un repository va bene.
      writeFileSync(join(repo, ".gitignore"), "/.private/\n");
      gitIn(repo, "add", ".gitignore");
      gitIn(repo, "commit", "-q", "-m", "Ignora .private");
      const ignored = run(
        "--partner-repo",
        repo,
        "--output-dir",
        join(repo, ".private", "partner-import"),
      );
      ok(
        ignored.status === 0 &&
          readdirSync(join(repo, ".private", "partner-import")).length > 2 &&
          gitIn(repo, "status", "--porcelain") === "",
        `CLI: cartella ignorata dentro un repository ammessa (${ignored.stderr.trim()})`,
      );
      eq(
        outputs.filter((text) =>
          /@|example\.test|\+39|000 000|Hallo|Hello|Garage|Sintetico/.test(text),
        ),
        [],
        "CLI: stdout e stderr senza email, telefoni, nomi o testi",
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }

  console.log(
    `PASS ${checks} checks — Partner: schema, RLS e grant, audit senza recapiti, import della ricerca, comandi del team, file dei dispositivi, generatore offline; PGlite con dati sintetici, nessun accesso cloud.`,
  );
} catch (error) {
  console.log(`FAIL ${checks} checks — ${error.message}`);
  throw error;
}
