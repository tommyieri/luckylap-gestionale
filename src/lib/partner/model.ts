// Partner: valori di dominio condivisi da pagina, Server Action e parser (spec 02 §1, §2.2).
// Stessi valori dei check della migrazione partner_module. Funzioni pure, nessun import di React.
//
// I parser delle righe lette dal database rifiutano ogni riga non valida (PartnerReadError):
// la pagina mostra un errore, mai dati parziali o inventati.
import { instantDay, instantTime, isCalendarDay, isMonthStart, longDay, shortDay } from "./dates";

export const PARTNER_STAGES = [
  "da_contattare",
  "contattato",
  "risposto",
  "trattativa",
  "chiuso",
  "no",
] as const;
export type PartnerStage = (typeof PARTNER_STAGES)[number];
export const PARTNER_STAGE_LABELS: Record<PartnerStage, string> = {
  da_contattare: "Da contattare",
  contattato: "Contattato",
  risposto: "Ha risposto",
  trattativa: "In trattativa",
  // Esito positivo: ci andiamo, c'è una collab o un accordo. Le date entrano nel calendario.
  chiuso: "Accordo fatto",
  no: "Non interessato",
};

export const PARTNER_APPROACHES = ["vendita", "evento", "collab", "su_misura", "media"] as const;
export type PartnerApproach = (typeof PARTNER_APPROACHES)[number];
export const PARTNER_APPROACH_LABELS: Record<PartnerApproach, string> = {
  vendita: "Vendita",
  evento: "Presenza all’evento",
  collab: "Collab",
  su_misura: "Su misura",
  media: "Media",
};

/** Sezioni del roadbook, nell'ordine canonico del database. */
export const PARTNER_SECTIONS = ["vendita", "eventi", "collab"] as const;
export type PartnerSection = (typeof PARTNER_SECTIONS)[number];
export const PARTNER_SECTION_LABELS: Record<PartnerSection, string> = {
  vendita: "Vendita",
  eventi: "Eventi",
  collab: "Collab",
};
/** Nota sotto il titolo del periodo quando si guarda una sola sezione (SECTION_NOTE del sito). */
export const PARTNER_SECTION_NOTES: Record<PartnerSection, string> = {
  vendita:
    "Il conto vendita è solo una delle formule: il negozio può anche comprare a fermo una trentina di pezzi, ospitare un evento o proporre altro. Si parte da una conversazione.",
  eventi:
    "Stand, pop-up, presenza da partner o welcome kit per i partecipanti: la proposta è nelle note di ogni contatto.",
  collab:
    "Capsule a doppio marchio, partnership con media e community, club e rally: ogni contatto dice cosa proporre.",
};
/** Titoletti di «Cosa proporre» per sezione (IDEA_LABEL del sito). */
export const PARTNER_IDEA_LABELS: Record<PartnerSection, string> = {
  vendita: "Al negozio",
  eventi: "All’evento",
  collab: "Collab",
};

export const PARTNER_PRIORITIES = ["alta", "media", "bassa"] as const;
export type PartnerPriority = (typeof PARTNER_PRIORITIES)[number];
export const PARTNER_PRIORITY_LABELS: Record<PartnerPriority, string> = {
  alta: "Priorità alta",
  media: "Priorità media",
  bassa: "Riserva",
};

/** Canale preferito della scheda: decide il pulsante principale della riga. */
export const PARTNER_CHANNELS = ["email", "form", "ig", "phone", "web"] as const;
export type PartnerChannel = (typeof PARTNER_CHANNELS)[number];
export const PARTNER_CHANNEL_LABELS: Record<PartnerChannel, string> = {
  email: "Email",
  form: "Modulo del sito",
  ig: "Instagram",
  phone: "Telefono",
  web: "Sito",
};

export const PARTNER_CONTACT_KINDS = [
  "email",
  "phone",
  "whatsapp",
  "instagram",
  "form",
  "brand_page",
  "web",
] as const;
export type PartnerContactKind = (typeof PARTNER_CONTACT_KINDS)[number];
export const PARTNER_CONTACT_KIND_LABELS: Record<PartnerContactKind, string> = {
  email: "Email",
  phone: "Telefono",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  form: "Modulo",
  brand_page: "Per i brand",
  web: "Sito",
};

/** Canale di una variante di messaggio. */
export const PARTNER_VARIANT_CHANNELS = ["email", "form", "dm", "phone"] as const;
export type PartnerVariantChannel = (typeof PARTNER_VARIANT_CHANNELS)[number];
export const PARTNER_VARIANT_CHANNEL_LABELS: Record<PartnerVariantChannel, string> = {
  email: "Email",
  form: "Testo per il modulo",
  dm: "Messaggio Instagram",
  phone: "Telefonata",
};

export const PARTNER_LANGUAGES = ["en", "de", "fr", "it", "es"] as const;
export type PartnerLanguage = (typeof PARTNER_LANGUAGES)[number];
/** «Email in tedesco». */
export const PARTNER_LANGUAGE_LABELS: Record<PartnerLanguage, string> = {
  en: "in inglese",
  de: "in tedesco",
  fr: "in francese",
  it: "in italiano",
  es: "in spagnolo",
};

