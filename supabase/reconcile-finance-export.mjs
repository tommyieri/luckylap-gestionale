// Prepara un delta verificabile. Il comando non apre connessioni.
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BUDGETFLOW_HEADERS,
  buildFinanceImport,
  financeImportJsonLiteral,
  parseCsv,
} from "./generate-finance-import.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const shaPattern = /^[0-9a-f]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function buildExport(sourceBytes, sourceFileName, extractedAt, referenceDate) {
  const [headers, ...records] = parseCsv(sourceBytes);
  requireValue(
    JSON.stringify(headers) === JSON.stringify(BUDGETFLOW_HEADERS),
    "Intestazioni diverse dal formato BudgetFlow.",
  );
  const sourceHash = sha256(sourceBytes);
  const rows = records.map((fields, index) => {
    requireValue(fields.length === headers.length, `Riga ${index + 2}: colonne non valide.`);
    const raw = Object.fromEntries(headers.map((key, column) => [key, fields[column]]));
    const date = raw.Date.slice(0, 10);
    return {
      source_row: index + 2,
      raw,
      source_timestamp: raw.Date,
      occurred_at: raw.Date.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"),
      transaction_date: date,
      amount_text: raw.Amount,
      currency: raw["Source Currency"],
      target_currency: raw["Target Currency"],
      exchange_rate_text: raw["Exchange Rate"],
      account_label: raw["Source Account"],
      target_account_label: raw["Target Account"] || null,
      pending_raw: raw.Pending,
      status: raw.Pending === "True" ? "pending" : "not_pending",
      future_as_of_date: date > referenceDate,
    };
  });
  return buildFinanceImport(
    {
      schema_version: 1,
      source_system: "budgetflow",
      source_file_name: sourceFileName,
      source_sha256: sourceHash,
      extracted_at: extractedAt,
      as_of_date: referenceDate,
      source_record_ids_available: false,
      rows,
    },
    { sourceBytes },
  ).payload;
}

function dateIndependentHash(raw) {
  return sha256(
    Object.keys(raw)
      .filter((key) => key !== "Date")
      .sort()
      .map((key) => `${Buffer.byteLength(raw[key], "utf8")}:${raw[key]}`)
      .join(""),
  );
}

const baselineRows = `
  select t.id::text, t.raw_fingerprint_sha256 as raw, t.economic_fingerprint_sha256 as economic,
         t.transaction_date::text as date, coalesce(r.version, 0) as version,
         coalesce(r.deleted, false) as deleted, coalesce(r.value_snapshot->>'date', t.transaction_date::text) as effective_date,
         encode(sha256(convert_to((select string_agg(octet_length(value)::text || ':' || value, '' order by key collate "C")
           from jsonb_each_text(t.raw_record) where key <> 'Date'), 'UTF8')), 'hex') as without_date
    from public.finance_import_transactions t
    left join public.finance_revision_current r on r.source_kind = 'budgetflow' and r.source_id = t.id`;

export const budgetFlowBaselineSql = `
  with baseline as (${baselineRows})
  select coalesce(jsonb_agg(to_jsonb(baseline) order by id collate "C"), '[]'::jsonb) as snapshot
    from baseline;`;

const registerRows = `
  with source as (
    select id::text, 'manual'::text as kind, entry_date as day,
           case entry_type when 'expense' then -amount_cents else amount_cents end as cents,
           account_label as account, category, coalesce((to_jsonb(e)->>'pending')::boolean, false) as pending,
           exists(select 1 from public.finance_entry_voids v where v.finance_entry_id=e.id) as voided
      from public.finance_entries e
    union all
    select id::text, 'payment', (occurred_at at time zone 'Europe/Rome')::date,
           amount_cents, case when source_kind='manual_declaration' and method='cash' then 'Cash' end,
           'Vendite', false, false from public.order_payments
  ), register as (
    select s.id, s.kind, coalesce(r.value_snapshot->>'date', s.day::text) as date,
           coalesce((r.value_snapshot->>'amount_cents')::bigint *
             case when r.value_snapshot->>'direction'='expense' then -1 else 1 end, s.cents)::text as cents,
           case when r.id is null then nullif(btrim(s.account), '') else r.value_snapshot->>'account' end as account,
           case when r.id is null then s.category else r.value_snapshot->>'category' end as category,
           coalesce((r.value_snapshot->>'pending')::boolean, s.pending) as pending,
           coalesce(r.version, 0) as version
      from source s
      left join public.finance_revision_current r on r.source_kind=s.kind and r.source_id::text=s.id
     where not coalesce(r.deleted, s.voided)
  )`;

