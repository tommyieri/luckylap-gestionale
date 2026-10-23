import { describe, expect, it } from "vitest";
import {
  capturedFormValues,
  decodeEventDetails,
  encodeEventDetails,
  eventTypeLabel,
  eventEditToken,
  taskEditToken,
  parseTeamEditForm,
  type TeamEvent,
  type TeamTask,
  parseEventForm,
  parseNoteForm,
  parseTaskForm,
  resolveRomeLocalTime,
} from "./model";

const memberId = "00000000-0000-4000-8000-000000000001";
const form = (values: Record<string, string>) => {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
};

describe("internal team workspace input boundary", () => {
  it("interprets local times in Europe/Rome independently of the server timezone", () => {
    expect(resolveRomeLocalTime("2026-01-12T10:15")).toBe("2026-01-12T09:15:00.000Z");
    expect(resolveRomeLocalTime("2026-07-12T10:15")).toBe("2026-07-12T08:15:00.000Z");
  });
  it("rejects nonexistent dates and the spring DST gap", () => {
    for (const value of [
      "2026-02-30T12:00",
      "2026-03-29T02:30",
      "2026-10-21T24:00",
      "2026-10-21T10:00Z",
    ]) {
      expect(() => resolveRomeLocalTime(value)).toThrow();
    }
  });
  it("requires an explicit occurrence during the autumn DST overlap", () => {
    expect(() => resolveRomeLocalTime("2026-10-25T02:30")).toThrow(/si ripete/);
    expect(resolveRomeLocalTime("2026-10-25T02:30", "earlier")).toBe("2026-10-25T00:30:00.000Z");
    expect(resolveRomeLocalTime("2026-10-25T02:30", "later")).toBe("2026-10-25T01:30:00.000Z");
  });
  it("encodes validated internal event details without creating an external invitation", () => {
    const input = form({
      title: "  Call produzione  ",
      startsAt: "2026-10-21T10:00",
      endsAt: "2026-10-21T10:30",
      eventType: "meeting",
      summary: "Prototipo\nTaglie",
      callUrl: "https://example.test/call",
    });
    input.append("participantIds", memberId);
    const event = parseEventForm(input);
    expect(event.title).toBe("Call produzione");
    expect(event.starts_at).toBe("2026-10-21T08:00:00.000Z");
    expect(event.participantIds).toEqual([memberId]);
    expect(decodeEventDetails(event.description)).toEqual({
      summary: "Prototipo\nTaglie",
      participantIds: [memberId],
      callUrl: "https://example.test/call",
    });
  });
  it("rejects reversed intervals, duplicate scalar fields and untrusted URLs", () => {
    const base = {
      title: "Call",
      startsAt: "2026-10-21T10:00",
      endsAt: "2026-10-21T09:30",
      eventType: "meeting",
    };
    expect(() => parseEventForm(form(base))).toThrow(/fine/);
    for (const callUrl of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "//example.test",
      "https://user:secret@example.test",
      "https://example.test/\npath",
    ]) {
      expect(() => parseEventForm(form({ ...base, endsAt: "2026-10-21T11:00", callUrl }))).toThrow(
        /link/i,
      );
    }
    const duplicate = form({ ...base, endsAt: "2026-10-21T11:00" });
    duplicate.append("title", "other");
    expect(() => parseEventForm(duplicate)).toThrow();
  });
  it("keeps legacy event descriptions as text and rejects malformed structured metadata", () => {
    expect(decodeEventDetails("Appunti legacy")).toEqual({
      summary: "Appunti legacy",
      participantIds: [],
      callUrl: null,
    });
    expect(decodeEventDetails('{"format":"luckylap-team-event","version":99}').summary).toMatch(
      /non leggibili/,
    );
    const details = { summary: "Un appunto", participantIds: [], callUrl: null };
    expect(decodeEventDetails(encodeEventDetails(details))).toEqual(details);
  });
  it("stores a task due date as noon in Rome and validates assignee and note relation IDs", () => {
    expect(
      parseTaskForm(
        form({ title: "Controllare scatole", dueDate: "2026-10-25", assignedTo: memberId }),
      ),
    ).toEqual({
      title: "Controllare scatole",
      description: "",
      status: "todo",
      due_at: "2026-10-25T11:00:00.000Z",
      assigned_to: memberId,
    });
    expect(
      parseNoteForm(form({ title: "Idea grafica", body: "Linee\nColori", taskId: memberId })),
    ).toEqual({ title: "Idea grafica", body: "Linee\nColori", task_id: memberId });
    expect(() => parseTaskForm(form({ title: "Task", assignedTo: "founder" }))).toThrow();
    expect(() => parseNoteForm(form({ title: "Note", taskId: "invalid" }))).toThrow();
    expect(() => parseTaskForm(form({ title: "Task", dueDate: "2026-02-30" }))).toThrow();
  });
  it("rejects control characters and oversized serialized metadata before a successful write can break reads", () => {
    const base = {
      title: "Call",
      startsAt: "2026-10-21T10:00",
      endsAt: "2026-10-21T11:00",
      eventType: "meeting",
    };
    expect(() => parseEventForm(form({ ...base, summary: "\u0001".repeat(8000) }))).toThrow();
    expect(() =>
      encodeEventDetails({ summary: "x".repeat(51000), participantIds: [], callUrl: null }),
    ).toThrow(/troppo lunghi/);
    expect(() =>
      parseEventForm(form({ ...base, callUrl: "https://example.test/" + "é".repeat(1000) })),
    ).toThrow(/normalizzato/);
  });
});

