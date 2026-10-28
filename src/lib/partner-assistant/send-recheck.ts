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

// Le abbreviazioni inglesi, solo con il punto («Nov. 19», «19 Dec. 2026»): senza il punto
// sarebbero parole comuni. Niente «Mar.»: è anche martedì e martes («mar. 19 novembre»), e
// prenderebbe il posto della data vera.
for (const [abbreviation, month] of [
  ["jan.", 1],
  ["feb.", 2],
  ["apr.", 4],
  ["jun.", 6],
  ["jul.", 7],
  ["aug.", 8],
  ["sep.", 9],
  ["sept.", 9],
  ["oct.", 10],
  ["nov.", 11],
  ["dec.", 12],
] as const)
  MONTH_NAMES[abbreviation] = month;

// I nomi più lunghi prima, anche se il confine dopo il mese basta già a scegliere quello giusto.
const MONTH = `(${Object.keys(MONTH_NAMES)
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(".", "\\."))
  .join("|")})`;
// Confini: niente lettere o cifre attaccate (\b di JavaScript conosce solo l'ASCII).
const START = "(?<![\\p{L}\\p{N}])";
const END = "(?![\\p{L}\\p{N}])";
// Il suffisso facoltativo del giorno: «19th», «19.», «1°», «7º», «1ª», e «1er» del francese.
const SUFFIX = "(?:st|nd|rd|th|er|º|°|ª)?\\.?";
const DAY = `([0-9]{1,2})${SUFFIX}`;
// Tra giorno e mese, o tra mese e anno: «de», «del», «of» («the 19th of November»).
const LINK = "(?:(?:de|del|of)\\s+)?";
const YEAR = `([0-9]{4})${END}`;
const YEAR_AFTER = `(?:,?\\s+${LINK}${YEAR})?`;
// Tra due giorni dello stesso mese: «19-21», «19/21», «19.-21.», «dal 19 al 21», «19 e 21»,
// «19, 20 e 21», «vom 19. bis 21.», «du 19 au 21», «del 19 al 21», «19 and 21».
const RANGE_LINK =
  "(?:\\s*[-–—,/]\\s*|\\s+(?:al|ai|e|ed|o|a|and|or|to|through|till|until|bis|und|oder|au|et|ou|à|y|hasta)\\s+)";

type Found = { start: number; end: number; year: string | null; month: number; day: string };

// AAAA-MM-GG, anche con l'ora attaccata («2026-11-19T10:00»).
const ISO = new RegExp(`${START}([0-9]{4})-([0-9]{2})-([0-9]{2})(?:T(?=[0-9])|${END})`, "gu");
// G/M/AAAA e G.M.AAAA, con lo stesso separatore; anche con l'anno a due cifre («19.11.26») o senza
// anno («19/11», «den 19.11.»). Mai dentro un numero puntato («v1.2.3», «5.000»).
const NUMERIC = new RegExp(
  `(?<![\\p{L}\\p{N}]|\\p{N}[./])([0-9]{1,2})([./])([0-9]{1,2})(?:\\2([0-9]{4}|[0-9]{2})|\\2?)(?![\\p{L}\\p{N}]|[./]\\p{N})`,
  "gu",
);
// G [de|del|of] <mese> [[,] [de|del|of] AAAA]
const DAY_MONTH = new RegExp(`${START}${DAY}\\s+${LINK}${MONTH}${END}${YEAR_AFTER}`, "giu");
// <mese> G[, AAAA]
const MONTH_DAY = new RegExp(`${START}${MONTH}\\s+${DAY}${END}${YEAR_AFTER}`, "giu");
// I giorni di un intervallo o di un elenco prima dell'ultimo («19» in «dal 19 al 21 novembre»):
// mese e anno vengono dall'ultimo giorno, che conta da sé con DAY_MONTH. Il pezzo trovato è solo il
// primo giorno, così non copre l'ultimo.
const RANGE = new RegExp(
  `${START}${DAY}(?=(?:${RANGE_LINK}[0-9]{1,2}${SUFFIX})+\\s+${LINK}${MONTH}${END}${YEAR_AFTER})`,
  "giu",
);

