import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createShopifyWorkerStore } from "./worker-store";

// Real installed Supabase/PostgREST code; only the network transport is synthetic.
const config = { expectedShopDomain: "synthetic.myshopify.com", clientId: "synthetic-client-id", clientSecret: "synthetic-client-secret",
  workerSecret: "synthetic-worker-secret-0000000000", supabaseUrl: "https://synthetic.supabase.co", supabaseSecretKey: "sb_secret_synthetic-private" };
const workerId = "90000000-0000-4000-8000-000000000001";
const job = { job_id: "90000000-0000-4000-8000-000000000002", inbox_id: "90000000-0000-4000-8000-000000000003",
  lease_token: "90000000-0000-4000-8000-000000000004", shop_domain: config.expectedShopDomain, order_gid: "gid://shopify/Order/100", lease_expires_at: "2026-10-21T15:00:00Z" };
afterEach(() => vi.unstubAllGlobals());
describe("Shopify worker installed PostgREST integration", () => {
  it("passes the private key only to the allowlisted bounded RPC transport", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([job])); vi.stubGlobal("fetch", fetcher);
    const store = createShopifyWorkerStore(config);
    expect(await store.claim(workerId, new AbortController().signal)).toEqual({ ok: true, value: [job] });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(config.supabaseUrl + "/rest/v1/rpc/claim_shopify_order_jobs");
    expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit", cache: "no-store" });
    expect(new Headers(init.headers).get("apikey")).toBe(config.supabaseSecretKey);
    expect(JSON.parse(init.body)).toEqual({ p_worker_id: workerId, p_limit: 1, p_lease_seconds: 120 });
  });
  it("keeps a remote error uncertain through the real SDK without returning its contents", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private remote body", { status: 500 })));
    expect(await createShopifyWorkerStore(config).claim(workerId, new AbortController().signal)).toEqual({ ok: false });
  });
});
