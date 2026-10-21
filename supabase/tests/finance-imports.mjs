// Synthetic data only. Embedded PostgreSQL with MOCKED Auth; no cloud services.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { amountToCents, buildFinanceImport, financeImportSql, parseCsv } from '../generate-finance-import.mjs';

let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };
const throws = (action, pattern, message) => { assert.throws(action, pattern, message); checks += 1; };
const HEADERS = ['Date', 'Amount', 'Source Currency', 'Target Currency', 'Exchange Rate', 'Budget Book', 'Source Account', 'Target Account', 'Folder', 'Category', 'Payee', 'Tags', 'Notes', 'Pending'];
const clone = value => JSON.parse(JSON.stringify(value));
function fixture(rawRows = [
  { date: '2026-10-20', amount: '-12.30', pending: 'False', notes: "Synthetic 'quote';\nDROP TABLE public.stock_items; -- \\ literal\r\nSecond synthetic line" },
  { date: '2026-10-21', amount: '10.01', pending: 'True' },
  { date: '2026-10-23', amount: '1.00', pending: 'False' },
]) {
  const rows = rawRows.map((row, index) => {
    const timestamp = `${row.date}T09:00:00+0200`;
    const raw = Object.fromEntries(HEADERS.map(key => [key, '']));
    Object.assign(raw, { Date: timestamp, Amount: row.amount, 'Source Currency': 'EUR', 'Target Currency': 'EUR', 'Exchange Rate': '1.0', 'Budget Book': 'Synthetic test only', 'Source Account': 'Test account', Folder: 'Test source folder', Category: 'Test category', Notes: row.notes ?? '', Pending: row.pending });
    return { source_row: index + 2, raw, account_label: raw['Source Account'], target_account_label: null, transaction_date: row.date, source_timestamp: timestamp, occurred_at: `${row.date}T09:00:00+02:00`, amount_text: row.amount, currency: 'EUR', target_currency: 'EUR', exchange_rate_text: '1.0', status: row.pending === 'True' ? 'pending' : 'not_pending', pending_raw: row.pending, future_as_of_date: row.date > '2026-10-21' };
  });
  const escape = value => `"${value.replaceAll('"', '""')}"`;
  const sourceBytes = Buffer.from(`\uFEFF${HEADERS.map(escape).join(',')}\r\n${rows.map(row => HEADERS.map(key => escape(row.raw[key])).join(',')).join('\r\n')}\r\n`);
  return { sourceBytes, input: { schema_version: 1, source_system: 'budgetflow', source_file_name: 'synthetic-fixture.csv', source_sha256: createHash('sha256').update(sourceBytes).digest('hex'), extracted_at: '2026-10-21T10:00:00Z', as_of_date: '2026-10-21', source_record_ids_available: false, rows } };
}

for (const [source, cents] of [['-12.30', '-1230'], ['10.01', '1001'], ['0.1', '10'], ['-0.00', '0'], ['+1.00', '100'], ['90000000000000', '9000000000000000']]) equal(amountToCents(source), cents, 'Exact integer cents, original sign');
for (const bad of [1.1, '1,00', '1.001', '1e3', 'NaN', 'Infinity', ' 1.00', '90000000000000.01']) throws(() => amountToCents(bad), /Importo/, 'Reject ambiguous or inexact amount');
equal(parseCsv(Buffer.from('a,b\r\n"line\nfeed","escaped ""quote"""\r\n')), [['a', 'b'], ['line\nfeed', 'escaped "quote"']], 'CSV preserves embedded newline and quotes');
throws(() => parseCsv(Buffer.from('a,b\n"unclosed')), /CSV/, 'Malformed CSV rejected');
const original = fixture();
const built = buildFinanceImport(original.input, original);
equal(built.payload.rows[0].raw_record.Notes, original.input.rows[0].raw.Notes, 'Embedded CSV line breaks survive normalization');
const flattenedNotes = clone(original.input);
flattenedNotes.rows[0].raw.Notes = flattenedNotes.rows[0].raw.Notes.replace(/[\r\n]/g, '');
throws(() => buildFinanceImport(flattenedNotes, original), /contenuto diverso dal CSV originale/, 'Flattened multiline Notes are rejected by the original-byte gate');
equal(built.payload.rows.map(row => row.amount_cents), ['-1230', '1001', '100'], 'No sign inversion');
equal(built.payload.rows.map(row => [row.pending, row.future_as_of_reference_date]), [[false, false], [true, false], [false, true]], 'Pending and future are separate source flags');
equal(built.report.review_status, 'unreviewed', 'No automatic posting');
equal(built.report.financial_posting_performed, false, 'No implicit accounting entry');
equal(built.report.inventory_updated, false, 'Import does not claim inventory changes');
const changedTime = clone(original.input); changedTime.extracted_at = '2026-10-22T10:00:00Z'; changedTime.as_of_date = '2026-10-24'; changedTime.rows.forEach(row => { row.future_as_of_date = false; });
equal(buildFinanceImport(changedTime, original).payload.normalized_sha256, built.payload.normalized_sha256, 'Re-extraction/reference date does not change file identity');
for (const mutate of [
  input => { input.source_sha256 = '0'.repeat(64); },
  input => { input.rows.pop(); },
  input => { input.rows[0].raw.Notes = 'tampered'; },
  input => { input.rows[0].amount_text = '999'; },
  input => { input.rows[2].future_as_of_date = false; },
  input => { input.rows[0].status = 'pending'; },
  input => { input.rows[0].transaction_date = '2026-02-30'; },
  input => { input.rows[0].currency = 'USD'; },
  input => { input.source_record_ids_available = true; },
]) {
  const input = clone(original.input); mutate(input);
  throws(() => buildFinanceImport(input, original), /./, 'Invalid or source-inconsistent staging rejected');
}
const exactDuplicates = fixture([{ date: '2026-10-20', amount: '2.00', pending: 'False' }, { date: '2026-10-20', amount: '2.00', pending: 'False' }]);
equal(buildFinanceImport(exactDuplicates.input, exactDuplicates).report.exact_duplicate_groups, [[2, 3]], 'Within-file duplicates retained and reported, never silently removed');

