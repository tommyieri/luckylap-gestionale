// File «Esporta» del vecchio sito Partner (spec 02 §4.1; 00-sequenza §5, 02-10).
//
// Il sito scarica luckylap-partner-AAAA-MM-GG-telefono.json (o -computer.json) con stati,
// testi modificati e approcci salvati nel browser. Questo parser accetta solo quella forma e
// la trasforma nel payload di public.preview_partner_device_file e
// public.import_partner_device_file. Funzioni pure: usabili nel browser e nelle Server Action.
// I messaggi d'errore non ripetono mai i testi o i nomi del file, solo codici e campi.
import {
  PARTNER_MESSAGE_LIMITS,
  PARTNER_NAME_MAX,
  PARTNER_SOURCE_KEY,
  charCount,
  hasControlCharacters,
  isPartnerApproach,
  isPartnerStage,
  type PartnerApproach,
  type PartnerDevice,
  type PartnerMessageField,
  type PartnerStage,
} from "./model";

export const PARTNER_DEVICE_FILE_FORMAT = "luckylap-partner-export";
export const PARTNER_DEVICE_FILE_VERSION = 1;
/** Sotto il limite di 1 MB delle Server Action. */
export const PARTNER_DEVICE_FILE_MAX_BYTES = 900 * 1024;
export const PARTNER_DEVICE_FILE_MAX_ENTRIES = 2000;
export { PARTNER_DEVICES, type PartnerDevice } from "./model";

/** Payload normalizzato per il database (vedi private.partner_device_payload). */
export type PartnerDevicePayload = {
  schema_version: 1;
  file_sha256: string;
  device: PartnerDevice;
  exported_at: string;
  stages: Record<string, PartnerStage>;
  texts: Record<string, string>;
  approaches: Record<string, PartnerApproach>;
  names: Record<string, string>;
};
export type PartnerDeviceFileSummary = {
  device: PartnerDevice;
  exportedAt: string;
  /** Contatti citati in almeno una mappa. */
  contacts: number;
  stages: number;
  /** Coppie contatto e approccio con almeno un testo, come conta il database. */
  texts: number;
  approaches: number;
};
export type ParsedPartnerDeviceFile = {
  payload: PartnerDevicePayload;
  summary: PartnerDeviceFileSummary;
};

export class PartnerDeviceFileError extends Error {}

const TOP_LEVEL = new Set([
  "formato",
  "versione",
  "esportato",
  "dispositivo",
  "contatti",
  "stato",
  "testi",
  "approccio",
  "vista",
]);
const MAPS = ["contatti", "stato", "testi", "approccio"] as const;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const TEXT_KEY =
  /^([A-Za-z0-9]{1,20})\|(vendita|evento|collab|su_misura|media)\|(subject|body|follow_up|confirm_email)$/;
