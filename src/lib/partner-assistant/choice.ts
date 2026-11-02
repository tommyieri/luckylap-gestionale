// La scelta dell'assistente Partner: lettura della risposta dell'estrazione, proposta e decisione.
// L'IA classifica soltanto il contatto; la proposta, la riga della maglietta co-firmata e la
// decisione le prende il codice.
import { partnerLinkValue } from "../partner/contacts";
import { daysBetween, isCalendarDay } from "../partner/dates";
import { charCount, hasControlCharacters } from "../partner/model";
import { PARTNER_ASSISTANT_CHOICE_KEYS, partnerAssistantChoiceFields } from "./choice-fields";
import type {
  PartnerAssistantChoice,
  PartnerAssistantDecision,
  PartnerAssistantRequest,
} from "./types";

/** La scelta letta dall'estrazione: la richiesta la aggiunge partnerAssistantRequest. */
export type PartnerAssistantExtractedChoice = Omit<PartnerAssistantChoice, "request">;

// I limiti dei testi di complete_partner_assistant_choice (e di private.partner_date per le date
// più sotto): una scelta che il database rifiuta resterebbe senza esito certo e il passo si
// ripeterebbe senza consumare tentativi. Il database controlla lunghezza e caratteri di controllo
// come private.partner_text: qui con i suoi specchi in model.ts. NUL e coppie surrogate spezzate
// non entrano in jsonb.
const TEXT_MAX = 2000;
const storable = (value: unknown): boolean =>
  typeof value !== "string" ||
  (value.isWellFormed() && !hasControlCharacters(value) && charCount(value) <= TEXT_MAX);

const orEmpty = (value: string, valid: (value: string) => boolean) => value === "" || valid(value);
// La regola di link_value (private.partner_link_value): l'indirizzo o l'URL deve essere già il
// suo valore pulito, così si salva com'è nei recapiti.
const emailAddress = (value: string) => partnerLinkValue("email", value) === value;
const httpUrl = (value: string) => partnerLinkValue("web", value) === value;
// Un nome IANA, anche senza «/» (UTC, GMT): come private.partner_assistant_valid_timezone, che
// cerca il nome nella tabella dei fusi, copiata da pg_timezone_names. Intl accetta anche gli scarti
// («+01:00»), che non sono un fuso con l'ora legale e che PostgreSQL non elenca.
const timeZone = (value: string) => {
  if (/^[+-]/u.test(value)) return false;
  try {
    new Intl.DateTimeFormat("it", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

/** Il JSON dell'estrazione, con le chiavi snake_case dell'Appendice C, nella scelta camelCase.
 * Null se una chiave manca o è in più, o se un valore non va. */
export function parsePartnerAssistantChoice(
  value: unknown,
): PartnerAssistantExtractedChoice | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== PARTNER_ASSISTANT_CHOICE_KEYS.length ||
    !PARTNER_ASSISTANT_CHOICE_KEYS.every((key) => Object.hasOwn(row, key)) ||
    !Object.values(row).every(storable)
  )
    return null;
  const choice = partnerAssistantChoiceFields(row);
  if (
    !choice ||
    ![choice.writeOn, choice.factDate, choice.eventStartsOn].every((day) =>
      orEmpty(day, isCalendarDay),
    ) ||
    !orEmpty(choice.recipientEmail, emailAddress) ||
    !orEmpty(choice.recipientEmailSource, httpUrl) ||
    !orEmpty(choice.factSource, httpUrl) ||
    // La stringa vuota prima di Intl, che con "" lancia un'eccezione.
    !orEmpty(choice.timezone, timeZone)
  )
    return null;
  return choice;
}

/** La proposta, da un elenco chiuso (parere di Luca). */
export function partnerAssistantRequest(
  choice: Pick<PartnerAssistantChoice, "contactKind" | "eventReachable">,
): PartnerAssistantRequest {
  switch (choice.contactKind) {
    case "club":
      return "merch_cobranding";
    case "brand":
    case "media":
      return "collab_capsule";
    case "evento":
      return choice.eventReachable ? "stand_evento" : "merch_cobranding";
    case "negozio":
      return "vendita_negozio";
  }
}

// Le regole le citano parola per parola: non cambiarle senza cambiare le regole.
const MERCH_YES = "Maglietta co-firmata: puoi proporla";
const MERCH_NO = "Maglietta co-firmata: non proporla";
const MERCH_NEXT = "Maglietta co-firmata: per la prossima edizione";
/** La produzione dura un mese: «più di un mese» è oltre 31 giorni da oggi. */
const MONTH_DAYS = 31;

/** La riga sulla maglietta co-firmata per un evento, decisa dalle date; null se non è un evento.
 * Con lo stand serve più di un mese; con le magliette co-firmate di un evento lontano, a un mese
 * o meno si propongono per la prossima edizione. */
export function partnerAssistantEventMerch(
  choice: Pick<PartnerAssistantChoice, "contactKind" | "eventStartsOn" | "request">,
  today: string,
): string | null {
  if (choice.contactKind !== "evento") return null;
  const moreThanAMonth =
    choice.eventStartsOn !== "" && daysBetween(today, choice.eventStartsOn) > MONTH_DAYS;
  if (choice.request === "stand_evento") return moreThanAMonth ? MERCH_YES : MERCH_NO;
  if (choice.request === "merch_cobranding")
    return moreThanAMonth || choice.eventStartsOn === "" ? MERCH_YES : MERCH_NEXT;
  return null;
}

/** Se il momento giusto è più avanti si aspetta fino a quel giorno, quando si rifà la scelta, e
 * anche la ricerca se non è più buona (senza fatto o senza fuso non lo è); altrimenti, senza un fatto
 * vero da citare o senza il fuso del destinatario, il contatto passa a Tommi; altrimenti si scrive.
 * Fatto e fuso servono per scrivere, non per aspettare. */
export function partnerAssistantDecision(
  choice: Pick<PartnerAssistantChoice, "factText" | "timezone" | "writeNow" | "writeOn">,
  today: string,
): PartnerAssistantDecision {
  if (!choice.writeNow && choice.writeOn > today)
    return { kind: "attendi", writeOn: choice.writeOn };
  if (choice.factText.trim() === "") return { kind: "blocca", reason: "fatto_mancante" };
  if (choice.timezone === "") return { kind: "blocca", reason: "fuso_mancante" };
  return { kind: "scrivi" };
}
