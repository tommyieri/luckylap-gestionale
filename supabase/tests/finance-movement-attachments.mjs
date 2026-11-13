// test-db: pglite minimo 16
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  asRevisionUser,
  id,
  migration,
  setupRevisionDatabase,
  sourceIds,
  session,
} from "./fixtures/finance-revisions.mjs";

const core = pathToFileURL(process.argv[2]);
const { PGlite } = await import(core.href);
const { pgcrypto } = await import(new URL("./contrib/pgcrypto.js", core).href);
const db = new PGlite({ extensions: { pgcrypto } });
let checks = 0;
function equal(actual, expected) {
  assert.deepEqual(actual, expected);
  checks++;
}
async function rejects(callback, pattern) {
  await db.exec("savepoint expected_rejection");
  try {
    await assert.rejects(callback, pattern);
  } finally {
    await db.exec("rollback to savepoint expected_rejection; release savepoint expected_rejection");
  }
  checks++;
}

try {
  await db.exec("create schema extensions;create extension pgcrypto with schema extensions;");
  await setupRevisionDatabase(db);
  await db.exec(`create schema storage; create table storage.objects(bucket_id text, name text, metadata jsonb);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select, insert on storage.objects to authenticated;`);
  await db.exec(migration("finance_allegati_movimenti"));
  const sha256 = "c".repeat(64);
  const count = async (table) => (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
  const prepare = async (
    source = "manual",
    sourceId = sourceIds.manual,
    name = "Ricevuta demo.pdf",
    bytes = 777,
  ) =>
    (
      await db.query(
        "select public.prepare_finance_movement_attachment($1,$2,$3,'application/pdf',$4,$5) as attachment",
        [source, sourceId, name, bytes, sha256],
      )
    ).rows[0].attachment;
  const finish = async (attachmentId) =>
    (
      await db.query("select public.finish_finance_movement_attachment($1) as ready", [
        attachmentId,
      ])
    ).rows[0].ready;
  const insert = (bucket, name, metadata = { size: 777, mimetype: "application/pdf" }) =>
    db.query("insert into storage.objects values($1,$2,$3::jsonb)", [
      bucket,
      name,
      JSON.stringify(metadata),
    ]);

  await asRevisionUser(db, "logistics", async () => {
    await rejects(() => prepare(), /finance_access_required/);
    equal(await count("public.finance_movement_attachments"), 0);
  });
  await asRevisionUser(db, "finance", async () => {
    await rejects(() => prepare("manual", id(999)), /finance_source_not_found/);
    await rejects(() => prepare("manual", sourceIds.manual, "../demo.pdf"), /check constraint/);
    const attachment = await prepare();
    equal(attachment.ready, false);
    equal((await prepare("manual", sourceIds.manual, "Duplicato.pdf")).id, attachment.id);
    equal(await count("public.finance_movement_attachments"), 0);
    const name = `movements/${attachment.id}/${sha256}`;
    await rejects(() => insert("another-bucket", name), /row-level security/);
    await rejects(
      () => insert("finance-documents", `movements/demo/${sha256}`),
      /row-level security/,
    );
    await rejects(() => finish(attachment.id), /finance_attachment_missing_file/);
    await insert("finance-documents", name);
    equal(await count("storage.objects"), 1);
    equal(await finish(attachment.id), true);
    equal(await finish(attachment.id), true);
    equal(await count("public.finance_movement_attachments"), 1);
    await rejects(() => insert("finance-documents", name), /row-level security/);
  });
  await asRevisionUser(db, "logistics", async () => {
    equal(await count("storage.objects"), 0);
    equal(await count("public.finance_movement_attachments"), 0);
  });
  await db.query("delete from private.area_grants where session_id=$1 and area='finance'", [
    session("finance"),
  ]);
  await asRevisionUser(db, "finance", async () => {
    equal(await count("storage.objects"), 0);
    equal(await count("public.finance_movement_attachments"), 0);
  });
  console.log(`PASS ${checks} allegati movimenti Finance (PGlite).`);
} finally {
  await db.close();
}