export const PARTNER_LOOKBOOK_CODES = [
  "negozi",
  "eventi",
  "collab",
  "porsche_club",
  "club",
] as const;
export type PartnerLookbookCode = (typeof PARTNER_LOOKBOOK_CODES)[number];

export const PARTNER_ACTIVITY_KINDS = [
  "inviato",
  "risposta",
  "chiamata",
  "incontro",
  "nota",
  "stato",
  "responsabile",
  "prossima_azione",
  "approccio",
  "messaggio",
  "ripristino",
  "scheda",
  "nuovo",
  "recapito",
  "non_contattare",
  "differenza",
] as const;
export type PartnerActivityKind = (typeof PARTNER_ACTIVITY_KINDS)[number];
/** I cinque tipi che il team registra a mano (record_partner_activity). */
export const PARTNER_RECORDABLE_KINDS = [
  "inviato",
  "risposta",
  "chiamata",
  "incontro",
  "nota",
] as const;
export type PartnerRecordableKind = (typeof PARTNER_RECORDABLE_KINDS)[number];
export const PARTNER_ACTIVITY_KIND_LABELS: Record<PartnerActivityKind, string> = {
  inviato: "Inviato",
  risposta: "Ha risposto",
  chiamata: "Chiamata",
  incontro: "Incontro",
  nota: "Nota",
  stato: "Stato",
  responsabile: "Responsabile",
  prossima_azione: "Prossima azione",
  approccio: "Approccio scelto",
  messaggio: "Messaggio modificato",
  ripristino: "Messaggio originale ripristinato",
  scheda: "Scheda aggiornata",
  nuovo: "Contatto aggiunto",
  recapito: "Recapiti aggiornati",
  non_contattare: "Lista «Non contattare»",
  differenza: "Differenza risolta",
};

export const PARTNER_ACTIVITY_CHANNELS = [
  "email",
  "form",
  "dm",
  "phone",
  "whatsapp",
  "visita",
] as const;
export type PartnerActivityChannel = (typeof PARTNER_ACTIVITY_CHANNELS)[number];
/** «Inviato via email», «via Instagram»; la visita è «di persona» (05-5). */
export const PARTNER_ACTIVITY_CHANNEL_LABELS: Record<PartnerActivityChannel, string> = {
  email: "email",
  form: "modulo del sito",
  dm: "Instagram",
  phone: "telefono",
  whatsapp: "WhatsApp",
  visita: "di persona",
};
export const PARTNER_MESSAGE_KINDS = ["primo", "sollecito"] as const;
export type PartnerMessageKind = (typeof PARTNER_MESSAGE_KINDS)[number];

export const PARTNER_DIFFERENCE_FIELDS = [
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
  "contact",
  "message",
  "stage",
] as const;
export type PartnerDifferenceField = (typeof PARTNER_DIFFERENCE_FIELDS)[number];
export const PARTNER_DIFFERENCE_FIELD_LABELS: Record<PartnerDifferenceField, string> = {
  name: "Nome",
  city: "Città",
  country: "Paese",
  type_label: "Tipo",
  sections: "Sezioni",
  priority: "Priorità",
  contact_month: "Mese di contatto",
  event_starts_on: "Inizio dell’evento",
  event_ends_on: "Fine dell’evento",
  preferred_channel: "Canale preferito",
  contact: "Recapito",
  message: "Messaggio",
  stage: "Stato",
};
export const PARTNER_REVISION_KINDS = ["edit", "restore", "file"] as const;
export type PartnerRevisionKind = (typeof PARTNER_REVISION_KINDS)[number];
export const PARTNER_DEVICES = ["telefono", "computer"] as const;
export type PartnerDevice = (typeof PARTNER_DEVICES)[number];

/** I quattro testi modificabili di una variante, con i limiti di partner_message_variants. */
export const PARTNER_MESSAGE_FIELDS = ["subject", "body", "follow_up", "confirm_email"] as const;
export type PartnerMessageField = (typeof PARTNER_MESSAGE_FIELDS)[number];
export const PARTNER_MESSAGE_LIMITS: Record<PartnerMessageField, number> = {
  subject: 300,
  body: 8000,
  follow_up: 4000,
  confirm_email: 4000,
};
export type PartnerMessageTexts = Record<PartnerMessageField, string>;

/** Codice del contatto nella ricerca (`L014`, `n111`): source_key nel database. */
export const PARTNER_SOURCE_KEY = /^[A-Za-z0-9]{1,20}$/;
export const PARTNER_NAME_MAX = 240;
export const PARTNER_CO_MAX = 99999;
export const PARTNER_VERSION_MAX = 9007199254740991;

const includes = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);
export const isPartnerStage = (value: unknown): value is PartnerStage =>
  includes(PARTNER_STAGES, value);
export const isPartnerApproach = (value: unknown): value is PartnerApproach =>
  includes(PARTNER_APPROACHES, value);
export const isPartnerSection = (value: unknown): value is PartnerSection =>
  includes(PARTNER_SECTIONS, value);
export const isPartnerPriority = (value: unknown): value is PartnerPriority =>
  includes(PARTNER_PRIORITIES, value);
export const isPartnerChannel = (value: unknown): value is PartnerChannel =>
  includes(PARTNER_CHANNELS, value);
