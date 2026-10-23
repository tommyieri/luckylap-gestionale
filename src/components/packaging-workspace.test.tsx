import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  refresh: vi.fn(),
  states: [] as unknown[],
  stateIndex: 0,
  transitions: [] as Promise<unknown>[],
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: () => {},
    useRef: (value: unknown) => ({ current: value }),
    useState: (value: unknown) => [
      mocks.stateIndex in mocks.states
        ? mocks.states[mocks.stateIndex++]
        : (mocks.stateIndex++, value),
      vi.fn(),
    ],
    useTransition: () => [
      false,
      (callback: () => unknown) => {
        mocks.transitions.push(Promise.resolve(callback()));
      },
    ],
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/packaging/actions", () => ({ updatePackaging: mocks.update }));
vi.mock("@/lib/stock/model", () => import("../lib/stock/model"));
vi.mock("@/lib/packaging/simple", () => import("../lib/packaging/simple"));
import { PackagingWorkspace } from "./packaging-workspace";
import { PendingAttempt } from "./pending-attempt";
const box = "00000000-0000-4000-8000-000000000001",
  sticker = "00000000-0000-4000-8000-000000000002",
  userId = "00000000-0000-4000-8000-000000000003",
  operationId = "00000000-0000-4000-8000-000000000004";
const snapshot = {
  enabled: true,
  loadedAt: "2026-10-21T15:00:00Z",
  startedAt: "2026-10-21T15:00:00Z",
  locationName: "Magazzino",
  failures: 0,
  items: [
    {
      id: box,
      name: "Scatola T-shirt",
      packagingType: "box" as const,
      specifications: "30 × 22,5 × 2,5 cm",
      onHand: 100,
      reserved: 2,
      unreserved: 98,
      deficit: 0,
      reconcilable: 0,
      historicalReview: 0,
    },
    {
      id: sticker,
      name: "Adesivo per scatola",
      packagingType: "sticker" as const,
      specifications: null,
      onHand: 100,
      reserved: 2,
      unreserved: 98,
      deficit: 0,
      reconcilable: 0,
      historicalReview: 0,
    },
  ],
};
const member = {
  userId,
  displayName: "Synthetic operator",
  role: "consultant" as const,
  financeAccess: false,
};
function descendants(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...[element.props.children].flat(Infinity).flatMap(descendants)];
}
function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return node && typeof node === "object" && "props" in node
    ? text((node as ReactElement<Record<string, unknown>>).props.children)
    : "";
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.stateIndex = 0;
  mocks.states = [];
  mocks.states[2] = true;
  mocks.transitions = [];
  vi.stubGlobal("sessionStorage", { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => operationId) });
  vi.stubGlobal(
    "FormData",
    class {
      get(name: string) {
        return name === "quantity" ? "101" : "Synthetic new delivery";
      }
    },
  );
});
describe("two material packaging workspace", () => {
  it("shows the two materials and their dimensions without creation wizard or cost guesses", () => {
    const tree = PackagingWorkspace({ snapshot, member }),
      copy = text(tree);
    expect(copy).toContain("Scatola T-shirt");
    expect(copy).toContain("Adesivo per scatola");
    expect(copy).toContain("30 × 22,5 × 2,5 cm");
    expect(copy).not.toContain("Nuovo materiale");
    expect(copy).not.toContain("SKU interno");
    expect(descendants(tree).filter((node) => node.type === "article")).toHaveLength(2);
  });
  it("two submits in one tick send one expected-quantity command", async () => {
    mocks.states[0] = box;
    let done!: (value: unknown) => void;
    mocks.update.mockReturnValue(
      new Promise((resolve) => {
        done = resolve;
      }),
    );
    const tree = PackagingWorkspace({ snapshot, member }),
      form = descendants(tree).find((node) => node.type === "form")!;
    const submit = form.props.onSubmit as (event: unknown) => void,
      event = { preventDefault: vi.fn(), currentTarget: {} };
    submit(event);
    submit(event);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      kind: "adjust",
      payload: { expected_quantity: 100, quantity: 101 },
    });
    done({ status: "uncertain", message: "Synthetic uncertain" });
    await Promise.all(mocks.transitions);
  });
  it("recovery reuses the frozen UUID and does not create a second operation", async () => {
    const frozen = { operationId, kind: "reconcile", payload: { schema_version: 1 } };
    mocks.states[1] = frozen;
    mocks.update.mockResolvedValue({ status: "uncertain", message: "Synthetic" });
    const tree = PackagingWorkspace({ snapshot, member }),
      attempt = descendants(tree).find((node) => node.type === PendingAttempt)!;
    expect(attempt.props).toMatchObject({
      title: "Registrazione da verificare",
      operationId,
      blocked: false,
      onDiscard: undefined,
    });
    (attempt.props.onRetry as () => void)();
    (attempt.props.onRetry as () => void)();
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith({ ...frozen, retry: true });
    expect(crypto.randomUUID).not.toHaveBeenCalled();
    await Promise.all(mocks.transitions);
  });
  it("riassume la quantità da verificare senza codici e scarta solo un tentativo in conflitto", () => {
    const frozen = {
      operationId,
      kind: "adjust",
      payload: {
        schema_version: 1,
        stock_item_id: box,
        expected_quantity: 100,
        quantity: 101,
        reason: "Synthetic new delivery",
      },
    };
    mocks.states[1] = frozen;
    let attempt = descendants(PackagingWorkspace({ snapshot, member })).find(
      (node) => node.type === PendingAttempt,
    )!;
    expect(attempt.props.lines).toEqual([
      "Scatola T-shirt",
      "Nuova quantità: 101",
      "Causale: Synthetic new delivery",
    ]);
    expect(JSON.stringify(attempt.props.lines)).not.toContain(box);
    expect(attempt.props.onDiscard).toBeUndefined();
    mocks.stateIndex = 0;
    mocks.states[7] = true;
    attempt = descendants(PackagingWorkspace({ snapshot, member })).find(
      (node) => node.type === PendingAttempt,
    )!;
    expect(attempt.props.blocked).toBe(true);
    (attempt.props.onDiscard as () => void)();
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(
      `luckylap.packaging.simple.pending:${userId}`,
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("un invio illeggibile si può solo scartare", () => {
    mocks.states[6] = true;
    const attempts = descendants(PackagingWorkspace({ snapshot, member })).filter(
      (node) => node.type === PendingAttempt,
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0].props).toMatchObject({ blocked: true, operationId: "non leggibile" });
    expect(typeof attempts[0].props.onDiscard).toBe("function");
  });
  it("makes a reservation shortage and consumption debt explicit", () => {
    const changed = {
      ...snapshot,
      items: snapshot.items.map((item) => ({
        ...item,
        onHand: 0,
        unreserved: -2,
        deficit: 3,
        reconcilable: 3,
      })),
    };
    const copy = text(PackagingWorkspace({ snapshot: changed, member }));
    expect(copy).toContain("Scatole e adesivi da scalare:  6");
    expect(copy).toContain("3  da scalare");
    expect(copy).not.toContain("riconciliare");
    expect(copy).toContain("Mancano 2");
    expect(copy).toContain("provvisorie");
  });
  it("does not display the authorized 100 count as already seeded before activation", () => {
    const copy = text(
      PackagingWorkspace({
        snapshot: { ...snapshot, startedAt: null, locationName: null, items: [] },
        member,
      }),
    );
    expect(copy).toContain("attivazione");
    expect(copy).not.toContain("100");
  });
});
