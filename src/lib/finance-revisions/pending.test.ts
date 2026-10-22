import { describe, expect, it } from "vitest";
import {
  acknowledgeFinanceRevision,
  preserveFinanceRevision,
  readPendingFinanceRevision,
} from "./pending";
import type { FinanceRevisionCommand, FinanceRevisionReceipt } from "./model";
const id = (n: number) => `86000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  };
}
const command: FinanceRevisionCommand = {
  operationId: id(1),
  payload: {
    schema_version: 1,
    source_kind: "payment",
    source_id: id(2),
    expected_version: 3,
    action: "delete",
    reason: "Synthetic frozen removal",
  },
};
const receipt: FinanceRevisionReceipt = {
  operationId: id(1),
  sourceKind: "payment",
  sourceId: id(2),
  revisionId: id(3),
  version: 4,
  replayed: true,
};
describe("recoverable Finance revision submissions", () => {
  it("freezes the same UUID/payload across reload and refuses a new attempt until resolved", () => {
    const store = storage();
    preserveFinanceRevision(store, id(4), command);
    expect(readPendingFinanceRevision(store, id(4))).toEqual(command);
    expect(() =>
      preserveFinanceRevision(store, id(4), { ...command, operationId: id(5) }),
    ).toThrow();
    expect(() =>
      preserveFinanceRevision(store, id(4), {
        ...command,
        payload: { ...command.payload, expected_version: 4 },
      }),
    ).toThrow();
    expect(readPendingFinanceRevision(store, id(5))).toBeNull();
  });
  it("only clears on a matching success receipt, including delete and restore", () => {
    const store = storage();
    preserveFinanceRevision(store, id(4), command);
    expect(() =>
      acknowledgeFinanceRevision(store, id(4), { ...receipt, operationId: id(9) }),
    ).toThrow();
    expect(readPendingFinanceRevision(store, id(4))).not.toBeNull();
    acknowledgeFinanceRevision(store, id(4), receipt);
    expect(readPendingFinanceRevision(store, id(4))).toBeNull();
    preserveFinanceRevision(store, id(4), {
      operationId: id(5),
      payload: { ...command.payload, action: "restore", restore_version: 0 },
    });
    expect(readPendingFinanceRevision(store, id(4))?.payload.action).toBe("restore");
  });
});
