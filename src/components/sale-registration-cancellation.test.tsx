import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type {
  SaleCancellationInput,
  SaleCancellationPreview,
} from "../lib/sales-cancellation/model";
import type { CommandResult } from "../lib/sales/model";

const harness = vi.hoisted(() => ({
  state: undefined as unknown,
  effect: undefined as (() => void) | undefined,
  sending: { current: false },
  preview: vi.fn(),
  cancel: vi.fn(),
  refresh: vi.fn(),
  uuid: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (harness.state === undefined) harness.state = initial;
      return [
        harness.state,
        (next: unknown) => {
          harness.state = typeof next === "function" ? next(harness.state) : next;
        },
      ];
    },
    useEffect: (effect: () => void) => {
      harness.effect = effect;
    },
    useRef: () => harness.sending,
    useId: () => "synthetic-id",
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: harness.refresh }) }));
vi.mock("@/app/sales/cancellation/actions", () => ({
  previewSaleCancellation: harness.preview,
  cancelSaleRegistration: harness.cancel,
}));
vi.mock("@/lib/sales/model", () => import("../lib/sales/model"));
vi.mock("@/lib/sales-cancellation/pending", () => import("../lib/sales-cancellation/pending"));
import { SaleRegistrationCancellation } from "./sale-registration-cancellation";
import {
  preserveSaleCancellation,
  readPendingSaleCancellation,
} from "../lib/sales-cancellation/pending";

