// Le chiavi e la lettura dei campi della scelta (Appendice C), in un modulo puro: le usano lo store,
// la lettura dell'estrazione (choice.ts) e lo schema dell'output strutturato (prompts.ts), che così
// non caricano lo store (server-only). Qui anche i controlli dei valori che lo store condivide.
import type { PartnerAssistantChoice } from "./types";

export const oneOf =
  <T extends string>(allowed: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === "string" && (allowed as readonly string[]).includes(value);
export const text = (value: unknown): value is string => typeof value === "string";
/** Un giorno reale `YYYY-MM-DD`. */
export const day = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const dayOrEmpty = (value: unknown): value is string => value === "" || day(value);
export const languages = oneOf(["it", "en", "de", "fr", "es"] as const);
const contactKinds = oneOf(["club", "brand", "media", "evento", "negozio"] as const);
const registers = oneOf(["voi", "lei", "you", "sie", "vous", "usted"] as const);

/** Le chiavi della scelta (Appendice C), senza la richiesta, che decide il codice. */
export const PARTNER_ASSISTANT_CHOICE_KEYS = [
  "contact_kind",
  "porsche_community",
  "reason_it",
  "write_now",
  "write_on",
  "recipient_email",
  "recipient_email_source",
  "recipient_email_published_by_org",
  "person_name",
  "person_title",
  "language",
  "register",
  "swiss",
  "timezone",
  "fact_text",
  "fact_date",
  "fact_source",
  "event_name",
  "event_starts_on",
  "event_city",
  "event_country",
  "event_reachable",
  "notes_it",
] as const;

/** I campi dell'Appendice C in camelCase: tipi, elenchi chiusi, date vuote o reali. Null se un
 * valore non va. Le chiavi le controlla chi chiama; serve anche alla lettura dell'estrazione. */
export function partnerAssistantChoiceFields(
  row: Record<string, unknown>,
): Omit<PartnerAssistantChoice, "request"> | null {
  const {
    contact_kind,
    porsche_community,
    reason_it,
    write_now,
    write_on,
    recipient_email,
    recipient_email_source,
    recipient_email_published_by_org,
    person_name,
    person_title,
    language,
    register,
    swiss,
    timezone,
    fact_text,
    fact_date,
    fact_source,
    event_name,
    event_starts_on,
    event_city,
    event_country,
    event_reachable,
    notes_it,
  } = row;
  if (
    !contactKinds(contact_kind) ||
    typeof porsche_community !== "boolean" ||
    !text(reason_it) ||
    typeof write_now !== "boolean" ||
    !dayOrEmpty(write_on) ||
    !text(recipient_email) ||
    !text(recipient_email_source) ||
    typeof recipient_email_published_by_org !== "boolean" ||
    !text(person_name) ||
    !text(person_title) ||
    !languages(language) ||
    !registers(register) ||
    typeof swiss !== "boolean" ||
    !text(timezone) ||
    !text(fact_text) ||
    !dayOrEmpty(fact_date) ||
    !text(fact_source) ||
    !text(event_name) ||
    !dayOrEmpty(event_starts_on) ||
    !text(event_city) ||
    !text(event_country) ||
    typeof event_reachable !== "boolean" ||
    !text(notes_it)
  )
    return null;
  return {
    contactKind: contact_kind,
    porscheCommunity: porsche_community,
    reasonIt: reason_it,
    writeNow: write_now,
    writeOn: write_on,
    recipientEmail: recipient_email,
    recipientEmailSource: recipient_email_source,
    recipientEmailPublishedByOrg: recipient_email_published_by_org,
    personName: person_name,
    personTitle: person_title,
    language,
    register,
    swiss,
    timezone,
    factText: fact_text,
    factDate: fact_date,
    factSource: fact_source,
    eventName: event_name,
    eventStartsOn: event_starts_on,
    eventCity: event_city,
    eventCountry: event_country,
    eventReachable: event_reachable,
    notesIt: notes_it,
  };
}
