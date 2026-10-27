import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createWorkerRpcFetch, safeWorkerReason, workerRecord, workerUuid } from "./worker-io";

// Shared by the Shopify worker and the Partner assistant: only the parameters differ.
const supabaseUrl = "https://synthetic.supabase.co";
const options = {
  supabaseUrl,
  rpcNames: ["first_synthetic_rpc", "second_synthetic_rpc"],
  timeoutMs: 1234,
  maxResponseBytes: 256,
};
const rpcUrl = (name: string) => `${supabaseUrl}/rest/v1/rpc/${name}`;
const firstUrl = rpcUrl("first_synthetic_rpc");
const init = (extra: RequestInit = {}): RequestInit => ({
  method: "POST",
  headers: { apikey: "sb_secret_synthetic-private" },
  signal: new AbortController().signal,
  ...extra,
});
const ok = { status: "ok" };
afterEach(() => vi.useRealTimers());

describe("shared worker RPC transport", () => {
  it.each(options.rpcNames)(
    "posts only to the listed path %s, without redirects, cookies or caching",
    async (name) => {
      const fetcher = vi.fn().mockResolvedValue(Response.json(ok));
      const response = await createWorkerRpcFetch(options, fetcher)(rpcUrl(name), init());
      expect(await response.json()).toEqual(ok);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(String(fetcher.mock.calls[0]![0])).toBe(rpcUrl(name));
      expect(fetcher.mock.calls[0]![1]).toMatchObject({
        method: "POST",
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
      });
    },
  );
  it.each<[string, string, RequestInit]>([
    ["another listed set", rpcUrl("claim_shopify_order_jobs"), {}],
    ["another origin", "https://attacker.test/rest/v1/rpc/first_synthetic_rpc", {}],
    ["http", firstUrl.replace("https://", "http://"), {}],
    ["a table", `${supabaseUrl}/rest/v1/partners`, {}],
    ["a trailing slash", `${firstUrl}/`, {}],
    ["a query", `${firstUrl}?apikey=private`, {}],
    ["a fragment", `${firstUrl}#x`, {}],
    ["URL credentials", firstUrl.replace("https://", "https://user:pass@"), {}],
    ["GET", firstUrl, { method: "GET" }],
    ["no signal", firstUrl, { signal: undefined }],
  ])("%s: worker_transport_invalid before the key leaves", async (_, url, change) => {
    const fetcher = vi.fn();
    await expect(createWorkerRpcFetch(options, fetcher)(url, init(change))).rejects.toThrow(
      "worker_transport_invalid",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("leaves the request body unchecked without a request limit", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json(ok));
    const transport = createWorkerRpcFetch(options, fetcher);
    for (const body of [undefined, new Blob(["{}"]), "a".repeat(10 * 1024)])
      expect((await transport(firstUrl, init({ body }))).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("with a request limit, accepts only text counted in UTF-8 bytes", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json(ok));
    const transport = createWorkerRpcFetch({ ...options, maxRequestBytes: 12 }, fetcher);
    expect((await transport(firstUrl, init({ body: "a".repeat(12) }))).status).toBe(200);
    for (const body of [undefined, new Blob(["{}"]), "a".repeat(13), "€".repeat(5)])
      await expect(transport(firstUrl, init({ body }))).rejects.toThrow("worker_transport_invalid");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([302, 401, 500])(
    "a %s: body cancelled unread, PostgREST gets only a generic error",
    async (status) => {
      const response = new Response("apikey=private SQL internal value", {
        status,
        headers: { location: "https://attacker.test" },
      });
      const read = vi.spyOn(response.body!, "getReader");
      const received = await createWorkerRpcFetch(options, vi.fn().mockResolvedValue(response))(
        firstUrl,
        init(),
      );
      expect(received.status).toBe(status);
      expect(await received.text()).not.toMatch(/apikey|private|internal|attacker/);
      expect(read).not.toHaveBeenCalled();
      expect(received.headers.get("location")).toBeNull();
    },
  );
  it("rejects a successful status other than 200", async () => {
    await expect(
      createWorkerRpcFetch(options, vi.fn().mockResolvedValue(new Response(null, { status: 204 })))(
        firstUrl,
        init(),
      ),
    ).rejects.toThrow("worker_response_invalid");
  });
  it("reads the response up to its own byte limit, even when Content-Length lies", async () => {
    const stream = (size: number) =>
      new Response(
        new ReadableStream({
          start(controller) {
            const bytes = new Uint8Array(size).fill(0x20);
            bytes.set(new TextEncoder().encode("{}"));
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        { headers: { "content-length": "1" } },
      );
    const transport = (response: Response) =>
      createWorkerRpcFetch(options, vi.fn().mockResolvedValue(response))(firstUrl, init());
    expect(await (await transport(stream(options.maxResponseBytes))).json()).toEqual({});
    await expect(transport(stream(options.maxResponseBytes + 1))).rejects.toThrow(
      "worker_response_invalid",
    );
  });
  it("stops a stalled response at its own timeout", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream()));
    let settled = false;
    const pending = createWorkerRpcFetch(options, fetcher)(firstUrl, init());
    pending.then(
      () => (settled = true),
      () => (settled = true),
    );
    const assertion = expect(pending).rejects.toThrow("worker_aborted");
    await vi.advanceTimersByTimeAsync(options.timeoutMs - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });
});

describe("shared worker row checks", () => {
  it.each<[unknown, boolean]>([
    ["90000000-0000-4000-8000-000000000001", true],
    ["90000000-0000-4000-8000-00000000000A", true],
    ["00000000-0000-0000-0000-000000000000", false],
    ["90000000-0000-4000-8000-00000000001", false],
    ["90000000000040008000000000000001", false],
    [1, false],
    [null, false],
  ])("workerUuid(%j) is %s", (value, expected) => expect(workerUuid(value)).toBe(expected));
  it.each<[unknown, boolean]>([
    [{}, true],
    [{ a: 1 }, true],
    [[], false],
    [null, false],
    ["{}", false],
    [0, false],
  ])("workerRecord(%j) is an object: %s", (value, expected) =>
    expect(workerRecord(value) !== null).toBe(expected),
  );
  it.each<[unknown, boolean]>([
    ["shopify_token_unavailable", true],
    ["a", true],
    ["a".repeat(80), true],
    ["a".repeat(81), false],
    ["Maiuscola", false],
    ["1numero", false],
    ["con spazio", false],
    ["info@example.test", false],
    ["", false],
    [null, false],
  ])("safeWorkerReason(%j) is %s", (value, expected) =>
    expect(safeWorkerReason(value)).toBe(expected),
  );
});
