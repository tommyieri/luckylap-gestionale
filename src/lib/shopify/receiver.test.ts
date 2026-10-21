import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readShopifyRawBody, receiveShopifyWebhook, SHOPIFY_RECEIVER_BUDGET_MS } from "./receiver";
import { SHOPIFY_WEBHOOK_MAX_BYTES } from "./webhook";
import type { ShopifyInboxResult } from "./inbox";

const environment = { SHOPIFY_SHOP_DOMAIN: "synthetic-shop.myshopify.com", SHOPIFY_CLIENT_SECRET: "synthetic-hmac-secret",
  NEXT_PUBLIC_SUPABASE_URL: "https://synthetic-project.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_synthetic-private-key" };
const receipt = { inbox_id: "90000000-0000-4000-8000-000000000001", job_id: "90000000-0000-4000-8000-000000000002",
  received_at: "2026-10-21T11:00:00+00:00", state: "awaiting_app" as const, replayed: false };
function notificationRequest(overrides: Record<string, unknown> = {}, headerOverrides: Record<string, string> = {}) {
  const rawBody = JSON.stringify({ id: 123, admin_graphql_api_id: "gid://shopify/Order/123", source_name: "pos", currency: "EUR",
    created_at: "2026-10-21T11:00:00Z", updated_at: "2026-10-21T12:00:00Z", ...overrides });
  return new Request("https://synthetic.test/api/integrations/shopify/webhook", { method: "POST", body: rawBody, headers: {
    "x-shopify-hmac-sha256": createHmac("sha256", environment.SHOPIFY_CLIENT_SECRET).update(rawBody).digest("base64"),
    "x-shopify-shop-domain": environment.SHOPIFY_SHOP_DOMAIN, "x-shopify-api-version": "2026-10", "x-shopify-topic": "orders/create",
    "x-shopify-webhook-id": "90000000-0000-4000-8000-000000000003", ...headerOverrides,
  } });
}
function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}, cancel = vi.fn()) {
  return new Request("https://synthetic.test", { method: "POST", headers, duplex: "half",
    body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); }, cancel }),
  } as RequestInit);
}
const signal = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());

