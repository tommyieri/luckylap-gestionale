#!/usr/bin/env node
// Esegue gli harness SQL di supabase/tests con un solo comando: npm run test:db
//
// - Harness PGlite: girano sempre. PostgreSQL è incorporato, Auth è simulato.
// - Harness PostgreSQL 17 reale: girano solo se LUCKYLAP_PG_BIN indica la
//   cartella bin di PostgreSQL 17. Altrimenti risultano "saltati", mai in silenzio.
//
// Nessun DSN e nessun accesso cloud: ogni harness reale crea e rimuove un
// cluster usa e getta in /private/tmp, su socket privata.
// Esce con codice 1 se un harness fallisce o esegue meno controlli del minimo,
// se un file manca o se in supabase/tests compare un file eseguibile non
// registrato.
//
// Registrazione di un harness: nelle due mappe qui sotto (gli harness già
// esistenti) oppure, per ogni harness nuovo, con una riga tra le prime 10 del
// file stesso, così questo runner non cambia a ogni lavoro:
//
//   // test-db: pglite minimo 155
//   // test-db: postgres minimo 14
//
// La modalità decide gli argomenti, come nelle mappe; il minimo è un intero
// maggiore di 0. Un file eseguibile senza riga, non elencato e non escluso
// resta un errore («Harness non elencato»). Un file elencato qui sotto (o
// escluso) che ha anche la riga è un errore: una sola registrazione per file.
// Gli harness registrati con la riga girano dopo quelli delle mappe, in ordine
// di nome.
import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testsDirectory = join(root, "supabase", "tests");

// Ogni harness ha un minimo di controlli: i numeri del run completo del
// 21 ottobre 2026, gli stessi citati nei documenti. Se un harness ne esegue
// meno, il runner fallisce: un controllo perso in silenzio non deve passare.
// Se la riduzione è voluta, aggiornare insieme il minimo e i documenti.

// Argomento: percorso assoluto di @electric-sql/pglite/dist/index.js.
const PGLITE_HARNESSES = new Map([
  ["validate-local.mjs", 207],
  ["finance-imports.mjs", 152],
  ["sales-ecosystem.mjs", 445],
  ["finance-documents.mjs", 25],
  ["packaging-materials.mjs", 125],
  ["packaging-automation.mjs", 73],
  ["assets-development.mjs", 109],
  ["finance-work.mjs", 177],
  ["shopify-catalog.mjs", 103],
  ["shopify-receiver.mjs", 163],
  ["shopify-scheduler.mjs", 173],
  ["consignment.mjs", 145],
]);

// Argomenti: cartella bin di PostgreSQL 17 e percorso assoluto di pg/lib/index.js.
// area-passwords, sales-concurrency e shopify-ecosystem scrivono anche
// un'evidenza in .private/deployment-proof/ (cartella ignorata da git).
const POSTGRES_HARNESSES = new Map([
  ["sales-concurrency.mjs", 39],
  ["packaging-concurrency.mjs", 6],
  ["area-passwords.mjs", 161],
  ["shopify-scheduler-concurrency.mjs", 15],
  ["shopify-ecosystem.mjs", 702],
]);

// File eseguibili in supabase/tests che non sono harness, con il motivo.
const EXCLUDED = new Map([
  ["sales-concurrency.sh", "involucro di sales-concurrency.mjs, che il runner esegue già"],
]);

// Riga di registrazione in testa al file (vedi il commento all'inizio).
const HEADER_LINES = 10;
const REGISTRATION_LINE = /^\s*\/\/\s*test-db:(.*)$/;
const REGISTRATION_VALUE = /^\s*(pglite|postgres) minimo (\d+)\s*$/;

// Estensioni considerate eseguibili. La cartella fixtures contiene solo dati.
const EXECUTABLE_EXTENSIONS = new Set([".mjs", ".js", ".cjs", ".ts", ".mts", ".cts", ".sh"]);
const DATA_DIRECTORIES = new Set(["fixtures"]);

const MODE_LABEL = { pglite: "PGlite", postgres: "PostgreSQL 17" };
const results = [];
const problems = [];

function say(message = "") {
  process.stdout.write(`${message}\n`);
}

// Annotazioni visibili nella pagina dei controlli di GitHub Actions.
function annotate(level, message) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  say(
    `::${level}::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`,
  );
}