export const isPartnerContactKind = (value: unknown): value is PartnerContactKind =>
  includes(PARTNER_CONTACT_KINDS, value);
export const isPartnerVariantChannel = (value: unknown): value is PartnerVariantChannel =>
  includes(PARTNER_VARIANT_CHANNELS, value);
export const isPartnerLanguage = (value: unknown): value is PartnerLanguage =>
  includes(PARTNER_LANGUAGES, value);
export const isPartnerLookbookCode = (value: unknown): value is PartnerLookbookCode =>
  includes(PARTNER_LOOKBOOK_CODES, value);
export const isPartnerActivityKind = (value: unknown): value is PartnerActivityKind =>
  includes(PARTNER_ACTIVITY_KINDS, value);
export const isPartnerActivityChannel = (value: unknown): value is PartnerActivityChannel =>
  includes(PARTNER_ACTIVITY_CHANNELS, value);

/** UUID come lo accetta private.partner_uuid (maiuscole e minuscole). */
export const isPartnerId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(value);
export const isPartnerCo = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= PARTNER_CO_MAX;

/** Lunghezza in caratteri come char_length di PostgreSQL (punti di codice, non unità UTF-16). */
export function charCount(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

/** Caratteri rifiutati da private.partner_text: controllo tranne tab, a capo e ritorno a capo. */
export function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

/** Avviso in cima alle pagine Partner nell'anteprima locale (00-sequenza §1.5). */
export const PARTNER_PREVIEW_NOTICE = "Anteprima locale: dati sintetici, salvataggio disattivato.";

/** «CO 007»: tre cifre, di più solo oltre 999. */
export const formatCo = (co: number) => `CO ${String(co).padStart(3, "0")}`;

// ---------------------------------------------------------------------------
// Righe lette dal database
// ---------------------------------------------------------------------------

export class PartnerReadError extends Error {
  constructor(what = "Partner") {
    super(`${what}: lettura non valida. Ricarica la pagina.`);
  }
}

/** La scheda come serve alla lista: niente testi della ricerca, solo percorso e follower. */
export type PartnerSummary = {
  id: string;
  co: number;
  sourceKey: string | null;
  origin: "research" | "team";
  name: string;
  city: string;
  country: string;
  typeLabel: string;
  sections: PartnerSection[];
  priority: PartnerPriority;
  /** «AAAA-MM-01». */
  contactMonth: string;
  eventStartsOn: string | null;
  eventEndsOn: string | null;
  applicationDeadline: string | null;
  preferredChannel: PartnerChannel;
  researchRemovedAt: string | null;
  stage: PartnerStage;
  stageFromFileAt: string | null;
  ownerId: string | null;
  nextAction: string | null;
  nextActionOn: string | null;
  chosenApproach: PartnerApproach | null;
  approachFromFileAt: string | null;
  version: number;
  updatedAt: string;
  /** research->>route: «Come.» nella riga. */
  route: string;
  /** research->>followers. */
  followers: string;
};

/** Recapito senza il testo intero: basta il valore pulito per i pulsanti e i blocchi per dominio. */
export type PartnerContactLink = {
  id: string;
  partnerId: string;
  kind: PartnerContactKind;
  linkValue: string | null;
  label: string;
  verified: boolean;
  active: boolean;
  position: number;
  version: number;
};

/** Indice delle varianti: nessun testo dei messaggi nella lista. */
export type PartnerVariantSummary = {
  id: string;
  partnerId: string;
  approach: PartnerApproach;
  channel: PartnerVariantChannel;
  language: PartnerLanguage;
  lookbookCode: PartnerLookbookCode | null;
  /** Vale un testo del team (current_revision_id non nullo). */
  edited: boolean;
  originalChangedAt: string | null;
  researchRemovedAt: string | null;
  version: number;
};

export type PartnerOpenDifference = {
  id: string;
  partnerId: string;
  origin: "research" | "file";
  field: PartnerDifferenceField;
  variantId: string | null;
  contactId: string | null;
};

export type PartnerBlock = {
  id: string;
  partnerId: string | null;
  domain: string | null;
  reason: string;
  createdAt: string;
};

export type PartnerMember = { id: string; name: string; active: boolean };

export type PartnerResearchImport = {
  id: string;
  sourceCommit: string;
  sourceGenerated: string;
  appliedAt: string;
  partnersTotal: number;
  partnersNew: number;
  partnersUpdated: number;
  partnersRemoved: number;
  variantsTotal: number;
  differencesNew: number;
};

export type PartnerWorkspace = {
  partners: PartnerSummary[];
  contacts: PartnerContactLink[];
  variants: PartnerVariantSummary[];
  differences: PartnerOpenDifference[];
  blocks: PartnerBlock[];
  members: PartnerMember[];
  lastImport: PartnerResearchImport | null;
};

export type PartnerResearchExtra = {
  section: string;
  name: string;
  when: string;
  route: string;
  application: string;
};
/** Testi della ricerca, in sola lettura. Un campo di tipo inatteso vale vuoto. */
export type PartnerResearch = {
  why: string;
  description: string;
  idea: Partial<Record<PartnerSection, string>>;
  pitch: string;
  hero: string[];
  when: string;
  route: string;
  dateNote: string;
  application: string;
  cost: string;
  followers: string;
  flags: string;
  lang: string;
  sources: string[];
  extra: PartnerResearchExtra[];
  /** Approcci scartati dalla ricerca (varianti.json). */
  skippedIt: string;
};
export type PartnerDetailPartner = PartnerSummary & {
  research: PartnerResearch;
  createdAt: string;
  createdBy: string | null;
};

export type PartnerContact = PartnerContactLink & {
  /** Testo intero; nullo se il dato è stato cancellato. */
  value: string | null;
  researchSlot: PartnerContactKind | null;
  erasedAt: string | null;
  createdAt: string;
};

export type PartnerRevision = {
  id: string;
  variantId: string;
  revisionNo: number;
  kind: PartnerRevisionKind;
  /** Nullo per `restore`. */
  texts: PartnerMessageTexts | null;
  fileExportedAt: string | null;
  createdBy: string;
  createdAt: string;
};

export type PartnerVariant = {
  id: string;
  partnerId: string;
  approach: PartnerApproach;
  origin: "research" | "team";
  channel: PartnerVariantChannel;
  language: PartnerLanguage;
  to: string;
  cc: string;
  lookbookCode: PartnerLookbookCode | null;
  original: PartnerMessageTexts;
  gist: string;
  notes: string;
  formFields: string;
  currentRevisionId: string | null;
  originalChangedAt: string | null;
  researchRemovedAt: string | null;
  version: number;
};
export type PartnerVariantDetail = PartnerVariant & {
  /** Testo in uso: la revisione corrente o l'originale. */
  current: PartnerMessageTexts;
  /** Revisione in uso; nulla se vale l'originale. */
  currentRevision: PartnerRevision | null;
  /** Ultime revisioni, dalla più recente. */
  revisions: PartnerRevision[];
  revisionCount: number;
};

export type PartnerActivity = {
  id: string;
  operationId: string;
  partnerId: string;
  partnerName: string;
  partnerCo: number;
  kind: PartnerActivityKind;
  origin: "team" | "file";
  occurredAt: string;
  messageKind: PartnerMessageKind | null;
  channel: PartnerActivityChannel | null;
  approach: PartnerApproach | null;
  stageBefore: PartnerStage | null;
  stageAfter: PartnerStage | null;
  ownerAfter: string | null;
  nextActionOn: string | null;
  body: string;
  createdBy: string;
  createdAt: string;
  /** Dispositivo del file, per le righe con origine `file`. */
  device: PartnerDevice | null;
};

export type PartnerDifference = PartnerOpenDifference & {
  teamValue: unknown;
  incomingValue: unknown;
  createdAt: string;
  deviceImportId: string | null;
  /** Per le differenze dai file: dispositivo e data di esportazione. */
  device: PartnerDevice | null;
  fileExportedAt: string | null;
};

export type PartnerDetail = {
  partner: PartnerDetailPartner;
  contacts: PartnerContact[];
  variants: PartnerVariantDetail[];
  activities: PartnerActivity[];
  activityCount: number;
  differences: PartnerDifference[];
  /** Blocchi attivi che valgono per questo contatto (suo o del suo dominio). */
  blocks: PartnerBlock[];
};

export type PartnerDeviceImport = {
  id: string;
  operationId: string;
  device: PartnerDevice;
  exportedAt: string;
  stagesApplied: number;
  textsApplied: number;
  approachesApplied: number;
  differences: number;
  ignored: number;
  unknown: number;
  importedBy: string;
  importedAt: string;
};

const fail = (what: string): never => {
  throw new PartnerReadError(what);
};
const row = (value: unknown, what: string): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(what);
const text = (value: unknown, max: number, what: string): string =>
  typeof value === "string" && charCount(value) <= max ? value : fail(what);
const optionalText = (value: unknown, max: number, what: string): string | null =>
  value === null ? null : text(value, max, what);
const id = (value: unknown, what: string): string => (isPartnerId(value) ? value : fail(what));
const optionalId = (value: unknown, what: string): string | null =>
  value === null ? null : id(value, what);
const integer = (value: unknown, min: number, max: number, what: string): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : fail(what);
const version = (value: unknown, what: string) => integer(value, 1, PARTNER_VERSION_MAX, what);
const counter = (value: unknown, what: string) => integer(value, 0, 2147483647, what);
const bool = (value: unknown, what: string): boolean =>
  typeof value === "boolean" ? value : fail(what);
const instant = (value: unknown, what: string): string =>
  typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value))
    ? value
    : fail(what);
