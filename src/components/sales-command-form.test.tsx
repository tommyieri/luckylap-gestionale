import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/*
 * Invio da verificare nelle Vendite (06 R4 e R11). Stato del modulo controllato dal test,
 * nell'ordine degli useState del componente: command, notice, success, blocked, loaded, epoch,
 * unreadable, conflict.
 */
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  refresh: vi.fn(),
  states: [] as unknown[],
  setters: [] as ReturnType<typeof vi.fn>[],
  stateIndex: 0,
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: () => {},
    useRef: (value: unknown) => ({ current: value }),
    useState: (value: unknown) => {
      const index = mocks.stateIndex++;
      return [
        index in mocks.states ? mocks.states[index] : value,
        (mocks.setters[index] = vi.fn()),
      ];
    },
    useTransition: () => [false, (callback: () => unknown) => callback()],
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/sales/actions", () => ({ runSalesCommand: mocks.run }));
vi.mock("@/lib/sales/model", () => import("../lib/sales/model"));
vi.mock("@/lib/sales/attempt", () => import("../lib/sales/attempt"));
vi.mock("@/lib/sales/pending", () => import("../lib/sales/pending"));
import { SalesCommandForm } from "./sales-command-form";
import { PendingAttempt } from "./pending-attempt";
import { syntheticId, syntheticRows, syntheticSale } from "../lib/sales/fixtures";
import { salesAttemptNames, type SalesAttemptNames } from "../lib/sales/attempt";
import { salesSnapshotFromRows } from "../lib/sales/read";

type Element = ReactElement<Record<string, unknown>>;
const userId = syntheticId(10);
const key = `luckylap.sales.pending:${userId}:new-sale`;
function descendants(node: unknown): Element[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...[element.props.children].flat(Infinity).flatMap(descendants)];
}
const attempts = (names?: SalesAttemptNames) => {
  mocks.stateIndex = 0;
  const tree = SalesCommandForm({
    userId,
    scope: "new-sale",
    kind: "register_manual_sale",
    enabled: true,
    build: () => ({}),
    label: "Registra vendita",
    names,
    children: null,
  });
  return descendants(tree).filter((node) => node.type === PendingAttempt);
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.states = [];
  mocks.states[4] = true;
  vi.stubGlobal("sessionStorage", { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal(
    "Event",
    class {
      constructor(public type: string) {}
    },
  );
});

describe("modulo delle Vendite con un invio da verificare", () => {
  it("riassume l'invio in italiano e ripete lo stesso operation_id", () => {
    mocks.states[0] = syntheticSale();
    mocks.run.mockReturnValue(new Promise(() => {}));
    const [attempt] = attempts();
    expect(attempt.props).toMatchObject({
      title: "Vendita da verificare",
      lines: ["Canale: Diretta", "Riga 1: 2 capi a 40,01 €", "Da incassare"],
      occurredAt: "2026-10-21T08:00:00Z",
      operationId: syntheticSale().operationId,
      blocked: false,
      onDiscard: undefined,
      rereadLabel: "Rileggi gli ordini",
    });
    (attempt.props.onRetry as () => void)();
    expect(mocks.run).toHaveBeenCalledWith({ ...syntheticSale(), retry: true });
  });

  it("con i nomi della pagina l'articolo compare al posto di «Riga 1»", () => {
    mocks.states[0] = syntheticSale();
    const [attempt] = attempts(salesAttemptNames(salesSnapshotFromRows(syntheticRows())));
    expect(attempt.props.lines).toEqual([
      "Canale: Diretta",
      "Synthetic tee · Synthetic · M: 2 capi a 40,01\u00a0€",
      "Da incassare",
    ]);
  });

  it("un invio in conflitto si scarta, solo dopo la conferma del componente", () => {
    mocks.states[0] = syntheticSale();
    mocks.states[7] = true;
    const [attempt] = attempts();
    expect(attempt.props.blocked).toBe(true);
    (attempt.props.onDiscard as () => void)();
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(key);
    expect(mocks.setters[0]).toHaveBeenCalledWith(null);
    expect(mocks.setters[7]).toHaveBeenCalledWith(false);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("un tentativo illeggibile si può solo scartare; se la scheda non lo libera lo dice", () => {
    mocks.states[3] = true;
    mocks.states[6] = true;
    const [attempt] = attempts();
    expect(attempt.props).toMatchObject({ blocked: true, operationId: "non leggibile" });
    vi.mocked(sessionStorage.removeItem).mockImplementation(() => {
      throw Error("bloccato");
    });
    (attempt.props.onDiscard as () => void)();
    expect(mocks.setters[1]).toHaveBeenCalledWith(
      "Non riesco a liberare il tentativo conservato in questa scheda. Chiudi la scheda e riaprila.",
    );
    expect(mocks.setters[6]).not.toHaveBeenCalled();
  });

  it("senza tentativi non mostra nessun riquadro", () => {
    expect(attempts()).toHaveLength(0);
  });
});
