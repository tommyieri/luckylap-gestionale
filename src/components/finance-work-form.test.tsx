import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/*
 * Invii Finance da verificare (06 R4 e R11, 00-sequenza 06-7). Stato controllato dal test,
 * nell'ordine degli useState dei componenti:
 * - FinanceWorkForm: command, notice, success, blocked, loaded, epoch, unreadable, conflict;
 * - FinanceWorkRecovery: saved, message, conflicts.
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
vi.mock("@/app/finance/work/actions", () => ({ runFinanceWork: mocks.run }));
vi.mock("@/lib/finance/categories", () => import("../lib/finance/categories"));
vi.mock("@/lib/finance-work/model", () => import("../lib/finance-work/model"));
vi.mock("@/lib/finance-work/pending", () => import("../lib/finance-work/pending"));
import { FinanceWorkForm, FinanceWorkRecovery } from "./finance-work-form";
import { PendingAttempt } from "./pending-attempt";
import { manualCommand, workId } from "../lib/finance-work/fixtures";
import type { FinanceWorkCommand } from "../lib/finance-work/model";

type Element = ReactElement<Record<string, unknown>>;
const userId = workId(10);
const key = `luckylap.finance.work:${userId}:manual`;
const command = () => manualCommand() as FinanceWorkCommand;
const other = (): FinanceWorkCommand => ({
  operationId: workId(91),
  kind: "void_finance_entry",
  payload: { schema_version: 1, entry_id: workId(1), reason: "Doppione sintetico" },
});
function descendants(node: unknown): Element[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...[element.props.children].flat(Infinity).flatMap(descendants)];
}
const attemptsOf = (tree: unknown) =>
  descendants(tree).filter((node) => node.type === PendingAttempt);
const formAttempts = () => {
  mocks.stateIndex = 0;
  return attemptsOf(
    FinanceWorkForm({
      userId,
      scope: "manual",
      kind: "record_finance_entry",
      build: () => ({}),
      label: "Registra voce",
      children: null,
    }),
  );
};
const recoveryAttempts = () => {
  mocks.stateIndex = 0;
  return attemptsOf(FinanceWorkRecovery({ userId, activeScopes: ["manual"] }));
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

describe("modulo Finance con un invio da verificare", () => {
  beforeEach(() => {
    mocks.states[4] = true;
  });

  it("un esito incerto ripete lo stesso operation_id e non offre «Scarta»", async () => {
    mocks.states[0] = command();
    mocks.run.mockResolvedValue({ status: "uncertain", message: "Esito sintetico incerto." });
    const [attempt] = formAttempts();
    expect(attempt.props).toMatchObject({
      title: "Voce Finance da verificare",
      operationId: command().operationId,
      blocked: false,
      onDiscard: undefined,
      rereadLabel: "Rileggi il registro",
    });
    await retry(attempt);
    expect(mocks.run).toHaveBeenCalledWith({ ...command(), retry: true });
    expect(sessionStorage.setItem).toHaveBeenCalledWith(
      key,
      JSON.stringify({ ...command(), retry: true }),
    );
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(mocks.setters[0]).not.toHaveBeenCalledWith(null);
    expect(mocks.setters[7]).not.toHaveBeenCalled();
  });

  it("una connessione interrotta conserva il tentativo", async () => {
    mocks.states[0] = command();
    mocks.run.mockRejectedValue(Error("rete"));
    await retry(formAttempts()[0]);
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(mocks.setters[1]).toHaveBeenLastCalledWith(
      "Connessione interrotta: la voce potrebbe essere già registrata. Riprova lo stesso invio senza crearne uno nuovo.",
    );
    expect(mocks.setters[7]).not.toHaveBeenCalled();
  });

  it("idempotency_conflict blocca la verifica e solo allora offre «Scarta»", async () => {
    mocks.states[0] = command();
    mocks.run.mockResolvedValue({
      status: "rejected",
      code: "idempotency_conflict",
      message: "Conflitto sintetico.",
    });
    await retry(formAttempts()[0]);
    expect(mocks.setters[7]).toHaveBeenCalledWith(true);
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    mocks.states[7] = true;
    const [attempt] = formAttempts();
    expect(attempt.props.blocked).toBe(true);
    (attempt.props.onDiscard as () => void)();
    expect(sessionStorage.removeItem).toHaveBeenCalledTimes(1);
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(key);
    expect(mocks.setters[0]).toHaveBeenCalledWith(null);
    expect(mocks.setters[7]).toHaveBeenCalledWith(false);
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it("un altro rifiuto libera il modulo senza passare da «Scarta»", async () => {
    mocks.states[0] = command();
    mocks.run.mockResolvedValue({
      status: "rejected",
      code: "invalid_finance_payload",
      message: "Dati sintetici non validi.",
    });
    await retry(formAttempts()[0]);
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(key);
    expect(mocks.setters[0]).toHaveBeenCalledWith(null);
    expect(mocks.setters[7]).not.toHaveBeenCalled();
  });

  it("un tentativo illeggibile si può solo scartare", () => {
    mocks.states[3] = true;
    mocks.states[6] = true;
    const attempts = formAttempts();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].props).toMatchObject({
      title: "Invio Finance non leggibile",
      blocked: true,
      operationId: "non leggibile",
    });
    (attempts[0].props.onRetry as () => void)();
    expect(mocks.run).not.toHaveBeenCalled();
    (attempts[0].props.onDiscard as () => void)();
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(key);
    expect(mocks.setters[6]).toHaveBeenCalledWith(false);
    expect(mocks.setters[3]).toHaveBeenCalledWith(false);
  });
});

describe("«Invii Finance da verificare» fuori dal modulo", () => {
  const first = `luckylap.finance.work:${userId}:void:${workId(1)}`,
    second = `luckylap.finance.work:${userId}:void:${workId(2)}`,
    broken = `luckylap.finance.work:${userId}:void:${workId(3)}`;
  const saved = (overrides: Partial<{ unreadable: boolean; unreadableKeys: string[] }> = {}) => ({
    entries: [
      { key: first, scope: `void:${workId(1)}`, command: other() },
      { key: second, scope: `void:${workId(2)}`, command: { ...other(), operationId: workId(92) } },
    ],
    unreadable: false,
    unreadableKeys: [],
    ...overrides,
  });

  it("un esito incerto lascia il tentativo com'è, con lo stesso operation_id", async () => {
    mocks.states[0] = saved();
    mocks.run.mockResolvedValue({ status: "uncertain", message: "Esito sintetico incerto." });
    const attempts = recoveryAttempts();
    expect(attempts.map((attempt) => attempt.props.onDiscard)).toEqual([undefined, undefined]);
    await retry(attempts[0]);
    expect(mocks.run).toHaveBeenCalledWith({ ...other(), retry: true });
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(mocks.setters[2]).not.toHaveBeenCalled();
  });

  it("un conflitto blocca solo quel tentativo, e «Scarta» toglie solo la sua chiave", async () => {
    mocks.states[0] = saved();
    mocks.run.mockResolvedValue({
      status: "rejected",
      code: "idempotency_conflict",
      message: "Conflitto sintetico.",
    });
    await retry(recoveryAttempts()[0]);
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    const update = mocks.setters[2].mock.calls[0][0] as (current: string[]) => string[];
    expect(update([])).toEqual([first]);
    mocks.states[2] = [first];
    const [blocked, free] = recoveryAttempts();
    expect(blocked.props.blocked).toBe(true);
    expect(free.props).toMatchObject({ blocked: false, onDiscard: undefined });
    (blocked.props.onDiscard as () => void)();
    expect(sessionStorage.removeItem).toHaveBeenCalledTimes(1);
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(first);
    const drop = mocks.setters[2].mock.calls[0][0] as (current: string[]) => string[];
    expect(drop([first, second])).toEqual([second]);
  });

  it("un esito riuscito o un altro rifiuto toglie il tentativo e rilegge il registro", async () => {
    mocks.states[0] = saved();
    mocks.run.mockResolvedValue({
      status: "rejected",
      code: "finance_entry_not_found",
      message: "Voce sintetica assente.",
    });
    await retry(recoveryAttempts()[1]);
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(second);
    expect(sessionStorage.removeItem).not.toHaveBeenCalledWith(first);
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("un tentativo illeggibile si scarta solo se se ne conosce la chiave", () => {
    mocks.states[0] = { entries: [], unreadable: true, unreadableKeys: [broken] };
    const [attempt] = recoveryAttempts();
    expect(attempt.props).toMatchObject({ blocked: true, operationId: "non leggibile" });
    (attempt.props.onDiscard as () => void)();
    expect(sessionStorage.removeItem).toHaveBeenCalledTimes(1);
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(broken);
    mocks.states[0] = { entries: [], unreadable: true, unreadableKeys: [] };
    expect(recoveryAttempts()[0].props.onDiscard).toBeUndefined();
  });

  it("se la scheda non libera il tentativo lo dice", () => {
    mocks.states[0] = { entries: [], unreadable: true, unreadableKeys: [broken] };
    vi.mocked(sessionStorage.removeItem).mockImplementation(() => {
      throw Error("bloccato");
    });
    (recoveryAttempts()[0].props.onDiscard as () => void)();
    expect(mocks.setters[1]).toHaveBeenCalledWith(
      "Non riesco a liberare il tentativo conservato in questa scheda. Chiudi la scheda e riaprila.",
    );
  });
});
