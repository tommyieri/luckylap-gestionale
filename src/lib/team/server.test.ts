import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { loadTeamWorkspace } from "./server";
import { encodeEventDetails } from "./model";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

describe("shared team loader visibility", () => {
  it("loads everyone's events, tasks, notes and ideas without an assignee or participant filter", async () => {
    const rows: Record<string, Record<string, unknown>[]> = {
      calendar_events: [
        {
          id: id(10),
          title: "Evento senza il consulente",
          description: encodeEventDetails({
            summary: "Agenda",
            participantIds: [id(2)],
            callUrl: null,
            typeLabel: "Evento",
          }),
          starts_at: "2026-10-21T10:00:00Z",
          ends_at: "2026-10-21T11:00:00Z",
          event_type: "other",
          created_by: id(1),
        },
      ],
      tasks: [
        {
          id: id(11),
          title: "Attività non assegnata",
          description: "",
          status: "todo",
          due_at: null,
          assigned_to: null,
          created_by: id(1),
        },
        {
          id: id(12),
          title: "Attività di un altro membro",
          description: "",
          status: "todo",
          due_at: null,
          assigned_to: id(3),
          created_by: id(2),
        },
      ],
      notes: [
        {
          id: id(13),
          title: "Idea condivisa",
          body: "Nota di un altro membro",
          task_id: null,
          created_at: "2026-10-21T09:00:00Z",
          created_by: id(4),
        },
      ],
      profiles: Array.from({ length: 5 }, (_, index) => ({
        user_id: id(index + 1),
        display_name: `Membro ${index + 1}`,
      })),
      memberships: Array.from({ length: 5 }, (_, index) => ({
        user_id: id(index + 1),
        active: true,
      })),
    };
    const calls: { table: string; filters: { name: string; args: unknown[] }[] }[] = [];
    const client = {
      from: (table: string) => {
        const call = { table, filters: [] as { name: string; args: unknown[] }[] };
        calls.push(call);
        const query: Record<string, unknown> = {};
        for (const name of ["select", "order", "limit", "eq", "gt", "in", "filter"])
          query[name] = (...args: unknown[]) => {
            call.filters.push({ name, args });
            return query;
          };
        query.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: rows[table], count: rows[table].length, error: null }).then(
            resolve,
          );
        return query;
      },
    };
    const snapshot = await loadTeamWorkspace(client as unknown as SupabaseClient);
    expect(snapshot.members).toHaveLength(5);
    expect(snapshot.events[0].details.participantIds).not.toContain(id(5));
    expect(snapshot.events.map((event) => event.title)).toEqual(["Evento senza il consulente"]);
    expect(snapshot.tasks).toHaveLength(2);
    expect(snapshot.tasks.map((task) => task.assignedTo)).toContain(null);
    expect(snapshot.tasks.map((task) => task.assignedTo)).toContain(id(3));
    expect(snapshot.notes[0].createdBy).toBe(id(4));
    for (const call of calls.filter((call) =>
      ["calendar_events", "tasks", "notes"].includes(call.table),
    )) {
      expect(call.filters.filter((filter) => ["eq", "in", "filter"].includes(filter.name))).toEqual(
        [],
      );
    }
  });
});
