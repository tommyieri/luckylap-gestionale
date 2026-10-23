// Calendario del team a mese: giorni di Roma, settimane da lunedì, impegni per giorno.
// Funzioni pure, nessun import di React. I giorni sono stringhe «AAAA-MM-GG», i mesi «AAAA-MM».
import { inclusiveEventEnd, TEAM_TIME_ZONE, type TeamEvent, type TeamTask } from "./model";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;

const romeDayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TEAM_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** Giorno di Roma di un istante ISO. */
export function romeDayOf(instant: string): string {
  const time = Date.parse(instant);
  if (!Number.isFinite(time)) throw new RangeError("Data non valida.");
  const parts = romeDayFormat.formatToParts(time);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const utc = (day: string): Date => {
  const match = DAY.exec(day);
  if (!match) throw new RangeError("Giorno non valido.");
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
};
const dayText = (date: Date) => date.toISOString().slice(0, 10);

export const isCalendarDay = (value: string): boolean => {
  if (!DAY.test(value)) return false;
  return dayText(utc(value)) === value;
};
export const monthOf = (day: string): string => day.slice(0, 7);
export function addDays(day: string, delta: number): string {
  const date = utc(day);
  date.setUTCDate(date.getUTCDate() + delta);
  return dayText(date);
}
export function shiftMonth(month: string, delta: number): string {
  const match = MONTH.exec(month);
  if (!match) throw new RangeError("Mese non valido.");
  return dayText(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1))).slice(0, 7);
}

/** Giorni del mese, dal primo all'ultimo. */
export function monthDays(month: string): string[] {
  const first = `${month}-01`;
  const next = `${shiftMonth(month, 1)}-01`;
  const days: string[] = [];
  for (let day = first; day < next; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Celle della griglia: settimane da lunedì, `null` per i giorni fuori dal mese. */
export function monthGrid(month: string): (string | null)[] {
  const days = monthDays(month);
  const lead = (utc(days[0]).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Primo e ultimo giorno di Roma coperti da un evento (la fine è esclusa: mezzanotte = giorno prima). */
export function eventDays(event: Pick<TeamEvent, "startsAt" | "endsAt">): {
  first: string;
  last: string;
} {
  return { first: romeDayOf(event.startsAt), last: romeDayOf(inclusiveEventEnd(event)) };
}

export type DayItem = { kind: "event"; event: TeamEvent } | { kind: "task"; task: TeamTask };

/**
 * Impegni di ogni giorno del mese: gli eventi segnano ogni giorno che coprono (giornata intera e
 * più giorni compresi), le attività il giorno di scadenza. Eventi per inizio, poi attività.
 */
export function itemsByDay(
  events: readonly TeamEvent[],
  tasks: readonly TeamTask[],
  month: string,
): Map<string, DayItem[]> {
  const days = monthDays(month);
  const first = days[0],
    last = days[days.length - 1];
  const map = new Map<string, DayItem[]>(days.map((day) => [day, []]));
  const sortedEvents = [...events].sort(
    (a, b) =>
      Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
      Date.parse(a.endsAt) - Date.parse(b.endsAt) ||
      a.title.localeCompare(b.title, "it") ||
      a.id.localeCompare(b.id),
  );
  for (const event of sortedEvents) {
    const span = eventDays(event);
    if (span.last < first || span.first > last) continue;
    const from = span.first < first ? first : span.first;
    const to = span.last > last ? last : span.last;
    for (let day = from; day <= to; day = addDays(day, 1))
      map.get(day)!.push({ kind: "event", event });
  }
  const sortedTasks = tasks
    .filter((task) => task.dueAt !== null)
    .sort(
      (a, b) =>
        Number(a.status === "done") - Number(b.status === "done") ||
        Date.parse(a.dueAt!) - Date.parse(b.dueAt!) ||
        a.title.localeCompare(b.title, "it") ||
        a.id.localeCompare(b.id),
    );
  for (const task of sortedTasks) {
    const day = romeDayOf(task.dueAt!);
    map.get(day)?.push({ kind: "task", task });
  }
  return map;
}

/**
 * Giorno da mostrare aprendo un mese: oggi se è nel mese, altrimenti il primo giorno con
 * qualcosa, altrimenti il primo del mese.
 */
export function defaultDay(month: string, today: string, items: Map<string, DayItem[]>): string {
  if (monthOf(today) === month) return today;
  for (const day of monthDays(month)) if ((items.get(day)?.length ?? 0) > 0) return day;
  return `${month}-01`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const format = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("it-IT", { ...options, timeZone: "UTC" }).format(utc(day));

/** «Ottobre 2026». */
export const monthLabel = (month: string): string =>
  capitalize(format(`${month}-01`, { month: "long", year: "numeric" }));
/** «23 ottobre». */
export const dayMonthLabel = (day: string): string =>
  format(day, { day: "numeric", month: "long" });
/** «Giovedì 23 ottobre». */
export const longDayLabel = (day: string): string =>
  capitalize(format(day, { weekday: "long", day: "numeric", month: "long" }));

/** Intestazione della griglia, da lunedì. */
export const WEEKDAYS = [
  ["Lun", "lunedì"],
  ["Mar", "martedì"],
  ["Mer", "mercoledì"],
  ["Gio", "giovedì"],
  ["Ven", "venerdì"],
  ["Sab", "sabato"],
  ["Dom", "domenica"],
] as const;

/** «nessun impegno», «1 impegno», «3 impegni». */
export const itemCountLabel = (count: number): string =>
  count === 0 ? "nessun impegno" : count === 1 ? "1 impegno" : `${count} impegni`;

/** Etichetta del giorno per i lettori di schermo: «23 ottobre, 2 impegni, oggi». */
export const dayAriaLabel = (day: string, count: number, today: string): string =>
  `${dayMonthLabel(day)}, ${itemCountLabel(count)}${day === today ? ", oggi" : ""}`;

/** Evento dell'ancora «#evento-<id>», se c'è. */
export function eventIdFromHash(hash: string): string | null {
  const match = /^#evento-([0-9a-f-]{36})$/i.exec(hash);
  return match ? match[1].toLowerCase() : null;
}
