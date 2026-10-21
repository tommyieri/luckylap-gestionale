import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { TeamSnapshot } from "../lib/team/model";

vi.mock("react", async () => { const actual = await vi.importActual<typeof import("react")>("react"); return { ...actual, useState: (value: unknown) => [value, vi.fn()], useTransition: () => [false, vi.fn()] }; });
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./team-workspace-forms", () => ({ DeleteTeamForm: () => null, NewEventForm: () => null, NewNoteForm: () => null, NewTaskForm: () => null, ToggleTaskForm: () => null }));
import { TeamWorkspace } from "./team-workspace";

function visibleText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join(" ");
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  return visibleText((node as ReactElement<{ children?: unknown }>).props.children);
}

describe("team workspace shared overview", () => {
  it("shows past and unassigned work by default, together with persisted event labels", () => {
    const snapshot: TeamSnapshot = {
      members: [],
      events: [{ id: "past", title: "Evento già trascorso", startsAt: "2026-10-01T10:00:00Z", endsAt: "2026-10-01T11:00:00Z", eventType: "other", details: { summary: "", participantIds: [], callUrl: null, typeLabel: "Shooting fotografico" }, createdBy: "another-member" }],
      tasks: [{ id: "unassigned", title: "Attività senza assegnatario", description: "", status: "todo", dueAt: null, assignedTo: null, createdBy: "another-member" }],
      notes: [{ id: "idea", title: "Idea di un altro membro", body: "Condivisa", taskId: null, createdAt: "2026-10-01T10:00:00Z", createdBy: "another-member" }],
    };
    const text = visibleText(TeamWorkspace({ snapshot, displayName: "Membro corrente", loadedAt: "2026-10-21T10:00:00Z" }));
    expect(text).toContain("Evento già trascorso");
    expect(text).toContain("Shooting fotografico");
    expect(text).toContain("Attività senza assegnatario");
    expect(text).toContain("Idea di un altro membro");
    expect(text).toContain("anche senza assegnatario");
  });
});
