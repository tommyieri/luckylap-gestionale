import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { TeamEvent, TeamSnapshot } from "../lib/team/model";

/** `showPast` è l'unico stato: `undefined` lascia il valore iniziale del componente. */
const state = vi.hoisted(() => ({ showPast: undefined as boolean | undefined }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (value: unknown) => [state.showPast ?? value, vi.fn()],
    useTransition: () => [false, vi.fn()],
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./team-workspace-forms", () => ({
  DeleteTeamForm: () => null,
  NewEventForm: () => null,
  NewNoteForm: () => null,
  NewTaskForm: () => null,
  ToggleTaskForm: () => null,
}));
import { TeamWorkspace } from "./team-workspace";

function visibleText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join(" ");
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  return visibleText((node as ReactElement<{ children?: unknown }>).props.children);
}

describe("team workspace shared overview", () => {
  beforeEach(() => {
    state.showPast = undefined;
  });

  it("shows unassigned work and persisted event labels, with past events behind the switch", () => {
    const snapshot: TeamSnapshot = {
      members: [],
      events: [
        {
          id: "past",
          title: "Evento già trascorso",
          startsAt: "2026-10-01T10:00:00Z",
          endsAt: "2026-10-01T11:00:00Z",
          eventType: "other",
          details: {
            summary: "",
            participantIds: [],
            callUrl: null,
            typeLabel: "Shooting fotografico",
          },
          createdBy: "another-member",
        },
      ],
      tasks: [
        {
          id: "unassigned",
          title: "Attività senza assegnatario",
          description: "",
          status: "todo",
          dueAt: null,
          assignedTo: null,
          createdBy: "another-member",
        },
      ],
      notes: [
        {
          id: "idea",
          title: "Idea di un altro membro",
          body: "Condivisa",
          taskId: null,
          createdAt: "2026-10-01T10:00:00Z",
          createdBy: "another-member",
        },
      ],
    };
    const props = { snapshot, displayName: "Membro corrente", loadedAt: "2026-10-21T10:00:00Z" };
    const hidden = visibleText(TeamWorkspace(props)).replace(/\s+/g, " ");
    expect(hidden).not.toContain("Evento già trascorso");
    expect(hidden).toContain("1 passato nascosto");
    expect(hidden).toContain("Nessun appuntamento in programma.");
    state.showPast = true;
    const text = visibleText(TeamWorkspace(props));
    expect(text).not.toContain("passato nascosto");
    expect(text).toContain("Evento già trascorso");
    expect(text).toContain("Shooting fotografico");
    expect(text).toContain("Attività senza assegnatario");
    expect(text).toContain("Idea di un altro membro");
    expect(text).toContain("anche senza assegnatario");
  });
  it.each([
    ["2026-03-28T23:00:00Z", "2026-03-29T22:00:00Z", "29 mar 2026", null],
    ["2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z", "25 ott 2026", null],
    ["2026-10-24T22:00:00Z", "2026-10-26T23:00:00Z", "25 ott 2026", "26 ott 2026"],
  ])(
    "mostra date inclusive senza mezzanotte per la giornata intera %s",
    (startsAt, endsAt, start, end) => {
      const snapshot: TeamSnapshot = {
        members: [],
        tasks: [],
        notes: [],
        events: [
          {
            id: "event",
            title: "Evento Partner sintetico",
            startsAt: startsAt!,
            endsAt: endsAt!,
            eventType: "other",
            details: { summary: "", participantIds: [], callUrl: null, allDay: true },
            createdBy: "member",
          },
        ],
      };
      const text = visibleText(
        TeamWorkspace({ snapshot, displayName: "Membro", loadedAt: "2026-01-01T12:00:00Z" }),
      ).replace(/\s+/g, " ");
      expect(text).toContain("Giornata intera");
      expect(text).toContain(start);
      expect(text).not.toContain("00:00");
      expect(text).not.toContain("Fine:");
      if (end) expect(text).toContain(`Fino al ${end}`);
      else expect(text).not.toContain("Fino al");
    },
  );

  const event = (
    id: string,
    title: string,
    startsAt: string,
    endsAt: string,
    allDay = false,
  ): TeamEvent => ({
    id,
    title,
    startsAt,
    endsAt,
    eventType: "other",
    details: { summary: "", participantIds: [], callUrl: null, ...(allDay ? { allDay } : {}) },
    createdBy: "member",
  });
  const calendar = (events: TeamEvent[], loadedAt: string) =>
    visibleText(
      TeamWorkspace({
        snapshot: { members: [], tasks: [], notes: [], events },
        displayName: "Membro",
        loadedAt,
      }),
    ).replace(/\s+/g, " ");

  it("all'inizio mostra solo i prossimi e conta i passati nascosti (06 R16)", () => {
    const events = [
      event("a", "Call di settembre", "2026-09-30T08:00:00Z", "2026-09-30T09:00:00Z"),
      event("b", "Call di ieri", "2026-10-22T08:00:00Z", "2026-10-22T09:00:00Z"),
      event("c", "Call finita adesso", "2026-10-23T09:00:00Z", "2026-10-23T10:00:00Z"),
      event("d", "Call in corso", "2026-10-23T09:30:00Z", "2026-10-23T10:30:00Z"),
      event("e", "Call di domani", "2026-10-24T08:00:00Z", "2026-10-24T09:00:00Z"),
    ];
    const text = calendar(events, "2026-10-23T10:00:00Z");
    expect(text).toContain("3 passati nascosti");
    for (const title of ["Call di settembre", "Call di ieri", "Call finita adesso"])
      expect(text).not.toContain(title);
    expect(text).toContain("Call in corso");
    expect(text).toContain("Call di domani");
    expect(text).toContain("Calendario e call 5");
    expect(calendar(events.slice(3), "2026-10-23T10:00:00Z")).not.toContain("nascost");
  });

  it("con le date Partner a giornata intera: oggi resta in vista fino a mezzanotte di Roma", () => {
    // Come le scrive partner_work_links: inizio e fine a mezzanotte di Roma, fine esclusa.
    const events = [
      event("p1", "Evento · Partner di ieri", "2026-10-21T22:00:00Z", "2026-10-22T22:00:00Z", true),
      event("p2", "Evento · Partner di oggi", "2026-10-22T22:00:00Z", "2026-10-23T22:00:00Z", true),
      event("p3", "Candidatura · Partner", "2026-10-21T22:00:00Z", "2026-10-24T22:00:00Z", true),
    ];
    const morning = calendar(events, "2026-10-23T06:00:00Z");
    expect(morning).toContain("1 passato nascosto");
    expect(morning).not.toContain("Partner di ieri");
    expect(morning).toContain("Evento · Partner di oggi");
    expect(morning).toContain("Candidatura · Partner");
    expect(morning).toContain("Fino al 24 ott 2026");
    const lateEvening = calendar(events, "2026-10-23T21:59:00Z");
    expect(lateEvening).toContain("Evento · Partner di oggi");
    const midnight = calendar(events, "2026-10-23T22:00:00Z");
    expect(midnight).toContain("2 passati nascosti");
    expect(midnight).not.toContain("Partner di oggi");
    expect(midnight).toContain("Candidatura · Partner");
  });
});
