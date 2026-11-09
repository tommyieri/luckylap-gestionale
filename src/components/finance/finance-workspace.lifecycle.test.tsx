import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  memos: [] as { value: unknown; deps?: unknown[] }[],
  effects: [] as { deps?: unknown[]; cleanup?: () => void }[],
  queuedEffects: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  memoIndex: 0,
  effectIndex: 0,
  changed: false,
}));

vi.mock("react", async () => {
  const memo = (build: () => unknown, deps?: unknown[]) => {
    const slot = hooks.memoIndex++;
    const previous = hooks.memos[slot];
    if (
      !previous ||
      !deps ||
      deps.some((value, index) => !Object.is(value, previous.deps?.[index]))
    )
      hooks.memos[slot] = { value: build(), deps };
    return hooks.memos[slot].value;
  };
  return {
    ...(await vi.importActual<typeof import("react")>("react")),
    useState: (initial: unknown) => {
      const slot = hooks.stateIndex++;
      if (!(slot in hooks.states))
        hooks.states[slot] = typeof initial === "function" ? initial() : initial;
      return [
        hooks.states[slot],
        (next: unknown) => {
          const value = typeof next === "function" ? next(hooks.states[slot]) : next;
          if (!Object.is(value, hooks.states[slot])) hooks.changed = true;
          hooks.states[slot] = value;
        },
      ];
    },
    useRef: (initial: unknown) => (hooks.refs[hooks.refIndex++] ??= { current: initial }),
    useMemo: memo,
    useCallback: (callback: unknown, deps?: unknown[]) => memo(() => callback, deps),
    useEffect: (effect: () => (() => void) | void, deps?: unknown[]) => {
      const slot = hooks.effectIndex++;
      const previous = hooks.effects[slot];
      if (
        !previous ||
        !deps ||
        deps.some((value, index) => !Object.is(value, previous.deps?.[index]))
      )
        hooks.queuedEffects.push(() => {
          previous?.cleanup?.();
          const cleanup = effect();
          hooks.effects[slot] = {
            deps,
            cleanup: typeof cleanup === "function" ? cleanup : undefined,
          };
        });
    },
  };
});
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("./finance-movement-list", () => ({ FinanceMovementList: () => null }));
vi.mock("./finance-overview", () => ({ FinanceOverview: () => null }));
vi.mock("./finance-sources", () => ({ FinanceSources: () => null }));
vi.mock("./finance-movement-panel", () => ({ FinanceMovementPanel: () => null }));
vi.mock("./finance-new-movement", () => ({ FinanceNewMovement: () => null }));
vi.mock("../finance-work-form", () => ({ FinanceWorkRecovery: () => null }));

import { FinanceWorkspace, type FinanceWorkspaceProps } from "./finance-workspace";
import { FinanceMovementList } from "./finance-movement-list";
import { FinanceOverview } from "./finance-overview";
import { FinanceMovementPanel } from "./finance-movement-panel";
import { FinanceNewMovement, type FinanceNewMovementSaved } from "./finance-new-movement";
import type { FinanceMovement } from "../../lib/finance/dashboard";
import type { FinanceView } from "../../lib/finance/workspace";
import { financeViewHref, parseFinanceView } from "../../lib/finance/workspace";