const optionalInstant = (value: unknown, what: string): string | null =>
  value === null ? null : instant(value, what);
const day = (value: unknown, what: string): string => (isCalendarDay(value) ? value : fail(what));
const optionalDay = (value: unknown, what: string): string | null =>
  value === null ? null : day(value, what);
function oneOf<T extends string>(list: readonly T[], value: unknown, what: string): T {
  return includes(list, value) ? value : fail(what);
}
function optionalOneOf<T extends string>(list: readonly T[], value: unknown, what: string) {
  return value === null ? null : oneOf(list, value, what);
}

function sections(value: unknown, what: string): PartnerSection[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 3 ||
    !value.every(isPartnerSection) ||
    new Set(value).size !== value.length
  )
    fail(what);
  // Ordine canonico, come lo salva private.partner_sections.
  return PARTNER_SECTIONS.filter((section) => (value as string[]).includes(section));
}

/** Riga di `partners` letta con le colonne della lista (PARTNER_SUMMARY_COLUMNS). */
export function parsePartnerSummary(value: unknown): PartnerSummary {
  const what = "Contatto";
  const r = row(value, what);
  const origin = oneOf(["research", "team"] as const, r.origin, what);
  const sourceKey =
    r.source_key === null
      ? null
      : typeof r.source_key === "string" && PARTNER_SOURCE_KEY.test(r.source_key)
        ? r.source_key
        : fail(what);
  if ((origin === "research") !== (sourceKey !== null)) fail(what);
  const name = text(r.name, PARTNER_NAME_MAX, what);
  if (name.trim() === "" || name !== name.trim()) fail(what);
  const contactMonth = isMonthStart(r.contact_month) ? r.contact_month : fail(what);
  const eventStartsOn = optionalDay(r.event_starts_on, what);
  const eventEndsOn = optionalDay(r.event_ends_on, what);
  if (eventEndsOn !== null && (eventStartsOn === null || eventEndsOn < eventStartsOn)) fail(what);
  const nextAction = optionalText(r.next_action, 240, what);
  const nextActionOn = optionalDay(r.next_action_on, what);
  if ((nextAction === null) !== (nextActionOn === null) || nextAction?.trim() === "") fail(what);
  const chosenApproach = optionalOneOf(PARTNER_APPROACHES, r.chosen_approach, what);
  const approachFromFileAt = optionalInstant(r.approach_from_file_at, what);
  if (approachFromFileAt !== null && chosenApproach === null) fail(what);
  return {
    id: id(r.id, what),
    co: isPartnerCo(r.co) ? r.co : fail(what),
    sourceKey,
    origin,
    name,
    city: text(r.city, 240, what),
    country: text(r.country, 120, what),
    typeLabel: text(r.type_label, 120, what),
    sections: sections(r.sections, what),
    priority: oneOf(PARTNER_PRIORITIES, r.priority, what),
    contactMonth,
    eventStartsOn,
    eventEndsOn,
    applicationDeadline: optionalDay(r.application_deadline, what),
    preferredChannel: oneOf(PARTNER_CHANNELS, r.preferred_channel, what),
    researchRemovedAt: optionalInstant(r.research_removed_at, what),
    stage: oneOf(PARTNER_STAGES, r.stage, what),
    stageFromFileAt: optionalInstant(r.stage_from_file_at, what),
    ownerId: optionalId(r.owner_id, what),
    nextAction,
    nextActionOn,
    chosenApproach,
    approachFromFileAt,
    version: version(r.version, what),
    updatedAt: instant(r.updated_at, what),
    // Campi della ricerca letti con research->>…: testo o assenti.
    route: typeof r.route === "string" ? r.route : r.route == null ? "" : fail(what),
    followers:
      typeof r.followers === "string" ? r.followers : r.followers == null ? "" : fail(what),
  };
}

