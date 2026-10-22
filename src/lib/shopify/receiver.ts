import "server-only";
import {
  persistShopifyNotification,
  shopifyReceiverConfig,
  type ShopifyReceiverConfig,
  type ShopifyInboxResult,
  type ShopifyReceiverEnvironment,
} from "./inbox";
import {
  readShopifyOrderNotification,
  SHOPIFY_WEBHOOK_MAX_BYTES,
  type ShopifyOrderNotification,
} from "./webhook";

// Shopify allows five seconds overall. Leave headroom for the HTTP response.
export const SHOPIFY_RECEIVER_BUDGET_MS = 4000;
type BodyResult =
  { ok: true; rawBody: Uint8Array } | { ok: false; error: "invalid_body" | "request_timeout" };
type Persistence = (
  notification: ShopifyOrderNotification,
  config: ShopifyReceiverConfig,
  signal: AbortSignal,
) => Promise<ShopifyInboxResult>;

/** Limit streamed bytes, including requests that omit or lie about Content-Length. */
export async function readShopifyRawBody(
  request: Request,
  signal: AbortSignal,
): Promise<BodyResult> {
  const length = request.headers.get("content-length");
  const encoding = request.headers.get("content-encoding");
  if (
    (length !== null &&
      (!/^(0|[1-9]\d*)$/.test(length) || BigInt(length) > BigInt(SHOPIFY_WEBHOOK_MAX_BYTES))) ||
    (encoding !== null && encoding.toLowerCase() !== "identity") ||
    !request.body
  )
    return { ok: false, error: "invalid_body" };
  if (signal.aborted) return { ok: false, error: "request_timeout" };
  const reader = request.body.getReader();
  // One bounded allocation also avoids per-chunk memory growth on tiny chunks.
  const rawBody = new Uint8Array(SHOPIFY_WEBHOOK_MAX_BYTES);
  let bytes = 0;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("body_timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      if (!(value instanceof Uint8Array)) return { ok: false, error: "invalid_body" };
      if (bytes + value.byteLength > SHOPIFY_WEBHOOK_MAX_BYTES)
        return { ok: false, error: "invalid_body" };
      rawBody.set(value, bytes);
      bytes += value.byteLength;
    }
    if (bytes === 0 || (length !== null && BigInt(length) !== BigInt(bytes)))
      return { ok: false, error: "invalid_body" };
    return { ok: true, rawBody: rawBody.subarray(0, bytes) };
  } catch {
    return { ok: false, error: signal.aborted ? "request_timeout" : "invalid_body" };
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function reply(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(status === 503 ? { "Retry-After": "30" } : {}),
    },
  });
}

export async function receiveShopifyWebhook(
  request: Request,
  dependencies: {
    environment?: ShopifyReceiverEnvironment;
    persist?: Persistence;
  } = {},
): Promise<Response> {
  const config = shopifyReceiverConfig(dependencies.environment);
  if (!config) return reply(503, { received: false, error: "receiver_unavailable" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHOPIFY_RECEIVER_BUDGET_MS);
  const onDisconnect = () => controller.abort();
  request.signal.addEventListener("abort", onDisconnect, { once: true });
  if (request.signal.aborted) controller.abort();
  try {
    const body = await readShopifyRawBody(request, controller.signal);
    if (!body.ok)
      return reply(body.error === "request_timeout" ? 503 : 400, {
        received: false,
        error: body.error === "request_timeout" ? "receiver_unavailable" : "invalid_notification",
      });
    const parsed = readShopifyOrderNotification({
      rawBody: body.rawBody,
      headers: request.headers,
      expectedShopDomain: config.expectedShopDomain,
      clientSecret: config.clientSecret,
    });
    if (!parsed.ok)
      return reply(parsed.error === "invalid_signature" ? 401 : 400, {
        received: false,
        error: parsed.error === "invalid_signature" ? "invalid_signature" : "invalid_notification",
      });
    if (controller.signal.aborted)
      return reply(503, { received: false, error: "receiver_unavailable" });
    const result = await (dependencies.persist ?? persistShopifyNotification)(
      parsed.notification,
      config,
      controller.signal,
    );
    if (!result.ok)
      return reply(result.error === "delivery_conflict" ? 409 : 503, {
        received: false,
        error: result.error === "delivery_conflict" ? "delivery_conflict" : "receiver_unavailable",
      });
    return reply(200, { received: true, ...result.receipt });
  } catch {
    return reply(503, { received: false, error: "receiver_unavailable" });
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", onDisconnect);
  }
}
