// Partner: comandi del team (spec 02 §2.6, §5.11). Funzioni pure, usabili nel browser e sul server.
//
// - `parsePartnerCommand` ricontrolla sul server ogni comando con le stesse regole delle funzioni
//   SQL (chiavi richieste e ammesse, tipi, lunghezze, schema_version = 1). `created_by` non è una
//   chiave ammessa: l'autore è sempre l'utente della sessione.
// - I parser dei moduli (`partner…Payload`) trasformano i campi della pagina nel payload, con un
//   messaggio in italiano per ogni campo da correggere.
// - `partnerCommandOutcome` legge la risposta della RPC; `partnerCommandRejection` traduce gli
//   errori del database nei messaggi di spec 02 §5.11.
import { addDays, isCalendarDay, romeDay } from "./dates";
import {
  describePartnerDeviceImport,
  parsePartnerDevicePlanCounts,
  validatePartnerDevicePayload,
  type PartnerDevicePlanCounts,
} from "./device-file";
import { partnerLinkValue } from "./contacts";
import {
  PARTNER_ACTIVITY_CHANNELS,
  PARTNER_APPROACHES,
  PARTNER_CHANNELS,
  PARTNER_CONTACT_KINDS,
  PARTNER_LANGUAGES,
  PARTNER_MESSAGE_FIELDS,
  PARTNER_MESSAGE_KINDS,
  PARTNER_MESSAGE_LIMITS,
  PARTNER_PRIORITIES,
  PARTNER_RECORDABLE_KINDS,
  PARTNER_SECTIONS,
  PARTNER_STAGES,
  PARTNER_STAGE_LABELS,
  PARTNER_VARIANT_CHANNELS,
  PARTNER_VERSION_MAX,
  charCount,
  hasControlCharacters,
  isPartnerCo,
  isPartnerId,
  isPartnerStage,
  type PartnerActivityChannel,
  type PartnerApproach,
  type PartnerChannel,
  type PartnerContactKind,
  type PartnerLanguage,
  type PartnerMessageKind,
  type PartnerMessageTexts,
  type PartnerPriority,
  type PartnerRecordableKind,
  type PartnerSection,
  type PartnerStage,
  type PartnerVariantChannel,
} from "./model";

export const PARTNER_COMMAND_KINDS = [
  "set_partner_state",
  "save_partner",
  "record_partner_activity",
  "save_partner_message",
  "restore_partner_message",
  "save_partner_contact",
  "remove_partner_contact",
  "set_partner_do_not_contact",
  "resolve_partner_difference",
  "import_partner_device_file",
] as const;
export type PartnerCommandKind = (typeof PARTNER_COMMAND_KINDS)[number];
export const isPartnerCommandKind = (value: unknown): value is PartnerCommandKind =>
  typeof value === "string" && (PARTNER_COMMAND_KINDS as readonly string[]).includes(value);

export type PartnerPayload = Record<string, unknown> & { schema_version: 1 };
export type PartnerCommand = {
  kind: PartnerCommandKind;
  operationId: string;
  payload: PartnerPayload;
  /** Ripetizione dello stesso invio dopo un esito incerto. */
  retry: boolean;
};

// ---------------------------------------------------------------------------
// Controllo dei payload, come le funzioni private.partner_* della migrazione
// ---------------------------------------------------------------------------