const EXPORTED_AT =
  /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const EARLIEST_EXPORT = Date.parse("2020-01-01T00:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_AN_EXPORT =
  "Questo non è un file «Esporta» del vecchio sito Partner. Sul sito premi «Esporta stati e testi di questo dispositivo» e carica il file scaricato.";

const fail = (message: string): never => {
  throw new PartnerDeviceFileError(message);
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function realDay(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function entries(file: Record<string, unknown>, map: (typeof MAPS)[number]) {
  const value = file[map];
  if (!isRecord(value)) fail(NOT_AN_EXPORT);
  const list = Object.entries(value as Record<string, unknown>);
  if (list.length > PARTNER_DEVICE_FILE_MAX_ENTRIES)
    fail(`Il file ha troppe voci in «${map}»: al massimo ${PARTNER_DEVICE_FILE_MAX_ENTRIES}.`);
  return list;
}

function contactKey(key: string, map: string): string {
  if (!PARTNER_SOURCE_KEY.test(key)) fail(`Il file ha un codice contatto non valido in «${map}».`);
  return key;
}

function checkedText(value: unknown, max: number, where: string): string {
  if (typeof value !== "string") return fail(`${where}: il valore deve essere un testo.`);
  if (charCount(value) > max) fail(`${where}: supera ${max} caratteri.`);
  if (hasControlCharacters(value)) fail(`${where}: contiene caratteri di controllo.`);
  return value;
}

/**
 * Controlla il testo di un file «Esporta» già decodificato. `fileSha256` è lo SHA-256 dei byte
 * del file intero. `now` serve a rifiutare date di esportazione nel futuro (un giorno di margine).
 */
export function parsePartnerDeviceText(
  text: string,
  fileSha256: string,
  now: Date = new Date(),
): ParsedPartnerDeviceFile {
  if (!/^[0-9a-f]{64}$/.test(fileSha256)) fail("Impronta del file non valida.");
  if (new TextEncoder().encode(text).byteLength > PARTNER_DEVICE_FILE_MAX_BYTES)
    fail("Il file è troppo grande: al massimo 900 KB.");
  let data: unknown;
  try {
    // Le chiavi pericolose sono rifiutate a ogni livello, anche dentro «vista».
    data = JSON.parse(text, (key, value: unknown) => {
      if (FORBIDDEN_KEYS.has(key)) fail("Il file contiene una chiave non ammessa.");
      return value;
    });
  } catch (error) {
    if (error instanceof PartnerDeviceFileError) throw error;
    fail(NOT_AN_EXPORT);
  }
  if (!isRecord(data)) return fail(NOT_AN_EXPORT);
  const file = data;
  if (Object.keys(file).some((key) => !TOP_LEVEL.has(key))) fail(NOT_AN_EXPORT);
  if (file.formato !== PARTNER_DEVICE_FILE_FORMAT || file.versione !== PARTNER_DEVICE_FILE_VERSION)
    fail(NOT_AN_EXPORT);

  const exported = typeof file.esportato === "string" ? file.esportato : "";
  const day = EXPORTED_AT.exec(exported)?.[1];
  const exportedTime = Date.parse(exported);
  if (!day || !realDay(day) || !Number.isFinite(exportedTime))
    fail("La data di esportazione del file non è valida.");
  if (exportedTime < EARLIEST_EXPORT || exportedTime > now.getTime() + DAY_MS)
    fail("La data di esportazione del file non è plausibile.");
  if (file.dispositivo !== "telefono" && file.dispositivo !== "computer")
    fail("Dispositivo non valido: il file deve dire «telefono» o «computer».");
  const device = file.dispositivo as PartnerDevice;

  const names: Record<string, string> = {};
  for (const [key, value] of entries(file, "contatti"))
    names[contactKey(key, "contatti")] = checkedText(value, PARTNER_NAME_MAX, `Nome di ${key}`);

  const stages: Record<string, PartnerStage> = {};
  for (const [key, value] of entries(file, "stato")) {
    contactKey(key, "stato");
    if (!isPartnerStage(value)) fail(`Stato non valido per ${key}.`);
    stages[key] = value as PartnerStage;
  }

  const approaches: Record<string, PartnerApproach> = {};
  for (const [key, value] of entries(file, "approccio")) {
    contactKey(key, "approccio");
    if (!isPartnerApproach(value)) fail(`Approccio non valido per ${key}.`);
    approaches[key] = value as PartnerApproach;
  }

  const texts: Record<string, string> = {};
  const pairs = new Set<string>();
  for (const [key, value] of entries(file, "testi")) {
    const match = TEXT_KEY.exec(key);
    if (!match) return fail("Il file ha una chiave dei testi non valida.");
    const fieldName = match[3] as PartnerMessageField;
    texts[key] = checkedText(
      value,
      PARTNER_MESSAGE_LIMITS[fieldName],
      `Testo ${match[1]} · ${match[2]} · ${fieldName}`,
    );
    pairs.add(`${match[1]}|${match[2]}`);
  }
  // «vista» (filtri salvati dal sito) può essere qualsiasi valore JSON, anche null: si ignora.

  const contacts = new Set([
    ...Object.keys(names),
    ...Object.keys(stages),
    ...Object.keys(approaches),
    ...[...pairs].map((pair) => pair.split("|")[0]),
  ]);
  return {
    payload: {
      schema_version: 1,
      file_sha256: fileSha256,
      device,
      exported_at: exported,
      stages,
      texts,
      approaches,
      names,
    },
    summary: {
      device,
      exportedAt: exported,
      contacts: contacts.size,
      stages: Object.keys(stages).length,
      texts: pairs.size,
      approaches: Object.keys(approaches).length,
    },
  };
}

/** SHA-256 esadecimale dei byte, con Web Crypto (browser e Node). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Controlla i byte di un file «Esporta»: dimensione, UTF-8, SHA-256 del file intero, forma. */
export async function readPartnerDeviceFile(
  input: Uint8Array | ArrayBuffer,
  now: Date = new Date(),
): Promise<ParsedPartnerDeviceFile> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength === 0) fail("Il file è vuoto.");
  if (bytes.byteLength > PARTNER_DEVICE_FILE_MAX_BYTES)
    fail("Il file è troppo grande: al massimo 900 KB.");
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(NOT_AN_EXPORT);
  }
  return parsePartnerDeviceText(text, await sha256Hex(bytes), now);
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** «File del telefono esportato il 22 ottobre: 12 stati, 3 testi, 4 approcci.» (ora di Roma) */
export function describePartnerDeviceFile(
  summary: PartnerDeviceFileSummary,
  now: Date = new Date(),
): string {
  const rome = (date: Date, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", ...options }).format(date);
  const exported = new Date(summary.exportedAt);
  const sameYear = rome(exported, { year: "numeric" }) === rome(now, { year: "numeric" });
  const day = rome(exported, {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `File del ${summary.device} esportato il ${day}: ${count(summary.stages, "stato", "stati")}, ${count(summary.texts, "testo", "testi")}, ${count(summary.approaches, "approccio", "approcci")}.`;
}

const STAGE_KEY = /^[A-Za-z0-9]{1,20}$/;
const PAYLOAD_KEYS = [
  "schema_version",
  "file_sha256",
  "device",
  "exported_at",
  "stages",
  "texts",
  "approaches",
  "names",
] as const;
const PAYLOAD_EXPORTED_AT = /^\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Ricontrolla sul server un payload già normalizzato (per esempio un tentativo ripetuto), con
 * le stesse regole di private.partner_device_payload. `null` se non è valido.
 */
export function validatePartnerDevicePayload(
  value: unknown,
  now: Date = new Date(),
): PartnerDevicePayload | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== PAYLOAD_KEYS.length || !PAYLOAD_KEYS.every((key) => key in value))
    return null;
  if (value.schema_version !== 1) return null;
  if (typeof value.file_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.file_sha256))
    return null;
  if (value.device !== "telefono" && value.device !== "computer") return null;
  if (typeof value.exported_at !== "string" || !PAYLOAD_EXPORTED_AT.test(value.exported_at))
    return null;
  const exported = Date.parse(value.exported_at);
  if (
    !Number.isFinite(exported) ||
    exported <= EARLIEST_EXPORT ||
    exported > now.getTime() + DAY_MS
  )
    return null;
  const map = (name: "stages" | "texts" | "approaches" | "names") => {
    const entries = isRecord(value[name]) ? Object.entries(value[name] as object) : null;
    return entries && entries.length <= PARTNER_DEVICE_FILE_MAX_ENTRIES ? entries : null;
  };
  const stages = map("stages"),
    texts = map("texts"),
    approaches = map("approaches"),
    names = map("names");
  if (!stages || !texts || !approaches || !names) return null;
  const cleanText = (text: unknown, max: number) =>
    typeof text === "string" && charCount(text) <= max && !hasControlCharacters(text);
  if (!stages.every(([key, stage]) => STAGE_KEY.test(key) && isPartnerStage(stage))) return null;
  if (!approaches.every(([key, approach]) => STAGE_KEY.test(key) && isPartnerApproach(approach)))
    return null;
  if (!names.every(([key, name]) => STAGE_KEY.test(key) && cleanText(name, PARTNER_NAME_MAX)))
    return null;
  if (
    !texts.every(([key, text]) => {
      const match = TEXT_KEY.exec(key);
      return match && cleanText(text, PARTNER_MESSAGE_LIMITS[match[3] as PartnerMessageField]);
    })
  )
    return null;
  return value as PartnerDevicePayload;
}

export type PartnerDevicePlanCounts = {
  stagesApplied: number;
  textsApplied: number;
  approachesApplied: number;
  differences: number;
  ignored: number;
  unknown: number;
};
export type PartnerDevicePreviewDifference = {
  kind: "stage" | "text";
  sourceKey: string;
  co: number;
  approach: PartnerApproach | null;
  from: PartnerStage | null;
  to: PartnerStage | null;
};
export type PartnerDevicePreview = {
  fileSha256: string;
  device: PartnerDevice;
  exportedAt: string;
  alreadyImported: boolean;
  deviceImportId: string | null;
  /** Voci del file: stati, coppie contatto e approccio con testi, approcci. */
  file: { stages: number; texts: number; approaches: number };
  plan: PartnerDevicePlanCounts;
  differences: PartnerDevicePreviewDifference[];
  namesChanged: { sourceKey: string; co: number; fileName: string; name: string }[];
  unknownKeys: string[];
};

const count32 = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2147483647
    ? value
    : null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Contatori del piano (preview, import e resoconto di import_partner_device_file). */
export function parsePartnerDevicePlanCounts(value: unknown): PartnerDevicePlanCounts | null {
  if (!isRecord(value)) return null;
  const counts = {
    stagesApplied: count32(value.stages_applied),
    textsApplied: count32(value.texts_applied),
    approachesApplied: count32(value.approaches_applied),
    differences: count32(value.differences),
    ignored: count32(value.ignored),
    unknown: count32(value.unknown),
  };
  return Object.values(counts).every((item) => item !== null)
    ? (counts as PartnerDevicePlanCounts)
    : null;
}

/** Risultato di public.preview_partner_device_file; `null` se la forma non torna. */
export function parsePartnerDevicePreview(value: unknown): PartnerDevicePreview | null {
  if (!isRecord(value) || !isRecord(value.file)) return null;
  const plan = parsePartnerDevicePlanCounts(value.plan);
  const file = {
    stages: count32(value.file.stages),
    texts: count32(value.file.texts),
    approaches: count32(value.file.approaches),
  };
  if (
    !plan ||
    file.stages === null ||
    file.texts === null ||
    file.approaches === null ||
    typeof value.file_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.file_sha256) ||
    (value.device !== "telefono" && value.device !== "computer") ||
    typeof value.exported_at !== "string" ||
    !Number.isFinite(Date.parse(value.exported_at)) ||
    typeof value.already_imported !== "boolean" ||
    !(
      value.device_import_id === null ||
      (typeof value.device_import_id === "string" && UUID.test(value.device_import_id))
    ) ||
    !Array.isArray(value.differences) ||
    !Array.isArray(value.names_changed) ||
    !Array.isArray(value.unknown_keys)
  )
    return null;
  const co = (item: unknown) =>
    typeof item === "number" && Number.isSafeInteger(item) && item >= 1 && item <= 99999;
  const differences: PartnerDevicePreviewDifference[] = [];
  for (const item of value.differences) {
    if (
      !isRecord(item) ||
      (item.kind !== "stage" && item.kind !== "text") ||
      typeof item.source_key !== "string" ||
      !STAGE_KEY.test(item.source_key) ||
      !co(item.co) ||
      !(item.approach === null || isPartnerApproach(item.approach)) ||
      !(item.from === null || isPartnerStage(item.from)) ||
      !(item.to === null || isPartnerStage(item.to))
    )
      return null;
    differences.push({
      kind: item.kind,
      sourceKey: item.source_key,
      co: item.co as number,
      approach: item.approach as PartnerApproach | null,
      from: item.from as PartnerStage | null,
      to: item.to as PartnerStage | null,
    });
  }
  const namesChanged: PartnerDevicePreview["namesChanged"] = [];
  for (const item of value.names_changed) {
    if (
      !isRecord(item) ||
      typeof item.source_key !== "string" ||
      !co(item.co) ||
      typeof item.file_name !== "string" ||
      typeof item.name !== "string"
    )
      return null;
    namesChanged.push({
      sourceKey: item.source_key,
      co: item.co as number,
      fileName: item.file_name,
      name: item.name,
    });
  }
  if (!value.unknown_keys.every((key) => typeof key === "string" && STAGE_KEY.test(key)))
    return null;
  return {
    fileSha256: value.file_sha256,
    device: value.device,
    exportedAt: value.exported_at,
    alreadyImported: value.already_imported,
    deviceImportId: value.device_import_id as string | null,
    file: file as PartnerDevicePreview["file"],
    plan,
    differences,
    namesChanged,
    unknownKeys: value.unknown_keys as string[],
  };
}