describe("shared event categories", () => {
  const eventInput = {
    title: "Evento del team",
    startsAt: "2026-10-21T10:00",
    endsAt: "2026-10-21T11:00",
  };
  it("persists Evento through the existing other database kind and structured details", () => {
    const event = parseEventForm(form({ ...eventInput, eventType: "event" }));
    expect(event.event_type).toBe("other");
    expect(decodeEventDetails(event.description).typeLabel).toBe("Evento");
    expect(event.description.length).toBeLessThanOrEqual(50000);
  });
  it("round-trips the free Other label while keeping ordinary details and legacy records compatible", () => {
    const event = parseEventForm(
      form({
        ...eventInput,
        eventType: "other",
        customEventType: "  Shooting e incontro partner  ",
        summary: "Agenda condivisa",
      }),
    );
    expect(event.event_type).toBe("other");
    expect(decodeEventDetails(event.description)).toEqual({
      summary: "Agenda condivisa",
      participantIds: [],
      callUrl: null,
      typeLabel: "Shooting e incontro partner",
    });
    expect(decodeEventDetails("Appunti precedenti")).toEqual({
      summary: "Appunti precedenti",
      participantIds: [],
      callUrl: null,
    });
  });
  it.each(["", " ", "x".repeat(81), "Tipo\nnon valido"])(
    "rejects an invalid free Other label %j",
    (customEventType) => {
      expect(() =>
        parseEventForm(form({ ...eventInput, eventType: "other", customEventType })),
      ).toThrow(/tipo/i);
    },
  );
  it("accepts an 80-character label and rejects malformed serialized type metadata", () => {
    const event = parseEventForm(
      form({ ...eventInput, eventType: "other", customEventType: "x".repeat(80) }),
    );
    expect(decodeEventDetails(event.description).typeLabel).toHaveLength(80);
    expect(
      decodeEventDetails(
        JSON.stringify({
          format: "luckylap-team-event",
          version: 1,
          summary: "Agenda",
          participantIds: [],
          callUrl: null,
          typeLabel: "x".repeat(81),
        }),
      ).summary,
    ).toMatch(/non leggibili/);
  });
});

describe("appuntamenti di giornata intera", () => {
  it("mantiene il metadato opzionale senza cambiare i record precedenti", () => {
    const details = { summary: "Evento Partner", participantIds: [], callUrl: null, allDay: true };
    expect(decodeEventDetails(encodeEventDetails(details))).toEqual(details);
    expect(decodeEventDetails(encodeEventDetails({ ...details, allDay: false })).allDay).toBe(
      false,
    );
    expect(decodeEventDetails("Descrizione precedente").allDay).toBeUndefined();
    expect(() => encodeEventDetails({ ...details, allDay: "true" } as never)).toThrow();
    expect(
      decodeEventDetails(
        JSON.stringify({ format: "luckylap-team-event", version: 1, ...details, allDay: "true" }),
      ).summary,
    ).toContain("non leggibili");
  });
});

it("keeps the free type label after validation errors and renders only the selected event category", () => {
  const input = form({ eventType: "other", customEventType: "Shooting" });
  expect(capturedFormValues(input).values?.customEventType).toBe("Shooting");
  expect(
    eventTypeLabel({
      eventType: "other",
      details: { summary: "", participantIds: [], callUrl: null, typeLabel: "Shooting" },
    }),
  ).toBe("Shooting");
  expect(
    eventTypeLabel({
      eventType: "other",
      details: { summary: "", participantIds: [], callUrl: null },
    }),
  ).toBe("Altro");
  expect(
    eventTypeLabel({
      eventType: "delivery",
      details: { summary: "", participantIds: [], callUrl: null, typeLabel: "Shooting" },
    }),
  ).toBe("Consegna");
});

