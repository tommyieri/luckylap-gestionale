import { describe, expect, it } from "vitest";
import {
  parseFinanceRevisionCommand,
  revisionFromDatabase,
  revisionOriginalFromDatabase,
  financeRevisionTarget,
} from "./model";
const id = (n: number) => `84000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const values = {
  date: "2026-03-17",
  direction: "income",
  amount_cents: 1234,
  account: "Cash",
  target_account: null,
  category: "Vendite",
  description: "Synthetic",
  pending: false,
};
const command = () => ({
  operationId: id(1),
  payload: {
    schema_version: 1,
    source_kind: "payment",
    source_id: id(2),
    expected_version: 0,
    action: "update",
    reason: "Synthetic reason",
    values,
  },
});
describe("Finance revision command contract", () => {
  it("freezes normalized values, source and version; future dates and zero remain explicit", () => {
    expect(parseFinanceRevisionCommand(command())?.payload).toMatchObject({
      source_id: id(2),
      expected_version: 0,
    });
    expect(
      parseFinanceRevisionCommand({
        ...command(),
        payload: {
          ...command().payload,
          values: {
            ...values,
            amount_cents: 0,
            date: "2099-01-01",
            account: " Cash ",
            description: " Synthetic ",
          },
        },
      })?.payload,
    ).toMatchObject({
      values: { amount_cents: 0, date: "2099-01-01", account: "Cash", description: "Synthetic" },
    });
  });
  it("rejects arbitrary source kinds, forged fields, malformed dates/cents and payment transfers", () => {
    for (const payload of [
      { ...command().payload, source_kind: "shop_payment" },
      { ...command().payload, source_id: "fake" },
      { ...command().payload, expected_version: -1 },
      { ...command().payload, additional: true },
      ...[
        { amount_cents: 1.001 },
        { amount_cents: -1 },
        { amount_cents: 9_000_000_000_000_001 },
        { date: "2026-02-30" },
        { pending: "false" },
        { target_account: "Other account" },
      ].map((changes) => ({ ...command().payload, values: { ...values, ...changes } })),
    ])
      expect(parseFinanceRevisionCommand({ ...command(), payload })).toBeNull();
  });
  it("normalizes only the two established account aliases before transfer validation", () => {
    const budgetflow = (account: string, target_account: string | null = null) => ({
      ...command(),
      payload: {
        ...command().payload,
        source_kind: "budgetflow",
        values: { ...values, account, target_account },
      },
    });
    expect(parseFinanceRevisionCommand(budgetflow("Cash", "cash"))).toBeNull();
    expect(
      parseFinanceRevisionCommand(budgetflow("cash", " REVOLUT BUSINESS "))?.payload,
    ).toMatchObject({
      values: { account: "Cash", target_account: "Revolut Business" },
    });
    expect(
      parseFinanceRevisionCommand(budgetflow("Custom bank", "custom bank"))?.payload,
    ).toMatchObject({
      values: { account: "Custom bank", target_account: "custom bank" },
    });
  });
  it("supports full delete and restore but refuses a restore beyond the expected version", () => {
    const payload = {
      schema_version: 1,
      source_kind: "manual",
      source_id: id(2),
      expected_version: 3,
      action: "delete",
      reason: "Synthetic deletion",
    };
    expect(parseFinanceRevisionCommand({ operationId: id(1), payload })?.payload.action).toBe(
      "delete",
    );
    expect(
      parseFinanceRevisionCommand({
        operationId: id(1),
        payload: { ...payload, action: "restore", restore_version: 0 },
      })?.payload.action,
    ).toBe("restore");
    expect(
      parseFinanceRevisionCommand({
        operationId: id(1),
        payload: { ...payload, action: "restore", restore_version: 4 },
      }),
    ).toBeNull();
  });
  it("routes monthly shop payments to the sole P3 CAS command", () => {
    expect(financeRevisionTarget("shop_payment", id(2))).toEqual({
      type: "consignment-payment",
      paymentId: id(2),
      command: "update_consignment_payment",
    });
    expect(financeRevisionTarget("consignment", id(2))).toMatchObject({
      ref: { sourceKind: "consignment_settlement", sourceId: id(2) },
    });
  });
  it("validates complete revision snapshots and preserves database microseconds", () => {
    const row = {
      id: id(3),
      operation_id: id(1),
      source_kind: "payment",
      source_id: id(2),
      version: 1,
      previous_version: 0,
      action: "update",
      restored_from_version: null,
      value_snapshot: values,
      deleted: false,
      reason: "Synthetic",
      created_by: id(4),
      created_at: "2026-03-17T12:30:00.123456Z",
    };
    expect(revisionFromDatabase(row)?.createdAt).toBe(row.created_at);
    expect(revisionFromDatabase({ ...row, deleted: true })).toBeNull();
    expect(revisionFromDatabase({ ...row, previous_version: 1 })).toBeNull();
    expect(
      revisionOriginalFromDatabase({
        source_kind: "payment",
        source_id: id(2),
        values,
        deleted: false,
        order_id: id(5),
      })?.values.amountCents,
    ).toBe(1234);
  });
});
