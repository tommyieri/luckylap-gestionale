import { describe, expect, it } from "vitest";
import { auditCursorFromSearch, auditCursorHref, auditEntryFromDatabase } from "./model";

const id = "00000000-0000-4000-8000-000000000001";
const timestamp = "2026-10-21T11:46:40.813337+00:00";

describe("founder audit metadata boundary", () => {
  it("keeps microsecond precision in pagination cursors", () => {
    const cursor = auditCursorFromSearch({ beforeAt: timestamp, beforeId: id });
    expect(cursor).toEqual({ occurredAt: timestamp, id });
    const url = new URL(auditCursorHref(cursor!), "https://example.test");
    expect(url.searchParams.get("beforeAt")).toBe(timestamp);
  });
  it("rejects incomplete or injectable cursor fields", () => {
    expect(auditCursorFromSearch({})).toBe(null);
    for (const params of [{ beforeAt: timestamp }, { beforeAt: [timestamp], beforeId: id }, { beforeAt: "2026-02-30T10:00:00Z", beforeId: id }, { beforeAt: timestamp + ",id.gt.0", beforeId: id }, { beforeAt: timestamp, beforeId: "bad)" }]) {
      expect(() => auditCursorFromSearch(params)).toThrow();
    }
  });
  it("returns only approved metadata and UUID references, dropping source payloads and arbitrary record keys", () => {
    const entry = auditEntryFromDatabase({ id, occurred_at: timestamp, actor_id: null, table_name: "finance_import_transactions", operation: "INSERT", record_key: { id, account: "PRIVATE_ACCOUNT", amount: 99, nested: { balance: 123 } }, old_data: { secret: "PRIVATE_OLD" }, new_data: { secret: "PRIVATE_NEW" } });
    expect(entry.references).toEqual([{ label: "Elemento", id }]);
    expect(entry.actorId).toBe(null);
    expect(JSON.stringify(entry)).not.toMatch(/PRIVATE|balance|99|123/);
  });
});
