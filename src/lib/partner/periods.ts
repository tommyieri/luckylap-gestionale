// Partner: periodi calcolati da oggi, giorno di Roma (spec 02 §5.2). Funzioni pure.
//
// Mese pianificato = mese di next_action_on se c'è, altrimenti contact_month. k = mesi tra il mese
// pianificato e il mese corrente (negativo se passato). Periodo 1 k ≤ 1 · 2 se 2 ≤ k ≤ 3 ·
// 3 se 4 ≤ k ≤ 5 · 4 se 6 ≤ k ≤ 8 · 5 se k ≥ 9. Il 22 ottobre 2026 sono gli stessi periodi del sito.
import {
  MONTHS_LONG,
  MONTHS_SHORT,
  addMonths,
  daysBetween,
  monthIndex,
  monthStart,
  romeDay,
  shortDay,
} from "./dates";

export const PARTNER_PERIOD_NUMBERS = [1, 2, 3, 4, 5] as const;
export type PartnerPeriodNumber = (typeof PARTNER_PERIOD_NUMBERS)[number];
export const isPartnerPeriodNumber = (value: unknown): value is PartnerPeriodNumber =>
  typeof value === "number" && (PARTNER_PERIOD_NUMBERS as readonly number[]).includes(value);

/** Primo e ultimo mese di ogni periodo, in mesi da quello corrente (l'ultimo è aperto). */
const OFFSETS: Record<PartnerPeriodNumber, [number, number | null]> = {
  1: [1, 1],
  2: [2, 3],
  3: [4, 5],
  4: [6, 8],
  5: [9, null],
};
const NOTES: Record<PartnerPeriodNumber, string> = {
  1: "Da contattare nelle prossime settimane, con i contatti rimasti indietro e le prossime azioni in scadenza.",
  2: "Da impostare in questi mesi: eventi da prenotare, collab da preparare, negozi da sentire.",
  3: "Da impostare in questi mesi: eventi da prenotare, collab da preparare, negozi da sentire.",
  4: "Eventi più lontani e contatti che hanno senso dopo le prime vendite.",
  5: "Mercati lontani e contatti che hanno bisogno di vendite già dimostrate.",
};

export type PartnerPeriod = {
  number: PartnerPeriodNumber;
  /** Testo della cella: «Adesso», «Dic – Gen», «Da lug 2027». */
  cell: string;
  /** Titolo del periodo (h2): «Adesso, entro novembre», «Dicembre e gennaio». */
  title: string;
  note: string;
  /** Primo mese del periodo («AAAA-MM-01»); per il periodo 1 comprende anche i mesi passati. */
  firstMonth: string;
  /** Ultimo mese; nullo per il periodo 5, senza fine. */
  lastMonth: string | null;
};

/** Giorno di oggi a Roma, da passare dal server al client. */
export const partnerToday = (now: Date = new Date()) => romeDay(now);

/** Mese pianificato «AAAA-MM-01»: la prossima azione vince sul mese di contatto. */
export function plannedMonth(partner: { contactMonth: string; nextActionOn: string | null }) {
  return monthStart(monthIndex(partner.nextActionOn ?? partner.contactMonth));
}

/** k: mesi tra il mese pianificato e quello di oggi. */
export function monthsAhead(month: string, today: string): number {
  return monthIndex(month) - monthIndex(today);
}

export function periodForOffset(k: number): PartnerPeriodNumber {
  if (k <= 1) return 1;
  if (k <= 3) return 2;
  if (k <= 5) return 3;
  if (k <= 8) return 4;
  return 5;
}

