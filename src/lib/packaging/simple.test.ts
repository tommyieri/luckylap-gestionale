import { describe, expect, it } from "vitest";
import {
  parseSimplePackagingCommand,
  simplePackagingSnapshot,
  simpleQuantityInput,
} from "./simple";
const box = "00000000-0000-4000-8000-000000000001",
  sticker = "00000000-0000-4000-8000-000000000002",
  location = "00000000-0000-4000-8000-000000000003",
  operationId = "00000000-0000-4000-8000-000000000004";
const command = {
  operationId,
  kind: "adjust",
  payload: {
    schema_version: 1,
    stock_item_id: box,
    expected_quantity: 100,
    quantity: 0,
    reason: "Synthetic physical count",
  },
};
const config = {
  started_at: "2026-10-21T15:00:00Z",
  location_id: location,
  box_item_id: box,
  sticker_item_id: sticker,
};
const rows = () => [
  {
    stock_item_id: box,
    name: "Scatola T-shirt",
    packaging_type: "box",
    specifications: "30 × 22,5 × 2,5 cm",
    location_id: location,
    started_at: config.started_at,
    on_hand: 0,
    reserved: 3,
    unreserved: -3,
    consumption_deficit: 2,
    reconcilable_deficit: 1,
    historical_review: 1,
    automation_failures: 0,
  },
  {
    stock_item_id: sticker,
    name: "Adesivo per scatola",
    packaging_type: "sticker",
    specifications: null,
    location_id: location,
    started_at: config.started_at,
    on_hand: 100,
    reserved: 3,
    unreserved: 97,
    consumption_deficit: 0,
    reconcilable_deficit: 0,
    historical_review: 0,
    automation_failures: 0,
  },
];
describe("simple packaging quantities and source truth", () => {
  it("keeps zero, unknown and expected prior quantity distinct", () => {
    expect(parseSimplePackagingCommand(command)?.payload).toMatchObject({
      expected_quantity: 100,
      quantity: 0,
    });
    expect(
      parseSimplePackagingCommand({
        ...command,
        payload: { ...command.payload, expected_quantity: null },
      })?.payload,
    ).toMatchObject({ expected_quantity: null });
    expect(simpleQuantityInput("0")).toBe(0);
    expect(simpleQuantityInput("")).toBeNull();
  });
  it("rejects ambiguous counts, spoofed fields and missing reasons", () => {
    for (const input of ["1.2", "1e3", "-1", "1.000", "1000000001"])
      expect(simpleQuantityInput(input)).toBeNull();
    for (const value of [
      { ...command, role: "founder" },
      { ...command, payload: { ...command.payload, expected_quantity: "100" } },
      { ...command, payload: { ...command.payload, reason: "x" } },
    ])
      expect(parseSimplePackagingCommand(value)).toBeNull();
  });
  it("does not let a reconcile request approve historical deliveries", () => {
    expect(
      parseSimplePackagingCommand({
        operationId,
        kind: "reconcile",
        payload: { schema_version: 1 },
      }),
    ).not.toBeNull();
    expect(
      parseSimplePackagingCommand({
        operationId,
        kind: "reconcile",
        payload: { schema_version: 1, approve_historical: true },
      }),
    ).toBeNull();
  });
  it("shows reservation shortage and outstanding consumption without falsifying physical stock", () => {
    const result = simplePackagingSnapshot(
      { stock_adjustments_enabled: true },
      config,
      rows(),
      "Magazzino",
    );
    expect(result.items[0]).toMatchObject({
      onHand: 0,
      reserved: 3,
      unreserved: -3,
      deficit: 2,
      reconcilable: 1,
      historicalReview: 1,
    });
    expect(result.items[1].onHand).toBe(100);
  });
  it("refuses partial reads, duplicate materials and a hidden consumption deficit", () => {
    expect(() =>
      simplePackagingSnapshot(
        { stock_adjustments_enabled: true },
        config,
        rows().slice(0, 1),
        "Magazzino",
      ),
    ).toThrow(/incompleta/);
    expect(() =>
      simplePackagingSnapshot(
        { stock_adjustments_enabled: true },
        config,
        [rows()[0], rows()[0]],
        "Magazzino",
      ),
    ).toThrow(/incompleta/);
    const bad = rows();
    bad[0].consumption_deficit = 0;
    expect(() =>
      simplePackagingSnapshot({ stock_adjustments_enabled: true }, config, bad, "Magazzino"),
    ).toThrow(/incompleta/);
  });
  it("does not fabricate initial 100 counts before owner activation", () => {
    expect(
      simplePackagingSnapshot({ stock_adjustments_enabled: true }, { started_at: null }, [], null),
    ).toMatchObject({ startedAt: null, items: [] });
  });
});
