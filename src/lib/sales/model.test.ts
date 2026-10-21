import { describe, expect, it } from "vitest";
import { euroCents, parseSalesCommand, romeInputToIso, romeTimeInput } from "./model";
import { syntheticSale } from "./fixtures";

describe("exact EUR input", () => {
  it.each([["0", 0], ["40,01", 4001], [" 13.2 ", 1320], ["9999999,99", 999999999]])("parses %s without floating point arithmetic", (input, cents) => expect(euroCents(input)).toBe(cents));
  it.each(["1.001", "1.000,00", "1,000.00", "-1", "+1", "1e3", "01", "NaN", "Infinity", "", null, 1])("rejects ambiguous/nondecimal input", input => expect(euroCents(input)).toBeNull());
  it("enforces the server price cap and safe cent range", () => {
    expect(euroCents("10000000.01", 1000000000)).toBeNull();
    expect(euroCents("90000000000000.01")).toBeNull();
  });
});
describe("sales command input", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  it("accepts a direct manual order and preserves its operation and payload", () => {
    const command = syntheticSale(); expect(parseSalesCommand(command, now)).toEqual({ ...command, retry: false });
    expect(parseSalesCommand({ ...command, retry: true }, now)?.operationId).toBe(command.operationId);
  });
  it.each(["shopify", "shopify_pos", "cash", ["direct"]])("rejects unsupported manual channels", channel => {
    const command = syntheticSale(); expect(parseSalesCommand({ ...command, payload: { ...command.payload, channel } }, now)).toBeNull();
  });
  it("rejects client costs, duplicate SKUs, fractional quantities, mismatched payments, future and impossible dates", () => {
    const command = syntheticSale(), line = command.payload.lines[0];
    for (const lines of [[{ ...line, unit_cost_cents: 1 }], [line, line], [{ ...line, quantity: 1.5 }]]) expect(parseSalesCommand({ ...command, payload: { ...command.payload, lines } }, now)).toBeNull();
    for (const occurred_at of ["2026-10-22T00:00:00Z", "2026-02-30T08:00:00Z", "2026-10-21T08:00:00", "2026-10-21T24:00:00Z"]) expect(parseSalesCommand({ ...command, payload: { ...command.payload, occurred_at } }, now)).toBeNull();
    expect(parseSalesCommand({ ...command, payload: { ...command.payload, payment: { status: "paid", method: "cash", amount_cents: 1, occurred_at: command.payload.occurred_at } } }, now)).toBeNull();
    expect(parseSalesCommand({ ...command, payload: { ...command.payload, channel: "etsy" } }, now)).toBeNull();
  });
});
describe("Europe/Rome form dates", () => {
  it("converts summer/winter independently of the device timezone", () => {
    expect(romeInputToIso("2026-07-01T12:30")).toBe("2026-07-01T10:30:00.000Z");
    expect(romeInputToIso("2026-12-01T12:30:15")).toBe("2026-12-01T11:30:15.000Z");
    expect(romeTimeInput("2026-10-21T12:00:00Z")).toBe("2026-10-21T14:00:00");
  });
  it("refuses DST gaps, ambiguous local times and impossible dates", () => {
    for (const input of ["2026-03-29T02:30", "2026-10-25T02:30", "2026-02-30T12:00", "2026-10-21T25:00", "not-a-date"]) expect(romeInputToIso(input)).toBeNull();
  });
});