const researchString = (value: unknown) => (typeof value === "string" ? value : "");
const researchStrings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** `research` jsonb: deve essere un oggetto; i singoli campi di tipo inatteso valgono vuoti. */
export function parsePartnerResearch(value: unknown): PartnerResearch {
  const r = row(value, "Ricerca del contatto");
  const idea: Partial<Record<PartnerSection, string>> = {};
  if (r.idea !== null && typeof r.idea === "object" && !Array.isArray(r.idea))
    for (const section of PARTNER_SECTIONS) {
      const item = (r.idea as Record<string, unknown>)[section];
      if (typeof item === "string" && item.trim() !== "") idea[section] = item;
    }
  const extra = Array.isArray(r.extra)
    ? r.extra.flatMap((item) => {
        if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
        const x = item as Record<string, unknown>;
        return [
          {
            section: researchString(x.section),
            name: researchString(x.name),
            when: researchString(x.when),
            route: researchString(x.route),
            application: researchString(x.application),
          },
        ];
      })
    : [];
  return {
    why: researchString(r.why),
    description: researchString(r.description),
    idea,
    pitch: researchString(r.pitch),
    hero: researchStrings(r.hero),
    when: researchString(r.when),
    route: researchString(r.route),
    dateNote: researchString(r.date_note),
    application: researchString(r.application),
    cost: researchString(r.cost),
    followers: researchString(r.followers),
    flags: researchString(r.flags),
    lang: researchString(r.lang),
    // Solo indirizzi http(s): niente javascript: o data: nei link delle fonti.
    sources: researchStrings(r.sources).filter((url) =>
      /^https?:\/\/[^\s/?#@]+(?:[/?#]\S*)?$/i.test(url),
    ),
    extra,
    skippedIt: researchString(r.skipped_it),
  };
}

/** Riga di `partners` con tutte le colonne del dettaglio (PARTNER_DETAIL_COLUMNS). */
export function parsePartnerDetailRow(value: unknown): PartnerDetailPartner {
  const r = row(value, "Contatto");
  const research = parsePartnerResearch(r.research);
  return {
    ...parsePartnerSummary({ ...r, route: research.route, followers: research.followers }),
    research,
    createdAt: instant(r.created_at, "Contatto"),
    createdBy: optionalId(r.created_by, "Contatto"),
  };
}

export function parsePartnerContactLink(value: unknown): PartnerContactLink {
  const what = "Recapito";
  const r = row(value, what);
  return {
    id: id(r.id, what),
    partnerId: id(r.partner_id, what),
    kind: oneOf(PARTNER_CONTACT_KINDS, r.kind, what),
    linkValue: optionalText(r.link_value, 2048, what),
    label: text(r.label, 120, what),
    verified: bool(r.verified, what),
    active: bool(r.active, what),
    position: integer(r.position, 0, 32000, what),
    version: version(r.version, what),
  };
}

export function parsePartnerContact(value: unknown): PartnerContact {
  const what = "Recapito";
  const r = row(value, what);
  const contact = parsePartnerContactLink(r);
  const valueText = optionalText(r.value, 500, what);
  const erasedAt = optionalInstant(r.erased_at, what);
  if ((erasedAt === null) !== (valueText !== null)) fail(what);
  if (erasedAt !== null && (contact.active || contact.linkValue !== null)) fail(what);
  return {
    ...contact,
    value: valueText,
    researchSlot: optionalOneOf(PARTNER_CONTACT_KINDS, r.research_slot, what),
    erasedAt,
    createdAt: instant(r.created_at, what),
  };
}

export function parsePartnerVariantSummary(value: unknown): PartnerVariantSummary {
  const what = "Messaggio";
  const r = row(value, what);
  const currentRevisionId = optionalId(r.current_revision_id, what);
  const originalChangedAt = optionalInstant(r.original_changed_at, what);
  if (originalChangedAt !== null && currentRevisionId === null) fail(what);
  return {
    id: id(r.id, what),
    partnerId: id(r.partner_id, what),
    approach: oneOf(PARTNER_APPROACHES, r.approach, what),
    channel: oneOf(PARTNER_VARIANT_CHANNELS, r.channel, what),
    language: oneOf(PARTNER_LANGUAGES, r.language, what),
    lookbookCode: optionalOneOf(PARTNER_LOOKBOOK_CODES, r.lookbook_code, what),
    edited: currentRevisionId !== null,
    originalChangedAt,
    researchRemovedAt: optionalInstant(r.research_removed_at, what),
    version: version(r.version, what),
  };
}

function texts(
  r: Record<string, unknown>,
  prefix: "" | "original_",
  what: string,
): PartnerMessageTexts {
  return {
    subject: text(r[`${prefix}subject`], PARTNER_MESSAGE_LIMITS.subject, what),
    body: text(r[`${prefix}body`], PARTNER_MESSAGE_LIMITS.body, what),
    follow_up: text(r[`${prefix}follow_up`], PARTNER_MESSAGE_LIMITS.follow_up, what),
    confirm_email: text(r[`${prefix}confirm_email`], PARTNER_MESSAGE_LIMITS.confirm_email, what),
  };
}

export function parsePartnerVariant(value: unknown): PartnerVariant {
  const what = "Messaggio";
  const r = row(value, what);
  const summary = parsePartnerVariantSummary(r);
  return {
    id: summary.id,
    partnerId: summary.partnerId,
    approach: summary.approach,
    origin: oneOf(["research", "team"] as const, r.origin, what),
    channel: summary.channel,
    language: summary.language,
    to: text(r.to_text, 500, what),
    cc: text(r.cc_text, 500, what),
    lookbookCode: summary.lookbookCode,
    original: texts(r, "original_", what),
    gist: text(r.gist_it, 2000, what),
    notes: text(r.notes_it, 4000, what),
    formFields: text(r.form_fields_it, 4000, what),
    currentRevisionId: optionalId(r.current_revision_id, what),
    originalChangedAt: summary.originalChangedAt,
    researchRemovedAt: summary.researchRemovedAt,
    version: summary.version,
  };
}

export function parsePartnerRevision(value: unknown): PartnerRevision {
  const what = "Versione del messaggio";
  const r = row(value, what);
  const kind = oneOf(PARTNER_REVISION_KINDS, r.kind, what);
  const fileExportedAt = optionalInstant(r.file_exported_at, what);
  if ((kind === "file") !== (fileExportedAt !== null)) fail(what);
  const empty = PARTNER_MESSAGE_FIELDS.every((field) => r[field] === null);
  if ((kind === "restore") !== empty) fail(what);
  return {
    id: id(r.id, what),
    variantId: id(r.variant_id, what),
    revisionNo: integer(r.revision_no, 1, 100000, what),
    kind,
    texts: kind === "restore" ? null : texts(r, "", what),
    fileExportedAt,
    createdBy: id(r.created_by, what),
    createdAt: instant(r.created_at, what),
  };
}

export function parsePartnerActivity(value: unknown): PartnerActivity {
  const what = "Registro";
  const r = row(value, what);
  const kind = oneOf(PARTNER_ACTIVITY_KINDS, r.kind, what);
  const messageKind = optionalOneOf(PARTNER_MESSAGE_KINDS, r.message_kind, what);
  if ((messageKind !== null) !== (kind === "inviato")) fail(what);
  const name = text(r.partner_name, PARTNER_NAME_MAX, what);
  return {
    id: id(r.id, what),
    operationId: id(r.operation_id, what),
    partnerId: id(r.partner_id, what),
    partnerName: name,
    partnerCo: isPartnerCo(r.partner_co) ? r.partner_co : fail(what),
    kind,
    origin: oneOf(["team", "file"] as const, r.origin, what),
    occurredAt: instant(r.occurred_at, what),
    messageKind,
    channel: optionalOneOf(PARTNER_ACTIVITY_CHANNELS, r.channel, what),
    approach: optionalOneOf(PARTNER_APPROACHES, r.approach, what),
    stageBefore: optionalOneOf(PARTNER_STAGES, r.stage_before, what),
    stageAfter: optionalOneOf(PARTNER_STAGES, r.stage_after, what),
    ownerAfter: optionalId(r.owner_after, what),
    nextActionOn: optionalDay(r.next_action_on, what),
    body: text(r.body, 4000, what),
    createdBy: id(r.created_by, what),
    createdAt: instant(r.created_at, what),
    device: null,
  };
}

export function parsePartnerOpenDifference(value: unknown): PartnerOpenDifference {
  const what = "Differenza";
  const r = row(value, what);
  const field = oneOf(PARTNER_DIFFERENCE_FIELDS, r.field, what);
  const variantId = optionalId(r.variant_id, what);
  const contactId = optionalId(r.contact_id, what);
  if (
    (field === "message") !== (variantId !== null) ||
    (field === "contact") !== (contactId !== null)
  )
    fail(what);
  return {
    id: id(r.id, what),
    partnerId: id(r.partner_id, what),
    origin: oneOf(["research", "file"] as const, r.origin, what),
    field,
    variantId,
    contactId,
  };
}

export function parsePartnerDifference(value: unknown): PartnerDifference {
  const what = "Differenza";
  const r = row(value, what);
  const difference = parsePartnerOpenDifference(r);
  const deviceImportId = optionalId(r.device_import_id, what);
  if ((difference.origin === "file") !== (deviceImportId !== null)) fail(what);
  return {
    ...difference,
    teamValue: r.team_value ?? null,
    incomingValue: r.incoming_value ?? null,
    createdAt: instant(r.created_at, what),
    deviceImportId,
    device: null,
    fileExportedAt: null,
  };
}

export function parsePartnerBlock(value: unknown): PartnerBlock {
  const what = "Lista «Non contattare»";
  const r = row(value, what);
  const partnerId = optionalId(r.partner_id, what);
  const domain = optionalText(r.domain, 253, what);
  if (partnerId === null && domain === null) fail(what);
  const reason = text(r.reason, 500, what);
  if (charCount(reason.trim()) < 3) fail(what);
  return { id: id(r.id, what), partnerId, domain, reason, createdAt: instant(r.created_at, what) };
}

export function parsePartnerResearchImport(value: unknown): PartnerResearchImport {
  const what = "Import della ricerca";
  const r = row(value, what);
  const sourceCommit =
    typeof r.source_commit === "string" && /^[0-9a-f]{7,40}$/.test(r.source_commit)
      ? r.source_commit
      : fail(what);
  return {
    id: id(r.id, what),
    sourceCommit,
    sourceGenerated: day(r.source_generated, what),
    appliedAt: instant(r.applied_at, what),
    partnersTotal: counter(r.partners_total, what),
    partnersNew: counter(r.partners_new, what),
    partnersUpdated: counter(r.partners_updated, what),
    partnersRemoved: counter(r.partners_removed, what),
    variantsTotal: counter(r.variants_total, what),
    differencesNew: counter(r.differences_new, what),
  };
}

export function parsePartnerDeviceImport(value: unknown): PartnerDeviceImport {
  const what = "File importato";
  const r = row(value, what);
  return {
    id: id(r.id, what),
    operationId: id(r.operation_id, what),
    device: oneOf(PARTNER_DEVICES, r.device, what),
    exportedAt: instant(r.exported_at, what),
    stagesApplied: counter(r.stages_applied, what),
    textsApplied: counter(r.texts_applied, what),
    approachesApplied: counter(r.approaches_applied, what),
    differences: counter(r.differences, what),
    ignored: counter(r.ignored, what),
    unknown: counter(r.unknown, what),
    importedBy: id(r.imported_by, what),
    importedAt: instant(r.imported_at, what),
  };
}

// ---------------------------------------------------------------------------
// Testi derivati
// ---------------------------------------------------------------------------

/** Varianti da mostrare: quelle sparite dalla ricerca restano solo con un testo del team. */
export const isVisibleVariant = (variant: {
  researchRemovedAt: string | null;
  edited?: boolean;
  currentRevisionId?: string | null;
}) =>
  variant.researchRemovedAt === null ||
  variant.edited === true ||
  (variant.currentRevisionId !== undefined && variant.currentRevisionId !== null);

/** «3 messaggi pronti», «Messaggio pronto», oppure niente. */
export function readyMessagesLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "Messaggio pronto" : `${count} messaggi pronti`;
}

