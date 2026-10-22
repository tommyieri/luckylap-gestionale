// Synthetic data only. PostgreSQL/Auth/Storage metadata are mocked locally.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (!process.argv[2])
  throw new Error("Passare il percorso esterno di @electric-sql/pglite/dist/index.js.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks = 0;
const eq = (a, b, label) => {
  assert.deepEqual(a, b, label);
  checks += 1;
};
const ok = (value, label) => {
  assert.ok(value, label);
  checks += 1;
};
const rejects = async (promise, pattern) => {
  await assert.rejects(promise, pattern);
  checks += 1;
};
const uid = (index) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const op = (index) => `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const roles = [
  "founder",
  "production",
  "finance",
  "logistics",
  "consultant",
  "outsider",
  "inactive",
];
const ids = Object.fromEntries(roles.map((role, index) => [role, uid(index + 1)]));
const migration = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
async function as(role, sql, args = []) {
  await db.exec("begin; set local role authenticated;");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: ids[role], aal: "aal1" }),
    ]);
    const result = await db.query(sql, args);
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const register = "select public.register_brand_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) id";
const save = "select public.save_development_project($1,$2,$3,$4,$5,$6,$7) project";
try {
  await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    create schema storage;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to authenticated;grant select on storage.objects to anon;`);
  await db.exec(migration("20261021114636_initial_schema.sql"));
  await db.exec(migration("20261021130138_brand_assets_and_development.sql"));
  checks += 2;
  for (const role of roles) {
    await db.query("insert into auth.users values($1)", [ids[role]]);
    if (role === "outsider") continue;
    await db.query("insert into public.profiles(user_id,display_name) values($1,$2)", [
      ids[role],
      role,
    ]);
    await db.query(
      "insert into public.memberships(user_id,role,active,finance_access) values($1,$2,$3,false)",
      [ids[role], role === "inactive" ? "consultant" : role, role !== "inactive"],
    );
  }
  for (const [index, role] of roles.slice(0, 5).entries()) {
    const link = [
      op(index + 1),
      `Synthetic ${role}`,
      "photo",
      "Synthetic content",
      "https://example.test/asset",
      null,
      null,
      null,
      null,
      null,
    ];
    eq(
      (await as(role, register, link)).rows[0].id,
      op(index + 1),
      "Every active role creates a link",
    );
    eq((await as(role, register, link)).rows[0].id, op(index + 1), "Identical retry is idempotent");
    await rejects(
      as(role, register, [...link.slice(0, 3), "changed", ...link.slice(4)]),
      /Operation already used/,
    );
    eq(
      (await db.query("select created_by from public.assets where id=$1", [op(index + 1)])).rows[0]
        .created_by,
      ids[role],
      "Creator is current Auth actor",
    );
    ok(
      (await as(role, "select id from public.assets")).rows.length >= 1,
      "Every active role reads shared assets",
    );
    await rejects(
      as(role, "insert into public.assets(name,asset_type) values('Forged','photo')"),
      /permission denied/,
    );
    await rejects(
      as(role, "update public.assets set name='Forged' where id=$1", [op(index + 1)]),
      /permission denied/,
    );
    await rejects(
      as(role, "delete from public.assets where id=$1", [op(index + 1)]),
      /permission denied/,
    );
    const path = `${ids[role]}/${op(index + 10)}/photo.png`;
    await as(
      role,
      "insert into storage.objects(bucket_id,name,metadata) values('brand-assets',$1,$2)",
      [path, { mimetype: "image/png", size: 8 }],
    );
    checks += 1;
    eq(
      (
        await as(role, register, [
          op(index + 10),
          "Synthetic PNG",
          "photo",
          "",
          null,
          path,
          "Photo.png",
          "image/png",
          8,
          "a".repeat(64),
        ])
      ).rows[0].id,
      op(index + 10),
      "File metadata requires an uploaded object",
    );
    eq(
      (
        await as(role, "update storage.objects set metadata='{}' where name=$1 returning id", [
          path,
        ])
      ).rows,
      [],
      "No object update/upsert",
    );
    eq(
      (await as(role, "delete from storage.objects where name=$1 returning id", [path])).rows,
      [],
      "No object delete",
    );
    await rejects(
      as(
        role,
        "insert into storage.objects(bucket_id,name,metadata) values('brand-assets',$1,'{}')",
        [`${ids.founder}/${op(99)}/wrong.png`].map((x) =>
          role === "founder" ? `${ids.consultant}/${op(99)}/wrong.png` : x,
        ),
      ),
      /row-level security/,
    );
    const project = [
      op(index + 30),
      null,
      `Prototype ${role}`,
      "Synthetic brief",
      "idea",
      "2026-11-01",
      ids[role],
    ];
    eq(
      (await as(role, save, project)).rows[0].project,
      { id: op(index + 30), version: 1 },
      "Every active role creates a development project",
    );
    eq(
      (await as(role, save, project)).rows[0].project,
      { id: op(index + 30), version: 1 },
      "Identical project creation retry is idempotent",
    );
    await rejects(
      as(role, save, [
        op(index + 30),
        null,
        "Changed name",
        "Synthetic brief",
        "idea",
        "2026-11-01",
        ids[role],
      ]),
      /Operation already used/,
    );
    await rejects(
      as(role, "delete from public.product_development_projects where id=$1", [op(index + 30)]),
      /permission denied/,
    );
  }
  const shared = op(30);
  eq(
    (
      await as("consultant", save, [
        shared,
        1,
        "Shared prototype",
        "Updated by consultant",
        "sampling",
        null,
        ids.production,
      ])
    ).rows[0].project,
    { id: shared, version: 2 },
    "A collaborator updates the shared project",
  );
  await rejects(
    as("finance", save, [shared, 1, "Stale overwrite", "Old text", "design", null, null]),
    /Project changed/,
  );
  eq(
    (
      await db.query(
        "select name,brief,version from public.product_development_projects where id=$1",
        [shared],
      )
    ).rows[0],
    { name: "Shared prototype", brief: "Updated by consultant", version: 2 },
    "Stale update leaves current data intact",
  );
  eq(
    (
      await as("logistics", save, [
        shared,
        2,
        "Shared prototype",
        "Updated by consultant",
        "archived",
        null,
        ids.production,
      ])
    ).rows[0].project,
    { id: shared, version: 3 },
    "Archive is a versioned update",
  );
  eq(
    (await db.query("select stage from public.product_development_projects where id=$1", [shared]))
      .rows[0].stage,
    "archived",
    "Archived project remains stored",
  );
  await rejects(
    as("founder", save, [op(80), null, "Inactive owner", "", "idea", null, ids.inactive]),
    /Owner is not an active member/,
  );
  await rejects(
    as("founder", register, [
      op(81),
      "Missing file",
      "photo",
      "",
      null,
      `${ids.founder}/${op(81)}/file.png`,
      "file.png",
      "image/png",
      8,
      "a".repeat(64),
    ]),
    /Uploaded object not available/,
  );
  await rejects(
    as("founder", register, [
      op(82),
      "Wrong URL",
      "photo",
      "",
      "http://example.test",
      null,
      null,
      null,
      null,
      null,
    ]),
    /Invalid external asset/,
  );
  for (const role of ["outsider", "inactive"]) {
    eq((await as(role, "select id from public.assets")).rows, [], "Non-member cannot read assets");
    eq(
      (await as(role, "select id from public.product_development_projects")).rows,
      [],
      "Non-member cannot read projects",
    );
    eq(
      (await as(role, "select id from storage.objects where bucket_id='brand-assets'")).rows,
      [],
      "Non-member cannot read objects",
    );
    await rejects(
      as(role, register, [
        op(90),
        "Denied",
        "photo",
        "",
        "https://example.test",
        null,
        null,
        null,
        null,
        null,
      ]),
      /Team access required/,
    );
    await rejects(
      as(role, save, [op(91), null, "Denied", "", "idea", null, null]),
      /Team access required/,
    );
  }
  eq(
    (
      await db.query(
        "select has_function_privilege('anon','public.register_brand_asset(uuid,text,text,text,text,text,text,text,bigint,text)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
    false,
    "Anon cannot execute register RPC",
  );
  eq(
    (
      await db.query(
        "select has_function_privilege('anon','public.save_development_project(uuid,bigint,text,text,text,date,uuid)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
    false,
    "Anon cannot execute development RPC",
  );
  await db.query(
    "insert into public.assets(id,name,asset_type,storage_path,created_by,original_file_name,content_type,file_size_bytes,sha256,source) values($1,'System import','logo','system/import/logo.png',null,'logo.png','image/png',8,$2,'{\"kind\":\"drive_admin_import\"}')",
    [op(95), "a".repeat(64)],
  );
  eq(
    (await db.query("select created_by from public.assets where id=$1", [op(95)])).rows[0]
      .created_by,
    null,
    "Owner imports remain attributed to system",
  );
  ok(
    (
      await db.query(
        "select id from public.audit_logs where table_name='product_development_projects' and operation='UPDATE'",
      )
    ).rows.length >= 2,
    "Development changes are audited",
  );
  console.log(
    `PASS ${checks} checks — assets/development synthetic PostgreSQL; mocked Auth and Storage metadata; no cloud actions.`,
  );
} finally {
  await db.close();
}
