import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { FinanceMovement } from "../../lib/finance/dashboard";
const harness = vi.hoisted(() => ({
  load: vi.fn(),
  states: [] as unknown[],
  stateIndex: 0,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  effects: [] as { deps: unknown[]; cleanup?: () => void }[],
  effectIndex: 0,
  pending: [] as (() => void)[],
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: unknown) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states)) harness.states[index] = initial;
    return [
      harness.states[index],
      (next: unknown) => {
        harness.states[index] =
          typeof next === "function"
            ? (next as (previous: unknown) => unknown)(harness.states[index])
            : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = harness.refIndex++;
    return (harness.refs[index] ??= { current: initial });
  },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = harness.effectIndex++,
      old = harness.effects[index];
    if (old && old.deps.length === deps.length && old.deps.every((value, i) => value === deps[i]))
      return;
    harness.pending.push(() => {
      old?.cleanup?.();
      const cleanup = effect();
      harness.effects[index] = { deps, cleanup: cleanup || undefined };
    });
  },
}));
vi.mock("../../app/finance/editor-actions", () => ({ loadFinanceEditor: harness.load }));
vi.mock("../finance-revision-editor", () => ({ FinanceRevisionEditor: () => null }));
vi.mock("../finance-shop-payment-editor", () => ({ FinanceShopPaymentEditor: () => null }));
import { FinanceMovementPanel } from "./finance-movement-panel";
import { FinanceRevisionEditor } from "../finance-revision-editor";
import { FinanceShopPaymentEditor } from "../finance-shop-payment-editor";
const actorId = "98000000-0000-4000-8000-000000000001";
const movement: FinanceMovement = {
  id: "manual:1",
  source: "manual",
  sourceId: "98000000-0000-4000-8000-000000000002",
  date: "2026-11-01",
  cents: -1234n,
  account: "Conto sintetico",
  targetAccount: null,
  category: "Software",
  description: "Voce sintetica",
  pending: false,
  future: false,
  transfer: false,
  allocationNote: null,
};
const props = {
  movement,
  actorId,
  names: {},
  readOnly: false,
  onClose: vi.fn(),
  onDirtyChange: vi.fn(),
};
function nodes(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const value = node as ReactElement<Record<string, unknown>>;
  return [value, ...[value.props.children].flat(Infinity).flatMap(nodes)];
}
function render(next = props) {
  harness.stateIndex = harness.refIndex = harness.effectIndex = 0;
  return FinanceMovementPanel(next);
}
function effects(dialog: unknown) {
  harness.refs[0].current = dialog;
  for (const effect of harness.pending.splice(0)) effect();
}
const dialog = { open: false, showModal: vi.fn(), close: vi.fn() };
const opener = { isConnected: true, focus: vi.fn() };
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  harness.pending = [];
  harness.load.mockResolvedValue({ kind: "unavailable", message: "Scheda non disponibile" });
  vi.stubGlobal("document", { activeElement: opener });
});
afterEach(() => vi.unstubAllGlobals());
describe("scheda contestuale dei movimenti", () => {
  it("in anteprima mostra i dati sintetici senza leggere lo storico", async () => {
    const tree = render({ ...props, readOnly: true });
    effects(dialog);
    await Promise.resolve();
    expect(harness.load).not.toHaveBeenCalled();
    expect(nodes(tree).filter((node) => node.type === "dialog")).toHaveLength(1);
    expect(JSON.stringify(tree)).toContain("Voce sintetica");
    expect(nodes(tree).some((node) => node.type === FinanceRevisionEditor)).toBe(false);
  });
  it("Escape e chiusura chiedono al genitore senza chiudere prima il dialog", () => {
    const tree = render(),
      modal = nodes(tree).find((node) => node.type === "dialog")!;
    effects(dialog);
    const preventDefault = vi.fn();
    (modal.props.onCancel as (event: unknown) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(dialog.close).not.toHaveBeenCalled();
    const close = nodes(tree).find(
      (node) => node.type === "button" && node.props["aria-label"] === "Chiudi scheda movimento",
    )!;
    (close.props.onClick as () => void)();
    expect(props.onClose).toHaveBeenCalledTimes(2);
    expect(dialog.close).not.toHaveBeenCalled();
  });
  it("restituisce il focus alla riga solo quando il pannello viene smontato", () => {
    render();
    effects(dialog);
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    expect(opener.focus).not.toHaveBeenCalled();
    for (const effect of harness.effects) effect.cleanup?.();
    expect(dialog.close).toHaveBeenCalledTimes(1);
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });
  it("non mostra risposte tardive dopo cambio movimento o account", async () => {
    const first = deferred(),
      second = deferred();
    harness.load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render();
    effects(dialog);
    const next = {
      ...props,
      actorId: movement.sourceId,
      movement: { ...movement, sourceId: actorId, id: "manual:2" },
    };
    render(next);
    effects(dialog);
    second.resolve({
      kind: "revision",
      history: { marker: "secondo" },
      names: { member: "Autorizzato" },
    });
    await Promise.resolve();
    first.resolve({ kind: "revision", history: { marker: "primo" }, names: {} });
    await Promise.resolve();
    const tree = render(next),
      editor = nodes(tree).find((node) => node.type === FinanceRevisionEditor)!;
    expect(editor.props.history).toEqual({ marker: "secondo" });
    expect(editor.props.actorId).toBe(next.actorId);
    expect(editor.props.names).toEqual({ member: "Autorizzato" });
  });
  it("nasconde subito l’editor precedente prima che parta la lettura nuova", async () => {
    harness.load.mockResolvedValue({ kind: "revision", history: {}, names: {} });
    render();
    effects(dialog);
    await Promise.resolve();
    expect(nodes(render()).some((node) => node.type === FinanceRevisionEditor)).toBe(true);
    const changed = render({ ...props, movement: { ...movement, sourceId: actorId } });
    expect(nodes(changed).some((node) => node.type === FinanceRevisionEditor)).toBe(false);
  });
  it("incorpora il pagamento P3 e rilegge la scheda dopo il successo senza chiudere", async () => {
    harness.load.mockResolvedValue({ kind: "shop_payment", history: {}, names: {} });
    render();
    effects(dialog);
    await Promise.resolve();
    const tree = render(),
      editor = nodes(tree).find((node) => node.type === FinanceShopPaymentEditor)!;
    expect(editor.props.embedded).toBe(true);
    (editor.props.onDirtyChange as (dirty: boolean) => void)(true);
    expect(props.onDirtyChange).toHaveBeenCalledWith(true);
    (editor.props.onSaved as () => void)();
    const loading = render();
    effects(dialog);
    expect(nodes(loading).some((node) => node.type === FinanceShopPaymentEditor)).toBe(false);
    expect(harness.load).toHaveBeenCalledTimes(2);
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

it("ignora callback tardive di un editor sostituito o smontato", async () => {
  harness.load.mockResolvedValue({ kind: "revision", history: {}, names: {} });
  render();
  effects(dialog);
  await Promise.resolve();
  const oldEditor = nodes(render()).find((node) => node.type === FinanceRevisionEditor)!;
  render({ ...props, movement: { ...movement, sourceId: actorId } });
  effects(dialog);
  props.onDirtyChange.mockClear();
  (oldEditor.props.onDirtyChange as (dirty: boolean) => void)(false);
  (oldEditor.props.onSaved as () => void)();
  expect(props.onDirtyChange).not.toHaveBeenCalled();
  expect(harness.states[1]).toBe(0);
  await Promise.resolve();
  const current = nodes(render({ ...props, movement: { ...movement, sourceId: actorId } })).find(
    (node) => node.type === FinanceRevisionEditor,
  )!;
  for (const effect of harness.effects) effect.cleanup?.();
  (current.props.onDirtyChange as (dirty: boolean) => void)(false);
  (current.props.onSaved as () => void)();
  expect(props.onDirtyChange).not.toHaveBeenCalled();
  expect(harness.states[1]).toBe(0);
});
