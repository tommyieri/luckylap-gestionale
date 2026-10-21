import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readCanonicalShopifyOrder, type CanonicalReaderInput, type CanonicalReaderOptions } from "./canonical-reader";
import type { CanonicalReadResult } from "./canonical-model";
import { SHOPIFY_TOKEN_TIMEOUT_MS, shopifyTokenProvider, type ShopifyTokenProvider, type ShopifyTokenResult } from "./token";
import { shopifyWorkerConfig, type ShopifyWorkerConfig, type ShopifyWorkerEnvironment } from "./worker-config";
import { boundedPhase } from "./worker-io";
import { createShopifyWorkerStore, safeShopifyWorkerReason, type ShopifyClaimedJob, type ShopifyWorkerStore, type ShopifyWorkerReceipt, type WorkerStoreResult } from "./worker-store";

export const SHOPIFY_WORKER_BUDGET_MS = 45000;
export const SHOPIFY_WORKER_MAX_JOBS = 3;
export const SHOPIFY_WORKER_MIN_START_MS = 28000;
const DATABASE_PHASE_MS = 4000;
const READER_PHASE_MS = 15000;
type Reader = (input: CanonicalReaderInput, options?: CanonicalReaderOptions) => Promise<CanonicalReadResult>;
export type ShopifyWorkerDependencies = {
  store?: ShopifyWorkerStore;
  tokenProvider?: ShopifyTokenProvider;
  read?: Reader;
  now?: () => number;
  workerId?: () => string;
};
export type ShopifyWorkerCounts = { claimed: number; applied: number; replayed: number; stale: number; ignored: number; review: number; retry: number };
export type ShopifyWorkerRun = { status: "complete" | "uncertain"; counts: ShopifyWorkerCounts; budgetLimited: boolean };

