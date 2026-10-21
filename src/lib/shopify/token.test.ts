import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createShopifyTokenProvider, SHOPIFY_TOKEN_MAX_BYTES, SHOPIFY_TOKEN_TIMEOUT_MS } from "./token";
import { shopifyWorkerConfig } from "./worker-config";

const credentials = { expectedShopDomain: "synthetic.myshopify.com", clientId: "synthetic-client-id", clientSecret: "synthetic-client-secret" };
const environment = { SHOPIFY_WORKER_ENABLED: "true", SHOPIFY_SHOP_DOMAIN: credentials.expectedShopDomain,
  SHOPIFY_CLIENT_ID: credentials.clientId, SHOPIFY_CLIENT_SECRET: credentials.clientSecret, SHOPIFY_WORKER_SECRET: "synthetic-worker-secret-00000000000",
  NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_synthetic-server-only" };
const token = "synthetic-admin-token-000000000000";
const result = (extra: Record<string, unknown> = {}) => Response.json({ access_token: token, expires_in: 86399, scope: "read_orders,read_products", ...extra });
const signal = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());

describe("Shopify worker explicit private configuration", () => {
  it("accepts the complete server configuration only with exact explicit enablement", () => {
    expect(shopifyWorkerConfig(environment)).toMatchObject({ expectedShopDomain: credentials.expectedShopDomain, clientId: credentials.clientId });
    expect(shopifyWorkerConfig({})).toBeNull();
  });
  it.each([
    { SHOPIFY_WORKER_ENABLED: undefined }, { SHOPIFY_WORKER_ENABLED: "false" }, { SHOPIFY_WORKER_ENABLED: "1" }, { SHOPIFY_WORKER_ENABLED: "TRUE" },
    { SHOPIFY_SHOP_DOMAIN: "https://synthetic.myshopify.com" }, { SHOPIFY_SHOP_DOMAIN: "synthetic.myshopify.com.attacker.test" },
    { SHOPIFY_SHOP_DOMAIN: "user@synthetic.myshopify.com" }, { SHOPIFY_CLIENT_ID: "" }, { SHOPIFY_CLIENT_SECRET: "" },
    { SHOPIFY_CLIENT_SECRET: " synthetic-client-secret" }, { SHOPIFY_WORKER_SECRET: "short" },
    { SHOPIFY_WORKER_SECRET: "has space".repeat(10) }, { SUPABASE_SECRET_KEY: "sb_publishable_not-a-server-key" },
    { SUPABASE_SECRET_KEY: "legacy-jwt-is-not-this-contract" }, { NEXT_PUBLIC_SUPABASE_URL: "http://remote.test" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://user:password@synthetic.supabase.co" }, { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co/path" },
  ])("fails closed on unavailable or unsafe config %j", (change) => { expect(shopifyWorkerConfig({ ...environment, ...change })).toBeNull(); });
});

describe("Shopify client credentials lifecycle", () => {
  it("posts only to the configured shop with a form body and keeps the token in memory before the expiry margin", async () => {
    let time = 1000; const fetcher = vi.fn().mockImplementation(async () => result());
    const provider = createShopifyTokenProvider({ fetch: fetcher, now: () => time });
    expect(await provider.get(credentials, signal())).toEqual({ ok: true, token });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://synthetic.myshopify.com/admin/oauth/access_token");
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store", credentials: "omit" });
    expect(Object.fromEntries((init.body as URLSearchParams).entries())).toEqual({ grant_type: "client_credentials", client_id: credentials.clientId, client_secret: credentials.clientSecret });
    time += 86399 * 1000 - 60001;
    expect((await provider.get(credentials, signal())).ok).toBe(true); expect(fetcher).toHaveBeenCalledOnce();
    time += 1;
    await provider.get(credentials, signal()); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("coalesces concurrent grants without persisting a refresh token", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    const provider = createShopifyTokenProvider({ fetch: fetcher });
    const first = provider.get(credentials, signal()), second = provider.get(credentials, signal());
    expect(fetcher).toHaveBeenCalledOnce(); finish(result());
    expect(await first).toEqual({ ok: true, token }); expect(await second).toEqual({ ok: true, token });
  });
  it("invalidates by configuration identity and on explicit access-denied refresh", async () => {
    const fetcher = vi.fn().mockImplementation(async () => result());
    const provider = createShopifyTokenProvider({ fetch: fetcher });
    await provider.get(credentials, signal());
    provider.invalidate({ ...credentials, expectedShopDomain: "other.myshopify.com" });
    await provider.get(credentials, signal()); expect(fetcher).toHaveBeenCalledOnce();
    provider.invalidate(credentials);
    await provider.get(credentials, signal()); expect(fetcher).toHaveBeenCalledTimes(2);
    await provider.get({ ...credentials, clientSecret: "rotated-synthetic-secret" }, signal()); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("does not let an invalidated in-flight request repopulate the cache", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockImplementation(async () => result());
    const provider = createShopifyTokenProvider({ fetch: fetcher });
    const pending = provider.get(credentials, signal()); provider.invalidate(credentials); finish(result()); await pending;
    await provider.get(credentials, signal()); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("never sends credentials to a custom or malformed host", async () => {
    const fetcher = vi.fn(); const provider = createShopifyTokenProvider({ fetch: fetcher });
    expect((await provider.get({ ...credentials, expectedShopDomain: "synthetic.myshopify.com/redirect" }, signal())).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{ access_token: "short" }, { access_token: token + "\n" }, { expires_in: "86399" }, { expires_in: 0 }, { expires_in: 86401 },
    { scope: "read_orders" }, { scope: "read_products" }, { scope: null }])("rejects invalid grant responses without caching them %j", async (change) => {
    const fetcher = vi.fn().mockImplementation(async () => result(change)); const provider = createShopifyTokenProvider({ fetch: fetcher });
    expect(await provider.get(credentials, signal())).toEqual({ ok: false, code: "token_invalid_response" });
    await provider.get(credentials, signal()); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([[401, "token_access_denied"], [403, "token_access_denied"], [429, "token_throttled"], [500, "token_unavailable"], [302, "token_unavailable"]])(
    "never reads or returns a non-success body (%s)", async (status, code) => {
      const response = new Response("client_secret=private-value", { status: Number(status) });
      const text = vi.spyOn(response, "text"), json = vi.spyOn(response, "json");
      const provider = createShopifyTokenProvider({ fetch: vi.fn().mockResolvedValue(response) });
      expect(await provider.get(credentials, signal())).toEqual({ ok: false, code }); expect(text).not.toHaveBeenCalled(); expect(json).not.toHaveBeenCalled();
    });
  it.each(["oversized", "invalid-json", "invalid-utf8"])("bounds and validates success response bytes (%s)", async (mode) => {
    const body = mode === "oversized" ? new Uint8Array(SHOPIFY_TOKEN_MAX_BYTES + 1) : mode === "invalid-utf8" ? new Uint8Array([255]) : "{not-json";
    const response = new Response(body, { headers: { "content-length": mode === "oversized" ? "1" : String(body.length) } });
    const provider = createShopifyTokenProvider({ fetch: vi.fn().mockResolvedValue(response) });
    expect(await provider.get(credentials, signal())).toEqual({ ok: false, code: "token_invalid_response" });
  });
  it("accepts an already-decompressed success body whose declared length is compressed", async () => {
    const response = result(); response.headers.set("content-encoding", "gzip"); response.headers.set("content-length", "90");
    expect(await createShopifyTokenProvider({ fetch: vi.fn().mockResolvedValue(response) }).get(credentials, signal())).toEqual({ ok: true, token });
  });
  it.each(["fetch", "body"])("bounds a stalled %s as transient even if its transport ignores abort", async (phase) => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(() => phase === "fetch" ? new Promise<Response>(() => undefined)
      : Promise.resolve(new Response(new ReadableStream())));
    const pending = createShopifyTokenProvider({ fetch: fetcher }).get(credentials, signal());
    await vi.advanceTimersByTimeAsync(SHOPIFY_TOKEN_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, code: "token_unavailable" });
  });
  it("treats network failure as a retryable failure and does not expose exception details", async () => {
    const provider = createShopifyTokenProvider({ fetch: vi.fn().mockRejectedValue(new Error("private-client-secret")) });
    expect(await provider.get(credentials, signal())).toEqual({ ok: false, code: "token_unavailable" });
    const controller = new AbortController(); controller.abort();
    expect(await provider.get(credentials, controller.signal)).toEqual({ ok: false, code: "token_unavailable" });
  });
});
