#!/usr/bin/env node
// Generatore offline dell'import della ricerca Partner (spec 02 §3; 00-sequenza §4 P2, passi 4-6).
//
// Uso:
//   node supabase/generate-partner-import.mjs --partner-repo "<checkout di luckylap-partner>" \
//     --output-dir .private/partner-import [--batch-bytes 40000]
//
// Legge un checkout pulito del repository Partner (site/data/partners.json,
// research/bozze/varianti.json, CONTESTO.md) e scrive nella cartella di output:
//   - <data>-<sha8>-NN.sql: un lotto per file, select private.stage_partner_research(…, '<sha>'),
//     con lo SHA-256 del lotto: il database non registra un testo arrivato alterato;
//   - <data>-<sha8>-apply.sql: select private.apply_partner_research(…) con lo SHA-256 di ogni lotto;
//   - <data>-<sha8>.report.json: conteggi e codici, nessun recapito e nessun testo.
// <data> è la data della ricerca (campo generated), <sha8> l'inizio di normalized_sha256.
// Ogni .sql è al massimo di --batch-bytes byte (predefinito 40000).
//
// Nessuna rete, nessuna connessione al database, nessuna credenziale. Su stdout e stderr solo
// conteggi, codici dei contatti e nomi dei campi: mai email, telefoni o testi. I .sql contengono
// tutti i recapiti: la cartella è 0700, i file 0600 creati in modo esclusivo, e vanno cancellati
// dopo l'applicazione (resta il resoconto).
//
// normalized_sha256 è lo SHA-256 dei dati normalizzati (intestazione, CONTESTO.md e contatti),
// non degli SHA dei lotti: ogni lotto contiene normalized_sha256, quindi la definizione della
// spec sarebbe circolare. Il database verifica lo SHA-256 di ogni lotto contro il file apply.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_BATCH_BYTES = 40000;
export const MIN_BATCH_BYTES = 2000;
// stage_partner_research rifiuta testi oltre 1 MiB e import oltre 100 lotti.
export const MAX_BATCH_BYTES = 1000000;
export const MAX_BATCHES = 100;
export const WINDOWS = [
  "subito",
  "dicembre_gennaio",
  "febbraio_marzo",
  "aprile_giugno",
  "secondo_semestre_2027",
];
// Mesi dopo la data della ricerca per i contatti senza mese (02 §3, punto 3).
export const WINDOW_OFFSET = {
  subito: 1,
  dicembre_gennaio: 2,
  febbraio_marzo: 4,
  aprile_giugno: 6,
  secondo_semestre_2027: 9,
};
export const RESEARCH_KEYS = [
  "why",
  "description",
  "idea",
  "pitch",
  "hero",
  "when",
  "route",
  "date_note",
  "application",
  "cost",
  "followers",
  "flags",
  "lang",
  "score",
  "eu",
  "sources",
  "extra",
];
// [slot nel gestionale, campo di partners.json]
export const SLOTS = [
  ["email", "email"],
  ["phone", "phone"],
  ["whatsapp", "whatsapp"],
  ["instagram", "ig"],
  ["form", "form"],
  ["brand_page", "brand_page"],
  ["web", "web"],
];
const SECTIONS = ["vendita", "eventi", "collab"];
const PRIORITIES = ["alta", "media", "bassa"];
const CHANNELS = ["email", "form", "ig", "phone", "web"];
const APPROACHES = ["vendita", "evento", "collab", "su_misura", "media"];
const VARIANT_CHANNELS = ["email", "form", "dm", "phone"];
const LANGUAGES = ["en", "de", "fr", "it", "es"];
const LOOKBOOKS = ["negozi", "eventi", "collab", "porsche_club", "club"];
// Limiti di partner_message_variants (02 §2.2), in caratteri come char_length di PostgreSQL.
const VARIANT_TEXTS = [
  ["to", 500],
  ["cc", 500],
  ["subject", 300],
  ["body", 8000],
  ["follow_up", 4000],
  ["confirm_email", 4000],
  ["gist_it", 2000],
  ["notes_it", 4000],
  ["form_fields_it", 4000],
];
const SOURCE = "luckylap-partner";
const KEY = /^[A-Za-z0-9]{1,20}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const HTTP_URL = /^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i;
// Come partner_text: niente caratteri di controllo tranne tab, a capo e ritorno a capo. Lo zero
// non entra in jsonb.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const FILES = {
  partners: "site/data/partners.json",
  variants: "research/bozze/varianti.json",
  context: "CONTESTO.md",
};

