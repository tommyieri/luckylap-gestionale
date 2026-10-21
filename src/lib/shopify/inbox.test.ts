import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), abortSignal: vi.fn(), rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import { persistShopifyNotification, shopifyReceiverConfig } from "./inbox";
import type { ShopifyOrderNotification } from "./webhook";
const env = { SHOPIFY_SHOP_DOMAIN: "synthetic.myshopify.com", SHOPIFY_CLIENT_SECRET: "synthetic-secret",
  NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_synthetic-private" };
const cue: ShopifyOrderNotification = { shopDomain: env.SHOPIFY_SHOP_DOMAIN, webhookId: "90000000-0000-4000-8000-000000000001", eventId: null,
  deliveryKey: `${env.SHOPIFY_SHOP_DOMAIN}:90000000-0000-4000-8000-000000000001`, apiVersion: "2026-10", topic: "orders/create",
  orderGid: "gid://shopify/Order/123", sourceName: "web", channel: "shopify_web", currency: "EUR", sourceCreatedAt: "2026-10-21T11:00:00Z",
  sourceUpdatedAt: "2026-10-21T11:00:00Z", bodySha256: "a".repeat(64), requiresCanonicalRead: true };
const receipt = { inbox_id: "90000000-0000-4000-8000-000000000002", job_id: "90000000-0000-4000-8000-000000000003",
  received_at: "2026-10-21T11:00:00+00:00", state: "awaiting_app", replayed: false };
beforeEach(() => { vi.clearAllMocks(); mocks.createClient.mockReturnValue({ rpc: mocks.rpc }); mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal }); });
describe("server-only Shopify inbox persistence", () => {
  it("uses an isolated secret-key client and one atomic RPC without caller cookies", async () => {
    mocks.abortSignal.mockResolvedValue({ data: receipt, error: null }); const config = shopifyReceiverConfig(env)!; const signal = new AbortController().signal;
    expect(await persistShopifyNotification(cue, config, signal)).toEqual({ ok: true, receipt });
    expect(mocks.createClient).toHaveBeenCalledWith(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("receive_shopify_order_notification", { p_cue: cue });
    expect(mocks.abortSignal).toHaveBeenCalledWith(signal);
  });
  it.each([null, { ...receipt, state: "synced" }, { ...receipt, job_id: null }, { ...receipt, raw_body: "private" }])(
    "fails closed on an incomplete or unexpected receipt (%j)", async (data) => {
      mocks.abortSignal.mockResolvedValue({ data, error: null });
      expect(await persistShopifyNotification(cue, shopifyReceiverConfig(env)!, new AbortController().signal))
        .toEqual({ ok: false, error: "persistence_unavailable" });
    });
  it("recognizes only the exact safe conflict and does not return database details", async () => {
    mocks.abortSignal.mockResolvedValue({ data: null, error: { code: "22023", message: "shopify_delivery_conflict" } });
    expect(await persistShopifyNotification(cue, shopifyReceiverConfig(env)!, new AbortController().signal)).toEqual({ ok: false, error: "delivery_conflict" });
    mocks.abortSignal.mockResolvedValue({ data: null, error: { code: "42501", message: "private sql secret" } });
    expect(await persistShopifyNotification(cue, shopifyReceiverConfig(env)!, new AbortController().signal)).toEqual({ ok: false, error: "persistence_unavailable" });
  });
  it.each([{ SUPABASE_SECRET_KEY: "sb_publishable_private-is-not-public" }, { SUPABASE_SECRET_KEY: "legacy-or-random-key" },
    { SHOPIFY_SHOP_DOMAIN: "custom.test" }, { SHOPIFY_CLIENT_SECRET: "" }, { NEXT_PUBLIC_SUPABASE_URL: "http://remote.test" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://user:password@synthetic.supabase.co" }, { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co/path" }])(
    "rejects invalid or public credentials (%j)", (change) => { expect(shopifyReceiverConfig({ ...env, ...change })).toBeNull(); });
});