class Invalid extends Error {}
const invalid = (): never => {
  throw new Invalid();
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
/** btrim di PostgreSQL: solo spazi. */
const btrim = (value: string) => value.replace(/^ +| +$/g, "");

function keys(p: Record<string, unknown>, required: string[], allowed: string[]) {
  if (!required.every((key) => key in p)) invalid();
  if (Object.keys(p).some((key) => !allowed.includes(key))) invalid();
  if (p.schema_version !== 1) invalid();
}
/** Assente o null → null; altrimenti testo entro il limite, senza caratteri di controllo. */
function textOf(p: Record<string, unknown>, key: string, max: number): string | null {
  const value = p[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || charCount(value) > max || hasControlCharacters(value)) invalid();
  return value as string;
}
function enumOf<T extends string>(p: Record<string, unknown>, key: string, list: readonly T[]) {
  const value = textOf(p, key, 40);
  if (value !== null && !(list as readonly string[]).includes(value)) invalid();
  return value as T | null;
}
function uuidOf(p: Record<string, unknown>, key: string): string | null {
  const value = textOf(p, key, 36);
  if (value !== null && !isPartnerId(value)) invalid();
  return value;
}
function versionOf(p: Record<string, unknown>, key: string): number | null {
  const value = p[key];
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > PARTNER_VERSION_MAX
  )
    invalid();
  return value as number;
}
function boolOf(p: Record<string, unknown>, key: string): boolean | null {
  const value = p[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") invalid();
  return value as boolean;
}
function dateOf(p: Record<string, unknown>, key: string): string | null {
  const value = textOf(p, key, 10);
  if (value !== null && !isCalendarDay(value)) invalid();
  return value;
}
function monthOf(p: Record<string, unknown>, key: string): string | null {
  const value = textOf(p, key, 10);
  if (value === null) return null;
  const day = /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
  if (!/^\d{4}-\d{2}-01$/.test(day) || !isCalendarDay(day)) invalid();
  return day;
}
function sectionsOf(value: unknown): PartnerSection[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 3 ||
    !value.every((item) => (PARTNER_SECTIONS as readonly unknown[]).includes(item)) ||
    new Set(value).size !== value.length
  )
    invalid();
  return value as PartnerSection[];
}
const check = (condition: boolean) => {
  if (!condition) invalid();
};

