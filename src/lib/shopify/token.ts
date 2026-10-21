import "server-only";
import { createHash } from "node:crypto";
import { validShopifyTokenCredentials, type ShopifyTokenCredentials } from "./worker-config";
import { abortable, boundedPhase, workerJson } from "./worker-io";

export type ShopifyTokenFailure =
  "token_access_denied" | "token_throttled" | "token_unavailable" | "token_invalid_response";
export type ShopifyTokenResult =
  { ok: true; token: string } | { ok: false; code: ShopifyTokenFailure };
export type ShopifyTokenProvider = {
  get(credentials: ShopifyTokenCredentials, signal: AbortSignal): Promise<ShopifyTokenResult>;
  invalidate(credentials: ShopifyTokenCredentials): void;
};
export const SHOPIFY_TOKEN_TIMEOUT_MS = 4000;
export const SHOPIFY_TOKEN_MAX_BYTES = 64 * 1024;
const identity = (credentials: ShopifyTokenCredentials): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        credentials.expectedShopDomain,
        credentials.clientId,
        credentials.clientSecret,
      ]),
    )
    .digest("hex");

/** Process-local optimization only. Durable work and retries live in Postgres. */
export function createShopifyTokenProvider(
  options: { fetch?: typeof fetch; now?: () => number } = {},
): ShopifyTokenProvider {
  const now = options.now ?? Date.now;
  let activeIdentity: string | null = null;
  let generation = 0;
  let cached: { token: string; usableUntil: number } | null = null;
  let inflight: { identity: string; promise: Promise<ShopifyTokenResult> } | null = null;
  return {
    invalidate(credentials) {
      if (validShopifyTokenCredentials(credentials) && activeIdentity === identity(credentials)) {
        generation++;
        cached = null;
        inflight = null;
      }
    },
    async get(credentials, signal) {
      if (signal.aborted || !validShopifyTokenCredentials(credentials))
        return { ok: false, code: "token_unavailable" };
      const key = identity(credentials);
      if (activeIdentity !== key) {
        activeIdentity = key;
        generation++;
        cached = null;
        inflight = null;
      }
      if (cached && now() < cached.usableUntil) return { ok: true, token: cached.token };
      if (inflight?.identity === key) {
        try {
          return await abortable(inflight.promise, signal);
        } catch {
          return { ok: false, code: "token_unavailable" };
        }
      }
      const requestGeneration = generation;
      const promise = (async (): Promise<ShopifyTokenResult> => {
        try {
          return await boundedPhase(signal, SHOPIFY_TOKEN_TIMEOUT_MS, async (requestSignal) => {
            const startedAt = now();
            const response = await abortable(
              (options.fetch ?? fetch)(
                `https://${credentials.expectedShopDomain}/admin/oauth/access_token`,
                {
                  method: "POST",
                  headers: {
                    Accept: "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                  },
                  body: new URLSearchParams({
                    grant_type: "client_credentials",
                    client_id: credentials.clientId,
                    client_secret: credentials.clientSecret,
                  }),
                  signal: requestSignal,
                  redirect: "error",
                  cache: "no-store",
                  credentials: "omit",
                },
              ),
              requestSignal,
            );
            if (!response.ok) {
              // Error bodies can contain sensitive request details; never read them.
              void response.body?.cancel().catch(() => undefined);
              return {
                ok: false,
                code:
                  response.status === 401 || response.status === 403
                    ? "token_access_denied"
                    : response.status === 429
                      ? "token_throttled"
                      : "token_unavailable",
              };
            }
            let value: unknown;
            try {
              value = await workerJson(response, requestSignal, SHOPIFY_TOKEN_MAX_BYTES);
            } catch {
              return {
                ok: false,
                code: requestSignal.aborted ? "token_unavailable" : "token_invalid_response",
              };
            }
            if (!value || typeof value !== "object" || Array.isArray(value))
              return { ok: false, code: "token_invalid_response" };
            const row = value as Record<string, unknown>;
            if (
              typeof row.access_token !== "string" ||
              !/^[\x21-\x7e]{20,512}$/.test(row.access_token) ||
              typeof row.expires_in !== "number" ||
              !Number.isInteger(row.expires_in) ||
              row.expires_in < 1 ||
              row.expires_in > 86400 ||
              typeof row.scope !== "string" ||
              row.scope.length > 8192 ||
              !row.scope
                .split(",")
                .map((scope) => scope.trim())
                .includes("read_orders") ||
              !row.scope
                .split(",")
                .map((scope) => scope.trim())
                .includes("read_products")
            )
              return { ok: false, code: "token_invalid_response" };
            if (activeIdentity === key && generation === requestGeneration) {
              cached = {
                token: row.access_token,
                usableUntil: startedAt + Math.max(0, row.expires_in * 1000 - 60000),
              };
            }
            return { ok: true, token: row.access_token };
          });
        } catch {
          return { ok: false, code: "token_unavailable" };
        }
      })();
      inflight = { identity: key, promise };
      try {
        return await promise;
      } finally {
        if (inflight?.promise === promise) inflight = null;
      }
    },
  };
}

export const shopifyTokenProvider = createShopifyTokenProvider();
