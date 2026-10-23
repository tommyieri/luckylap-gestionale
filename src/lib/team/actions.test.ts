import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), verify: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.verify }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import {
  decodeEventDetails,
  encodeEventDetails,
  eventEditToken,
  taskEditToken,
  type TeamEvent,
  type TeamTask,
} from "./model";

import {
  createTeamEvent,
  createTeamNote,
  createTeamTask,
  deleteTeamItem,
  toggleTeamTask,
  updateTeamEvent,
  updateTeamTask,
} from "../../app/team/actions";

const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const form = (values: Record<string, string>) => {
  const input = new FormData();
  Object.entries(values).forEach(([key, value]) => input.set(key, value));
  return input;
};
type Reply = { data: unknown; error: unknown };
function client(...replies: Reply[]) {
  const calls: { table: string; methods: { name: string; args: unknown[] }[] }[] = [];
  const db = {
    from: vi.fn((table: string) => {
      const reply = replies.shift() ?? { data: null, error: { message: "Unexpected query" } };
      const call = { table, methods: [] as { name: string; args: unknown[] }[] };
      calls.push(call);
      const query: Record<string, unknown> = {};
      for (const name of ["select", "insert", "delete", "update", "eq", "is", "in"])
        query[name] = (...args: unknown[]) => {
          call.methods.push({ name, args });
          return query;
        };
      query.single = query.maybeSingle = async () => reply;
      query.then = (resolve: (reply: Reply) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(reply).then(resolve, reject);
      return query;
    }),
  };
  mocks.createClient.mockResolvedValue(db);
  return { db, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue({
    status: "member",
    member: {
      userId: id,
      displayName: "Membro sintetico",
      role: "logistics",
      financeAccess: false,
    },
  });
});

describe("team Server Actions authorization and mutations", () => {
  it.each([
    createTeamEvent,
    createTeamTask,
    createTeamNote,
    deleteTeamItem,
    toggleTeamTask,
    updateTeamEvent,
    updateTeamTask,
  ])("anteprima locale: salvataggio disattivato, mai Supabase", async (action) => {
    vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "true");
    try {
      const result = await action({}, form({ title: "Prova" }));
      expect(result.error).toBe("Anteprima locale: salvataggio disattivato.");
      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(mocks.verify).not.toHaveBeenCalled();
      expect(mocks.revalidate).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it.each([
    createTeamEvent,
    createTeamTask,
    createTeamNote,
    deleteTeamItem,
    toggleTeamTask,
    updateTeamEvent,
    updateTeamTask,
  ])("checks current membership before every action, including malformed input", async (action) => {
    const { db } = client();
    mocks.verify.mockResolvedValue({ status: "denied" });
    const result = await action({}, new FormData());
    expect(result.error).toMatch(/Accesso al team/);
    expect(mocks.verify).toHaveBeenCalledWith(db);
    expect(db.from).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("allows a normal member to create a task with only columns already granted by the database", async () => {
    const { calls } = client(
      { data: [{ user_id: other }], error: null },
      { data: { id }, error: null },
    );
    const result = await createTeamTask(
      {},
      form({
        title: "Imballare ordine",
        assignedTo: other,
        dueDate: "2026-10-25",
        created_by: other,
        id: other,
      }),
    );
    expect(result.success).toMatch(/Attività aggiunta/);
    expect(mocks.createClient).toHaveBeenCalledWith({ writable: true });
    expect(calls.map((call) => call.table)).toEqual(["memberships", "tasks"]);
    const row = calls[1].methods.find((method) => method.name === "insert")?.args[0];
    expect(row).toEqual({
      title: "Imballare ordine",
      description: "",
      status: "todo",
      due_at: "2026-10-25T11:00:00.000Z",
      assigned_to: other,
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/team");
  });
  it("refuses inactive or unknown assignees before inserting", async () => {
    const { calls } = client({ data: [], error: null });
    const result = await createTeamTask(
      {},
      form({ title: "Attività da conservare", assignedTo: other }),
    );
    expect(result.error).toMatch(/non è più abilitato/);
    expect(result.values?.title).toBe("Attività da conservare");
    expect(result.revision).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls).toHaveLength(1);
  });
  it("checks all selected participants and strips the auxiliary participantIds column before inserting an event", async () => {
    const { calls } = client(
      { data: [{ user_id: other }], error: null },
      { data: { id }, error: null },
    );
    const input = form({
      title: "Call sintetica",
      startsAt: "2026-10-25T02:30",
      startsOccurrence: "later",
      endsAt: "2026-10-25T03:30",
      eventType: "meeting",
    });
    input.append("participantIds", other);
    const result = await createTeamEvent({}, input);
    expect(result.success).toMatch(/Appuntamento aggiunto/);
    const row = calls[1].methods.find((method) => method.name === "insert")?.args[0] as Record<
      string,
      unknown
    >;
    expect(row.starts_at).toBe("2026-10-25T01:30:00.000Z");
    expect(row).not.toHaveProperty("participantIds");
    expect(JSON.parse(String(row.description)).participantIds).toEqual([other]);
  });
  it("does not insert a note linked to an unavailable task", async () => {
    const { calls } = client({ data: null, error: null });
    const result = await createTeamNote(
      {},
      form({ title: "Idea", body: "Testo da preservare", taskId: other }),
    );
    expect(result.error).toMatch(/non è più disponibile/);
    expect(result.values?.body).toBe("Testo da preservare");
    expect(calls).toHaveLength(1);
  });
  it("uses an expected-status guard so a stale tab cannot overwrite a collaborator’s task status", async () => {
    const { calls } = client({ data: null, error: null });
    const result = await toggleTeamTask(
      {},
      form({ id, expectedStatus: "todo", nextStatus: "done" }),
    );
    expect(calls[0].methods).toContainEqual({ name: "eq", args: ["status", "todo"] });
    expect(result.error).toMatch(/altro membro/);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("restricts deletion to known shared tables and a specific UUID", async () => {
    const { db, calls } = client({ data: [{ id }], error: null });
    const rejected = await deleteTeamItem({}, form({ table: "finance_entries", id }));
    expect(rejected.error).toMatch(/Sezione non valida/);
    expect(db.from).not.toHaveBeenCalled();
    const removed = await deleteTeamItem({}, form({ table: "notes", id }));
    expect(removed.success).toMatch(/eliminato/);
    expect(calls[0]).toMatchObject({ table: "notes" });
    expect(calls[0].methods).toContainEqual({ name: "eq", args: ["id", id] });
  });
  it("does not claim success or expose database diagnostics on an uncertain write", async () => {
    client({ data: null, error: { message: "Private SQL internals", code: "NETWORK" } });
    const result = await createTeamNote({}, form({ title: "Idea", body: "Da conservare" }));
    expect(result.error).toMatch(/Ricarica.*prima di riprovare/);
    expect(JSON.stringify(result)).not.toContain("Private SQL internals");
    expect(result.values?.body).toBe("Da conservare");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("explains a database permission change after the membership check without exposing diagnostics", async () => {
    client({ data: null, error: { message: "Private RLS internals", code: "42501" } });
    const result = await createTeamNote({}, form({ title: "Idea" }));
    expect(result.error).toMatch(/permessi.*cambiati/);
    expect(JSON.stringify(result)).not.toContain("Private RLS internals");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

it.each([
  ["event", "", "Evento"],
  ["other", "Shooting", "Shooting"],
])(
  "persists %s using the existing shared event columns",
  async (eventType, customEventType, label) => {
    const { calls } = client({ data: { id }, error: null });
    const result = await createTeamEvent(
      {},
      form({
        title: "Momento del team",
        startsAt: "2026-10-21T10:00",
        endsAt: "2026-10-21T11:00",
        eventType,
        customEventType,
      }),
    );
    expect(result.success).toMatch(/Appuntamento aggiunto/);
    expect(calls).toHaveLength(1);
    const row = calls[0].methods.find((method) => method.name === "insert")?.args[0] as Record<
      string,
      unknown
    >;
    expect(row.event_type).toBe("other");
    expect(JSON.parse(String(row.description)).typeLabel).toBe(label);
    expect(row).not.toHaveProperty("customEventType");
  },
);

const eventRow = {
  id,
  title: "Call sintetica",
  starts_at: "2026-10-25T01:30:25.123456+00:00",
  ends_at: "2026-10-25T02:30:49+00:00",
  event_type: "meeting" as const,
  description: encodeEventDetails({
    summary: "Appunti\nPartner CO 99 · /partner?co=99#lead-99",
    participantIds: [other],
    callUrl: "https://example.test/call",
  }),
  created_by: other,
};
const eventSnapshot = (row = eventRow): TeamEvent => ({
  id: row.id,
  title: row.title,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  eventType: row.event_type,
  details: decodeEventDetails(row.description),
  createdBy: row.created_by,
});
const taskRow = {
  id,
  title: "Attività sintetica",
  description: "Appunti",
  status: "in_progress" as const,
  due_at: "2026-10-25T09:31:42.123456+00:00" as string | null,
  assigned_to: other as string | null,
  created_by: other,
};
const taskSnapshot = (row = taskRow): TeamTask => ({
  id: row.id,
  title: row.title,
  description: row.description,
  status: row.status,
  dueAt: row.due_at,
  assignedTo: row.assigned_to,
  createdBy: row.created_by,
});
function editEvent(values: Record<string, string> = {}) {
  const input = form({
    id,
    expected: eventEditToken(eventSnapshot()),
    title: eventRow.title,
    summary: decodeEventDetails(eventRow.description).summary,
    callUrl: "https://example.test/call",
    startsAt: "2026-10-25T02:30",
    startsOccurrence: "later",
    endsAt: "2026-10-25T03:30",
    eventType: "meeting",
    ...values,
  });
  input.append("participantIds", other);
  return input;
}
const editTask = (values: Record<string, string> = {}) =>
  form({
    id,
    expected: taskEditToken(taskSnapshot()),
    title: taskRow.title,
    description: taskRow.description,
    status: "in_progress",
    dueDate: "2026-10-25",
    assignedTo: other,
    ...values,
  });
function expectNoDestructiveQueries(calls: { methods: { name: string }[] }[]) {
  expect(
    calls
      .flatMap((call) => call.methods)
      .some((method) => ["insert", "delete"].includes(method.name)),
  ).toBe(false);
}

describe("modifiche agli elementi condivisi del calendario", () => {
  it.each([updateTeamEvent, updateTeamTask])(
    "rifiuta id e versioni assenti o malformate senza leggere righe",
    async (action) => {
      for (const values of [
        { id: "invalid", expected: "{}" },
        { id, expected: "" },
        { id, expected: "x".repeat(100001) },
      ]) {
        const { db } = client();
        const result = await action({}, form(values));
        expect(result.error).toBeDefined();
        expect(db.from).not.toHaveBeenCalled();
      }
      const { db } = client();
      const input = form({ id, expected: "{}" });
      input.append("expected", "{}");
      expect((await action({}, input)).error).toMatch(/versione/);
      expect(db.from).not.toHaveBeenCalled();
    },
  );
  it.each(["founder", "production", "logistics", "finance", "consultant"])(
    "consente al ruolo %s di modificare senza toccare autore e identità",
    async (role) => {
      mocks.verify.mockResolvedValue({
        status: "member",
        member: { userId: id, role, financeAccess: false },
      });
      const { calls } = client({ data: eventRow, error: null }, { data: { id }, error: null });
      const result = await updateTeamEvent(
        {},
        editEvent({ title: "Call aggiornata", created_by: id }),
      );
      expect(result.success).toMatch(/Appuntamento modificato/);
      expect(result.updatedItem).toEqual({ id, day: "2026-10-25", kind: "event" });
      expect(calls.map((call) => call.table)).toEqual(["calendar_events", "calendar_events"]);
      const write = calls[1].methods.find((method) => method.name === "update")?.args[0] as Record<
        string,
        unknown
      >;
      expect(Object.keys(write).sort()).toEqual([
        "description",
        "ends_at",
        "event_type",
        "starts_at",
        "title",
      ]);
      expect(write.starts_at).toBe(eventRow.starts_at);
      expect(write.ends_at).toBe(eventRow.ends_at);
      expect(JSON.parse(String(write.description)).summary).toContain("/partner?co=99#lead-99");
      expectNoDestructiveQueries(calls);
      expect(mocks.revalidate.mock.calls.map(([path]) => path)).toEqual([
        "/team",
        "/",
        "/audit",
        "/partner",
        "/team/partner",
      ]);
    },
  );
  it.each(["title", "description", "starts_at", "ends_at", "event_type"])(
    "il CAS protegge il campo appuntamento originale %s dopo la lettura",
    async (column) => {
      const { calls } = client({ data: eventRow, error: null }, { data: null, error: null });
      const result = await updateTeamEvent({}, editEvent({ title: "Call nuova" }));
      expect(calls[1].methods).toContainEqual({
        name: "eq",
        args: [column, eventRow[column as keyof typeof eventRow]],
      });
      expect(result.error).toMatch(/altro membro.*Ricarica/);
      expect(result.values?.title).toBe("Call nuova");
      expect(result.values?.startsOccurrence).toBe("later");
      expect(result.participantIds).toEqual([other]);
      expect(mocks.revalidate).not.toHaveBeenCalled();
      expectNoDestructiveQueries(calls);
    },
  );
  it("non sovrascrive un appuntamento modificato da un’altra scheda prima della rilettura", async () => {
    const { calls } = client({ data: { ...eventRow, title: "Titolo già cambiato" }, error: null });
    const result = await updateTeamEvent({}, editEvent({ title: "Mio testo da conservare" }));
    expect(result.error).toMatch(/altro membro/);
    expect(result.values?.title).toBe("Mio testo da conservare");
    expect(calls).toHaveLength(1);
  });
  it.each([updateTeamEvent, updateTeamTask])(
    "se la riga non è più visibile sotto RLS non scrive",
    async (action) => {
      const { calls } = client({ data: null, error: null });
      const result = await action({}, action === updateTeamEvent ? editEvent() : editTask());
      expect(result.error).toMatch(/modificato o rimosso/);
      expect(calls).toHaveLength(1);
    },
  );
  it("non genera un UPDATE o audit per un appuntamento invariato, nemmeno con precisione Postgres", async () => {
    const { calls } = client({ data: eventRow, error: null });
    const result = await updateTeamEvent({}, editEvent());
    expect(result.success).toMatch(/nessuna modifica/);
    expect(result.updatedItem).toEqual({ id, day: "2026-10-25", kind: "event" });
    expect(calls).toHaveLength(1);
  });
  it.each([
    "Descrizione sintetica precedente",
    encodeEventDetails({
      summary: "Descrizione sintetica precedente",
      participantIds: [],
      callUrl: null,
    }),
  ])(
    "un evento Altro senza etichetta resta invariato anche con il valore visibile di ripiego",
    async (description) => {
      const original = { ...eventRow, event_type: "other", description };
      const snapshot = {
        ...eventSnapshot(),
        eventType: "other" as const,
        details: decodeEventDetails(description),
      };
      const { calls } = client({ data: original, error: null });
      const input = editEvent({
        expected: eventEditToken(snapshot),
        eventType: "other",
        customEventType: "Altro",
        summary: snapshot.details.summary,
        callUrl: "",
      });
      input.delete("participantIds");
      const result = await updateTeamEvent({}, input);
      expect(result.success).toMatch(/nessuna modifica/);
      expect(result.updatedItem).toEqual({ id, day: "2026-10-25", kind: "event" });
      expect(calls).toHaveLength(1);
      expectNoDestructiveQueries(calls);
    },
  );
  it("un evento Altro precedente può ricevere un’etichetta personalizzata esplicita", async () => {
    const description = "Descrizione sintetica precedente";
    const original = { ...eventRow, event_type: "other", description };
    const snapshot = {
      ...eventSnapshot(),
      eventType: "other" as const,
      details: decodeEventDetails(description),
    };
    const { calls } = client({ data: original, error: null }, { data: { id }, error: null });
    const input = editEvent({
      expected: eventEditToken(snapshot),
      eventType: "other",
      customEventType: "Shooting",
      summary: description,
      callUrl: "",
    });
    input.delete("participantIds");
    const result = await updateTeamEvent({}, input);
    expect(result.success).toMatch(/Appuntamento modificato/);
    const write = calls[1].methods.find((method) => method.name === "update")?.args[0] as Record<
      string,
      unknown
    >;
    expect(decodeEventDetails(String(write.description))).toMatchObject({
      summary: description,
      typeLabel: "Shooting",
    });
  });
  it("mantiene partecipanti inattivi esistenti ma verifica ogni nuovo partecipante", async () => {
    const { calls } = client({ data: eventRow, error: null }, { data: [], error: null });
    const input = editEvent({ title: "Call aggiornata" });
    input.append("participantIds", id);
    const result = await updateTeamEvent({}, input);
    expect(result.error).toMatch(/non è più abilitato/);
    expect(result.participantIds).toEqual([other, id]);
    expect(calls[1].methods).toContainEqual({ name: "in", args: ["user_id", [id]] });
    expectNoDestructiveQueries(calls);
  });
  it("salva un appuntamento di giornata intera senza perdere il tipo Evento", async () => {
    const { calls } = client({ data: eventRow, error: null }, { data: { id }, error: null });
    const result = await updateTeamEvent(
      {},
      editEvent({
        allDay: "true",
        startsAt: "2026-03-29",
        endsAt: "2026-03-29",
        eventType: "event",
      }),
    );
    expect(result.updatedItem?.day).toBe("2026-03-29");
    const write = calls[1].methods.find((method) => method.name === "update")?.args[0] as Record<
      string,
      unknown
    >;
    expect(write.starts_at).toBe("2026-03-28T23:00:00.000Z");
    expect(write.ends_at).toBe("2026-03-29T22:00:00.000Z");
    expect(write.event_type).toBe("other");
    expect(JSON.parse(String(write.description))).toMatchObject({
      allDay: true,
      typeLabel: "Evento",
      participantIds: [other],
    });
  });
  it("conserva i valori invalidi, la scelta giornata intera e i partecipanti", async () => {
    const { db } = client();
    const result = await updateTeamEvent(
      {},
      editEvent({ allDay: "true", startsAt: "2026-02-30", endsAt: "2026-03-01" }),
    );
    expect(result.error).toMatch(/data non esiste/);
    expect(result.values).toMatchObject({
      allDay: "true",
      startsAt: "2026-02-30",
      title: eventRow.title,
    });
    expect(result.participantIds).toEqual([other]);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("non modifica l’istante di scadenza quando il giorno romano dell’attività resta uguale", async () => {
    const { calls } = client({ data: taskRow, error: null }, { data: { id }, error: null });
    const result = await updateTeamTask(
      {},
      editTask({ title: "Attività corretta", status: "done", created_by: id }),
    );
    expect(result.success).toMatch(/Attività modificata/);
    const write = calls[1].methods.find((method) => method.name === "update")?.args[0];
    expect(write).toEqual({
      title: "Attività corretta",
      description: taskRow.description,
      status: "done",
      due_at: taskRow.due_at,
      assigned_to: other,
    });
    expect(result.updatedItem).toEqual({ id, day: "2026-10-25", kind: "task" });
    expectNoDestructiveQueries(calls);
  });
  it("elimina la scadenza e l’assegnazione solo quando richiesto, usando CAS sui valori non nulli", async () => {
    const { calls } = client({ data: taskRow, error: null }, { data: { id }, error: null });
    const result = await updateTeamTask({}, editTask({ dueDate: "", assignedTo: "" }));
    expect(result.updatedItem).toEqual({ id, day: null, kind: "task" });
    expect(calls[1].methods).toContainEqual({ name: "eq", args: ["due_at", taskRow.due_at] });
    expect(calls[1].methods).toContainEqual({ name: "eq", args: ["assigned_to", other] });
    expect(calls[1].methods.find((method) => method.name === "update")?.args[0]).toMatchObject({
      due_at: null,
      assigned_to: null,
      status: "in_progress",
    });
  });
  it("protegge i campi nulli del task con is null e verifica un nuovo assegnatario", async () => {
    const original = { ...taskRow, due_at: null, assigned_to: null };
    const { calls } = client(
      { data: original, error: null },
      { data: [{ user_id: other }], error: null },
      { data: { id }, error: null },
    );
    const result = await updateTeamTask(
      {},
      editTask({ expected: taskEditToken(taskSnapshot(original)) }),
    );
    expect(result.success).toMatch(/Attività modificata/);
    expect(calls[2].methods).toContainEqual({ name: "is", args: ["due_at", null] });
    expect(calls[2].methods).toContainEqual({ name: "is", args: ["assigned_to", null] });
    for (const column of ["title", "description", "status"])
      expect(calls[2].methods).toContainEqual({
        name: "eq",
        args: [column, original[column as keyof typeof original]],
      });
  });
  it("un nuovo assegnatario inattivo non è ammesso e il modulo viene conservato", async () => {
    client({ data: taskRow, error: null }, { data: [], error: null });
    const result = await updateTeamTask({}, editTask({ assignedTo: id }));
    expect(result.error).toMatch(/non è più abilitato/);
    expect(result.values).toMatchObject({ assignedTo: id, status: "in_progress" });
  });
  it("un’attività invariata non produce scritture, anche se il DB usa un orario diverso da mezzogiorno", async () => {
    const { calls } = client({ data: taskRow, error: null });
    const result = await updateTeamTask({}, editTask());
    expect(result.success).toMatch(/nessuna modifica/);
    expect(calls).toHaveLength(1);
  });
  it("rifiuta una versione task precedente, inclusi stato o scadenza cambiati", async () => {
    const { calls } = client({ data: { ...taskRow, status: "done" }, error: null });
    const result = await updateTeamTask({}, editTask({ title: "Mio aggiornamento" }));
    expect(result.error).toMatch(/altro membro/);
    expect(result.values?.title).toBe("Mio aggiornamento");
    expect(calls).toHaveLength(1);
  });
  it("gestisce il conflitto CAS del task fra lettura e aggiornamento", async () => {
    const { calls } = client({ data: taskRow, error: null }, { data: null, error: null });
    const result = await updateTeamTask({}, editTask({ title: "Mio aggiornamento" }));
    expect(result.error).toMatch(/altro membro/);
    expect(result.values?.title).toBe("Mio aggiornamento");
    expect(calls).toHaveLength(2);
    expectNoDestructiveQueries(calls);
  });
  it.each(["42501", "NETWORK"])(
    "protegge i dettagli tecnici su un errore %s dopo la rilettura",
    async (code) => {
      client(
        { data: taskRow, error: null },
        { data: null, error: { code, message: "Dettagli SQL privati" } },
      );
      const result = await updateTeamTask({}, editTask({ title: "Testo ancora presente" }));
      expect(result.error).toBeDefined();
      expect(result.values?.title).toBe("Testo ancora presente");
      expect(JSON.stringify(result)).not.toContain("Dettagli SQL privati");
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );
});
