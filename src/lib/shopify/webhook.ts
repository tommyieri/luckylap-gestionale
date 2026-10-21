import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SHOPIFY_WEBHOOK_API_VERSION = "2026-10" as const;
export const SHOPIFY_WEBHOOK_MAX_BYTES = 1024 * 1024;

const ORDER_SNAPSHOT_TOPICS = ["orders/create", "orders/updated", "orders/paid", "orders/cancelled"] as const;
type OrderSnapshotTopic = (typeof ORDER_SNAPSHOT_TOPICS)[number];
type NotificationError =
  | "configuration_required" | "invalid_body_size" | "invalid_signature" | "unexpected_shop"
  | "unsupported_api_version" | "unsupported_topic" | "invalid_delivery_metadata" | "invalid_payload";

export type ShopifyOrderNotification = {
  shopDomain: string;
  webhookId: string;
  eventId: string | null;
  deliveryKey: string;
  apiVersion: typeof SHOPIFY_WEBHOOK_API_VERSION;
  topic: OrderSnapshotTopic;
  orderGid: string;
  sourceName: string | null;
  channel: "shopify_web" | "shopify_pos" | "shopify_other";
  currency: string;
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
  bodySha256: string;
  requiresCanonicalRead: true;
};

type NotificationInput = {
  rawBody: Uint8Array;
  headers: Pick<Headers, "get">;
  expectedShopDomain: string;
  clientSecret: string;
};
type NotificationResult =
  | { ok: true; notification: ShopifyOrderNotification }
  | { ok: false; error: NotificationError };

function isShopDomain(value: string) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(value);
}

function isDeliveryId(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function authenticates(rawBody: Uint8Array, header: string | null, clientSecret: string) {
  // Node's decoder accepts malformed base64; require the canonical SHA256 representation first.
  if (!header || !/^[A-Za-z0-9+/]{43}=$/.test(header)) return false;
  const supplied = Buffer.from(header, "base64");
  if (supplied.length !== 32 || supplied.toString("base64") !== header) return false;
  const expected = createHmac("sha256", clientSecret).update(rawBody).digest();
  return timingSafeEqual(expected, supplied);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSourceTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zoneHour, zoneMinute] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  if (year < 2000 || month < 1 || month > 12 || day < 1 || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59) return false;
  if (zoneHour && (Number(zoneHour) > 23 || Number(zoneMinute) > 59)) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth && Number.isFinite(Date.parse(value));
}

function orderGid(payload: Record<string, unknown>): string | null {
  const gid = payload.admin_graphql_api_id;
  if (typeof gid !== "string") return null;
  const match = /^gid:\/\/shopify\/Order\/([1-9]\d{0,19})$/.exec(gid);
  if (!match || BigInt(match[1]) > 18446744073709551615n) return null;
  // The GID is authoritative. JSON numbers beyond MAX_SAFE_INTEGER must never become identifiers.
  const legacyId = payload.id;
  if (typeof legacyId === "number" && Number.isSafeInteger(legacyId) && String(legacyId) !== match[1]) return null;
  if (typeof legacyId === "string" && legacyId !== match[1]) return null;
  return gid;
}

/**
 * Authenticates a legacy HTTPS order-snapshot webhook and extracts a queue cue.
 * It neither persists deliveries nor treats the payload as a sale/payment/stock command.
 * Routing headers are not covered by the body HMAC: the worker must reread the order
 * from the configured shop before trusting channel, version, amounts or business effects.
 */
export function readShopifyOrderNotification(input: NotificationInput): NotificationResult {
  const { rawBody, headers, expectedShopDomain, clientSecret } = input;
  if (!clientSecret.trim() || !isShopDomain(expectedShopDomain)) return { ok: false, error: "configuration_required" };
  if (rawBody.byteLength === 0 || rawBody.byteLength > SHOPIFY_WEBHOOK_MAX_BYTES) return { ok: false, error: "invalid_body_size" };
  if (!authenticates(rawBody, headers.get("x-shopify-hmac-sha256"), clientSecret)) return { ok: false, error: "invalid_signature" };
  if (headers.get("x-shopify-shop-domain") !== expectedShopDomain) return { ok: false, error: "unexpected_shop" };
  if (headers.get("x-shopify-api-version") !== SHOPIFY_WEBHOOK_API_VERSION) return { ok: false, error: "unsupported_api_version" };
  const topic = headers.get("x-shopify-topic");
  if (!ORDER_SNAPSHOT_TOPICS.includes(topic as OrderSnapshotTopic)) return { ok: false, error: "unsupported_topic" };
  const webhookId = headers.get("x-shopify-webhook-id");
  const eventId = headers.get("x-shopify-event-id");
  if (!isDeliveryId(webhookId) || (eventId !== null && !isDeliveryId(eventId))) return { ok: false, error: "invalid_delivery_metadata" };

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
  } catch {
    return { ok: false, error: "invalid_payload" };
  }
  if (!isRecord(payload)) return { ok: false, error: "invalid_payload" };
  const gid = orderGid(payload);
  if (!gid || !isSourceTimestamp(payload.created_at) || !isSourceTimestamp(payload.updated_at)
    || Date.parse(payload.created_at) > Date.parse(payload.updated_at)
    || typeof payload.currency !== "string" || !/^[A-Z]{3}$/.test(payload.currency)
    || (payload.source_name !== undefined && payload.source_name !== null && (typeof payload.source_name !== "string" || payload.source_name.length > 255))) {
    return { ok: false, error: "invalid_payload" };
  }
  const sourceName = typeof payload.source_name === "string" ? payload.source_name : null;
  return {
    ok: true,
    notification: {
      shopDomain: expectedShopDomain,
      webhookId,
      eventId,
      deliveryKey: `${expectedShopDomain}:${webhookId.toLowerCase()}`,
      apiVersion: SHOPIFY_WEBHOOK_API_VERSION,
      topic: topic as OrderSnapshotTopic,
      orderGid: gid,
      sourceName,
      channel: sourceName === "pos" ? "shopify_pos" : sourceName === "web" ? "shopify_web" : "shopify_other",
      currency: payload.currency,
      sourceCreatedAt: payload.created_at,
      sourceUpdatedAt: payload.updated_at,
      bodySha256: createHash("sha256").update(rawBody).digest("hex"),
      requiresCanonicalRead: true,
    },
  };
}
