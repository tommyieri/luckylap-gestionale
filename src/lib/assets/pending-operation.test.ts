import { describe, expect, it, vi } from "vitest";
import {
  parsePendingAssetOperation,
  runRememberedAssetOperation,
  type PendingAssetOperation,
} from "./pending-operation";

const userId = "00000000-0000-4000-8000-000000000001";
const operationId = "00000000-0000-4000-8000-000000000002";
describe("uncertain brand link recovery", () => {
  it("persists before sending and reuses the same UUID and frozen payload after a committed response is lost and the page reloads", async () => {
    let saved = "";
    const source: PendingAssetOperation = {
      kind: "link",
      operationId,
      fields: { name: "Original logo", assetType: "logo", description: "Original brief" },
      url: "https://drive.google.com/file/d/synthetic/view",
    };
    const rows = new Map<string, PendingAssetOperation>();
    let attempts = 0;
    const network = vi.fn(async (value: PendingAssetOperation) => {
      expect(saved).not.toBe("");
      if (value.kind !== "link") throw new Error("Expected link attempt");
      const previous = rows.get(value.operationId);
      if (previous) expect(value).toEqual(previous);
      else rows.set(value.operationId, structuredClone(value));
      attempts += 1;
      if (attempts === 1) throw new Error("Response lost after commit");
      return { id: value.operationId };
    });
    const persist = (value: PendingAssetOperation) => {
      saved = JSON.stringify(value);
    };
    await expect(runRememberedAssetOperation(source, userId, persist, network)).rejects.toThrow(
      "Response lost",
    );
    source.fields.name = "Edited field must not alter the pending request";
    source.url = "https://example.test/changed";
    const recovered = parsePendingAssetOperation(JSON.parse(saved), userId);
    await expect(runRememberedAssetOperation(recovered, userId, persist, network)).resolves.toEqual(
      { id: operationId },
    );
    expect(rows.size).toBe(1);
    expect(network.mock.calls[1][0]).toEqual({
      kind: "link",
      operationId,
      fields: { name: "Original logo", assetType: "logo", description: "Original brief" },
      url: "https://drive.google.com/file/d/synthetic/view",
    });
  });
});
