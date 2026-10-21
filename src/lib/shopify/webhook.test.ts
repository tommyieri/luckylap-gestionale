import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readShopifyOrderNotification } from "./webhook";

const clientSecret = "synthetic-test-secret-never-a-real-credential";
const shop = "synthetic-luckylap.myshopify.com";
const deliveryId = "00000000-0000-4000-8000-000000000001";
const eventId = "00000000-0000-4000-8000-000000000002";
const order = {
  id: 123,
  admin_graphql_api_id: "gid://shopify/Order/123",
  source_name: "web",
  created_at: "2026-10-21T11:40:00+02:00",
  updated_at: "2026-10-21T11:45:00+02:00",
  currency: "EUR",
};

function fixture(payload: unknown = order) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const headers = new Headers({
    "x-shopify-hmac-sha256": createHmac("sha256", clientSecret).update(rawBody).digest("base64"),
    "x-shopify-shop-domain": shop,
    "x-shopify-api-version": "2026-10",
    "x-shopify-topic": "orders/create",
    "x-shopify-webhook-id": deliveryId,
    "x-shopify-event-id": eventId,
  });
  return { rawBody, headers, expectedShopDomain: shop, clientSecret };
}

describe("Shopify HTTPS order notification boundary", () => {
  it("verifies raw bytes and returns only a canonical-read cue, without customer data or money", () => {
    const result = readShopifyOrderNotification(
      fixture({ ...order, email: "private@example.test", total_price: "49.99" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification).toMatchObject({
      shopDomain: shop,
      webhookId: deliveryId,
      eventId,
      deliveryKey: `${shop}:${deliveryId}`,
      apiVersion: "2026-10",
      topic: "orders/create",
      orderGid: order.admin_graphql_api_id,
      channel: "shopify_web",
      sourceName: "web",
      requiresCanonicalRead: true,
      sourceCreatedAt: order.created_at,
      sourceUpdatedAt: order.updated_at,
    });
    expect(result.notification.bodySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain("private@example.test");
    expect(JSON.stringify(result)).not.toContain("49.99");
  });

  it("rejects tampered bytes, including semantically identical reserialized JSON", () => {
    const input = fixture();
    expect(
      readShopifyOrderNotification({
        ...input,
        rawBody: Buffer.from(JSON.stringify(order, null, 2)),
      }),
    ).toEqual({ ok: false, error: "invalid_signature" });
    expect(readShopifyOrderNotification({ ...input, rawBody: Buffer.from("not json") })).toEqual({
      ok: false,
      error: "invalid_signature",
    });
  });

  it.each(["", "short", "a".repeat(44), "A".repeat(43) + "=garbage", "A".repeat(42) + "=="])(
    "rejects missing/malformed HMAC without throwing: %s",
    (signature) => {
      const input = fixture();
      input.headers.set("x-shopify-hmac-sha256", signature);
      expect(readShopifyOrderNotification(input)).toEqual({
        ok: false,
        error: "invalid_signature",
      });
    },
  );

  it("fails closed when secrets or store identity are not configured", () => {
    expect(readShopifyOrderNotification({ ...fixture(), clientSecret: "" })).toEqual({
      ok: false,
      error: "configuration_required",
    });
    expect(
      readShopifyOrderNotification({ ...fixture(), expectedShopDomain: "https://example.test" }),
    ).toEqual({ ok: false, error: "configuration_required" });
  });

  it.each(["other.myshopify.com", `${shop}.evil.test`, `https://${shop}`, `${shop}:443`])(
    "rejects a mismatched or noncanonical shop header: %s",
    (domain) => {
      const input = fixture();
      input.headers.set("x-shopify-shop-domain", domain);
      expect(readShopifyOrderNotification(input)).toEqual({ ok: false, error: "unexpected_shop" });
    },
  );

  it("does not accept Events headers or unknown topics/API versions as legacy webhooks", () => {
    const events = fixture();
    events.headers.delete("x-shopify-hmac-sha256");
    events.headers.set("shopify-hmac-sha256", "A".repeat(43) + "=");
    expect(readShopifyOrderNotification(events)).toEqual({ ok: false, error: "invalid_signature" });
    const version = fixture();
    version.headers.set("x-shopify-api-version", "2027-01");
    expect(readShopifyOrderNotification(version)).toEqual({
      ok: false,
      error: "unsupported_api_version",
    });
    const topic = fixture();
    topic.headers.set("x-shopify-topic", "inventory_levels/update");
    expect(readShopifyOrderNotification(topic)).toEqual({ ok: false, error: "unsupported_topic" });
  });

  it("requires a valid delivery id but uses event id only for correlation", () => {
    const missing = fixture();
    missing.headers.delete("x-shopify-webhook-id");
    expect(readShopifyOrderNotification(missing)).toEqual({
      ok: false,
      error: "invalid_delivery_metadata",
    });
    const noEvent = fixture();
    noEvent.headers.delete("x-shopify-event-id");
    const result = readShopifyOrderNotification(noEvent);
    expect(result.ok && result.notification.eventId).toBe(null);
    const another = fixture();
    another.headers.set("x-shopify-webhook-id", "00000000-0000-4000-8000-000000000003");
    const distinct = readShopifyOrderNotification(another);
    expect(distinct.ok && distinct.notification.deliveryKey).not.toBe(`${shop}:${deliveryId}`);
    expect(distinct.ok && distinct.notification.eventId).toBe(eventId);
  });

  it.each([
    "orders/create",
    "orders/updated",
    "orders/paid",
    "orders/cancelled",
    "orders/fulfilled",
    "orders/partially_fulfilled",
  ])("accepts the supported snapshot topic %s without interpreting its effect", (topic) => {
    const input = fixture();
    input.headers.set("x-shopify-topic", topic);
    const result = readShopifyOrderNotification(input);
    expect(result.ok && result.notification.topic).toBe(topic);
    expect(result.ok && result.notification.requiresCanonicalRead).toBe(true);
  });

  it("keeps POS inside the Shopify origin even for a cash payment", () => {
    const result = readShopifyOrderNotification(
      fixture({ ...order, source_name: "pos", payment_gateway_names: ["cash"] }),
    );
    expect(result.ok && result.notification.channel).toBe("shopify_pos");
  });

  it.each(["api", "draft_order", "custom-channel", null, undefined])(
    "does not invent a web/POS channel from source_name %s",
    (sourceName) => {
      const result = readShopifyOrderNotification(fixture({ ...order, source_name: sourceName }));
      expect(result.ok && result.notification.channel).toBe("shopify_other");
    },
  );

  it("uses the exact GID even when legacy numeric id exceeds JavaScript precision", () => {
    const result = readShopifyOrderNotification(
      fixture({
        ...order,
        id: 820982911946154508,
        admin_graphql_api_id: "gid://shopify/Order/820982911946154508",
      }),
    );
    expect(result.ok && result.notification.orderGid).toBe(
      "gid://shopify/Order/820982911946154508",
    );
  });

  it.each([
    { ...order, admin_graphql_api_id: undefined },
    { ...order, admin_graphql_api_id: "gid://shopify/Product/123" },
    { ...order, admin_graphql_api_id: "gid://shopify/Order/124" },
    { ...order, updated_at: "2026-10-21T11:45:00" },
    { ...order, updated_at: "2026-02-30T11:45:00Z" },
    { ...order, created_at: "2026-10-22T11:40:00+02:00" },
    { ...order, currency: "eur" },
    [],
    null,
  ])("rejects invalid minimal order snapshots", (payload) => {
    expect(readShopifyOrderNotification(fixture(payload))).toEqual({
      ok: false,
      error: "invalid_payload",
    });
  });

  it("rejects signed malformed JSON or invalid UTF-8 after authentication", () => {
    for (const rawBody of [Buffer.from("{"), Buffer.from([0xff, 0xfe])]) {
      const input = fixture();
      input.rawBody = rawBody;
      input.headers.set(
        "x-shopify-hmac-sha256",
        createHmac("sha256", clientSecret).update(rawBody).digest("base64"),
      );
      expect(readShopifyOrderNotification(input)).toEqual({ ok: false, error: "invalid_payload" });
    }
  });

  it("rejects empty and oversized bodies before parsing", () => {
    expect(readShopifyOrderNotification({ ...fixture(), rawBody: Buffer.alloc(0) })).toEqual({
      ok: false,
      error: "invalid_body_size",
    });
    expect(
      readShopifyOrderNotification({ ...fixture(), rawBody: Buffer.alloc(1024 * 1024 + 1) }),
    ).toEqual({ ok: false, error: "invalid_body_size" });
  });
});
