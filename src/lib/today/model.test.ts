import { describe, expect, it } from "vitest";
import type { TeamEvent, TeamTask } from "../team/model";
import {
  agendaFor,
  romeDay,
  romeDayBounds,
  romeDayLabel,
  romeTime,
  stockCounts,
  stockSignal,
  type Tile,
} from "./model";

const me = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const event = (value: number, title: string, startsAt: string, endsAt = startsAt): TeamEvent => ({
  id: id(value),
  title,
  startsAt,
  endsAt,
  eventType: "meeting",
  details: { summary: "", participantIds: [], callUrl: null },
  createdBy: other,
});
const task = (value: number, title: string, overrides: Partial<TeamTask> = {}): TeamTask => ({
  id: id(value),
  title,
  description: "",
  status: "todo",
  dueAt: "2026-10-22T10:00:00.000Z",
  assignedTo: me,
  createdBy: other,
  ...overrides,
});
// Giovedì 22 ottobre 2026, 12:00 a Roma (ora legale, UTC+2).
const now = new Date("2026-10-22T10:00:00.000Z");

describe("giorno di Roma", () => {
  it("mette un istante delle 23:30 UTC del 21 ottobre nel 22 di Roma", () => {
    expect(romeDay(new Date("2026-10-21T23:30:00.000Z"))).toBe("2026-10-22");
    expect(romeDay(new Date("2026-10-21T21:59:59.000Z"))).toBe("2026-10-21");
  });

  it("calcola i limiti di un giorno normale in UTC", () => {
    expect(romeDayBounds("2026-10-22")).toEqual({
      day: "2026-10-22",
      start: "2026-10-21T22:00:00.000Z",
      end: "2026-10-22T22:00:00.000Z",
    });
  });

  it("dà 25 ore al giorno in cui torna l'ora solare e 23 a quello dell'ora legale", () => {
    expect(romeDayBounds("2026-10-25")).toMatchObject({
      start: "2026-10-24T22:00:00.000Z",
      end: "2026-10-25T23:00:00.000Z",
    });
    expect(romeDayBounds("2026-03-29")).toMatchObject({
      start: "2026-03-28T23:00:00.000Z",
      end: "2026-03-29T22:00:00.000Z",
    });
    expect(romeDayBounds("2026-12-31").end).toBe("2026-12-31T23:00:00.000Z");
  });

  it("rifiuta giorni e date non valide", () => {
    for (const day of ["2026-02-30", "2026-13-01", "22/10/2026", ""])
      expect(() => romeDayBounds(day)).toThrow(RangeError);
    expect(() => romeDay(new Date("non una data"))).toThrow(RangeError);
    expect(() => romeDayLabel(new Date(Number.NaN))).toThrow(RangeError);
  });

  it("scrive la data dell'intestazione e l'ora in italiano, a Roma", () => {
    expect(romeDayLabel(new Date("2026-10-21T23:30:00.000Z"))).toBe("giovedì 22 ottobre");
    expect(romeTime("2026-10-21T23:30:00.000Z")).toBe("01:30");
    expect(romeTime("2026-10-26T08:05:00.000Z")).toBe("09:05");
  });
});