export function partnerPeriod(
  partner: { contactMonth: string; nextActionOn: string | null },
  today: string,
): PartnerPeriodNumber {
  return periodForOffset(monthsAhead(plannedMonth(partner), today));
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const month = (day: string) => monthIndex(day) % 12;
const year = (day: string) => Math.floor(monthIndex(day) / 12);
/** «a» davanti a consonante, «ad» davanti ad «a»: «da giugno ad agosto». */
const to = (word: string) => (word.startsWith("a") ? `ad ${word}` : `a ${word}`);

/** I cinque periodi visti da oggi, con celle, titoli e note. */
export function partnerPeriods(today: string): PartnerPeriod[] {
  return PARTNER_PERIOD_NUMBERS.map((number) => {
    const [first, last] = OFFSETS[number];
    const firstMonth = addMonths(today, number === 1 ? 0 : first);
    const lastMonth = last === null ? null : addMonths(today, last);
    const shortFirst = MONTHS_SHORT[month(addMonths(today, first))];
    const longFirst = MONTHS_LONG[month(addMonths(today, first))];
    let cell: string;
    let title: string;
    if (number === 1) {
      cell = "Adesso";
      title = `Adesso, entro ${MONTHS_LONG[month(lastMonth!)]}`;
    } else if (lastMonth === null) {
      cell = `Da ${shortFirst} ${year(firstMonth)}`;
      title = `Da ${longFirst} ${year(firstMonth)} in poi`;
    } else {
      cell = `${capital(shortFirst)} – ${capital(MONTHS_SHORT[month(lastMonth)])}`;
      title =
        last! - first === 1
          ? `${capital(longFirst)} e ${MONTHS_LONG[month(lastMonth)]}`
          : `Da ${longFirst} ${to(MONTHS_LONG[month(lastMonth)])}`;
    }
    return { number, cell, title, note: NOTES[number], firstMonth, lastMonth };
  });
}

/** Mese nella casella CO: «NOV». */
export const monthBox = (planned: string) => MONTHS_SHORT[month(planned)].toUpperCase();

const MONTHS_RANGE = MONTHS_SHORT;
/**
 * Date dell'evento come nel sito: «2–5 giu 2027», «30 giu – 2 lug 2027», «2 giu 2027».
 * Vuoto senza data di inizio.
 */
export function formatEventRange(start: string | null, end: string | null): string {
  if (!start) return "";
  const [y1, m1, d1] = start.split("-").map(Number);
  if (!end || end === start) return `${d1} ${MONTHS_RANGE[m1 - 1]} ${y1}`;
  const [y2, m2, d2] = end.split("-").map(Number);
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} ${MONTHS_RANGE[m1 - 1]} ${y1}`;
  if (y1 === y2) return `${d1} ${MONTHS_RANGE[m1 - 1]} – ${d2} ${MONTHS_RANGE[m2 - 1]} ${y2}`;
  return `${d1} ${MONTHS_RANGE[m1 - 1]} ${y1} – ${d2} ${MONTHS_RANGE[m2 - 1]} ${y2}`;
}

export type PartnerEventTiming = {
  /** «2–5 giu 2027». */
  range: string;
  /** Giorni all'inizio (negativo se iniziato). */
  daysUntil: number;
  /** Inizia tra 0 e 60 giorni: ambra, «· tra 34 giorni». */
  soon: boolean;
  /** Iniziato e non ancora finito. */
  ongoing: boolean;
  /** Finito: «Edizione passata». */
  past: boolean;
  /** Etichetta completa: «2–5 giu 2027 · tra 34 giorni», «Edizione passata · 2–5 giu 2026». */
  label: string;
};

export function eventTiming(
  partner: { eventStartsOn: string | null; eventEndsOn: string | null },
  today: string,
): PartnerEventTiming | null {
  const start = partner.eventStartsOn;
  if (!start) return null;
  const end = partner.eventEndsOn ?? start;
  const range = formatEventRange(start, partner.eventEndsOn);
  const daysUntil = daysBetween(today, start);
  const past = daysBetween(today, end) < 0;
  const ongoing = !past && daysUntil < 0;
  const soon = daysUntil >= 0 && daysUntil <= 60;
  const label = past
    ? `Edizione passata · ${range}`
    : ongoing
      ? `${range} · in corso`
      : soon
        ? `${range} · ${daysUntil === 0 ? "oggi" : daysUntil === 1 ? "domani" : `tra ${daysUntil} giorni`}`
        : range;
  return { range, daysUntil, soon, ongoing, past, label };
}

/** «Prossima: sollecito · 29 ott», ambra se la data è passata. */
export function nextActionTiming(
  partner: { nextAction: string | null; nextActionOn: string | null },
  today: string,
): { label: string; overdue: boolean } | null {
  if (!partner.nextAction || !partner.nextActionOn) return null;
  return {
    label: `Prossima: ${partner.nextAction} · ${shortDay(partner.nextActionOn)}`,
    overdue: daysBetween(today, partner.nextActionOn) < 0,
  };
}
