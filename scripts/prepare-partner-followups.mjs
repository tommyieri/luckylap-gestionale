import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { extname } from "node:path";

const require = createRequire(import.meta.url);
let swc;
function transpile(source) {
  if (!swc) {
    // Solo binari Next già installati: nessun loader con fallback/download o telemetria.
    const triple = `${process.platform}-${process.arch}`;
    for (const suffix of ["", "-gnu", "-musl", "-msvc"]) {
      try {
        const installed = require(`@next/swc-${triple}${suffix}`);
        if (typeof installed.transformSync === "function") {
          swc = installed;
          break;
        }
      } catch {
        // Una variante non installata non viene scaricata.
      }
    }
    if (!swc) throw new Error("Compilatore locale non disponibile.");
  }
  return swc.transformSync(
    source,
    false,
    Buffer.from(
      JSON.stringify({
        jsc: { target: "es2022", parser: { syntax: "typescript" } },
        module: { type: "es6" },
      }),
    ),
  ).code;
}

// Riusa i controlli del gestionale, senza compilare copie e senza caricare credenziali.
// Esecuzione: node --conditions=react-server scripts/prepare-partner-followups.mjs ...
registerHooks({
  resolve(specifier, context, nextResolve) {
    // Next incorpora il marker senza installare un package server-only alla radice.
    // Manteniamo la stessa condizione del compilatore: senza react-server il marker lancia.
    if (specifier === "server-only")
      return nextResolve(
        context.conditions.includes("react-server")
          ? "next/dist/compiled/server-only/empty.js"
          : "next/dist/compiled/server-only/index.js",
        context,
      );
    if (context.parentURL?.endsWith(".ts") && specifier.startsWith(".") && !extname(specifier))
      return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".ts")) return nextLoad(url, context);
    // Alcune dipendenze pure usano parameter properties: lo strip-only implicito di Node
    // non basta. Il compilatore Next già installato non scrive artefatti.
    const source = readFileSync(new URL(url), "utf8");
    return { shortCircuit: true, format: "module", source: transpile(source) };
  },
});

const USAGE =
  "node --conditions=react-server scripts/prepare-partner-followups.mjs --snapshot SNAPSHOT.json --texts TESTI.json --signature-config FIRMA_PRIVATA.json --output LOTTO.sql --day YYYY-MM-DD";
const FLAGS = ["snapshot", "texts", "signature-config", "output", "day"];
const SNAPSHOT_KEYS = [
  "id",
  "version",
  "partner_id",
  "co",
  "name",
  "porsche_community",
  "flow_template",
  "contact_id",
  "contact_version",
  "address_sha256",
  "partner_version",
  "rules_version",
  "number",
  "next_due_on",
  "language",
  "register",
  "timezone",
  "country",
  "first_subject",
  "first_sent_at",
  "first_body",
  "previous_bodies",
];
const TEXT_KEYS = [
  "co",
  "conversation_id",
  "number",
  "body",
  "research_text",
  "sources",
  "verified_on",
];
const REGISTERS = { it: ["voi", "lei"], en: ["you"], de: ["sie"], fr: ["vous"], es: ["usted"] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const SHA256 = /^[0-9a-f]{64}$/u;
const HEADER_CONTROL = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u;
const TEXT_CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u2028\u2029]/u;
const MAX_ROWS = 100;
const MIB = 1024 * 1024;

class PreparationError extends Error {
  constructor(code, co) {
    super(code);
    this.code = code;
    this.co = co;
  }
}
const fail = (code, co) => {
  throw new PreparationError(code, co);
};
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) =>
  record(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const integer = (value, min = 1, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const uuid = (value) => typeof value === "string" && UUID.test(value) && value !== ZERO_UUID;
const coValid = (value) => integer(value, 1, 99_999);
const text = (value, max) =>
  typeof value === "string" &&
  value.isWellFormed() &&
  value.trim().length > 0 &&
  [...value].length <= max &&
  !TEXT_CONTROL.test(value);

function parseArguments(args) {
  if (args.length !== FLAGS.length * 2) fail("argomenti_non_validi");
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const key = flag.startsWith("--") ? flag.slice(2) : "";
    if (
      !FLAGS.includes(key) ||
      Object.hasOwn(parsed, key) ||
      typeof args[index + 1] !== "string" ||
      !args[index + 1] ||
      args[index + 1].startsWith("--") ||
      /[\x00-\x1f\x7f]/u.test(args[index + 1])
    )
      fail("argomenti_non_validi");
    parsed[key] = args[index + 1];
  }
  return parsed;
}

function readJson(path, maxBytes, privateFile = false) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.size < 1 ||
      stat.size > maxBytes ||
      (privateFile && (stat.mode & 0o077) !== 0)
    )
      fail(privateFile ? "config_firma_non_privata_o_non_valida" : "file_input_non_valido");
    const bytes = readFileSync(descriptor);
    if (bytes.byteLength > maxBytes) fail("file_input_non_valido");
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      fail("json_input_non_valido");
    }
  } catch (error) {
    if (error instanceof PreparationError) throw error;
    fail("lettura_input_fallita");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function publicHttps(value) {
  if (
    typeof value !== "string" ||
    !value.isWellFormed() ||
    value.length > 2000 ||
    /[\s\x00-\x1f\x7f\\]/u.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    // Nessun fetch: l'ufficialità è una verifica editoriale, non una deduzione dal dominio.
    // IP, localhost e porte arbitrarie non sono fonti pubbliche ammesse dal lotto.
    return (
      value.startsWith("https://") &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      url.hostname.length <= 253 &&
      url.hostname
        .split(".")
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)) &&
      url.hostname.includes(".") &&
      !/^(?:\d+\.){3}\d+$/u.test(url.hostname) &&
      !/(?:^|\.)(?:localhost|local|internal|invalid)$/u.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function validInstant(value, isCalendarDay) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.test(
      value,
    ) &&
    isCalendarDay(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value))
  );
}