type Element = ReactElement<Record<string, unknown>>;
const reportDate = "2026-11-09";
const entry = (suffix: string, extra: Partial<FinanceMovement> = {}): FinanceMovement => ({
  id: `manual:97000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
  source: "manual",
  sourceId: `97000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
  date: "2026-11-03",
  cents: -2490n,
  account: "Conto sintetico",
  targetAccount: null,
  category: "Produzione",
  description: "Campioni sintetici",
  pending: false,
  future: false,
  transfer: false,
  allocationNote: null,
  ...extra,
});
const expense = entry("1");
const income = entry("2", { cents: 5000n, category: "Vendite", description: "Incasso sintetico" });
const unallocated = entry("3", { cents: 9000n, account: null, category: "Vendite" });
const rows = [expense, income, unallocated];
const filteredParams = {
  vista: "movements",
  periodo: "custom",
  dal: "2026-10-01",
  al: reportDate,
  conto: "Conto sintetico",
  q: "Campioni",
  tipo: "expense",
  categoria: "Produzione",
  stato: "posted",
  fonte: "manual",
};
const props = (
  initialParams: FinanceWorkspaceProps["initialParams"] = {},
): FinanceWorkspaceProps => ({
  dashboard: {
    movements: rows,
    accounts: [{ name: "Conto sintetico", posted: 2510n, pending: 0n, future: 0n, count: 2 }],
    years: [2026],
    reportDate,
  },
  deletedMovements: [],
  snapshot: { batches: [], transactions: [] },
  reportDate,
  names: {},
  actorId: "97000000-0000-4000-8000-000000000099",
  initialParams,
});

let location: URL;
let browserEvents: Map<string, (event?: unknown) => void>;
let historyEntries: string[];
let historyPosition: number;
const confirm = vi.fn();
const pushState = vi.fn();
const replaceState = vi.fn();

function render(value: FinanceWorkspaceProps) {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.memoIndex = 0;
  hooks.effectIndex = 0;
  return FinanceWorkspace(value) as Element;
}
function settle(value: FinanceWorkspaceProps): Element {
  for (let pass = 0; pass < 10; pass++) {
    hooks.changed = false;
    const tree = render(value);
    for (const effect of hooks.queuedEffects.splice(0)) effect();
    if (!hooks.changed) return tree;
  }
  throw new Error("Il workspace non raggiunge uno stato stabile.");
}
function descendants(node: unknown): Element[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...[element.props.children].flat(Infinity).flatMap(descendants)];
}
function child(tree: Element, type: unknown): Element {
  const result = descendants(tree).find((node) => node.type === type);
  expect(result).toBeDefined();
  return result!;
}
function hasChild(tree: Element, type: unknown) {
  return descendants(tree).some((node) => node.type === type);
}
function open(tree: Element, row: FinanceMovement) {
  (child(tree, FinanceMovementList).props.open as (row: FinanceMovement) => void)(row);
}
function close(tree: Element) {
  (child(tree, FinanceMovementPanel).props.onClose as () => void)();
}
function dirty(tree: Element) {
  (child(tree, FinanceMovementPanel).props.onDirtyChange as (value: boolean) => void)(true);
}
function params() {
  return Object.fromEntries(location.searchParams);
}
function start(value: FinanceWorkspaceProps) {
  location = new URL(
    financeViewHref(parseFinanceView(value.initialParams ?? {}, reportDate)),
    location,
  );
  historyEntries = [location.href];
  historyPosition = 0;
  return settle(value);
}
function back() {
  if (historyPosition === 0) throw new Error("Nessuna voce precedente nella cronologia di prova.");
  location = new URL(historyEntries[--historyPosition]);
  browserEvents.get("popstate")?.();
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.states = [];
  hooks.refs = [];
  hooks.memos = [];
  hooks.effects = [];
  hooks.queuedEffects = [];
  browserEvents = new Map();
  location = new URL("https://synthetic.invalid/finance");
  historyEntries = [location.href];
  historyPosition = 0;
  confirm.mockReturnValue(true);
  pushState.mockImplementation((_state: unknown, _unused: string, url: string) => {
    location = new URL(url, location);
    historyEntries.splice(++historyPosition);
    historyEntries.push(location.href);
  });
  replaceState.mockImplementation((_state: unknown, _unused: string, url: string) => {
    location = new URL(url, location);
    historyEntries[historyPosition] = location.href;
  });
  vi.stubGlobal("window", {
    get location() {
      return location;
    },
    history: { pushState, replaceState },
    confirm,
    addEventListener: (type: string, listener: (event?: unknown) => void) =>
      browserEvents.set(type, listener),
    removeEventListener: (type: string) => browserEvents.delete(type),
  });
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => {
  for (const effect of hooks.effects) effect.cleanup?.();
  vi.unstubAllGlobals();
});

