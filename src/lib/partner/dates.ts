// Partner: giorni e mesi del calendario di Roma (spec 02 §5.2). Funzioni pure, senza React.
//
// Un giorno è «AAAA-MM-GG» del calendario, senza fuso: si confronta come testo e si sposta con
// l'aritmetica UTC, che non ha ora legale. Solo gli istanti (timestamptz) passano dal fuso di Roma.
import { localReportDate } from "../finance/model";

export const PARTNER_TIME_ZONE = "Europe/Rome";

export const MONTHS_SHORT = [
  "gen",
  "feb",
  "mar",
  "apr",
  "mag",
  "giu",
  "lug",
  "ago",
  "set",
  "ott",
  "nov",
  "dic",
] as const;
export const MONTHS_LONG = [
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
] as const;

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Giorno reale del calendario «AAAA-MM-GG» tra il 2000 e il 2100, come private.partner_date. */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !CALENDAR_DAY.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return (
    Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === value &&
    value >= "2000-01-01" &&
    value <= "2100-12-31"
  );
}

/** Primo giorno di un mese «AAAA-MM-01». */
export function isMonthStart(value: unknown): value is string {
  return isCalendarDay(value) && value.endsWith("-01");
}

function checkedDay(day: string): string {
  if (!isCalendarDay(day)) throw new RangeError("Giorno non valido.");
  return day;
}

/** Giorno di Roma dell'istante (mezzanotte di Roma, non UTC). Lancia con una data non valida. */
export function romeDay(now: Date): string {
  const day = localReportDate(now);
  if (!day) throw new RangeError("Data non valida.");
  return day;
}

/** Giorni tra due giorni del calendario: positivo se `to` viene dopo `from`. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${checkedDay(to)}T00:00:00Z`) - Date.parse(`${checkedDay(from)}T00:00:00Z`)) /
      DAY_MS,
  );
}

export function addDays(day: string, amount: number): string {
  return new Date(Date.parse(`${checkedDay(day)}T00:00:00Z`) + amount * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Mesi dall'anno zero: differenze tra mesi senza passare dai giorni. */
export function monthIndex(day: string): number {
  const [year, month] = checkedDay(day).split("-").map(Number);
  return year * 12 + month - 1;
}

/** «AAAA-MM-01» del mese con quell'indice. */
export function monthStart(index: number): string {
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

export function addMonths(day: string, amount: number): string {
  return monthStart(monthIndex(day) + amount);
}

const parts = (day: string) => checkedDay(day).split("-").map(Number);

/** «29 ott». */
export function shortDay(day: string): string {
  const [, month, date] = parts(day);
  return `${date} ${MONTHS_SHORT[month - 1]}`;
}

/** «29 ottobre», con l'anno se diverso da quello di `today` (o sempre, senza `today`). */
export function longDay(day: string, today?: string): string {
  const [year, month, date] = parts(day);
  const sameYear = today !== undefined && parts(today)[0] === year;
  return `${date} ${MONTHS_LONG[month - 1]}${sameYear ? "" : ` ${year}`}`;
}

/** «novembre 2026». */
export function monthLong(day: string): string {
  const [year, month] = parts(day);
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

/** Giorno di Roma di un istante (timestamptz), o `null` se illeggibile. */
export function instantDay(value: string): string | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? localReportDate(new Date(time)) : null;
}

const romeClock = new Intl.DateTimeFormat("it-IT", {
  timeZone: PARTNER_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** Ora di Roma «10:42», o `null` se illeggibile. */
export function instantTime(value: string): string | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? romeClock.format(time) : null;
}
