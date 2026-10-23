import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { SaleReturnInput, SaleReturnPreview } from "../lib/sales-returns/model";
const h = vi.hoisted(() => ({
  state: undefined as unknown,
  effect: undefined as (() => void) | undefined,
  sending: { current: false },
  preview: vi.fn(),
  register: vi.fn(),
  refresh: vi.fn(),
  uuid: vi.fn(),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (h.state === undefined) h.state = initial;
      return [
        h.state,
        (value: unknown) => {
          h.state = typeof value === "function" ? value(h.state) : value;
        },
      ];
    },
    useEffect: (effect: () => void) => {
      h.effect = effect;
    },
    useRef: () => h.sending,
    useId: () => "demo-id",
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/app/sales/returns/actions", () => ({
  previewSaleReturn: h.preview,
  registerSaleReturn: h.register,
}));
vi.mock("@/lib/sales/model", () => import("../lib/sales/model"));
vi.mock("@/lib/sales-returns/pending", () => import("../lib/sales-returns/pending"));
import { SaleReturnForm } from "./sale-return-form";
import { preserveSaleReturn, readPendingSaleReturn } from "../lib/sales-returns/pending";
const id = (n: number) => `88000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const userId = id(1),
  orderId = id(2),
  operationId = id(3),
  lineId = id(4),
  now = "2026-06-02T08:00:00.000Z";
const available: SaleReturnPreview = {
  orderId,
  expectedVersion: "d".repeat(64),
  lines: [
    {
      orderLineId: lineId,
      sku: "DEMO-M",
      availableQuantity: 3,
      selectedQuantity: 0,
      refundCents: 0,
    },
  ],
  productQuantity: 0,
  boxQuantity: 0,
  stickerQuantity: 0,
  refundCents: 0,
  refundableCents: 7500,
  remainingValueCents: 7500,
};
const quote: SaleReturnPreview = {
  ...available,
  lines: [{ ...available.lines[0], selectedQuantity: 1, refundCents: 2500 }],
  productQuantity: 1,
  refundCents: 2500,
};
const attempt: SaleReturnInput = {
  userId,
  orderId,
  operationId,
  lines: [{ orderLineId: lineId, quantity: 1 }],
  reusableBoxes: 0,
  reusableStickers: 0,
  refundAccount: "Conto demo",
  expectedVersion: quote.expectedVersion,
  occurredAt: now,
  reason: "Reso sintetico",
  refundCompletedConfirmed: true,
};
const success = { status: "success", orderId, replayed: false, message: "Reso registrato." };
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
let store: ReturnType<typeof memory>;
type Props = Parameters<typeof SaleReturnForm>[0];
type Element = ReactElement<Record<string, unknown> & { children?: unknown }>;
const tree = (overrides: Partial<Props> = {}) =>
  SaleReturnForm({ userId, orderId, enabled: true, now, ...overrides });
function nodes(node: unknown, type: string): Element[] {
  if (Array.isArray(node)) return node.flatMap((value) => nodes(value, type));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [...(element.type === type ? [element] : []), ...nodes(element.props.children, type)];
}
const text = (node: unknown) =>
  renderToStaticMarkup(node as ReactElement)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
function button(label: string) {
  const b = nodes(tree(), "button").find((node) => text(node) === label);
  expect(b, label).toBeDefined();
  return b!;
}
const click = (label: string) => (button(label).props.onClick as () => void)();
async function flush() {
  for (let n = 0; n < 10; n++) await Promise.resolve();
}
function mount() {
  tree();
  h.effect!();
}
async function open() {
  click("Registra reso");
  await flush();
}
function changeLabel(label: string, value: string | boolean) {
  const target = nodes(tree(), "label").find((node) => text(node).startsWith(label));
  expect(target, label).toBeDefined();
  const field = [...nodes(target, "input"), ...nodes(target, "textarea")][0];
  expect(field).toBeDefined();
  (field.props.onChange as (event: unknown) => void)({ target: { value, checked: value } });
}
async function verify() {
  changeLabel("DEMO-M", "1");
  changeLabel("Conto da cui", "Conto demo");
  click("Verifica reso");
  await flush();
}
function complete() {
  changeLabel("Motivo del reso", attempt.reason);
  changeLabel("Confermo che la merce", true);
}
function submit() {
  (nodes(tree(), "form")[0].props.onSubmit as (event: unknown) => void)({
    preventDefault: vi.fn(),
  });
}
beforeEach(() => {
  h.state = undefined;
  h.effect = undefined;
  h.sending.current = false;
  h.preview
    .mockReset()
    .mockResolvedValueOnce({ status: "ready", preview: available })
    .mockResolvedValue({ status: "ready", preview: quote });
  h.register.mockReset().mockResolvedValue(success);
  h.refresh.mockReset();
  h.uuid.mockReset().mockReturnValue(operationId);
  store = memory();
  vi.stubGlobal("sessionStorage", store);
  vi.stubGlobal("crypto", { randomUUID: h.uuid });
});
describe("reso reale dalla vendita", () => {
  it("attende il recupero locale, rispetta sola lettura e non offre resi sulla vendita annullata", () => {
    expect(button("Registra reso").props.disabled).toBe(true);
    mount();
    const readonly = nodes(tree({ enabled: false }), "button")[0];
    expect(readonly.props.disabled).toBe(true);
    expect(tree({ alreadyCancelled: true })).toBeNull();
  });
  it("parte senza packaging, legge la disponibilità e calcola il rimborso soltanto dal server", async () => {
    mount();
    await open();
    expect(h.preview).toHaveBeenCalledWith({
      userId,
      orderId,
      lines: [],
      reusableBoxes: 0,
      reusableStickers: 0,
      refundAccount: "",
    });
    expect(text(tree())).toContain("3 capi ancora restituibili");
    expect(
      nodes(tree(), "input")
        .filter((node) => node.props.type === "number")
        .map((node) => node.props.value),
    ).toEqual(["0", "0", "0"]);
    await verify();
    expect(h.preview).toHaveBeenLastCalledWith({
      userId,
      orderId,
      lines: [{ orderLineId: lineId, quantity: 1 }],
      reusableBoxes: 0,
      reusableStickers: 0,
      refundAccount: "Conto demo",
    });
    expect(text(tree())).toContain("Rimborso da registrare 25,00");
    expect(text(tree())).toContain("inclusi gli sconti");
    expect(nodes(tree(), "input").some((node) => String(node.props.name).includes("amount"))).toBe(
      false,
    );
    submit();
    expect(h.register).not.toHaveBeenCalled();
    complete();
    h.register.mockImplementation(async (input: SaleReturnInput) => {
      expect(readPendingSaleReturn(store, userId, orderId)).toEqual(attempt);
      expect(input).toEqual(attempt);
      return success;
    });
    submit();
    await flush();
    expect(h.register).toHaveBeenCalledTimes(1);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(readPendingSaleReturn(store, userId, orderId)).toBeNull();
    expect(text(tree())).toContain("Reso registrato");
  });
  it("invalida la quotazione quando cambiano quantità, packaging o conto", async () => {
    mount();
    await open();
    await verify();
    changeLabel("Scatole rientrate", "1");
    expect(text(tree())).not.toContain("Rimborso da registrare");
    expect(nodes(tree(), "input").some((node) => node.props.type === "checkbox")).toBe(false);
    click("Verifica reso");
    await flush();
    expect(h.preview).toHaveBeenLastCalledWith(expect.objectContaining({ reusableBoxes: 1 }));
    changeLabel("Adesivi rientrati", "1");
    expect(text(tree())).not.toContain("Rimborso da registrare");
    click("Verifica reso");
    await flush();
    changeLabel("Conto da cui", "Secondo conto demo");
    expect(text(tree())).not.toContain("Rimborso da registrare");
    click("Verifica reso");
    await flush();
    changeLabel("DEMO-M", "2");
    expect(text(tree())).not.toContain("Rimborso da registrare");
    expect(h.register).not.toHaveBeenCalled();
  });
  it("non consente quantità superiori ai capi disponibili né conto assente", async () => {
    mount();
    await open();
    changeLabel("DEMO-M", "4");
    click("Verifica reso");
    await flush();
    expect(h.preview).toHaveBeenCalledTimes(1);
    expect(text(tree())).toContain("non possono superare");
    changeLabel("DEMO-M", "1");
    click("Verifica reso");
    await flush();
    expect(h.preview).toHaveBeenCalledTimes(1);
    expect(text(tree())).toContain("indica il conto");
  });
  it("mantiene il tentativo incerto al reload e ripete lo stesso UUID, data e dati", async () => {
    h.register.mockResolvedValueOnce({ status: "uncertain", message: "Esito da verificare." });
    mount();
    await open();
    await verify();
    complete();
    submit();
    await flush();
    expect(readPendingSaleReturn(store, userId, orderId)).toEqual(attempt);
    expect(nodes(tree(), "form")).toHaveLength(0);
    h.state = undefined;
    mount();
    click("Verifica lo stesso invio");
    await flush();
    expect(h.register).toHaveBeenLastCalledWith({ ...attempt, retry: true });
    expect(h.uuid).toHaveBeenCalledTimes(1);
    expect(readPendingSaleReturn(store, userId, orderId)).toBeNull();
  });
  it("la connessione interrotta e il conflitto di identità non liberano un nuovo invio", async () => {
    h.register.mockRejectedValueOnce(new Error("rete sintetica"));
    mount();
    await open();
    await verify();
    complete();
    submit();
    await flush();
    expect(text(tree())).toContain("potrebbe essere già registrato");
    h.register.mockResolvedValueOnce({
      status: "rejected",
      code: "idempotency_conflict",
      message: "Conflitto sintetico.",
    });
    click("Verifica lo stesso invio");
    await flush();
    expect(readPendingSaleReturn(store, userId, orderId)).toEqual(attempt);
    expect(h.uuid).toHaveBeenCalledTimes(1);
  });
  it("un rifiuto certo richiede una lettura nuova e un successo non diventa incerto se fallisce il refresh", async () => {
    h.register.mockResolvedValueOnce({
      status: "rejected",
      code: "version_conflict",
      message: "Vendita cambiata.",
    });
    mount();
    await open();
    await verify();
    complete();
    submit();
    await flush();
    expect(readPendingSaleReturn(store, userId, orderId)).toBeNull();
    expect(nodes(tree(), "form")).toHaveLength(0);
    expect(text(tree())).toContain("Rileggi la vendita");
    h.state = undefined;
    h.preview
      .mockReset()
      .mockResolvedValueOnce({ status: "ready", preview: available })
      .mockResolvedValue({ status: "ready", preview: quote });
    h.refresh.mockImplementation(() => {
      throw new Error("refresh sintetico");
    });
    mount();
    await open();
    await verify();
    complete();
    submit();
    await flush();
    expect(text(tree())).toContain("Reso registrato. Ricarica la pagina");
    expect(text(tree())).not.toContain("potrebbe essere già registrato");
  });
  it("non invia nulla se la conservazione fallisce e conserva un successo se la pulizia fallisce", async () => {
    mount();
    await open();
    await verify();
    complete();
    store.setItem.mockImplementationOnce(() => {
      throw new Error("quota sintetica");
    });
    submit();
    await flush();
    expect(h.register).not.toHaveBeenCalled();
    expect(text(tree())).toContain("Nessun invio eseguito");
    h.state = undefined;
    store.removeItem.mockImplementation(() => {
      throw new Error("storage sintetico");
    });
    mount();
    await open();
    await verify();
    complete();
    submit();
    await flush();
    expect(text(tree())).toContain("Reso registrato");
    expect(text(tree())).toContain("tentativo resta conservato");
    expect(readPendingSaleReturn(store, userId, orderId)).toEqual(attempt);
  });
  it("si ferma sui tentativi corrotti e rifiuta anteprime di un altro ordine", async () => {
    preserveSaleReturn(store, attempt);
    const [key] = store.values.keys();
    store.setItem(key, "{");
    mount();
    expect(button("Registra reso").props.disabled).toBe(true);
    expect(h.register).not.toHaveBeenCalled();
    store.values.clear();
    h.state = undefined;
    h.preview
      .mockReset()
      .mockResolvedValue({ status: "ready", preview: { ...available, orderId: id(9) } });
    mount();
    await open();
    expect(nodes(tree(), "form")).toHaveLength(0);
    expect(text(tree())).toContain("anteprima del reso non è disponibile");
  });
});