describe("agendaFor: eventi", () => {
  it("include l'evento delle 23:30 UTC del 21 ottobre nel giorno 22, con l'ora di Roma", () => {
    const agenda = agendaFor(
      [event(1, "Prova notturna", "2026-10-21T23:30:00.000Z", "2026-10-22T00:30:00.000Z")],
      [],
      me,
      now,
    );
    expect(agenda.day).toBe("2026-10-22");
    expect(agenda.events).toHaveLength(1);
    expect(agenda.events[0]).toMatchObject({ time: "01:30", now: false });
  });

  it("ordina gli eventi per inizio ed esclude quelli di ieri e di domani", () => {
    const agenda = agendaFor(
      [
        event(1, "Pomeriggio", "2026-10-22T14:00:00.000Z", "2026-10-22T15:00:00.000Z"),
        event(2, "Ieri", "2026-10-21T10:00:00.000Z", "2026-10-21T21:59:00.000Z"),
        event(3, "Mattina", "2026-10-22T07:30:00.000Z", "2026-10-22T08:00:00.000Z"),
        event(4, "Domani a mezzanotte", "2026-10-22T22:00:00.000Z"),
        event(5, "Mezzanotte di oggi", "2026-10-21T22:00:00.000Z"),
      ],
      [],
      me,
      now,
    );
    expect(agenda.events.map((row) => row.event.title)).toEqual([
      "Mezzanotte di oggi",
      "Mattina",
      "Pomeriggio",
    ]);
    expect(agenda.events.map((row) => row.time)).toEqual(["00:00", "09:30", "16:00"]);
  });

  it("segna in corso solo l'evento che contiene l'istante iniettato", () => {
    const events = [
      event(1, "Finito", "2026-10-22T08:00:00.000Z", "2026-10-22T10:00:00.000Z"),
      event(2, "In corso", "2026-10-22T09:30:00.000Z", "2026-10-22T10:30:00.000Z"),
      event(3, "Più tardi", "2026-10-22T10:00:01.000Z", "2026-10-22T11:00:00.000Z"),
    ];
    expect(agendaFor(events, [], me, now).events.map((row) => row.now)).toEqual([
      false,
      true,
      false,
    ]);
    const later = new Date("2026-10-22T10:45:00.000Z");
    expect(agendaFor(events, [], me, later).events.map((row) => row.now)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("tiene l'evento iniziato ieri e ancora in corso, senza ora (casella «OGGI»)", () => {
    const agenda = agendaFor(
      [event(1, "Fiera di due giorni", "2026-10-21T07:00:00.000Z", "2026-10-22T16:00:00.000Z")],
      [],
      me,
      now,
    );
    expect(agenda.events[0]).toMatchObject({ time: null, now: true });
  });
});

describe("agendaFor: attività", () => {
  it("esclude le attività concluse", () => {
    const agenda = agendaFor(
      [],
      [task(1, "Fatta", { status: "done" }), task(2, "In corso", { status: "in_progress" })],
      me,
      now,
    );
    expect(agenda.tasks.map((row) => row.task.title)).toEqual(["In corso"]);
  });

  it("esclude le attività di altri e quelle non assegnate", () => {
    const agenda = agendaFor(
      [],
      [
        task(1, "Mia"),
        task(2, "Di un altro", { assignedTo: other }),
        task(3, "Di nessuno", { assignedTo: null }),
        task(4, "Creata da me per un altro", { assignedTo: other, createdBy: me }),
      ],
      me,
      now,
    );
    expect(agenda.tasks.map((row) => row.task.title)).toEqual(["Mia"]);
  });

  it("mette le scadute prima di quelle di oggi, segnandole in ritardo", () => {
    const agenda = agendaFor(
      [],
      [
        task(1, "Oggi", { dueAt: "2026-10-22T10:00:00.000Z" }),
        task(2, "Due giorni fa", { dueAt: "2026-10-20T10:00:00.000Z" }),
        task(3, "Ieri", { dueAt: "2026-10-21T10:00:00.000Z" }),
      ],
      me,
      now,
    );
    expect(agenda.tasks.map((row) => [row.task.title, row.dueDay, row.late])).toEqual([
      ["Due giorni fa", "2026-10-20", true],
      ["Ieri", "2026-10-21", true],
      ["Oggi", "2026-10-22", false],
    ]);
  });

  it("esclude le attività senza scadenza e quelle che scadono domani", () => {
    const agenda = agendaFor(
      [],
      [
        task(1, "Senza scadenza", { dueAt: null }),
        task(2, "Domani", { dueAt: "2026-10-23T10:00:00.000Z" }),
        task(3, "Oggi a tarda sera", { dueAt: "2026-10-22T21:59:00.000Z" }),
      ],
      me,
      now,
    );
    expect(agenda.tasks.map((row) => row.task.title)).toEqual(["Oggi a tarda sera"]);
  });

  it("non cambia gli elenchi ricevuti", () => {
    const events = [
      event(1, "B", "2026-10-22T14:00:00.000Z"),
      event(2, "A", "2026-10-22T08:00:00.000Z"),
    ];
    const tasks = [task(1, "Oggi"), task(2, "Ieri", { dueAt: "2026-10-21T10:00:00.000Z" })];
    agendaFor(events, tasks, me, now);
    expect(events.map((row) => row.title)).toEqual(["B", "A"]);
    expect(tasks.map((row) => row.title)).toEqual(["Oggi", "Ieri"]);
  });
});

describe("stockSignal", () => {
  it("dà esaurita a una variante attiva a zero", () => {
    expect(stockSignal({ active: true, centralQuantity: 0 })).toBe("esaurita");
  });

  it("dà ok a una variante non attiva a zero e a una con pezzi", () => {
    expect(stockSignal({ active: false, centralQuantity: 0 })).toBe("ok");
    expect(stockSignal({ active: true, centralQuantity: 3 })).toBe("ok");
  });

  it("dà da contare a una giacenza ignota, mai esaurita", () => {
    expect(stockSignal({ active: true, centralQuantity: null })).toBe("da_contare");
    expect(stockSignal({ active: false, centralQuantity: null })).toBe("da_contare");
  });

  it("conta esaurite e da contare senza trattare l'ignoto come zero", () => {
    expect(
      stockCounts([
        { active: true, centralQuantity: 0 },
        { active: true, centralQuantity: 0 },
        { active: false, centralQuantity: 0 },
        { active: true, centralQuantity: null },
        { active: true, centralQuantity: 12 },
      ]),
    ).toEqual({ esaurite: 2, daContare: 1 });
    expect(stockCounts([])).toEqual({ esaurite: 0, daContare: 0 });
  });
});

describe("Tile", () => {
  it("ha solo numeri completi o nessun numero", () => {
    const tiles: Tile<number>[] = [{ status: "ok", data: 3 }, { status: "error" }];
    expect(tiles.map((tile) => (tile.status === "ok" ? tile.data : null))).toEqual([3, null]);
  });
});
