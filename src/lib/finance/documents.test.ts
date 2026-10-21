import { describe, expect, it } from "vitest";
import { financeDocumentFromDatabase } from "./documents";
const row = { id: "10000000-0000-0000-0000-000000000001", source_kind: "recap", file_name: "synthetic.pdf", storage_path: `sources/${"a".repeat(64)}/synthetic.pdf`, sha256: "a".repeat(64), byte_size: 100, content_type: "application/pdf", review_status: "unreviewed" };
describe("Finance source documents", () => {
  it("preserves source hash and immutable path", () => { expect(financeDocumentFromDatabase(row)?.storagePath).toBe(row.storage_path); });
  it.each([{ file_name: "x\r\nHeader.pdf" }, { storage_path: "../other.pdf" }, { sha256: "b".repeat(64) }, { byte_size: 26214401 }, { review_status: "approved" }, { content_type: "text/html" }])("rejects unsafe or inconsistent metadata %o", (change) => { expect(financeDocumentFromDatabase({ ...row, ...change })).toBeNull(); });
});