export class PartnerImportError extends Error {}
const fail = (message) => {
  throw new PartnerImportError(message);
};
const check = (condition, message) => {
  if (!condition) fail(message);
};
export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const chars = (value) => [...value].length;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sortKeys = (value) =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : isObject(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sortKeys(value[key])]),
        )
      : value;
const canonical = (value) => JSON.stringify(sortKeys(value));

function realDate(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === value &&
    value >= "2000-01-01" &&
    value <= "2100-12-31"
  );
}

// Nessun carattere di controllo in tutto il contatto, anche nei testi della ricerca.
function controlFree(value) {
  if (typeof value === "string") return !CONTROL.test(value);
  if (Array.isArray(value)) return value.every(controlFree);
  if (isObject(value))
    return Object.entries(value).every(([key, item]) => !CONTROL.test(key) && controlFree(item));
  return true;
}

function contactMonth(lead, generated, where) {
  const month = lead.month ?? "";
  check(typeof month === "string", `${where}: mese di contatto non valido.`);
  if (month !== "") {
    check(
      MONTH.test(month) && realDate(`${month}-01`),
      `${where}: mese di contatto non valido (atteso AAAA-MM).`,
    );
    return `${month}-01`;
  }
  const [year, monthNumber] = generated.split("-").map(Number);
  const total = year * 12 + monthNumber - 1 + WINDOW_OFFSET[lead.window];
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

function field(lead, key, max, where, { trim = false, min = 0 } = {}) {
  const value = lead[key];
  check(typeof value === "string", `${where}: campo ${key} mancante o non testuale.`);
  const result = trim ? value.trim() : value;
  check(
    chars(result) >= min && chars(result) <= max,
    `${where}: campo ${key} oltre i limiti (${min}-${max} caratteri).`,
  );
  return result;
}

function optionalText(lead, key, where) {
  const value = lead[key] ?? "";
  check(typeof value === "string", `${where}: campo ${key} non testuale.`);
  return value.trim();
}

function enumValue(value, allowed, where, label) {
  check(typeof value === "string" && allowed.includes(value), `${where}: ${label} non valido.`);
  return value;
}

function optionalDate(lead, key, where) {
  const value = lead[key] ?? "";
  if (value === "") return null;
  check(realDate(value), `${where}: ${key} non è una data reale.`);
  return value;
}

function normalizeVariant(variant, where) {
  check(isObject(variant), `${where}: variante non valida.`);
  const approach = enumValue(variant.approach, APPROACHES, where, "approccio della variante");
  const at = `${where}, variante ${approach}`;
  const lookbook = variant.lookbook ?? "";
  const result = {
    approach,
    channel: enumValue(variant.channel, VARIANT_CHANNELS, at, "canale"),
    language: enumValue(variant.language, LANGUAGES, at, "lingua"),
    lookbook: lookbook === "" ? null : enumValue(lookbook, LOOKBOOKS, at, "lookbook"),
  };
  for (const [key, max] of VARIANT_TEXTS) result[key] = field(variant, key, max, at);
  // Stesso ordine delle chiavi del contratto di private.partner_research_entry.
  return {
    approach: result.approach,
    channel: result.channel,
    language: result.language,
    to: result.to,
    cc: result.cc,
    lookbook: result.lookbook,
    subject: result.subject,
    body: result.body,
    follow_up: result.follow_up,
    confirm_email: result.confirm_email,
    gist_it: result.gist_it,
    notes_it: result.notes_it,
    form_fields_it: result.form_fields_it,
  };
}

function normalizeLead(lead, index, generated, listed) {
  check(isObject(lead), `Contatto n. ${index + 1}: non è un oggetto.`);
  check(
    typeof lead.id === "string" && KEY.test(lead.id),
    `Contatto n. ${index + 1}: codice non valido.`,
  );
  const where = `Contatto ${lead.id}`;
  check(controlFree(lead), `${where}: caratteri di controllo nei testi.`);
  const name = field(lead, "name", 240, where, { trim: true, min: 1 });
  check(!/[\r\n]/.test(name), `${where}: il nome va su una riga sola.`);
  check(
    Array.isArray(lead.sections) &&
      lead.sections.length >= 1 &&
      lead.sections.length <= 3 &&
      lead.sections.every((section) => SECTIONS.includes(section)) &&
      new Set(lead.sections).size === lead.sections.length,
    `${where}: sezioni non valide.`,
  );
  enumValue(lead.window, WINDOWS, where, "periodo del sito");
  check(
    Number.isSafeInteger(lead.co) && lead.co >= 1 && lead.co <= 99999,
    `${where}: CO del sito non valido.`,
  );
  const eventStartsOn = optionalDate(lead, "date_start", where);
  const eventEndsOn = optionalDate(lead, "date_end", where);
  check(
    eventEndsOn === null || (eventStartsOn !== null && eventEndsOn >= eventStartsOn),
    `${where}: date dell'evento non coerenti.`,
  );
  check(
    lead.email_ok === undefined || typeof lead.email_ok === "boolean",
    `${where}: email_ok non booleano.`,
  );
  const sources = lead.sources ?? [];
  check(
    Array.isArray(sources) &&
      sources.every((url) => typeof url === "string" && chars(url) <= 2048 && HTTP_URL.test(url)),
    `${where}: le fonti devono essere indirizzi http(s).`,
  );

  const research = {};
  for (const key of RESEARCH_KEYS) if (key in lead) research[key] = lead[key];
  if (listed && listed.skipped_it !== undefined) {
    check(typeof listed.skipped_it === "string", `${where}: skipped_it non testuale.`);
    research.skipped_it = listed.skipped_it;
  }
  check(
    Buffer.byteLength(JSON.stringify(research), "utf8") <= 65536,
    `${where}: testi della ricerca oltre 64 KB.`,
  );

  const contacts = [];
  for (const [slot, key] of SLOTS) {
    const value = optionalText(lead, key, where);
    if (value === "") continue;
    // Testo libero come nella ricerca: il valore pulito lo calcola il database
    // (private.partner_link_value); quelli senza valore pulito sono nel resoconto.
    check(chars(value) <= 500, `${where}: recapito ${slot} oltre 500 caratteri.`);
    contacts.push({ slot, value, verified: slot === "email" ? lead.email_ok === true : false });
  }

  const variants = lead.variants ?? [];
  check(Array.isArray(variants) && variants.length <= 5, `${where}: varianti non valide.`);
  // 00-sequenza §5, 02-9: il campo draft non si importa; un draft senza varianti è un errore.
  check(
    lead.draft === undefined || lead.draft === null || variants.length > 0,
    `${where}: ha un draft ma nessuna variante. Generare le varianti con la skill messaggi, poi rilanciare python3 tools/build_data.py.`,
  );
  const normalizedVariants = variants.map((variant) => normalizeVariant(variant, where));
  check(
    new Set(normalizedVariants.map((variant) => variant.approach)).size ===
      normalizedVariants.length,
    `${where}: due varianti con lo stesso approccio.`,
  );

  return {
    source_key: lead.id,
    name,
    city: field(lead, "city", 240, where, { trim: true }),
    country: field(lead, "country", 120, where, { trim: true }),
    type_label: field(lead, "type", 120, where, { trim: true }),
    sections: [...lead.sections],
    priority: enumValue(lead.priority, PRIORITIES, where, "priorità"),
    contact_month: contactMonth(lead, generated, where),
    event_starts_on: eventStartsOn,
    event_ends_on: eventEndsOn,
    preferred_channel: enumValue(lead.channel, CHANNELS, where, "canale preferito"),
    research,
    contacts,
    variants: normalizedVariants,
  };
}

// Specchio di private.partner_link_value, solo per il resoconto: i recapiti senza valore pulito
// non hanno il pulsante nella pagina.
export function linkValue(slot, value) {
  if (slot === "email") {
    const match = value.match(/([A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24})/);
    return match && /^[^@\s]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/.test(match[1])
      ? match[1]
      : null;
  }
  if (slot === "phone" || slot === "whatsapp") {
    const match = value.match(/(\+?[0-9][0-9 ().-]{3,}[0-9])/);
    if (!match) return null;
    const digits = `${match[1].startsWith("+") ? "+" : ""}${match[1].replace(/[^0-9]/g, "")}`;
    return /^\+?[0-9]{5,20}$/.test(digits) ? digits : null;
  }
  if (slot === "instagram") {
    let handle = value.match(/(?:^|[^A-Za-z0-9_.@/])@([A-Za-z0-9_.]{1,30})/)?.[1];
    if (!handle) {
      handle = value.match(/instagram\.com\/([A-Za-z0-9_.]{1,30})/i)?.[1];
      if (
        handle &&
        ["p", "reel", "reels", "explore", "stories", "tv", "accounts"].includes(
          handle.toLowerCase(),
        )
      )
        handle = undefined;
    }
    const clean = handle?.replace(/\.+$/, "");
    return clean && /^[A-Za-z0-9_.]{1,30}$/.test(clean) ? `@${clean}` : null;
  }
  const url = value.trim();
  return chars(url) <= 2048 && /^https?:\/\/[^\s/@?#]+([/?#]\S*)?$/.test(url) ? url : null;
}

// Quotatura dollaro assente dal testo: deriva dallo SHA del lotto, così il file è stabile.
function dollarTag(text, batchSha) {
  let tag = `partner_${batchSha.slice(0, 16)}`;
  while (text.includes(`$${tag}$`)) tag += "x";
  return tag;
}
function stageSql(text, index, count, normalized, batchSha) {
  const tag = dollarTag(text, batchSha);
  return (
    `-- Import Partner ${normalized.slice(0, 8)}, lotto ${index} di ${count}. Dati privati con i recapiti: ` +
    `non committare, cancellare dopo l'applicazione.\n` +
    `select private.stage_partner_research($${tag}$${text}$${tag}$, '${batchSha}');\n`
  );
}

/**
 * Funzione pura: dai file del repository Partner ai lotti dell'import. La usa anche l'harness
 * supabase/tests/partner.mjs. `variants` è il contenuto di research/bozze/varianti.json.
 */
export function buildPartnerImport({
  partners,
  variants,
  context,
  commit,
  batchBytes = DEFAULT_BATCH_BYTES,
}) {
  check(
    Number.isSafeInteger(batchBytes) &&
      batchBytes >= MIN_BATCH_BYTES &&
      batchBytes <= MAX_BATCH_BYTES,
    `--batch-bytes deve essere un intero tra ${MIN_BATCH_BYTES} e ${MAX_BATCH_BYTES}.`,
  );
  check(
    typeof commit === "string" && COMMIT.test(commit),
    "Commit del repository Partner non valido.",
  );
  check(
    isObject(partners) && Array.isArray(partners.leads),
    `${FILES.partners}: manca l'elenco leads.`,
  );
  check(realDate(partners.generated), `${FILES.partners}: data generated non valida.`);
  check(partners.leads.length >= 1, `${FILES.partners}: nessun contatto.`);
  check(
    typeof context === "string" && chars(context) <= 100000 && !CONTROL.test(context),
    `${FILES.context}: vuoto, oltre 100000 caratteri o con caratteri di controllo.`,
  );
  const variantFile = isObject(variants) && isObject(variants.result) ? variants.result : variants;
  check(
    isObject(variantFile) && Array.isArray(variantFile.contacts),
    `${FILES.variants}: manca l'elenco contacts.`,
  );
  const listed = new Map();
  for (const [index, contact] of variantFile.contacts.entries()) {
    check(
      isObject(contact) && typeof contact.id === "string" && KEY.test(contact.id),
      `${FILES.variants}: contatto n. ${index + 1} senza codice valido.`,
    );
    check(!listed.has(contact.id), `${FILES.variants}: contatto ${contact.id} ripetuto.`);
    check(
      contact.variants === undefined || Array.isArray(contact.variants),
      `${FILES.variants}: varianti di ${contact.id} non valide.`,
    );
    listed.set(contact.id, contact);
  }

  // Le varianti di partners.json devono essere quelle di varianti.json (build_data.py le copia).
  const seen = new Set();
  const siteOrder = new Set();
  for (const [index, lead] of partners.leads.entries()) {
    const code = isObject(lead) && typeof lead.id === "string" ? lead.id : "";
    check(KEY.test(code), `Contatto n. ${index + 1}: codice non valido.`);
    check(!seen.has(code), `Contatto ${code} ripetuto in ${FILES.partners}.`);
    seen.add(code);
    const order = `${lead.window}|${lead.co}`;
    check(!siteOrder.has(order), `Contatto ${code}: CO del sito ripetuto nello stesso periodo.`);
    siteOrder.add(order);
    if (canonical(lead.variants ?? []) !== canonical(listed.get(code)?.variants ?? []))
      fail(
        `Le varianti di ${code} in ${FILES.partners} sono diverse da ${FILES.variants}: rilanciare python3 tools/build_data.py nel repository Partner.`,
      );
  }
  const orphans = [...listed.keys()].filter((code) => !seen.has(code)).sort();

  const entries = partners.leads
    .map((lead, index) => ({
      lead,
      entry: normalizeLead(lead, index, partners.generated, listed.get(lead.id)),
    }))
    .sort(
      (a, b) =>
        WINDOWS.indexOf(a.lead.window) - WINDOWS.indexOf(b.lead.window) || a.lead.co - b.lead.co,
    );
  const normalizedEntries = entries.map(({ entry }) => entry);

  const header = {
    schema_version: 1,
    source: SOURCE,
    source_sha256: sha256(JSON.stringify({ partners, varianti: variants, context })),
    source_commit: commit,
    source_generated: partners.generated,
  };
  const normalized = sha256(
    JSON.stringify({ ...header, context_md: context, partners: normalizedEntries }),
  );
  const batchText = (list, contextPart, index, count) =>
    JSON.stringify({
      ...header,
      normalized_sha256: normalized,
      batch_index: index,
      batch_count: count,
      ...(contextPart === null ? {} : { context_md: contextPart }),
      partners: list,
    });
  // Misura con il caso peggiore: tre cifre per il numero di lotti, quotatura di lunghezza base.
  const measure = (list, contextPart, index) => {
    const text = batchText(list, contextPart, index, MAX_BATCHES);
    return Buffer.byteLength(
      stageSql(text, index, MAX_BATCHES, normalized, "0".repeat(64)),
      "utf8",
    );
  };

  // CONTESTO.md va in testa, diviso tra i primi lotti solo se non sta in uno (il database unisce
  // le parti nell'ordine dei lotti); poi i contatti, finché il .sql resta entro batchBytes.
  const contextChars = [...context];
  let contextAt = 0;
  let next = 0;
  const chunks = [];
  while (next < normalizedEntries.length || contextAt < contextChars.length || !chunks.length) {
    const index = chunks.length + 1;
    check(index <= MAX_BATCHES, `Servono più di ${MAX_BATCHES} lotti: aumentare --batch-bytes.`);
    let contextPart = null;
    if (contextAt < contextChars.length || (index === 1 && context === "")) {
      let low = 0;
      let high = contextChars.length - contextAt;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const part = contextChars.slice(contextAt, contextAt + middle).join("");
        if (measure([], part, index) <= batchBytes) low = middle;
        else high = middle - 1;
      }
      check(
        low > 0 || contextAt === contextChars.length,
        `--batch-bytes troppo piccolo anche per una parte di ${FILES.context}.`,
      );
      contextPart = contextChars.slice(contextAt, contextAt + low).join("");
      contextAt += low;
    }
    const list = [];
    if (contextAt === contextChars.length) {
      while (
        next < normalizedEntries.length &&
        measure([...list, normalizedEntries[next]], contextPart, index) <= batchBytes
      ) {
        list.push(normalizedEntries[next]);
        next += 1;
      }
      check(
        list.length > 0 || contextPart !== null || next === normalizedEntries.length,
        `Contatto ${normalizedEntries[next]?.source_key}: da solo supera --batch-bytes (${batchBytes} byte).`,
      );
    }
    chunks.push({ list, contextPart });
  }

  const count = chunks.length;
  const batches = chunks.map(({ list, contextPart }, i) => {
    const index = i + 1;
    const text = batchText(list, contextPart, index, count);
    const sha = sha256(text);
    const sql = stageSql(text, index, count, normalized, sha);
    check(
      Buffer.byteLength(sql, "utf8") <= batchBytes,
      `Lotto ${index}: oltre --batch-bytes (${batchBytes} byte).`,
    );
    return {
      index,
      text,
      sha,
      sql,
      sqlBytes: Buffer.byteLength(sql, "utf8"),
      textBytes: Buffer.byteLength(text, "utf8"),
      partners: list.length,
      contextChars: contextPart === null ? 0 : chars(contextPart),
    };
  });
  const applySql =
    `-- Import Partner ${normalized.slice(0, 8)}: applica i ${count} lotti registrati, in una transazione.\n` +
    `select private.apply_partner_research('${normalized}', array[${batches.map((batch) => `'${batch.sha}'`).join(", ")}]::text[]);\n`;

  const tally = (values, order) => {
    const counts = {};
    for (const value of order ?? []) counts[value] = 0;
    for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
    return order
      ? counts
      : Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, "en")));
  };
  const allContacts = normalizedEntries.flatMap((entry) =>
    entry.contacts.map((contact) => ({ ...contact, source_key: entry.source_key })),
  );
  const allVariants = normalizedEntries.flatMap((entry) => entry.variants);
  const report = {
    schema_version: 1,
    source: SOURCE,
    source_commit: commit,
    source_generated: partners.generated,
    source_sha256: header.source_sha256,
    normalized_sha256: normalized,
    batch_bytes: batchBytes,
    batch_count: count,
    partners_total: normalizedEntries.length,
    variants_total: allVariants.length,
    context_md_chars: contextChars.length,
    by_section: tally(
      normalizedEntries.flatMap((entry) => entry.sections),
      SECTIONS,
    ),
    by_window: tally(
      entries.map(({ lead }) => lead.window),
      WINDOWS,
    ),
    by_contact_month: tally(normalizedEntries.map((entry) => entry.contact_month.slice(0, 7))),
    by_preferred_channel: tally(
      normalizedEntries.map((entry) => entry.preferred_channel),
      CHANNELS,
    ),
    contacts_by_slot: tally(
      allContacts.map((contact) => contact.slot),
      SLOTS.map(([slot]) => slot),
    ),
    variants_by_approach: tally(
      allVariants.map((variant) => variant.approach),
      APPROACHES,
    ),
    contacts_without_link_value: allContacts
      .filter((contact) => linkValue(contact.slot, contact.value) === null)
      .map((contact) => ({ source_key: contact.source_key, slot: contact.slot })),
    contacts_without_month: entries
      .filter(({ lead }) => !lead.month)
      .map(({ lead, entry }) => ({
        source_key: entry.source_key,
        window: lead.window,
        contact_month: entry.contact_month,
      })),
    drafts_not_imported: partners.leads.filter((lead) => lead.draft != null).length,
    variant_contacts_not_in_partners: orphans,
    batches: batches.map((batch) => ({
      index: batch.index,
      partners: batch.partners,
      context_md_chars: batch.contextChars,
      sql_bytes: batch.sqlBytes,
      payload_bytes: batch.textBytes,
      sha256: batch.sha,
    })),
  };
  return {
    normalized,
    sourceSha256: header.source_sha256,
    batches,
    entries: normalizedEntries,
    applySql,
    report,
  };
}