if (!process.argv[2]) throw new Error('Passare @electric-sql/pglite/dist/index.js come dipendenza di test esterna.');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const migration = name => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
try {
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated;`);
  await db.exec(migration('20261021114636_initial_schema.sql'));
  await db.exec(migration('20261021114642_finance_imports.sql'));
  checks += 2;
  const roles = ['founder', 'production', 'finance', 'logistics', 'consultant', 'outsider', 'inactive', 'production_without_flag'];
  const ids = Object.fromEntries(roles.map((name, index) => [name, `10000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`]));
  for (const name of roles) {
    await db.query('insert into auth.users(id) values ($1)', [ids[name]]);
    if (name === 'outsider') continue;
    await db.query('insert into public.profiles(user_id, display_name) values ($1, $2)', [ids[name], name]);
    await db.query('insert into public.memberships(user_id,role,active,finance_access) values ($1,$2,$3,$4)', [ids[name], name === 'inactive' ? 'finance' : name === 'production_without_flag' ? 'production' : name, name !== 'inactive', ['production', 'finance', 'inactive'].includes(name)]);
  }
  await db.exec("insert into public.stock_items(kind,sku,name,unit_cost_eur,list_price_eur) values ('product','SYNTHETIC-ONLY','Test product',7.12,15.34)");
  const stockBefore = (await db.query('select * from public.stock_items')).rows;
  await db.exec(financeImportSql(built.payload));
  const batch = (await db.query('select * from public.finance_import_batches')).rows[0];
  equal(batch.review_status, 'unreviewed', 'Batch remains unreviewed');
  equal(batch.source_row_count, 3, 'All source rows imported');
  equal((await db.query('select amount_cents::text,amount_text,pending,future_as_of_reference_date,review_status from public.finance_import_transactions order by source_row')).rows, [
    { amount_cents: '-1230', amount_text: '-12.30', pending: false, future_as_of_reference_date: false, review_status: 'unreviewed' },
    { amount_cents: '1001', amount_text: '10.01', pending: true, future_as_of_reference_date: false, review_status: 'unreviewed' },
    { amount_cents: '100', amount_text: '1.00', pending: false, future_as_of_reference_date: true, review_status: 'unreviewed' },
  ], 'Exact amounts, source flags and no automatic posting');
  equal((await db.query('select raw_record from public.finance_import_transactions order by source_row')).rows.map(row => row.raw_record), original.input.rows.map(row => row.raw), 'SQL quoting preserves full raw CSV without execution');
  const auditBeforeRetry = (await db.query("select count(*)::int n from public.audit_logs where table_name like 'finance_import_%'")).rows[0].n;
  equal(auditBeforeRetry, 4, 'Every batch/transaction insert audited');
  const retry = await db.query('select private.import_budgetflow_batch($1::jsonb) as id', [JSON.stringify(buildFinanceImport(changedTime, original).payload)]);
  equal(retry.rows[0].id, batch.id, 'Same file is idempotent even at a later extraction time');
  equal((await db.query('select count(*)::int n from public.finance_import_transactions')).rows[0].n, 3, 'Retry does not duplicate transactions');
  equal((await db.query("select count(*)::int n from public.audit_logs where table_name like 'finance_import_%'")).rows[0].n, auditBeforeRetry, 'Retry does not add misleading audit events');
  async function rejectOwner(payload, pattern) {
    let error;
    try { await db.query('select private.import_budgetflow_batch($1::jsonb)', [JSON.stringify(payload)]); } catch (caught) { error = caught; }
    check(Boolean(error) && pattern.test(error.message), 'Owner import rejects inconsistent/overlapping payload');
  }
  const conflict = clone(built.payload); conflict.normalized_sha256 = 'f'.repeat(64);
  await rejectOwner(conflict, /normalizzazione diversa/);
  const overlapping = fixture([{ date: '2026-10-20', amount: '-12.30', pending: 'False', notes: 'Different export with altered note' }]);
  await rejectOwner(buildFinanceImport(overlapping.input, overlapping).payload, /sovrapposizione/);
  equal((await db.query('select count(*)::int n from public.finance_import_batches')).rows[0].n, 1, 'Overlap blocks the whole new batch');
  equal((await db.query('select count(*)::int n from public.finance_import_transactions')).rows[0].n, 3, 'Overlap never auto-deduplicates or doubles existing rows');
  const disjoint = fixture([{ date: '2026-10-19', amount: '3.45', pending: 'False' }]);
  await db.query('select private.import_budgetflow_batch($1::jsonb)', [JSON.stringify(buildFinanceImport(disjoint.input, disjoint).payload)]);
  equal((await db.query('select count(*)::int n from public.finance_import_batches')).rows[0].n, 2, 'Disjoint file can be staged as a new batch');
  equal((await db.query('select * from public.stock_items')).rows, stockBefore, 'Inventory costs and product records are unchanged');
  equal((await db.query('select count(*)::int n from public.stock_movements')).rows[0].n, 0, 'No stock movements created');
  equal((await db.query('select count(*)::int n from public.finance_entries')).rows[0].n, 0, 'No blend into manual accounting entries');

  async function asUser(name, aal, action, role = 'authenticated') {
    await db.exec(`begin; set local role ${role};`);
    try { await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: ids[name], aal, user_metadata: { role: 'founder' } })]); return await action(); }
    finally { await db.exec('rollback;'); }
  }
  async function denied(name, aal, sql, params = [], role) {
    let error; try { await asUser(name, aal, () => db.query(sql, params), role); } catch (caught) { error = caught; }
    check(error?.code === '42501', `${name}/${aal}: client mutation or import denied`);
  }
  for (const name of roles) for (const aal of ['aal1', 'aal2']) {
    const eligible = aal === 'aal2' && ['founder', 'production', 'finance'].includes(name);
    await asUser(name, aal, async () => {
      equal((await db.query('select count(*)::int n from public.finance_import_batches')).rows[0].n, eligible ? 2 : 0, `${name}/${aal}: batch RLS`);
      equal((await db.query('select count(*)::int n from public.finance_import_transactions')).rows[0].n, eligible ? 4 : 0, `${name}/${aal}: transaction RLS`);
    });
    await denied(name, aal, 'select private.import_budgetflow_batch($1::jsonb)', [JSON.stringify(built.payload)]);
    await denied(name, aal, 'delete from public.finance_import_transactions');
    await denied(name, aal, "update public.finance_import_batches set review_status='unreviewed'");
    await denied(name, aal, 'insert into public.finance_import_transactions(batch_id) values ($1)', [batch.id]);
  }
  for (const table of ['finance_import_batches', 'finance_import_transactions']) await denied('outsider', 'aal1', `select * from public.${table}`, [], 'anon');
  let appendError; try { await db.query('delete from public.finance_import_transactions'); } catch (error) { appendError = error; }
  equal(appendError?.code, '42501', 'Imported ledger is append-only even for ordinary owner writes');
  await db.query('update public.memberships set active=false where user_id=$1', [ids.finance]);
  await asUser('finance', 'aal2', async () => equal((await db.query('select count(*)::int n from public.finance_import_transactions')).rows[0].n, 0, 'Current membership revocation applies immediately'));
  console.log(`PASS ${checks} Finance checks with synthetic fixtures and mocked Auth. Real Supabase/JWT/MFA runtime and concurrent connections remain unverified.`);
} finally { await db.close(); }
