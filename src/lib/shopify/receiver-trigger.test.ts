import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { receiveShopifyWebhookWithTrigger } from "./receiver-trigger";
const environment = {
  SHOPIFY_WORKER_ENABLED: "true",
  SHOPIFY_SHOP_DOMAIN: "synthetic.myshopify.com",
  SHOPIFY_CLIENT_ID: "synthetic-client-id",
  SHOPIFY_CLIENT_SECRET: "synthetic-client-secret",
  SHOPIFY_WORKER_SECRET: "synthetic-worker-secret-00000000000",
  NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_synthetic-server-only",
};
const incoming = () =>
  new Request("https://synthetic.test/api/integrations/shopify/webhook", {
    method: "POST",
    body: "synthetic",
  });
describe("Shopify post-response immediate trigger", () => {
  it("waits for persistence, acknowledges first and runs only the deferred bounded worker", async () => {
    let commit!: (value: Response) => void;
    const receive = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          commit = resolve;
        }),
    );
    const callbacks: (() => Promise<void>)[] = [];
    const schedule = vi.fn((callback) => {
      callbacks.push(callback);
    });
    const run = vi.fn().mockResolvedValue({ status: "complete" });
    let acknowledged = false;
    const pending = receiveShopifyWebhookWithTrigger(incoming(), schedule, {
      environment,
      receive,
      run,
    }).then((response) => {
      acknowledged = true;
      return response;
    });
    expect(schedule).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(acknowledged).toBe(false);
    const receipt = Response.json({ received: true, job_id: "synthetic-receipt" });
    commit(receipt);
    expect(await pending).toBe(receipt);
    expect(acknowledged).toBe(true);
    expect(schedule).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    await callbacks[0]!();
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]![0]).toMatchObject({
      expectedShopDomain: environment.SHOPIFY_SHOP_DOMAIN,
    });
    expect(run.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
  });
  it.each([400, 401, 409, 500, 503])(
    "never schedules work after receiver status %s",
    async (status) => {
      const schedule = vi.fn(),
        run = vi.fn();
      const response = new Response(null, { status });
      expect(
        await receiveShopifyWebhookWithTrigger(incoming(), schedule, {
          environment,
          receive: async () => response,
          run,
        }),
      ).toBe(response);
      expect(schedule).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );
  it("does not schedule if the explicit worker configuration is disabled", async () => {
    const schedule = vi.fn(),
      run = vi.fn();
    const response = Response.json({ received: true });
    await receiveShopifyWebhookWithTrigger(incoming(), schedule, {
      environment: { ...environment, SHOPIFY_WORKER_ENABLED: "false" },
      receive: async () => response,
      run,
    });
    expect(schedule).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
  it("keeps a committed receipt if after registration or execution fails", async () => {
    const response = Response.json({ received: true });
    expect(
      await receiveShopifyWebhookWithTrigger(
        incoming(),
        () => {
          throw new Error("private platform failure");
        },
        { environment, receive: async () => response },
      ),
    ).toBe(response);
    let callback!: () => Promise<void>;
    const run = vi.fn().mockRejectedValue(new Error("private worker failure"));
    expect(
      await receiveShopifyWebhookWithTrigger(
        incoming(),
        (next) => {
          callback = next;
        },
        { environment, receive: async () => response, run },
      ),
    ).toBe(response);
    await expect(callback()).resolves.toBeUndefined();
  });
  it("does not bind background work to the disconnected webhook caller", async () => {
    const controller = new AbortController();
    const request = new Request(incoming(), { signal: controller.signal });
    let callback!: () => Promise<void>;
    const run = vi.fn().mockResolvedValue({ status: "complete" });
    await receiveShopifyWebhookWithTrigger(
      request,
      (next) => {
        callback = next;
      },
      { environment, receive: async () => Response.json({ received: true }), run },
    );
    controller.abort();
    await callback();
    expect((run.mock.calls[0]![1] as AbortSignal).aborted).toBe(false);
  });
});
