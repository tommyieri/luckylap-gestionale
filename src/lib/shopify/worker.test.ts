import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { authorizedShopifyWorker, receiveShopifyWorkerTick, runShopifyWorker, SHOPIFY_WORKER_MAX_JOBS } from "./worker";
import { normalizeCanonicalShopifyOrder, type CanonicalReadResult } from "./canonical-model";
import { canonicalRawFixture } from "./canonical-fixtures";
import { shopifyWorkerConfig } from "./worker-config";
import type { ShopifyClaimedJob, ShopifyWorkerStore } from "./worker-store";
import type { ShopifyTokenProvider } from "./token";

const environment = { SHOPIFY_WORKER_ENABLED: "true", SHOPIFY_SHOP_DOMAIN: "synthetic.myshopify.com", SHOPIFY_CLIENT_ID: "synthetic-client-id",
  SHOPIFY_CLIENT_SECRET: "synthetic-client-secret", SHOPIFY_WORKER_SECRET: "synthetic-worker-secret-00000000000",
  NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_synthetic-server-only" };
const config = shopifyWorkerConfig(environment)!;
const workerId = "90000000-0000-4000-8000-000000000001";
const jobFixture = (): ShopifyClaimedJob => ({ job_id: "90000000-0000-4000-8000-000000000002", inbox_id: "90000000-0000-4000-8000-000000000003",
  lease_token: "90000000-0000-4000-8000-000000000004", shop_domain: config.expectedShopDomain, order_gid: "gid://shopify/Order/100", lease_expires_at: new Date(Date.now() + 120000).toISOString() });
function setup() {
  const job = jobFixture();
  const canonical = normalizeCanonicalShopifyOrder(canonicalRawFixture(), config.expectedShopDomain); if (canonical.status !== "ready") throw new Error("fixture");
  const claim = vi.fn().mockResolvedValueOnce({ ok: true, value: [job] }).mockResolvedValue({ ok: true, value: [] });
  const apply = vi.fn().mockResolvedValue({ ok: true, value: { job_id: job.job_id, status: "applied", reason: null } });
  const finish = vi.fn().mockImplementation(async (_job, status, reason) => ({ ok: true, value: { job_id: job.job_id, status, reason } }));
  const get = vi.fn().mockResolvedValue({ ok: true, token: "synthetic-admin-token-0000000000" });
  const invalidate = vi.fn(); const read = vi.fn().mockResolvedValue(canonical);
  const store: ShopifyWorkerStore = { claim, apply, finish }; const tokenProvider: ShopifyTokenProvider = { get, invalidate };
  return { job, canonical, claim, apply, finish, get, invalidate, read, dependencies: { store, tokenProvider, read, workerId: () => workerId } };
}
const request = (authorization = `Bearer ${config.workerSecret}`, signal?: AbortSignal) => new Request("https://synthetic.test/api/integrations/shopify/worker?limit=999&shop=hostile.test", {
  method: "POST", headers: { authorization }, body: JSON.stringify({ job_id: "caller-controlled", token: "private-input" }), signal,
});
afterEach(() => vi.useRealTimers());

describe("Shopify worker technical HTTP boundary", () => {
  it("requires explicit complete configuration before any claim or token grant", async () => {
    const state = setup(); const incoming = request(); const reader = vi.spyOn(incoming, "text");
    const response = await receiveShopifyWorkerTick(incoming, { ...state.dependencies, environment: {} });
    expect(response.status).toBe(503); expect(response.headers.get("retry-after")).toBe("60");
    expect(state.claim).not.toHaveBeenCalled(); expect(state.get).not.toHaveBeenCalled(); expect(reader).not.toHaveBeenCalled();
  });
  it.each(["", "bearer " + config.workerSecret, "Bearer wrong", "Bearer " + config.workerSecret + "extra", "x".repeat(600)])(
    "rejects invalid technical authorization without accepting cookies or body credentials %s", async (authorization) => {
      const state = setup(); const response = await receiveShopifyWorkerTick(request(authorization), { ...state.dependencies, environment });
      expect(response.status).toBe(401); expect(state.claim).not.toHaveBeenCalled(); expect(state.get).not.toHaveBeenCalled();
    });
  it("compares only the exact bounded bearer secret", () => {
    expect(authorizedShopifyWorker(`Bearer ${config.workerSecret}`, config.workerSecret)).toBe(true);
    expect(authorizedShopifyWorker(null, config.workerSecret)).toBe(false);
  });
  it("waits for apply and returns only aggregate states, ignoring caller scope/body", async () => {
    const state = setup(); let commit!: (value: unknown) => void;
    state.apply.mockImplementation(() => new Promise(resolve => { commit = resolve; }));
    let returned = false;
    const pending = receiveShopifyWorkerTick(request(), { ...state.dependencies, environment }).then(response => { returned = true; return response; });
    await vi.waitFor(() => expect(state.apply).toHaveBeenCalledOnce()); expect(returned).toBe(false);
    expect(state.apply.mock.calls[0]![0]).toEqual(state.job); expect(state.apply.mock.calls[0]![1]).toEqual(state.canonical.order);
    commit({ ok: true, value: { job_id: state.job.job_id, status: "applied", reason: null } });
    const response = await pending; expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text(); expect(JSON.parse(body)).toMatchObject({ processed: true, counts: { claimed: 1, applied: 1 } });
    expect(body).not.toMatch(/synthetic|admin-token|lease_token|order_gid|private-input|clientSecret|sb_secret/);
  });
});

describe("Shopify lease → canonical read → atomic apply orchestration", () => {
  it("does not obtain an access token when there is no durable work", async () => {
    const state = setup(); state.claim.mockReset().mockResolvedValue({ ok: true, value: [] });
    const result = await runShopifyWorker(config, new AbortController().signal, state.dependencies);
    expect(result.status).toBe("complete"); expect(state.get).not.toHaveBeenCalled(); expect(state.read).not.toHaveBeenCalled();
  });
  it("never sends a token to a job from a different shop", async () => {
    const state = setup(); state.job.shop_domain = "foreign.myshopify.com";
    const result = await runShopifyWorker(config, new AbortController().signal, state.dependencies);
    expect(result.counts.review).toBe(1); expect(state.get).not.toHaveBeenCalled(); expect(state.read).not.toHaveBeenCalled();
    expect(state.finish.mock.calls[0]!.slice(1, 4)).toEqual(["review", "shop_mismatch", 60]);
  });
  it("does not use an expired or nearly expired lease", async () => {
    const state = setup(); state.job.lease_expires_at = new Date(Date.now() - 1).toISOString();
    expect((await runShopifyWorker(config, new AbortController().signal, state.dependencies)).status).toBe("uncertain");
    expect(state.get).not.toHaveBeenCalled(); expect(state.apply).not.toHaveBeenCalled(); expect(state.finish).not.toHaveBeenCalled();
  });
  it.each(["applied", "replayed", "stale", "ignored", "review", "retry"])("accepts an already-committed apply %s without calling finish", async (status) => {
    const state = setup(); state.apply.mockResolvedValue({ ok: true, value: { job_id: state.job.job_id, status, reason: null } });
    const result = await runShopifyWorker(config, new AbortController().signal, state.dependencies);
    expect(result.status).toBe("complete"); expect(result.counts[status as keyof typeof result.counts]).toBe(1); expect(state.finish).not.toHaveBeenCalled();
  });
  it.each([["review", "invalid_money", "review", 60], ["unavailable", "timeout", "retry", 60],
    ["unavailable", "snapshot_changed", "retry", 60], ["unavailable", "throttled", "retry", 120]])(
    "persists a reader %s/%s as %s with retry seconds %s", async (status, code, expected, seconds) => {
      const state = setup(); state.read.mockResolvedValue({ status, code, message: "private response must not persist" });
      const result = await runShopifyWorker(config, new AbortController().signal, state.dependencies);
      expect(result.status).toBe("complete"); expect(state.apply).not.toHaveBeenCalled();
      expect(state.finish.mock.calls[0]!.slice(1, 4)).toEqual([expected, code, seconds]);
    });
  it.each([["token_unavailable", "retry", 60], ["token_throttled", "retry", 120], ["token_access_denied", "review", 60], ["token_invalid_response", "review", 60]])(
    "persists token failure %s as %s", async (code, outcome, seconds) => {
      const state = setup(); state.get.mockResolvedValue({ ok: false, code });
      expect((await runShopifyWorker(config, new AbortController().signal, state.dependencies)).status).toBe("complete");
      expect(state.read).not.toHaveBeenCalled(); expect(state.apply).not.toHaveBeenCalled();
      expect(state.finish.mock.calls[0]!.slice(1, 4)).toEqual([outcome, code, seconds]);
    });
  it("renews at most once after access denied, then leaves review instead of an infinite token loop", async () => {
    const state = setup(); state.read.mockResolvedValue({ status: "unavailable", code: "access_denied", message: "" });
    const result = await runShopifyWorker(config, new AbortController().signal, state.dependencies);
    expect(result.counts.review).toBe(1); expect(state.invalidate).toHaveBeenCalledOnce(); expect(state.get).toHaveBeenCalledTimes(2);
    expect(state.read).toHaveBeenCalledTimes(2); expect(state.apply).not.toHaveBeenCalled();
  });
  it("uses the renewed token only when a fresh read succeeds", async () => {
    const state = setup(); state.read.mockResolvedValueOnce({ status: "unavailable", code: "access_denied", message: "" }).mockResolvedValue(state.canonical);
    state.get.mockResolvedValueOnce({ ok: true, token: "synthetic-first-admin-token" }).mockResolvedValueOnce({ ok: true, token: "synthetic-renewed-admin-token" });
    const result = await runShopifyWorker(config, new AbortController().signal, state.dependencies);
    expect(result.counts.applied).toBe(1); expect(state.read.mock.calls[1]![0]).toMatchObject({ adminToken: "synthetic-renewed-admin-token" });
    expect(state.finish).not.toHaveBeenCalled();
  });
  it("puts a transient failed token renewal back into durable retry", async () => {
    const state = setup(); state.read.mockResolvedValue({ status: "unavailable", code: "access_denied", message: "" });
    state.get.mockResolvedValueOnce({ ok: true, token: "synthetic-first-admin-token" }).mockResolvedValueOnce({ ok: false, code: "token_unavailable" });
    const result = await runShopifyWorker(config, new AbortController().signal, state.dependencies);
    expect(result.counts.retry).toBe(1); expect(state.read).toHaveBeenCalledOnce(); expect(state.apply).not.toHaveBeenCalled();
  });
  it("rejects a ready DTO for a foreign order before atomic apply", async () => {
    const state = setup(); state.read.mockResolvedValue({ ...state.canonical, order: { ...state.canonical.order, orderId: "gid://shopify/Order/999" } });
    const result = await runShopifyWorker(config, new AbortController().signal, state.dependencies);
    expect(result.counts.review).toBe(1); expect(state.apply).not.toHaveBeenCalled();
    expect(state.finish.mock.calls[0]!.slice(1, 3)).toEqual(["review", "canonical_identity_mismatch"]);
  });
  it.each(["rejected", "thrown", "timeout"])("leaves an ambiguous apply %s to its lease, never overwriting with finish", async (mode) => {
    const state = setup();
    if (mode === "rejected") state.apply.mockResolvedValue({ ok: false });
    else if (mode === "thrown") state.apply.mockRejectedValue(new Error("private database response"));
    else { vi.useFakeTimers(); state.apply.mockImplementation(() => new Promise(() => undefined)); }
    const pending = runShopifyWorker(config, new AbortController().signal, state.dependencies);
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(4000);
    const result = await pending; expect(result.status).toBe("uncertain"); expect(result.counts.applied).toBe(0);
    expect(state.claim).toHaveBeenCalledOnce(); expect(state.finish).not.toHaveBeenCalled();
    if (mode === "timeout") expect((state.apply.mock.calls[0]![2] as AbortSignal).aborted).toBe(true);
  });
  it("leaves an uncertain finish untouched and does not claim another job", async () => {
    const state = setup(); state.read.mockResolvedValue({ status: "unavailable", code: "timeout", message: "" }); state.finish.mockResolvedValue({ ok: false });
    const result = await runShopifyWorker(config, new AbortController().signal, state.dependencies);
    expect(result.status).toBe("uncertain"); expect(state.claim).toHaveBeenCalledOnce(); expect(state.apply).not.toHaveBeenCalled();
  });
  it("limits every tick to three sequential claims", async () => {
    const state = setup(); state.claim.mockReset().mockResolvedValue({ ok: true, value: [state.job] });
    const result = await runShopifyWorker(config, new AbortController().signal, state.dependencies);
    expect(result.counts.applied).toBe(SHOPIFY_WORKER_MAX_JOBS); expect(state.claim).toHaveBeenCalledTimes(SHOPIFY_WORKER_MAX_JOBS);
  });
  it("does not claim additional work once a full read/commit budget is unavailable", async () => {
    const state = setup(); let time = 0;
    state.read.mockImplementation(async () => { time += 20000; return state.canonical; });
    const result = await runShopifyWorker(config, new AbortController().signal, { ...state.dependencies, now: () => time });
    expect(result).toMatchObject({ status: "complete", budgetLimited: true, counts: { claimed: 1, applied: 1 } }); expect(state.claim).toHaveBeenCalledOnce();
  });
  it("bounds a stalled claim without fetching an order", async () => {
    vi.useFakeTimers(); const state = setup(); state.claim.mockReset().mockImplementation(() => new Promise(() => undefined));
    const pending = runShopifyWorker(config, new AbortController().signal, state.dependencies);
    await vi.advanceTimersByTimeAsync(4000); expect((await pending).status).toBe("uncertain"); expect(state.get).not.toHaveBeenCalled();
  });
  it("bounds a stalled reader and durably schedules a retry", async () => {
    vi.useFakeTimers(); const state = setup(); state.read.mockImplementation(() => new Promise<CanonicalReadResult>(() => undefined));
    const pending = runShopifyWorker(config, new AbortController().signal, state.dependencies);
    await vi.advanceTimersByTimeAsync(15000); expect((await pending).counts.retry).toBe(1); expect(state.apply).not.toHaveBeenCalled();
  });
  it("returns a safe 503 after ambiguous persistence without disclosing raw failures", async () => {
    const state = setup(); state.apply.mockRejectedValue(new Error("sb_secret_private raw payload"));
    const response = await receiveShopifyWorkerTick(request(), { ...state.dependencies, environment });
    expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/sb_secret|payload|private|lease/);
  });
  it("stops on a disconnected caller without finishing or applying an unconfirmed job", async () => {
    const state = setup(); const controller = new AbortController();
    state.read.mockImplementation(async () => { controller.abort(); return state.canonical; });
    expect((await runShopifyWorker(config, controller.signal, state.dependencies)).status).toBe("uncertain");
    expect(state.apply).not.toHaveBeenCalled(); expect(state.finish).not.toHaveBeenCalled();
  });
});