/** Nome del membro, «un ex membro» se il profilo non c'è più nell'elenco. */
export function memberName(members: readonly PartnerMember[], userId: string | null): string {
  if (userId === null) return "Nessuno";
  return members.find((member) => member.id === userId)?.name ?? "un ex membro";
}

/**
 * Riga del registro senza giorno e autore: «Inviato via email (Collab)», «Sollecito inviato via
 * email», «Stato: Ha risposto», «Seguito da Luca». Le righe dai file mostrano lo stato applicato.
 */
export function partnerActivityText(
  activity: PartnerActivity,
  members: readonly PartnerMember[] = [],
): string {
  const approach = activity.approach ? ` (${PARTNER_APPROACH_LABELS[activity.approach]})` : "";
  const channel = activity.channel
    ? activity.channel === "visita"
      ? " di persona"
      : ` via ${PARTNER_ACTIVITY_CHANNEL_LABELS[activity.channel]}`
    : "";
  const stage = activity.stageAfter ? PARTNER_STAGE_LABELS[activity.stageAfter] : null;
  if (activity.origin === "file" && stage && activity.stageBefore !== activity.stageAfter)
    return stage;
  switch (activity.kind) {
    case "inviato":
      return `${activity.messageKind === "sollecito" ? "Sollecito inviato" : "Inviato"}${channel}${approach}`;
    case "risposta":
    case "chiamata":
    case "incontro":
      return `${PARTNER_ACTIVITY_KIND_LABELS[activity.kind]}${channel}`;
    case "nota":
      return "Nota";
    case "stato":
    case "differenza":
      return stage && activity.stageBefore !== activity.stageAfter
        ? `${activity.kind === "stato" ? "Stato" : "Differenza risolta. Stato"}: ${stage}`
        : PARTNER_ACTIVITY_KIND_LABELS[activity.kind];
    case "responsabile":
      return activity.ownerAfter
        ? `Seguito da ${memberName(members, activity.ownerAfter)}`
        : "Nessun responsabile";
    case "prossima_azione":
      return activity.nextActionOn
        ? `Prossima azione: ${shortDay(activity.nextActionOn)}`
        : "Prossima azione tolta";
    case "approccio":
    case "messaggio":
    case "ripristino":
      return `${PARTNER_ACTIVITY_KIND_LABELS[activity.kind]}${approach}`;
    default:
      return PARTNER_ACTIVITY_KIND_LABELS[activity.kind];
  }
}

