import { describe, expect, it } from "vitest";
import { readTeamPages } from "./read";

describe("shared workspace complete reads", () => {
  const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
  it("collects more than one API page and handles an empty workspace", async () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({ id: id(index + 1) }));
    expect(
      await readTeamPages((after, limit) => {
        const remaining = rows.filter((row) => after === null || row.id > after);
        return Promise.resolve({
          data: remaining.slice(0, limit),
          count: remaining.length,
          error: null,
        });
      }),
    ).toEqual(rows);
    expect(await readTeamPages(() => Promise.resolve({ data: [], count: 0, error: null }))).toEqual(
      [],
    );
  });
  it("rejects truncated pages, changing counts and query failures", async () => {
    await expect(
      readTeamPages(() => Promise.resolve({ data: [], count: 1, error: null })),
    ).rejects.toThrow(/completa/);
    await expect(
      readTeamPages((after) =>
        Promise.resolve({
          data: Array.from({ length: after ? 1 : 200 }, (_, index) => ({ id: id(index + 1) })),
          count: after ? 1 : 205,
          error: null,
        }),
      ),
    ).rejects.toThrow(/non è disponibile/);
    await expect(
      readTeamPages(() => Promise.resolve({ data: [], count: 0, error: { code: "42501" } })),
    ).rejects.toThrow();
  });
  it("does not silently omit a live row when one earlier row is deleted and another is added between pages", async () => {
    const original = Array.from({ length: 201 }, (_, index) => ({ id: id(index + 1) }));
    const changed = [...original.filter((row) => row.id !== id(101)), { id: id(300) }];
    await expect(
      readTeamPages((after, limit) => {
        const remaining = (after === null ? original : changed).filter(
          (row) => after === null || row.id > after,
        );
        return Promise.resolve({
          data: remaining.slice(0, limit),
          count: remaining.length,
          error: null,
        });
      }),
    ).rejects.toThrow(/non è disponibile/);
  });
});
