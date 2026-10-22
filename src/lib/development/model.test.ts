import { describe, expect, it } from "vitest";
import { parseDevelopmentForm } from "./model";
const id = "00000000-0000-4000-8000-000000000001";
const form = (values: Record<string, string>) => {
  const result = new FormData();
  Object.entries(values).forEach(([key, value]) => result.set(key, value));
  return result;
};
describe("development input boundary", () => {
  it("keeps creation distinct from versioned updates and allows archive without deletion", () => {
    expect(
      parseDevelopmentForm(form({ id, name: "Prototipo", stage: "idea" })).expectedVersion,
    ).toBe(null);
    expect(
      parseDevelopmentForm(
        form({ id, name: "Prototipo", stage: "archived", version: "2", targetDate: "2026-11-21" }),
      ),
    ).toMatchObject({ id, expectedVersion: 2, stage: "archived", targetDate: "2026-11-21" });
  });
  it("rejects invalid versions, owners, dates and workflow values", () => {
    const changes: Record<string, string>[] = [
      { version: "0" },
      { version: "1e2" },
      { version: "9007199254740992" },
      { ownerId: "founder" },
      { targetDate: "2026-02-30" },
      { stage: "sold" },
    ];
    for (const change of changes)
      expect(() =>
        parseDevelopmentForm(form({ id, name: "Prototipo", stage: "idea", ...change })),
      ).toThrow();
  });
});
