import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), execute: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./server", () => ({ financeRevisionAccess: mocks.access }));
vi.mock("../consignment/shop-server", () => ({ executeShopCommand: mocks.execute }));
import {
  loadShopPaymentFinanceHistory,
  executeShopPaymentFinanceCommand,
} from "./shop-payment-server";
import { withCurrentShopPaymentStates } from "./shop-payment-states";
import { buildShopPaymentFinanceCommand } from "./shop-payment-model";
const id = "81000000-0000-4000-8000-000000000001",
  report = "81000000-0000-4000-8000-000000000002",
  location = "81000000-0000-4000-8000-000000000003";
const base = {
  report_id: report,
  amount_cents: 1500,
  paid_at: "2026-03-28T10:22:33.123456Z",
  method: "cash",
  account_label: "Cash",
  reference: null,
  voided: false,
};
const head = () => ({
  id,
  location_id: location,
  ...base,
  version: 1,
  finance_direction: "income",
  finance_category: "Vendite",
  finance_description: "Incasso conto vendita",
  finance_pending: false,
  updated_by: id,
  updated_at: "2026-03-28T10:22:33Z",
});
const revision = () => ({
  id,
  payment_id: id,
  location_id: location,
  version: 1,
  reason: null,
  snapshot: { ...base },
  created_by: id,
  created_at: "2026-03-28T10:22:33Z",
});
function db(current: Record<string, unknown> = head(), revisions: unknown[] = [revision()]) {
  return {
    from: vi.fn((table: string) => {
      const q: Record<string, unknown> = {};
      for (const name of ["select", "eq", "order"]) q[name] = () => q;
      q.maybeSingle = async () => ({ data: current, error: null });
      q.range = async () => ({ data: revisions, count: revisions.length, error: null });
      if (!["consignment_report_payments", "consignment_payment_revisions"].includes(table))
        throw Error("Unexpected table");
      return q;
    }),
  };
}
beforeEach(() => {
  mocks.access.mockReset().mockResolvedValue(true);
  mocks.execute.mockReset().mockResolvedValue({ status: "uncertain", message: "Sintetico" });
});
describe("storia e comando canonici P3 da Finance", () => {
  it("nega prima delle query e non usa letture amministrative", async () => {
    const client = db();
    mocks.access.mockResolvedValue(false);
    await expect(loadShopPaymentFinanceHistory(client as never, id)).rejects.toThrow();
    expect(client.from).not.toHaveBeenCalled();
  });
  it("legge la prima snapshot precedente all’estensione senza inventare un secondo ledger", async () => {
    const client = db(),
      history = await loadShopPaymentFinanceHistory(client as never, id);
    expect(history).toMatchObject({
      paymentId: id,
      reportId: report,
      version: 1,
      current: { amountCents: 1500, direction: "income", pending: false },
      revisions: [{ version: 1 }],
    });
    expect(client.from.mock.calls.map((c) => c[0]).sort()).toEqual([
      "consignment_payment_revisions",
      "consignment_report_payments",
    ]);
  });
  it("fallisce su storia mancante o snapshot differente anche di un microsecondo", async () => {
    await expect(loadShopPaymentFinanceHistory(db(head(), []) as never, id)).rejects.toThrow();
    const changed = revision();
    changed.snapshot.paid_at = "2026-03-28T10:22:33.123457Z";
    await expect(
      loadShopPaymentFinanceHistory(db(head(), [changed]) as never, id),
    ).rejects.toThrow();
  });
  it("delega l’esatto comando frozen e consente vecchi payload solo in recovery", async () => {
    const client = db(),
      history = await loadShopPaymentFinanceHistory(client as never, id),
      command = buildShopPaymentFinanceCommand({
        history,
        action: "delete",
        reason: "Motivo sintetico",
        operationId: id,
      })!;
    await executeShopPaymentFinanceCommand(client as never, command);
    expect(mocks.execute).toHaveBeenLastCalledWith(client, command);
    const { finance, ...legacy } = command.payload;
    const old = { ...command, payload: legacy };
    expect((await executeShopPaymentFinanceCommand(client as never, old)).status).toBe("rejected");
    await executeShopPaymentFinanceCommand(client as never, { ...old, retry: true });
    expect(mocks.execute).toHaveBeenLastCalledWith(client, { ...old, retry: true });
  });
  it("lo stato corrente per tutti i membri non accetta importi o dati Finance nel DTO", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [{ report_id: report, payment_state: "unpaid" }], error: null });
    expect(
      await withCurrentShopPaymentStates({ rpc } as never, [{ id: report, payment_state: "paid" }]),
    ).toEqual([{ id: report, payment_state: "unpaid" }]);
    rpc.mockResolvedValue({
      data: [{ report_id: report, payment_state: "unpaid", net_cents: "1500" }],
      error: null,
    });
    await expect(
      withCurrentShopPaymentStates({ rpc } as never, [{ id: report }]),
    ).rejects.toThrow();
  });
});
