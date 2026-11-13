// test-db: pglite minimo 13
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  asRevisionUser,
  migration,
  payload,
  setupRevisionDatabase,
} from "./fixtures/finance-revisions.mjs";

const core = pathToFileURL(process.argv[2]);
const { PGlite } = await import(core.href);
const { pgcrypto } = await import(new URL("./contrib/pgcrypto.js", core).href);
const db = new PGlite({ extensions: { pgcrypto } });
let checks = 0;
const equal = (value, expected) => {
  assert.deepEqual(value, expected);
  checks++;
};
const rejects = async (callback, message) => {
  await assert.rejects(callback, { message });
  checks++;
};
const record = (operation, command, role = "finance") =>
  asRevisionUser(
    db,
    role,
    async () =>
      (
        await db.query("select public.record_finance_entry($1,$2) result", [
          operation,
          JSON.stringify(command),
        ])
      ).rows[0].result,
  );
try {
  await db.exec("create schema extensions;create extension pgcrypto with schema extensions;");
  await setupRevisionDatabase(db);
  await db.exec(
    "create schema storage; create table storage.objects(bucket_id text, name text); alter table storage.objects enable row level security;",
  );
  await db.exec(migration("private_finance_documents"));
  await db.exec(`create table public.manual_sale_returns (
    order_id uuid not null references public.sales_orders(id),
    finance_entry_id uuid not null unique references public.finance_entries(id)
  );`);
  await db.exec(migration("finance_conto_vendita_storico"));
  const v1 = {
    schema_version: 1,
    entry_date: "2026-03-17",
    entry_type: "expense",
    amount_cents: 3101,
    description: "Spesa sintetica",
    not_duplicate_confirmed: true,
    account_label: "Conto prova",
  };
  const operation = randomUUID();
  const prior = await record(operation, v1);
  await db.exec(migration("finance_movimenti_pianificati"));
  equal(await record(operation, v1), { ...prior, replayed: true });
  await rejects(
    () => record(randomUUID(), { ...v1, entry_date: "2099-01-31" }),
    "future_finance_entry",
  );

  const series = randomUUID();
  const v2 = {
    ...v1,
    schema_version: 2,
    entry_date: "2099-01-31",
    target_account_label: "Cassa prova",
    pending: true,
    evaluate_statistics: false,
    evaluate_budgets: false,
    tags: ["test"],
    payee: "Prova",
    notes: "Nota sintetica",
    location: "Luogo sintetico",
    entry_time: "08:30",
    repeat_interval: "monthly",
    repeat_count: 3,
  };
  await rejects(() => record(series, v2, "logistics"), "finance_access_required");
  const receipt = await record(series, v2);
  equal(await record(series, v2), { ...receipt, replayed: true });
  await rejects(() => record(series, { ...v2, repeat_count: 2 }), "idempotency_conflict");
  const saved = (
    await db.query(
      `select id, entry_date::text, pending, evaluate_statistics, evaluate_budgets,
    target_account_label, tags, entry_time::text from public.finance_entries where series_id=$1 order by entry_date`,
      [series],
    )
  ).rows;
  equal(
    saved.map((row) => row.entry_date),
    ["2099-01-31", "2099-02-28", "2099-03-31"],
  );
  equal(saved[0], {
    id: receipt.entry_id,
    entry_date: v2.entry_date,
    pending: true,
    evaluate_statistics: false,
    evaluate_budgets: false,
    target_account_label: v2.target_account_label,
    tags: v2.tags,
    entry_time: "08:30:00",
  });
  const original = (
    await db.query("select private.finance_revision_original('manual',$1) value", [
      receipt.entry_id,
    ])
  ).rows[0].value;
  equal(original.values.pending, true);
  equal(original.values.target_account, v2.target_account_label);
  const corrected = payload("manual", {
    source_id: receipt.entry_id,
    values: { ...original.values, pending: false },
  });
  const revised = await asRevisionUser(db, "finance", () =>
    db.query("select public.revise_finance_movement($1,$2) value", [
      randomUUID(),
      JSON.stringify(corrected),
    ]),
  );
  equal(revised.rows[0].value.version, 1);
  await rejects(
    () => record(randomUUID(), { ...v2, target_account_label: "conto PROVA" }),
    "invalid_finance_payload",
  );
  await rejects(() => record(randomUUID(), { ...v2, tags: { tag: 7 } }), "invalid_finance_payload");
  const invalidSeries = randomUUID();
  await rejects(
    () => record(invalidSeries, { ...v2, entry_date: "9999-12-01" }),
    "invalid_finance_payload",
  );
  equal(
    (
      await db.query("select count(*)::int count from public.finance_entries where series_id=$1", [
        invalidSeries,
      ])
    ).rows[0].count,
    0,
  );
  console.log(`PASS ${checks} movimenti pianificati (PGlite).`);
} finally {
  await db.close();
}
