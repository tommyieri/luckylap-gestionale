import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  refresh: vi.fn(),
  states: [] as unknown[],
  index: 0,
  transitions: [] as Promise<unknown>[],
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: () => {},
    useRef: (value: unknown) => ({ current: value }),
    useState: (value: unknown) => [
      mocks.index in mocks.states ? mocks.states[mocks.index++] : (mocks.index++, value),
      vi.fn(),
    ],
    useTransition: () => [
      false,
      (callback: () => unknown) => mocks.transitions.push(Promise.resolve(callback())),
    ],
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("../app/consignment/actions", () => ({ runConsignmentCommand: mocks.run }));
import { ConsignmentWorkspace } from "./consignment-workspace";
import { consignmentFromRows } from "../lib/consignment/read";
import { consignmentRows, consignmentSaleRow, cs, saleCommand } from "../lib/consignment/fixtures";
function descendants(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const e = node as ReactElement<Record<string, unknown>>;
  return [e, ...[e.props.children].flat(Infinity).flatMap(descendants)];
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.states = [];
  mocks.index = 0;
  mocks.transitions = [];
  mocks.states[8] = true;
  vi.stubGlobal("sessionStorage", { setItem: vi.fn(), removeItem: vi.fn(), getItem: vi.fn() });
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => cs.operation) });
  const fields: Record<string, string> = {
    occurredAt: "2026-10-21T13:00",
    quantity: "1",
    reason: "Synthetic movement",
    reference: "SYN-REFERENCE",
    method: "bank_transfer",
    amount: "10,00",
  };
  vi.stubGlobal(
    "FormData",
    class {
      get(name: string) {
        return fields[name] ?? null;
      }
    },
  );
});
describe("one synchronous lock across all consignment forms", () => {
  it("shows only the current Magadzino/LCM names in selectors and movement records", () => {
    const rows = consignmentRows();
    for (const raw of rows.locations) {
      const r = raw as Record<string, unknown>;
      r.code = r.id === cs.central ? "MAG01" : "NEG01";
      r.name = r.id === cs.central ? "Magadzino" : "LCM";
    }
    rows.sales = [consignmentSaleRow()];
    rows.transfers = [
      {
        id: cs.operation,
        stock_item_id: cs.item,
        from_location_id: cs.central,
        to_location_id: cs.shop,
        quantity: 1,
        reason: "Synthetic transfer",
        occurred_at: cs.at,
      },
    ];
    const tree = ConsignmentWorkspace({
      snapshot: consignmentFromRows(rows),
      member: { userId: cs.user, displayName: "Synthetic", role: "founder", financeAccess: true },
    });
    const visible = descendants(tree)
      .flatMap((e) =>
        [e.props.children].flat(Infinity).filter((value) => typeof value === "string"),
      )
      .join(" ");
    expect(visible).toContain("Magadzino");
    expect(visible).toContain("LCM");
    expect(visible).not.toMatch(/MAG01|NEG01/);
  });
  it.each(["transfer", "sale", "settlement"] as const)(
    "two %s submits before React rerender create one UUID and one request",
    async (mode) => {
      const rows = consignmentRows();
      rows.sales = [consignmentSaleRow()];
      rows.settlements = [];
      const snapshot = consignmentFromRows(rows);
      mocks.states[0] = mode;
      mocks.states[1] = cs.item;
      mocks.states[2] = cs.central;
      mocks.states[3] = cs.shop;
      mocks.states[4] = cs.shop;
      mocks.states[5] = cs.sale;
      let resolve!: (value: unknown) => void;
      mocks.run.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const tree = ConsignmentWorkspace({
        snapshot,
        member: { userId: cs.user, displayName: "Synthetic", role: "founder", financeAccess: true },
      });
      const form = descendants(tree).find((e) => e.type === "form")!;
      const submit = form.props.onSubmit as (e: unknown) => void;
      const event = { preventDefault: vi.fn(), currentTarget: {} };
      submit(event);
      submit(event);
      expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
      expect(mocks.run).toHaveBeenCalledTimes(1);
      expect(sessionStorage.setItem).toHaveBeenCalledTimes(1);
      resolve({ status: "uncertain", message: "Synthetic uncertain" });
      await Promise.all(mocks.transitions);
    },
  );
  it("keeps recovery visible after a sale has consumed every unit and the write flags close", async () => {
    const rows = consignmentRows();
    rows.settings = {
      stock_adjustments_enabled: false,
      manual_sales_enabled: false,
      sales_started_at: cs.at,
    };
    rows.sales = [consignmentSaleRow()];
    mocks.states[7] = saleCommand();
    mocks.run.mockResolvedValue({
      status: "success",
      operationId: cs.operation,
      replayed: true,
      message: "Synthetic replay",
    });
    const tree = ConsignmentWorkspace({
      snapshot: consignmentFromRows(rows),
      member: {
        userId: cs.user,
        displayName: "Synthetic",
        role: "consultant",
        financeAccess: false,
      },
    });
    const button = descendants(tree).find(
      (e) => e.type === "button" && e.props.children === "Verifica lo stesso invio",
    )!;
    expect(button.props.disabled).toBe(false);
    const click = button.props.onClick as () => void;
    click();
    click();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledWith({ ...saleCommand(), retry: true });
    expect(crypto.randomUUID).not.toHaveBeenCalled();
    await Promise.all(mocks.transitions);
  });
});