// File eseguibili in supabase/tests e nelle sottocartelle, tranne fixtures.
// Restituisce percorsi relativi con la barra /, come negli elenchi qui sopra.
function executableFiles(directory, prefix = "") {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      if (!(prefix === "" && DATA_DIRECTORIES.has(entry.name))) {
        found.push(...executableFiles(join(directory, entry.name), `${name}/`));
      }
    } else if (EXECUTABLE_EXTENSIONS.has(extname(entry.name))) {
      found.push(name);
    }
  }
  return found;
}

// Legge la riga «// test-db: …» tra le prime righe del file.
// Restituisce null senza riga, { error } se la riga non è valida.
function headerRegistration(name) {
  const lines = readFileSync(join(testsDirectory, name), "utf8").split(/\r?\n/, HEADER_LINES);
  const found = lines.map((line) => line.match(REGISTRATION_LINE)).filter(Boolean);
  if (found.length === 0) return null;
  if (found.length > 1)
    return { error: `supabase/tests/${name} ha più righe «// test-db:» in testa: ne serve una.` };
  const value = found[0][1].match(REGISTRATION_VALUE);
  if (!value) {
    return {
      error:
        `Riga di registrazione non valida in supabase/tests/${name}: «${found[0][0].trim()}». ` +
        "Formato: «// test-db: pglite minimo N» oppure «// test-db: postgres minimo N».",
    };
  }
  const minimum = Number(value[2]);
  if (!Number.isSafeInteger(minimum) || minimum < 1) {
    return {
      error: `Minimo di controlli non valido in supabase/tests/${name}: deve essere un intero maggiore di 0.`,
    };
  }
  return { mode: value[1], minimum };
}

// Controlla gli elenchi e i file; restituisce gli harness registrati con la riga in testa.
function checkInventory() {
  const registered = { pglite: new Map(), postgres: new Map() };
  const listed = [...PGLITE_HARNESSES.keys(), ...POSTGRES_HARNESSES.keys()];
  const duplicates = listed.filter(
    (name) => (PGLITE_HARNESSES.has(name) && POSTGRES_HARNESSES.has(name)) || EXCLUDED.has(name),
  );
  for (const name of new Set(duplicates))
    problems.push(`${name} compare in più di un elenco di scripts/test-db.mjs.`);
  for (const [name, minimum] of [...PGLITE_HARNESSES, ...POSTGRES_HARNESSES]) {
    if (!Number.isInteger(minimum) || minimum < 1) {
      problems.push(
        `Minimo di controlli non valido per ${name} in scripts/test-db.mjs: deve essere un intero maggiore di 0.`,
      );
    }
  }
  for (const name of executableFiles(testsDirectory).sort()) {
    const header = headerRegistration(name);
    if (header?.error) {
      problems.push(header.error);
      continue;
    }
    if (listed.includes(name) || EXCLUDED.has(name)) {
      if (header) {
        problems.push(
          `supabase/tests/${name} è elencato in scripts/test-db.mjs e ha anche la riga «// test-db:». Tenere una sola registrazione.`,
        );
      }
      continue;
    }
    if (header) registered[header.mode].set(name, header.minimum);
    else {
      problems.push(
        `Harness non elencato: supabase/tests/${name}. Aggiungere in testa al file la riga «// test-db: pglite minimo N» (o «postgres»), oppure escluderlo in scripts/test-db.mjs con un motivo.`,
      );
    }
  }
  return registered;
}

function resolvePglite() {
  let path;
  try {
    path = fileURLToPath(import.meta.resolve("@electric-sql/pglite"));
  } catch {
    return { error: "Dipendenza @electric-sql/pglite non trovata. Eseguire npm ci." };
  }
  if (!path.endsWith(`${sep}dist${sep}index.js`) || !existsSync(path)) {
    return { error: `Percorso PGlite inatteso: ${path}` };
  }
  return { path };
}

function resolvePg() {
  let path;
  try {
    path = createRequire(import.meta.url).resolve("pg");
  } catch {
    return { error: "Dipendenza pg non trovata. Eseguire npm ci." };
  }
  if (!path.endsWith(`${sep}lib${sep}index.js`) || !existsSync(path)) {
    return { error: `Percorso pg inatteso: ${path}` };
  }
  return { path };
}