describe("modifica dei dati del calendario", () => {
  it.each([
    ["2026-03-29", "2026-03-29", "2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z", 23],
    ["2026-10-25", "2026-10-25", "2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z", 25],
    ["2026-07-12", "2026-07-14", "2026-07-11T22:00:00.000Z", "2026-07-14T22:00:00.000Z", 72],
  ])(
    "giornata intera %s–%s mantiene fine inclusiva e mezzanotte romana",
    (startsAt, endsAt, start, end, hours) => {
      const event = parseEventForm(
        form({ title: "Evento sintetico", eventType: "event", allDay: "true", startsAt, endsAt }),
      );
      expect(event.starts_at).toBe(start);
      expect(event.ends_at).toBe(end);
      expect((Date.parse(event.ends_at) - Date.parse(event.starts_at)) / 3600000).toBe(hours);
      expect(decodeEventDetails(event.description)).toMatchObject({
        typeLabel: "Evento",
        allDay: true,
      });
    },
  );
  it.each([
    { allDay: "true", startsAt: "2026-03-30", endsAt: "2026-03-29" },
    { allDay: "true", startsAt: "2026-02-30", endsAt: "2026-03-02" },
    { allDay: "true", startsAt: "2026-03-29T10:00", endsAt: "2026-03-29" },
    { allDay: "yes", startsAt: "2026-03-29", endsAt: "2026-03-29" },
  ])("rifiuta date giornata intera o indicatore non validi", (dates) => {
    expect(() =>
      parseEventForm(form({ title: "Evento sintetico", eventType: "meeting", ...dates })),
    ).toThrow();
  });
  it("accetta gli stati previsti solo in modifica e crea sempre un’attività da fare", () => {
    for (const status of ["todo", "in_progress", "done"]) {
      const input = form({ title: "Attività sintetica", status });
      expect(parseTaskForm(input, { editing: true }).status).toBe(status);
      expect(parseTaskForm(input).status).toBe("todo");
    }
    for (const status of ["", "deleted", "DONE"]) {
      expect(() =>
        parseTaskForm(form({ title: "Attività sintetica", status }), { editing: true }),
      ).toThrow(/stato/i);
    }
    const duplicate = form({ title: "Attività sintetica", status: "done" });
    duplicate.append("status", "todo");
    expect(() => parseTaskForm(duplicate, { editing: true })).toThrow(/stato/i);
  });
  it("normalizza token rispetto a istanti equivalenti, metadati opzionali e ordine dei partecipanti", () => {
    const event: TeamEvent = {
      id: memberId,
      title: "Call sintetica",
      startsAt: "2026-10-25T02:30:00+01:00",
      endsAt: "2026-10-25T03:30:00+01:00",
      eventType: "meeting",
      createdBy: memberId,
      details: {
        summary: "Agenda",
        participantIds: [memberId, "00000000-0000-4000-8000-000000000002"],
        callUrl: null,
      },
    };
    const equivalent: TeamEvent = {
      ...event,
      id: "00000000-0000-4000-8000-000000000003",
      createdBy: "00000000-0000-4000-8000-000000000004",
      startsAt: "2026-10-25T01:30:00.000Z",
      endsAt: "2026-10-25T02:30:00.000Z",
      details: {
        ...event.details,
        participantIds: [...event.details.participantIds].reverse(),
        allDay: false,
      },
    };
    expect(eventEditToken(event)).toBe(eventEditToken(equivalent));
    expect(event.details.participantIds[0]).toBe(memberId);
    expect(eventEditToken({ ...event, title: "Call corretta" })).not.toBe(eventEditToken(event));
    expect(eventEditToken({ ...event, startsAt: "2026-10-25T00:30:00.000Z" })).not.toBe(
      eventEditToken(event),
    );
    const task: TeamTask = {
      id: memberId,
      title: "Attività",
      description: "Testo",
      status: "done",
      dueAt: "2026-10-25T12:00:00+01:00",
      assignedTo: null,
      createdBy: memberId,
    };
    expect(taskEditToken(task)).toBe(
      taskEditToken({
        ...task,
        dueAt: "2026-10-25T11:00:00.000Z",
        createdBy: "00000000-0000-4000-8000-000000000002",
      }),
    );
    expect(taskEditToken({ ...task, status: "todo" })).not.toBe(taskEditToken(task));
  });
  it("accetta token JSON con tutto il contenuto massimo senza trattarlo come testo umano", () => {
    const ids = Array.from(
      { length: 100 },
      (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    );
    const event: TeamEvent = {
      id: memberId,
      title: '"'.repeat(240),
      startsAt: "2026-10-25T01:30:00.000Z",
      endsAt: "2026-10-25T02:30:00.000Z",
      eventType: "other",
      createdBy: memberId,
      details: {
        summary: '\n"'.repeat(4000),
        participantIds: ids,
        callUrl: "https://example.test/" + "p".repeat(2027),
        typeLabel: "x".repeat(80),
        allDay: true,
      },
    };
    const expected = eventEditToken(event);
    const input = form({ id: memberId, expected });
    expect(parseTeamEditForm(input)).toEqual({ id: memberId, expected });
    expect(expected.length).toBeLessThan(100000);
    const file = form({ id: memberId });
    file.set("expected", new File(["{}"], "snapshot.json"));
    expect(() => parseTeamEditForm(file)).toThrow(/versione/);
  });
  it("conserva stato, giornata intera e campi selezionati dopo un errore", () => {
    const input = form({
      status: "in_progress",
      allDay: "true",
      startsAt: "2026-10-25",
      endsAt: "2026-10-26",
    });
    input.append("participantIds", memberId);
    expect(capturedFormValues(input)).toMatchObject({
      values: {
        status: "in_progress",
        allDay: "true",
        startsAt: "2026-10-25",
        endsAt: "2026-10-26",
      },
      participantIds: [memberId],
    });
  });
});
