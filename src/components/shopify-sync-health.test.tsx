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
    expect(html).toContain("Richiede attenzione");
    expect(html).not.toContain("/admin/orders/");
  });
  it("in vista l'ultimo aggiornamento e i casi con l'istruzione; i contatori nei dettagli tecnici", () => {
    const snapshot = shopifySyncSnapshotFrom(raw(), true)!;
    const html = renderToStaticMarkup(
      <ShopifySyncHealth
        status={{ status: "ready", snapshot }}
        shopDomain="synthetic.myshopify.com"
      />,
    );
    expect(html).toContain("Ultimo aggiornamento: <strong>21/10/26, 14:00 (ora di Roma)</strong>");
    expect(html).toContain("Ordini da verificare");
    expect(html).toContain("Richiede attenzione");
    expect(html).toContain("Alcuni aggiornamenti ricevuti da Shopify non sono stati applicati");
    expect(html).toContain(
      "Se compare un caso, avvisa Tommi. Non registrare a mano lo stesso ordine.",
    );
    const technical = html.slice(html.indexOf("<details"));
    expect(technical).toMatch(/^<details[^>]*><summary>Dettagli tecnici<\/summary>/);
    expect(technical).not.toMatch(/^<details[^>]*open/);
    for (const label of [
      "In attesa",
      "In elaborazione",
      "Notifiche gestite",
      "Notifiche escluse",
    ]) {
      expect(html.indexOf(label)).toBeGreaterThan(html.indexOf("<details"));
    }
    expect(html).not.toContain("Europe/Rome");
    expect(html).toContain("Magadzino");
  });
  it("senza casi non chiede di avvisare nessuno", () => {
    const quiet = { ...raw(), counters: { ...raw().counters, review: 0 }, reviews: [] };
    const html = renderToStaticMarkup(
      <ShopifySyncHealth
        status={{ status: "ready", snapshot: shopifySyncSnapshotFrom(quiet, true)! }}
        shopDomain="synthetic.myshopify.com"
      />,
    );
    expect(html).not.toContain("Ordini da verificare");
    expect(html).not.toContain("avvisa Tommi");
    expect(html).toContain("Attivo");
    expect(html).not.toContain("Richiede attenzione");
  });
  it("shows one row and link per order with distinct human reasons and the latest date", () => {
    const rawStatus = raw();
    rawStatus.reviews = [
      {
        orderGid: "gid://shopify/Order/100",
        reason: "unmapped_sku",
        observedAt: "2026-10-22T12:00:00Z",
      },
      {
        orderGid: "gid://shopify/Order/100",
        reason: "access_denied",
        observedAt: "2026-10-23T12:00:00Z",
      },
      {
        orderGid: "gid://shopify/Order/200",
        reason: "unknown_physical_stock",
        observedAt: "2026-10-24T12:00:00Z",
      },
      {
        orderGid: "gid://shopify/Order/100",
        reason: "token_access_denied",
        observedAt: "2026-10-22T13:00:00Z",
      },
    ];
    rawStatus.counters.review = rawStatus.reviews.length;
    const html = renderToStaticMarkup(
      <ShopifySyncHealth
        status={{ status: "ready", snapshot: shopifySyncSnapshotFrom(rawStatus, true)! }}
        shopDomain="synthetic.myshopify.com"
      />,
    );
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(
      html.match(/href="https:\/\/synthetic.myshopify.com\/admin\/orders\/100"/g),
    ).toHaveLength(1);
    expect(
      html.match(/href="https:\/\/synthetic.myshopify.com\/admin\/orders\/200"/g),
    ).toHaveLength(1);
    expect(
      html.match(/Il collegamento Shopify richiede una verifica degli accessi\./g),
    ).toHaveLength(1);
    expect(html).toContain("Uno SKU richiede il collegamento");
    expect(html).toContain("Ultima segnalazione: 23/10/26, 14:00 (ora di Roma)");
    expect(html).not.toContain("22/10/26");
    expect(html).not.toMatch(/access_denied|token_access_denied|gid:\/\/shopify/);
  });
  it("describes truncated reviews as a notification sample, without claiming a total order count", () => {
    const rawStatus = raw();
    rawStatus.reviews = Array.from({ length: 20 }, () => ({ ...rawStatus.reviews[0]! }));
    rawStatus.counters.review = 30;
    const html = renderToStaticMarkup(
      <ShopifySyncHealth
        status={{ status: "ready", snapshot: shopifySyncSnapshotFrom(rawStatus, true)! }}
        shopDomain="synthetic.myshopify.com"
      />,
    );
    expect(html.match(/<li>/g)).toHaveLength(1);
    expect(html).toContain("Sono raggruppate le 20 notifiche più recenti.");
    expect(html).toContain("Altri ordini da verificare potrebbero non essere visibili.");
    expect(html).not.toMatch(/30 ordini|20 ordini|Ordini da verificare · 1/);
    expect(html.slice(html.indexOf("<details"))).toContain("<dt>Da verificare</dt><dd>30</dd>");
  });
});
