import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { FinanceRevisionHistory } from "../lib/finance-revisions/model";
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  states: [] as unknown[],
  index: 0,
  transitions: [] as Promise<unknown>[],
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: () => {},
  useState: (value: unknown) => [
    mocks.index in mocks.states ? mocks.states[mocks.index++] : (mocks.index++, value),
    vi.fn(),
  ],
  useRef: (value: unknown) => ({ current: value ?? { value: "Correzione sintetica" } }),
  useTransition: () => [
    false,
    (fn: () => unknown) => {
      mocks.transitions.push(Promise.resolve(fn()));
    },
  ],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../app/finance/movimento/actions", () => ({ reviseMovement: mocks.execute }));
import { FinanceRevisionEditor } from "./finance-revision-editor";
import { PendingAttempt } from "./pending-attempt";
const actorId = "98000000-0000-4000-8000-000000000001",
  sourceId = "98000000-0000-4000-8000-000000000002",
  operationId = "98000000-0000-4000-8000-000000000003";
const history: FinanceRevisionHistory = {
  original: {
    sourceKind: "manual",
    sourceId,
    orderId: null,
    deleted: false,
    values: {
      date: "2026-11-01",
      direction: "expense",
      amountCents: 1234,
      account: "Conto sintetico",
      targetAccount: null,
      category: "Software",
      description: "Voce sintetica",
      pending: false,
    },
  },
  revisions: [],
};
function nodes(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...[element.props.children].flat(Infinity).flatMap(nodes)];
}
let store: Map<string, string>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.states = [];
  mocks.states[2] = true;
  mocks.index = 0;
  mocks.transitions = [];
  store = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => operationId) });
  mocks.execute.mockResolvedValue({ status: "uncertain", message: "Da verificare" });
});
afterEach(() => vi.unstubAllGlobals());
function edit(
  props: {
    onSaved?: () => void;
    onDirtyChange?: (value: boolean) => void;
    readOnly?: boolean;
  } = {},
) {
  const tree = FinanceRevisionEditor({ history, actorId, names: {}, embedded: true, ...props });
  const form = nodes(tree).find((node) => node.type === "form")!;
  const data = new FormData();
  for (const [key, value] of Object.entries({
    date: "2026-11-02",
    direction: "expense",
    amount: "14,25",
    account: "Conto sintetico",
    category: "Software",
    description: "Voce corretta",
  }))
    data.set(key, value);
  return { tree, form, send: () => (form.props.action as (value: FormData) => void)(data) };
}
describe("editor incorporato: dirty e ricevute", () => {
  it("propaga dirty subito dal modulo senza effettuare invii", () => {
    const onDirtyChange = vi.fn(),
      { form } = edit({ onDirtyChange });
    (form.props.onChange as () => void)();
    expect(onDirtyChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("conserva un esito incerto e non chiama onSaved", async () => {
    const onSaved = vi.fn(),
      onDirtyChange = vi.fn();
    edit({ onSaved, onDirtyChange }).send();
    await Promise.all(mocks.transitions);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(store.size).toBe(1);
    expect(mocks.execute).toHaveBeenCalledWith(
      actorId,
      expect.objectContaining({
        operationId,
        payload: expect.objectContaining({
          expected_version: 0,
          source_id: sourceId,
          values: expect.objectContaining({ amount_cents: 1425 }),
        }),
      }),
    );
  });
  it("chiama onSaved solo dopo avere riconosciuto la ricevuta e rimosso il tentativo", async () => {
    const onSaved = vi.fn(),
      onDirtyChange = vi.fn();
    mocks.execute.mockResolvedValue({
      status: "success",
      message: "Confermato",
      receipt: { operationId, sourceKind: "manual", sourceId, version: 1 },
    });
    edit({ onSaved, onDirtyChange }).send();
    expect(onSaved).not.toHaveBeenCalled();
    await Promise.all(mocks.transitions);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(store.size).toBe(0);
  });
  it("non dichiara salvato un successo con ricevuta diversa", async () => {
    const onSaved = vi.fn();
    mocks.execute.mockResolvedValue({
      status: "success",
      message: "Confermato",
      receipt: { operationId: sourceId, sourceKind: "manual", sourceId, version: 1 },
    });
    edit({ onSaved }).send();
    await Promise.all(mocks.transitions);
    expect(onSaved).not.toHaveBeenCalled();
    expect(store.size).toBe(1);
  });
  it("blocca l’invio in sola lettura anche se richiamato direttamente", async () => {
    edit({ readOnly: true }).send();
    await Promise.all(mocks.transitions);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });
  it("un retry ripete lo stesso payload senza nuovo UUID", async () => {
    const command = {
      operationId,
      payload: {
        schema_version: 1,
        source_kind: "manual",
        source_id: sourceId,
        expected_version: 0,
        reason: "Correzione sintetica",
        action: "delete",
      },
    };
    mocks.states[0] = command;
    // Stato: busy non è useState, attempt è il primo useState dell'editor.
    const tree = edit().tree;
    const pending = nodes(tree).find((node) => node.type === PendingAttempt)!;
    expect(pending).toBeDefined();
    (pending.props.onRetry as () => void)();
    await Promise.all(mocks.transitions);
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(actorId, { ...command, retry: true });
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });
});