// Controlli preliminari sul runtime PostgreSQL 17 indicato da LUCKYLAP_PG_BIN.
function checkPostgresBin(binDirectory) {
  if (!isAbsolute(binDirectory))
    return `LUCKYLAP_PG_BIN deve essere un percorso assoluto: ${binDirectory}`;
  for (const program of ["postgres", "initdb", "pg_ctl"]) {
    if (!existsSync(join(binDirectory, program)))
      return `In ${binDirectory} manca il programma ${program}.`;
  }
  const version = spawnSync(join(binDirectory, "postgres"), ["--version"], { encoding: "utf8" });
  if (version.status !== 0 || !/PostgreSQL\) 17\./.test(version.stdout)) {
    return `Serve PostgreSQL 17. Risposta di postgres --version: ${(version.stdout || version.stderr || "").trim() || "nessuna"}`;
  }
  // Gli harness passano questa cartella a initdb -L.
  const share = resolve(binDirectory, "../share/postgresql");
  if (!existsSync(join(share, "postgres.bki"))) {
    return `Manca ${share}/postgres.bki: gli harness la usano con initdb -L. Su Debian/Ubuntu collegare ${share} a /usr/share/postgresql/17.`;
  }
  // Gli harness creano i cluster temporanei proprio qui.
  try {
    accessSync("/private/tmp", constants.W_OK);
  } catch {
    return "Gli harness creano i cluster in /private/tmp, che non esiste o non è scrivibile. Su Linux crearla con permessi 1777.";
  }
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return "PostgreSQL non parte come root: eseguire con un utente normale.";
  }
  return null;
}

function runHarness(name, mode, minimum, args) {
  const file = join(testsDirectory, name);
  say("");
  say(`==> ${name} (${MODE_LABEL[mode]}${fromHeader.has(name) ? ", riga in testa" : ""})`);
  if (!existsSync(file)) {
    problems.push(`File mancante: supabase/tests/${name}.`);
    results.push({ name, mode, outcome: "mancante", checks: null, seconds: null });
    return Promise.resolve();
  }
  // Su macOS, senza LC_ALL il postmaster si ferma subito ("postmaster became
  // multithreaded during startup"). Due harness già impostano LC_ALL=C da soli.
  const env = mode === "postgres" ? { ...process.env, LC_ALL: "C" } : process.env;
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let finished = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    const finish = (code, signal, spawnError) => {
      if (finished) return;
      finished = true;
      const seconds = (Date.now() - started) / 1000;
      const lines = [...stdout.matchAll(/^(PASS|FAIL) (\d+)\b/gm)];
      const last = lines.at(-1);
      const checks = last ? Number(last[2]) : null;
      let outcome = "superato";
      if (spawnError) outcome = `fallito (${spawnError.message})`;
      else if (signal) outcome = `fallito (segnale ${signal})`;
      else if (code !== 0) outcome = `fallito (codice ${code})`;
      else if (lines.some((match) => match[1] === "FAIL")) outcome = "fallito (riga FAIL)";
      else if (!last) outcome = "fallito (nessun esito PASS)";
      else if (checks === 0) outcome = "fallito (0 controlli)";
      else if (checks < minimum) {
        outcome = `fallito (minimo ${minimum})`;
        problems.push(
          `${name} ha eseguito ${checks} controlli, meno del minimo di ${minimum}. Se la riduzione è voluta, ` +
            `aggiornare insieme il minimo ${minimumPlace(name)} e i documenti che citano il numero.`,
        );
      }
      if (outcome !== "superato") annotate("error", `${name}: ${outcome}`);
      results.push({ name, mode, outcome, checks, minimum, seconds });
      done();
    };
    child.once("error", (error) => finish(null, null, error));
    child.once("close", (code, signal) => finish(code, signal, null));
  });
}

function skip(harnesses, mode, outcome) {
  for (const [name, minimum] of harnesses)
    results.push({ name, mode, outcome, checks: null, minimum, seconds: null });
}