const monthOf = (name: string) => MONTH_NAMES[name.toLowerCase()];

function* found(text: string): Generator<Found> {
  for (const m of text.matchAll(ISO))
    yield { start: m.index, end: m.index + m[0].length, year: m[1], month: +m[2], day: m[3] };
  for (const m of text.matchAll(NUMERIC))
    yield {
      start: m.index,
      end: m.index + m[0].length,
      year: m[4] === undefined ? null : m[4].length === 2 ? `20${m[4]}` : m[4],
      month: +m[3],
      day: m[1],
    };
  for (const m of text.matchAll(DAY_MONTH))
    yield {
      start: m.index,
      end: m.index + m[0].length,
      year: m[3] ?? null,
      month: monthOf(m[2]),
      day: m[1],
    };
  for (const m of text.matchAll(MONTH_DAY))
    yield {
      start: m.index,
      end: m.index + m[0].length,
      year: m[3] ?? null,
      month: monthOf(m[1]),
      day: m[2],
    };
  for (const m of text.matchAll(RANGE))
    yield {
      start: m.index,
      end: m.index + m[0].length,
      year: m[3] ?? null,
      month: monthOf(m[2]),
      day: m[1],
    };
}

const pad = (value: number | string) => String(value).padStart(2, "0");

/** Le date ISO citate nel corpo, nell'ordine del testo. Senza anno vale l'anno di `writtenOn`,
 * più uno se la data viene prima di `writtenOn`. Una data che non esiste non conta. */
export function partnerAssistantBodyDates(body: string, writtenOn: string): string[] {
  if (!isCalendarDay(writtenOn)) throw new RangeError("Giorno non valido.");
  const year = Number(writtenOn.slice(0, 4));
  const text = body.normalize("NFC");
  // Prima si scartano le date che non esistono («19/21» di «19/21 novembre»), così non coprono
  // quelle vere nello stesso pezzo di testo.
  const matches = [...found(text)]
    .flatMap((match) => {
      const monthDay = `${pad(match.month)}-${pad(match.day)}`;
      let date: string;
      if (match.year !== null) date = `${match.year}-${monthDay}`;
      else {
        date = `${year}-${monthDay}`;
        if (date < writtenOn) date = `${year + 1}-${monthDay}`;
      }
      return isCalendarDay(date) ? [{ start: match.start, end: match.end, date }] : [];
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const dates: string[] = [];
  let covered = 0;
  for (const match of matches) {
    // Due forme sullo stesso pezzo di testo («3 gennaio 15» e «gennaio 15»): vale la prima.
    if (match.start < covered) continue;
    covered = match.end;
    dates.push(match.date);
  }
  return dates;
}

/** Il ricontrollo all'invio: la bozza è scaduta se l'evento della scelta è già iniziato, se la
 * riga della maglietta co-firmata è diversa tra il giorno della bozza e quello dell'invio, o se una
 * data citata nel corpo non è più futura. Il giorno della bozza è quello di Roma. Lancia con un
 * giorno d'invio o un momento della bozza non validi: mai un «ok» per sbaglio.
 *
 * «Non più futura» (specifica: «ancora futura») vale per le date dal giorno della bozza in poi: una
 * data già passata quando la bozza è stata scritta, con l'anno («il raduno del 12 ottobre 2026»,
 * il fatto del complimento iniziale), non scade tra la bozza e l'invio. Il giorno stesso della
 * bozza conta ancora (il lato prudente). */
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
  const bodyDates = partnerAssistantBodyDates(body, writtenOn);
  if (bodyDates.some((date) => date >= writtenOn && date <= sendDay)) return expired;
  return { ok: true };
}
