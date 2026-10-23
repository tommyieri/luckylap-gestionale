import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/*
 * Rettifica da verificare (06 R4 e R11). Stato del modulo controllato dal test, nell'ordine
 * degli useState del componente: command, notice, success, loaded, blocked, epoch, unreadable,
 * conflict. Ogni useTransition finisce in `transitions`, così il test aspetta l'esito.
 */
const mocks = vi.hoisted(() => ({
  adjust: vi.fn(),
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
vi.mock("@/app/stock/actions", () => ({ adjustStock: mocks.adjust }));
vi.mock("@/lib/stock/model", () => import("../lib/stock/model"));
import { StockAdjustmentForm, stockAttemptLines } from "./stock-adjustment-form";
import { PendingAttempt } from "./pending-attempt";
import type { StockAdjustment, StockSnapshot } from "../lib/stock/model";

const item = "00000000-0000-4000-8000-000000000001",
  location = "00000000-0000-4000-8000-000000000002",
  operationId = "00000000-0000-4000-8000-000000000003";
const snapshot = {
  enabled: true,
  loadedAt: "2026-10-22T08:00:00Z",
  items: [{ id: item, sku: "SYN-GT3-BLU-M", name: "GT3 Blu M", active: true }],
  locations: [{ id: location, code: "MAG01", name: "Magadzino", active: true }],
  availability: [],
} as unknown as StockSnapshot;

describe("rettifica da verificare", () => {
  it("riassume articolo, sede, variazione e causale senza id", () => {
    const lines = stockAttemptLines(
      { operationId, itemId: item, locationId: location, delta: 3, reason: "Conta sintetica" },
      snapshot,
    );
    expect(lines).toEqual([
      "SYN-GT3-BLU-M · GT3 Blu M",
      "Sede: Magadzino",
      "Variazione: +3 unità",
      "Causale: Conta sintetica",
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/00000000-/);
  });
  it("se articolo o sede non ci sono più lo dice, senza mostrare l'id", () => {
    const lines = stockAttemptLines(
      { operationId, itemId: operationId, locationId: operationId, delta: -2, reason: "Reso" },
      snapshot,
    );
    expect(lines.slice(0, 3)).toEqual([
      "Articolo non più nell’elenco",
      "Sede non più tra i magazzini",
      "Variazione: -2 unità",
    ]);
    expect(JSON.stringify(lines)).not.toContain(operationId);
  });
});

type Element = ReactElement<Record<string, unknown>>;
const userId = "00000000-0000-4000-8000-000000000010";
const key = `luckylap.stock.pending:${userId}`;
const frozen = (): StockAdjustment => ({
  operationId,
  itemId: item,
  locationId: location,
  delta: 3,
  reason: "Conta sintetica",
});
function descendants(node: unknown): Element[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...[element.props.children].flat(Infinity).flatMap(descendants)];
}
const attempts = () => {
  mocks.stateIndex = 0;
  return descendants(
    StockAdjustmentForm({
      snapshot,
      userId,
      itemId: item,
      locationId: location,
      setItemId: vi.fn(),
      setLocationId: vi.fn(),
      setLocked: vi.fn(),
    }),
  ).filter((node) => node.type === PendingAttempt);
};
const retry = async (attempt: Element) => {
  (attempt.props.onRetry as () => void)();
  await Promise.all(mocks.transitions);
};

describe("modulo delle Rettifiche con un invio da verificare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.states = [];
    mocks.setters = [];
    mocks.transitions = [];
    mocks.states[3] = true;
    vi.stubGlobal("sessionStorage", { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() });
  });

  it("un esito incerto ripete lo stesso operation_id e non offre «Scarta»", async () => {
    mocks.states[0] = frozen();
    mocks.adjust.mockResolvedValue({ status: "uncertain", message: "Esito sintetico incerto." });
    const [attempt] = attempts();
    expect(attempt.props).toMatchObject({
      title: "Rettifica da verificare",
      operationId,
      blocked: false,
      onDiscard: undefined,
      rereadLabel: "Rileggi le quantità",
    });
    await retry(attempt);
    expect(mocks.adjust).toHaveBeenCalledWith({ ...frozen(), retry: true });
    expect(sessionStorage.setItem).toHaveBeenCalledWith(
      key,
      JSON.stringify({ ...frozen(), retry: true }),
    );
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(mocks.setters[7]).not.toHaveBeenCalled();
  });

  it("una connessione interrotta conserva il tentativo", async () => {
    mocks.states[0] = frozen();
    mocks.adjust.mockRejectedValue(Error("rete"));
    await retry(attempts()[0]);
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(mocks.setters[1]).toHaveBeenLastCalledWith(
      "La connessione si è interrotta: il movimento potrebbe essere già registrato. Verifica lo stesso tentativo, senza creare una seconda rettifica.",
    );
  });

  it("idempotency_conflict blocca la verifica e solo allora offre «Scarta»", async () => {
    mocks.states[0] = frozen();
    mocks.adjust.mockResolvedValue({
      status: "rejected",
      code: "idempotency_conflict",
      message: "Conflitto sintetico.",
    });
    await retry(attempts()[0]);
    expect(mocks.setters[7]).toHaveBeenCalledWith(true);
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    mocks.states[7] = true;
    const [attempt] = attempts();
    expect(attempt.props.blocked).toBe(true);
    (attempt.props.onDiscard as () => void)();
    expect(sessionStorage.removeItem).toHaveBeenCalledTimes(1);
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(key);
    expect(mocks.setters[0]).toHaveBeenCalledWith(null);
    expect(mocks.setters[7]).toHaveBeenCalledWith(false);
    expect(mocks.adjust).toHaveBeenCalledTimes(1);
  });

  it("un altro rifiuto libera il modulo senza passare da «Scarta»", async () => {
    mocks.states[0] = frozen();
    mocks.adjust.mockResolvedValue({
      status: "rejected",
      code: "shop_location",
      message: "Le quantità del negozio si cambiano da Conto vendita.",
    });
    await retry(attempts()[0]);
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(key);
    expect(mocks.setters[0]).toHaveBeenCalledWith(null);
    expect(mocks.setters[7]).not.toHaveBeenCalled();
  });

  it("una rettifica illeggibile si può solo scartare; se la scheda non la libera lo dice", () => {
    mocks.states[4] = true;
    mocks.states[6] = true;
    const list = attempts();
    expect(list).toHaveLength(1);
    expect(list[0].props).toMatchObject({
      title: "Rettifica da verificare non leggibile",
      blocked: true,
      operationId: "non leggibile",
    });
    (list[0].props.onRetry as () => void)();
    expect(mocks.adjust).not.toHaveBeenCalled();
    (list[0].props.onDiscard as () => void)();
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(key);
    expect(mocks.setters[6]).toHaveBeenCalledWith(false);
    vi.mocked(sessionStorage.removeItem).mockImplementation(() => {
      throw Error("bloccato");
    });
    (attempts()[0].props.onDiscard as () => void)();
    expect(mocks.setters[1]).toHaveBeenCalledWith(
      "Non riesco a liberare il tentativo conservato in questa scheda. Chiudi la scheda e riaprila.",
    );
  });
});
