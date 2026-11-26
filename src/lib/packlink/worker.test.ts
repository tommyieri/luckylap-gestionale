import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { authorizedPacklinkWorker, receivePacklinkWorkerTick, runPacklinkWorker } from "./worker";
import { packlinkWorkerConfig } from "./worker-config";
import type { PacklinkClaim, PacklinkWorkerStore } from "./worker-store";

const environment = {
  PACKLINK_WORKER_ENABLED: "true",
  PACKLINK_API_KEY: "synthetic-packlink-key-000000000000",
  PACKLINK_WORKER_SECRET: "synthetic-packlink-worker-000000000000",
  NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_synthetic-technical-key",
};
const config = packlinkWorkerConfig(environment)!;
const workerId = "a1000000-0000-4000-8000-000000000001";
function setup() {
  const claim: PacklinkClaim = {
    connection_id: "a1000000-0000-4000-8000-000000000002",
    expected_client_id: "synthetic-client",
    shop_domain: "synthetic.myshopify.com",
    cutover_at: "2030-01-01T12:00:00.123456Z",
    lease_token: "a1000000-0000-4000-8000-000000000003",
    lease_expires_at: new Date(Date.now() + 120000).toISOString(),
  };
  const transaction = {
    provider_transaction_id: "synthetic-payment-1",
    provider_type: "LABELS_ORDER" as const,
    amount_cents: 731,
    currency: "EUR" as const,
    occurred_at: "2030-01-03T10:00:00.000Z",
    shipment_references: ["SYNTHETIC_REF_1"],
    shopify_order_gid: null,
  };
  const claimFn = vi.fn().mockResolvedValue({ ok: true, value: claim });
  const apply = vi.fn().mockResolvedValue({
    ok: true,
    value: { status: "applied", reason: null, inserted: 1, replayed: 0, ignored: 0 },
  });
  const finish = vi.fn().mockImplementation(async (_claim, status, reason) => ({
    ok: true,
    value: { status, reason, inserted: 0, replayed: 0, ignored: 0 },
  }));
  const read = vi.fn().mockResolvedValue({
    status: "ready",
    clientId: claim.expected_client_id,
    transactions: [transaction],
  });
  const store: PacklinkWorkerStore = { claim: claimFn, apply, finish };
  return {
    claim,
    claimFn,
    apply,
    finish,
    read,
    transaction,
    dependencies: { store, read, workerId: () => workerId },
  };
}
const request = (header = `Bearer ${config.workerSecret}`, signal?: AbortSignal) =>
  new Request(
    "https://synthetic.test/api/integrations/packlink/worker?account=untrusted&from=1900-01-01",
    {
      method: "POST",
      headers: { authorization: header, cookie: "untrusted=1" },
      body: '{"apiKey":"caller-controlled","account":"untrusted"}',
      signal,
    },
  );
afterEach(() => vi.useRealTimers());

