import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), verify: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.verify }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import {
  createTeamEvent,
  createTeamNote,
  createTeamTask,
  deleteTeamItem,
  toggleTeamTask,
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
      for (const name of ["select", "insert", "delete", "update", "eq", "in"])
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
  it.each([createTeamEvent, createTeamTask, createTeamNote, deleteTeamItem, toggleTeamTask])(
    "anteprima locale: salvataggio disattivato, mai Supabase",
    async (action) => {
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
    },
  );
  it.each([createTeamEvent, createTeamTask, createTeamNote, deleteTeamItem, toggleTeamTask])(
    "checks current membership before every action, including malformed input",
    async (action) => {
      const { db } = client();
      mocks.verify.mockResolvedValue({ status: "denied" });
      const result = await action({}, new FormData());
      expect(result.error).toMatch(/Accesso al team/);
      expect(mocks.verify).toHaveBeenCalledWith(db);
      expect(db.from).not.toHaveBeenCalled();
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );
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