function validateSnapshot(snapshot, day, helpers) {
  const { isCalendarDay, addDays, instantDay } = helpers;
  if (
    !exact(snapshot, ["items"]) ||
    !Array.isArray(snapshot.items) ||
    snapshot.items.length > MAX_ROWS
  )
    fail("snapshot_non_valido");
  const seen = Object.fromEntries(
    ["co", "id", "partner_id", "contact_id", "address_sha256"].map((key) => [key, new Set()]),
  );
  for (const row of snapshot.items) {
    const co = coValid(row?.co) ? row.co : undefined;
    if (
      !exact(row, SNAPSHOT_KEYS) ||
      !coValid(row.co) ||
      ![row.id, row.partner_id, row.contact_id].every(uuid) ||
      ![row.version, row.partner_version, row.contact_version].every((value) => integer(value)) ||
      !integer(row.rules_version, 1, 2_147_483_647) ||
      !integer(row.number, 1, 4) ||
      typeof row.address_sha256 !== "string" ||
      !SHA256.test(row.address_sha256) ||
      typeof row.flow_template !== "boolean" ||
      typeof row.porsche_community !== "boolean" ||
      !text(row.name, 300) ||
      HEADER_CONTROL.test(row.name) ||
      !text(row.country, 200) ||
      HEADER_CONTROL.test(row.country) ||
      !Object.hasOwn(REGISTERS, row.language) ||
      !REGISTERS[row.language].includes(row.register) ||
      !text(row.timezone, 80) ||
      HEADER_CONTROL.test(row.timezone) ||
      !text(row.first_subject, 300) ||
      HEADER_CONTROL.test(row.first_subject) ||
      !text(row.first_body, 65_536) ||
      !validInstant(row.first_sent_at, isCalendarDay) ||
      !isCalendarDay(row.next_due_on) ||
      !Array.isArray(row.previous_bodies) ||
      row.previous_bodies.length !== row.number - 1 ||
      !row.previous_bodies.every((body) => text(body, 65_536))
    )
      fail("snapshot_riga_non_valida", co);
    try {
      new Intl.DateTimeFormat("it", { timeZone: row.timezone });
    } catch {
      fail("snapshot_fuso_non_valido", co);
    }
    const firstDay = instantDay(row.first_sent_at);
    const earliestDue = firstDay && addDays(firstDay, [7, 17, 45, 90][row.number - 1]);
    if (
      !firstDay ||
      !isCalendarDay(earliestDue) ||
      row.next_due_on < earliestDue ||
      row.next_due_on > addDays(day, 1)
    )
      fail("snapshot_scadenza_non_valida", co);
    for (const key of Object.keys(seen)) {
      if (seen[key].has(row[key])) fail("snapshot_duplicato", co);
      seen[key].add(row[key]);
    }
  }
  return new Map(snapshot.items.map((row) => [row.co, row]));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function operationUuid(payload) {
  // UUID v8: hash SHA-256 con namespace applicativo. Firma/telefono e intero CAS nel preimage.
  const bytes = createHash("sha256")
    .update("luckylap.partner.followup.preparation.v1\0", "utf8")
    .update(canonical(payload), "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function buildBatch(rows, snapshot, phone, day, helpers) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS) fail("testi_non_validi");
  const seen = new Set();
  const ids = new Set();
  const batch = [];
  for (const row of rows) {
    const co = coValid(row?.co) ? row.co : undefined;
    if (
      !exact(row, TEXT_KEYS) ||
      !coValid(row.co) ||
      !uuid(row.conversation_id) ||
      !integer(row.number, 1, 4) ||
      !text(row.body, 8000) ||
      row.body !== row.body.trim() ||
      row.body.split("\n").length < 3 ||
      !text(row.research_text, 59_900) ||
      !helpers.isCalendarDay(row.verified_on) ||
      row.verified_on !== day ||
      !Array.isArray(row.sources) ||
      row.sources.length < 1 ||
      row.sources.length > 40 ||
      !row.sources.every(publicHttps) ||
      new Set(row.sources).size !== row.sources.length
    )
      fail("testo_riga_non_valido", co);
    if (seen.has(row.co) || ids.has(row.conversation_id)) fail("testo_duplicato", co);
    seen.add(row.co);
    ids.add(row.conversation_id);
    const context = snapshot.get(row.co);
    if (!context || context.id !== row.conversation_id || context.number !== row.number)
      fail("testo_snapshot_non_coincidente", co);
    const normalized = (body) => body.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (
      [context.first_body, ...context.previous_bodies].some(
        (body) => normalized(body) === normalized(row.body),
      )
    )
      fail("testo_gia_usato", co);
    const subject = helpers.partnerAssistantFollowupSubject(context.first_subject);
    if (!subject) fail("oggetto_thread_non_valido", co);
    const signature = context.flow_template
      ? helpers.partnerAssistantTemplateSignature(context.language, phone)
      : helpers.partnerAssistantSignature(context.language, phone);
    const draft = {
      language: context.language,
      subject,
      body: row.body,
      signature,
      rulesVersion: context.rules_version,
    };
    const checked = helpers.checkPartnerAssistantFollowupDraft(draft, {
      phone,
      currentRulesVersion: context.rules_version,
      porscheCommunity: context.porsche_community,
      names: [context.name],
      template: context.flow_template,
      firstSubject: context.first_subject,
    });
    if (!checked.ok) fail(`controlli_testo_${checked.failures.join("_")}`, co);
    const payload = {
      schema_version: 1,
      conversation_id: context.id,
      expected_version: context.version,
      number: context.number,
      partner_version: context.partner_version,
      contact_version: context.contact_version,
      address_sha256: context.address_sha256,
      rules_version: context.rules_version,
      language: context.language,
      subject,
      body: row.body,
      signature,
      research_text: `Data di verifica dichiarata nel lotto: ${day}.\n\n${row.research_text}`,
      sources: row.sources,
    };
    batch.push({ partner_id: context.partner_id, operation_id: operationUuid(payload), payload });
  }
  // Stesso ordine dei lock partner per tutti i lotti. Nessun identificatore SQL dall'input.
  return batch.sort((a, b) => a.partner_id.localeCompare(b.partner_id));
}

function buildSql(batch) {
  const json = JSON.stringify(batch);
  let suffix = 0;
  let tag;
  do {
    tag = `$partner_followups_${suffix++}$`;
  } while (json.includes(tag));
  return `-- Preparazione editoriale offline Codex: nessun invio, nessun cambio di mode.
-- Questo file esegue una prova e termina con ROLLBACK.
-- Solo dopo dry-run riuscito e autorizzazione esplicita si puo sostituire l'ultima riga con COMMIT.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
WITH data AS MATERIALIZED (
  SELECT entry.partner_id, entry.operation_id, entry.payload
  FROM jsonb_to_recordset(${tag}${json}${tag}::jsonb)
    AS entry(partner_id uuid, operation_id uuid, payload jsonb)
  ORDER BY entry.partner_id
), config AS MATERIALIZED (
  SELECT (SELECT handoff_to FROM private.partner_assistant_config WHERE singleton LIMIT 1) AS handoff_to
)
SELECT jsonb_agg(private.save_partner_followup_draft_as_founder(
  config.handoff_to, data.operation_id, data.payload
)) AS results
FROM data CROSS JOIN config;
ROLLBACK;
`;
}

function writeExclusive(path, sql) {
  let descriptor;
  let complete = false;
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, sql, "utf8");
    complete = true;
  } catch {
    fail("scrittura_output_fallita");
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
      if (!complete) unlinkSync(path);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(USAGE);
    return;
  }
  const paths = parseArguments(args);
  const helpers = {
    ...(await import("../src/lib/partner-assistant/followup-compose.ts")),
    ...(await import("../src/lib/partner-assistant/checks.ts")),
    ...(await import("../src/lib/partner-assistant/template.ts")),
    ...(await import("../src/lib/partner/dates.ts")),
  };
  if (!helpers.isCalendarDay(paths.day) || paths.day === "2100-12-31") fail("giorno_non_valido");
  const signatureConfig = readJson(paths["signature-config"], 4096, true);
  if (
    !exact(signatureConfig, ["phone"]) ||
    typeof signatureConfig.phone !== "string" ||
    !/^\+[0-9]( ?[0-9]){7,14}$/u.test(signatureConfig.phone)
  )
    fail("config_firma_non_valida");
  const snapshot = readJson(paths.snapshot, 32 * MIB);
  const contexts = validateSnapshot(snapshot, paths.day, helpers);
  const rows = readJson(paths.texts, 8 * MIB);
  const batch = buildBatch(rows, contexts, signatureConfig.phone, paths.day, helpers);
  writeExclusive(paths.output, buildSql(batch));
  console.log(
    JSON.stringify({
      snapshot: contexts.size,
      preparati: batch.length,
      co: rows.map((row) => row.co).sort((a, b) => a - b),
      transazione: "rollback",
    }),
  );
}

try {
  await main();
} catch (error) {
  console.error(
    JSON.stringify({
      error: error instanceof PreparationError ? error.code : "preparazione_fallita",
      ...(error instanceof PreparationError && coValid(error.co) ? { co: error.co } : {}),
    }),
  );
  process.exitCode = 1;
}
