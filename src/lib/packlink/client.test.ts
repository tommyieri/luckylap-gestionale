import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  PACKLINK_REQUEST_TIMEOUT_MS,
  PACKLINK_RESPONSE_MAX_BYTES,
  readPacklinkTransactions,
} from "./client";
import type { PacklinkClientInput } from "./types";

const input: PacklinkClientInput = {
  apiKey: "synthetic-private-api-key-000000000000",
  expectedClientId: "synthetic-client",
  cutoverAt: "2030-05-01T09:00:00.123456Z",
  now: new Date("2030-05-02T17:00:00Z"),
};
const row = (index = 1, extra: Record<string, unknown> = {}) => ({
  order_reference: `synthetic-transaction-${index}`,
  order_date: "2030-05-02T10:00:00Z",
  total_price: 12.34,
  type: "LABELS_ORDER",
  currency: "EUR",
  shipments_search: [`SYN-SHIPMENT-${index}`],
  ...extra,
});
const profile = { identifier: input.expectedClientId, email: "synthetic-private-contact" };
const shipment = (ref: string, extra: Record<string, unknown> = {}) => ({
  packlink_reference: ref,
  client_id: input.expectedClientId,
  source: "module_shopify",
  additional_data: { order_id: "7001", private_contact: "synthetic-private-recipient" },
  ...extra,
});
const page = (items: unknown[], currentPage = 1, totalRows = items.length) => ({
  items,
  pagination: {
    current_page: currentPage,
    total_pages: Math.max(1, Math.ceil(totalRows / 10)),
    total_registers: totalRows,
    is_one_indexed: true,
  },
});
function api(
  options: {
    rows?: unknown[];
    profile?: unknown;
    page?: (number: number) => unknown | Response;
    shipment?: (ref: string) => unknown | Response;
  } = {},
) {
  const rows = options.rows ?? [row()];
  return vi.fn<typeof fetch>(async (url) => {
    const path = new URL(String(url));
    let value: unknown;
    if (path.pathname === "/v1/clients") value = options.profile ?? profile;
    else if (path.pathname === "/v1/invoicing/transactions") {
      const number = Number(path.searchParams.get("page"));
      value =
        options.page?.(number) ??
        page(rows.slice((number - 1) * 10, number * 10), number, rows.length);
    } else if (path.pathname.startsWith("/v1/shipments/")) {
      const ref = path.pathname.slice("/v1/shipments/".length);
      value = options.shipment?.(ref) ?? shipment(ref);
    } else throw new Error("Unexpected synthetic endpoint");
    return value instanceof Response ? value : Response.json(value);
  });
}
const read = (fetcher: typeof fetch, changed: Partial<PacklinkClientInput> = {}) =>
  readPacklinkTransactions({ ...input, ...changed }, { fetch: fetcher });
afterEach(() => vi.useRealTimers());