// ---------------------------------------------------------------------------
// Riga di comando
// ---------------------------------------------------------------------------

const USAGE =
  'Uso: node supabase/generate-partner-import.mjs --partner-repo "<checkout di luckylap-partner>" --output-dir <cartella privata> [--batch-bytes 40000]';

function parseArgs(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    check(
      ["--partner-repo", "--output-dir", "--batch-bytes"].includes(args[i]) &&
        typeof args[i + 1] === "string" &&
        args[i + 1] !== "" &&
        !(args[i] in flags),
      USAGE,
    );
    flags[args[i]] = args[i + 1];
  }
  check(flags["--partner-repo"] && flags["--output-dir"], USAGE);
  const batchBytes =
    flags["--batch-bytes"] === undefined ? DEFAULT_BATCH_BYTES : Number(flags["--batch-bytes"]);
  check(
    flags["--batch-bytes"] === undefined || /^[0-9]{1,7}$/.test(flags["--batch-bytes"]),
    `--batch-bytes deve essere un intero tra ${MIN_BATCH_BYTES} e ${MAX_BATCH_BYTES}.`,
  );
  return {
    repo: path.resolve(flags["--partner-repo"]),
    outputDir: path.resolve(flags["--output-dir"]),
    batchBytes,
  };
}

function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

