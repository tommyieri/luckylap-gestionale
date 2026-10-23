import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamSnapshot, TeamTask } from "../team/model";

const mocks = vi.hoisted(() => ({ loadTeam: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("../team/server", () => ({ loadTeamWorkspace: mocks.loadTeam }));
vi.mock("../auth/server", () => ({ loadAuthenticatedInventory: vi.fn() }));
const { loadAgendaTile, readFollowUpTaskIds } = await import("./server");

const me = "00000000-0000-4000-8000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const task = (n: number, title: string): TeamTask => ({
  id: id(n),
  title,
  description: "",
  status: "todo",
  dueAt: "2026-10-22T08:00:00.000Z",
  assignedTo: me,
  createdBy: me,
});
const member = {
  userId: me,
  displayName: "Persona sintetica",
  role: "founder",
  financeAccess: false,
} as const;
const now = new Date("2026-10-22T10:00:00.000Z");

/** Client finto: `partner_work_links` risponde con le righe date, e registra i filtri. */
function client(rows: (ids: string[]) => unknown, error: unknown = null) {
  const calls: { kind?: unknown; ids?: string[] }[] = [];
  return {
    calls,
    from: vi.fn((table: string) => {
      expect(table).toBe("partner_work_links");
      const call: { kind?: unknown; ids?: string[] } = {};
      calls.push(call);
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          expect(column).toBe("kind");
          call.kind = value;
          return query;
        },
        in: (column: string, ids: string[]) => {
          expect(column).toBe("task_id");
          call.ids = ids;
          return Promise.resolve({ data: rows(ids), error });
        },
      };
      return query;
    }),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("Agenda di Oggi senza solleciti Partner", () => {
  it("toglie le attività collegate come sollecito e tiene le altre", async () => {
    const team: TeamSnapshot = {
      events: [],
      tasks: [task(1, "Sollecito · Club sintetico"), task(2, "Preparare lo stand")],
      notes: [],
      members: [],
    } as unknown as TeamSnapshot;
    mocks.loadTeam.mockResolvedValue(team);
    const db = client(() => [{ task_id: id(1) }]);
    const tile = await loadAgendaTile(db as never, member, now);
    expect(tile.status).toBe("ok");
    if (tile.status !== "ok") return;
    expect(tile.data.tasks.map((row) => row.task.title)).toEqual(["Preparare lo stand"]);
    expect(db.calls).toEqual([{ kind: "follow_up", ids: [id(2), id(1)] }]);
  });

  it("senza attività in agenda non legge i collegamenti", async () => {
    mocks.loadTeam.mockResolvedValue({ events: [], tasks: [], notes: [], members: [] });
    const db = client(() => []);
    expect((await loadAgendaTile(db as never, member, now)).status).toBe("ok");
    expect(db.from).not.toHaveBeenCalled();
  });

  it("una lettura dei solleciti non riuscita o strana è un errore del riquadro, mai un doppione", async () => {
    mocks.loadTeam.mockResolvedValue({
      events: [],
      tasks: [task(1, "Sollecito · Club sintetico")],
      notes: [],
      members: [],
    });
    expect(
      (await loadAgendaTile(client(() => null, { message: "rete" }) as never, member, now)).status,
    ).toBe("error");
    expect(
      (await loadAgendaTile(client(() => [{ task_id: id(9) }]) as never, member, now)).status,
    ).toBe("error");
  });

  it("legge a gruppi di 100 id", async () => {
    const ids = Array.from({ length: 230 }, (_, n) => id(n + 1));
    const db = client((chunk) => chunk.slice(0, 1).map((taskId) => ({ task_id: taskId })));
    const found = await readFollowUpTaskIds(db as never, ids);
    expect(db.calls.map((call) => call.ids?.length)).toEqual([100, 100, 30]);
    expect([...found]).toEqual([id(1), id(101), id(201)]);
  });
});
