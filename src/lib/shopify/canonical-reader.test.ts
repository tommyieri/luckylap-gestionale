import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readCanonicalShopifyOrder } from "./canonical-reader";
import { CANONICAL_QUERIES } from "./canonical-queries";
import {
  canonicalConnection,
  canonicalIds as ids,
  canonicalRawFixture,
} from "./canonical-fixtures";

const input = {
  shopDomain: "synthetic.myshopify.com",
  adminToken: "synthetic_server_token_only",
  orderId: ids.order,
};
type Fixture = ReturnType<typeof canonicalRawFixture>;
type Call = { query: string; variables: { id: string; after: string | null } };
const json = (data: unknown, status = 200, version: string | null = "2026-10") =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(version ? { "x-shopify-api-version": version } : {}),
    },
  });
function payload(raw: Fixture, call: Call): unknown {
  if (call.query === CANONICAL_QUERIES.summary) return { data: { order: raw.order } };
  if (call.query === CANONICAL_QUERIES.lines)
    return {
      data: {
        order: {
          id: raw.order.id,
          updatedAt: raw.order.updatedAt,
          lineItems: canonicalConnection(raw.lines),
        },
      },
    };
  if (call.query === CANONICAL_QUERIES.fulfillment) {
    const detail = raw.fulfillments.find((f) => f.id === call.variables.id);
    return {
      data: {
        fulfillment: { ...detail, fulfillmentLineItems: canonicalConnection(detail!.lines) },
      },
    };
  }
  if (call.query === CANONICAL_QUERIES.refund) {
    const detail = raw.refunds.find((f) => f.id === call.variables.id);
    return { data: { refund: { ...detail, refundLineItems: canonicalConnection(detail!.lines) } } };
  }
  throw new Error("Unvalidated synthetic query");
}
function fixtureFetch(
  raw = canonicalRawFixture(),
  override?: (call: Call, count: number) => Response | undefined,
) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const call = JSON.parse(String(init?.body)) as Call;
    calls.push(call);
    return override?.(call, calls.length) ?? json(payload(raw, call));
  });
  return { raw, calls, fetcher: fetcher as typeof fetch & typeof fetcher };
}
afterEach(() => vi.useRealTimers());