const registerOutput = `select coalesce(jsonb_agg(to_jsonb(register) order by id collate "C", kind collate "C"), '[]'::jsonb) from register`;
const registerDigest = `encode(sha256(convert_to((${registerOutput})::text, 'UTF8')), 'hex')`;
export const budgetFlowRegisterSql = `${registerRows}
  select jsonb_build_object('rows', (${registerOutput}), 'digest', ${registerDigest}) as snapshot;`;

const identity = ({ id, raw, economic }) => `${id}:${raw}:${economic}`;
const ledgerHash = (baseline) => sha256(baseline.map(identity).sort().join(","));
const indexBy = (rows, key) => {
  const index = new Map();
  for (const row of rows) {
    const value = key(row);
    const matches = index.get(value);
    if (matches) matches.push(row);
    else index.set(value, [row]);
  }
  return index;
};

export function reconcileBudgetFlow({
  sourceBytes,
  sourceFileName,
  extractedAt,
  referenceDate,
  baseline,
  register,
  review,
}) {
  requireValue(
    Array.isArray(baseline) &&
      baseline.every(
        (r) =>
          r &&
          uuidPattern.test(r.id) &&
          [r.raw, r.economic, r.without_date].every((hash) => shaPattern.test(hash)) &&
          typeof r.deleted === "boolean" &&
          Number.isInteger(r.version) &&
          r.version >= 0 &&
          [r.date, r.effective_date].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
      ) &&
      new Set(baseline.map((r) => r.id)).size === baseline.length,
    "Snapshot della banca dati non valido.",
  );
  const source = buildExport(sourceBytes, sourceFileName, extractedAt, referenceDate);
  const byRaw = indexBy(baseline, (row) => row.raw);
  const byEconomic = indexBy(baseline, (row) => row.economic);
  const matched = new Set();
  const remaining = [];
  const identicalRows = [];
  for (const row of source.rows) {
    const match = byRaw.get(row.raw_fingerprint_sha256)?.find((item) => !matched.has(item.id));
    if (match) {
      matched.add(match.id);
      identicalRows.push({ source_row: row.source_row, existing_id: match.id });
    } else remaining.push(row);
  }
  const historical = baseline.filter((r) => !matched.has(r.id));
  const byOtherFields = indexBy(historical, (row) => row.without_date);
  const remainingByOtherFields = indexBy(remaining, (row) => dateIndependentHash(row.raw_record));
  const dateChanges = [];
  const ambiguousRows = [];
  const additions = [];
  for (const row of remaining) {
    const signature = dateIndependentHash(row.raw_record);
    const dateCandidates = byOtherFields.get(signature) ?? [];
    const economicCandidates = byEconomic.get(row.economic_fingerprint_sha256) ?? [];
    if (
      dateCandidates.length === 1 &&
      remainingByOtherFields.get(signature).length === 1 &&
      !economicCandidates.length
    ) {
      const previous = dateCandidates[0];
      matched.add(previous.id);
      dateChanges.push({
        source_row: row.source_row,
        existing_id: previous.id,
        old_date: previous.date,
        new_date: row.transaction_date,
        effective_date: previous.effective_date,
        deleted: previous.deleted,
        expected_version: previous.version,
      });
    } else if (dateCandidates.length || economicCandidates.length) {
      ambiguousRows.push(row.source_row);
    } else additions.push(row);
  }

  const registerCandidates = register ? findRegisterCandidates(additions, register) : [];
  const report = {
    source_file_name: sourceFileName,
    source_sha256: source.source_sha256,
    ledger_sha256: ledgerHash(baseline),
    reference_date: referenceDate,
    total_rows: source.rows.length,
    identical: identicalRows,
    date_changes: dateChanges,
    ambiguous_source_rows: ambiguousRows,
    missing_existing_ids: baseline.filter((row) => !matched.has(row.id)).map((row) => row.id),
    ...(register
      ? { register_sha256: register.digest, register_candidates: registerCandidates }
      : {}),
    additions: reportAdditions(additions),
  };

  if (!review) return { report, sql: null };
  requireValue(
    !report.ambiguous_source_rows.length && !report.missing_existing_ids.length,
    "Riconcilia prima le corrispondenze ambigue e le righe storiche senza abbinamento.",
  );
  requireValue(
    review.source_sha256 === report.source_sha256 &&
      review.ledger_sha256 === report.ledger_sha256 &&
      Array.isArray(review.keep_existing) &&
      review.keep_existing.length === dateChanges.length &&
      dateChanges.every((change) =>
        review.keep_existing.some(
          (decision) =>
            decision?.source_row === change.source_row &&
            decision.existing_id === change.existing_id &&
            decision.expected_version === change.expected_version &&
            typeof decision.reason === "string" &&
            decision.reason.trim().length > 0,
        ),
      ),
    "Rivedi ogni differenza di data e conferma esplicitamente quali revisioni conservare.",
  );
  const decisions = review.register_matches ?? [];
  requireValue(
    Array.isArray(decisions) &&
      decisions.length === registerCandidates.length &&
      (!register || register.digest === review.register_sha256) &&
      new Set(decisions.map((d) => d?.source_row)).size === decisions.length &&
      new Set(decisions.filter((d) => d?.existing_id).map((d) => d.existing_id)).size ===
        decisions.filter((d) => d?.existing_id).length &&
      registerCandidates.every(({ source_row, candidates }) =>
        decisions.some(
          (d) =>
            d?.source_row === source_row &&
            typeof d.reason === "string" &&
            d.reason.trim().length > 0 &&
            (d.existing_id === null || candidates.some((match) => match.id === d.existing_id)),
        ),
      ),
    "Rivedi ogni possibile doppione del registro e conferma le righe da importare o collegare.",
  );
  const excluded = new Set(decisions.filter((d) => d.existing_id).map((d) => d.source_row));
  const deltaRows = additions.filter((row) => !excluded.has(row.source_row));
  requireValue(
    deltaRows.length > 0,
    "Tutte le righe sono già riconciliate: nessun delta da importare.",
  );

  const csvLine = (fields) => fields.map((value) => `"${value.replaceAll('"', '""')}"`).join(",");
  const deltaBytes = Buffer.from(
    [
      csvLine(BUDGETFLOW_HEADERS),
      ...deltaRows.map((row) => csvLine(BUDGETFLOW_HEADERS.map((key) => row.raw_record[key]))),
    ].join("\r\n") + "\r\n",
  );
  const derivedName = `${path.basename(sourceFileName, path.extname(sourceFileName)).slice(0, 180)}-delta.csv`;
  const delta = buildExport(deltaBytes, derivedName, extractedAt, referenceDate);
  return {
    report: {
      ...report,
      additions: reportAdditions(deltaRows),
      keep_existing: review.keep_existing,
      register_matches: decisions,
      delta_sha256: delta.source_sha256,
    },
    sql: buildReviewedSql(delta, report.ledger_sha256, dateChanges, register?.digest),
  };
}

