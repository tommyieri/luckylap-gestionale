import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { financeWorkPrefix, readFinanceWorkPending } from "./pending";
import { manualCommand, workId } from "./fixtures";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T18:00:00Z"));
});
afterEach(() => vi.useRealTimers());
describe("private pending Finance requests", () => {
  it("recovers the original after its entry is filtered out, scoped to the same user", () => {
    const user = workId(10),
      key = `${financeWorkPrefix(user)}void:${workId(1)}`,
      command = {
        operationId: workId(90),
        kind: "void_finance_entry",
        payload: { schema_version: 1, entry_id: workId(1), reason: "Synthetic correction" },
      };
    const data = new Map([
      [key, JSON.stringify(command)],
      [`${financeWorkPrefix(workId(11))}record`, JSON.stringify(manualCommand())],
    ]);
    const storage = {
      length: data.size,
      key: (n: number) => [...data.keys()][n],
      getItem: (k: string) => data.get(k) ?? null,
    };
    expect(readFinanceWorkPending(storage, user, [`void:${workId(1)}`]).entries).toHaveLength(0);
    expect(readFinanceWorkPending(storage, user, ["record"]).entries[0].command.operationId).toBe(
      command.operationId,
    );
    expect(data.has(key)).toBe(true);
  });
  it("tiene le chiavi dei tentativi illeggibili, senza cancellarli", () => {
    const user = workId(10),
      broken = `${financeWorkPrefix(user)}record`,
      odd = `${financeWorkPrefix(user)}void:${workId(1)}`;
    const data = new Map([
      [broken, "{non json"],
      [odd, JSON.stringify({ operationId: "x", kind: "void_finance_entry", payload: {} })],
    ]);
    const storage = {
      length: data.size,
      key: (n: number) => [...data.keys()][n],
      getItem: (k: string) => data.get(k) ?? null,
    };
    expect(readFinanceWorkPending(storage, user, [])).toEqual({
      entries: [],
      unreadable: true,
      unreadableKeys: [broken, odd],
    });
    expect(data.size).toBe(2);
  });
});
