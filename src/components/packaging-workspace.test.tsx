import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const mocks = vi.hoisted(() => ({ update: vi.fn(), refresh: vi.fn(), states: [] as unknown[], stateIndex: 0, transitions: [] as Promise<unknown>[] }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useEffect: () => {}, useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [mocks.stateIndex in mocks.states ? mocks.states[mocks.stateIndex++] : (mocks.stateIndex++, value), vi.fn()], useTransition: () => [false, (callback: () => unknown) => { mocks.transitions.push(Promise.resolve(callback())); }] };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/packaging/actions", () => ({ updatePackaging: mocks.update }));
vi.mock("@/lib/stock/model", () => import("../lib/stock/model"));
vi.mock("@/lib/packaging/simple", () => import("../lib/packaging/simple"));
import { PackagingWorkspace } from "./packaging-workspace";
const box = "00000000-0000-4000-8000-000000000001", sticker = "00000000-0000-4000-8000-000000000002", userId = "00000000-0000-4000-8000-000000000003", operationId = "00000000-0000-4000-8000-000000000004";
const snapshot = { enabled: true, loadedAt: "2026-10-21T15:00:00Z", startedAt: "2026-10-21T15:00:00Z", locationName: "Magazzino", failures: 0, items: [{ id: box, name: "Scatola T-shirt", packagingType: "box" as const, specifications: "30 × 22,5 × 2,5 cm", onHand: 100, reserved: 2, unreserved: 98, deficit: 0, reconcilable: 0, historicalReview: 0 }, { id: sticker, name: "Adesivo per scatola", packagingType: "sticker" as const, specifications: null, onHand: 100, reserved: 2, unreserved: 98, deficit: 0, reconcilable: 0, historicalReview: 0 }] };
const member = { userId, displayName: "Synthetic operator", role: "consultant" as const, financeAccess: false };
function descendants(node: unknown): ReactElement<Record<string, unknown>>[] { if (!node || typeof node !== "object" || !("props" in node)) return []; const element = node as ReactElement<Record<string, unknown>>; return [element, ...[element.props.children].flat(Infinity).flatMap(descendants)]; }
function text(node: unknown): string { if (typeof node === "string" || typeof node === "number") return String(node); if (Array.isArray(node)) return node.map(text).join(" "); return node && typeof node === "object" && "props" in node ? text((node as ReactElement<Record<string, unknown>>).props.children) : ""; }
beforeEach(() => { vi.clearAllMocks(); mocks.stateIndex = 0; mocks.states = []; mocks.states[2] = true; mocks.transitions = []; vi.stubGlobal("sessionStorage", { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() }); vi.stubGlobal("crypto", { randomUUID: vi.fn(() => operationId) }); vi.stubGlobal("FormData", class { get(name: string) { return name === "quantity" ? "101" : "Synthetic new delivery"; } }); });
describe("two material packaging workspace", () => {
  it("shows the two materials and their dimensions without creation wizard or cost guesses", () => {
    const tree = PackagingWorkspace({ snapshot, member }), copy = text(tree);
    expect(copy).toContain("Scatola T-shirt"); expect(copy).toContain("Adesivo per scatola"); expect(copy).toContain("30 × 22,5 × 2,5 cm"); expect(copy).not.toContain("Nuovo materiale"); expect(copy).not.toContain("SKU interno");
    expect(descendants(tree).filter(node => node.type === "article")).toHaveLength(2);
  });
  it("two submits in one tick send one expected-quantity command", async () => {
    mocks.states[0] = box; let done!: (value: unknown) => void; mocks.update.mockReturnValue(new Promise(resolve => { done = resolve; }));
    const tree = PackagingWorkspace({ snapshot, member }), form = descendants(tree).find(node => node.type === "form")!;
    const submit = form.props.onSubmit as (event: unknown) => void, event = { preventDefault: vi.fn(), currentTarget: {} }; submit(event); submit(event);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1); expect(mocks.update).toHaveBeenCalledTimes(1); expect(mocks.update.mock.calls[0][0]).toMatchObject({ kind: "adjust", payload: { expected_quantity: 100, quantity: 101 } });
    done({ status: "uncertain", message: "Synthetic uncertain" }); await Promise.all(mocks.transitions);
  });
  it("recovery reuses the frozen UUID and does not create a second operation", async () => {
    const frozen = { operationId, kind: "reconcile", payload: { schema_version: 1 } }; mocks.states[1] = frozen; mocks.update.mockResolvedValue({ status: "uncertain", message: "Synthetic" });
    const tree = PackagingWorkspace({ snapshot, member }), button = descendants(tree).find(node => node.type === "button" && text(node) === "Verifica lo stesso invio")!;
    (button.props.onClick as () => void)(); (button.props.onClick as () => void)(); expect(mocks.update).toHaveBeenCalledOnce(); expect(mocks.update).toHaveBeenCalledWith({ ...frozen, retry: true }); expect(crypto.randomUUID).not.toHaveBeenCalled(); await Promise.all(mocks.transitions);
  });
  it("makes a reservation shortage and consumption debt explicit", () => {
    const changed = { ...snapshot, items: snapshot.items.map(item => ({ ...item, onHand: 0, unreserved: -2, deficit: 3, reconcilable: 3 })) };
    const copy = text(PackagingWorkspace({ snapshot: changed, member })); expect(copy).toContain("Consumi da riconciliare:  6"); expect(copy).toContain("Mancano 2"); expect(copy).toContain("provvisorie");
  });
  it("does not display the authorized 100 count as already seeded before activation", () => {
    const copy = text(PackagingWorkspace({ snapshot: { ...snapshot, startedAt: null, locationName: null, items: [] }, member })); expect(copy).toContain("attivazione"); expect(copy).not.toContain("100");
  });
});
