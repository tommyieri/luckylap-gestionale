import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  refresh: vi.fn(),
  states: [] as unknown[],
  stateIndex: 0,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  effects: [] as { deps?: unknown[]; cleanup?: () => void }[],
  effectIndex: 0,
  pendingEffects: [] as (() => void)[],
  transitions: [] as Promise<unknown>[],
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: unknown) => {
    const slot = mocks.stateIndex++;
    if (!(slot in mocks.states)) mocks.states[slot] = initial;
    return [
      mocks.states[slot],
      (next: unknown) => {
        mocks.states[slot] = typeof next === "function" ? next(mocks.states[slot]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const slot = mocks.refIndex++;
    return (mocks.refs[slot] ??= { current: initial });
  },
  useEffect: (effect: () => (() => void) | void, deps?: unknown[]) => {
    const slot = mocks.effectIndex++;
    const previous = mocks.effects[slot];
    if (
      !previous ||
      !deps ||
      deps.some((value, index) => !Object.is(value, previous.deps?.[index]))
    ) {
      mocks.pendingEffects.push(() => {
        previous?.cleanup?.();
        const cleanup = effect();
        mocks.effects[slot] = {
          deps,
          cleanup: typeof cleanup === "function" ? cleanup : undefined,
        };
      });
    }
  },
  useTransition: () => [
    false,
    (callback: () => unknown) => {
      mocks.transitions.push(Promise.resolve(callback()));
    },
  ],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/finance/work/actions", () => ({ runFinanceWork: mocks.run }));
vi.mock("@/lib/finance/categories", () => import("../lib/finance/categories"));
vi.mock("@/lib/finance-work/model", () => import("../lib/finance-work/model"));
vi.mock("@/lib/finance-work/pending", () => import("../lib/finance-work/pending"));
import { FinanceWorkForm } from "./finance-work-form";
import { manualCommand, workId } from "../lib/finance-work/fixtures";

type Props = Parameters<typeof FinanceWorkForm>[0];
type Element = ReactElement<Record<string, unknown>>;
const actorA = workId(10),
  actorB = workId(20);
const keyA = `luckylap.finance.work:${actorA}:record`;
let storage: Map<string, string>;
const props = (userId = actorA, extra: Partial<Props> = {}): Props => ({
  userId,
  scope: "record",
  kind: "record_finance_entry",
  build: () => manualCommand().payload,
  label: "Registra uscita",
  children: null,
  ...extra,
});
function render(value: Props) {
  mocks.stateIndex = 0;
  mocks.refIndex = 0;
  mocks.effectIndex = 0;
  return FinanceWorkForm(value) as Element;
}
function flushEffects() {
  for (const effect of mocks.pendingEffects.splice(0)) effect();
}
function mount(value: Props) {
  render(value);
  flushEffects();
  return render(value);
}
function submit(tree: Element) {
  (tree.props.onSubmit as (event: unknown) => void)({
    preventDefault: vi.fn(),
    currentTarget: {},
    nativeEvent: {},
  });
}
function delayed() {
  let complete!: (result: unknown) => void;
  mocks.run.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  return () =>
    complete({ status: "success", entryId: workId(1), replayed: false, message: "Confermata" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.states = [];
  mocks.refs = [];
  mocks.effects = [];
  mocks.pendingEffects = [];
  mocks.transitions = [];
  storage = new Map();
  vi.stubGlobal(
    "FormData",
    class {
      constructor() {
        return {} as FormData;
      }
    },
  );
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => workId(80)) });
  vi.stubGlobal("sessionStorage", {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
  });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
});

describe("ricevute Finance tardive", () => {
  it("dopo lo smontaggio conserva il tentativo e non modifica stato o contenitore", async () => {
    const onSaved = vi.fn(),
      onDirtyChange = vi.fn();
    const complete = delayed();
    const tree = mount(props(actorA, { onSaved, onDirtyChange }));
    submit(tree);
    expect(storage.has(keyA)).toBe(true);
    for (const effect of mocks.effects) effect.cleanup?.();
    const before = [...mocks.states];
    onDirtyChange.mockClear();
    complete();
    await Promise.all(mocks.transitions);
    expect(storage.has(keyA)).toBe(true);
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onDirtyChange).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.states).toEqual(before);
  });

  it("il cambio attore invalida la ricevuta vecchia già durante il render", async () => {
    const onSavedA = vi.fn(),
      onDirtyA = vi.fn(),
      onSavedB = vi.fn(),
      onDirtyB = vi.fn();
    const complete = delayed();
    submit(mount(props(actorA, { onSaved: onSavedA, onDirtyChange: onDirtyA })));
    render(props(actorB, { onSaved: onSavedB, onDirtyChange: onDirtyB }));
    // Ricevuta tra render e applicazione degli effetti del nuovo attore.
    const before = [...mocks.states];
    onDirtyA.mockClear();
    complete();
    await Promise.all(mocks.transitions);
    expect(storage.has(keyA)).toBe(true);
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(onSavedA).not.toHaveBeenCalled();
    expect(onDirtyA).not.toHaveBeenCalled();
    expect(onSavedB).not.toHaveBeenCalled();
    expect(onDirtyB).not.toHaveBeenCalled();
    expect(mocks.states).toEqual(before);
    flushEffects();
  });

  it("un rifiuto o una connessione tardivi non sovrascrivono il nuovo scope", async () => {
    let fail!: (reason: unknown) => void;
    mocks.run.mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    submit(mount(props()));
    render(props(actorA, { scope: "second-record" }));
    flushEffects();
    const before = [...mocks.states];
    fail(Error("rete sintetica"));
    await Promise.all(mocks.transitions);
    expect(storage.has(keyA)).toBe(true);
    expect(mocks.states).toEqual(before);
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
  });
});

describe("identità e ricezione della voce", () => {
  it("una ricevuta dell’istanza ancora attiva continua a liberare il recovery", async () => {
    const onSaved = vi.fn(),
      onDirtyChange = vi.fn();
    const complete = delayed();
    const value = props(actorA, { onSaved, onDirtyChange });
    submit(mount(value));
    render(value);
    flushEffects();
    complete();
    await Promise.all(mocks.transitions);
    expect(storage.has(keyA)).toBe(false);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ entryId: workId(1) }), {
      addAnother: false,
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("tornare allo stesso attore non riattiva la vecchia istanza", async () => {
    const onSaved = vi.fn();
    const complete = delayed();
    submit(mount(props(actorA, { onSaved })));
    render(props(actorB));
    flushEffects();
    render(props(actorA, { onSaved }));
    flushEffects();
    const before = [...mocks.states];
    complete();
    await Promise.all(mocks.transitions);
    expect(storage.has(keyA)).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(mocks.states).toEqual(before);
  });

  it.each(["uncertain", "rejected"])(
    "una risposta %s di uno scope precedente non viene riconosciuta",
    async (status) => {
      let complete!: (value: unknown) => void;
      mocks.run.mockReturnValueOnce(
        new Promise((resolve) => {
          complete = resolve;
        }),
      );
      submit(mount(props()));
      render(props(actorA, { scope: "other-record" }));
      flushEffects();
      const before = [...mocks.states];
      complete({ status, code: "invalid_finance_payload", message: "Risposta sintetica tardiva" });
      await Promise.all(mocks.transitions);
      expect(storage.has(keyA)).toBe(true);
      expect(mocks.states).toEqual(before);
      expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    },
  );
});