describe("bounded Shopify raw request", () => {
  it("accepts exactly one MiB while preserving bytes across chunk boundaries", async () => {
    const first = new Uint8Array(SHOPIFY_WEBHOOK_MAX_BYTES - 1).fill(17);
    const result = await readShopifyRawBody(streamed([first, new Uint8Array([255])]), signal());
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.rawBody.byteLength).toBe(SHOPIFY_WEBHOOK_MAX_BYTES); expect(result.rawBody.at(-1)).toBe(255); }
  });
  it.each<Record<string, string>>([{}, { "content-length": "1" }])("rejects an oversized stream even without a truthful length (%j)", async (headers) => {
    expect(await readShopifyRawBody(streamed([new Uint8Array(SHOPIFY_WEBHOOK_MAX_BYTES), new Uint8Array([1])], headers), signal()))
      .toEqual({ ok: false, error: "invalid_body" });
  });
  it.each<Record<string, string>>([{ "content-length": "1048577" }, { "content-length": "-1" }, { "content-length": "3.5" }, { "content-encoding": "gzip" }])(
    "rejects invalid headers without reading the stream (%j)", async (headers) => {
      const request = streamed([new Uint8Array([1])], headers);
      const getReader = vi.spyOn(request.body!, "getReader");
      expect((await readShopifyRawBody(request, signal())).ok).toBe(false); expect(getReader).not.toHaveBeenCalled();
    });
  it("rejects empty bodies and a mismatched declared length", async () => {
    expect((await readShopifyRawBody(streamed([]), signal())).ok).toBe(false);
    expect((await readShopifyRawBody(streamed([new Uint8Array([1])], { "content-length": "2" }), signal())).ok).toBe(false);
  });
  it("cancels a body that stalls beyond the shared deadline", async () => {
    const controller = new AbortController(); const cancel = vi.fn();
    const request = new Request("https://synthetic.test", { method: "POST", duplex: "half", body: new ReadableStream({ cancel }) } as RequestInit);
    const pending = readShopifyRawBody(request, controller.signal); controller.abort();
    expect(await pending).toEqual({ ok: false, error: "request_timeout" }); expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("Shopify durable receiver boundary", () => {
  it("fails closed without credentials before reading or invoking persistence", async () => {
    const request = notificationRequest(); const read = vi.spyOn(request.body!, "getReader"); const persist = vi.fn();
    const response = await receiveShopifyWebhook(request, { environment: {}, persist });
    expect(response.status).toBe(503); expect(read).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("retry-after")).toBe("30");
  });
  it("does not persist a bad signature, altered bytes, shop or version", async () => {
    const persist = vi.fn();
    const invalidHeaders: Record<string, string>[] = [{ "x-shopify-hmac-sha256": "A".repeat(43) + "=" }, { "x-shopify-shop-domain": "hostile.myshopify.com" }, { "x-shopify-api-version": "2026-07" }];
    for (const header of invalidHeaders) {
      const response = await receiveShopifyWebhook(notificationRequest({}, header), { environment, persist });
      expect(response.status).toBe(header["x-shopify-hmac-sha256"] ? 401 : 400);
    }
    const changed = notificationRequest(); const raw = (await changed.text()) + " ";
    const response = await receiveShopifyWebhook(new Request(changed.url, { method: "POST", body: raw, headers: changed.headers }), { environment, persist });
    expect(response.status).toBe(401); expect(persist).not.toHaveBeenCalled();
  });
  it("waits for durable commit before returning 200, retaining only the verified cue", async () => {
    let commit!: (value: ShopifyInboxResult) => void;
    const persist = vi.fn((..._arguments: unknown[]) => new Promise<ShopifyInboxResult>((resolve) => { commit = resolve; }));
    let acknowledged = false;
    const pending = receiveShopifyWebhook(notificationRequest({ email: "private@example.test", customer: { first_name: "Private" }, total_price: "99.00" }), { environment, persist })
      .then((response) => { acknowledged = true; return response; });
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce()); expect(acknowledged).toBe(false);
    const cue = persist.mock.calls[0]![0]; expect(cue).toMatchObject({ channel: "shopify_pos", requiresCanonicalRead: true });
    expect(JSON.stringify(cue)).not.toMatch(/private@example|first_name|total_price/);
    commit({ ok: true, receipt }); const response = await pending;
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ received: true, ...receipt });
  });
  it("returns the persistent receipt on an identical replay", async () => {
    const persist = vi.fn().mockResolvedValue({ ok: true, receipt: { ...receipt, replayed: true } });
    const response = await receiveShopifyWebhook(notificationRequest(), { environment, persist });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ received: true, ...receipt, replayed: true });
  });
  it.each(["orders/fulfilled", "orders/partially_fulfilled"])("persists %s only as a verified order-read cue", async (topic) => {
    const persist = vi.fn().mockResolvedValue({ ok: true, receipt });
    const response = await receiveShopifyWebhook(notificationRequest({ fulfillment_status: "partial", fulfillments: [{ id: 456, line_items: [{ quantity: 99 }] }] },
      { "x-shopify-topic": topic }), { environment, persist });
    expect(response.status).toBe(200);
    expect(persist.mock.calls[0]![0]).toMatchObject({ topic, orderGid: "gid://shopify/Order/123", requiresCanonicalRead: true });
    expect(JSON.stringify(persist.mock.calls[0]![0])).not.toMatch(/fulfillment_status|line_items|quantity/);
  });
  it.each(["error", "throw"])("does not acknowledge failed persistence (%s)", async (failure) => {
    const persist = vi.fn(async (): Promise<ShopifyInboxResult> => { if (failure === "throw") throw new Error("secret database internals");
      return { ok: false, error: "persistence_unavailable" }; });
    const response = await receiveShopifyWebhook(notificationRequest(), { environment, persist });
    expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/secret|database|internals/);
  });
  it("reports changed delivery content as a conflict without an acknowledgement", async () => {
    const response = await receiveShopifyWebhook(notificationRequest(), { environment,
      persist: async () => ({ ok: false, error: "delivery_conflict" }) });
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ received: false, error: "delivery_conflict" });
  });
  it("aborts the shared request budget rather than buffering a stalled body indefinitely", async () => {
    vi.useFakeTimers(); const persist = vi.fn();
    const request = new Request("https://synthetic.test", { method: "POST", duplex: "half", body: new ReadableStream() } as RequestInit);
    const pending = receiveShopifyWebhook(request, { environment, persist });
    await vi.advanceTimersByTimeAsync(SHOPIFY_RECEIVER_BUDGET_MS);
    expect((await pending).status).toBe(503); expect(persist).not.toHaveBeenCalled();
  });
});