describe("bounded canonical Shopify reader", () => {
  it("reads a complete allowlist snapshot from a fixed version and server credential", async () => {
    const test = fixtureFetch();
    const result = await readCanonicalShopifyOrder(input, { fetch: test.fetcher });
    expect(result.status).toBe("ready");
    expect(test.calls).toHaveLength(5);
    for (const [url, init] of test.fetcher.mock.calls) {
      expect(url).toBe("https://synthetic.myshopify.com/admin/api/2026-10/graphql.json");
      expect(init).toMatchObject({
        method: "POST",
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        headers: { "X-Shopify-Access-Token": input.adminToken },
      });
      expect(String(init?.body)).not.toContain(input.adminToken);
    }
    expect(JSON.stringify(result)).not.toContain(input.adminToken);
    const query = Object.values(CANONICAL_QUERIES).join(" ");
    expect(query).not.toMatch(
      /\b(customer|email|shippingAddress|billingAddress|note|paymentDetails|receiptJson|trackingInfo)\b/,
    );
  });
  it("completes line, fulfillment-line and refund-line pagination even when pages are short", async () => {
    const raw = canonicalRawFixture();
    raw.lines.push({ ...raw.lines[0], id: "gid://shopify/LineItem/201" });
    raw.fulfillments[0].totalQuantity = 2;
    raw.order.fulfillments[0].totalQuantity = 2;
    raw.fulfillments[0].lines.push({
      ...raw.fulfillments[0].lines[0],
      id: "gid://shopify/FulfillmentLineItem/601",
      lineItem: { id: raw.lines[1].id },
    });
    raw.refunds[0].lines.push({
      ...raw.refunds[0].lines[0],
      id: "gid://shopify/RefundLineItem/901",
      lineItem: { id: raw.lines[1].id },
    });
    const test = fixtureFetch(raw, (call) => {
      if (call.query === CANONICAL_QUERIES.summary) return;
      const second = call.variables.after !== null;
      const connection = canonicalConnection(
        [
          call.query === CANONICAL_QUERIES.lines
            ? raw.lines[second ? 1 : 0]
            : call.query === CANONICAL_QUERIES.fulfillment
              ? raw.fulfillments[0].lines[second ? 1 : 0]
              : raw.refunds[0].lines[second ? 1 : 0],
        ],
        !second,
        second ? "page-b" : "page-a",
      );
      const data =
        call.query === CANONICAL_QUERIES.lines
          ? { order: { id: ids.order, updatedAt: raw.order.updatedAt, lineItems: connection } }
          : call.query === CANONICAL_QUERIES.fulfillment
            ? { fulfillment: { ...raw.fulfillments[0], fulfillmentLineItems: connection } }
            : { refund: { ...raw.refunds[0], refundLineItems: connection } };
      return json({ data });
    });
    const result = await readCanonicalShopifyOrder(input, { fetch: test.fetcher });
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.order.lines).toHaveLength(2);
      expect(result.order.fulfillments[0].lines).toHaveLength(2);
      expect(result.order.refunds[0].lines).toHaveLength(2);
    }
    expect(test.calls).toHaveLength(8);
  });
  it.each(["transactions", "fulfillments"])(
    "fails before detail reads if %s array does not match an exact count",
    async (field) => {
      for (const count of [
        { count: 2, precision: "EXACT" },
        { count: 1, precision: "AT_LEAST" },
      ]) {
        const test = fixtureFetch();
        test.raw.order[`${field}Count` as "transactionsCount"] = count;
        expect(await readCanonicalShopifyOrder(input, { fetch: test.fetcher })).toMatchObject({
          status: "review",
          code: "count_incomplete",
        });
        expect(test.calls).toHaveLength(1);
      }
    },
  );
  it("requires review rather than claiming completeness at the uncounted refund-array bound", async () => {
    const test = fixtureFetch();
    test.raw.order.refunds = Array.from({ length: 250 }, (_, i) => ({
      ...test.raw.order.refunds[0],
      id: `gid://shopify/Refund/${i + 1}`,
    }));
    expect(await readCanonicalShopifyOrder(input, { fetch: test.fetcher })).toMatchObject({
      status: "review",
      code: "read_limit",
    });
    expect(test.calls).toHaveLength(1);
  });
  it.each(["repeated-final-cursor", "empty-next", "missing-cursor", "missing-page-info"])(
    "rejects an incomplete pagination sequence: %s",
    async (scenario) => {
      const test = fixtureFetch(undefined, (call) => {
        if (call.query !== CANONICAL_QUERIES.lines) return;
        const next = call.variables.after === null;
        let connection: unknown = canonicalConnection(
          scenario === "empty-next" ? [] : [test.raw.lines[0]],
          next,
          scenario === "missing-cursor" ? null : "same-cursor",
        );
        if (scenario === "missing-page-info") connection = { nodes: test.raw.lines };
        return json({
          data: {
            order: { id: ids.order, updatedAt: test.raw.order.updatedAt, lineItems: connection },
          },
        });
      });
      const result = await readCanonicalShopifyOrder(input, { fetch: test.fetcher });
      expect(result.status).toBe("review");
      if (result.status !== "ready")
        expect(["pagination_incomplete", "invalid_shape"]).toContain(result.code);
    },
  );
  it("rejects duplicate identities collected on distinct pages", async () => {
    const test = fixtureFetch(undefined, (call) =>
      call.query === CANONICAL_QUERIES.lines
        ? json({
            data: {
              order: {
                id: ids.order,
                updatedAt: test.raw.order.updatedAt,
                lineItems: canonicalConnection(
                  test.raw.lines,
                  call.variables.after === null,
                  call.variables.after === null ? "a" : "b",
                ),
              },
            },
          })
        : undefined,
    );
    expect(await readCanonicalShopifyOrder(input, { fetch: test.fetcher })).toMatchObject({
      status: "review",
      code: "duplicate_identity",
    });
  });
  it("caps pages without returning partial lines", async () => {
    const test = fixtureFetch(undefined, (call) =>
      call.query === CANONICAL_QUERIES.lines
        ? json({
            data: {
              order: {
                id: ids.order,
                updatedAt: test.raw.order.updatedAt,
                lineItems: canonicalConnection(test.raw.lines, true, "next"),
              },
            },
          })
        : undefined,
    );
    expect(
      await readCanonicalShopifyOrder(input, { fetch: test.fetcher, maxPages: 1 }),
    ).toMatchObject({ status: "review", code: "read_limit" });
    expect(test.calls).toHaveLength(2);
  });
  it.each([
    [401, "access_denied"],
    [403, "access_denied"],
    [429, "throttled"],
    [500, "network_unavailable"],
  ] as const)("sanitizes HTTP %s without exposing the body", async (status, code) => {
    const fetcher = vi.fn(async () => new Response("PRIVATE_SENTINEL", { status }));
    const result = await readCanonicalShopifyOrder(input, { fetch: fetcher });
    expect(result).toMatchObject({ status: "unavailable", code });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
  });
  it.each(["THROTTLED", "ACCESS_DENIED", "INTERNAL_ERROR"])(
    "rejects partial data with GraphQL %s and sanitized diagnostics",
    async (code) => {
      const fetcher = vi.fn(async () =>
        json({
          data: { order: canonicalRawFixture().order },
          errors: [{ message: "PRIVATE_SENTINEL", extensions: { code } }],
        }),
      );
      const result = await readCanonicalShopifyOrder(input, { fetch: fetcher });
      expect(result).toMatchObject({
        status: "unavailable",
        code:
          code === "THROTTLED"
            ? "throttled"
            : code === "ACCESS_DENIED"
              ? "access_denied"
              : "graphql_error",
      });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
    },
  );
  it.each([null, "2027-01"])("rejects absent or substituted API version %s", async (version) => {
    expect(
      await readCanonicalShopifyOrder(input, {
        fetch: vi.fn(async () => json({ data: {} }, 200, version)),
      }),
    ).toMatchObject({ status: "review", code: "version_mismatch" });
  });
  it("sanitizes thrown network errors and invalid JSON/UTF8", async () => {
    const responses = [
      new Response("PRIVATE_SENTINEL", { headers: { "x-shopify-api-version": "2026-10" } }),
      new Response(new Uint8Array([0xff]), { headers: { "x-shopify-api-version": "2026-10" } }),
    ];
    for (const response of responses) {
      const result = await readCanonicalShopifyOrder(input, { fetch: vi.fn(async () => response) });
      expect(result).toMatchObject({ status: "unavailable", code: "invalid_response" });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
    }
    const result = await readCanonicalShopifyOrder(input, {
      fetch: vi.fn(async () => {
        throw new Error("PRIVATE_SENTINEL");
      }),
    });
    expect(result).toMatchObject({ status: "unavailable", code: "network_unavailable" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
  });
  it.each([false, true])(
    "counts actual body bytes even if content-length is absent or false: %s",
    async (falseLength) => {
      const headers = {
        "x-shopify-api-version": "2026-10",
        ...(falseLength ? { "content-length": "1" } : {}),
      };
      const fetcher = vi.fn(
        async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers }),
      );
      expect(await readCanonicalShopifyOrder(input, { fetch: fetcher })).toMatchObject({
        status: "review",
        code: "read_limit",
      });
    },
  );
  it.each(["fetch", "stream"])(
    "enforces the whole-read deadline when %s ignores abort",
    async (phase) => {
      vi.useFakeTimers();
      const fetcher = vi.fn(async () =>
        phase === "fetch"
          ? new Promise<Response>(() => {})
          : new Response(new ReadableStream({ start() {} }), {
              headers: { "x-shopify-api-version": "2026-10" },
            }),
      );
      const promise = readCanonicalShopifyOrder(input, { fetch: fetcher, timeoutMs: 10 });
      await vi.advanceTimersByTimeAsync(11);
      expect(await promise).toMatchObject({ status: "unavailable", code: "timeout" });
    },
  );
  it.each(["order", "child"])("rejects a foreign %s identity", async (scenario) => {
    const test = fixtureFetch(undefined, (call) =>
      scenario === "order" && call.query === CANONICAL_QUERIES.summary
        ? json({ data: { order: { ...test.raw.order, id: "gid://shopify/Order/999" } } })
        : scenario === "child" && call.query === CANONICAL_QUERIES.fulfillment
          ? json({
              data: {
                fulfillment: {
                  ...test.raw.fulfillments[0],
                  order: { id: "gid://shopify/Order/999" },
                },
              },
            })
          : undefined,
    );
    expect(await readCanonicalShopifyOrder(input, { fetch: test.fetcher })).toMatchObject({
      status: "review",
      code: "foreign_reference",
    });
  });
  it.each(["line-page", "fulfillment", "refund", "final-summary"])(
    "rejects a snapshot changed during %s",
    async (scenario) => {
      const test = fixtureFetch(undefined, (call, count) => {
        if (scenario === "line-page" && call.query === CANONICAL_QUERIES.lines)
          return json({ data: { order: { id: ids.order, updatedAt: "2026-10-21T11:01:00Z" } } });
        if (scenario === "fulfillment" && call.query === CANONICAL_QUERIES.fulfillment)
          return json({ data: { fulfillment: { ...test.raw.fulfillments[0], totalQuantity: 2 } } });
        if (scenario === "refund" && call.query === CANONICAL_QUERIES.refund)
          return json({
            data: { refund: { ...test.raw.refunds[0], updatedAt: "2026-10-21T11:01:00Z" } },
          });
        if (scenario === "final-summary" && call.query === CANONICAL_QUERIES.summary && count > 1)
          return json({ data: { order: { ...test.raw.order, edited: true } } });
      });
      expect(await readCanonicalShopifyOrder(input, { fetch: test.fetcher })).toMatchObject({
        status: "unavailable",
        code: "snapshot_changed",
      });
    },
  );
  it("detects a line-page revision changed inside the same millisecond", async () => {
    const raw = canonicalRawFixture();
    raw.order.updatedAt = "2026-10-21T11:00:00.123456Z";
    const test = fixtureFetch(raw, (call) =>
      call.query === CANONICAL_QUERIES.lines
        ? json({ data: { order: { id: ids.order, updatedAt: "2026-10-21T11:00:00.123457Z" } } })
        : undefined,
    );
    expect(await readCanonicalShopifyOrder(input, { fetch: test.fetcher })).toMatchObject({
      status: "unavailable",
      code: "snapshot_changed",
    });
  });
  it("does not fetch for invalid configuration or foreign URL/order input", async () => {
    const fetcher = vi.fn();
    for (const change of [
      { shopDomain: "https://synthetic.myshopify.com" },
      { shopDomain: "synthetic.myshopify.com.attacker.test" },
      { adminToken: "short" },
      { adminToken: "synthetic\nserver_secret" },
    ])
      expect(
        await readCanonicalShopifyOrder({ ...input, ...change }, { fetch: fetcher }),
      ).toMatchObject({ status: "unavailable", code: "configuration_required" });
    expect(
      await readCanonicalShopifyOrder(
        { ...input, orderId: "gid://shopify/Product/100" },
        { fetch: fetcher },
      ),
    ).toMatchObject({ status: "review", code: "invalid_order_id" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("distinguishes an inaccessible or missing order without inventing a cancelled order", async () => {
    expect(
      await readCanonicalShopifyOrder(input, {
        fetch: vi.fn(async () => json({ data: { order: null } })),
      }),
    ).toMatchObject({ status: "review", code: "order_not_found" });
  });
});
