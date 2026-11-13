// test-db: pglite minimo 12
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const { PGlite } = await import(pathToFileURL(process.argv[2]));
const db = new PGlite();
const migration = (name) => readFile(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8");
let checks = 0;
const equal = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
const rejects = async (callback, pattern) => {
  await assert.rejects(callback, pattern);
  checks++;
};

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    create schema storage; create table storage.objects(bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select on storage.objects to authenticated;
  `);
  for (const name of [
    "20261021114636_initial_schema",
    "20261021114642_finance_imports",
    "20261021121048_private_finance_documents",
    "20261113195000_finance_conto_vendita_storico",
  ])
    await db.exec(await migration(name));

  const shop = "12000000-0000-4000-8000-000000000001";
  const actor = "12000000-0000-4000-8000-000000000002";
  const movement = "12000000-0000-4000-8000-000000000003";
  const batch = "12000000-0000-4000-8000-000000000004";
  await db.query(
    "insert into public.stock_locations(id, code, name, location_type) values($1,'SHOP','Negozio demo','Negozio Conto Vendita')",
    [shop],
  );
  await db.query("insert into auth.users values($1)", [actor]);
  await db.query("insert into public.profiles(user_id, display_name) values($1,'Demo')", [actor]);
  await db.query(
    "insert into public.memberships(user_id, role, finance_access) values($1,'founder',true)",
    [actor],
  );
  await db.query(
    `
    insert into public.finance_import_batches(id,source_system,source_file_name,source_sha256,normalized_sha256,fingerprint_version,extracted_at,reference_date,source_row_count,source_record_ids_available)
    values($1,'budgetflow','demo.csv',repeat('a',64),repeat('b',64),'budgetflow-v1-sorted-raw-core','2028-03-01','2028-03-01',1,false)
  `,
    [batch],
  );
  const payment = {
    Date: "2028-03-20T00:00:00+01:00",
    Amount: "6.00",
    "Source Currency": "EUR",
    "Target Currency": "EUR",
    "Exchange Rate": "1",
    "Budget Book": "Demo",
    "Source Account": "Conto demo",
    "Target Account": "",
    Folder: "",
    Category: "Vendite",
    Payee: "Negozio demo",
    Tags: "",
    Notes: "",
    Pending: "False",
  };
  await db.query(
    `
    insert into public.finance_import_transactions(id,batch_id,source_row,raw_record,raw_fingerprint_sha256,economic_fingerprint_sha256,source_timestamp,occurred_at,transaction_date,amount_text,amount_cents,currency,target_currency,exchange_rate_text,account_label,pending,future_as_of_reference_date)
    values($1,$2,2,$3,repeat('c',64),repeat('d',64),$4::text,$4::text::timestamptz,'2028-03-20','6.00',600,'EUR','EUR','1','Conto demo',false,true)
  `,
    [movement, batch, JSON.stringify(payment), payment.Date],
  );
  const document = (character, file_name) => ({
    file_name,
    sha256: character.repeat(64),
    storage_path: `sources/${character.repeat(64)}/${file_name}`,
    byte_size: 200,
  });
  const invoice = document("1", "demo-invoice.pdf");
  const statement = document("2", "demo-statement.pdf");
  for (const file of [invoice, statement])
    await db.query("insert into storage.objects values('finance-documents',$1)", [
      file.storage_path,
    ]);
  const payload = {
    shop_code: "SHOP",
    invoice_number: "2",
    invoice_date: "2028-02-26",
    reference_date: "2028-03-01",
    period_start: "2028-02-05",
    period_start_month_only: false,
    period_end: "2028-02-20",
    pieces: 1,
    gross_cents: 1000,
    brand_cents: 600,
    sale_lines: [
      {
        model: "Modello demo",
        size: "M",
        quantity: 1,
        unit_cents: 1000,
        gross_cents: 1000,
        brand_cents: 600,
      },
    ],
    consignment_invoice: invoice,
    consignment_statement: statement,
    payment_raw: payment,
    payment_reference_mismatch: false,
  };
  const importArchive = (archive) =>
    db.query("select private.import_finance_consignment_archive($1) as id", [
      JSON.stringify(archive),
    ]);
  const count = async (table) => (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
  await rejects(
    () => importArchive({ ...payload, payment_raw: { ...payment, Notes: "Diverso" } }),
    /no rows/i,
  );
  await rejects(
    () => importArchive({ ...payload, consignment_statement: document("3", "manca.pdf") }),
    /Originale conto vendita/,
  );
  equal(await count("public.finance_documents"), 0);
  await rejects(() => importArchive({ ...payload, pieces: 2 }), /check constraint/);
  const imported = await importArchive(payload);
  equal((await importArchive(payload)).rows, imported.rows);
  equal(await count("public.finance_documents"), 2);
  equal(await count("public.finance_consignment_archive"), 1);
  equal(await count("public.finance_import_transactions"), 1);
  equal(
    (await db.query("select payment_expected_at_capture from public.finance_consignment_archive"))
      .rows[0].payment_expected_at_capture,
    true,
  );
  await rejects(
    () => importArchive({ ...payload, payment_reference_mismatch: true }),
    /già archiviata/,
  );
  await rejects(() => importArchive({ ...payload, invoice_number: "3" }), /sovrapposti/);
  await rejects(
    () =>
      db.query("update public.finance_consignment_archive set payment_expected_at_capture=false"),
    /immutable|append-only/i,
  );
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, aal: "aal1" }),
  ]);
  await db.exec("set role authenticated");
  equal(await count("public.finance_consignment_archive"), 0);
  equal(await count("storage.objects"), 0);
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, aal: "aal2" }),
  ]);
  equal(await count("public.finance_consignment_archive"), 1);
  equal(await count("storage.objects"), 2);
  await rejects(
    () => db.query("delete from public.finance_consignment_archive"),
    /permission denied/i,
  );
  await rejects(() => importArchive(payload), /permission denied/i);
  console.log(`PASS ${checks} archivio conto vendita (PGlite).`);
} finally {
  await db.close();
}