const validators: Record<PartnerCommandKind, (p: Record<string, unknown>, now: Date) => void> = {
  set_partner_state(p) {
    keys(
      p,
      ["schema_version", "partner_id", "expected_version"],
      [
        "schema_version",
        "partner_id",
        "expected_version",
        "stage",
        "owner_id",
        "next_action",
        "next_action_on",
        "chosen_approach",
      ],
    );
    check(uuidOf(p, "partner_id") !== null && versionOf(p, "expected_version") !== null);
    const hasStage = "stage" in p,
      hasOwner = "owner_id" in p,
      hasNext = "next_action" in p || "next_action_on" in p,
      hasApproach = "chosen_approach" in p;
    check(hasStage || hasOwner || hasNext || hasApproach);
    if (hasStage) check(enumOf(p, "stage", PARTNER_STAGES) !== null);
    uuidOf(p, "owner_id");
    enumOf(p, "chosen_approach", PARTNER_APPROACHES);
    if (hasNext) {
      check("next_action" in p && "next_action_on" in p);
      const text = textOf(p, "next_action", 240);
      const day = dateOf(p, "next_action_on");
      check((text === null) === (day === null));
      check(text === null || btrim(text) !== "");
    }
  },
  save_partner(p) {
    keys(
      p,
      ["schema_version", "partner_id"],
      [
        "schema_version",
        "partner_id",
        "expected_version",
        "name",
        "city",
        "country",
        "type_label",
        "sections",
        "priority",
        "contact_month",
        "event_starts_on",
        "event_ends_on",
        "preferred_channel",
        "application_deadline",
      ],
    );
    const partnerId = uuidOf(p, "partner_id");
    const expected = versionOf(p, "expected_version");
    if ("name" in p) {
      const name = btrim(textOf(p, "name", 240) ?? invalid());
      check(charCount(name) >= 1 && !/[\r\n]/.test(name));
    }
    for (const [key, max] of [
      ["city", 240],
      ["country", 120],
      ["type_label", 120],
    ] as const)
      if (key in p) check(textOf(p, key, max) !== null);
    if ("sections" in p) sectionsOf(p.sections);
    if ("priority" in p) check(enumOf(p, "priority", PARTNER_PRIORITIES) !== null);
    if ("contact_month" in p) check(monthOf(p, "contact_month") !== null);
    const start = dateOf(p, "event_starts_on");
    const end = dateOf(p, "event_ends_on");
    if ("event_ends_on" in p && "event_starts_on" in p)
      check(end === null || (start !== null && end >= start));
    if ("preferred_channel" in p) check(enumOf(p, "preferred_channel", PARTNER_CHANNELS) !== null);
    dateOf(p, "application_deadline");
    const fields = Object.keys(p).filter(
      (key) => !["schema_version", "partner_id", "expected_version"].includes(key),
    );
    if (partnerId === null)
      check(
        expected === null &&
          ["name", "sections", "priority", "contact_month"].every((key) => key in p),
      );
    else check(expected !== null && fields.length > 0);
  },
  record_partner_activity(p, now) {
    keys(
      p,
      ["schema_version", "partner_id", "kind"],
      [
        "schema_version",
        "partner_id",
        "kind",
        "occurred_on",
        "message_kind",
        "channel",
        "approach",
        "body",
      ],
    );
    const kind = enumOf(p, "kind", PARTNER_RECORDABLE_KINDS);
    check(uuidOf(p, "partner_id") !== null && kind !== null);
    const messageKind = enumOf(p, "message_kind", PARTNER_MESSAGE_KINDS);
    check(kind === "inviato" || messageKind === null);
    enumOf(p, "channel", PARTNER_ACTIVITY_CHANNELS);
    enumOf(p, "approach", PARTNER_APPROACHES);
    const body = btrim(textOf(p, "body", 4000) ?? "");
    check(kind !== "nota" || body !== "");
    const day = dateOf(p, "occurred_on");
    if (day !== null) {
      const today = romeDay(now);
      check(day <= today && day >= addDays(today, -365));
    }
  },
  save_partner_message(p) {
    keys(
      p,
      [
        "schema_version",
        "partner_id",
        "approach",
        "expected_version",
        "subject",
        "body",
        "follow_up",
        "confirm_email",
      ],
      [
        "schema_version",
        "partner_id",
        "approach",
        "expected_version",
        "subject",
        "body",
        "follow_up",
        "confirm_email",
        "channel",
        "language",
      ],
    );
    check(uuidOf(p, "partner_id") !== null && enumOf(p, "approach", PARTNER_APPROACHES) !== null);
    const texts = PARTNER_MESSAGE_FIELDS.map((field) =>
      textOf(p, field, PARTNER_MESSAGE_LIMITS[field]),
    );
    check(texts.every((text) => text !== null));
    check(texts.some((text) => btrim(text!) !== ""));
    const expected = versionOf(p, "expected_version");
    const channel = enumOf(p, "channel", PARTNER_VARIANT_CHANNELS);
    const language = enumOf(p, "language", PARTNER_LANGUAGES);
    if (expected === null) check(channel !== null && language !== null);
    else check(!("channel" in p) && !("language" in p));
  },
  restore_partner_message(p) {
    keys(
      p,
      ["schema_version", "variant_id", "expected_version"],
      ["schema_version", "variant_id", "expected_version"],
    );
    check(uuidOf(p, "variant_id") !== null && versionOf(p, "expected_version") !== null);
  },
  save_partner_contact(p) {
    keys(
      p,
      ["schema_version", "contact_id", "partner_id", "expected_version", "kind", "value"],
      [
        "schema_version",
        "contact_id",
        "partner_id",
        "expected_version",
        "kind",
        "value",
        "label",
        "verified",
      ],
    );
    const contactId = uuidOf(p, "contact_id");
    const expected = versionOf(p, "expected_version");
    check(uuidOf(p, "partner_id") !== null && enumOf(p, "kind", PARTNER_CONTACT_KINDS) !== null);
    check(btrim(textOf(p, "value", 500) ?? "") !== "");
    check((contactId === null) === (expected === null));
    textOf(p, "label", 120);
    boolOf(p, "verified");
  },
  remove_partner_contact(p) {
    keys(
      p,
      ["schema_version", "contact_id", "expected_version", "erase"],
      ["schema_version", "contact_id", "expected_version", "erase"],
    );
    check(
      uuidOf(p, "contact_id") !== null &&
        versionOf(p, "expected_version") !== null &&
        boolOf(p, "erase") !== null,
    );
  },
  set_partner_do_not_contact(p) {
    keys(
      p,
      ["schema_version", "partner_id", "active"],
      ["schema_version", "partner_id", "active", "reason", "include_domain"],
    );
    const active = boolOf(p, "active");
    check(uuidOf(p, "partner_id") !== null && active !== null);
    const reason = btrim(textOf(p, "reason", 500) ?? "");
    check(!active || (charCount(reason) >= 3 && charCount(reason) <= 500));
    boolOf(p, "include_domain");
  },
  resolve_partner_difference(p) {
    keys(
      p,
      ["schema_version", "difference_id", "choice", "expected_version"],
      ["schema_version", "difference_id", "choice", "expected_version"],
    );
    check(
      uuidOf(p, "difference_id") !== null &&
        enumOf(p, "choice", ["kept_team", "used_incoming"] as const) !== null &&
        versionOf(p, "expected_version") !== null,
    );
  },
  import_partner_device_file(p, now) {
    check(validatePartnerDevicePayload(p, now) !== null);
  },
};

