import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  stateIndex: 0,
  states: [] as unknown[],
  setters: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useId: () => "synthetic-entry",
  useState: (initial: unknown) => {
    const index = mocks.stateIndex++;
    return [
      index in mocks.states ? mocks.states[index] : initial,
      (mocks.setters[index] = vi.fn()),
    ];
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/finance/work/actions", () => ({ runFinanceWork: vi.fn() }));
vi.mock("@/lib/finance/categories", () => import("../../lib/finance/categories"));
vi.mock("@/lib/finance-work/model", () => import("../../lib/finance-work/model"));
vi.mock("@/lib/finance-work/pending", () => import("../../lib/finance-work/pending"));
import { FinanceNewMovement } from "./finance-new-movement";
import { FinanceWorkForm } from "../finance-work-form";

type Element = ReactElement<Record<string, unknown>>;
const actorId = "00000000-0000-4000-8000-000000000011";
const entryId = "00000000-0000-4000-8000-000000000022";
const props = {
  actorId,
  today: "2026-11-09",
  accounts: ["Cassa sintetica"],
  direction: "expense" as const,
  onSaved: vi.fn(),
  onDirtyChange: vi.fn(),
};
function descendants(node: unknown): Element[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...[element.props.children].flat(Infinity).flatMap(descendants)];
}
function render(extra: Partial<Parameters<typeof FinanceNewMovement>[0]> = {}) {
  mocks.stateIndex = 0;
  return descendants(FinanceNewMovement({ ...props, ...extra }));
}
function form(nodes: Element[]) {
  return nodes.find((node) => node.type === FinanceWorkForm)!;
}
function payload(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    type: "expense",
    amount: "34,90",
    date: "2026-11-09",
    description: "Materiale sintetico di prova",
    confirmed: "on",
    ...overrides,
  }))
    data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.states = [];
  mocks.setters = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
});

afterEach(() => vi.useRealTimers());

describe("nuovo movimento diretto", () => {
  it("apre i sei campi con data di oggi e contratto record legato alla persona", () => {
    const nodes = render();
    expect(form(nodes).props).toMatchObject({
      userId: actorId,
      scope: "record",
      kind: "record_finance_entry",
      label: "Registra uscita",
      secondaryLabel: "Registra e aggiungi un’altra",
      showRecordHelp: false,
    });
    const fields = nodes.filter((node) =>
      ["input", "select", "textarea"].includes(String(node.type)),
    );
    expect(
      fields.filter((node) => node.props.name !== "confirmed").map((node) => node.props.name),
    ).toEqual(["type", "amount", "date", "description", "account", "category"]);
    expect(fields.find((node) => node.props.name === "date")?.props.defaultValue).toBe(props.today);
    expect(fields.find((node) => node.props.name === "amount")?.props.inputMode).toBe("decimal");
    expect(fields.find((node) => node.props.name === "account")?.props.required).not.toBe(true);
    expect(fields.find((node) => node.props.name === "category")?.props.required).not.toBe(true);
    expect(nodes.some((node) => node.type === "dialog")).toBe(false);
  });
  it("invia importi italiani positivi, direzione esplicita e conto/categoria facoltativi", () => {
    const build = form(render()).props.build as (data: FormData) => Record<string, unknown>;
    expect(build(payload())).toMatchObject({
      entry_type: "expense",
      amount_cents: 3490,
      not_duplicate_confirmed: true,
    });
    expect(build(payload())).not.toHaveProperty("account_label");
    expect(build(payload())).not.toHaveProperty("category");
    expect(
      build(
        payload({ type: "income", account: "Cassa sintetica", category: "Categoria sintetica" }),
      ),
    ).toMatchObject({
      entry_type: "income",
      account_label: "Cassa sintetica",
      category: "Categoria sintetica",
    });
    expect(form(render({ direction: "income" })).props.label).toBe("Registra entrata");
  });
  it("mantiene la conferma e mostra l’errore accanto al campo senza cancellare i dati", () => {
    const nodes = render();
    expect(nodes.find((node) => node.props.name === "confirmed")?.props).toMatchObject({
      type: "checkbox",
      required: true,
    });
    const build = form(nodes).props.build as (data: FormData) => unknown;
    expect(() => build(payload({ amount: "-34,90" }))).toThrow();
    expect(
      mocks.setters.some((setter) =>
        setter.mock.calls.some(
          ([value]) => value && typeof value === "object" && "amount" in value,
        ),
      ),
    ).toBe(true);
    expect(() => build(payload({ confirmed: "" }))).toThrow();
    expect(() => build(payload({ date: "2026-11-10" }))).toThrow();
  });
  it("passa al contenitore solo la riga della ricevuta confermata e la scelta altra voce", () => {
    const saved = form(render()).props.onSaved as (
      receipt: unknown,
      context: { addAnother: boolean },
    ) => void;
    saved(
      { status: "success", entryId, replayed: false, message: "Confermata" },
      { addAnother: false },
    );
    expect(props.onSaved).toHaveBeenCalledWith({
      entryId,
      movementId: `manual:${entryId}`,
      addAnother: false,
    });
    saved(
      { status: "success", entryId, replayed: true, message: "Confermata" },
      { addAnother: true },
    );
    expect(props.onSaved).toHaveBeenLastCalledWith({
      entryId,
      movementId: `manual:${entryId}`,
      addAnother: true,
    });
  });
  it("disabilita l’invio in anteprima e collega il dirty del form al contenitore", () => {
    const work = form(render({ readOnly: true }));
    expect(work.props.disabled).toBe(true);
    expect(work.props.onDirtyChange).toBe(props.onDirtyChange);
    expect(work.props.onSaved).toBeTypeOf("function");
  });
});

