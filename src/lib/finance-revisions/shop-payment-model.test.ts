import { describe, expect, it } from "vitest";
import {
  buildShopPaymentFinanceCommand,
  type ShopPaymentFinanceHistory,
} from "./shop-payment-model";
import { parseShopCommand, postedShopPaymentCents } from "../consignment/shop-model";
const id = "81000000-0000-4000-8000-000000000001",
  report = "81000000-0000-4000-8000-000000000002";
const original = {
  version: 1,
  amountCents: 1200,
  paidAt: "2026-03-28T10:22:33.123456Z",
  method: "bank_transfer" as const,
  accountLabel: "Cash",
  reference: "Riferimento sintetico",
  voided: false,
  direction: "income" as const,
  category: "Vendite",
  description: "Incasso sintetico",
  pending: false,
  reason: null,
  createdBy: id,
  createdAt: "2026-03-28T10:22:33Z",
};
const current = {
  ...original,
  version: 2,
  direction: "expense" as const,
  pending: true,
  reason: "Correzione sintetica",
};
const history: ShopPaymentFinanceHistory = {
  paymentId: id,
  reportId: report,
  locationId: id,
  version: 2,
  current,
  revisions: [original, current],
};
const base = { history, reason: "Motivo sintetico", operationId: id };
describe("correzione Finance usa il pagamento P3 canonico", () => {
  it("congela tutti i campi in un singolo update P3 e conserva timestamp, metodo e riferimento", () => {
    const command = buildShopPaymentFinanceCommand({
      ...base,
      action: "update",
      values: {
        date: "2026-03-28",
        direction: "expense",
        amountCents: 1400,
        account: "Cash",
        category: "Others",
        description: "Correzione sintetica",
        pending: true,
      },
    })!;
    expect(command.kind).toBe("update_consignment_payment");
    expect(command.payload).toMatchObject({
      payment_id: id,
      expected_version: 2,
      paid_at: original.paidAt,
      method: original.method,
      reference: original.reference,
      amount_cents: 1400,
      finance: {
        direction: "expense",
        category: "Others",
        description: "Correzione sintetica",
        pending: true,
      },
    });
    expect(parseShopCommand(command)).toEqual(command);
  });
  it("una data diversa usa mezzogiorno Roma, compreso il cambio ora legale", () => {
    const command = buildShopPaymentFinanceCommand({
      ...base,
      action: "update",
      values: {
        date: "2026-03-29",
        direction: "income",
        amountCents: 0,
        account: null,
        category: null,
        description: "",
        pending: false,
      },
    })!;
    expect(command.payload.paid_at).toBe("2026-03-29T10:00:00.000Z");
    expect(command.payload.amount_cents).toBe(0);
  });
  it("elimina e ripristina dalla stessa storia con expected_version attuale", () => {
    const deleted = buildShopPaymentFinanceCommand({ ...base, action: "delete" })!;
    expect(deleted.payload).toMatchObject({
      expected_version: 2,
      voided: true,
      finance: { direction: "expense", pending: true },
    });
    const restored = buildShopPaymentFinanceCommand({
      ...base,
      action: "restore",
      restoreVersion: 1,
    })!;
    expect(restored.payload).toMatchObject({
      expected_version: 2,
      amount_cents: 1200,
      voided: false,
      paid_at: original.paidAt,
      finance: { direction: "income", pending: false },
    });
    expect(
      buildShopPaymentFinanceCommand({ ...base, action: "restore", restoreVersion: 7 }),
    ).toBeNull();
  });
  it("un payload P3 senza metadati rimane identico e quello Finance rifiuta campi inattesi", () => {
    const command = buildShopPaymentFinanceCommand({ ...base, action: "delete" })!;
    const { finance, ...legacy } = command.payload;
    expect(parseShopCommand({ ...command, payload: legacy })?.payload).toEqual(legacy);
    expect(
      parseShopCommand({
        ...command,
        payload: { ...command.payload, finance: { ...finance, rawSecret: "x" } },
      }),
    ).toBeNull();
  });
  it("netto operativo esclude pending, futuro e annullati e sottrae le uscite", () => {
    const payment = {
      amountCents: 1200,
      paidAt: "2026-03-28T10:00Z",
      voided: false,
      finance: { direction: "expense" as const, category: null, description: "", pending: false },
    };
    expect(postedShopPaymentCents(payment, "2026-03-28")).toBe(-1200n);
    expect(
      postedShopPaymentCents(
        { ...payment, finance: { ...payment.finance, pending: true } },
        "2026-03-28",
      ),
    ).toBe(0n);
    expect(postedShopPaymentCents({ ...payment, voided: true }, "2026-03-28")).toBe(0n);
    expect(postedShopPaymentCents(payment, "2026-03-27")).toBe(0n);
  });
});
