import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

// Hook finti per posizione, persistenti tra un «render» e l'altro, come React.
const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  refresh: vi.fn(),
  states: [] as unknown[],
  setters: [] as ((value: unknown) => void)[],
  refs: [] as { current: unknown }[],
  stateIndex: 0,
  refIndex: 0,
  transitions: [] as Promise<unknown>[],
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: unknown) => {
    const index = mocks.stateIndex++;
    mocks.setters[index] ??= vi.fn((next: unknown) => {
      mocks.states[index] = next;
    });
    return [index in mocks.states ? mocks.states[index] : initial, mocks.setters[index]];
  },
  useRef: (initial: unknown) => (mocks.refs[mocks.refIndex++] ??= { current: initial }),
  useTransition: () => [
    false,
    (fn: () => unknown) => {
      mocks.transitions.push(Promise.resolve(fn()));
    },
  ],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../../app/(workspace)/partner/actions", () => ({ recordPartnerActivity: mocks.record }));
import { TODAY_REPLY_DONE, TodayReplyButton } from "./today-reply-button";

const userId = "10000000-0000-4000-8000-000000000001",
  partnerId = "20000000-0000-4000-8000-000000000001",
  operationId = "30000000-0000-4000-8000-000000000001";
const descendants = (node: unknown): ReactElement<Record<string, unknown>>[] => {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...[element.props.children].flat(Infinity).flatMap(descendants)];
};
const text = (node: unknown): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(text).join("")
      : node && typeof node === "object" && "props" in node
        ? text((node as ReactElement<Record<string, unknown>>).props.children)
        : "";
const render = () => {
  mocks.stateIndex = 0;
  mocks.refIndex = 0;
  return TodayReplyButton({ partnerId, partnerLabel: "CO 42", userId });
};
const button = (tree: unknown) => descendants(tree).find((node) => node.type === "button")!;
const click = async (tree: unknown) => {
  (button(tree).props.onClick as () => void)();
  await Promise.all(mocks.transitions);
};
let store: Map<string, string>;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, { states: [], setters: [], refs: [], transitions: [] });
  store = new Map();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  });
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => operationId) });
});
afterEach(() => vi.unstubAllGlobals());

describe("«Ha risposto» in Oggi", () => {
  it("registra la risposta con il comando di Partner e chiude il sollecito", async () => {
    mocks.record.mockImplementation(async () => {
      expect(store.size).toBe(1);
      return { status: "success", message: "Registrato. Stato: Ha risposto." };
    });
    const tree = render();
    expect(text(button(tree))).toBe("Ha risposto · CO 42");
    await click(tree);
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith({
      kind: "record_partner_activity",
      operationId,
      payload: { schema_version: 1, partner_id: partnerId, kind: "risposta" },
      retry: false,
    });
    expect(store.size).toBe(0);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    const done = render();
    expect(text(done)).toBe(TODAY_REPLY_DONE);
    expect((done as ReactElement<Record<string, unknown>>).props.role).toBe("status");
  });

  it("esito incerto: «Verifica lo stesso invio» ripete lo stesso operation_id", async () => {
    mocks.record.mockResolvedValueOnce({ status: "uncertain", message: "Da verificare" });
    await click(render());
    expect(store.size).toBe(1);
    const [key, saved] = [...store.entries()][0];
    expect(key).toBe(
      `luckylap.partner.pending:${userId}:oggi-risposta-${partnerId}:${operationId}`,
    );
    expect(JSON.parse(saved)).toMatchObject({ operationId, kind: "record_partner_activity" });
    const uncertain = render();
    expect(text(uncertain)).toContain("Risposta non confermata.");
    expect(text(button(uncertain))).toBe("Verifica lo stesso invio");
    mocks.record.mockResolvedValueOnce({ status: "success", message: "Registrato." });
    await click(uncertain);
    expect(mocks.record).toHaveBeenLastCalledWith({
      kind: "record_partner_activity",
      operationId,
      payload: { schema_version: 1, partner_id: partnerId, kind: "risposta" },
      retry: true,
    });
    expect(mocks.record).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(0);
  });

  it("un rifiuto mostra il messaggio e lascia riprovare", async () => {
    mocks.record.mockResolvedValueOnce({
      status: "rejected",
      code: "partner_access_required",
      message: "I permessi del tuo account sono cambiati. Accedi di nuovo.",
      refresh: false,
    });
    await click(render());
    const tree = render();
    expect(text(tree)).toContain("I permessi del tuo account sono cambiati.");
    expect(button(tree).props.disabled).toBe(false);
    expect(store.size).toBe(0);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("due tocchi insieme inviano una sola risposta", async () => {
    mocks.record.mockResolvedValue({ status: "success", message: "Registrato." });
    const tree = render();
    (button(tree).props.onClick as () => void)();
    (button(tree).props.onClick as () => void)();
    await Promise.all(mocks.transitions);
    expect(mocks.record).toHaveBeenCalledOnce();
  });
});