/**
 * Comando dalla pagina: `{ kind, operationId, payload, retry? }`. `null` se qualcosa non torna.
 * Il payload resta identico a quello inviato la prima volta, così la ricevuta riconosce la
 * ripetizione (stesso SHA-256).
 */
export function parsePartnerCommand(value: unknown, now: Date = new Date()): PartnerCommand | null {
  if (!isObject(value)) return null;
  const { kind, operationId, payload, retry } = value;
  if (
    Object.keys(value).some((key) => !["kind", "operationId", "payload", "retry"].includes(key)) ||
    !isPartnerCommandKind(kind) ||
    !isPartnerId(operationId) ||
    !isObject(payload) ||
    (retry !== undefined && typeof retry !== "boolean")
  )
    return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 1_000_000) return null;
    validators[kind](payload, now);
  } catch (error) {
    if (error instanceof Invalid) return null;
    throw error;
  }
  return {
    kind,
    operationId: operationId.toLowerCase(),
    payload: payload as PartnerPayload,
    retry: retry === true,
  };
}

// ---------------------------------------------------------------------------
// Parser dei moduli della pagina
// ---------------------------------------------------------------------------

export type FormResult<F extends string> =
  { ok: true; payload: PartnerPayload } | { ok: false; errors: Partial<Record<F, string>> };

const tooLong = (max: number) => `Al massimo ${max} caratteri.`;
const control = "Togli i caratteri speciali invisibili.";
/** `value` è il testo che parte davvero: già senza spazi in testa e in coda dove si tolgono. */
function textError(value: string, max: number, required: string | null): string | null {
  if (required !== null && value.trim() === "") return required;
  if (charCount(value) > max) return tooLong(max);
  if (hasControlCharacters(value)) return control;
  return null;
}

/** Stato, responsabile, prossima azione, approccio: solo i campi passati. */
export function partnerStatePayload(input: {
  partnerId: string;
  expectedVersion: number;
  stage?: PartnerStage;
  ownerId?: string | null;
  nextAction?: { text: string; on: string } | null;
  chosenApproach?: PartnerApproach | null;
}): FormResult<"nextAction" | "nextActionOn"> {
  const payload: PartnerPayload = {
    schema_version: 1,
    partner_id: input.partnerId,
    expected_version: input.expectedVersion,
  };
  if (input.stage !== undefined) payload.stage = input.stage;
  if (input.ownerId !== undefined) payload.owner_id = input.ownerId;
  if (input.chosenApproach !== undefined) payload.chosen_approach = input.chosenApproach;
  if (input.nextAction !== undefined) {
    const text = input.nextAction?.text.trim() ?? "";
    const on = input.nextAction?.on ?? "";
    if (text === "" && on === "") {
      payload.next_action = null;
      payload.next_action_on = null;
    } else {
      const errors: Partial<Record<"nextAction" | "nextActionOn", string>> = {};
      const textProblem = textError(text, 240, "Scrivi la prossima azione, oppure togli la data.");
      if (textProblem) errors.nextAction = textProblem;
      if (!isCalendarDay(on)) errors.nextActionOn = "Scegli il giorno, oppure togli il testo.";
      if (errors.nextAction || errors.nextActionOn) return { ok: false, errors };
      payload.next_action = text;
      payload.next_action_on = on;
    }
  }
  return { ok: true, payload };
}

export type PartnerCardField =
  | "name"
  | "city"
  | "country"
  | "typeLabel"
  | "sections"
  | "priority"
  | "contactMonth"
  | "eventStartsOn"
  | "eventEndsOn"
  | "applicationDeadline"
  | "preferredChannel";
export type PartnerCardInput = {
  name: string;
  city: string;
  country: string;
  typeLabel: string;
  sections: readonly string[];
  priority: string;
  /** `type="month"`: «AAAA-MM». */
  contactMonth: string;
  eventStartsOn: string;
  eventEndsOn: string;
  applicationDeadline: string;
  preferredChannel: string;
};

/**
 * «Aggiungi un contatto» (`target` nullo) e «Modifica la scheda». In modifica il modulo manda
 * tutti i campi: il database cambia solo quelli diversi e non scrive niente se sono uguali.
 */
