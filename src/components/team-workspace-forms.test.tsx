import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { TeamActionState } from "../lib/team/model";

const mocks = vi.hoisted(() => ({ state: {} as TeamActionState }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: () => [mocks.state, vi.fn(), false],
    useId: () => "event-test",
    useState: (value: unknown) => [value, vi.fn()],
  };
});
vi.mock("../app/team/actions", () => ({
  createTeamEvent: vi.fn(),
  createTeamNote: vi.fn(),
  createTeamTask: vi.fn(),
  deleteTeamItem: vi.fn(),
  toggleTeamTask: vi.fn(),
}));
import { NewEventForm } from "./team-workspace-forms";

function descendants(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...descendants(element.props.children)];
}
function fields() {
  const outer = NewEventForm({ members: [] });
  const render = outer.type as (props: unknown) => ReactElement;
  return { outer, elements: descendants(render(outer.props)) };
}

beforeEach(() => {
  mocks.state = {};
});
describe("shared event type form", () => {
  it("offers Evento and keeps the free field out of ordinary event forms", () => {
    const { elements } = fields();
    expect(
      elements.some((element) => element.type === "option" && element.props.value === "event"),
    ).toBe(true);
    expect(elements.some((element) => element.props.name === "customEventType")).toBe(false);
  });
  it("requires the free Other type and restores its value after a failed submission", () => {
    mocks.state = {
      revision: "failed-submit",
      error: "Controlla la data",
      values: { eventType: "other", customEventType: "Shooting fotografico" },
    };
    const { outer, elements } = fields();
    expect(outer.key).toBe("failed-submit");
    const input = elements.find((element) => element.props.name === "customEventType")!;
    expect(input.props.required).toBe(true);
    expect(input.props.maxLength).toBe(80);
    expect(input.props.defaultValue).toBe("Shooting fotografico");
    expect(elements.find((element) => element.props.name === "eventType")?.props.value).toBe(
      "other",
    );
  });
});