export function authorizedShopifyWorker(header: string | null, secret: string): boolean {
  if (!header || header.length > 512 || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Every business effect is committed by apply_shopify_order, never here. */
export async function runShopifyWorker(config: ShopifyWorkerConfig, parentSignal: AbortSignal, dependencies: ShopifyWorkerDependencies = {}): Promise<ShopifyWorkerRun> {
  const now = dependencies.now ?? (() => performance.now());
  const deadline = now() + SHOPIFY_WORKER_BUDGET_MS;
  const counts: ShopifyWorkerCounts = { claimed: 0, applied: 0, replayed: 0, stale: 0, ignored: 0, review: 0, retry: 0 };
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  parentSignal.addEventListener("abort", onAbort, { once: true });
  if (parentSignal.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), SHOPIFY_WORKER_BUDGET_MS);
  const remaining = () => Math.max(0, deadline - now());
  let budgetLimited = false;
  let status: ShopifyWorkerRun["status"] = "complete";
  try {
    const store = dependencies.store ?? createShopifyWorkerStore(config);
    const tokens = dependencies.tokenProvider ?? shopifyTokenProvider;
    const read = dependencies.read ?? readCanonicalShopifyOrder;
    const workerId = (dependencies.workerId ?? randomUUID)();
    async function finalize(job: ShopifyClaimedJob, outcome: "review" | "retry", reason: string, retrySeconds = 60) {
      if (controller.signal.aborted || remaining() < 1) return false;
      const result = await boundedPhase(controller.signal, Math.min(DATABASE_PHASE_MS, remaining()), signal => store.finish(job, outcome, reason, retrySeconds, signal));
      if (!result.ok) return false;
      counts[result.value.status]++;
      return true;
    }
    async function getToken(): Promise<ShopifyTokenResult> {
      try { return await boundedPhase(controller.signal, Math.min(SHOPIFY_TOKEN_TIMEOUT_MS, remaining()), signal => tokens.get(config, signal)); }
      catch { return { ok: false, code: "token_unavailable" }; }
    }
    for (let index = 0; index < SHOPIFY_WORKER_MAX_JOBS; index++) {
      if (controller.signal.aborted) { status = "uncertain"; break; }
      if (remaining() < SHOPIFY_WORKER_MIN_START_MS) { budgetLimited = true; break; }
      const claimed = await boundedPhase(controller.signal, Math.min(DATABASE_PHASE_MS, remaining()), signal => store.claim(workerId, signal));
      if (!claimed.ok) { status = "uncertain"; break; }
      if (claimed.value.length === 0) break;
      const job = claimed.value[0]!;
      counts.claimed++;
      // A lease with too little time cannot safely authorize a read + commit.
      if (Date.parse(job.lease_expires_at) - Date.now() < 30000) { status = "uncertain"; break; }
      if (job.shop_domain !== config.expectedShopDomain) {
        if (!await finalize(job, "review", "shop_mismatch")) { status = "uncertain"; break; }
        continue;
      }
      let token = await getToken();
      if (!token.ok) {
        const outcome = token.code === "token_access_denied" || token.code === "token_invalid_response" ? "review" : "retry";
        if (!await finalize(job, outcome, token.code, token.code === "token_throttled" ? 120 : 60)) { status = "uncertain"; break; }
        continue;
      }
      async function readOrder(adminToken: string): Promise<CanonicalReadResult> {
        const timeoutMs = Math.min(READER_PHASE_MS, remaining() - DATABASE_PHASE_MS - 1000);
        if (timeoutMs < 1) throw new Error("worker_aborted");
        return boundedPhase(controller.signal, timeoutMs, requestSignal => read({ shopDomain: config.expectedShopDomain, adminToken, orderId: job.order_gid }, {
          timeoutMs,
          fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([requestSignal, ...(init?.signal ? [init.signal] : [])]) }),
        }));
      }
      let canonical: CanonicalReadResult;
      try { canonical = await readOrder(token.token); }
      catch { canonical = { status: "unavailable", code: "timeout", message: "" }; }
      if (canonical.status === "unavailable" && canonical.code === "access_denied") {
        tokens.invalidate(config);
        // Exactly one fresh grant/read, only with time left for durable finalization.
        if (remaining() >= 25000 && !controller.signal.aborted) {
          token = await getToken();
          if (token.ok) {
            try { canonical = await readOrder(token.token); }
            catch { canonical = { status: "unavailable", code: "timeout", message: "" }; }
          } else {
            if (!await finalize(job, token.code === "token_access_denied" || token.code === "token_invalid_response" ? "review" : "retry", token.code,
              token.code === "token_throttled" ? 120 : 60)) { status = "uncertain"; break; }
            continue;
          }
        }
        if (canonical.status === "unavailable" && canonical.code === "access_denied") {
          if (!await finalize(job, "review", "access_denied")) { status = "uncertain"; break; }
          continue;
        }
      }
      if (canonical.status !== "ready") {
        const reason = safeShopifyWorkerReason(canonical.code) ? canonical.code : "reader_unavailable";
        if (!await finalize(job, canonical.status === "review" ? "review" : "retry", reason, reason === "throttled" ? 120 : 60)) { status = "uncertain"; break; }
        continue;
      }
      if (canonical.order.shopDomain !== job.shop_domain || canonical.order.orderId !== job.order_gid
        || canonical.order.schemaVersion !== 1 || canonical.order.apiVersion !== "2026-10") {
        if (!await finalize(job, "review", "canonical_identity_mismatch")) { status = "uncertain"; break; }
        continue;
      }
      let applied: WorkerStoreResult<ShopifyWorkerReceipt>;
      try { applied = await boundedPhase(controller.signal, Math.min(DATABASE_PHASE_MS, remaining()), signal => store.apply(job, canonical.order, signal)); }
      catch { status = "uncertain"; break; }
      // A lost commit response is ambiguous. Never overwrite it with finish.
      // A committed job stays terminal; otherwise its lease becomes reclaimable.
      if (!applied.ok) { status = "uncertain"; break; }
      counts[applied.value.status]++;
    }
  } catch { status = "uncertain"; }
  finally { clearTimeout(timer); parentSignal.removeEventListener("abort", onAbort); controller.abort(); }
  return { status, counts, budgetLimited };
}

function reply(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    ...(status === 503 ? { "Retry-After": "60" } : {}) } });
}

export async function receiveShopifyWorkerTick(request: Request, dependencies: ShopifyWorkerDependencies & { environment?: ShopifyWorkerEnvironment } = {}): Promise<Response> {
  const config = shopifyWorkerConfig(dependencies.environment);
  if (!config) return reply(503, { processed: false, error: "worker_unavailable" });
  if (!authorizedShopifyWorker(request.headers.get("authorization"), config.workerSecret)) return reply(401, { processed: false, error: "unauthorized" });
  // Request bodies, query strings and caller cookies cannot choose work or scope.
  const result = await runShopifyWorker(config, request.signal, dependencies);
  return result.status === "complete" ? reply(200, { processed: true, ...result })
    : reply(503, { processed: false, error: "worker_unavailable", ...result });
}
