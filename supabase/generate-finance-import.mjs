// Offline only. No network, database connection, credentials or real-data stdout.
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FINGERPRINT_VERSION = "budgetflow-v1-sorted-raw-core";
const HEADERS = [
  "Date",
  "Amount",
  "Source Currency",
  "Target Currency",
  "Exchange Rate",
  "Budget Book",
  "Source Account",
  "Target Account",
  "Folder",
  "Category",
  "Payee",
  "Tags",
  "Notes",
  "Pending",
];
const SHA = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (object) =>
  JSON.stringify(
    Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b, "en"))),
  );
const fail = (message) => {
  throw new Error(message);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};

export function amountToCents(value) {
  assert(
    typeof value === "string" && /^[+-]?\d+(?:\.\d{1,2})?$/.test(value),
    "Importo non valido: serve una stringa decimale esatta, massimo due decimali.",
  );
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^[+-]/, "").split(".");
  const result = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) * (negative ? -1n : 1n);
  assert(result >= -9000000000000000n && result <= 9000000000000000n, "Importo fuori limite.");
  return result.toString();
}

// Strict RFC-4180-style comma CSV: original fields, not inferred cell types.
export function parseCsv(bytes) {
  assert(bytes.byteLength <= 10 * 1024 * 1024, "Export CSV oltre il limite locale di 10 MiB.");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    fail("Export CSV non valido: UTF-8 richiesto.");
  }
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const endField = () => {
    row.push(field);
    field = "";
    closed = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else field += c;
    } else if (c === '"') {
      assert(field === "" && !closed, "Export CSV non valido: virgolette fuori campo.");
      quoted = true;
    } else if (c === ",") endField();
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
    } else {
      assert(!closed, "Export CSV non valido: testo dopo la chiusura del campo.");
      field += c;
    }
  }
  assert(!quoted, "Export CSV non valido: campo non chiuso.");
  if (field !== "" || row.length > 0 || closed) endRow();
  return rows;
}