export function partnerCardPayload(
  input: PartnerCardInput,
  target: { partnerId: string; expectedVersion: number } | null,
): FormResult<PartnerCardField> {
  const errors: Partial<Record<PartnerCardField, string>> = {};
  const name = input.name.trim();
  const nameProblem = textError(name, 240, "Scrivi il nome.");
  if (nameProblem) errors.name = nameProblem;
  else if (/[\r\n]/.test(name)) errors.name = "Il nome va su una riga sola.";
  for (const [field, max] of [
    ["city", 240],
    ["country", 120],
    ["typeLabel", 120],
  ] as const) {
    const problem = textError(input[field].trim(), max, null);
    if (problem) errors[field] = problem;
  }
  const sections = PARTNER_SECTIONS.filter((section) => input.sections.includes(section));
  if (sections.length === 0 || input.sections.some((s) => !sections.includes(s as PartnerSection)))
    errors.sections = "Scegli almeno una sezione.";
  if (!(PARTNER_PRIORITIES as readonly string[]).includes(input.priority))
    errors.priority = "Scegli la priorità.";
  if (!/^\d{4}-\d{2}$/.test(input.contactMonth) || !isCalendarDay(`${input.contactMonth}-01`))
    errors.contactMonth = "Scegli il mese in cui contattarli.";
  const optionalDay = (value: string, field: PartnerCardField) => {
    if (value === "") return null;
    if (!isCalendarDay(value)) errors[field] = "Scegli un giorno valido.";
    return value;
  };
  const start = optionalDay(input.eventStartsOn, "eventStartsOn");
  const end = optionalDay(input.eventEndsOn, "eventEndsOn");
  const deadline = optionalDay(input.applicationDeadline, "applicationDeadline");
  if (end !== null && !errors.eventEndsOn) {
    if (start === null) errors.eventStartsOn = "Scegli anche il primo giorno dell’evento.";
    else if (end < start) errors.eventEndsOn = "L’evento finisce prima di iniziare.";
  }
  if (!(PARTNER_CHANNELS as readonly string[]).includes(input.preferredChannel))
    errors.preferredChannel = "Scegli il canale preferito.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const payload: PartnerPayload = {
    schema_version: 1,
    partner_id: target?.partnerId ?? null,
    name,
    city: input.city.trim(),
    country: input.country.trim(),
    type_label: input.typeLabel.trim(),
    sections,
    priority: input.priority as PartnerPriority,
    contact_month: `${input.contactMonth}-01`,
    event_starts_on: start,
    event_ends_on: end,
    application_deadline: deadline,
    preferred_channel: input.preferredChannel as PartnerChannel,
  };
  if (target) payload.expected_version = target.expectedVersion;
  return { ok: true, payload };
}

export type PartnerActivityField = "kind" | "occurredOn" | "channel" | "body";
/** «Ha risposto», «Chiamata», «Incontro», «Nota», «Segna inviato». */
export function partnerActivityPayload(
  input: {
    partnerId: string;
    kind: PartnerRecordableKind;
    /** Giorno di Roma; vuoto = oggi. */
    occurredOn: string;
    channel: PartnerActivityChannel | "";
    approach?: PartnerApproach | null;
    messageKind?: PartnerMessageKind;
    body: string;
  },
  today: string,
): FormResult<PartnerActivityField> {
  const errors: Partial<Record<PartnerActivityField, string>> = {};
  if (!(PARTNER_RECORDABLE_KINDS as readonly string[]).includes(input.kind))
    errors.kind = "Scegli cosa registrare.";
  if (input.occurredOn !== "") {
    if (!isCalendarDay(input.occurredOn)) errors.occurredOn = "Scegli un giorno valido.";
    else if (input.occurredOn > today) errors.occurredOn = "Il giorno non può essere nel futuro.";
    else if (input.occurredOn < addDays(today, -365)) errors.occurredOn = "Al massimo un anno fa.";
  }
  if (
    input.channel !== "" &&
    !(PARTNER_ACTIVITY_CHANNELS as readonly string[]).includes(input.channel)
  )
    errors.channel = "Scegli il canale.";
  const bodyProblem = textError(
    input.body.trim(),
    4000,
    input.kind === "nota" ? "Scrivi la nota." : null,
  );
  if (bodyProblem) errors.body = bodyProblem;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const payload: PartnerPayload = {
    schema_version: 1,
    partner_id: input.partnerId,
    kind: input.kind,
  };
  if (input.occurredOn !== "" && input.occurredOn !== today) payload.occurred_on = input.occurredOn;
  if (input.kind === "inviato") payload.message_kind = input.messageKind ?? "primo";
  if (input.channel !== "") payload.channel = input.channel;
  if (input.approach) payload.approach = input.approach;
  if (input.body.trim() !== "") payload.body = input.body.trim();
  return { ok: true, payload };
}