async function readRepository(repo) {
  let real;
  try {
    real = await realpath(repo);
  } catch {
    fail("Repository Partner non trovato.");
  }
  const top = git(real, ["rev-parse", "--show-toplevel"])?.trim();
  check(
    top && (await realpath(top)) === real,
    "--partner-repo deve essere la radice di un repository git (il commit identifica i dati).",
  );
  const status = git(real, ["status", "--porcelain"]);
  check(status !== null, "git status non riuscito sul repository Partner.");
  check(
    status === "",
    "Il repository Partner ha modifiche non committate: fare commit, poi rilanciare. Il commit deve identificare i dati.",
  );
  const commit = git(real, ["rev-parse", "HEAD"])?.trim();
  check(commit && /^[0-9a-f]{40}$/.test(commit), "Commit del repository Partner non leggibile.");
  check(
    git(real, ["ls-files", "--error-unmatch", "--", ...Object.values(FILES)]) !== null,
    `${Object.values(FILES).join(", ")} devono essere file committati nel repository Partner.`,
  );
  const read = async (relative, maxBytes) => {
    const file = path.join(real, relative);
    const info = await lstat(file).catch(() => null);
    check(info?.isFile(), `${relative}: file mancante o non regolare.`);
    check(info.size <= maxBytes, `${relative}: oltre ${maxBytes} byte.`);
    const bytes = await readFile(file);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      fail(`${relative}: non è testo UTF-8 valido.`);
    }
  };
  // JSON.parse cita il testo nei suoi errori: qui il messaggio dice solo quale file.
  const json = (text, relative) => {
    try {
      return JSON.parse(text);
    } catch {
      fail(`${relative}: non è JSON valido.`);
    }
  };
  return {
    commit,
    partners: json(await read(FILES.partners, 32 * 1024 * 1024), FILES.partners),
    variants: json(await read(FILES.variants, 32 * 1024 * 1024), FILES.variants),
    context: await read(FILES.context, 1024 * 1024),
  };
}

