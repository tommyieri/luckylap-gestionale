// test-db: pglite minimo 51
// Archivio dei contenuti in «Grafica e foto» (06 R15) su PGlite: Auth simulato, metadata Storage
// simulati, solo dati sintetici, nessun cloud. Gruppi: migrazione sui dati esistenti, archivia e
// ripristina, ricevute e replay, accessi e payload, scritture dirette, audit.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (!process.argv[2]?.startsWith("/"))
  throw new Error("Passare il percorso assoluto di @electric-sql/pglite/dist/index.js.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const eq = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};
const rejects = async (promise, pattern, message) => {
  await assert.rejects(promise, pattern, message);
  checks += 1;
};

const id = (n) => `94000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const roles = [
  "founder",
  "production",
  "finance",
  "logistics",
  "consultant",
  "outsider",
  "inactive",
];
const ids = Object.fromEntries(roles.map((role, index) => [role, id(index + 1)]));
const activeRoles = roles.slice(0, 5);
const linkAsset = id(100),
  fileAsset = id(101),
  systemAsset = id(102),
  missingAsset = id(199);
const op = (n) => `95000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const directory = new URL("../migrations/", import.meta.url);
const files = readdirSync(directory).sort();
function migration(suffix) {
  const found = files.filter((name) => name.endsWith(`_${suffix}.sql`));
  assert.equal(found.length, 1, `Una sola migrazione ${suffix}`);
  return readFileSync(new URL(found[0], directory), "utf8");
}

async function as(role, sql, params = []) {
  await db.exec("begin");
  try {
    if (role !== "anon")
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: ids[role], aal: "aal1" }),
      ]);
    await db.exec(`set local role ${role === "anon" ? "anon" : "authenticated"}`);
    const result = await db.query(sql, params);
    await db.exec("commit");
    return result.rows;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const register = "select public.register_brand_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) id";
const archive = (role, operation, payload) =>
  as(role, "select public.set_brand_asset_archived($1, $2::jsonb) r", [
    operation,
    JSON.stringify(payload),
  ]).then((rows) => rows[0].r);
const payload = (assetId, archived) => ({ schema_version: 1, asset_id: assetId, archived });
const row = async (assetId) =>
  (
    await db.query(
      "select archived_at, archived_by, storage_path, name, description, created_by from public.assets where id = $1",
      [assetId],
    )
  ).rows[0];
// Impronta delle colonne di prima della migrazione: non cambiano mai.
const fingerprint = async () =>
  (
    await db.query(
      `select md5(string_agg(concat_ws('|', id, name, asset_type, description, external_url, storage_path,
         created_by, created_at, original_file_name, content_type, file_size_bytes, sha256, source), ',' order by id)) h
       from public.assets`,
    )
  ).rows[0].h;
// Due comandi di seguito possono avere lo stesso occurred_at (now() della transazione) e l'id
// è casuale: a parità di istante l'archivio viene prima del ripristino, il resto non conta
// sull'ordine (vedi il controllo per ruolo più sotto).
const auditRows = async (assetId) =>
  (
    await db.query(
      `select actor_id, operation, old_data->>'archived_at' old_at, new_data->>'archived_at' new_at,
         new_data->>'archived_by' new_by from public.audit_logs
       where table_name = 'assets' and record_key->>'id' = $1 and operation = 'UPDATE'
       order by occurred_at, old_data->>'archived_at' is not null, id`,
      [assetId],
    )
  ).rows;