export type PartnerMessageFormField = keyof PartnerMessageTexts | "texts";
/** «Salva il testo» di una variante esistente (`expectedVersion`) o di una nuova del team. */
export function partnerMessagePayload(input: {
  partnerId: string;
  approach: PartnerApproach;
  texts: PartnerMessageTexts;
  existing: { expectedVersion: number } | null;
  channel?: PartnerVariantChannel;
  language?: PartnerLanguage;
}): FormResult<PartnerMessageFormField> {
  const errors: Partial<Record<PartnerMessageFormField, string>> = {};
  for (const field of PARTNER_MESSAGE_FIELDS) {
    const problem = textError(input.texts[field], PARTNER_MESSAGE_LIMITS[field], null);
    if (problem) errors[field] = problem;
  }
  if (PARTNER_MESSAGE_FIELDS.every((field) => input.texts[field].trim() === ""))
    errors.texts = "Scrivi almeno un testo.";
  if (!input.existing && (!input.channel || !input.language))
    errors.texts = "Scegli canale e lingua del messaggio.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const payload: PartnerPayload = {
    schema_version: 1,
    partner_id: input.partnerId,
    approach: input.approach,
    expected_version: input.existing?.expectedVersion ?? null,
    subject: input.texts.subject,
    body: input.texts.body,
    follow_up: input.texts.follow_up,
    confirm_email: input.texts.confirm_email,
  };
  if (!input.existing) {
    payload.channel = input.channel;
    payload.language = input.language;
  }
  return { ok: true, payload };
}

const UNUSABLE: Record<PartnerContactKind, string> = {
  email: "Scrivi un indirizzo email valido, per esempio nome@dominio.it.",
  phone: "Scrivi un numero di telefono con almeno 5 cifre.",
  whatsapp: "Scrivi un numero WhatsApp con almeno 5 cifre.",
  instagram: "Scrivi il profilo come @nome o il link instagram.com/nome.",
  form: "Scrivi l’indirizzo del modulo, che inizia con https://.",
  brand_page: "Scrivi l’indirizzo della pagina, che inizia con https://.",
  web: "Scrivi l’indirizzo del sito, che inizia con https://.",
};

/** «Aggiungi un recapito» (`existing` nullo) e «Modifica». Il recapito deve dare un pulsante. */
export function partnerContactPayload(input: {
  partnerId: string;
  kind: PartnerContactKind;
  value: string;
  label: string;
  verified?: boolean;
  existing: { contactId: string; expectedVersion: number } | null;
}): FormResult<"kind" | "value" | "label"> {
  const errors: Partial<Record<"kind" | "value" | "label", string>> = {};
  if (!(PARTNER_CONTACT_KINDS as readonly string[]).includes(input.kind))
    errors.kind = "Scegli il tipo di recapito.";
  const value = input.value.trim();
  const valueProblem = textError(value, 500, "Scrivi il recapito.");
  if (valueProblem) errors.value = valueProblem;
  else if (!errors.kind && partnerLinkValue(input.kind, value) === null)
    errors.value = UNUSABLE[input.kind];
  const labelProblem = textError(input.label.trim(), 120, null);
  if (labelProblem) errors.label = labelProblem;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const payload: PartnerPayload = {
    schema_version: 1,
    contact_id: input.existing?.contactId ?? null,
    partner_id: input.partnerId,
    expected_version: input.existing?.expectedVersion ?? null,
    kind: input.kind,
    value,
    label: input.label.trim(),
  };
  if (input.verified !== undefined) payload.verified = input.verified;
  return { ok: true, payload };
}

/** «Metti tra i non contattare» (con motivo) e «Togli dalla lista». */
export function partnerDoNotContactPayload(input: {
  partnerId: string;
  active: boolean;
  reason: string;
  includeDomain: boolean;
}): FormResult<"reason"> {
  const reason = input.reason.trim();
  if (input.active) {
    const problem =
      charCount(reason) < 3
        ? "Scrivi il motivo: almeno 3 caratteri."
        : textError(reason, 500, null);
    if (problem) return { ok: false, errors: { reason: problem } };
    return {
      ok: true,
      payload: {
        schema_version: 1,
        partner_id: input.partnerId,
        active: true,
        reason,
        include_domain: input.includeDomain,
      },
    };
  }
  return { ok: true, payload: { schema_version: 1, partner_id: input.partnerId, active: false } };
}

