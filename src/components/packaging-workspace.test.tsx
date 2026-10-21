import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const mocks = vi.hoisted(() => ({ create: vi.fn(), count: vi.fn(), refresh: vi.fn(), states: [] as unknown[], stateIndex: 0, transitions: [] as Promise<unknown>[] }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useEffect: () => {}, useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [mocks.stateIndex in mocks.states ? mocks.states[mocks.stateIndex++] : (mocks.stateIndex++, value), vi.fn()], useTransition: () => [false, (callback: () => unknown) => { mocks.transitions.push(Promise.resolve(callback())); }] };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/packaging/actions", () => ({ createPackagingMaterial: mocks.create, initializePackagingCount: mocks.count }));
vi.mock("@/lib/stock/model", () => import("../lib/stock/model"));
vi.mock("@/lib/packaging/model", () => import("../lib/packaging/model"));
import { PackagingWorkspace } from "./packaging-workspace";
const itemId = "00000000-0000-4000-8000-000000000001", locationId = "00000000-0000-4000-8000-000000000002", userId = "00000000-0000-4000-8000-000000000003", operationId = "00000000-0000-4000-8000-000000000004";
const snapshot = { enabled: true, loadedAt: "2026-10-21T10:00:00Z", items: [{ id: itemId, sku: "SYN-BOX", name: "Synthetic box", active: true, packagingType: "box" as const, specifications: null, unitCostCents: null }], locations: [{ id: locationId, code: "TEST", name: "Synthetic location", active: true }], availability: [{ itemId, locationId, onHand: null, reserved: 0, available: null }] };
function descendants(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...[element.props.children].flat(Infinity).flatMap(descendants)];
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.stateIndex = 0; mocks.states = []; mocks.states[5] = true; mocks.transitions = [];
  vi.stubGlobal("sessionStorage", { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => operationId) });
  const fields: Record<string, string> = { name: "Synthetic box", sku: "SYN-BOX", packagingType: "box", specifications: "", cost: "", location: locationId, initialQuantity: "", quantity: "0", reason: "Synthetic count" };
  vi.stubGlobal("FormData", class { get(name: string) { return fields[name] ?? null; } });
});
describe("synchronous packaging submission lock", () => {
  it.each(["create", "count"] as const)("two %s submits in one tick allocate one UUID and send one mutation", async mode => {
    mocks.states[0] = mode; mocks.states[1] = itemId; mocks.states[2] = locationId;
    let resolve!: (value: unknown) => void;
    const request = new Promise(done => { resolve = done; });
    const action = mode === "create" ? mocks.create : mocks.count; action.mockReturnValue(request);
    const tree = PackagingWorkspace({ snapshot, member: { userId, displayName: "Synthetic member", role: "consultant", financeAccess: false } });
    const form = descendants(tree).find(element => element.type === "form")!;
    const submit = form.props.onSubmit as (event: unknown) => void;
    const event = { preventDefault: vi.fn(), currentTarget: {} };
    submit(event); submit(event);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1); expect(action).toHaveBeenCalledTimes(1); expect(sessionStorage.setItem).toHaveBeenCalledTimes(1);
    resolve({ status: "uncertain", message: "Synthetic response" }); await Promise.all(mocks.transitions);
  });
  it("two recovery clicks in one tick reuse one frozen command and send once", async () => {
    const command = { kind: "create", command: { operationId, payload: { schema_version: 1, name: "Synthetic box", sku: "SYN-BOX", packaging_type: "box", specifications: null, unit_cost_cents: null, location_id: locationId, initial_quantity: null } } };
    mocks.states[4] = command; mocks.create.mockResolvedValue({ status: "uncertain", message: "Synthetic" });
    const tree = PackagingWorkspace({ snapshot, member: { userId, displayName: "Synthetic member", role: "consultant", financeAccess: false } });
    const button = descendants(tree).find(element => element.type === "button" && element.props.children === "Verifica lo stesso invio")!;
    const click = button.props.onClick as () => void; click(); click();
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.create).toHaveBeenCalledWith({ ...command.command, retry: true }); expect(crypto.randomUUID).not.toHaveBeenCalled();
    await Promise.all(mocks.transitions);
  });
});