function validDate(value) {
  return (
    typeof value === "string" &&
    DATE.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
function validTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function groups(rows, property) {
  const map = new Map();
  for (const row of rows)
    map.set(row[property], [...(map.get(row[property]) ?? []), row.source_row]);
  return [...map.values()].filter((values) => values.length > 1);
}

export function buildFinanceImport(input, { sourceBytes }) {
  assert(
    input && input.schema_version === 1 && input.source_system === "budgetflow",
    "Contratto staging non valido: atteso Budgetflow schema 1.",
  );
  assert(
    typeof input.source_file_name === "string" &&
      input.source_file_name.length <= 240 &&
      path.basename(input.source_file_name) === input.source_file_name &&
      !/[\\/\0]/.test(input.source_file_name),
    "Nome file sorgente non valido.",
  );
  assert(
    SHA.test(input.source_sha256 ?? "") && sha256(sourceBytes) === input.source_sha256,
    "Hash del file originale diverso dallo staging. Import bloccato.",
  );
  assert(
    input.source_record_ids_available === false,
    "Questo importatore gestisce soltanto export senza ID nativo; nessun ID viene inventato.",
  );
  assert(
    validTimestamp(input.extracted_at) && validDate(input.as_of_date),
    "Timestamp estrazione o data di riferimento non validi.",
  );
  assert(
    Array.isArray(input.rows) && input.rows.length >= 1 && input.rows.length <= 100000,
    "Numero righe staging non valido.",
  );
  const original = parseCsv(sourceBytes);
  assert(
    JSON.stringify(original[0]) === JSON.stringify(HEADERS),
    "Header export diverso dal contratto Budgetflow previsto.",
  );
  assert(
    original.length === input.rows.length + 1,
    "Numero righe diverso dal CSV originale. Import bloccato.",
  );
  const rows = input.rows.map((row, index) => {
    const label = `Riga sorgente ${index + 2}`;
    assert(
      row &&
        row.source_row === index + 2 &&
        row.raw &&
        typeof row.raw === "object" &&
        !Array.isArray(row.raw),
      `${label}: provenienza non valida.`,
    );
    assert(
      Object.keys(row.raw).length === HEADERS.length &&
        HEADERS.every(
          (key) =>
            typeof row.raw[key] === "string" &&
            !row.raw[key].includes("\0") &&
            row.raw[key].length <= 100000,
        ),
      `${label}: campi originali non validi.`,
    );
    assert(
      original[index + 1].length === HEADERS.length &&
        HEADERS.every((key, column) => original[index + 1][column] === row.raw[key]),
      `${label}: contenuto diverso dal CSV originale.`,
    );
    assert(row.amount_text === row.raw.Amount, `${label}: importo diverso dalla fonte.`);
    const amount_cents = amountToCents(row.amount_text);
    assert(
      row.currency === "EUR" &&
        row.target_currency === "EUR" &&
        row.raw["Source Currency"] === "EUR" &&
        row.raw["Target Currency"] === "EUR",
      `${label}: import supportato soltanto in EUR, senza conversioni.`,
    );
    assert(
      typeof row.exchange_rate_text === "string" &&
        /^1(?:\.0+)?$/.test(row.exchange_rate_text) &&
        row.exchange_rate_text === row.raw["Exchange Rate"],
      `${label}: cambio non supportato o incoerente.`,
    );
    assert(
      typeof row.account_label === "string" &&
        row.account_label.length >= 1 &&
        row.account_label.length <= 240 &&
        row.account_label === row.raw["Source Account"],
      `${label}: conto sorgente incoerente.`,
    );
    const target = row.raw["Target Account"] === "" ? null : row.raw["Target Account"];
    assert(
      row.target_account_label === target && (target === null || target.length <= 240),
      `${label}: conto destinazione incoerente.`,
    );
    const sourceIso = row.source_timestamp?.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    assert(
      row.source_timestamp === row.raw.Date &&
        validTimestamp(sourceIso) &&
        validTimestamp(row.occurred_at) &&
        Date.parse(sourceIso) === Date.parse(row.occurred_at),
      `${label}: istante non valido o diverso dalla fonte.`,
    );
    assert(
      validDate(row.transaction_date) && row.transaction_date === row.source_timestamp.slice(0, 10),
      `${label}: data locale non coerente con la fonte.`,
    );
    assert(
      ["True", "False"].includes(row.raw.Pending) &&
        row.pending_raw === row.raw.Pending &&
        row.status === (row.raw.Pending === "True" ? "pending" : "not_pending"),
      `${label}: stato pending incoerente.`,
    );
    const future = row.transaction_date > input.as_of_date;
    assert(row.future_as_of_date === future, `${label}: flag data futura incoerente.`);
    const economic = {
      source_system: "budgetflow",
      account: row.account_label,
      target_account: target,
      date: row.transaction_date,
      amount_cents,
      currency: row.currency,
      target_currency: row.target_currency,
    };
    return {
      source_row: row.source_row,
      raw_record: row.raw,
      raw_fingerprint_sha256: sha256(canonical(row.raw)),
      economic_fingerprint_sha256: sha256(canonical(economic)),
      source_timestamp: row.source_timestamp,
      occurred_at: row.occurred_at,
      transaction_date: row.transaction_date,
      amount_text: row.amount_text,
      amount_cents,
      currency: row.currency,
      target_currency: row.target_currency,
      exchange_rate_text: row.exchange_rate_text,
      account_label: row.account_label,
      target_account_label: target,
      pending: row.raw.Pending === "True",
      future_as_of_reference_date: future,
    };
  });
  const normalizedRows = rows.map(({ future_as_of_reference_date: _future, ...row }) => row);
  const payload = {
    schema_version: 1,
    source_system: "budgetflow",
    source_file_name: input.source_file_name,
    source_sha256: input.source_sha256,
    normalized_sha256: sha256(JSON.stringify(normalizedRows)),
    fingerprint_version: FINGERPRINT_VERSION,
    extracted_at: input.extracted_at,
    reference_date: input.as_of_date,
    source_record_ids_available: false,
    rows,
  };
  const report = {
    schema_version: 1,
    source_system: "budgetflow",
    source_file_name: input.source_file_name,
    source_sha256: input.source_sha256,
    normalized_sha256: payload.normalized_sha256,
    fingerprint_version: FINGERPRINT_VERSION,
    reference_date: input.as_of_date,
    rows: rows.length,
    pending_rows: rows.filter((row) => row.pending).map((row) => row.source_row),
    future_rows: rows.filter((row) => row.future_as_of_reference_date).map((row) => row.source_row),
    exact_duplicate_groups: groups(rows, "raw_fingerprint_sha256"),
    economic_candidate_groups: groups(rows, "economic_fingerprint_sha256"),
    review_status: "unreviewed",
    financial_posting_performed: false,
    inventory_updated: false,
    cross_export_policy:
      "block_entire_import_on_raw_or_economic_candidate; manual_review_required; no_automatic_deduplication",
  };
  return { payload, report };
}

export function financeImportSql(payload) {
  const literal = `E'${JSON.stringify(payload).replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
  return `-- PRIVATE FINANCE DATA: do not commit, publish or execute through a client.\n-- Owner-only, transactional, unreviewed source records; no stock or accounting posting.\nbegin;\nselect private.import_budgetflow_batch(${literal}::jsonb);\ncommit;\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(
      ["--input", "--source-file", "--output"].includes(args[i]) && args[i + 1] && !flags[args[i]],
      "Uso: node supabase/generate-finance-import.mjs --input <staging.json> --source-file <originale.csv> --output <.private/finance-staging/import.sql>",
    );
    flags[args[i]] = args[i + 1];
  }
  assert(
    Object.keys(flags).length === 3,
    "Input, file originale e output espliciti sono obbligatori.",
  );
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const allowed = path.join(projectRoot, ".private", "finance-staging");
  await mkdir(allowed, { recursive: true, mode: 0o700 });
  const allowedReal = await realpath(allowed);
  assert(allowedReal === allowed, "Directory riservata non valida: symlink non consentiti.");
  const output = path.resolve(flags["--output"]);
  assert(
    path.dirname(output) === allowedReal && output.endsWith(".sql"),
    "Output consentito soltanto come file .sql in .private/finance-staging.",
  );
  const inputBytes = await readFile(flags["--input"]);
  assert(inputBytes.byteLength <= 30 * 1024 * 1024, "Staging oltre il limite locale di 30 MiB.");
  const input = JSON.parse(inputBytes.toString("utf8"));
  assert(
    path.basename(flags["--source-file"]) === input.source_file_name,
    "Nome del file originale diverso dal contratto.",
  );
  const { payload, report } = buildFinanceImport(input, {
    sourceBytes: await readFile(flags["--source-file"]),
  });
  // Exclusive creation prevents overwriting a previously reviewed import/report.
  const reportPath = output.replace(/\.sql$/, ".report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await writeFile(output, financeImportSql(payload), { flag: "wx", mode: 0o600 });
  console.log(
    `Preparati ${payload.rows.length} record da revisionare in una directory privata. Nessuna connessione esterna o scrittura database.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