// Cartella privata: 0700, non un link simbolico, mai dentro un repository git se non ignorata
// (i .sql contengono i recapiti e non devono finire in un commit).
async function prepareOutput(outputDir) {
  const before = await lstat(outputDir).catch(() => null);
  let created;
  if (before) {
    check(
      before.isDirectory() && !before.isSymbolicLink(),
      "--output-dir deve essere una cartella, non un file o un link simbolico.",
    );
    check(
      (before.mode & 0o077) === 0,
      "--output-dir deve essere privata (permessi 0700): i file contengono i recapiti.",
    );
  } else {
    created = await mkdir(outputDir, { recursive: true, mode: 0o700 });
    await chmod(outputDir, 0o700);
  }
  const removeCreated = async () => {
    if (created) await rm(created, { recursive: true, force: true });
  };
  const top = git(outputDir, ["rev-parse", "--show-toplevel"])?.trim();
  if (top) {
    const relative = path.relative(await realpath(top), await realpath(outputDir));
    if (git(top, ["check-ignore", "-q", "--", `${relative}/`]) === null) {
      await removeCreated();
      fail(
        "--output-dir è dentro un repository git e non è ignorata: usare .private/partner-import o una cartella temporanea.",
      );
    }
  }
  return { dir: await realpath(outputDir), removeCreated };
}