// ---------------------------------------------------------------------------
// Esiti
// ---------------------------------------------------------------------------

export type PartnerCommandSuccess = {
  status: "success";
  kind: PartnerCommandKind;
  operationId: string;
  /** Id restituito dal comando: contatto, variante, recapito, differenza o import. */
  id: string;
  partnerId: string | null;
  version: number | null;
  stage: PartnerStage | null;
  co: number | null;
  activityId: string | null;
  occurredAt: string | null;
  blocked: boolean | null;
  counts: PartnerDevicePlanCounts | null;
  replayed: boolean;
  message: string;
};
export type PartnerCommandResult =
  | PartnerCommandSuccess
  | {
      status: "rejected";
      code: string;
      message: string;
      /** Dati cambiati da un collega: la pagina ricarica e conserva il testo non salvato. */
      refresh: boolean;
    }
  | { status: "uncertain"; message: string };

export const PARTNER_UNCERTAIN_MESSAGE = "Salvataggio non confermato. Verifica prima di riprovare.";

/** Errori del database (codice SQLSTATE e messaggio = codice) → testi di spec 02 §5.11. */
export const PARTNER_ERROR_MESSAGES: Record<string, { sqlstate: string; message: string }> = {
  partner_access_required: {
    sqlstate: "42501",
    message: "I permessi del tuo account sono cambiati. Accedi di nuovo.",
  },
  partner_changed: {
    sqlstate: "40001",
    message:
      "Un collega ha appena modificato questo contatto. Ricarico i dati: controlla e riprova.",
  },
  partner_idempotency_conflict: {
    sqlstate: "23505",
    message: "Operazione già usata con dati diversi. Ricarica la pagina.",
  },
  partner_do_not_contact: {
    sqlstate: "55000",
    message: "Questo contatto è nella lista «Non contattare».",
  },
  invalid_partner_payload: {
    sqlstate: "22023",
    message: "Controlla i campi: un valore non è valido.",
  },
  partner_not_found: {
    sqlstate: "22023",
    message: "Questo contatto o recapito non c’è più. Ricarica la pagina.",
  },
  partner_owner_inactive: {
    sqlstate: "22023",
    message: "La persona scelta non è più attiva nel team. Scegline un’altra.",
  },
  partner_contact_unusable: {
    sqlstate: "22023",
    message:
      "Il recapito non dà un pulsante: scrivi un’email, un numero, un @profilo o un indirizzo che inizia con https://.",
  },
  partner_contact_erased: {
    sqlstate: "22023",
    message: "Questo recapito è stato cancellato e non si può più modificare.",
  },
  partner_message_no_original: {
    sqlstate: "22023",
    message: "Questo messaggio non ha un testo originale della ricerca da ripristinare.",
  },
  partner_difference_closed: {
    sqlstate: "22023",
    message: "Questa differenza è già stata risolta. Ricarica la pagina.",
  },
  partner_domain_unavailable: {
    sqlstate: "22023",
    message: "Il contatto non ha un sito da cui ricavare il dominio: blocca solo il contatto.",
  },
  partner_not_blocked: {
    sqlstate: "22023",
    message: "Il contatto non è nella lista «Non contattare».",
  },
  partner_co_exhausted: {
    sqlstate: "22023",
    message: "I numeri CO disponibili sono finiti: il contatto non è stato aggiunto.",
  },
};

/**
 * Errore della RPC → rifiuto definitivo, oppure `null` (esito da verificare). In una
 * ripetizione, accesso e payload non validi non dicono se il primo invio è andato a buon fine.
 */
export function partnerCommandRejection(
  error: { code?: string | null; message?: string | null },
  retry: boolean,
): Extract<PartnerCommandResult, { status: "rejected" }> | null {
  const known = error.message ? PARTNER_ERROR_MESSAGES[error.message] : undefined;
  if (!known || known.sqlstate !== error.code) return null;
  if (
    retry &&
    (error.message === "partner_access_required" || error.message === "invalid_partner_payload")
  )
    return null;
  return {
    status: "rejected",
    code: error.message!,
    message: known.message,
    refresh: error.message === "partner_changed",
  };
}

