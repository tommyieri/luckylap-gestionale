import { localReportDate } from "../finance/model";
import { resolveRomeLocalTime, TEAM_TIME_ZONE } from "../team/model";
import type { TeamEvent, TeamTask } from "../team/model";
import type { InventoryItem } from "../types";

/**
 * Regole pure di «Oggi» (docs: 01-layout §9, 05-collegamenti).
 * Il giorno è sempre quello di Roma, qualunque sia il fuso del server.
 */

/** Ogni riquadro ha numeri completi oppure nessun numero. */
export type Tile<T> = { status: "ok"; data: T } | { status: "error" };

export type DayBounds = { day: string; start: string; end: string };
export type AgendaEvent = {
  event: TeamEvent;
  /** «09:30» se l'evento inizia oggi; `null` se è iniziato prima (casella «OGGI»). */
  time: string | null;
  /** In corso adesso. */
  now: boolean;
};
export type AgendaTask = {
  task: TeamTask;
  /** Giorno di scadenza a Roma. */
  dueDay: string;
  /** Scadenza in un giorno precedente a oggi. */
  late: boolean;
};
export type Agenda = { day: string; events: AgendaEvent[]; tasks: AgendaTask[] };
export type StockSignal = "esaurita" | "da_contare" | "ok";
export type StockCounts = { esaurite: number; daContare: number };

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const time = (value: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError("Data non valida.");
  return parsed;
};

/** Giorno di Roma come «AAAA-MM-GG». Lancia con una data non valida. */
export function romeDay(now: Date): string {
  const day = localReportDate(now);
  if (!day) throw new RangeError("Data non valida.");
  return day;
}

/**
 * Mezzanotte di Roma del giorno e del successivo, in UTC. A Roma la mezzanotte
 * non cade mai nel cambio dell'ora: un giorno dura 23, 24 o 25 ore.
 */
export function romeDayBounds(day: string): DayBounds {
  const match = CALENDAR_DAY.exec(day);
  if (!match) throw new RangeError("Giorno non valido.");
  const [year, month, date] = match.slice(1).map(Number);
  const midnight = new Date(Date.UTC(year, month - 1, date));
  if (midnight.toISOString().slice(0, 10) !== day) throw new RangeError("Giorno non valido.");
  // Il giorno successivo si calcola sul calendario, senza passare da un fuso.
  const next = new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
  return {
    day,
    start: resolveRomeLocalTime(`${day}T00:00`, "", "Il giorno"),
    end: resolveRomeLocalTime(`${next}T00:00`, "", "Il giorno"),
  };
}

const romeClock = new Intl.DateTimeFormat("it-IT", {
  timeZone: TEAM_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** Ora di Roma «09:30». */
export function romeTime(value: string): string {
  return romeClock.format(time(value));
}

const romeLongDay = new Intl.DateTimeFormat("it-IT", {
  timeZone: TEAM_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});
/** Data per l'intestazione di Oggi: «mercoledì 22 ottobre». */
export function romeDayLabel(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Data non valida.");
  return romeLongDay.format(now);
}

const byStartThenTitle = (a: TeamEvent, b: TeamEvent) =>
  time(a.startsAt) - time(b.startsAt) ||
  time(a.endsAt) - time(b.endsAt) ||
  a.title.localeCompare(b.title, "it") ||
  a.id.localeCompare(b.id);

/**
 * Agenda del giorno di Roma:
 * - eventi che toccano il giorno (anche iniziati ieri e ancora in corso), per inizio;
 * - le attività assegnate a `userId`, non concluse, con scadenza oggi o prima.
 *   Prima le scadute, poi quelle di oggi. Senza scadenza o di altri: escluse.
 */
export function agendaFor(
  events: readonly TeamEvent[],
  tasks: readonly TeamTask[],
  userId: string,
  now: Date,
): Agenda {
  const { day, start, end } = romeDayBounds(romeDay(now));
  const dayStart = time(start),
    dayEnd = time(end),
    instant = now.getTime();
  const agendaEvents = events
    .filter((event) => {
      const startsAt = time(event.startsAt),
        endsAt = time(event.endsAt);
      return startsAt < dayEnd && (endsAt > dayStart || startsAt >= dayStart);
    })
    .sort(byStartThenTitle)
    .map((event): AgendaEvent => {
      const startsAt = time(event.startsAt),
        endsAt = time(event.endsAt);
      return {
        event,
        time: startsAt >= dayStart ? romeTime(event.startsAt) : null,
        now: startsAt <= instant && instant < endsAt,
      };
    });
  const agendaTasks = tasks
    .filter(
      (task) =>
        task.assignedTo === userId &&
        task.status !== "done" &&
        task.dueAt !== null &&
        time(task.dueAt) < dayEnd,
    )
    .map((task): AgendaTask => {
      const dueDay = romeDay(new Date(time(task.dueAt!)));
      return { task, dueDay, late: dueDay < day };
    })
    .sort(
      (a, b) =>
        time(a.task.dueAt!) - time(b.task.dueAt!) ||
        a.task.title.localeCompare(b.task.title, "it") ||
        a.task.id.localeCompare(b.task.id),
    );
  return { day, events: agendaEvents, tasks: agendaTasks };
}

/**
 * Regola unica del Magazzino, usata da Oggi e (dopo) dai filtri del Magazzino.
 * Giacenza ignota: da contare, mai zero. Esaurita solo se la variante è attiva.
 */
export function stockSignal(item: Pick<InventoryItem, "active" | "centralQuantity">): StockSignal {
  if (item.centralQuantity === null) return "da_contare";
  if (item.active && item.centralQuantity <= 0) return "esaurita";
  return "ok";
}

export function stockCounts(
  items: readonly Pick<InventoryItem, "active" | "centralQuantity">[],
): StockCounts {
  let esaurite = 0,
    daContare = 0;
  for (const item of items) {
    const signal = stockSignal(item);
    if (signal === "esaurita") esaurite += 1;
    else if (signal === "da_contare") daContare += 1;
  }
  return { esaurite, daContare };
}
