import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import {
  createShopifyWorkerFetch,
  createShopifyWorkerStore,
  SHOPIFY_WORKER_RPC_MAX_BYTES,
  shopifyClaimFrom,
  shopifyWorkerReceiptFrom,
} from "./worker-store";
import { normalizeCanonicalShopifyOrder } from "./canonical-model";
import { canonicalRawFixture } from "./canonical-fixtures";

const config = {
  expectedShopDomain: "synthetic.myshopify.com",
  clientId: "synthetic-client-id",
  clientSecret: "synthetic-client-secret",
  workerSecret: "synthetic-worker-secret-0000000000",
  supabaseUrl: "https://synthetic.supabase.co",
  supabaseSecretKey: "sb_secret_synthetic-private",
};
const workerId = "90000000-0000-4000-8000-000000000001";
const job = {
  job_id: "90000000-0000-4000-8000-000000000002",
  inbox_id: "90000000-0000-4000-8000-000000000003",
  lease_token: "90000000-0000-4000-8000-000000000004",
  shop_domain: config.expectedShopDomain,
  order_gid: "gid://shopify/Order/100",
  lease_expires_at: "2026-10-21T15:00:00Z",
};
const receipt = {
  job_id: job.job_id,
  status: "applied",
  reason: null,
  order_id: "90000000-0000-4000-8000-000000000005",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal });
});
afterEach(() => vi.useRealTimers());
describe("Shopify worker service RPC boundary", () => {
  it("uses an isolated private client and claims exactly one lease with a bounded duration", async () => {
    mocks.abortSignal.mockResolvedValue({ data: [job], error: null });
    const signal = new AbortController().signal;
    expect(await createShopifyWorkerStore(config).claim(workerId, signal)).toEqual({
      ok: true,
      value: [job],
    });
    expect(mocks.createClient).toHaveBeenCalledExactlyOnceWith(
      config.supabaseUrl,
      config.supabaseSecretKey,
      {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: expect.any(Function) },
      },
    );
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("claim_shopify_order_jobs", {
      p_worker_id: workerId,
      p_limit: 1,
      p_lease_seconds: 120,
    });
    expect(mocks.abortSignal).toHaveBeenCalledWith(signal);
  });
  it("sends the unchanged canonical DTO and existing lease for atomic apply", async () => {
    const canonical = normalizeCanonicalShopifyOrder(
      canonicalRawFixture(),
      config.expectedShopDomain,
    );
    if (canonical.status !== "ready") throw new Error("fixture");
    mocks.abortSignal.mockResolvedValue({ data: receipt, error: null });
    const signal = new AbortController().signal;
    expect(await createShopifyWorkerStore(config).apply(job, canonical.order, signal)).toEqual({
      ok: true,
      value: receipt,
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("apply_shopify_order", {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_canonical: canonical.order,
    });
  });
  it("validates that finish confirms the exact requested durable outcome", async () => {
    const finished = { job_id: job.job_id, status: "retry", reason: "throttled" };
    mocks.abortSignal.mockResolvedValue({ data: finished, error: null });
    const signal = new AbortController().signal;
    expect(
      await createShopifyWorkerStore(config).finish(job, "retry", "throttled", 120, signal),
    ).toEqual({ ok: true, value: finished });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("finish_shopify_read_job", {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_outcome: "retry",
      p_reason: "throttled",
      p_retry_seconds: 120,
    });
    mocks.abortSignal.mockResolvedValue({ data: { ...finished, status: "applied" }, error: null });
    expect(
      await createShopifyWorkerStore(config).finish(job, "retry", "throttled", 120, signal),
    ).toEqual({ ok: false });
  });
  it.each([
    null,
    {},
    [job, job],
    [{ ...job, lease_token: null }],
    [{ ...job, order_gid: "gid://shopify/Product/1" }],
    [{ ...job, shop_domain: "hostile.test" }],
    [{ ...job, lease_expires_at: "invalid" }],
    [{ ...job, customer: "private" }],
  ])("fails closed on malformed or oversized claims %j", (value) => {
    expect(shopifyClaimFrom(value)).toBeNull();
  });
  it.each([
    null,
    {},
    { ...receipt, job_id: workerId },
    { ...receipt, status: "synced" },
    { ...receipt, reason: "RAW error" },
    { ...receipt, order_id: "invalid" },
    { ...receipt, private_payload: "secret" },
  ])("never accepts an ambiguous, foreign or expanded receipt %j", (value) => {
    expect(shopifyWorkerReceiptFrom(value, job.job_id)).toBeNull();
  });
  it("returns no database error details and never treats a rejected RPC as confirmed", async () => {
    mocks.abortSignal.mockResolvedValue({
      data: [job],
      error: { code: "42501", message: "private sql credentials" },
    });
    expect(
      await createShopifyWorkerStore(config).claim(workerId, new AbortController().signal),
    ).toEqual({ ok: false });
    mocks.abortSignal.mockRejectedValue(new Error("private response"));
    expect(
      await createShopifyWorkerStore(config).claim(workerId, new AbortController().signal),
    ).toEqual({ ok: false });
  });
  it("rejects an unsafe reason before it can enter SQL", async () => {
    expect(
      await createShopifyWorkerStore(config).finish(
        job,
        "retry",
        "customer@example.test",
        60,
        new AbortController().signal,
      ),
    ).toEqual({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("Shopify worker private transport", () => {
  const rpcUrl = config.supabaseUrl + "/rest/v1/rpc/claim_shopify_order_jobs";
  const init = () => ({
    method: "POST",
    headers: { apikey: config.supabaseSecretKey },
    signal: new AbortController().signal,
  });
  it("uses only an exact RPC origin/path and disables redirects, cookies and caching", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([job]));
    expect(await (await createShopifyWorkerFetch(config, fetcher)(rpcUrl, init())).json()).toEqual([
      job,
    ]);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
    });
  });
  it.each([
    "https://attacker.test/rest/v1/rpc/claim_shopify_order_jobs",
    config.supabaseUrl + "/auth/v1/user",
    rpcUrl + "?secret=private",
    rpcUrl + "#fragment",
  ])("rejects an unapproved destination before sending a private key %s", async (url) => {
    const fetcher = vi.fn();
    await expect(createShopifyWorkerFetch(config, fetcher)(url, init())).rejects.toThrow(
      "worker_transport_invalid",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects a non-POST transport or missing abort signal", async () => {
    const fetcher = vi.fn();
    const transport = createShopifyWorkerFetch(config, fetcher);
    await expect(transport(rpcUrl, { ...init(), method: "GET" })).rejects.toThrow();
    await expect(transport(rpcUrl, { method: "POST" })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([302, 401, 500])(
    "cancels a %s body and passes only a generic error to PostgREST",
    async (status) => {
      const response = new Response("apikey=private SQL internal value", {
        status,
        headers: { location: "https://attacker.test" },
      });
      const read = vi.spyOn(response.body!, "getReader");
      const received = await createShopifyWorkerFetch(config, vi.fn().mockResolvedValue(response))(
        rpcUrl,
        init(),
      );
      expect(received.status).toBe(status);
      expect(await received.text()).not.toMatch(/apikey|private|internal|attacker/);
      expect(read).not.toHaveBeenCalled();
      expect(received.headers.get("location")).toBeNull();
    },
  );
  it("rejects oversized streamed bytes even when Content-Length lies", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(SHOPIFY_WORKER_RPC_MAX_BYTES));
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      }),
      { headers: { "content-length": "1" } },
    );
    await expect(
      createShopifyWorkerFetch(config, vi.fn().mockResolvedValue(response))(rpcUrl, init()),
    ).rejects.toThrow();
  });
  it("accepts a decoded RPC body with an upstream compressed Content-Length", async () => {
    const response = Response.json([job]);
    response.headers.set("content-encoding", "br");
    response.headers.set("content-length", "100");
    expect(
      await (
        await createShopifyWorkerFetch(config, vi.fn().mockResolvedValue(response))(rpcUrl, init())
      ).json(),
    ).toEqual([job]);
  });
  it("bounds a stalled response stream before the SDK can buffer it", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream()));
    const pending = createShopifyWorkerFetch(config, fetcher)(rpcUrl, init());
    const assertion = expect(pending).rejects.toThrow("worker_aborted");
    await vi.advanceTimersByTimeAsync(4000);
    await assertion;
  });
});
