import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { renderToStaticMarkup } from "react-dom/server";
import { ShopifySyncHealth } from "./shopify-sync-health";
import { shopifySyncSnapshotFrom } from "../lib/shopify/status-model";
const raw = () => ({
  configured: true,
  enabled: true,
  counters: {
    pending: 2,
    retry: 1,
    processing: 1,
    review: 1,
    applied: 4,
    ignored: 3,
    lastAppliedAt: "2026-10-21T12:00:00Z",
  },
  reviews: [
    {
      orderGid: "gid://shopify/Order/100",
      reason: "unmapped_sku",
      observedAt: "2026-10-21T12:00:00Z",
    },
  ],
});
describe("Shopify health source and cases", () => {
  it("renders paused state, safe case labels and Admin links without visible GIDs or secret details", () => {
    const snapshot = shopifySyncSnapshotFrom(raw(), false)!;
    const html = renderToStaticMarkup(
      <ShopifySyncHealth
        status={{ status: "ready", snapshot }}
        shopDomain="synthetic.myshopify.com"
      />,
    );
    expect(html).toContain("In pausa");
    expect(html).toContain("Uno SKU richiede il collegamento");
    expect(html).toContain('href="https://synthetic.myshopify.com/admin/orders/100"');
    expect(html).toContain("non il numero di vendite");
    expect(html).not.toContain("gid://shopify");
    expect(html).not.toContain("unmapped_sku");
    expect(html).not.toMatch(/lease_token|sb_secret|clientSecret|payload/);
  });
  it("shows unavailable rather than inventing an empty healthy queue", () => {
    const html = renderToStaticMarkup(<ShopifySyncHealth status={{ status: "unavailable" }} />);
    expect(html).toContain("Stato non disponibile");
    expect(html).not.toContain("Notifiche gestite");
    expect(html).not.toContain("Attivo");
  });
  it("does not invent Admin links without the configured shop domain", () => {
    const snapshot = shopifySyncSnapshotFrom(raw(), true)!;
    const html = renderToStaticMarkup(
      <ShopifySyncHealth status={{ status: "ready", snapshot }} shopDomain="" />,
    );
    expect(html).toContain("Attivo");
    expect(html).not.toContain("/admin/orders/");
  });
});
