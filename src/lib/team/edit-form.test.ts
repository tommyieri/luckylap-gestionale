import { describe, expect, it } from "vitest";
import {
  editableMembers,
  eventFormDefaults,
  romeDateTimeInput,
  romeInputOccurrence,
  taskFormDefaults,
} from "./edit-form";
import type { TeamEvent, TeamTask } from "./model";

const id = (n: number) => `72000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const event: TeamEvent = {
  id: id(1),
  title: "Call di prova",
  startsAt: "2026-10-25T01:15:23.456Z",
  endsAt: "2026-10-25T01:45:34.567Z",
  eventType: "other",
  details: {
    summary: "Descrizione sintetica",
    participantIds: [id(2)],
    callUrl: "https://example.test/call",
    typeLabel: "Revisione campioni",
  },
  createdBy: id(2),
};

describe("dati iniziali dei moduli calendario", () => {
  it("precompila orari di Roma e conserva la seconda occorrenza già registrata", () => {
    expect(eventFormDefaults(event)).toEqual({
      values: {
        title: event.title,
        startsAt: "2026-10-25T02:15",
        endsAt: "2026-10-25T02:45",
        startsOccurrence: "later",
        endsOccurrence: "later",
        eventType: "other",
        customEventType: "Revisione campioni",
        summary: event.details.summary,
        callUrl: event.details.callUrl,
        allDay: "false",
      },
      participantIds: [id(2)],
    });
    expect(romeInputOccurrence("2026-10-25T00:15:00.000Z")).toBe("earlier");
    expect(romeInputOccurrence("2026-10-25T01:15:59.999Z")).toBe("later");
  });
  it("usa il fuso di Roma in inverno e in estate anche a cavallo del giorno", () => {
    expect(romeDateTimeInput("2027-01-01T23:30:00.000Z")).toBe("2027-01-02T00:30");
    expect(romeDateTimeInput("2027-07-01T22:30:00.000Z")).toBe("2027-07-02T00:30");
    expect(romeInputOccurrence("2027-07-01T22:30:00.000Z")).toBe("");
  });
  it("mostra l’ultimo giorno incluso negli eventi giornata intera, anche con il cambio dell’ora", () => {
    const defaults = eventFormDefaults({
      ...event,
      startsAt: "2026-10-23T22:00:00Z",
      endsAt: "2026-10-26T23:00:00Z",
      details: { ...event.details, allDay: true },
    });
    expect(defaults.values).toMatchObject({
      allDay: "true",
      startsAt: "2026-10-24",
      endsAt: "2026-10-26",
      startsOccurrence: "",
      endsOccurrence: "",
    });
  });
  it("conserva il tipo Evento importato e le attività senza scadenza o assegnatario", () => {
    expect(
      eventFormDefaults({ ...event, details: { ...event.details, typeLabel: "Evento" } }).values
        ?.eventType,
    ).toBe("event");
    const task: TeamTask = {
      id: id(4),
      title: "Attività di prova",
      description: "Test",
      status: "in_progress",
      dueAt: null,
      assignedTo: null,
      createdBy: id(2),
    };
    expect(taskFormDefaults(task)).toEqual({
      title: task.title,
      description: "Test",
      status: "in_progress",
      dueDate: "",
      assignedTo: "",
    });
    expect(
      taskFormDefaults({ ...task, dueAt: "2027-01-01T23:30:00Z", assignedTo: id(2) }),
    ).toMatchObject({ dueDate: "2027-01-02", assignedTo: id(2) });
  });
  it("non perde selezioni inattive o non più presenti nel team", () => {
    const active = { id: id(2), name: "Ada Prova", active: true };
    const inactive = { id: id(3), name: "Bruno Prova", active: false };
    expect(
      editableMembers(
        [active, inactive, { id: id(5), name: "Carla Prova", active: false }],
        [id(3), id(4)],
      ),
    ).toEqual([active, inactive, { id: id(4), name: "Membro non più disponibile", active: false }]);
    expect(editableMembers([active, inactive], [])).toEqual([active]);
  });
});