describe("classificazione facoltativa", () => {
  it("offre scelte esplicite vuote, gruppi pertinenti e categoria libera", () => {
    const nodes = render();
    const choices = nodes.filter((node) => node.type === "option");
    expect(
      choices.filter((node) => node.props.value === "").map((node) => node.props.children),
    ).toEqual(["Da attribuire", "Da classificare"]);
    expect(
      nodes.filter((node) => node.type === "optgroup").map((node) => node.props.label),
    ).toEqual(["Costi fissi", "Costi variabili", "Entrate"]);
    expect(
      render({ direction: "income" }).filter((node) => node.type === "optgroup")[0].props.label,
    ).toBe("Entrate");
    mocks.states[1] = "__custom";
    mocks.states[2] = "__custom";
    const custom = render();
    expect(
      custom.find((node) => node.type === "input" && node.props.name === "account")?.props.required,
    ).toBe(true);
    expect(
      custom.find((node) => node.type === "input" && node.props.name === "category")?.props
        .required,
    ).toBe(true);
    expect(() => (form(custom).props.build as (data: FormData) => unknown)(payload())).toThrow();
  });

  it("collega il testo dell’errore al campo e non trasmette dati invalidi", () => {
    mocks.states[3] = { amount: "Importo sintetico non valido" };
    const nodes = render();
    const amount = nodes.find((node) => node.props.name === "amount")!;
    const message = nodes.find((node) => node.props.id === "synthetic-entry-amount-error")!;
    expect(amount.props["aria-invalid"]).toBe(true);
    expect(amount.props["aria-describedby"]).toContain(message.props.id);
    expect(message.props.children).toBe("Importo sintetico non valido");
    expect(() =>
      (form(nodes).props.build as (data: FormData) => unknown)(payload({ description: "ab" })),
    ).toThrow();
    expect(props.onSaved).not.toHaveBeenCalled();
  });
});

describe("date e contratto di registrazione esistente", () => {
  it("mantiene il limite esistente alle date e spiega il promemoria nel Calendario", () => {
    const nodes = render();
    const date = nodes.find((node) => node.props.name === "date")!;
    expect(date.props.max).toBe(props.today);
    const content = nodes
      .flatMap((node) => [node.props.children].flat())
      .filter((value) => typeof value === "string")
      .join(" ");
    expect(content).toContain("Per una data futura usa un promemoria nel Calendario");
  });

  it("rispetta il vincolo del vero financeEntryForm senza creare una nuova voce futura", () => {
    const build = form(render()).props.build as (data: FormData) => unknown;
    expect(() => build(payload({ date: "2026-11-10" }))).toThrow("Controlla i campi indicati.");
    expect(mocks.setters[3]).toHaveBeenLastCalledWith({
      date: "La data è futura: usa un promemoria nel Calendario e registra qui il movimento quando avviene.",
    });
    expect(props.onSaved).not.toHaveBeenCalled();
  });
});