try {
  // --- Migrazione sopra i dati esistenti -------------------------------------------------------
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create schema storage; create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb, unique(bucket_id, name));
    alter table storage.objects enable row level security; grant usage on schema storage to anon, authenticated;
    grant select, insert on storage.objects to authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  await db.exec(migration("initial_schema"));
  await db.exec(migration("brand_assets_and_development"));
  for (const role of roles) {
    await db.query("insert into auth.users values ($1)", [ids[role]]);
    if (role === "outsider") continue;
    await db.query("insert into public.profiles(user_id, display_name) values ($1, $2)", [
      ids[role],
      `Sintetico ${role}`,
    ]);
    await db.query(
      "insert into public.memberships(user_id, role, active, finance_access) values ($1, $2, $3, false)",
      [ids[role], role === "inactive" ? "consultant" : role, role !== "inactive"],
    );
  }
  // Tre contenuti di oggi: un link, un file del team e un import amministrativo.
  await as("consultant", register, [
    linkAsset,
    "Link sintetico",
    "photo",
    "Contenuto sintetico",
    "https://example.test/sintetico",
    null,
    null,
    null,
    null,
    null,
  ]);
  const filePath = `${ids.logistics}/${fileAsset}/foto.png`;
  await as(
    "logistics",
    "insert into storage.objects(bucket_id, name, metadata) values ('brand-assets', $1, $2)",
    [filePath, { mimetype: "image/png", size: 8 }],
  );
  await as("logistics", register, [
    fileAsset,
    "Foto sintetica",
    "photo",
    "",
    null,
    filePath,
    "Foto.png",
    "image/png",
    8,
    "a".repeat(64),
  ]);
  await db.query(
    `insert into public.assets(id, name, asset_type, description, storage_path, created_by, original_file_name,
       content_type, file_size_bytes, sha256, source)
     values ($1, 'Logo sintetico', 'logo', '', $2, null, 'logo.png', 'image/png', 8, $3, '{"kind":"drive_admin_import"}')`,
    [systemAsset, `system/${systemAsset}/logo.png`, "b".repeat(64)],
  );
  const before = await fingerprint();
  await db.exec(migration("archivio_contenuti"));
  ok(true, "archivio_contenuti si applica sopra le migrazioni dei contenuti");
  eq(
    (
      await db.query(
        "select count(*)::int n from public.assets where archived_at is null and archived_by is null",
      )
    ).rows[0].n,
    3,
    "Le righe di oggi restano con archived_at e archived_by nulli",
  );
  eq(await fingerprint(), before, "La migrazione non tocca le altre colonne");
  eq(
    (
      await db.query(
        "select count(*)::int n from public.audit_logs where table_name = 'assets' and operation = 'UPDATE'",
      )
    ).rows[0].n,
    0,
    "La migrazione non scrive righe di audit",
  );
  eq(
    (
      await db.query(
        `select has_function_privilege('anon', 'public.set_brand_asset_archived(uuid, jsonb)', 'execute') anon,
           has_function_privilege('authenticated', 'public.set_brand_asset_archived(uuid, jsonb)', 'execute') member,
           has_function_privilege('anon', 'private.set_brand_asset_archived(uuid, jsonb)', 'execute') anon_private`,
      )
    ).rows[0],
    { anon: false, member: true, anon_private: false },
    "Solo authenticated esegue il comando",
  );

  // --- Archivia e ripristina -------------------------------------------------------------------
  const archived = await archive("logistics", op(1), payload(fileAsset, true));
  eq(
    [archived.asset_id, archived.archived, archived.changed, archived.replayed],
    [fileAsset, true, true, false],
    "Un membro archivia un contenuto",
  );
  ok(Number.isFinite(Date.parse(archived.archived_at)), "La risposta porta la data dell'archivio");
  let current = await row(fileAsset);
  eq(current.archived_by, ids.logistics, "archived_by è il membro che archivia");
  eq(
    new Date(current.archived_at).toISOString(),
    new Date(archived.archived_at).toISOString(),
    "archived_at coincide con la risposta",
  );
  eq(current.storage_path, filePath, "storage_path non cambia");
  eq(
    (
      await as("consultant", "select archived_at is not null a from public.assets where id = $1", [
        fileAsset,
      ])
    )[0].a,
    true,
    "Ogni membro legge lo stato dell'archivio",
  );
  const again = await archive("founder", op(2), payload(fileAsset, true));
  eq(
    [again.archived, again.changed, again.archived_at],
    [true, false, archived.archived_at],
    "Una doppia archiviazione restituisce la stessa data e non cambia niente",
  );
  eq((await row(fileAsset)).archived_by, ids.logistics, "Chi aveva archiviato resta lo stesso");
  const restored = await archive("consultant", op(3), payload(fileAsset, false));
  eq(
    [restored.archived, restored.archived_at, restored.changed],
    [false, null, true],
    "Il ripristino riporta il contenuto in libreria",
  );
  current = await row(fileAsset);
  eq(
    [current.archived_at, current.archived_by],
    [null, null],
    "Il ripristino azzera le due colonne",
  );
  eq(current.storage_path, filePath, "storage_path non cambia dopo il ripristino");
  const idle = await archive("consultant", op(4), payload(fileAsset, false));
  eq(
    [idle.archived, idle.changed],
    [false, false],
    "Ripristinare un contenuto attivo non cambia niente",
  );
  for (const [index, role] of activeRoles.entries()) {
    const done = await archive(role, op(10 + index), payload(linkAsset, true));
    const back = await archive(role, op(20 + index), payload(linkAsset, false));
    eq([done.archived, back.archived], [true, false], `${role} archivia e ripristina`);
  }
  const system = await archive("production", op(30), payload(systemAsset, true));
  eq(system.archived, true, "Anche un import amministrativo si archivia");
  eq((await row(systemAsset)).created_by, null, "L'autore dell'import resta nullo");

  // --- Ricevute e replay -----------------------------------------------------------------------
  const replay = await archive("logistics", op(1), payload(fileAsset, true));
  eq(
    { ...replay, replayed: undefined },
    { ...archived, replayed: undefined },
    "Lo stesso invio restituisce l'esito di allora",
  );
  eq(replay.replayed, true, "Il replay lo dice");
  ok(
    (await row(fileAsset)).archived_at === null,
    "Il replay non riarchivia un contenuto ripristinato",
  );
  await rejects(
    archive("logistics", op(1), payload(fileAsset, false)),
    /asset_idempotency_conflict/,
    "Stessa operazione con un altro payload: rifiutata",
  );
  await rejects(
    archive("founder", op(1), payload(fileAsset, true)),
    /asset_idempotency_conflict/,
    "Stessa operazione da un altro membro: rifiutata",
  );
  eq(
    (
      await db.query(
        "select command_kind, actor_id from private.asset_command_receipts where operation_id = $1",
        [op(1)],
      )
    ).rows[0],
    { command_kind: "set_brand_asset_archived", actor_id: ids.logistics },
    "La ricevuta conserva comando e autore",
  );
  await rejects(
    db.query("update private.asset_command_receipts set result = '{}' where operation_id = $1", [
      op(1),
    ]),
    /append-only/,
    "Le ricevute non si modificano",
  );

  // --- Accessi e payload -----------------------------------------------------------------------
  await rejects(
    archive("outsider", op(40), payload(fileAsset, true)),
    /asset_access_required/,
    "Senza membership: rifiutato",
  );
  await rejects(
    archive("inactive", op(41), payload(fileAsset, true)),
    /asset_access_required/,
    "Membership non attiva: rifiutato",
  );
  await rejects(
    archive("anon", op(42), payload(fileAsset, true)),
    /permission denied/,
    "Senza sessione: rifiutato",
  );
  await rejects(
    archive("founder", op(43), payload(missingAsset, true)),
    /asset_not_found/,
    "Un contenuto inesistente: rifiutato",
  );
  for (const [index, invalid] of [
    { asset_id: fileAsset, archived: true },
    { ...payload(fileAsset, true), schema_version: 2 },
    { ...payload(fileAsset, true), extra: true },
    { ...payload(fileAsset, true), archived: "true" },
    { ...payload(fileAsset, true), asset_id: "non-un-uuid" },
    [payload(fileAsset, true)],
  ].entries())
    await rejects(
      archive("founder", op(50 + index), invalid),
      /invalid_asset_payload/,
      `Payload non valido ${index + 1}: rifiutato`,
    );
  await rejects(
    archive("founder", null, payload(fileAsset, true)),
    /invalid_asset_payload/,
    "Senza operation_id: rifiutato",
  );
  eq(
    (
      await db.query(
        "select count(*)::int n from private.asset_command_receipts where operation_id >= $1",
        [op(40)],
      )
    ).rows[0].n,
    0,
    "I tentativi rifiutati non lasciano ricevute",
  );

  // --- Scritture dirette -----------------------------------------------------------------------
  await rejects(
    as("founder", "update public.assets set archived_at = now(), archived_by = $2 where id = $1", [
      fileAsset,
      ids.founder,
    ]),
    /permission denied/,
    "Un client non scrive archived_at direttamente",
  );
  await rejects(
    as("founder", "update public.assets set archived_by = null where id = $1", [systemAsset]),
    /permission denied/,
    "Un client non scrive archived_by direttamente",
  );
  await rejects(
    as("founder", "select * from private.asset_command_receipts"),
    /permission denied/,
    "Le ricevute non si leggono dai client",
  );
  await rejects(
    db.query("update public.assets set archived_at = now() where id = $1", [fileAsset]),
    /assets_archive_pair/,
    "archived_at e archived_by vanno sempre insieme",
  );

  // --- Audit -----------------------------------------------------------------------------------
  const trail = await auditRows(fileAsset);
  eq(
    trail.map((entry) => [entry.actor_id, entry.old_at === null, entry.new_at === null]),
    [
      [ids.logistics, true, false],
      [ids.consultant, false, true],
    ],
    "Ogni cambio lascia una riga di audit con autore, prima e dopo; i comandi senza effetto no",
  );
  eq(trail[0].new_by, ids.logistics, "L'audit registra chi ha archiviato");
  const linkTrail = await auditRows(linkAsset);
  eq(
    [
      linkTrail.length,
      activeRoles.map((role) =>
        linkTrail
          .filter((entry) => entry.actor_id === ids[role])
          .map((entry) => (entry.old_at === null ? "archiviato" : "ripristinato"))
          .sort(),
      ),
    ],
    [activeRoles.length * 2, activeRoles.map(() => ["archiviato", "ripristinato"])],
    "Archivio e ripristino di ogni ruolo sono nell'audit",
  );
  eq(await fingerprint(), before, "Nome, percorso, file e metadati restano come prima");

  console.log(
    `PASS ${checks} checks — archivio dei contenuti su PostgreSQL sintetico; Auth e Storage simulati; nessuna azione cloud.`,
  );
} finally {
  await db.close();
}