/**
 * Seconda parte dell'anteprima (spec 02 §5.8): «Applico 10 stati, 3 testi, 4 approcci. 2 stati
 * sono diversi: restano quelli del gestionale e li trovi in «Da controllare».»
 */
export function describePartnerDevicePlan(preview: PartnerDevicePreview): string {
  if (preview.alreadyImported)
    return "Questo file è già stato importato: importarlo di nuovo non cambia niente.";
  const { plan } = preview;
  const sentences = [
    `Applico ${count(plan.stagesApplied, "stato", "stati")}, ${count(plan.textsApplied, "testo", "testi")}, ${count(plan.approachesApplied, "approccio", "approcci")}.`,
  ];
  const stages = preview.differences.filter((item) => item.kind === "stage").length;
  const texts = preview.differences.length - stages;
  if (stages === 1)
    sentences.push(
      "1 stato è diverso: resta quello del gestionale e lo trovi in «Da controllare».",
    );
  else if (stages > 1)
    sentences.push(
      `${stages} stati sono diversi: restano quelli del gestionale e li trovi in «Da controllare».`,
    );
  if (texts === 1)
    sentences.push(
      "1 testo è diverso da quello del team: resta quello del gestionale e lo trovi in «Da controllare».",
    );
  else if (texts > 1)
    sentences.push(
      `${texts} testi sono diversi da quelli del team: restano quelli del gestionale e li trovi in «Da controllare».`,
    );
  if (plan.unknown > 0)
    sentences.push(
      `${count(plan.unknown, "voce riguarda", "voci riguardano")} contatti o messaggi che il gestionale non conosce: ${plan.unknown === 1 ? "la salto" : "le salto"}.`,
    );
  return sentences.join(" ");
}

/** Conferma dopo l'import: «File importato: 10 stati, 3 testi, 4 approcci. 2 differenze da controllare.» */
export function describePartnerDeviceImport(counts: PartnerDevicePlanCounts): string {
  const base = `File importato: ${count(counts.stagesApplied, "stato", "stati")}, ${count(counts.textsApplied, "testo", "testi")}, ${count(counts.approachesApplied, "approccio", "approcci")}.`;
  return counts.differences > 0
    ? `${base} ${count(counts.differences, "differenza", "differenze")} da controllare.`
    : base;
}