function reportAdditions(rows) {
  return rows.map((row, index) => ({
    source_row: row.source_row,
    delta_row: index + 2,
    pending: row.pending,
    future: row.future_as_of_reference_date,
  }));
}

function findRegisterCandidates(additions, register) {
  requireValue(
    Array.isArray(register.rows) &&
      shaPattern.test(register.digest) &&
      register.rows.every(
        (r) =>
          r &&
          uuidPattern.test(r.id) &&
          ["manual", "payment"].includes(r.kind) &&
          /^-?\d+$/.test(r.cents) &&
          /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
          typeof r.pending === "boolean" &&
          [r.account, r.category].every((field) => field === null || typeof field === "string") &&
          Number.isInteger(r.version) &&
          r.version >= 0,
      ),
    "Snapshot del registro movimenti non valido.",
  );
  const key = (account, cents) => JSON.stringify([account?.toLocaleLowerCase("it"), cents]);
  const indexed = indexBy(register.rows, (r) => key(r.account, r.cents));
  return additions
    .map((row) => ({
      source_row: row.source_row,
      candidates: (indexed.get(key(row.account_label, row.amount_cents)) ?? [])
        .filter((r) => Math.abs(Date.parse(r.date) - Date.parse(row.transaction_date)) <= 604800000)
        .map(({ id, kind, date, category, pending }) => ({ id, kind, date, category, pending })),
    }))
    .filter(({ candidates }) => candidates.length > 0);
}

