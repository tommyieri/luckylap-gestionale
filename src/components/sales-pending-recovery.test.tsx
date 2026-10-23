import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/*
 * «Invii da verificare» delle Vendite fuori dal loro modulo (06 R4 e R11). Stato controllato
 * dal test, nell'ordine degli useState del componente: saved, message, conflicts.
 * Ogni useTransition finisce in `transitions`, così il test aspetta l'esito.
 */
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  refresh: vi.fn(),
  states: [] as unknown[],
  setters: [] as ReturnType<typeof vi.fn>[],
  stateIndex: 0,
  transitions: [] as Promise<unknown>[],
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
    useTransition: () => [
      false,
      (callback: () => unknown) => {
        mocks.transitions.push(Promise.resolve(callback()));
      },
    ],
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/sales/actions", () => ({ runSalesCommand: mocks.run }));
vi.mock("@/lib/sales/attempt", () => import("../lib/sales/attempt"));
vi.mock("@/lib/sales/pending", () => import("../lib/sales/pending"));
import { SalesPendingRecovery } from "./sales-pending-recovery";
import { PendingAttempt } from "./pending-attempt";
import { syntheticId, syntheticSale } from "../lib/sales/fixtures";
import type { SalesCommand } from "../lib/sales/model";

type Element = ReactElement<Record<string, unknown>>;
const userId = syntheticId(10);
const prefix = `luckylap.sales.pending:${userId}:`;
const first = `${prefix}payment:${syntheticId(40)}`,
  second = `${prefix}delivery:${syntheticId(41)}`,
  broken = `${prefix}payment:${syntheticId(42)}`;
const sale = () => syntheticSale() as SalesCommand;
const saved = () => ({
  entries: [
    { key: first, scope: `payment:${syntheticId(40)}`, command: sale() },
    {
      key: second,
      scope: `delivery:${syntheticId(41)}`,
      command: { ...sale(), operationId: syntheticId(91) },
    },
  ],
  unreadable: false,
  unreadableKeys: [] as string[],
});
function descendants(node: unknown): Element[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...[element.props.children].flat(Infinity).flatMap(descendants)];
}
const attempts = () => {
  mocks.stateIndex = 0;
  return descendants(SalesPendingRecovery({ userId, activeScopes: ["new-sale"] })).filter(
    (node) => node.type === PendingAttempt,
  );
};
const retry = async (attempt: Element) => {
  (attempt.props.onRetry as () => void)();
  await Promise.all(mocks.transitions);
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.states = [];
  mocks.setters = [];
  mocks.transitions = [];
  vi.stubGlobal("sessionStorage", { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal(
    "Event",
    class {
      constructor(public type: string) {}
    },
  );
});

describe("«Invii da verificare» delle Vendite", () => {
  it("senza tentativi non mostra niente", () => {
    mocks.stateIndex = 0;
    expect(SalesPendingRecovery({ userId, activeScopes: [] })).toBeNull();
  });

  it("riassume l'invio in italiano; un esito incerto ripete lo stesso operation_id", async () => {
    mocks.states[0] = saved();
    mocks.run.mockResolvedValue({ status: "uncertain", message: "Esito sintetico incerto." });
    const list = attempts();
    expect(list[0].props).toMatchObject({
      title: "Vendita da verificare",
      lines: ["Canale: Diretta", "Riga 1: 2 capi a 40,01\u00a0€", "Da incassare"],
      operationId: sale().operationId,
      blocked: false,
      onDiscard: undefined,
      rereadLabel: "Rileggi gli ordini",
    });
    expect(list[1].props.onDiscard).toBeUndefined();
    await retry(list[0]);
    expect(mocks.run).toHaveBeenCalledWith({ ...sale(), retry: true });
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(mocks.setters[2]).not.toHaveBeenCalled();
  });

  it("una connessione interrotta conserva il tentativo", async () => {
    mocks.states[0] = saved();
    mocks.run.mockRejectedValue(Error("rete"));
    await retry(attempts()[0]);
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(mocks.setters[1]).toHaveBeenLastCalledWith(
      "L’esito non è confermato. Il tentativo resta conservato: verifica di nuovo senza creare una nuova operazione.",
    );
  });

  it("un conflitto blocca solo quel tentativo, e «Scarta» toglie solo la sua chiave", async () => {
    mocks.states[0] = saved();
    mocks.run.mockResolvedValue({
      status: "rejected",
      code: "idempotency_conflict",
      message: "Conflitto sintetico.",
    });
    await retry(attempts()[0]);
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    const update = mocks.setters[2].mock.calls[0][0] as (current: string[]) => string[];
    expect(update([])).toEqual([first]);
    mocks.states[2] = [first];
    const [blocked, free] = attempts();
    expect(blocked.props.blocked).toBe(true);
    expect(free.props).toMatchObject({ blocked: false, onDiscard: undefined });
    (blocked.props.onDiscard as () => void)();
    expect(sessionStorage.removeItem).toHaveBeenCalledTimes(1);
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(first);
    const drop = mocks.setters[2].mock.calls[0][0] as (current: string[]) => string[];
    expect(drop([first, second])).toEqual([second]);
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it("un altro rifiuto toglie il tentativo e rilegge gli ordini", async () => {
    mocks.states[0] = saved();
    mocks.run.mockResolvedValue({
      status: "rejected",
      code: "order_not_found",
      message: "Ordine sintetico assente.",
    });
    await retry(attempts()[1]);
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(second);
    expect(sessionStorage.removeItem).not.toHaveBeenCalledWith(first);
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("un tentativo illeggibile si scarta solo se se ne conosce la chiave", () => {
    mocks.states[0] = { entries: [], unreadable: true, unreadableKeys: [broken] };
    const [attempt] = attempts();
    expect(attempt.props).toMatchObject({
      title: "Invio da verificare non leggibile",
      blocked: true,
      operationId: "non leggibile",
    });
    (attempt.props.onRetry as () => void)();
    expect(mocks.run).not.toHaveBeenCalled();
    (attempt.props.onDiscard as () => void)();
    expect(sessionStorage.removeItem).toHaveBeenCalledTimes(1);
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(broken);
    mocks.states[0] = { entries: [], unreadable: true, unreadableKeys: [] };
    expect(attempts()[0].props.onDiscard).toBeUndefined();
  });

  it("se la scheda non libera il tentativo lo dice", () => {
    mocks.states[0] = { entries: [], unreadable: true, unreadableKeys: [broken] };
    vi.mocked(sessionStorage.removeItem).mockImplementation(() => {
      throw Error("bloccato");
    });
    (attempts()[0].props.onDiscard as () => void)();
    expect(mocks.setters[1]).toHaveBeenCalledWith(
      "Non riesco a liberare il tentativo conservato in questa scheda. Chiudi la scheda e riaprila.",
    );
  });
});
