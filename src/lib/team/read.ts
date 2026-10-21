import { isTeamId } from "./model";
type Page = { data: unknown[] | null; count: number | null; error: unknown };

/** Keyset pagination avoids OFFSET omissions when rows before the cursor are removed. Counts refer to the remaining filtered rows. */
export async function readTeamPages(read: (after: string | null, limit: number) => PromiseLike<Page>, idColumn = "id"): Promise<unknown[]> {
  const rows: unknown[] = [];
  let total: number | null = null;
  let after: string | null = null;
  do {
    const page = await read(after, 200);
    if (page.error || !Array.isArray(page.data) || page.count === null || !Number.isSafeInteger(page.count) || page.count < 0 || page.count > 10000 || (total !== null && total - rows.length !== page.count)) throw new Error("Il workspace condiviso non è disponibile. Ricarica la pagina.");
    if (total === null) total = page.count;
    if (page.data.length !== Math.min(200, total - rows.length)) throw new Error("La lettura del workspace non è completa. Ricarica la pagina.");
    for (const value of page.data) {
      const key = value && typeof value === "object" ? (value as Record<string, unknown>)[idColumn] : null;
      if (!isTeamId(key) || (after !== null && key <= after)) throw new Error("La lettura del workspace non è completa. Ricarica la pagina.");
      after = key;
    }
    rows.push(...page.data);
  } while (rows.length < total);
  return rows;
}