/** «22 ott · Tommi · Inviato via email (Collab)», «20 ott · dal file del telefono · Contattato». */
export function partnerActivityLine(
  activity: PartnerActivity,
  members: readonly PartnerMember[] = [],
): string {
  const dayValue = instantDay(activity.occurredAt);
  const when = dayValue ? shortDay(dayValue) : "";
  const who =
    activity.origin === "file"
      ? activity.device
        ? `dal file del ${activity.device}`
        : "da un file"
      : memberName(members, activity.createdBy);
  return [when, who, partnerActivityText(activity, members)].filter(Boolean).join(" · ");
}

/** Un «inviato» degli ultimi 10 minuti: «Già segnato inviato alle 10:42 da Luca. Segnare di nuovo?». */
export function recentSentActivity(
  activities: readonly PartnerActivity[],
  now: Date,
  messageKind: PartnerMessageKind = "primo",
): PartnerActivity | null {
  const limit = now.getTime() - 10 * 60 * 1000;
  return (
    activities.find(
      (activity) =>
        activity.kind === "inviato" &&
        activity.origin === "team" &&
        activity.messageKind === messageKind &&
        Date.parse(activity.createdAt) >= limit &&
        Date.parse(activity.createdAt) <= now.getTime() + 60 * 1000,
    ) ?? null
  );
}

