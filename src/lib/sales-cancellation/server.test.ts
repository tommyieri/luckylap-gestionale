import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { executeSaleCancellation, readSaleCancellationPreview } from "./server";
import { executeSaleReturn, readSaleReturnPreview } from "../sales-returns/server";
const id = (n: number) => `94000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cancellation = {
  operationId: id(1),
  userId: id(2),
  orderId: id(3),
  expectedVersion: "a".repeat(64),
  reason: "Registrazione sintetica",
  confirmStock: true,
};
const returnBase = {
  userId: id(2),
  orderId: id(3),
  lines: [{ orderLineId: id(4), quantity: 2 }],
  reusableBoxes: 1,
  reusableStickers: 0,
  refundAccount: "Cash",
};
const returnCommand = {
  ...returnBase,
  operationId: id(1),
  expectedVersion: "a".repeat(64),
  occurredAt: "2026-03-17T10:00:00.000Z",
  reason: "Reso sintetico",
  refundCompletedConfirmed: true,
};
const cancellationPreview = {
  order_id: id(3),
  expected_version: "a".repeat(64),
  product_quantity: 2,
  box_quantity: 1,
  sticker_quantity: 0,
  payment_cents: "-543",
  already_cancelled: false,
};
const returnPreview = {
  order_id: id(3),
  expected_version: "a".repeat(64),
  lines: [
    {
      order_line_id: id(4),
      sku: "SYN-RETURN",
      available_quantity: 2,
      selected_quantity: 2,
      refund_cents: "543",
    },
  ],
  product_quantity: 2,
  box_quantity: 1,
  sticker_quantity: 0,
  refund_cents: "543",
  refundable_cents: "900",
  remaining_value_cents: "900",
};
const workflows = [
  {
    label: "annullo",
    execute: executeSaleCancellation,
    read: readSaleCancellationPreview,
    command: cancellation,
    previewInput: { userId: id(2), orderId: id(3) },
    preview: cancellationPreview,
    previewRpc: "preview_manual_sale_cancellation",
    writeRpc: "cancel_manual_sale_registration",
    conflict: "sale_cancellation_conflict",
  },
  {
    label: "reso",
    execute: executeSaleReturn,
    read: readSaleReturnPreview,
    command: returnCommand,
    previewInput: returnBase,
    preview: returnPreview,
    previewRpc: "preview_manual_sale_return",
    writeRpc: "return_manual_sale_registration",
    conflict: "sale_return_version_conflict",
  },
];
function fixture({ member = true, role = "logistics" } = {}) {
  const auth = {
    getUser: vi.fn().mockResolvedValue({
      data: { user: { id: id(2), user_metadata: { role: "founder" } } },
      error: null,
    }),
  };
  const from = vi.fn((table: string) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data:
        table === "memberships"
          ? member
            ? { user_id: id(2), role, active: true, finance_access: false }
            : null
          : { user_id: id(2), display_name: "Team sintetico" },
      error: null,
    }),
  }));
  const rpc = vi.fn().mockResolvedValue({
    data: { operation_id: id(1), order_id: id(3), replayed: false },
    error: null,
  });
  return { auth, from, rpc, client: { auth, from, rpc } as unknown as SupabaseClient };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-18T10:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());
for (const w of workflows)
  describe(`autorizzazione ed esiti ${w.label}`, () => {
    it.each(["logistics", "consultant", "production"])(
      "consente a %s senza sblocco Finance soltanto RPC circoscritta",
      async (role) => {
        const f = fixture({ role });
        expect(await w.execute(f.client, w.command)).toMatchObject({
          status: "success",
          orderId: id(3),
        });
        expect(f.auth.getUser).toHaveBeenCalledOnce();
        expect(f.rpc).toHaveBeenCalledOnce();
        expect(f.rpc.mock.calls[0][0]).toBe(w.writeRpc);
        expect(f.from.mock.calls.map((c) => c[0]).sort()).toEqual(["memberships", "profiles"]);
        expect(f.rpc.mock.calls[0][1]).toMatchObject({
          p_operation_id: id(1),
          p_payload: {
            schema_version: 1,
            order_id: id(3),
            expected_version: "a".repeat(64),
            reason: w.command.reason,
          },
        });
        expect(f.rpc.mock.calls[0][1].p_payload).not.toHaveProperty("userId");
      },
    );
    it("legge anteprima e ricontrolla account/membership a ogni nuovo invio", async () => {
      const f = fixture();
      f.rpc.mockResolvedValueOnce({ data: w.preview, error: null });
      expect((await w.read(f.client, w.previewInput)).status).toBe("ready");
      f.auth.getUser.mockResolvedValueOnce({ data: { user: { id: id(8) } }, error: null });
      expect(await w.execute(f.client, w.command)).toMatchObject({
        status: "rejected",
        code: "membership_required",
      });
      expect(f.auth.getUser).toHaveBeenCalledTimes(2);
      expect(f.rpc).toHaveBeenCalledOnce();
    });
    it("rifiuta non membro, logout e metadati founder senza chiamare il database operativo", async () => {
      const f = fixture({ member: false });
      expect((await w.read(f.client, w.previewInput)).status).toBe("rejected");
      expect((await w.execute(f.client, w.command)).status).toBe("rejected");
      f.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
      expect((await w.execute(f.client, w.command)).status).toBe("rejected");
      expect((await w.execute(f.client, { ...w.command, retry: true })).status).toBe("uncertain");
      expect(f.rpc).not.toHaveBeenCalled();
    });
    it("rifiuta input non valido prima di Auth/RPC e conserva il tentativo congelato", async () => {
      const f = fixture();
      expect(await w.execute(f.client, { ...w.command, expectedVersion: "bad" })).toMatchObject({
        status: "rejected",
        code: "invalid_payload",
      });
      expect(
        (await w.execute(f.client, { ...w.command, expectedVersion: "bad", retry: true })).status,
      ).toBe("uncertain");
      expect((await w.read(f.client, { ...w.previewInput, extra: true })).status).toBe("rejected");
      expect(f.auth.getUser).not.toHaveBeenCalled();
      expect(f.rpc).not.toHaveBeenCalled();
    });
    it("riconosce soltanto ricevute dello stesso tentativo e distingue replay", async () => {
      const f = fixture();
      f.rpc.mockResolvedValueOnce({
        data: { operation_id: id(1), order_id: id(3), replayed: true },
        error: null,
      });
      expect(await w.execute(f.client, { ...w.command, retry: true })).toMatchObject({
        status: "success",
        replayed: true,
      });
      for (const data of [
        null,
        { operation_id: id(9), order_id: id(3), replayed: false },
        { operation_id: id(1), order_id: id(9), replayed: false },
        { operation_id: id(1), order_id: id(3), replayed: "true" },
      ]) {
        f.rpc.mockResolvedValueOnce({ data, error: null });
        expect((await w.execute(f.client, w.command)).status).toBe("uncertain");
      }
    });
    it("espone conflitti conosciuti e nasconde errori interni/esiti di rete ambigui", async () => {
      const f = fixture();
      f.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: w.conflict } });
      expect(await w.execute(f.client, w.command)).toMatchObject({
        status: "rejected",
        code: w.conflict,
      });
      f.rpc.mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "PRIVATE-DATABASE-DETAIL" },
      });
      const unknown = await w.execute(f.client, w.command);
      expect(unknown.status).toBe("uncertain");
      expect(JSON.stringify(unknown)).not.toContain("PRIVATE-DATABASE-DETAIL");
      f.rpc.mockRejectedValueOnce(Error("PRIVATE-NETWORK-DETAIL"));
      const network = await w.execute(f.client, w.command);
      expect(network.status).toBe("uncertain");
      expect(JSON.stringify(network)).not.toContain("PRIVATE-NETWORK-DETAIL");
      f.rpc.mockResolvedValueOnce({
        data: null,
        error: { code: "42501", message: "membership_required" },
      });
      expect((await w.execute(f.client, { ...w.command, retry: true })).status).toBe("uncertain");
    });
    it("errore prima dell'invio resta rifiuto per un nuovo tentativo e incerto per il recupero", async () => {
      const f = fixture();
      f.auth.getUser.mockRejectedValue(Error("PRIVATE-AUTH-DETAIL"));
      const result = await w.execute(f.client, w.command);
      expect(result).toMatchObject({ status: "rejected", code: "unavailable" });
      expect(JSON.stringify(result)).not.toContain("PRIVATE-AUTH-DETAIL");
      expect((await w.execute(f.client, { ...w.command, retry: true })).status).toBe("uncertain");
      expect(f.rpc).not.toHaveBeenCalled();
    });
    it("rifiuta preview incomplete, di altro ordine o con quantità non concordate", async () => {
      const f = fixture();
      for (const data of [
        null,
        { ...w.preview, order_id: id(9) },
        { ...w.preview, expected_version: "bad" },
      ]) {
        f.rpc.mockResolvedValueOnce({ data, error: null });
        expect((await w.read(f.client, w.previewInput)).status).toBe("rejected");
      }
      if (w.label === "reso")
        for (const patch of [
          { box_quantity: 2 },
          { lines: [{ ...returnPreview.lines[0], selected_quantity: 1 }], product_quantity: 1 },
        ]) {
          f.rpc.mockResolvedValueOnce({ data: { ...returnPreview, ...patch }, error: null });
          expect((await w.read(f.client, w.previewInput)).status).toBe("rejected");
        }
      f.rpc.mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "PRIVATE-PREVIEW-DETAIL" },
      });
      const failed = await w.read(f.client, w.previewInput);
      expect(failed).toMatchObject({ status: "rejected", code: "unavailable" });
      expect(JSON.stringify(failed)).not.toContain("PRIVATE-PREVIEW-DETAIL");
    });
  });
