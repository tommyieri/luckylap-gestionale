import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createPacklinkWorkerFetch, packlinkClaimFrom, packlinkReceiptFrom } from "./worker-store";
const claim = {
  connection_id: "a2000000-0000-4000-8000-000000000001",
  expected_client_id: "synthetic-client-1",
  shop_domain: "synthetic.myshopify.com",
  cutover_at: "2030-01-01T12:00:00.123456Z",
  lease_token: "a2000000-0000-4000-8000-000000000002",
  lease_expires_at: "2030-01-03T10:02:00Z",
};
describe("Packlink RPC shapes", () => {
  it("distinguishes a legitimate empty claim from malformed data", () => {
    expect(packlinkClaimFrom(null)).toBeNull();
    expect(packlinkClaimFrom(claim)).toEqual(claim);
    for (const value of [
      [],
      {},
      { ...claim, expected_client_id: "bad account" },
      { ...claim, connection_id: "bad" },
      { ...claim, lease_token: "00000000-0000-0000-0000-000000000000" },
      { ...claim, cutover_at: "2030-02-30T12:00:00Z" },
      { ...claim, shop_domain: "hostile.test" },
      { ...claim, api_key: "forbidden" },
    ])
      expect(packlinkClaimFrom(value)).toBe(false);
  });
  it("accepts only bounded durable counts with consistent outcomes", () => {
    const receipt = { status: "applied", reason: null, inserted: 2, replayed: 3, ignored: 1 };
    expect(packlinkReceiptFrom(receipt)).toEqual(receipt);
    for (const value of [
      { ...receipt, inserted: -1 },
      { ...receipt, replayed: 1001 },
      { ...receipt, inserted: 1.2 },
      { ...receipt, status: "review", reason: "conflict" },
      { ...receipt, reason: "raw error" },
      { ...receipt, token: "forbidden" },
    ])
      expect(packlinkReceiptFrom(value)).toBeNull();
    expect(
      packlinkReceiptFrom({
        status: "retry",
        reason: "throttled",
        inserted: 0,
        replayed: 0,
        ignored: 0,
      }),
    ).not.toBeNull();
  });
});
describe("Packlink service transport", () => {
  it("accepts a complete batch at the allowed transaction/reference bounds", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    const transport = createPacklinkWorkerFetch(
      { supabaseUrl: "https://synthetic.supabase.co" },
      fetcher,
    );
    const transactions = Array.from({ length: 1000 }, (_, index) => ({
      provider_transaction_id: `synthetic-${index}`.padEnd(120, "x"),
      provider_type: "LABELS_ORDER",
      amount_cents: 100000000,
      currency: "EUR",
      occurred_at: "2030-01-01T12:00:00.123456Z",
      shopify_order_gid: "gid://shopify/Order/18446744073709551615",
      shipment_references: Array.from({ length: 20 }, (_, ref) =>
        `SYNTHETIC_${ref}`.padEnd(100, "x"),
      ),
    }));
    await transport("https://synthetic.supabase.co/rest/v1/rpc/apply_packlink_transactions", {
      method: "POST",
      body: JSON.stringify({
        p_connection_id: claim.connection_id,
        p_lease_token: claim.lease_token,
        p_payload: { schema_version: 1, client_id: claim.expected_client_id, transactions },
      }),
      signal: new AbortController().signal,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("restricts the service credential to the three exact RPC paths and rejects redirects", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(null));
    const transport = createPacklinkWorkerFetch(
      { supabaseUrl: "https://synthetic.supabase.co" },
      fetcher,
    );
    const init = { method: "POST", body: "{}", signal: new AbortController().signal };
    await transport("https://synthetic.supabase.co/rest/v1/rpc/claim_packlink_sync", init);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    for (const path of [
      "https://hostile.test/rest/v1/rpc/claim_packlink_sync",
      "https://synthetic.supabase.co/rest/v1/rpc/apply_shopify_order",
      "https://synthetic.supabase.co/rest/v1/rpc/claim_packlink_sync?key=forbidden",
    ])
      await expect(transport(path, init)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("does not forward unbounded input or read an error body", async () => {
    const error = new Response("private synthetic error", { status: 500 });
    const reader = vi.spyOn(error, "text");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(error);
    const transport = createPacklinkWorkerFetch(
      { supabaseUrl: "https://synthetic.supabase.co" },
      fetcher,
    );
    const url = "https://synthetic.supabase.co/rest/v1/rpc/apply_packlink_transactions";
    const init = { method: "POST", signal: new AbortController().signal };
    await expect(
      transport(url, { ...init, body: "x".repeat(4 * 1024 * 1024 + 1) }),
    ).rejects.toThrow();
    const response = await transport(url, { ...init, body: "{}" });
    expect(response.status).toBe(500);
    expect(reader).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("private synthetic error");
  });
});
