import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { TeamActionState, TeamEvent, TeamTask } from "../lib/team/model";

const mocks = vi.hoisted(() => ({
  state: {} as TeamActionState,
  pending: false,
  action: vi.fn(),
  path: "root",
  cursor: 0,
  slots: new Map<string, unknown[]>(),
  effects: [] as (() => void)[],
  handlers: [] as ((previous: TeamActionState, form: FormData) => Promise<TeamActionState>)[],
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  function slot(initial: () => unknown) {
    const slots = mocks.slots.get(mocks.path) ?? [];
    mocks.slots.set(mocks.path, slots);
    const index = mocks.cursor++;
    if (!(index in slots)) slots[index] = initial();
    return { slots, index };
  }
  return {
    ...actual,
    useActionState: (
      handler: (previous: TeamActionState, form: FormData) => Promise<TeamActionState>,
    ) => {
      mocks.handlers.push(handler);
      return [mocks.state, mocks.action, mocks.pending];
    },
    useId: () => "event-test",
    useState: (value: unknown) => {
      const { slots, index } = slot(() => (typeof value === "function" ? value() : value));
      return [
        slots[index],
        (next: unknown) => {
          slots[index] = typeof next === "function" ? next(slots[index]) : next;
        },
      ];
    },
    useRef: (value: unknown) => {
      const { slots, index } = slot(() => ({ current: value }));
      return slots[index];
    },
    useEffect: (effect: () => void, dependencies: unknown[]) => {
      const { slots, index } = slot(() => null);
      const previous = slots[index] as unknown[] | null;
      if (!previous || dependencies.some((value, i) => !Object.is(previous[i], value)))
        mocks.effects.push(effect);
      slots[index] = dependencies;
    },
  };
});
vi.mock("../app/team/actions", () => ({
  createTeamEvent: vi.fn(),
  createTeamNote: vi.fn(),
  createTeamTask: vi.fn(),
  deleteTeamItem: vi.fn(),
  toggleTeamTask: vi.fn(),
  updateTeamEvent: vi.fn(),
  updateTeamTask: vi.fn(),
}));
import {
  EditEventForm,
  EditTaskForm,
  NewEventForm,
  NewTaskForm,
  NewNoteForm,
} from "./team-workspace-forms";
import { eventEditToken, taskEditToken } from "../lib/team/model";
import { updateTeamEvent, updateTeamTask } from "../app/team/actions";

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
  mocks.pending = false;
  mocks.path = "root";
  mocks.cursor = 0;
  mocks.slots.clear();
  mocks.effects = [];
  mocks.action.mockReset();
  mocks.handlers = [];
  vi.mocked(updateTeamEvent).mockReset();
  vi.mocked(updateTeamTask).mockReset();
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

type Element = ReactElement<Record<string, unknown>>;
/** Valuta solo componenti funzione e hook locali, senza server o browser. */
function renderElements(node: unknown, path = "edit"): Element[] {
  if (Array.isArray(node))
    return node.flatMap((child, index) => renderElements(child, `${path}/${index}`));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  const ownPath = `${path}:${String(element.key ?? "")}`;
  if (typeof element.type === "function") {
    const before = { path: mocks.path, cursor: mocks.cursor };
    mocks.path = ownPath;
    mocks.cursor = 0;
    const rendered = (element.type as (props: unknown) => unknown)(element.props);
    const elements = renderElements(rendered, `${ownPath}/component`);
    mocks.path = before.path;
    mocks.cursor = before.cursor;
    return elements;
  }
  return [element, ...renderElements(element.props.children, `${ownPath}/children`)];
}
function flushEffects() {
  const effects = mocks.effects.splice(0);
  effects.forEach((effect) => effect());
}
const id = (n: number) => `73000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const members = [
  { id: id(2), name: "Ada Prova", active: true },
  { id: id(3), name: "Bruno Prova", active: false },
];
const event: TeamEvent = {
  id: id(1),
  title: "Prova modifica appuntamento",
  startsAt: "2026-10-25T01:10:00Z",
  endsAt: "2026-10-25T01:40:00Z",
  eventType: "other",
  details: {
    summary: "Descrizione di prova",
    participantIds: [id(2), id(3), id(4)],
    callUrl: "https://example.test/call",
    typeLabel: "Shooting di prova",
  },
  createdBy: id(2),
};
const task: TeamTask = {
  id: id(5),
  title: "Attività sintetica",
  description: "Controllo di prova",
  status: "in_progress",
  dueAt: "2027-01-01T23:30:00Z",
  assignedTo: id(4),
  createdBy: id(2),
};
function named(elements: Element[], name: string) {
  return elements.find((element) => element.props.name === name)!;
}
function click(element: Element) {
  const preventDefault = vi.fn();
  (element.props.onClick as (event: unknown) => void)({ preventDefault });
  return preventDefault;
}
function openEditor(render: () => Element[]) {
  const elements = render();
  const summary = elements.find((element) => element.type === "summary")!;
  click(summary);
  return render();
}
function button(elements: Element[], label: string) {
  return elements.find((element) => element.type === "button" && element.props.children === label)!;
}

describe("modifica degli appuntamenti e delle attività", () => {
  it("apre un modulo precompilato con identificativo, versione originale, tipo libero e partecipanti precedenti", () => {
    const render = () => renderElements(EditEventForm({ event, members }));
    expect(render().some((element) => element.type === "form")).toBe(false);
    const elements = openEditor(render);
    expect(named(elements, "id").props).toMatchObject({ type: "hidden", value: event.id });
    expect(named(elements, "expected").props.value).toBe(eventEditToken(event));
    expect(named(elements, "title").props.defaultValue).toBe(event.title);
    expect(named(elements, "startsAt").props.value).toBe("2026-10-25T02:10");
    expect(named(elements, "startsOccurrence").props.defaultValue).toBe("later");
    expect(named(elements, "customEventType").props.defaultValue).toBe("Shooting di prova");
    expect(named(elements, "callUrl").props.defaultValue).toBe(event.details.callUrl);
    expect(named(elements, "summary").props.defaultValue).toBe(event.details.summary);
    expect(
      elements
        .filter((element) => element.props.name === "participantIds")
        .map((element) => [element.props.value, element.props.defaultChecked]),
    ).toEqual([
      [id(2), true],
      [id(3), true],
      [id(4), true],
    ]);
  });
  it("mantiene la versione aperta se un collega cambia lo stesso appuntamento", () => {
    let current = event;
    const render = () => renderElements(EditEventForm({ event: current, members }));
    openEditor(render);
    current = { ...event, title: "Titolo aggiornato dal collega" };
    expect(named(render(), "expected").props.value).toBe(eventEditToken(event));
    click(button(render(), "Annulla"));
    expect(render().some((element) => element.type === "form")).toBe(false);
    const reopened = openEditor(render);
    expect(named(reopened, "title").props.defaultValue).toBe(current.title);
    expect(named(reopened, "expected").props.value).toBe(eventEditToken(current));
  });
  it("Annulla richiude, scarta la bozza e rimette il focus su Modifica", () => {
    const render = () => renderElements(EditEventForm({ event, members }));
    let elements = openEditor(render);
    const summary = elements.find((element) => element.type === "summary")!;
    const focus = vi.fn();
    (summary.props.ref as { current: unknown }).current = { focus };
    (named(elements, "startsAt").props.onChange as (event: unknown) => void)({
      target: { value: "2026-11-02T15:00" },
    });
    expect(named(render(), "startsAt").props.value).toBe("2026-11-02T15:00");
    click(button(render(), "Annulla"));
    expect(focus).toHaveBeenCalledOnce();
    expect(render().find((element) => element.type === "details")?.props.open).toBe(false);
    elements = openEditor(render);
    expect(named(elements, "startsAt").props.value).toBe("2026-10-25T02:10");
    expect(mocks.action).not.toHaveBeenCalled();
  });
  it("disabilita campi, invio e chiusura durante il salvataggio", () => {
    const render = () => renderElements(EditEventForm({ event, members }));
    openEditor(render);
    mocks.pending = true;
    const elements = render();
    expect(elements.find((element) => element.type === "fieldset")?.props.disabled).toBe(true);
    expect(
      elements.find((element) => element.type === "button" && element.props.type === "submit")
        ?.props.disabled,
    ).toBe(true);
    expect(button(elements, "Annulla").props.disabled).toBe(true);
    const summary = elements.find((element) => element.type === "summary")!;
    expect(summary.props["aria-disabled"]).toBe(true);
    expect(click(summary)).toHaveBeenCalledOnce();
    expect(render().find((element) => element.type === "details")?.props.open).toBe(true);
  });
  it("chiude dopo il successo, annuncia l’esito e seleziona la nuova data una sola volta", async () => {
    const onSaved = vi.fn();
    const render = () => renderElements(EditEventForm({ event, members, onSaved }));
    const elements = openEditor(render);
    const focus = vi.fn();
    (
      elements.find((element) => element.type === "summary")!.props.ref as { current: unknown }
    ).current = { focus };
    const result: TeamActionState = {
      success: "Appuntamento aggiornato.",
      revision: "salvato",
      updatedItem: { id: event.id, day: "2026-11-02", kind: "event" },
    };
    vi.mocked(updateTeamEvent).mockResolvedValue(result);
    const submitted = new FormData();
    mocks.state = await mocks.handlers.at(-1)!({}, submitted);
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(result.updatedItem);
    render();
    flushEffects();
    const saved = render();
    expect(saved.find((element) => element.type === "details")?.props.open).toBe(false);
    expect(saved.find((element) => element.props.role === "status")?.props.children).toBe(
      "Appuntamento aggiornato.",
    );
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(mocks.state.updatedItem);
    expect(focus).not.toHaveBeenCalled();
    flushEffects();
    expect(onSaved).toHaveBeenCalledOnce();
  });
  it.each(["event", "task"] as const)(
    "notifica il salvataggio %s anche se la revalidazione smonta il form prima degli effetti",
    async (kind) => {
      const onSaved = vi.fn();
      const render = () =>
        renderElements(
          kind === "event"
            ? EditEventForm({ event, members, onSaved })
            : EditTaskForm({ task, members, onSaved }),
        );
      openEditor(render);
      let resolveAction!: (result: TeamActionState) => void;
      const resolved = new Promise<TeamActionState>((resolve) => {
        resolveAction = resolve;
      });
      const serverAction = kind === "event" ? updateTeamEvent : updateTeamTask;
      vi.mocked(serverAction).mockReturnValue(resolved);
      const handler = mocks.handlers.at(-1)!;
      const submitted = new FormData();
      const completion = handler({}, submitted);
      // Il vecchio giorno rimuove il form: nessun nuovo render o effetto del figlio.
      mocks.effects = [];
      mocks.slots.clear();
      const result: TeamActionState = {
        success: "Modifica salvata.",
        revision: "nuova-versione",
        updatedItem: {
          id: kind === "event" ? event.id : task.id,
          day: kind === "event" ? "2026-11-02" : null,
          kind,
        },
      };
      resolveAction(result);
      await expect(completion).resolves.toBe(result);
      expect(serverAction).toHaveBeenCalledExactlyOnceWith({}, submitted);
      expect(onSaved).toHaveBeenCalledExactlyOnceWith(result.updatedItem);
    },
  );
  it("non notifica il calendario per un errore di salvataggio", async () => {
    const onSaved = vi.fn();
    const render = () => renderElements(EditEventForm({ event, members, onSaved }));
    openEditor(render);
    const result = { error: "Controlla le date.", revision: "errore" };
    vi.mocked(updateTeamEvent).mockResolvedValue(result);
    await expect(mocks.handlers.at(-1)!({}, new FormData())).resolves.toBe(result);
    expect(onSaved).not.toHaveBeenCalled();
  });
  it("conserva orari quando si attiva e poi disattiva Giornata intera", () => {
    const render = () => renderElements(EditEventForm({ event, members }));
    let elements = openEditor(render);
    (named(elements, "allDay").props.onChange as (event: unknown) => void)({
      target: { checked: true },
    });
    elements = render();
    expect(named(elements, "startsAt").props).toMatchObject({ type: "date", value: "2026-10-25" });
    expect(named(elements, "endsAt").props.value).toBe("2026-10-25");
    expect(elements.some((element) => element.props.name === "startsOccurrence")).toBe(false);
    (named(elements, "allDay").props.onChange as (event: unknown) => void)({
      target: { checked: false },
    });
    expect(named(render(), "startsAt").props).toMatchObject({
      type: "datetime-local",
      value: "2026-10-25T02:10",
    });
    expect(named(render(), "endsAt").props.value).toBe("2026-10-25T02:40");
  });
  it("ripristina i campi inoltrati dopo un errore senza perdere giorno intero e tipo libero", () => {
    const render = () => renderElements(EditEventForm({ event, members }));
    openEditor(render);
    mocks.state = {
      revision: "errore",
      error: "Controlla le date.",
      values: {
        title: "Bozza valida",
        startsAt: "2026-11-02",
        endsAt: "2026-11-01",
        allDay: "true",
        eventType: "other",
        customEventType: "Prova tipo",
        summary: "Bozza descrizione",
        callUrl: "https://example.test/draft",
      },
      participantIds: [id(3)],
    };
    const elements = render();
    expect(elements.find((element) => element.type === "details")?.props.open).toBe(true);
    expect(named(elements, "startsAt").props).toMatchObject({ type: "date", value: "2026-11-02" });
    expect(named(elements, "endsAt").props.value).toBe("2026-11-01");
    expect(named(elements, "title").props.defaultValue).toBe("Bozza valida");
    expect(named(elements, "customEventType").props.defaultValue).toBe("Prova tipo");
    expect(named(elements, "summary").props.defaultValue).toBe("Bozza descrizione");
    expect(elements.find((element) => element.props.role === "alert")?.props.children).toBe(
      "Controlla le date.",
    );
  });
  it("precompila stato, scadenza di Roma e assegnatario non disponibile dell’attività", () => {
    const render = () => renderElements(EditTaskForm({ task, members }));
    const elements = openEditor(render);
    expect(named(elements, "expected").props.value).toBe(taskEditToken(task));
    expect(named(elements, "id").props.value).toBe(task.id);
    expect(named(elements, "status").props.defaultValue).toBe("in_progress");
    expect(named(elements, "dueDate").props.defaultValue).toBe("2027-01-02");
    expect(named(elements, "assignedTo").props.defaultValue).toBe(id(4));
    expect(
      elements.some((element) => element.type === "option" && element.props.value === id(4)),
    ).toBe(true);
    expect(named(elements, "description").props.defaultValue).toBe(task.description);
  });
  it("conserva i moduli di creazione senza id, versioni o stato di modifica", () => {
    const newTask = renderElements(NewTaskForm({ members }));
    expect(
      newTask.some((element) => ["id", "expected", "status"].includes(String(element.props.name))),
    ).toBe(false);
    const newNote = renderElements(NewNoteForm({ tasks: [task] }), "note");
    expect(named(newNote, "taskId")).toBeDefined();
    expect(newNote.some((element) => element.props.name === "expected")).toBe(false);
  });
});
