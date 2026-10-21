type PageResult = { data: unknown[] | null; count: number | null; error: unknown };

/** Range is inclusive. Exact counts detect lowered API row limits and concurrent inserts. */
export async function readCompletePages(
  read: (from: number, to: number) => PromiseLike<PageResult>,
  pageSize = 200,
): Promise<unknown[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000)
    throw new Error("Lettura Finance non completa.");
  const output: unknown[] = [];
  let expected: number | null = null;
  do {
    const page = await read(output.length, output.length + pageSize - 1);
    if (
      page.error ||
      !Array.isArray(page.data) ||
      !Number.isInteger(page.count) ||
      page.count === null ||
      page.count < 0 ||
      page.count > 100000 ||
      (expected !== null && page.count !== expected)
    )
      throw new Error("Lettura Finance non completa.");
    expected = page.count;
    if (page.data.length !== Math.min(pageSize, expected - output.length))
      throw new Error("Lettura Finance non completa.");
    output.push(...page.data);
  } while (output.length < expected);
  return output;
}