function buildReviewedSql(delta, snapshotHash, dateChanges, registerHash) {
  const reviewed = financeImportJsonLiteral(
    dateChanges
      .map(({ existing_id, expected_version }) => ({ existing_id, expected_version }))
      .sort((a, b) => a.existing_id.localeCompare(b.existing_id)),
  );
  const payload = financeImportJsonLiteral(delta);
  const registerGuard = registerHash
    ? `
  lock table public.finance_entries, public.finance_entry_voids, public.order_payments,
             public.finance_movement_revisions in share mode;
  ${registerRows}
  select ${registerDigest} into snapshot_hash;
  if snapshot_hash is distinct from '${registerHash}' then
    raise exception 'Il registro movimenti è cambiato dopo la riconciliazione.';
  end if;
`
    : "";
  return `-- Delta BudgetFlow riservato. Eseguire come proprietario DB solo dopo approvazione.
begin;
do $guard$
declare item record; snapshot_hash text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('luckylap.finance_import', 0));
  if exists (
    select 1 from public.finance_import_batches
     where source_system = 'budgetflow' and source_sha256 = '${delta.source_sha256}'
  ) then return; end if;

  select encode(sha256(convert_to(coalesce(
    string_agg(id::text || ':' || raw_fingerprint_sha256 || ':' || economic_fingerprint_sha256, ',' order by id::text collate "C"), ''
  ), 'UTF8')), 'hex') into snapshot_hash from public.finance_import_transactions;
  if snapshot_hash is distinct from '${snapshotHash}' then
    raise exception 'Lo storico BudgetFlow è cambiato dopo la riconciliazione.';
  end if;

  for item in select * from jsonb_to_recordset(${reviewed}::jsonb) as v(existing_id uuid, expected_version int)
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'luckylap.finance.revision.source.budgetflow.' || item.existing_id::text, 0));
    if item.expected_version is distinct from coalesce((
      select r.version from public.finance_revision_current r
       where r.source_kind = 'budgetflow' and r.source_id = item.existing_id
    ), 0) then
      raise exception 'Una revisione Finance è cambiata dopo la riconciliazione.';
    end if;
  end loop;
  ${registerGuard}
end $guard$;
select private.import_budgetflow_batch(${payload}::jsonb) as batch_id;
commit;
`;
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === "--baseline-query") {
    process.stdout.write(budgetFlowBaselineSql);
    return;
  }
  if (process.argv.length === 3 && process.argv[2] === "--register-query") {
    process.stdout.write(budgetFlowRegisterSql);
    return;
  }
  const flags = new Map();
  const supported = [
    "--source",
    "--baseline",
    "--extracted-at",
    "--as-of",
    "--output",
    "--register",
    "--review",
  ];
  for (let i = 2; i < process.argv.length; i += 2) {
    const [key, value] = process.argv.slice(i, i + 2);
    requireValue(supported.includes(key) && value && !flags.has(key), "Argomenti non validi.");
    flags.set(key, value);
  }
  requireValue(
    supported.slice(0, 6).every((key) => flags.has(key)),
    "Servono --source, --baseline, --extracted-at, --as-of, --output e --register. --review genera il delta SQL.",
  );
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const privateDirectory = path.join(projectRoot, ".private", "finance-staging");
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  const output = path.resolve(flags.get("--output"));
  requireValue(
    (await realpath(privateDirectory)) === privateDirectory &&
      path.dirname(output) === privateDirectory &&
      /^[a-z0-9_-]+$/i.test(path.basename(output)),
    "Usa un prefisso file dentro .private/finance-staging.",
  );
  const readPrivateJson = async (key) => JSON.parse(await readFile(flags.get(key), "utf8"));
  const { report, sql } = reconcileBudgetFlow({
    sourceBytes: await readFile(flags.get("--source")),
    sourceFileName: path.basename(flags.get("--source")),
    baseline: await readPrivateJson("--baseline"),
    register: await readPrivateJson("--register"),
    extractedAt: flags.get("--extracted-at"),
    referenceDate: flags.get("--as-of"),
    review: flags.has("--review") ? await readPrivateJson("--review") : undefined,
  });
  await writeFile(`${output}.report.json`, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  if (sql) await writeFile(`${output}.sql`, sql, { mode: 0o600, flag: "wx" });
  console.log(
    `${report.total_rows} righe esaminate: ${report.identical.length} già presenti, ${report.additions.length} nuove, ${report.date_changes.length} date diverse, ${report.ambiguous_source_rows.length} ambigue, ${report.missing_existing_ids.length} storiche da abbinare.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    // JSON parse errors can include source content; the CLI only shows our own messages.
    console.error(
      error instanceof SyntaxError ? "JSON di riconciliazione non valido." : error.message,
    );
    process.exitCode = 1;
  });
}
