// test-db: pglite minimo 208
// Foto dei nuovi prodotti (20261023180000_foto_nuovi_prodotti) su PGlite: Auth simulato, metadata
// Storage simulati, solo dati sintetici, nessun cloud. Gruppi: migrazione sopra contenuti e
// progetti esistenti, permessi e policy, aggiunta (anche HEIC), ricevute e replay, ordine e
// spostamento, rimozione con archivio, guardie sui collegamenti, scritture dirette, audit,
// libreria senza le foto dei progetti, frasi del feed di Controllo CEO.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

const id = (n) => `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const roles = ["founder", "production", "logistics", "consultant", "outsider", "inactive"];
const ids = Object.fromEntries(roles.map((role, index) => [role, id(index + 1)]));
const activeRoles = roles.slice(0, 4);
const collab = id(100),
  second = id(101),
  missingProject = id(199);
const libraryFile = id(110),
  libraryLink = id(111),
  systemAsset = id(112);
let assetCounter = 1000;
const newAsset = () => id(assetCounter++);

const directory = new URL("../migrations/", import.meta.url);
const files = readdirSync(directory).sort();
function migration(suffix) {
  const found = files.filter((name) => name.endsWith(`_${suffix}.sql`));
  assert.equal(found.length, 1, `Una sola migrazione ${suffix}`);
  return readFileSync(new URL(found[0], directory), "utf8");
}

async function as(role, sql, params = [], claims = {}) {
  await db.exec("begin");
  try {
    if (role !== "anon")
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: ids[role], aal: "aal1", ...claims }),
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
async function rejects(promise, code, message, label) {
  let error;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  ok(error, `Rifiuto atteso: ${label}`);
  eq(error?.code, code, `Codice ${code}: ${label}`);
  if (message) eq(error?.message, message, `Messaggio ${message}: ${label}`);
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const count = async (table, where = "true", params = []) =>
  (await one(`select count(*)::int n from ${table} where ${where}`, params)).n;
const command = (name, role, operation, payload) =>
  as(role, `select public.${name}($1, $2::jsonb) r`, [operation, JSON.stringify(payload)]).then(
    (result) => result[0].r,
  );

const sha = (n) => String(n % 10).repeat(64);
/** Foto sintetica: percorso utente/operazione/nome, come nella Server Action. */
function photo(role, { ext = "jpg", type = "image/jpeg", size = 2048, name } = {}) {
  const assetId = newAsset();
  return {
    asset_id: assetId,
    storage_path: `${ids[role]}/${assetId}/foto-sintetica.${ext}`,
    original_file_name: name ?? `Foto sintetica ${assetCounter}.${ext}`,
    content_type: type,
    file_size_bytes: size,
    sha256: sha(assetCounter),
  };
}
const storageMime = (type) =>
  ["image/heic", "image/heif"].includes(type) ? "application/octet-stream" : type;
/** Carica come il membro: passa dalle policy di storage.objects. */
const upload = (role, value, mime = storageMime(value.content_type)) =>
  as(
    role,
    "insert into storage.objects(bucket_id, name, metadata) values ('brand-assets', $1, $2)",
    [value.storage_path, { mimetype: mime, size: value.file_size_bytes }],
  );
const addPayload = (projectId, photos) => ({ schema_version: 1, project_id: projectId, photos });
const removePayload = (projectId, assetId) => ({
  schema_version: 1,
  project_id: projectId,
  asset_id: assetId,
});
const movePayload = (projectId, assetId, position) => ({
  schema_version: 1,
  project_id: projectId,
  asset_id: assetId,
  position,
});
const order = async (projectId) =>
  (
    await rows(
      "select asset_id from public.product_development_photos where project_id = $1 order by position",
      [projectId],
    )
  ).map((row) => row.asset_id);
const positions = async (projectId) =>
  (
    await rows(
      "select position from public.product_development_photos where project_id = $1 order by position",
      [projectId],
    )
  ).map((row) => row.position);
const feed = () =>
  rows(
    `select actor_name, area, message, href from private.activity_feed_window(now() - interval '1 hour', 'infinity'::timestamptz, null)
     order by occurred_at, message`,
  );
const feedSince = async (since) =>
  (
    await rows(
      `select area, message, href from private.activity_feed_window($1::timestamptz, 'infinity'::timestamptz, null)
       order by occurred_at, message`,
      [since],
    )
  ).map((row) => [row.area, row.message, row.href]);
const clock = async () => (await one("select clock_timestamp()::text t")).t;
const fingerprint = async () =>
  (
    await one(
      `select md5(string_agg(concat_ws('|', id, name, asset_type, description, external_url, storage_path, created_by,
         created_at, original_file_name, content_type, file_size_bytes, sha256, source, archived_at, archived_by), ',' order by id)) h
       from public.assets`,
    )
  ).h;

try {
  // --- Migrazioni: la catena del riassortimento più quelle dei contenuti -----------------------
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create schema storage; create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb, unique(bucket_id, name));
    alter table storage.objects enable row level security; grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  for (const suffix of [
    "initial_schema",
    "sales_ecosystem",
    "sales_lifecycle",
    "packaging_materials",
    "brand_assets_and_development",
    "shopify_catalog",
    "consignment_workflow",
    "shopify_sales_core",
    "packaging_automatic_consumption",
    "consignment_monthly",
    "ceo_activity_feed",
    "archivio_contenuti",
    "ceo_feed_fixes",
    "riassortimento",
  ])
    await db.exec(migration(suffix));
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

  // Dati di oggi: due progetti, un file e un link della libreria, un import amministrativo.
  const saveProject =
    "select public.save_development_project($1, null, $2, '', 'design', null, null) r";
  await as("production", saveProject, [collab, "Collab sintetica"]);
  await as("logistics", saveProject, [second, "Secondo progetto sintetico"]);
  const libraryPath = `${ids.consultant}/${libraryFile}/grafica.png`;
  await as(
    "consultant",
    "insert into storage.objects(bucket_id, name, metadata) values ('brand-assets', $1, $2)",
    [libraryPath, { mimetype: "image/png", size: 8 }],
  );
  const register = "select public.register_brand_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) id";
  await as("consultant", register, [
    libraryFile,
    "Grafica sintetica",
    "mockup",
    "",
    null,
    libraryPath,
    "grafica.png",
    "image/png",
    8,
    "c".repeat(64),
  ]);
  await as("consultant", register, [
    libraryLink,
    "Link sintetico",
    "photo",
    "",
    "https://example.test/sintetico",
    null,
    null,
    null,
    null,
    null,
  ]);
  await db.query(
    `insert into public.assets(id, name, asset_type, description, storage_path, created_by, original_file_name,
       content_type, file_size_bytes, sha256, source)
     values ($1, 'Logo sintetico', 'logo', '', $2, null, 'logo.png', 'image/png', 8, $3, '{"kind":"drive_admin_import"}')`,
    [systemAsset, `system/${systemAsset}/logo.png`, "b".repeat(64)],
  );
  const before = await fingerprint();
  const projectsBefore = (
    await one(
      "select md5(string_agg(concat_ws('|', id, name, version, updated_at), ',' order by id)) h from public.product_development_projects",
    )
  ).h;
  const auditBefore = await count("public.audit_logs");
  const policiesBefore = await count("pg_policies", "schemaname = 'storage'");
  await db.exec(migration("foto_nuovi_prodotti"));
  ok(true, "foto_nuovi_prodotti si applica dopo il riassortimento");

  // --- 1. Migrazione: nessuna riga esistente cambia ---------------------------------------------
  eq(await fingerprint(), before, "I contenuti di oggi restano identici");
  eq(
    (
      await one(
        "select md5(string_agg(concat_ws('|', id, name, version, updated_at), ',' order by id)) h from public.product_development_projects",
      )
    ).h,
    projectsBefore,
    "I progetti di oggi restano identici",
  );
  eq(await count("public.audit_logs"), auditBefore, "La migrazione non scrive righe di audit");
  eq(await count("public.product_development_photos"), 0, "La tabella delle foto nasce vuota");
  eq(
    await count("pg_policies", "schemaname = 'storage'"),
    policiesBefore + 1,
    "Una sola policy nuova su storage.objects",
  );
  eq(
    await one(
      "select cmd, roles::text roles, qual is null no_using from pg_policies where policyname = 'development_photos_heic_insert'",
    ),
    { cmd: "INSERT", roles: "{authenticated}", no_using: true },
    "La policy HEIC è solo di inserimento, per authenticated",
  );
  eq(
    await one(
      `select c.relrowsecurity rls,
        has_table_privilege('anon', 'public.product_development_photos', 'select') anon_select,
        has_table_privilege('authenticated', 'public.product_development_photos', 'select') member_select,
        has_table_privilege('authenticated', 'public.product_development_photos', 'insert') member_insert,
        has_table_privilege('authenticated', 'public.product_development_photos', 'update') member_update,
        has_table_privilege('authenticated', 'public.product_development_photos', 'delete') member_delete,
        exists(select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'audit_change') audited
       from pg_class c where c.oid = 'public.product_development_photos'::regclass`,
    ),
    {
      rls: true,
      anon_select: false,
      member_select: true,
      member_insert: false,
      member_update: false,
      member_delete: false,
      audited: true,
    },
    "Foto: RLS, sola lettura ai membri, niente per anon, audit",
  );
  eq(
    await one(
      `select has_table_privilege('authenticated', 'private.development_photo_receipts', 'select') member,
        has_table_privilege('anon', 'private.development_photo_receipts', 'select') anon`,
    ),
    { member: false, anon: false },
    "Le ricevute non sono leggibili dai client",
  );
  for (const name of [
    "add_development_photos",
    "remove_development_photo",
    "move_development_photo",
  ]) {
    const info = await one(
      `select p.prosecdef private_definer, p.proconfig private_config, q.prosecdef public_definer,
        has_function_privilege('anon', q.oid, 'execute') anon_execute,
        has_function_privilege('anon', p.oid, 'execute') anon_private,
        has_function_privilege('authenticated', q.oid, 'execute') member_execute
       from pg_proc p, pg_proc q
       where p.oid = 'private.${name}(uuid,jsonb)'::regprocedure and q.oid = 'public.${name}(uuid,jsonb)'::regprocedure`,
    );
    eq(
      [info.private_definer, info.private_config.includes('search_path=""'), info.public_definer],
      [true, true, false],
      `${name}: definer con search_path vuoto, wrapper invoker`,
    );
    eq(
      [info.anon_execute, info.anon_private, info.member_execute],
      [false, false, true],
      `${name}: EXECUTE solo ad authenticated`,
    );
  }
  for (const helper of ["development_photo_guard()", "development_photo_replay(uuid,text,text)"])
    eq(
      await one(
        `select has_function_privilege('authenticated', 'private.${helper}', 'execute') m,
            has_function_privilege('anon', 'private.${helper}', 'execute') a`,
      ),
      { m: false, a: false },
      `private.${helper} senza EXECUTE per i client`,
    );
  eq(
    await count(
      "pg_trigger",
      "tgrelid = 'public.assets'::regclass and tgname = 'development_photo_archive_guard'",
    ),
    1,
    "Guardia sull'archivio dei contenuti",
  );
  // Il vincolo dei tipi accetta HEIC; la libreria resta senza HEIC.
  const heicLibraryPath = `${ids.consultant}/${id(113)}/foto.heic`;
  await db.query(
    "insert into storage.objects(bucket_id, name, metadata) values ('brand-assets', $1, $2)",
    [heicLibraryPath, { mimetype: "application/octet-stream", size: 8 }],
  );
  await rejects(
    as("consultant", register, [
      id(113),
      "HEIC in libreria",
      "photo",
      "",
      null,
      heicLibraryPath,
      "foto.heic",
      "image/heic",
      8,
      "d".repeat(64),
    ]),
    "22023",
    null,
    "register_brand_asset non accetta HEIC",
  );
  ok(
    (
      await one(
        "select pg_get_constraintdef(oid) d from pg_constraint where conname = 'assets_content_type_check'",
      )
    ).d.includes("image/heic"),
    "assets_content_type_check accetta image/heic",
  );

  // --- 2. Policy di Storage per HEIC ------------------------------------------------------------
  const heicOwn = photo("production", { ext: "heic", type: "image/heic" });
  await upload("production", heicOwn);
  eq(
    await count("storage.objects", "name = $1", [heicOwn.storage_path]),
    1,
    "Un membro carica un .heic nel proprio percorso",
  );
  const heicOther = photo("logistics", { ext: "heic", type: "image/heic" });
  await rejects(upload("production", heicOther), "42501", null, ".heic nel percorso di un altro");
  const heicOutsider = { ...photo("outsider", { ext: "heic", type: "image/heic" }) };
  await rejects(upload("outsider", heicOutsider), "42501", null, ".heic da chi non è nel team");
  const badExt = photo("production", { ext: "exe", type: "image/jpeg" });
  await rejects(upload("production", badExt), "42501", null, "estensione non ammessa");

  // --- 3. Aggiunta ------------------------------------------------------------------------------
  const first = photo("production");
  const secondPhoto = photo("production", { ext: "png", type: "image/png", name: ".png" });
  await upload("production", first);
  await upload("production", secondPhoto);
  const addOp = randomUUID();
  const sinceAdd = await clock();
  const added = await command(
    "add_development_photos",
    "production",
    addOp,
    addPayload(collab, [first, secondPhoto]),
  );
  eq(
    added,
    {
      operation_id: addOp,
      project_id: collab,
      asset_ids: [first.asset_id, secondPhoto.asset_id],
      replayed: false,
    },
    "Due foto aggiunte in un invio",
  );
  eq(
    await order(collab),
    [first.asset_id, secondPhoto.asset_id],
    "In coda, nell'ordine dell'invio",
  );
  eq(await positions(collab), [1, 2], "Posizioni 1 e 2");
  eq(
    await rows(
      `select a.id, a.name, a.asset_type, a.description, a.created_by, a.content_type, a.source, a.archived_at,
         p.created_by link_by
       from public.assets a join public.product_development_photos p on p.asset_id = a.id order by p.position`,
    ),
    [
      {
        id: first.asset_id,
        name: first.original_file_name.replace(/\.jpg$/, ""),
        asset_type: "photo",
        description: "",
        created_by: ids.production,
        content_type: "image/jpeg",
        source: { kind: "development_photo", development_project_id: collab },
        archived_at: null,
        link_by: ids.production,
      },
      {
        id: secondPhoto.asset_id,
        name: "Foto",
        asset_type: "photo",
        description: "",
        created_by: ids.production,
        content_type: "image/png",
        source: { kind: "development_photo", development_project_id: collab },
        archived_at: null,
        link_by: ids.production,
      },
    ],
    "Contenuti con autore, tipo foto e progetto; nome dal file («Foto» se resta vuoto)",
  );
  eq(
    await feedSince(sinceAdd),
    [
      [
        "development",
        "Sintetico production ha aggiunto 2 foto al progetto «Collab sintetica».",
        `/development#progetto-${collab}`,
      ],
    ],
    "Feed: una frase sola per le due foto, con il progetto e il link alla scheda",
  );
  // Replay e conflitti.
  const auditCount = await count("public.audit_logs");
  eq(
    await command(
      "add_development_photos",
      "production",
      addOp,
      addPayload(collab, [first, secondPhoto]),
    ),
    { ...added, replayed: true },
    "Lo stesso invio restituisce l'esito di allora",
  );
  eq(await count("public.audit_logs"), auditCount, "Il replay non scrive niente");
  await rejects(
    command("add_development_photos", "production", addOp, addPayload(collab, [first])),
    "23505",
    "development_photo_idempotency_conflict",
    "stesso ID, altro payload",
  );
  await rejects(
    command("add_development_photos", "logistics", addOp, addPayload(collab, [first, secondPhoto])),
    "23505",
    "development_photo_idempotency_conflict",
    "stesso ID da un altro membro",
  );
  await rejects(
    command("remove_development_photo", "production", addOp, removePayload(collab, first.asset_id)),
    "23505",
    "development_photo_idempotency_conflict",
    "stesso ID per un altro comando",
  );
  await rejects(
    command("add_development_photos", "production", randomUUID(), addPayload(collab, [first])),
    "23505",
    "development_photo_already_added",
    "la stessa foto con un invio nuovo",
  );
  // Ogni membro attivo aggiunge; HEIC si registra con il MIME di Storage octet-stream.
  const heicAdded = await command(
    "add_development_photos",
    "production",
    randomUUID(),
    addPayload(collab, [heicOwn]),
  );
  eq(heicAdded.asset_ids, [heicOwn.asset_id], "Una foto HEIC aggiunta");
  eq(
    (await one("select content_type from public.assets where id = $1", [heicOwn.asset_id]))
      .content_type,
    "image/heic",
    "Il contenuto HEIC tiene image/heic",
  );
  for (const role of ["founder", "logistics", "consultant"]) {
    const value = photo(role, { ext: "webp", type: "image/webp" });
    await upload(role, value);
    const result = await command(
      "add_development_photos",
      role,
      randomUUID(),
      addPayload(collab, [value]),
    );
    eq(result.asset_ids, [value.asset_id], `${role} aggiunge una foto`);
  }
  eq(await positions(collab), [1, 2, 3, 4, 5, 6], "Posizioni consecutive tra invii diversi");

  // --- 4. Accessi e payload ---------------------------------------------------------------------
  const spare = photo("production");
  await upload("production", spare);
  for (const role of ["outsider", "inactive"])
    await rejects(
      command("add_development_photos", role, randomUUID(), addPayload(collab, [spare])),
      "42501",
      "development_access_required",
      `${role} non aggiunge`,
    );
  for (const name of [
    "add_development_photos",
    "remove_development_photo",
    "move_development_photo",
  ])
    await rejects(
      as("anon", `select public.${name}($1, $2::jsonb)`, [randomUUID(), "{}"]),
      "42501",
      null,
      `anon non esegue ${name}`,
    );
  await rejects(
    as("anon", "select * from public.product_development_photos"),
    "42501",
    null,
    "anon non legge le foto",
  );
  eq(
    (await as("outsider", "select count(*)::int n from public.product_development_photos"))[0].n,
    0,
    "Chi non è nel team non vede righe",
  );
  eq(
    (await as("consultant", "select count(*)::int n from public.product_development_photos"))[0].n,
    6,
    "Ogni membro attivo vede le foto",
  );
  const invalid = [
    ["versione", { ...addPayload(collab, [spare]), schema_version: 2 }],
    ["chiave in più", { ...addPayload(collab, [spare]), note: "x" }],
    ["nessuna foto", addPayload(collab, [])],
    [
      "undici foto",
      addPayload(
        collab,
        Array.from({ length: 11 }, () => photo("production")),
      ),
    ],
    ["foto doppia", addPayload(collab, [spare, spare])],
    ["estensione e tipo diversi", addPayload(collab, [{ ...spare, content_type: "image/png" }])],
    [
      "SVG",
      addPayload(collab, [
        {
          ...spare,
          storage_path: spare.storage_path.replace(".jpg", ".svg"),
          content_type: "image/svg+xml",
        },
      ]),
    ],
    ["oltre 25 MB", addPayload(collab, [{ ...spare, file_size_bytes: 26214401 }])],
    ["dimensione decimale", addPayload(collab, [{ ...spare, file_size_bytes: 12.5 }])],
    ["hash non valido", addPayload(collab, [{ ...spare, sha256: "x".repeat(64) }])],
    ["nome con barra", addPayload(collab, [{ ...spare, original_file_name: "a/b.jpg" }])],
    [
      "percorso di un altro membro",
      addPayload(collab, [
        { ...spare, storage_path: spare.storage_path.replace(ids.production, ids.logistics) },
      ]),
    ],
    [
      "percorso con un'altra operazione",
      addPayload(collab, [
        { ...spare, storage_path: spare.storage_path.replace(spare.asset_id, id(998)) },
      ]),
    ],
    ["UUID maiuscolo", addPayload("ABCDEF00-0000-4000-8000-000000000100", [spare])],
  ];
  for (const [label, payload] of invalid)
    await rejects(
      command("add_development_photos", "production", randomUUID(), payload),
      "22023",
      "invalid_development_photo_payload",
      label,
    );
  await rejects(
    command(
      "add_development_photos",
      "production",
      randomUUID(),
      addPayload(missingProject, [spare]),
    ),
    "22023",
    "development_project_not_found",
    "progetto inesistente",
  );
  const notUploaded = photo("production");
  await rejects(
    command(
      "add_development_photos",
      "production",
      randomUUID(),
      addPayload(collab, [notUploaded]),
    ),
    "22023",
    "development_photo_upload_missing",
    "file non caricato",
  );
  const heicWrongMime = photo("production", { ext: "heic", type: "image/heic" });
  await upload("production", heicWrongMime, "image/heic");
  await rejects(
    command(
      "add_development_photos",
      "production",
      randomUUID(),
      addPayload(collab, [heicWrongMime]),
    ),
    "22023",
    "development_photo_upload_missing",
    "HEIC caricato con un MIME diverso da quello firmato",
  );
  const otherSize = photo("production");
  await upload("production", otherSize, "image/jpeg");
  await rejects(
    command(
      "add_development_photos",
      "production",
      randomUUID(),
      addPayload(collab, [{ ...otherSize, file_size_bytes: 4096 }]),
    ),
    "22023",
    "development_photo_upload_missing",
    "dimensione diversa da quella caricata",
  );
  eq(await count("public.product_development_photos"), 6, "Nessun rifiuto ha scritto righe");

  // Limite: 60 foto per progetto.
  for (let batch = 0; batch < 6; batch++) {
    const values = Array.from({ length: batch < 5 ? 10 : 4 }, () => photo("logistics"));
    for (const value of values) await upload("logistics", value);
    await command("add_development_photos", "logistics", randomUUID(), addPayload(second, values));
  }
  eq(
    await count("public.product_development_photos", "project_id = $1", [second]),
    54,
    "54 foto nel secondo progetto",
  );
  const tooMany = Array.from({ length: 7 }, () => photo("logistics"));
  for (const value of tooMany) await upload("logistics", value);
  await rejects(
    command("add_development_photos", "logistics", randomUUID(), addPayload(second, tooMany)),
    "22023",
    "development_photo_limit",
    "oltre 60 foto nel progetto",
  );
  await command(
    "add_development_photos",
    "logistics",
    randomUUID(),
    addPayload(second, tooMany.slice(0, 6)),
  );
  eq(
    await count("public.product_development_photos", "project_id = $1", [second]),
    60,
    "Fino a 60 foto",
  );

  // --- 5. Spostamento ---------------------------------------------------------------------------
  const start = await order(collab);
  const sinceMove = await clock();
  const moveOp = randomUUID();
  const moved = await command(
    "move_development_photo",
    "consultant",
    moveOp,
    movePayload(collab, start[2], 1),
  );
  eq(
    moved,
    {
      operation_id: moveOp,
      project_id: collab,
      asset_id: start[2],
      position: 1,
      changed: true,
      replayed: false,
    },
    "La terza foto diventa la prima",
  );
  eq(await order(collab), [start[2], start[0], start[1], ...start.slice(3)], "Le altre scorrono");
  eq(await positions(collab), [1, 2, 3, 4, 5, 6], "Posizioni sempre 1..n");
  eq(
    await command("move_development_photo", "consultant", moveOp, movePayload(collab, start[2], 1)),
    { ...moved, replayed: true },
    "Replay dello spostamento",
  );
  const last = await command(
    "move_development_photo",
    "consultant",
    randomUUID(),
    movePayload(collab, start[0], 99),
  );
  eq(
    [last.position, (await order(collab)).at(-1)],
    [6, start[0]],
    "Un posto oltre la fine vale ultima",
  );
  const same = await command(
    "move_development_photo",
    "consultant",
    randomUUID(),
    movePayload(collab, start[0], 6),
  );
  eq(same.changed, false, "Spostare al posto attuale non cambia niente");
  await rejects(
    command("move_development_photo", "consultant", randomUUID(), movePayload(second, start[1], 1)),
    "22023",
    "development_photo_not_found",
    "foto di un altro progetto",
  );
  await rejects(
    command("move_development_photo", "consultant", randomUUID(), {
      ...movePayload(collab, start[1], 1),
      position: 0,
    }),
    "22023",
    "invalid_development_photo_payload",
    "posto zero",
  );
  ok(
    (await feedSince(sinceMove)).some(
      ([area, message, href]) =>
        area === "development" &&
        message === "Sintetico consultant ha riordinato le foto del progetto «Collab sintetica»." &&
        href === `/development#progetto-${collab}`,
    ),
    "Feed: lo spostamento è una frase del progetto",
  );

  // --- 6. Rimozione -----------------------------------------------------------------------------
  const target = (await order(collab))[1];
  const objectsBefore = await count("storage.objects");
  const sinceRemove = await clock();
  const removeOp = randomUUID();
  const removed = await command(
    "remove_development_photo",
    "logistics",
    removeOp,
    removePayload(collab, target),
  );
  eq(
    [
      removed.operation_id,
      removed.asset_id,
      removed.removed,
      removed.replayed,
      typeof removed.archived_at,
    ],
    [removeOp, target, true, false, "string"],
    "La foto esce dal progetto",
  );
  eq(
    await count("public.product_development_photos", "asset_id = $1", [target]),
    0,
    "Collegamento cancellato",
  );
  eq(
    await one(
      "select archived_by, archived_at is not null archived, storage_path is not null kept from public.assets where id = $1",
      [target],
    ),
    { archived_by: ids.logistics, archived: true, kept: true },
    "Il contenuto resta, archiviato da chi ha tolto la foto",
  );
  eq(await count("storage.objects"), objectsBefore, "Il file resta nel bucket");
  eq(
    await command("remove_development_photo", "logistics", removeOp, removePayload(collab, target)),
    { ...removed, replayed: true },
    "Replay della rimozione",
  );
  await rejects(
    command("remove_development_photo", "founder", randomUUID(), removePayload(collab, target)),
    "22023",
    "development_photo_not_found",
    "togliere di nuovo la stessa foto",
  );
  await rejects(
    command("remove_development_photo", "outsider", randomUUID(), removePayload(collab, target)),
    "42501",
    "development_access_required",
    "chi non è nel team non toglie",
  );
  eq(
    await feedSince(sinceRemove),
    [
      [
        "development",
        "Sintetico logistics ha tolto una foto dal progetto «Collab sintetica».",
        `/development#progetto-${collab}`,
      ],
    ],
    "Feed: la rimozione è una frase sola, senza «ha archiviato un contenuto»",
  );
  eq(await positions(collab), [1, 3, 4, 5, 6], "Le posizioni restanti non cambiano");
  const compact = await command(
    "move_development_photo",
    "consultant",
    randomUUID(),
    movePayload(collab, (await order(collab))[0], 1),
  );
  eq(
    [compact.changed, await positions(collab)],
    [true, [1, 2, 3, 4, 5]],
    "Uno spostamento ricompatta 1..n",
  );

  // --- 7. Guardie -------------------------------------------------------------------------------
  const linked = (await order(collab))[0];
  await rejects(
    as("founder", "select public.set_brand_asset_archived($1, $2::jsonb) r", [
      randomUUID(),
      JSON.stringify({ schema_version: 1, asset_id: linked, archived: true }),
    ]),
    "22023",
    "development_photo_linked",
    "una foto nel progetto non si archiviava dalla libreria",
  );
  eq(
    (await one("select archived_at from public.assets where id = $1", [linked])).archived_at,
    null,
    "La foto resta attiva",
  );
  const linkInsert =
    "insert into public.product_development_photos(project_id, asset_id, position, created_by) values ($1, $2, $3, $4)";
  await rejects(
    db.query(linkInsert, [collab, target, 50, ids.founder]),
    "22023",
    "development_photo_asset_unavailable",
    "collegamento a una foto archiviata",
  );
  await rejects(
    db.query(linkInsert, [collab, id(997), 51, ids.founder]),
    "22023",
    "development_photo_asset_unavailable",
    "collegamento a un contenuto inesistente",
  );
  await rejects(
    db.query(linkInsert, [collab, libraryFile, 52, ids.founder]),
    "22023",
    "development_photo_asset_unavailable",
    "collegamento a un contenuto della libreria",
  );
  const ofSecond = (await order(second))[0];
  await rejects(
    db.query(linkInsert, [collab, ofSecond, 53, ids.founder]),
    "22023",
    "development_photo_asset_unavailable",
    "collegamento alla foto di un altro progetto",
  );
  await rejects(
    db.query(linkInsert, [collab, linked, 53, ids.founder]),
    "23505",
    null,
    "una foto ha un solo collegamento",
  );
  await db.exec(
    "alter table public.product_development_photos disable trigger development_photo_guard",
  );
  await rejects(
    db.query(linkInsert, [collab, id(997), 54, ids.founder]),
    "23503",
    null,
    "chiave esterna verso public.assets",
  );
  await db.exec(
    "alter table public.product_development_photos enable trigger development_photo_guard",
  );
  await rejects(
    db.query("update public.product_development_photos set project_id = $1 where asset_id = $2", [
      second,
      linked,
    ]),
    "22023",
    "development_photo_immutable",
    "una foto non cambia progetto",
  );
  await rejects(
    db.query("update public.product_development_photos set position = 2 where asset_id = $1", [
      linked,
    ]),
    "23505",
    null,
    "due foto non hanno lo stesso posto",
  );

  // --- 8. Scritture dirette e audit --------------------------------------------------------------
  await rejects(
    as("production", linkInsert, [collab, linked, 60, ids.production]),
    "42501",
    null,
    "INSERT diretto",
  );
  await rejects(
    as("production", "update public.product_development_photos set position = 9"),
    "42501",
    null,
    "UPDATE diretto",
  );
  await rejects(
    as("production", "delete from public.product_development_photos"),
    "42501",
    null,
    "DELETE diretto",
  );
  await rejects(
    as("production", "select * from private.development_photo_receipts"),
    "42501",
    null,
    "ricevute illeggibili",
  );
  await rejects(
    db.query("update private.development_photo_receipts set result = '{}'::jsonb"),
    "42501",
    null,
    "ricevute append-only",
  );
  eq(
    await rows(
      `select operation, actor_id from public.audit_logs
       where table_name = 'product_development_photos' and coalesce(new_data, old_data) ->> 'asset_id' = $1
       order by occurred_at, operation`,
      [first.asset_id],
    ),
    [
      { operation: "INSERT", actor_id: ids.production },
      { operation: "UPDATE", actor_id: ids.consultant },
      { operation: "UPDATE", actor_id: ids.consultant },
      { operation: "UPDATE", actor_id: ids.consultant },
    ],
    "Audit della prima foto: aggiunta e tre spostamenti, ciascuno con il suo autore",
  );
  eq(
    await count(
      "public.audit_logs",
      "table_name = 'product_development_photos' and actor_id is null",
    ),
    0,
    "Nessuna riga delle foto senza autore",
  );
  eq(
    await rows(
      `select operation, actor_id from public.audit_logs where table_name = 'product_development_photos'
       and coalesce(new_data, old_data) ->> 'asset_id' = $1 and operation in ('INSERT', 'DELETE') order by occurred_at`,
      [target],
    ),
    [
      {
        operation: "INSERT",
        actor_id: (await one("select created_by from public.assets where id = $1", [target]))
          .created_by,
      },
      { operation: "DELETE", actor_id: ids.logistics },
    ],
    "Aggiunta e rimozione nel registro, ciascuna con il suo autore",
  );
  eq(
    await one(
      `select actor_id, old_data ->> 'archived_at' is null was_active, new_data ->> 'archived_by' archived_by
       from public.audit_logs where table_name = 'assets' and operation = 'UPDATE' and record_key ->> 'id' = $1`,
      [target],
    ),
    { actor_id: ids.logistics, was_active: true, archived_by: ids.logistics },
    "L'archivio del contenuto rimosso è nel registro",
  );

  // --- 9. Libreria: le foto dei progetti si riconoscono e restano fuori dall'elenco principale --
  const library = await as(
    "consultant",
    "select id, source ->> 'kind' kind from public.assets where archived_at is null order by id",
  );
  const developmentIds = new Set(
    (await rows("select asset_id from public.product_development_photos")).map(
      (row) => row.asset_id,
    ),
  );
  eq(
    library.filter((row) => row.kind !== "development_photo").map((row) => row.id),
    [libraryFile, libraryLink, systemAsset],
    "L'elenco principale della libreria ha solo i contenuti di prima",
  );
  ok(
    library
      .filter((row) => row.kind === "development_photo")
      .every((row) => developmentIds.has(row.id)),
    "Ogni foto attiva di un progetto ha il segno development_photo",
  );
  eq(
    await count(
      "public.assets",
      "source ->> 'kind' = 'development_photo' and archived_at is null and id not in (select asset_id from public.product_development_photos)",
    ),
    0,
    "Nessuna foto attiva fuori da un progetto",
  );

  // --- 10. Feed: le frasi di prima restano ------------------------------------------------------
  const all = await feed();
  for (const message of [
    "Sintetico production ha avviato un progetto: Collab sintetica.",
    "Sintetico consultant ha aggiunto un contenuto: Grafica sintetica.",
  ])
    eq(all.filter((row) => row.message === message).length, 1, `Frase di prima: ${message}`);
  ok(
    !all.some(
      (row) =>
        /contenut/.test(row.message) && row.area === "assets" && row.message.includes("production"),
    ),
    "Le foto dei progetti non diventano frasi della libreria",
  );
  const sinceLibrary = await clock();
  await as("consultant", "select public.set_brand_asset_archived($1, $2::jsonb) r", [
    randomUUID(),
    JSON.stringify({ schema_version: 1, asset_id: libraryLink, archived: true }),
  ]);
  eq(
    await feedSince(sinceLibrary),
    [
      [
        "assets",
        "Sintetico consultant ha archiviato un contenuto: Link sintetico.",
        `/assets#contenuto-${libraryLink}`,
      ],
    ],
    "L'archivio della libreria ha ancora la sua frase",
  );
  const sinceOne = await clock();
  const single = photo("founder", { ext: "jpeg", type: "image/jpeg" });
  await upload("founder", single);
  await command("add_development_photos", "founder", randomUUID(), addPayload(collab, [single]));
  eq(
    await feedSince(sinceOne),
    [
      [
        "development",
        "Sintetico founder ha aggiunto una foto al progetto «Collab sintetica».",
        `/development#progetto-${collab}`,
      ],
    ],
    "Feed: una foto sola",
  );
  const viaFeed = (
    await as(
      "founder",
      "select public.ceo_activity_feed(null, 'development', null, null, 50) r",
      [],
      { aal: "aal2" },
    )
  )[0].r;
  ok(
    viaFeed.items.some(
      (item) =>
        item.message === "Sintetico founder ha aggiunto una foto al progetto «Collab sintetica».",
    ),
    "Controllo CEO, area Nuovi prodotti: la frase delle foto",
  );
  ok(
    viaFeed.items.every((item) => item.area === "development"),
    "Il filtro d'area resta quello di prima",
  );
  await rejects(
    as("production", "select public.ceo_activity_feed(null, null, null, null, 50) r"),
    "42501",
    "ceo_access_required",
    "il feed resta solo al founder",
  );

  console.log(
    `PASS ${checks} checks — foto dei nuovi prodotti: migrazione senza toccare righe, permessi, HEIC, ricevute, ordine, rimozione con archivio, guardie, audit, libreria e feed; PGlite, dati sintetici, nessun cloud.`,
  );
} finally {
  await db.close();
}