const id = (n: number) => `89000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const userId = id(1),
  orderId = id(2),
  operationId = id(3);
const preview: SaleCancellationPreview = {
  orderId,
  expectedVersion: "a".repeat(64),
  productQuantity: 3,
  boxQuantity: 2,
  stickerQuantity: 1,
  paymentCents: 7312,
  alreadyCancelled: false,
};
const attempt: SaleCancellationInput = {
  userId,
  orderId,
  operationId,
  expectedVersion: preview.expectedVersion,
  reason: "Registrazione sintetica per prova",
  confirmStock: true,
};
const success: CommandResult = {
  status: "success",
  orderId,
  replayed: false,
  message: "Registrazione annullata.",
};
let store: ReturnType<typeof memory>;
function memory() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}
type Props = Parameters<typeof SaleRegistrationCancellation>[0];
type Element = ReactElement<Record<string, unknown> & { children?: unknown }>;
function tree(overrides: Partial<Props> = {}) {
  return SaleRegistrationCancellation({ userId, orderId, enabled: true, ...overrides });
}
function nodes(node: unknown, type: string): Element[] {
  if (Array.isArray(node)) return node.flatMap((entry) => nodes(entry, type));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [...(element.type === type ? [element] : []), ...nodes(element.props.children, type)];
}
function text(node: unknown) {
  return renderToStaticMarkup(node as ReactElement)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function button(label: string, overrides: Partial<Props> = {}) {
  const found = nodes(tree(overrides), "button").find((entry) => text(entry) === label);
  expect(found, label).toBeDefined();
  return found!;
}
function click(label: string) {
  (button(label).props.onClick as () => void)();
}
async function flush() {
  for (let n = 0; n < 10; n++) await Promise.resolve();
}
function mount(overrides: Partial<Props> = {}) {
  tree(overrides);
  harness.effect!();
}
async function open() {
  click("Annulla registrazione");
  await flush();
}
function completeForm(reason = attempt.reason) {
  const value = tree();
  (nodes(value, "textarea")[0].props.onChange as (event: unknown) => void)({
    target: { value: reason },
  });
  (nodes(tree(), "input")[0].props.onChange as (event: unknown) => void)({
    target: { checked: true },
  });
}
function submit() {
  const form = nodes(tree(), "form")[0];
  (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
}

beforeEach(() => {
  harness.state = undefined;
  harness.sending.current = false;
  harness.effect = undefined;
  harness.preview.mockReset().mockResolvedValue({ status: "ready", preview });
  harness.cancel.mockReset().mockResolvedValue(success);
  harness.refresh.mockReset();
  harness.uuid.mockReset().mockReturnValue(operationId);
  store = memory();
  vi.stubGlobal("sessionStorage", store);
  vi.stubGlobal("crypto", { randomUUID: harness.uuid });
});

describe("annullamento della registrazione dalla vendita", () => {
  it("attende il recupero locale e non offre scritture in sola lettura o su vendita già annullata", () => {
    expect(button("Annulla registrazione").props.disabled).toBe(true);
    mount();
    expect(button("Annulla registrazione", { enabled: false }).props.disabled).toBe(true);
    harness.state = undefined;
    expect(text(tree({ alreadyCancelled: true }))).toContain("Registrazione annullata");
    expect(nodes(tree({ alreadyCancelled: true }), "button")).toHaveLength(0);
    expect(harness.cancel).not.toHaveBeenCalled();
  });

  it("rilegge un’anteprima fresca e richiede motivo e conferma prima di inviare", async () => {
    mount();
    await open();
    expect(harness.preview).toHaveBeenCalledWith({ userId, orderId });
    const html = text(tree());
    expect(html).toContain("Capi da ripristinare 3");
    expect(html).toContain("Scatole da ripristinare 2");
    expect(html).toContain("Adesivi da ripristinare 1");
    expect(html).toContain("Effetto Finance da escludere 73,12");
    expect(html).toContain("Per merce realmente venduta e restituita serve un reso");
    submit();
    expect(harness.cancel).not.toHaveBeenCalled();
    completeForm("ab");
    submit();
    expect(harness.cancel).not.toHaveBeenCalled();
    expect(text(tree())).toContain("Scrivi un motivo da 3 a 500 caratteri");
    completeForm();
    harness.cancel.mockImplementation(async (input: SaleCancellationInput) => {
      expect(readPendingSaleCancellation(store, userId, orderId)).toEqual(attempt);
      expect(input).toEqual(attempt);
      return success;
    });
    submit();
    await flush();
    expect(harness.cancel).toHaveBeenCalledTimes(1);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    expect(readPendingSaleCancellation(store, userId, orderId)).toBeNull();
    expect(text(tree())).toBe("Registrazione annullata.");
  });

  it("mantiene lo stesso UUID e payload dopo esito incerto, anche al rientro sulla pagina", async () => {
    harness.cancel.mockResolvedValueOnce({ status: "uncertain", message: "Esito da verificare." });
    mount();
    await open();
    completeForm();
    submit();
    await flush();
    expect(readPendingSaleCancellation(store, userId, orderId)).toEqual(attempt);
    expect(nodes(tree(), "textarea")).toHaveLength(0);
    expect(text(tree())).toContain("Annullamento da verificare");
    expect(nodes(tree(), "button").some((entry) => text(entry) === "Annulla registrazione")).toBe(
      false,
    );
    harness.state = undefined;
    mount();
    click("Verifica lo stesso invio");
    await flush();
    expect(harness.cancel).toHaveBeenLastCalledWith({ ...attempt, retry: true });
    expect(harness.uuid).toHaveBeenCalledTimes(1);
    expect(readPendingSaleCancellation(store, userId, orderId)).toBeNull();
  });

  it("conserva il tentativo anche se la connessione cade o l’esito riguarda un’altra vendita", async () => {
    harness.cancel.mockRejectedValueOnce(new Error("rete sintetica"));
    mount();
    await open();
    completeForm();
    submit();
    await flush();
    expect(text(tree())).toContain("l’annullamento potrebbe essere già registrato");
    expect(readPendingSaleCancellation(store, userId, orderId)).toEqual(attempt);
    harness.cancel.mockResolvedValueOnce({ ...success, orderId: id(9) });
    click("Verifica lo stesso invio");
    await flush();
    expect(readPendingSaleCancellation(store, userId, orderId)).toEqual(attempt);
    expect(harness.refresh).not.toHaveBeenCalled();
  });

  it("un conflitto di identità conserva il tentativo, un rifiuto certo richiede una nuova anteprima", async () => {
    harness.cancel.mockResolvedValueOnce({
      status: "rejected",
      code: "idempotency_conflict",
      message: "Conflitto di invio.",
    });
    mount();
    await open();
    completeForm();
    submit();
    await flush();
    expect(readPendingSaleCancellation(store, userId, orderId)).toEqual(attempt);
    harness.cancel.mockResolvedValueOnce({
      status: "rejected",
      code: "version_conflict",
      message: "La vendita è cambiata.",
    });
    click("Verifica lo stesso invio");
    await flush();
    expect(readPendingSaleCancellation(store, userId, orderId)).toBeNull();
    expect(nodes(tree(), "form")).toHaveLength(0);
    expect(text(tree())).toContain("Rileggi l’anteprima");
    harness.preview.mockResolvedValueOnce({
      status: "ready",
      preview: { ...preview, expectedVersion: "b".repeat(64) },
    });
    click("Rileggi l’anteprima");
    await flush();
    completeForm();
    submit();
    await flush();
    expect(harness.cancel).toHaveBeenLastCalledWith({
      ...attempt,
      expectedVersion: "b".repeat(64),
    });
  });

  it("si ferma prima dell’invio se non può conservare i dati, e non sovrascrive un tentativo esistente", async () => {
    mount();
    await open();
    completeForm();
    store.setItem.mockImplementation(() => {
      throw new Error("quota sintetica");
    });
    submit();
    await flush();
    expect(harness.cancel).not.toHaveBeenCalled();
    expect(text(tree())).toContain("Nessun invio eseguito");
    expect(button("Conferma annullamento").props.disabled).toBe(false);
    expect(nodes(tree(), "fieldset")[0].props.disabled).toBe(true);
  });

  it("recupera un annullamento incerto anche se la vendita risulta già annullata dopo il refresh", async () => {
    preserveSaleCancellation(store, attempt);
    mount({ alreadyCancelled: true });
    expect(text(tree({ alreadyCancelled: true }))).toContain("Annullamento da verificare");
    expect(harness.preview).not.toHaveBeenCalled();
    (button("Verifica lo stesso invio", { alreadyCancelled: true }).props.onClick as () => void)();
    await flush();
    expect(harness.cancel).toHaveBeenCalledWith({ ...attempt, retry: true });
    expect(readPendingSaleCancellation(store, userId, orderId)).toBeNull();
  });

  it("se il refresh fallisce conserva l’esito certo senza proporre un secondo annullamento", async () => {
    harness.refresh.mockImplementation(() => {
      throw new Error("refresh sintetico");
    });
    mount();
    await open();
    completeForm();
    submit();
    await flush();
    expect(text(tree())).toContain("Registrazione annullata. Ricarica la pagina");
    expect(text(tree())).not.toContain("potrebbe essere già registrato");
    expect(readPendingSaleCancellation(store, userId, orderId)).toBeNull();
    expect(nodes(tree(), "button")).toHaveLength(0);
  });

  it("conserva la verifica del tentativo se il browser non può cancellarlo dopo un successo certo", async () => {
    store.removeItem.mockImplementation(() => {
      throw new Error("storage sintetico");
    });
    mount();
    await open();
    completeForm();
    submit();
    await flush();
    expect(text(tree())).toContain("Registrazione annullata.");
    expect(text(tree())).toContain("tentativo è ancora conservato");
    expect(readPendingSaleCancellation(store, userId, orderId)).toEqual(attempt);
    expect(button("Verifica lo stesso invio")).toBeDefined();
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  it("non usa anteprime respinte o appartenenti a un’altra vendita", async () => {
    harness.preview.mockResolvedValueOnce({
      status: "rejected",
      code: "not_found",
      message: "Vendita non disponibile.",
    });
    mount();
    await open();
    expect(text(tree())).toContain("Vendita non disponibile");
    expect(nodes(tree(), "form")).toHaveLength(0);
    harness.preview.mockResolvedValueOnce({
      status: "ready",
      preview: { ...preview, orderId: id(9) },
    });
    click("Rileggi l’anteprima");
    await flush();
    expect(text(tree())).toContain("L’anteprima non corrisponde alla vendita");
    expect(nodes(tree(), "form")).toHaveLength(0);
    expect(harness.cancel).not.toHaveBeenCalled();
  });

  it("impedisce due invii anche prima del successivo render", async () => {
    let resolve!: (result: CommandResult) => void;
    harness.cancel.mockReturnValue(
      new Promise<CommandResult>((done) => {
        resolve = done;
      }),
    );
    mount();
    await open();
    completeForm();
    const form = nodes(tree(), "form")[0];
    const handler = form.props.onSubmit as (event: unknown) => void;
    handler({ preventDefault: vi.fn() });
    handler({ preventDefault: vi.fn() });
    expect(harness.cancel).toHaveBeenCalledTimes(1);
    expect(harness.uuid).toHaveBeenCalledTimes(1);
    resolve(success);
    await flush();
  });
});
