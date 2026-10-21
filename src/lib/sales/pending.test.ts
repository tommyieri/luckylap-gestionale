import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pendingSalesPrefix, recoverPendingSales } from "./pending";
import { syntheticId, syntheticSale } from "./fixtures";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T18:00:00Z"));
});
afterEach(() => vi.useRealTimers());
describe("uncertain lifecycle recovery", () => {
  it("keeps a pending receipt recoverable after the original order form disappears", () => {
    const user = syntheticId(10),
      key = `${pendingSalesPrefix(user)}fulfill:${syntheticId(3)}`;
    const command = {
      operationId: syntheticSale().operationId,
      kind: "fulfill_order_lines",
      payload: {
        order_id: syntheticId(3),
        lines: [{ order_line_id: syntheticId(5), quantity: 1 }],
        occurred_at: "2026-10-21T08:00:00Z",
        reason: "Synthetic physical delivery",
      },
    };
    const entries = new Map([
      [key, JSON.stringify(command)],
      [`${pendingSalesPrefix(syntheticId(11))}new-sale`, JSON.stringify(syntheticSale())],
    ]);
    const storage = {
      length: entries.size,
      key: (i: number) => [...entries.keys()][i],
      getItem: (key: string) => entries.get(key) ?? null,
    };
    expect(recoverPendingSales(storage, user, [`fulfill:${syntheticId(3)}`]).entries).toHaveLength(
      0,
    );
    const recovery = recoverPendingSales(storage, user, ["new-sale"]);
    expect(recovery.entries).toHaveLength(1);
    expect(recovery.entries[0].command.operationId).toBe(syntheticSale().operationId);
    expect(entries.has(key)).toBe(true);
  });
  it("refuses malformed saved operations without deleting them", () => {
    const key = `${pendingSalesPrefix(syntheticId(10))}orphan`;
    const storage = { length: 1, key: () => key, getItem: () => "corrupt" };
    expect(recoverPendingSales(storage, syntheticId(10), [])).toEqual({
      entries: [],
      unreadable: true,
    });
  });
});