describe("Packlink worker configuration and HTTP boundary", () => {
  it.each([
    {},
    { ...environment, PACKLINK_WORKER_ENABLED: "false" },
    { ...environment, PACKLINK_API_KEY: "" },
    { ...environment, PACKLINK_API_KEY: "bad\nheader-synthetic" },
    { ...environment, PACKLINK_WORKER_SECRET: "short" },
    { ...environment, NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co/path" },
    { ...environment, SUPABASE_SECRET_KEY: "public-key" },
  ])("remains disabled with incomplete or unsafe credentials", async (env) => {
    expect(packlinkWorkerConfig(env)).toBeNull();
    const s = setup();
    const response = await receivePacklinkWorkerTick(request(), {
      ...s.dependencies,
      environment: env,
    });
    expect(response.status).toBe(503);
    expect(s.claimFn).not.toHaveBeenCalled();
  });
  it.each([
    "",
    "Bearer wrong",
    `bearer ${config.workerSecret}`,
    `Bearer ${config.workerSecret}extra`,
    "x".repeat(600),
  ])("rejects an invalid bearer before reading the provider", async (header) => {
    const s = setup();
    const response = await receivePacklinkWorkerTick(request(header), {
      ...s.dependencies,
      environment,
    });
    expect(response.status).toBe(401);
    expect(s.claimFn).not.toHaveBeenCalled();
    expect(s.read).not.toHaveBeenCalled();
  });
  it("uses only the exact technical bearer", () => {
    expect(authorizedPacklinkWorker(`Bearer ${config.workerSecret}`, config.workerSecret)).toBe(
      true,
    );
    expect(authorizedPacklinkWorker(null, config.workerSecret)).toBe(false);
  });
  it("ignores caller scope and waits for a durable apply before reporting success", async () => {
    const s = setup();
    let commit!: (value: unknown) => void;
    s.apply.mockImplementation(
      () =>
        new Promise((resolve) => {
          commit = resolve;
        }),
    );
    const incoming = request();
    const bodyReader = vi.spyOn(incoming, "text");
    let returned = false;
    const pending = receivePacklinkWorkerTick(incoming, { ...s.dependencies, environment }).then(
      (r) => {
        returned = true;
        return r;
      },
    );
    await vi.waitFor(() => expect(s.apply).toHaveBeenCalledOnce());
    expect(returned).toBe(false);
    expect(bodyReader).not.toHaveBeenCalled();
    expect(s.read.mock.calls[0]![0]).toMatchObject({
      apiKey: config.apiKey,
      expectedClientId: s.claim.expected_client_id,
      cutoverAt: s.claim.cutover_at,
    });
    expect(s.apply.mock.calls[0]![1]).toEqual({
      schema_version: 1,
      client_id: s.claim.expected_client_id,
      transactions: [s.transaction],
    });
    commit({
      ok: true,
      value: { status: "applied", reason: null, inserted: 1, replayed: 0, ignored: 0 },
    });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      processed: true,
      outcome: "applied",
      counts: { inserted: 1, replayed: 0, ignored: 0 },
    });
    expect(text).not.toMatch(/synthetic|lease|client|credential|apiKey|secret/);
    expect(s.finish).not.toHaveBeenCalled();
  });
});
describe("Packlink lease and complete snapshot orchestration", () => {
  it("does no provider read if another worker owns the lease or configuration is disabled", async () => {
    const s = setup();
    s.claimFn.mockResolvedValue({ ok: true, value: null });
    expect(
      await runPacklinkWorker(config, new AbortController().signal, s.dependencies),
    ).toMatchObject({ status: "complete", outcome: "idle" });
    expect(s.read).not.toHaveBeenCalled();
  });
  it("does not use a lease with insufficient time", async () => {
    const s = setup();
    s.claim.lease_expires_at = new Date(Date.now() + 10000).toISOString();
    expect(
      await runPacklinkWorker(config, new AbortController().signal, s.dependencies),
    ).toMatchObject({ status: "uncertain" });
    expect(s.read).not.toHaveBeenCalled();
    expect(s.apply).not.toHaveBeenCalled();
  });
  it.each(["review", "retry"] as const)(
    "persists a sanitized %s provider failure without importing partial rows",
    async (status) => {
      const s = setup();
      s.read.mockResolvedValue({
        status,
        code: status === "review" ? "account_mismatch" : "throttled",
      });
      expect(
        await runPacklinkWorker(config, new AbortController().signal, s.dependencies),
      ).toMatchObject({ status: "complete", outcome: status });
      expect(s.apply).not.toHaveBeenCalled();
      expect(s.finish).toHaveBeenCalledOnce();
    },
  );
  it("checks the returned account again at the orchestration boundary", async () => {
    const s = setup();
    s.read.mockResolvedValue({
      status: "ready",
      clientId: "other-synthetic-client",
      transactions: [s.transaction],
    });
    expect(
      await runPacklinkWorker(config, new AbortController().signal, s.dependencies),
    ).toMatchObject({ outcome: "review" });
    expect(s.apply).not.toHaveBeenCalled();
    expect(s.finish.mock.calls[0]!.slice(1, 3)).toEqual(["review", "account_mismatch"]);
  });
  it.each(["false", "throw"])(
    "leaves a lost apply response uncertain (%s), without overwriting a possible commit",
    async (mode) => {
      const s = setup();
      if (mode === "throw") s.apply.mockRejectedValue(new Error("synthetic transport loss"));
      else s.apply.mockResolvedValue({ ok: false });
      expect(
        await runPacklinkWorker(config, new AbortController().signal, s.dependencies),
      ).toMatchObject({ status: "uncertain" });
      expect(s.finish).not.toHaveBeenCalled();
    },
  );
  it("does not finalize a terminal DB review a second time", async () => {
    const s = setup();
    s.apply.mockResolvedValue({
      ok: true,
      value: {
        status: "review",
        reason: "transaction_conflict",
        inserted: 0,
        replayed: 0,
        ignored: 0,
      },
    });
    expect(
      await runPacklinkWorker(config, new AbortController().signal, s.dependencies),
    ).toMatchObject({ status: "complete", outcome: "review" });
    expect(s.finish).not.toHaveBeenCalled();
  });
  it("stops before claiming for an already aborted request", async () => {
    const s = setup();
    const controller = new AbortController();
    controller.abort();
    expect(await runPacklinkWorker(config, controller.signal, s.dependencies)).toMatchObject({
      status: "uncertain",
    });
    expect(s.claimFn).not.toHaveBeenCalled();
  });
  it("bounds an uncooperative read and records retry after timeout", async () => {
    vi.useFakeTimers();
    const s = setup();
    s.read.mockImplementation(() => new Promise(() => {}));
    const pending = runPacklinkWorker(config, new AbortController().signal, s.dependencies);
    await vi.advanceTimersByTimeAsync(35001);
    expect(await pending).toMatchObject({ status: "complete", outcome: "retry" });
    expect(s.apply).not.toHaveBeenCalled();
  });
});
