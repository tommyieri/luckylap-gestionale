// Il ricontrollo delle date all'invio della prima email (specifica, «Bozze vecchie»; Q15 ridotta
// alla prima email). Modulo puro: niente server-only, niente rete. Si guarda solo il corpo della
// bozza, non la firma né la frase di uscita, che il sistema aggiunge dopo.
import { isCalendarDay, romeDay } from "../partner/dates";
import { partnerAssistantEventMerch } from "./choice";
import type { PartnerAssistantChoice } from "./types";

export type PartnerAssistantRecheckChoice = Pick<
  PartnerAssistantChoice,
  "contactKind" | "request" | "eventStartsOn"
>;

// I mesi in italiano, inglese, tedesco (anche «Maerz» e l'austriaco «Jänner»), francese (anche
// senza accenti) e spagnolo. Nessun nome vale due mesi diversi.
const MONTH_NAMES: Record<string, number> = {};
const languageMonths = (names: readonly string[]) =>
  names.forEach((name, index) => {
    for (const variant of name.split("|")) MONTH_NAMES[variant] = index + 1;
  });
languageMonths([
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
]);
languageMonths([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);
languageMonths([
  "januar|jänner|jaenner",
  "februar",
  "märz|maerz",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "dezember",
]);
languageMonths([
  "janvier",
  "février|fevrier",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août|aout",
  "septembre",
  "octobre",
  "novembre",
  "décembre|decembre",
]);
languageMonths([
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre|setiembre",
  "octubre",
  "noviembre",
  "diciembre",
]);

// I nomi più lunghi prima, anche se il confine dopo il mese basta già a scegliere quello giusto.
const MONTH = `(${Object.keys(MONTH_NAMES)
  .sort((a, b) => b.length - a.length)
  .join("|")})`;
// Confini: niente lettere o cifre attaccate (\b di JavaScript conosce solo l'ASCII).
const START = "(?<![\\p{L}\\p{N}])";
const END = "(?![\\p{L}\\p{N}])";
// Il giorno con il suffisso facoltativo: «19th», «19.», «1°», «7º», e «1er» del francese.
const DAY = "([0-9]{1,2})(?:st|nd|rd|th|er|º|°)?\\.?";
const YEAR = `([0-9]{4})${END}`;

type Found = { start: number; end: number; year: string | null; month: number; day: string };

// AAAA-MM-GG
const ISO = new RegExp(`${START}([0-9]{4})-([0-9]{2})-([0-9]{2})${END}`, "gu");
// G/M/AAAA e G.M.AAAA, con lo stesso separatore.
const NUMERIC = new RegExp(`${START}([0-9]{1,2})([./])([0-9]{1,2})\\2${YEAR}`, "gu");
// G [de] <mese> [[de] AAAA]
const DAY_MONTH = new RegExp(
  `${START}${DAY}\\s+(?:de\\s+)?${MONTH}${END}(?:,?\\s+(?:de\\s+)?${YEAR})?`,
  "giu",
);
// <mese> G[, AAAA]
const MONTH_DAY = new RegExp(`${START}${MONTH}\\s+${DAY}${END}(?:,?\\s+${YEAR})?`, "giu");

function* found(text: string): Generator<Found> {
  for (const m of text.matchAll(ISO))
    yield { start: m.index, end: m.index + m[0].length, year: m[1], month: +m[2], day: m[3] };
  for (const m of text.matchAll(NUMERIC))
    yield { start: m.index, end: m.index + m[0].length, year: m[4], month: +m[3], day: m[1] };
  for (const m of text.matchAll(DAY_MONTH))
    yield {
      start: m.index,
      end: m.index + m[0].length,
      year: m[3] ?? null,
      month: MONTH_NAMES[m[2].toLowerCase()],
      day: m[1],
    };
  for (const m of text.matchAll(MONTH_DAY))
    yield {
      start: m.index,
      end: m.index + m[0].length,
      year: m[3] ?? null,
      month: MONTH_NAMES[m[1].toLowerCase()],
      day: m[2],
    };
}

const pad = (value: number | string) => String(value).padStart(2, "0");

/** Le date ISO citate nel corpo, nell'ordine del testo. Senza anno vale l'anno di `writtenOn`,
 * più uno se la data viene prima di `writtenOn`. Una data che non esiste non conta. */
export function partnerAssistantBodyDates(body: string, writtenOn: string): string[] {
  if (!isCalendarDay(writtenOn)) throw new RangeError("Giorno non valido.");
  const text = body.normalize("NFC");
  const matches = [...found(text)].sort((a, b) => a.start - b.start || b.end - a.end);
  const dates: string[] = [];
  let covered = 0;
  for (const match of matches) {
    // Due forme sullo stesso pezzo di testo («3 gennaio 15» e «gennaio 15»): vale la prima.
    if (match.start < covered) continue;
    covered = match.end;
    const monthDay = `${pad(match.month)}-${pad(match.day)}`;
    let date: string;
    if (match.year !== null) date = `${match.year}-${monthDay}`;
    else {
      const year = Number(writtenOn.slice(0, 4));
      date = `${year}-${monthDay}`;
      if (date < writtenOn) date = `${year + 1}-${monthDay}`;
    }
    if (isCalendarDay(date)) dates.push(date);
  }
  return dates;
}

/** Il ricontrollo all'invio: la bozza è scaduta se l'evento della scelta è già iniziato, se la
 * riga della maglietta co-firmata è diversa tra il giorno della bozza e quello dell'invio, o se una
 * data citata nel corpo non è più futura. Il giorno della bozza è quello di Roma. Lancia con un
 * giorno d'invio o un momento della bozza non validi: mai un «ok» per sbaglio. */
export function partnerAssistantSendRecheck(
  input: { choice: PartnerAssistantRecheckChoice; body: string; draftCreatedAt: string },
  sendDay: string,
): { ok: true } | { ok: false; reason: "bozza_scaduta" } {
  if (!isCalendarDay(sendDay)) throw new RangeError("Giorno non valido.");
  const { choice, body } = input;
  const writtenOn = romeDay(new Date(input.draftCreatedAt));
  const expired = { ok: false, reason: "bozza_scaduta" } as const;
  if (choice.eventStartsOn !== "" && choice.eventStartsOn <= sendDay) return expired;
  if (partnerAssistantEventMerch(choice, writtenOn) !== partnerAssistantEventMerch(choice, sendDay))
    return expired;
  if (partnerAssistantBodyDates(body, writtenOn).some((date) => date <= sendDay)) return expired;
  return { ok: true };
}
