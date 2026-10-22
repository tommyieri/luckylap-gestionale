import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { ShopPaymentFinanceHistory } from "../lib/finance-revisions/shop-payment-model";
import type { ShopCommand } from "../lib/consignment/shop-model";
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
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../app/finance/incasso/actions", () => ({ reviseShopPayment: mocks.execute }));
import { FinanceShopPaymentEditor } from "./finance-shop-payment-editor";
import { PendingAttempt } from "./pending-attempt";
import { shopPendingKey } from "../lib/consignment/shop-model";
const id = "91000000-0000-4000-8000-000000000001";
const original = {
  version: 1,
  amountCents: 1000,
  paidAt: "2026-06-10T10:00:00Z",
  method: "cash" as const,
  accountLabel: "Cash",
  reference: "RIF-SINTETICO",
  voided: false,
  direction: "income" as const,
  category: "Vendite",
  description: "Prima versione",
  pending: false,
  reason: null,
  createdBy: id,
  createdAt: "2026-06-10T10:00:00Z",
};
const current = { ...original, version: 2, amountCents: 1200, description: "Versione corrente" };
const history: ShopPaymentFinanceHistory = {
  paymentId: id,
  reportId: id,
  locationId: id,
  version: 2,
  current,
  revisions: [original, current],
};
function nodes(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...[element.props.children].flat(Infinity).flatMap(nodes)];
}
function text(node: unknown): string {
  return typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(text).join(" ")
      : node && typeof node === "object" && "props" in node
        ? text((node as ReactElement<Record<string, unknown>>).props.children)
        : "";
}
let store: Map<string, string>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.index = 0;
  mocks.states = [];
  mocks.states[1] = true;
  mocks.transitions = [];
  store = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => id) });
  mocks.execute.mockResolvedValue({ status: "uncertain", message: "Da verificare" });
});
afterEach(() => vi.unstubAllGlobals());
describe("editor del singolo pagamento P3", () => {
  it("ripristina la versione scelta con un solo update P3 e CAS corrente, conservando metodo e riferimento", async () => {
    const tree = FinanceShopPaymentEditor({
      history,
      actorId: id,
      names: { [id]: "Membro sintetico" },
    });
    const button = nodes(tree).find(
      (node) => node.type === "button" && text(node) === "Ripristina versione  1",
    )!;
    expect(button).toBeDefined();
    (button.props.onClick as () => void)();
    (button.props.onClick as () => void)();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][1]).toMatchObject({
      kind: "update_consignment_payment",
      operationId: id,
      payload: {
        payment_id: id,
        expected_version: 2,
        amount_cents: 1000,
        method: "cash",
        reference: "RIF-SINTETICO",
        voided: false,
        finance: { direction: "income", description: "Prima versione" },
      },
    });
    expect(store.size).toBe(1);
    await Promise.all(mocks.transitions);
  });
  it("verifica lo stesso tentativo congelato senza rigenerare UUID o versione", async () => {
    const frozen: ShopCommand = {
      operationId: id,
      kind: "update_consignment_payment",
      payload: {
        schema_version: 1,
        payment_id: id,
        expected_version: 1,
        amount_cents: 1000,
        paid_at: original.paidAt,
        method: "cash",
        account_label: "Cash",
        reference: "RIF-SINTETICO",
        voided: false,
        reason: "Correzione sintetica",
      },
    };
    mocks.states[0] = { kind: "shop", command: frozen, blocked: false };
    store.set(shopPendingKey(id), JSON.stringify(frozen));
    const tree = FinanceShopPaymentEditor({ history, actorId: id, names: {} }),
      attempt = nodes(tree).find((node) => node.type === PendingAttempt)!;
    (attempt.props.onRetry as () => void)();
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(id, { ...frozen, retry: true });
    expect(crypto.randomUUID).not.toHaveBeenCalled();
    await Promise.all(mocks.transitions);
  });
  it("salva tipo, conto e metadati nello stesso update del resoconto", async () => {
    const values = new Map<string, string>([
      ["date", "2026-06-11"],
      ["direction", "expense"],
      ["amount", "15,25"],
      ["account", "Revolut Business"],
      ["category", "Rettifica"],
      ["description", "Correzione sintetica completa"],
      ["pending", "on"],
    ]);
    vi.stubGlobal(
      "FormData",
      class {
        get(key: string) {
          return values.get(key) ?? null;
        }
      },
    );
    const tree = FinanceShopPaymentEditor({ history, actorId: id, names: {} });
    const form = nodes(tree).find((node) => node.type === "form")!;
    (form.props.onSubmit as (event: unknown) => void)({
      preventDefault: vi.fn(),
      currentTarget: {},
    });
    expect(mocks.execute.mock.calls[0][1]).toMatchObject({
      kind: "update_consignment_payment",
      payload: {
        payment_id: id,
        expected_version: 2,
        amount_cents: 1525,
        account_label: "Revolut Business",
        method: "cash",
        reference: "RIF-SINTETICO",
        finance: {
          direction: "expense",
          category: "Rettifica",
          description: "Correzione sintetica completa",
          pending: true,
        },
      },
    });
    await Promise.all(mocks.transitions);
  });
  it("l’eliminazione usa il CAS P3 e non crea una rettifica parallela", async () => {
    mocks.states[3] = true;
    const tree = FinanceShopPaymentEditor({ history, actorId: id, names: {} });
    const button = nodes(tree).find(
      (node) => node.type === "button" && text(node) === "Conferma eliminazione",
    )!;
    (button.props.onClick as () => void)();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][1]).toMatchObject({
      kind: "update_consignment_payment",
      payload: { payment_id: id, expected_version: 2, amount_cents: 1200, voided: true },
    });
    await Promise.all(mocks.transitions);
  });
  it("permette di liberare un conflitto bloccato senza cancellare dati sul server", () => {
    const frozen: ShopCommand = {
      operationId: id,
      kind: "update_consignment_payment",
      payload: {
        schema_version: 1,
        payment_id: id,
        expected_version: 1,
        amount_cents: 1000,
        paid_at: original.paidAt,
        method: "cash",
        account_label: "Cash",
        reference: null,
        voided: false,
        reason: "Correzione sintetica",
      },
    };
    mocks.states[0] = { kind: "shop", command: frozen, blocked: true };
    store.set(shopPendingKey(id), JSON.stringify(frozen));
    const tree = FinanceShopPaymentEditor({ history, actorId: id, names: {} }),
      attempt = nodes(tree).find((node) => node.type === PendingAttempt)!;
    expect(attempt.props.blocked).toBe(true);
    (attempt.props.onDiscard as () => void)();
    expect(store.has(shopPendingKey(id))).toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