function printSummary() {
  const header = ["Harness", "Modalità", "Esito", "Controlli", "Durata"];
  const rows = results.map((r) => [
    r.name,
    MODE_LABEL[r.mode],
    r.outcome,
    r.checks === null ? "-" : String(r.checks),
    r.seconds === null ? "-" : `${r.seconds.toFixed(1)} s`,
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells) =>
    cells
      .map((cell, column) =>
        column === 3 ? cell.padStart(widths[column]) : cell.padEnd(widths[column]),
      )
      .join("  ")
      .trimEnd();
  say("");
  say("Riepilogo harness SQL");
  say(line(header));
  say(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) say(line(row));
  say("");
  for (const mode of ["pglite", "postgres"]) {
    const own = results.filter((r) => r.mode === mode);
    const passed = own.filter((r) => r.outcome === "superato");
    const skipped = own.filter((r) => r.outcome === "saltato").length;
    const total = passed.reduce((sum, r) => sum + (r.checks ?? 0), 0);
    const parts = [`${passed.length} superati`];
    if (skipped) parts.push(`${skipped} saltati`);
    if (own.length - passed.length - skipped)
      parts.push(`${own.length - passed.length - skipped} non superati`);
    say(`${MODE_LABEL[mode]}: ${parts.join(", ")}; ${total} controlli.`);
  }
  const grown = results.filter((r) => r.outcome === "superato" && r.checks > r.minimum);
  if (grown.length > 0) {
    const list = grown
      .map((r) => `${r.name} ${r.checks} (minimo ${r.minimum}, ${minimumPlace(r.name)})`)
      .join(", ");
    say(`Più controlli del minimo: ${list}. Alzare il minimo.`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const markdown = [
      "### Harness SQL",
      "",
      `| ${header.join(" | ")} |`,
      `| ${header.map(() => "---").join(" | ")} |`,
      ...rows.map((row) => `| ${row.join(" | ")} |`),
      "",
      ...problems.map((problem) => `- ${problem}`),
      "",
    ].join("\n");
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    } catch {
      // Il riepilogo di GitHub è facoltativo.
    }
  }
}

const registered = checkInventory();
const fromHeader = new Set([...registered.pglite.keys(), ...registered.postgres.keys()]);
const minimumPlace = (name) =>
  fromHeader.has(name) ? `nella riga in testa a supabase/tests/${name}` : "in scripts/test-db.mjs";
const pgliteHarnesses = new Map([...PGLITE_HARNESSES, ...registered.pglite]);
const postgresHarnesses = new Map([...POSTGRES_HARNESSES, ...registered.postgres]);

const pglite = resolvePglite();
if (pglite.error) {
  problems.push(pglite.error);
  skip(pgliteHarnesses, "pglite", "non eseguito");
} else {
  say(`PGlite: ${relative(root, pglite.path)}`);
  for (const [name, minimum] of pgliteHarnesses)
    await runHarness(name, "pglite", minimum, [pglite.path]);
}

const binDirectory = process.env.LUCKYLAP_PG_BIN?.trim();
if (!binDirectory) {
  skip(postgresHarnesses, "postgres", "saltato");
  say("");
  say(
    `Saltati ${postgresHarnesses.size} harness PostgreSQL 17 reale: ${[...postgresHarnesses.keys()].join(", ")}.`,
  );
  say("Per eseguirli impostare LUCKYLAP_PG_BIN con la cartella bin di PostgreSQL 17.");
  annotate(
    "notice",
    `Saltati ${postgresHarnesses.size} harness PostgreSQL 17 reale: LUCKYLAP_PG_BIN non impostata.`,
  );
} else {
  const pg = resolvePg();
  const error = pg.error ?? checkPostgresBin(binDirectory);
  if (error) {
    problems.push(error);
    skip(postgresHarnesses, "postgres", "non eseguito");
  } else {
    say("");
    say(`PostgreSQL 17: ${binDirectory}`);
    say(`pg: ${relative(root, pg.path)}`);
    for (const [name, minimum] of postgresHarnesses) {
      await runHarness(name, "postgres", minimum, [binDirectory, pg.path]);
    }
  }
}

printSummary();
for (const problem of problems) {
  process.stderr.write(`ERRORE: ${problem}\n`);
  annotate("error", problem);
}
const failed = results.some((r) => r.outcome !== "superato" && r.outcome !== "saltato");
if (failed || problems.length > 0) {
  process.stderr.write("Harness SQL: non superato. Vedere gli errori sopra.\n");
  process.exitCode = 1;
} else {
  say("Harness SQL: tutto superato.");
}
