import { describe, expect, it } from "vitest";
import { readCompletePages } from "./read";

describe("complete Finance reads", () => {
  it("reads every ordered page and checks the exact server count", async () => {
    const ranges: number[][] = [];
    const values = Array.from({ length: 5 }, (_, id) => ({ id }));
    const rows = await readCompletePages(async (from, to) => {
      ranges.push([from, to]);
      return { data: values.slice(from, to + 1), count: 5, error: null };
    }, 2);
    expect(rows).toEqual(values);
    expect(ranges).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });
  it("rejects silent truncation, missing counts, query errors and changed counts", async () => {
    await expect(
      readCompletePages(async () => ({ data: [{ id: 1 }], count: 3, error: null }), 2),
    ).rejects.toThrow();
    await expect(
      readCompletePages(async () => ({ data: [], count: null, error: null })),
    ).rejects.toThrow();
    await expect(
      readCompletePages(async () => ({ data: [], count: 0, error: { message: "secret" } })),
    ).rejects.toThrow("Lettura Finance non completa.");
    let calls = 0;
    await expect(
      readCompletePages(
        async () => ({ data: [{ id: 1 }, { id: 2 }], count: ++calls === 1 ? 4 : 5, error: null }),
        2,
      ),
    ).rejects.toThrow();
  });
  it("handles empty results and refuses oversized reads", async () => {
    expect(await readCompletePages(async () => ({ data: [], count: 0, error: null }))).toEqual([]);
    await expect(
      readCompletePages(async () => ({ data: [], count: 100001, error: null })),
    ).rejects.toThrow();
  });
});
