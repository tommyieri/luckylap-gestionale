import { describe, it, expect } from "vitest";
import { parsePartnerWork, preparationWork } from "./work-model";
import type { SalesOrder, SalesLine } from "../sales/model";
const id = "00000000-0000-4000-8000-000000000001";
const order = (quantity: number, fulfilled: number, cancelled: number): SalesOrder => ({
  id,
  operationId: id,
  source: "manual_declaration",
  channel: "cash",
  reference: null,
  occurredAt: "2026-10-22T10:00Z",
  totalCents: 0,
  cancelledCents: 0,
  refundDueCents: 0,
  paymentState: "paid",
  fulfillmentState: "partial",
  orderState: "open",
  lines: [{ quantity, fulfilled, cancelled } as SalesLine],
});
describe("Oggi lavoro operativo", () => {
  it("subtracts delivered and cancelled quantities without hiding an unpaid order", () => {
    expect(preparationWork([order(10, 3, 2), order(4, 4, 0)])).toMatchObject({
      orderCount: 1,
      quantity: 5,
      orders: [{ quantity: 5 }],
    });
  });
  it("rejects inconsistent quantities instead of showing a reassuring zero", () => {
    expect(() => preparationWork([order(2, 3, 0)])).toThrow();
  });
  it("counts the whole set while limiting readable links", () => {
    expect(
      preparationWork(Array.from({ length: 12 }, (_, i) => ({ ...order(1, 0, 0), id: String(i) }))),
    ).toMatchObject({ orderCount: 12, quantity: 12 });
    expect(preparationWork(Array.from({ length: 12 }, () => order(1, 0, 0))).orders).toHaveLength(
      8,
    );
  });
  it("accepts empty complete work and rejects truncated or malformed data", () => {
    expect(
      parsePartnerWork({ contact_count: 0, contacts: [], reminder_count: 0, reminders: [] }),
    ).toEqual({ contactCount: 0, contacts: [], reminderCount: 0, reminders: [] });
    expect(() =>
      parsePartnerWork({ contact_count: 1, contacts: [], reminder_count: 0, reminders: [] }),
    ).toThrow();
  });
  it("projects allowlisted fields and rejects a false calendar date", () => {
    const raw = {
      contact_count: 1,
      contacts: [
        {
          id,
          co: 42,
          name: "Synthetic partner",
          next_action: "Chiamare",
          next_action_on: "2026-10-22",
          owner_name: null,
          private_contact: "secret",
        },
      ],
      reminder_count: 0,
      reminders: [],
    };
    expect(JSON.stringify(parsePartnerWork(raw))).not.toContain("secret");
    expect(() =>
      parsePartnerWork({
        ...raw,
        contacts: [{ ...raw.contacts[0], next_action_on: "2026-02-30" }],
      }),
    ).toThrow();
  });
  it("reads the reminder's partner for «Ha risposto», and tolerates its absence", () => {
    const reminder = {
      id,
      co: 42,
      title: "Sollecito · Synthetic partner",
      due_at: "2026-10-20T22:00:00+00:00",
    };
    const parse = (extra: Record<string, unknown>) =>
      parsePartnerWork({
        contact_count: 0,
        contacts: [],
        reminder_count: 1,
        reminders: [{ ...reminder, ...extra }],
      }).reminders[0].partnerId;
    expect(parse({ partner_id: "00000000-0000-4000-8000-000000000042" })).toBe(
      "00000000-0000-4000-8000-000000000042",
    );
    expect(parse({})).toBeNull();
    expect(() => parse({ partner_id: "not-a-uuid" })).toThrow();
  });
});