const nullableId = (value: unknown) => value === null || value === undefined || isPartnerId(value);
const version = (value: unknown) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 1 &&
  value <= PARTNER_VERSION_MAX;

function successMessage(command: PartnerCommand, data: Record<string, unknown>): string {
  const p = command.payload;
  const stage = isPartnerStage(data.stage) ? PARTNER_STAGE_LABELS[data.stage] : null;
  switch (command.kind) {
    case "set_partner_state":
      return !data.activity_id
        ? "Nessuna modifica da salvare."
        : "stage" in p
          ? `Salvato. Stato: ${stage}.`
          : "Salvato.";
    case "record_partner_activity":
      return `Registrato. Stato: ${stage}.`;
    case "save_partner":
      return p.partner_id === null
        ? `Contatto aggiunto: CO ${String(data.co).padStart(3, "0")}.`
        : data.activity_id
          ? "Scheda salvata."
          : "Nessuna modifica da salvare.";
    case "save_partner_message":
      return data.activity_id ? "Testo salvato." : "Il testo era già questo: nessuna modifica.";
    case "restore_partner_message":
      return data.activity_id ? "Ripristinato il testo originale." : "Vale già il testo originale.";
    case "save_partner_contact":
      return data.activity_id ? "Recapito salvato." : "Nessuna modifica da salvare.";
    case "remove_partner_contact":
      return data.erased === true
        ? typeof data.messages_cleaned === "number" && data.messages_cleaned > 0
          ? "Dato cancellato, anche dai destinatari dei messaggi. Toglilo anche dalla ricerca."
          : "Dato cancellato. Toglilo anche dalla ricerca."
        : data.activity_id
          ? "Recapito rimosso."
          : "Il recapito era già rimosso.";
    case "set_partner_do_not_contact":
      return p.active === true
        ? "Messo tra i non contattare."
        : "Tolto dalla lista «Non contattare».";
    case "resolve_partner_difference":
      return data.choice === "kept_team"
        ? "Tenuto il valore del gestionale."
        : "Usato il nuovo valore.";
    case "import_partner_device_file": {
      const counts = parsePartnerDevicePlanCounts(data);
      return counts ? describePartnerDeviceImport(counts) : "File importato.";
    }
  }
}

/** Risposta della RPC → esito, o `null` se la forma non torna (esito da verificare). */
export function partnerCommandOutcome(
  command: PartnerCommand,
  value: unknown,
): PartnerCommandSuccess | null {
  if (!isObject(value) || !isPartnerId(value.id) || typeof value.replayed !== "boolean")
    return null;
  if (!nullableId(value.activity_id) || !nullableId(value.partner_id)) return null;
  const needsVersion =
    command.kind !== "set_partner_do_not_contact" && command.kind !== "import_partner_device_file";
  if (needsVersion && !version(value.version)) return null;
  if (
    (command.kind === "set_partner_state" || command.kind === "record_partner_activity") &&
    !isPartnerStage(value.stage)
  )
    return null;
  if (command.kind === "save_partner" && !isPartnerCo(value.co)) return null;
  if (command.kind === "set_partner_do_not_contact" && typeof value.blocked !== "boolean")
    return null;
  const counts =
    command.kind === "import_partner_device_file" ? parsePartnerDevicePlanCounts(value) : null;
  if (command.kind === "import_partner_device_file" && counts === null) return null;
  const partnerId =
    typeof value.partner_id === "string"
      ? value.partner_id
      : [
            "set_partner_state",
            "save_partner",
            "record_partner_activity",
            "set_partner_do_not_contact",
          ].includes(command.kind)
        ? value.id
        : null;
  const base = successMessage(command, value);
  return {
    status: "success",
    kind: command.kind,
    operationId: command.operationId,
    id: value.id,
    partnerId,
    version: version(value.version) ? (value.version as number) : null,
    stage: isPartnerStage(value.stage) ? value.stage : null,
    co: isPartnerCo(value.co) ? value.co : null,
    activityId: typeof value.activity_id === "string" ? value.activity_id : null,
    occurredAt:
      typeof value.occurred_at === "string" && Number.isFinite(Date.parse(value.occurred_at))
        ? value.occurred_at
        : null,
    blocked: typeof value.blocked === "boolean" ? value.blocked : null,
    counts,
    replayed: value.replayed,
    message: value.replayed ? `${base} Era già registrato: nessun doppione.` : base,
  };
}
