import { describe, expect, it } from "vitest";
import {
  addDays,
  dayAriaLabel,
  defaultDay,
  eventDays,
  eventIdFromHash,
  isCalendarDay,
  itemCountLabel,
  itemsByDay,
  longDayLabel,
  monthDays,
  monthGrid,
  monthLabel,
  romeDayOf,
  shiftMonth,
} from "./calendar";
import type { TeamEvent, TeamTask } from "./model";

const event = (id: string, startsAt: string, endsAt: string, allDay = false): TeamEvent => ({
  id,
  title: `Evento ${id}`,
  startsAt,
  endsAt,
  eventType: "other",
  details: { summary: "", participantIds: [], callUrl: null, ...(allDay ? { allDay } : {}) },
  createdBy: "member",
});
const task = (id: string, dueAt: string | null, status: TeamTask["status"] = "todo"): TeamTask => ({
  id,
  title: `Attività ${id}`,
  description: "",
  status,
  dueAt,
  assignedTo: null,
  createdBy: "member",
});
const ids = (items: ReturnType<typeof itemsByDay>, day: string) =>
  (items.get(day) ?? []).map((item) => (item.kind === "event" ? item.event.id : item.task.id));

describe("giorni di Roma e mesi", () => {
  it("il giorno di un istante è quello di Roma, anche a mezzanotte e nei cambi d'ora", () => {
    expect(romeDayOf("2026-10-31T23:30:00Z")).toBe("2026-11-01");
    expect(romeDayOf("2026-10-31T22:59:00Z")).toBe("2026-10-31");
    expect(romeDayOf("2026-03-28T23:00:00Z")).toBe("2026-03-29");
    expect(romeDayOf("2026-07-01T21:59:00Z")).toBe("2026-07-01");
    expect(() => romeDayOf("non una data")).toThrow(RangeError);
  });

  it("giorni e mesi sul calendario, senza fusi", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthDays("2028-02")).toHaveLength(29);
    expect(isCalendarDay("2026-02-30")).toBe(false);
    expect(isCalendarDay("2026-02-28")).toBe(true);
  });

  it("settimane da lunedì: celle vuote prima e dopo, sempre righe intere", () => {
    const october = monthGrid("2026-10");
    expect(october.slice(0, 4)).toEqual([null, null, null, "2026-10-01"]);
    expect(october).toHaveLength(35);
    const november = monthGrid("2026-11");
    expect(november.indexOf("2026-11-01")).toBe(6);
    expect(november).toHaveLength(42);
    const february = monthGrid("2027-02");
    expect(february[0]).toBe("2027-02-01");
    expect(february).toHaveLength(28);
  });

  it("nomi italiani", () => {
    expect(monthLabel("2026-10")).toBe("Ottobre 2026");
    expect(longDayLabel("2026-10-23")).toBe("Venerdì 23 ottobre");
    expect(itemCountLabel(0)).toBe("nessun impegno");
    expect(itemCountLabel(1)).toBe("1 impegno");
    expect(itemCountLabel(3)).toBe("3 impegni");
    expect(dayAriaLabel("2026-10-23", 2, "2026-10-23")).toBe("23 ottobre, 2 impegni, oggi");
    expect(dayAriaLabel("2026-10-01", 0, "2026-10-23")).toBe("1 ottobre, nessun impegno");
  });
});

describe("impegni per giorno", () => {
  const events = [
    // Giornata intera di due giorni sul cambio dell'ora (fine esclusa a mezzanotte).
    event("a", "2026-10-24T22:00:00Z", "2026-10-26T23:00:00Z", true),
    // Fino a mezzanotte: non segna il giorno dopo.
    event("b", "2026-10-10T20:00:00Z", "2026-10-10T22:00:00Z"),
    // A cavallo di due mesi.
    event("c", "2026-10-30T08:00:00Z", "2026-11-02T08:00:00Z"),
    event("d", "2026-10-10T07:00:00Z", "2026-10-10T08:00:00Z"),
  ];
  const tasks = [
    task("t1", "2026-10-10T10:00:00Z", "done"),
    task("t2", "2026-10-10T10:00:00Z"),
    task("t3", null),
    task("t4", "2026-09-30T10:00:00Z"),
  ];

  it("ogni giorno coperto da un evento, la scadenza delle attività", () => {
    const items = itemsByDay(events, tasks, "2026-10");
    expect(ids(items, "2026-10-25")).toEqual(["a"]);
    expect(ids(items, "2026-10-26")).toEqual(["a"]);
    expect(ids(items, "2026-10-24")).toEqual([]);
    expect(ids(items, "2026-10-27")).toEqual([]);
    expect(ids(items, "2026-10-11")).toEqual([]);
    // Eventi per inizio, poi attività: aperte prima delle completate.
    expect(ids(items, "2026-10-10")).toEqual(["d", "b", "t2", "t1"]);
    expect(ids(items, "2026-10-30")).toEqual(["c"]);
    expect(ids(items, "2026-10-31")).toEqual(["c"]);
    expect(items.has("2026-11-01")).toBe(false);
    expect(
      [...items.values()].flat().some((item) => item.kind === "task" && item.task.id === "t4"),
    ).toBe(false);
    const november = itemsByDay(events, tasks, "2026-11");
    expect(ids(november, "2026-11-01")).toEqual(["c"]);
    expect(ids(november, "2026-11-02")).toEqual(["c"]);
    expect(ids(november, "2026-11-03")).toEqual([]);
  });

  it("primo e ultimo giorno di un evento", () => {
    expect(eventDays(events[0])).toEqual({ first: "2026-10-25", last: "2026-10-26" });
    expect(eventDays(events[1])).toEqual({ first: "2026-10-10", last: "2026-10-10" });
  });

  it("aprendo un mese: oggi, altrimenti il primo giorno con qualcosa, altrimenti il primo", () => {
    expect(defaultDay("2026-10", "2026-10-23", itemsByDay(events, tasks, "2026-10"))).toBe(
      "2026-10-23",
    );
    expect(defaultDay("2026-11", "2026-10-23", itemsByDay(events, tasks, "2026-11"))).toBe(
      "2026-11-01",
    );
    expect(defaultDay("2026-12", "2026-10-23", itemsByDay(events, tasks, "2026-12"))).toBe(
      "2026-12-01",
    );
    expect(defaultDay("2026-10", "2026-12-23", itemsByDay(events, tasks, "2026-10"))).toBe(
      "2026-10-10",
    );
  });

  it("ancora #evento-<id> del feed e di Oggi", () => {
    expect(eventIdFromHash("#evento-71000000-0000-4000-8000-00000000000A")).toBe(
      "71000000-0000-4000-8000-00000000000a",
    );
    expect(eventIdFromHash("#attivita-71000000-0000-4000-8000-000000000001")).toBeNull();
    expect(eventIdFromHash("#evento-x")).toBeNull();
    expect(eventIdFromHash("")).toBeNull();
  });
});