describe("Packlink read-only binding and canonical transactions", () => {
  it("binds the account first, reads all pages and preserves signed refund semantics without contacts", async () => {
    const rows = Array.from({ length: 11 }, (_, index) => row(index + 1));
    rows[10] = row(11, {
      type: "REFUND",
      total_price: -2.34,
      shipments_search: ["SYN-SHIPMENT-1"],
    });
    const fetcher = api({ rows });
    const result = await read(fetcher);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.clientId).toBe(input.expectedClientId);
    expect(result.transactions).toHaveLength(11);
    expect(result.transactions[0]).toEqual({
      provider_transaction_id: "synthetic-transaction-1",
      provider_type: "LABELS_ORDER",
      amount_cents: 1234,
      currency: "EUR",
      occurred_at: "2030-05-02T10:00:00.000Z",
      shipment_references: ["SYN-SHIPMENT-1"],
      shopify_order_gid: "gid://shopify/Order/7001",
    });
    expect(result.transactions[10]).toMatchObject({ provider_type: "REFUND", amount_cents: 234 });
    expect(fetcher.mock.calls[0]![0]).toBe("https://api.packlink.com/v1/clients");
    expect(
      fetcher.mock.calls.filter(([url]) => String(url).endsWith("/SYN-SHIPMENT-1")),
    ).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("synthetic-private");
    expect(JSON.stringify(result)).not.toContain("email");
    for (const [url, init] of fetcher.mock.calls) {
      expect(new URL(String(url)).origin).toBe("https://api.packlink.com");
      expect(init).toMatchObject({
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      });
      expect(init?.headers).toEqual({ Authorization: input.apiKey, Accept: "application/json" });
      expect(init?.body).toBeUndefined();
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    const queries = fetcher.mock.calls.filter(([url]) => String(url).includes("/transactions?"));
    expect(queries.map(([url]) => Object.fromEntries(new URL(String(url)).searchParams))).toEqual([
      { from: "2030-05-01", to: "2030-05-03", page: "1", size: "10" },
      { from: "2030-05-01", to: "2030-05-03", page: "2", size: "10" },
    ]);
  });
  it("retains same-day pre-cutover observations for the database's precise decision", async () => {
    const result = await read(api({ rows: [row(1, { order_date: "2030-05-01T08:59:00Z" })] }));
    expect(result).toMatchObject({
      status: "ready",
      transactions: [{ occurred_at: "2030-05-01T08:59:00.000Z" }],
    });
  });
  it("normalizes offsets and preserves every representable fractional source digit", async () => {
    const result = await read(
      api({ rows: [row(1, { order_date: "2030-05-02T12:00:00.123456000+02:00" })] }),
      { cutoverAt: "2030-05-01T00:15:00+01:00" },
    );
    expect(result).toMatchObject({
      status: "ready",
      transactions: [{ occurred_at: "2030-05-02T10:00:00.123456Z" }],
    });
  });
  it("reviews true nanosecond precision instead of emitting a DTO the database cannot represent", async () => {
    expect(
      await read(api({ rows: [row(1, { order_date: "2030-05-02T12:00:00.123456789Z" })] })),
    ).toEqual({ status: "review", code: "invalid_timestamp" });
  });
  it.each([0, 1])("accepts an explicitly empty page with total_pages=%i", async (totalPages) => {
    const body = page([]);
    body.pagination.total_pages = totalPages;
    expect(await read(api({ page: () => body }))).toEqual({
      status: "ready",
      clientId: input.expectedClientId,
      transactions: [],
    });
  });
  it("discards unrelated bounded provider fields", async () => {
    const result = await read(
      api({ rows: [row(1, { private_contact: "synthetic-private-value" })] }),
    );
    expect(result.status).toBe("ready");
    expect(JSON.stringify(result)).not.toContain("private_contact");
  });
  it("refuses a rotated key belonging to another account before reading transactions", async () => {
    const fetcher = api({ profile: { identifier: "different-synthetic-client" } });
    expect(await read(fetcher)).toEqual({ status: "review", code: "account_mismatch" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("Packlink exact money, identities and timestamps", () => {
  it.each([
    ["0.01", 1],
    ["0.10", 10],
    ["12.34", 1234],
    ["999999.99", 99999999],
    ["1000000.00", 100000000],
  ])("converts numeric lexeme %s exactly into cents", async (lexeme, cents) => {
    const body = JSON.stringify(
      page([row(1, { total_price: "__RAW__", shipments_search: [] })]),
    ).replace('"__RAW__"', lexeme);
    expect(await read(api({ page: () => new Response(body) }))).toMatchObject({
      status: "ready",
      transactions: [{ amount_cents: cents }],
    });
  });
  it.each([
    "1e2",
    "1E+2",
    "12.340",
    "0.001",
    "1000000.01",
    "0",
    "-0",
    '"12.34"',
    "null",
    "false",
    "{}",
  ])("rejects unsafe amount lexeme %s", async (lexeme) => {
    const body = JSON.stringify(
      page([row(1, { total_price: "__RAW__", shipments_search: [] })]),
    ).replace('"__RAW__"', lexeme);
    expect(await read(api({ page: () => new Response(body) }))).toEqual({
      status: "review",
      code: "invalid_amount",
    });
  });
  it.each([
    { type: "LABELS_ORDER", total_price: -12.34 },
    { type: "REFUND", total_price: 12.34 },
  ])("rejects a sign inconsistent with transaction type %j", async (extra) => {
    expect(await read(api({ rows: [row(1, extra)] }))).toEqual({
      status: "review",
      code: "invalid_amount",
    });
  });
  it.each(["PENDING", "ADDITIONAL_UNKNOWN_CHARGE", null, 1])(
    "does not infer unknown type %j",
    async (type) => {
      expect(await read(api({ rows: [row(1, { type })] }))).toEqual({
        status: "review",
        code: "unsupported_transaction",
      });
    },
  );
  it.each(["USD", "eur", null])("does not infer currency %j", async (currency) => {
    expect(await read(api({ rows: [row(1, { currency })] }))).toEqual({
      status: "review",
      code: "unsupported_currency",
    });
  });
  it.each([
    "2030-02-30T10:00:00Z",
    "2030-05-01T10:00:00",
    "2030-05-01",
    "2030-05-01T25:00:00Z",
    "not-a-date",
    null,
  ])("rejects invalid/ambiguous timestamp %j", async (order_date) => {
    expect(await read(api({ rows: [row(1, { order_date })] }))).toEqual({
      status: "review",
      code: "invalid_timestamp",
    });
  });
  it.each(["", "has space", "has\ncontrol", "x".repeat(121), null])(
    "rejects malformed transaction id %j",
    async (order_reference) => {
      expect(await read(api({ rows: [row(1, { order_reference })] }))).toEqual({
        status: "review",
        code: "malformed_response",
      });
    },
  );
  it.each([
    ["../escape"],
    ["SYN?query=yes"],
    ["SYN", "SYN"],
    ["x".repeat(101)],
    Array.from({ length: 21 }, (_, i) => `SYN-${i}`),
    null,
  ])("rejects unsafe references %j", async (shipments_search) => {
    const fetcher = api({ rows: [row(1, { shipments_search })] });
    expect(await read(fetcher)).toEqual({ status: "review", code: "invalid_reference" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("Packlink complete, bounded pagination", () => {
  const rows = Array.from({ length: 11 }, (_, i) => row(i + 1, { shipments_search: [] }));
  it("returns no partial batch when totals change between pages", async () => {
    const fetcher = api({
      page: (number) => (number === 1 ? page(rows.slice(0, 10), 1, 11) : page([], 2, 10)),
    });
    expect(await read(fetcher)).toEqual({ status: "retry", code: "pagination_changed" });
  });
  it("returns no partial batch when an id occurs on different pages", async () => {
    const duplicate = [...rows.slice(0, 10), rows[0]];
    expect(await read(api({ rows: duplicate }))).toEqual({
      status: "retry",
      code: "duplicate_transaction",
    });
  });
  it.each([
    { is_one_indexed: false },
    { current_page: 2 },
    { current_page: 1.5 },
    { total_pages: "1" },
    { total_registers: "1" },
    { total_registers: -1 },
    { total_registers: 12, total_pages: 1 },
  ])("checks upstream pagination metadata %j", async (extra) => {
    const body = page([row(1)]);
    Object.assign(body.pagination, extra);
    expect(await read(api({ page: () => body }))).toEqual({
      status: "review",
      code: "malformed_response",
    });
  });
  it("does not accept truncated pages", async () => {
    expect(await read(api({ page: () => page([rows[0]], 1, 11) }))).toEqual({
      status: "retry",
      code: "pagination_changed",
    });
  });
  it("caps source rows and page count before more requests", async () => {
    const fetcher = api({ page: () => page(rows.slice(0, 10), 1, 1001) });
    expect(await read(fetcher)).toEqual({ status: "review", code: "pagination_limit" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await readPacklinkTransactions(input, { fetch: api({ rows }), maxPages: 1 })).toEqual({
      status: "review",
      code: "pagination_limit",
    });
  });
});

describe("Packlink enrichment stays separate from financial identity", () => {
  it.each([
    ["7002", "gid://shopify/Order/7002"],
    ["gid://shopify/Order/7003", "gid://shopify/Order/7003"],
    ["18446744073709551615", "gid://shopify/Order/18446744073709551615"],
    ["18446744073709551616", null],
    ["07001", null],
    ["0", null],
    ["gid://shopify/Product/7001", null],
    [7001, null],
    [null, null],
  ])("links only exact supported Shopify identities %j", async (id, expected) => {
    expect(
      await read(api({ shipment: (ref) => shipment(ref, { additional_data: { order_id: id } }) })),
    ).toMatchObject({ status: "ready", transactions: [{ shopify_order_gid: expected }] });
  });
  it("does not infer a Shopify link from another source or from multiple references", async () => {
    const fetcher = api({
      rows: [row(1), row(2, { shipments_search: ["SYN-B", "SYN-A"] })],
      shipment: (ref) => shipment(ref, { source: "manual", additional_data: { order_id: "7001" } }),
    });
    const result = await read(fetcher);
    expect(result).toMatchObject({
      status: "ready",
      transactions: [
        { shopify_order_gid: null },
        { shopify_order_gid: null, shipment_references: ["SYN-A", "SYN-B"] },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("allows an explicitly missing shipment without losing the financial observation", async () => {
    expect(await read(api({ shipment: () => new Response(null, { status: 404 }) }))).toMatchObject({
      status: "ready",
      transactions: [{ amount_cents: 1234, shopify_order_gid: null }],
    });
  });
  it("rejects a redirected 404 rather than treating it as a missing enrichment", async () => {
    const response = new Response(null, { status: 404 });
    Object.defineProperty(response, "redirected", { value: true });
    expect(await read(api({ shipment: () => response }))).toEqual({
      status: "review",
      code: "malformed_response",
    });
  });
  it.each([
    [{ client_id: "different-synthetic-client" }, "account_mismatch"],
    [{ packlink_reference: "different-reference" }, "malformed_response"],
  ])("fails closed on wrong enrichment identity %j", async (extra, code) => {
    expect(await read(api({ shipment: (ref) => shipment(ref, extra) }))).toEqual({
      status: "review",
      code,
    });
  });
  it("never treats shipment price or missing source dates as a financial fallback", async () => {
    const missing = row();
    delete (missing as Partial<typeof missing>).order_date;
    const fetcher = api({
      rows: [missing],
      shipment: (ref) => shipment(ref, { price: { total_price: 99.99 } }),
    });
    expect(await read(fetcher)).toEqual({ status: "review", code: "invalid_timestamp" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("Packlink transport boundaries", () => {
  it.each([
    [401, "review", "access_denied"],
    [403, "review", "access_denied"],
    [429, "retry", "throttled"],
    [503, "retry", "unavailable"],
  ])("does not read an error body for HTTP %i", async (status, outcome, code) => {
    const response = new Response("synthetic-private-error-body", { status });
    const getReader = vi.spyOn(response.body!, "getReader");
    expect(await read(vi.fn<typeof fetch>(async () => response))).toEqual({
      status: outcome,
      code,
    });
    expect(getReader).not.toHaveBeenCalled();
  });
  it("rejects redirected success responses", async () => {
    const response = Response.json(profile);
    Object.defineProperty(response, "redirected", { value: true });
    expect(await read(vi.fn<typeof fetch>(async () => response))).toEqual({
      status: "review",
      code: "malformed_response",
    });
  });
  it("bounds both declared and actual body bytes", async () => {
    const tooLong = new Response("{}", {
      headers: { "content-length": String(PACKLINK_RESPONSE_MAX_BYTES + 1) },
    });
    expect(await read(vi.fn<typeof fetch>(async () => tooLong))).toEqual({
      status: "review",
      code: "response_too_large",
    });
    const oversized = new Response(new Uint8Array(PACKLINK_RESPONSE_MAX_BYTES + 1));
    expect(await read(vi.fn<typeof fetch>(async () => oversized))).toEqual({
      status: "review",
      code: "response_too_large",
    });
  });
  it.each(["", "not-json", "{truncated", "[]"])(
    "rejects malformed response body %j",
    async (body) => {
      expect(await read(vi.fn<typeof fetch>(async () => new Response(body)))).toEqual({
        status: "review",
        code: "malformed_response",
      });
    },
  );
  it("rejects invalid UTF-8", async () => {
    expect(await read(vi.fn<typeof fetch>(async () => new Response(Uint8Array.of(255))))).toEqual({
      status: "review",
      code: "malformed_response",
    });
  });
  it("honours an already-aborted parent without starting requests", async () => {
    const parent = new AbortController();
    parent.abort();
    const fetcher = api();
    expect(
      await readPacklinkTransactions(input, { fetch: fetcher, signal: parent.signal }),
    ).toEqual({ status: "retry", code: "aborted" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds a transport that ignores abort", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    const pending = read(fetcher);
    await vi.advanceTimersByTimeAsync(PACKLINK_REQUEST_TIMEOUT_MS + 1);
    expect(await pending).toEqual({ status: "retry", code: "unavailable" });
    expect(fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });
  it("aborts a hung body stream without returning a partial observation", async () => {
    const parent = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
      cancel,
    });
    const pending = readPacklinkTransactions(input, {
      fetch: vi.fn<typeof fetch>(async () => new Response(body)),
      signal: parent.signal,
    });
    await Promise.resolve();
    parent.abort();
    expect(await pending).toEqual({ status: "retry", code: "aborted" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([
    { apiKey: "unsafe\nheader" },
    { expectedClientId: "" },
    { now: new Date("invalid") },
    { cutoverAt: "2030-05-03T00:00:00Z" },
    { cutoverAt: "ambiguous" },
  ])("validates input before using credentials %j", async (changed) => {
    const fetcher = api();
    expect(await read(fetcher, changed)).toEqual({ status: "review", code: "invalid_input" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