async function main() {
  const { repo, outputDir, batchBytes } = parseArgs(process.argv.slice(2));
  const source = await readRepository(repo);
  const built = buildPartnerImport({ ...source, batchBytes });
  const { dir, removeCreated } = await prepareOutput(outputDir);
  const prefix = `${built.report.source_generated}-${built.normalized.slice(0, 8)}`;
  const width = Math.max(2, String(built.batches.length).length);
  const files = [
    ...built.batches.map((batch) => [
      `${prefix}-${String(batch.index).padStart(width, "0")}.sql`,
      batch.sql,
    ]),
    [`${prefix}-apply.sql`, built.applySql],
  ];
  const report = {
    ...built.report,
    files: {
      batches: files.slice(0, -1).map(([name]) => name),
      apply: `${prefix}-apply.sql`,
      report: `${prefix}.report.json`,
    },
    note: "I file .sql contengono i recapiti: cancellarli dopo l'applicazione. Questo resoconto resta.",
  };
  files.push([`${prefix}.report.json`, `${JSON.stringify(report, null, 2)}\n`]);
  // Creazione esclusiva: nessun file esistente viene mai sovrascritto.
  for (const [name] of files) {
    if (await lstat(path.join(dir, name)).catch(() => null)) {
      await removeCreated();
      fail(
        "Nella cartella di output c'è già un import con gli stessi dati: cancellarlo o usare un'altra cartella.",
      );
    }
  }
  const written = [];
  try {
    for (const [name, content] of files) {
      await writeFile(path.join(dir, name), content, { flag: "wx", mode: 0o600 });
      written.push(name);
    }
  } catch (error) {
    for (const name of written) await unlink(path.join(dir, name)).catch(() => {});
    await removeCreated();
    throw error;
  }
  console.log(
    `Import Partner ${built.normalized.slice(0, 8)} dal commit ${source.commit.slice(0, 7)}: ` +
      `${built.report.partners_total} contatti, ${built.report.variants_total} varianti, ` +
      `${built.batches.length} lotti (al massimo ${batchBytes} byte), ` +
      `${built.report.contacts_without_link_value.length} recapiti senza valore pulito, ` +
      `${built.report.contacts_without_month.length} contatti senza mese.`,
  );
  console.log(
    `Scritti ${files.length} file in ${dir}. Nessuna connessione esterna e nessuna scrittura sul database. ` +
      "Cancellare i .sql dopo l'applicazione.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    // Solo i messaggi di questo file: non citano mai recapiti o testi.
    console.error(
      error instanceof PartnerImportError
        ? error.message
        : `Generatore interrotto da un errore imprevisto${error?.code ? ` (${error.code})` : ""}.`,
    );
    process.exitCode = 1;
  });
}