export function recentSentQuestion(
  activity: PartnerActivity,
  members: readonly PartnerMember[] = [],
): string {
  const time = instantTime(activity.createdAt) ?? "";
  const what = activity.messageKind === "sollecito" ? "il sollecito" : "inviato";
  return `Già segnato ${what} alle ${time} da ${memberName(members, activity.createdBy)}. Segnare di nuovo?`;
}

/** Piede della pagina: «Ricerca del 21 ottobre 2026, importata il 23 ottobre (commit f6ad90c).» */
export function researchImportLine(entry: PartnerResearchImport, today: string): string {
  const applied = instantDay(entry.appliedAt);
  return `Ricerca del ${longDay(entry.sourceGenerated)}, importata il ${applied ? longDay(applied, today) : "giorno non leggibile"} (commit ${entry.sourceCommit.slice(0, 7)}).`;
}

/** «Non contattare: Ha chiesto di non…»: motivo breve per la riga, al massimo 60 caratteri. */
export function shortReason(reason: string): string {
  const plain = reason.replace(/\s+/g, " ").trim();
  const sentence = /^(.{3,60}?[.;:!?])(\s|$)/.exec(plain)?.[1] ?? plain;
  const chars = [...sentence];
  return chars.length <= 60
    ? sentence
    : `${chars
        .slice(0, 59)
        .join("")
        .replace(/\s+\S*$/, "")}…`;
}