describe("contesto e cronologia del workspace Finance", () => {
  it("seleziona e chiude la scheda mantenendo periodo, ricerca e filtri nell’URL", () => {
    const value = props(filteredParams);
    let tree = start(value);
    expect(child(tree, FinanceMovementList).props.rows).toEqual([expense]);
    const original = params();
    open(tree, expense);
    tree = settle(value);
    expect(child(tree, FinanceMovementPanel).props.movement).toBe(expense);
    expect(params()).toEqual({ ...original, movimento: expense.id });
    close(tree);
    tree = settle(value);
    expect(hasChild(tree, FinanceMovementPanel)).toBe(false);
    expect(params()).toEqual(original);
    expect(child(tree, FinanceMovementList).props.rows).toEqual([expense]);
    expect(pushState).toHaveBeenCalledTimes(2);
  });

  it("il drill del grafico elimina i filtri incompatibili e riproduce solo i conti attribuiti", () => {
    const value = props({
      ...filteredParams,
      vista: "overview",
      conto: "",
      stato: "edited",
      lotto: "lotto-sintetico",
      movimento: expense.id,
    });
    const tree = start(value);
    (child(tree, FinanceOverview).props.onDrill as (patch: Partial<FinanceView>) => void)({
      period: "custom",
      from: "2026-11-01",
      to: "2026-11-07",
      direction: "income",
    });
    const drilled = settle(value);
    expect(params()).toEqual({
      vista: "movements",
      periodo: "custom",
      dal: "2026-11-01",
      al: "2026-11-07",
      conto: "__allocated",
      tipo: "income",
      stato: "posted",
    });
    expect(child(drilled, FinanceMovementList).props.rows).toEqual([income]);
    expect(hasChild(drilled, FinanceMovementPanel)).toBe(false);
  });

  it("indietro chiude la scheda e ripristina i filtri precedenti dall’URL", () => {
    const value = props(filteredParams);
    let tree = start(value);
    (child(tree, FinanceMovementList).props.change as (patch: Partial<FinanceView>) => void)({
      query: "Incasso",
      direction: "income",
      category: "Vendite",
    });
    tree = settle(value);
    expect(child(tree, FinanceMovementList).props.rows).toEqual([income]);
    open(tree, income);
    tree = settle(value);
    expect(child(tree, FinanceMovementPanel).props.movement).toBe(income);
    back();
    tree = settle(value);
    expect(hasChild(tree, FinanceMovementPanel)).toBe(false);
    expect(child(tree, FinanceMovementList).props.rows).toEqual([income]);
    back();
    tree = settle(value);
    expect(params()).toMatchObject({ q: "Campioni", tipo: "expense", categoria: "Produzione" });
    expect(child(tree, FinanceMovementList).props.rows).toEqual([expense]);
    expect(pushState).toHaveBeenCalledTimes(2);
  });

  it("rifiutare la conferma di chiusura conserva la scheda sporca e l’URL", () => {
    const value = props(filteredParams);
    let tree = start(value);
    open(tree, expense);
    tree = settle(value);
    dirty(tree);
    confirm.mockReturnValue(false);
    const before = location.href;
    close(tree);
    tree = settle(value);
    expect(confirm).toHaveBeenCalledWith("Hai modifiche non salvate. Vuoi uscire senza salvarle?");
    expect(location.href).toBe(before);
    expect(child(tree, FinanceMovementPanel).props.movement).toBe(expense);
    expect(pushState).toHaveBeenCalledTimes(1);
    const event = { preventDefault: vi.fn(), returnValue: undefined as string | undefined };
    browserEvents.get("beforeunload")?.(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe("");
  });

  it("rifiutare indietro ripristina l’URL della scheda senza perdere le modifiche", () => {
    const value = props(filteredParams);
    let tree = start(value);
    open(tree, expense);
    tree = settle(value);
    dirty(tree);
    confirm.mockReturnValue(false);
    const before = location.href;
    back();
    tree = settle(value);
    expect(location.href).toBe(before);
    expect(child(tree, FinanceMovementPanel).props.movement).toBe(expense);
    close(tree);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(location.href).toBe(before);
  });
});

describe("ricevuta e aggiornamento dei dati Finance", () => {
  it("attende che il refresh contenga la riga salvata prima di aprirne la scheda", () => {
    const value = props({ ...filteredParams, nuovo: "expense" });
    let tree = start(value);
    const saved = entry("4", { description: "Nuovo movimento sintetico" });
    (child(tree, FinanceNewMovement).props.onSaved as (result: FinanceNewMovementSaved) => void)({
      entryId: saved.sourceId,
      movementId: saved.id as `manual:${string}`,
      addAnother: false,
    });
    tree = settle(value);
    expect(hasChild(tree, FinanceNewMovement)).toBe(false);
    expect(hasChild(tree, FinanceMovementPanel)).toBe(false);
    expect(params()).toMatchObject({ vista: "movements", periodo: "all", stato: "posted" });
    expect(params()).not.toHaveProperty("movimento");
    expect(params()).not.toHaveProperty("q");
    const refreshed = { ...value, dashboard: { ...value.dashboard, movements: [saved, ...rows] } };
    tree = settle(refreshed);
    expect(child(tree, FinanceMovementPanel).props.movement).toBe(saved);
    expect(params().movimento).toBe(saved.id);
    expect(child(tree, FinanceMovementList).props.rows).toContain(saved);
  });

  it("la scelta aggiungi un’altra mantiene il modulo aperto anche quando arriva la riga salvata", () => {
    const value = props({ nuovo: "income" });
    let tree = start(value);
    const saved = entry("5", { cents: 1500n });
    (child(tree, FinanceNewMovement).props.onSaved as (result: FinanceNewMovementSaved) => void)({
      entryId: saved.sourceId,
      movementId: saved.id as `manual:${string}`,
      addAnother: true,
    });
    tree = settle({ ...value, dashboard: { ...value.dashboard, movements: [saved, ...rows] } });
    expect(child(tree, FinanceNewMovement).props.direction).toBe("income");
    expect(hasChild(tree, FinanceMovementPanel)).toBe(false);
    expect(params().nuovo).toBe("income");
    expect(params()).not.toHaveProperty("movimento");
  });

  it("il refresh di A non chiude la nuova bozza B aperta e modificata nel frattempo", () => {
    const value = props({ nuovo: "expense" });
    let tree = start(value);
    const saved = entry("6", { description: "Movimento A sintetico" });
    (child(tree, FinanceNewMovement).props.onSaved as (result: FinanceNewMovementSaved) => void)({
      entryId: saved.sourceId,
      movementId: saved.id as `manual:${string}`,
      addAnother: false,
    });
    tree = settle(value);
    const newButton = descendants(tree).find(
      (node) => node.type === "button" && [node.props.children].flat().includes("Nuovo movimento"),
    )!;
    (newButton.props.onClick as () => void)();
    tree = settle(value);
    (child(tree, FinanceNewMovement).props.onDirtyChange as (value: boolean) => void)(true);
    tree = settle({ ...value, dashboard: { ...value.dashboard, movements: [saved, ...rows] } });
    expect(hasChild(tree, FinanceNewMovement)).toBe(true);
    expect(hasChild(tree, FinanceMovementPanel)).toBe(false);
    expect(params().nuovo).toBe("expense");
    expect(params()).not.toHaveProperty("movimento");
    confirm.mockReturnValue(false);
    const closeButton = descendants(tree).find(
      (node) => node.props["aria-label"] === "Chiudi nuovo movimento",
    )!;
    (closeButton.props.onClick as () => void)();
    expect(confirm).toHaveBeenCalledOnce();
    expect(hasChild(settle(value), FinanceNewMovement)).toBe(true);
    expect(params().nuovo).toBe("expense");
  });
});
