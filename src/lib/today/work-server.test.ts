import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ status: vi.fn(), followups: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("../sales/server", () => ({ readSalesWorkspace: vi.fn() }));
vi.mock("../partner/server", () => ({ loadPartnerAssistantStatus: mocks.status }));
vi.mock("./automatic-mail-server", () => ({ loadAutomaticFollowupMode: mocks.followups }));
const { loadPartnerWorkTile } = await import("./work-server");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const userId = id(9000);
const now = new Date("2026-11-10T08:00:00Z");
const partner = (n: number) => ({
  id: id(n),
  co: n,
  name: `Contatto sintetico ${n}`,
  stage: "da_contattare",
  contact_month: "2026-11-01",
  owner_id: null,
  next_action: null,
  next_action_on: null,
  research_removed_at: null,
});
type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
function client(tables: Tables, failed: string | null = null, truncated: string | null = null) {
  const calls: { table: string; columns: string; after: string | null }[] = [];
  const db = {
    calls,
    from: vi.fn((table: string) => {
      let columns = "",
        key = "id",
        limit = 200,
        after: string | null = null;
      const filters: ((row: Row) => boolean)[] = [];
      const query = {
        select: (value: string) => {
          columns = value;
          return query;
        },
        order: (value: string) => {
          key = value;
          return query;
        },
        limit: (value: number) => {
          limit = value;
          return query;
        },
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return query;
        },
        is: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return query;
        },
        in: (column: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[column]));
          return query;
        },
        gt: (column: string, value: string) => {
          after = value;
          filters.push((row) => String(row[column]) > value);
          return query;
        },
        abortSignal: () => query,
        then: <T>(
          resolve: (value: { data: Row[] | null; count: number | null; error: unknown }) => T,
        ) => {
          calls.push({ table, columns, after });
          if (table === failed)
            return Promise.resolve(
              resolve({ data: null, count: null, error: { message: "Errore sintetico" } }),
            );
          const matching = (tables[table] ?? [])
            .filter((row) => filters.every((filter) => filter(row)))
            .sort((a, b) => String(a[key]).localeCompare(String(b[key])));
          const rows = matching.slice(0, limit);
          return Promise.resolve(
            resolve({
              data: table === truncated ? rows.slice(0, -1) : rows,
              count: matching.length,
              error: null,
            }),
          );
        },
      };
      return query;
    }),
  };
  return db;
}
const sample = (): Tables => ({
  partners: [partner(1), partner(2)],
  profiles: [],
  partner_do_not_contact: [],
  partner_assistant_jobs: [{ partner_id: id(1), status: "pronta" }],
  partner_assistant_contacts: [],
  partner_activities: [
    { id: id(501), partner_id: id(1), origin: "assistente", kind: "inviato" },
    { id: id(502), partner_id: id(2), origin: "team", kind: "inviato" },
  ],
  partner_work_links: [
    { id: id(601), partner_id: id(1), kind: "follow_up", activity_id: id(501), task_id: id(701) },
    { id: id(602), partner_id: id(2), kind: "follow_up", activity_id: id(502), task_id: id(702) },
  ],
  tasks: [
    {
      id: id(701),
      title: "Sollecito sintetico automatico",
      due_at: "2026-11-09T08:00:00Z",
      status: "todo",
      assigned_to: userId,
    },
    {
      id: id(702),
      title: "Sollecito sintetico manuale",
      due_at: "2026-11-09T08:00:00Z",
      status: "todo",
      assigned_to: userId,
    },
    {
      id: id(703),
      title: "Controllare una risposta",
      due_at: "2026-11-09T08:00:00Z",
      status: "todo",
      assigned_to: userId,
    },
    {
      id: id(704),
      title: "Attività di un'altra persona",
      due_at: "2026-11-09T08:00:00Z",
      status: "todo",
      assigned_to: id(9001),
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockResolvedValue({ configured: true, mode: "invio", pausedReason: "credito" });
  mocks.followups.mockResolvedValue("invio");
});

describe("Oggi: letture complete e filtro conservativo del lavoro manuale", () => {
  it("separa gli automatici e conserva il sollecito manuale senza leggere testi della posta o ricerca", async () => {
    const db = client(sample());
    const tile = await loadPartnerWorkTile(db as never, now, userId);
    expect(tile).toMatchObject({
      status: "ok",
      data: {
        contactCount: 1,
        reminderCount: 1,
        contacts: [{ co: 2 }],
        reminders: [{ id: id(702) }],
      },
    });
    expect(db.calls.some((call) => call.table === "partner_contacts")).toBe(false);
    expect(
      db.calls.every(
        (call) => !/(?:^|,)(?:body|research|raw|link_value|signature)(?:,|$)/u.test(call.columns),
      ),
    ).toBe(true);
  });

  it.each(["spento", "osserva", "unknown"])(
    "con solleciti %s mantiene tutti i promemoria",
    async (mode) => {
      mocks.followups.mockResolvedValue(mode);
      const tile = await loadPartnerWorkTile(client(sample()) as never, now, userId);
      expect(tile).toMatchObject({ status: "ok", data: { reminderCount: 2 } });
    },
  );

  it("stato o tabelle assistente illeggibili non rendono il lavoro manuale vuoto o indisponibile", async () => {
    mocks.status.mockRejectedValue(new Error("Errore sintetico"));
    mocks.followups.mockRejectedValue(new Error("Errore sintetico"));
    const tile = await loadPartnerWorkTile(
      client(sample(), "partner_assistant_jobs") as never,
      now,
      userId,
    );
    expect(tile).toMatchObject({ status: "ok", data: { contactCount: 2, reminderCount: 2 } });
  });

  it.each([
    "non_attivo",
    { configured: true, mode: "spento" },
    { configured: true, mode: "prepara" },
    { configured: true, mode: "prova" },
    { configured: false, mode: "invio" },
  ])("con configurazione generale %j conserva i promemoria anche se FU è invio", async (status) => {
    mocks.status.mockResolvedValue(status);
    const tile = await loadPartnerWorkTile(client(sample()) as never, now, userId);
    expect(tile).toMatchObject({ status: "ok", data: { contactCount: 2, reminderCount: 2 } });
  });

  it.each([
    "partners",
    "profiles",
    "partner_activities",
    "partner_work_links",
    "tasks",
    "partner_do_not_contact",
  ])("una lettura operativa %s fallita non mostra conteggi parziali", async (table) => {
    expect(await loadPartnerWorkTile(client(sample(), table) as never, now, userId)).toEqual({
      status: "error",
    });
  });

  it("rifiuta una pagina troncata e rifiuta l'utente assente prima di leggere", async () => {
    expect(
      await loadPartnerWorkTile(client(sample(), null, "partners") as never, now, userId),
    ).toEqual({ status: "error" });
    const db = client(sample());
    expect(await loadPartnerWorkTile(db as never, now, "non-un-id")).toEqual({ status: "error" });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("legge anche i manuali dopo la prima pagina e calcola il conteggio completo prima delle otto righe", async () => {
    const db = client({
      partners: Array.from({ length: 250 }, (_, index) => partner(index + 1)),
      partner_assistant_jobs: Array.from({ length: 200 }, (_, index) => ({
        partner_id: id(index + 1),
        status: "pronta",
      })),
    });
    const tile = await loadPartnerWorkTile(db as never, now, userId);
    expect(tile).toMatchObject({ status: "ok", data: { contactCount: 50, reminderCount: 0 } });
    if (tile.status === "ok")
      expect(tile.data.contacts.map((contact) => contact.co)).toEqual([
        201, 202, 203, 204, 205, 206, 207, 208,
      ]);
    expect(db.calls.filter((call) => call.table === "partners").map((call) => call.after)).toEqual([
      null,
      id(200),
    ]);
  });

  it("legge più di duemila attività operative senza troncare la fonte del filtro", async () => {
    const tables = sample();
    tables.partner_activities = Array.from({ length: 2201 }, (_, index) => ({
      id: id(10000 + index),
      partner_id: id(1),
      origin: "assistente",
      kind: "inviato",
    }));
    // L'ultima attività del team preserva il contatto: deve essere letta oltre ogni pagina.
    tables.partner_activities[2200].origin = "team";
    const db = client(tables);
    const tile = await loadPartnerWorkTile(db as never, now, userId);
    expect(tile).toMatchObject({ status: "ok", data: { contactCount: 2 } });
    expect(db.calls.filter((call) => call.table === "partner_activities")).toHaveLength(12);
  });

  it("oltre il limite operativo mostra errore anziché usare una fonte troncata", async () => {
    const tables = sample();
    tables.partner_activities = Array.from({ length: 10001 }, (_, index) => ({
      id: id(10000 + index),
      partner_id: id(1),
      origin: "assistente",
      kind: "inviato",
    }));
    expect(await loadPartnerWorkTile(client(tables) as never, now, userId)).toEqual({
      status: "error",
    });
  });

  it("legge il minimo indispensabile per un blocco di dominio e non espone il recapito", async () => {
    const tables = sample();
    tables.partner_do_not_contact = [
      { id: id(801), partner_id: null, domain: "blocked.example.test", active: true },
    ];
    tables.partner_contacts = [
      {
        id: id(802),
        partner_id: id(2),
        kind: "web",
        link_value: "https://blocked.example.test/",
        erased_at: null,
      },
    ];
    const db = client(tables);
    const tile = await loadPartnerWorkTile(db as never, now, userId);
    expect(tile).toMatchObject({ status: "ok", data: { contactCount: 0 } });
    expect(JSON.stringify(tile)).not.toContain("blocked.example.test");
    expect(db.calls.find((call) => call.table === "partner_contacts")?.columns).toBe(
      "id,partner_id,kind,link_value",
    );
    expect(
      await loadPartnerWorkTile(client(tables, "partner_contacts") as never, now, userId),
    ).toEqual({ status: "error" });
  });
});
