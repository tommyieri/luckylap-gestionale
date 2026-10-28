import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  canonicalGid,
  canonicalShop,
  canonicalTimestamp,
  type CanonicalShopifyOrder,
} from "./canonical-model";
import type { ShopifyWorkerConfig } from "./worker-config";
import {
  abortable,
  createWorkerRpcFetch,
  safeWorkerReason,
  workerRecord as record,
  workerUuid as uuid,
} from "./worker-io";

export type ShopifyClaimedJob = {
  job_id: string;
  inbox_id: string;
  shop_domain: string;
  order_gid: string;
  lease_token: string;
  lease_expires_at: string;
};
export type ShopifyApplyStatus = "applied" | "replayed" | "stale" | "ignored" | "review" | "retry";
export type ShopifyWorkerReceipt = {
  status: ShopifyApplyStatus;
  reason: string | null;
  job_id: string;
  order_id?: string;
};
export type WorkerStoreResult<T> = { ok: true; value: T } | { ok: false };
export type ShopifyWorkerStore = {
  claim(workerId: string, signal: AbortSignal): Promise<WorkerStoreResult<ShopifyClaimedJob[]>>;
  apply(
    job: ShopifyClaimedJob,
    order: CanonicalShopifyOrder,
    signal: AbortSignal,
  ): Promise<WorkerStoreResult<ShopifyWorkerReceipt>>;
  finish(
    job: ShopifyClaimedJob,
    outcome: "review" | "retry",
    reason: string,
    retrySeconds: number,
    signal: AbortSignal,
  ): Promise<WorkerStoreResult<ShopifyWorkerReceipt>>;
};
const statuses: readonly ShopifyApplyStatus[] = [
  "applied",
  "replayed",
  "stale",
  "ignored",
  "review",
  "retry",
];
export const safeShopifyWorkerReason = safeWorkerReason;
export const SHOPIFY_WORKER_RPC_MAX_BYTES = 64 * 1024;

/** Bound bytes BEFORE PostgREST's parser and never forward apikey on redirect. */
export function createShopifyWorkerFetch(
  config: Pick<ShopifyWorkerConfig, "supabaseUrl">,
  fetcher: typeof fetch = fetch,
): typeof fetch {
  return createWorkerRpcFetch(
    {
      supabaseUrl: config.supabaseUrl,
      rpcNames: ["claim_shopify_order_jobs", "apply_shopify_order", "finish_shopify_read_job"],
      timeoutMs: 4000,
      maxResponseBytes: SHOPIFY_WORKER_RPC_MAX_BYTES,
    },
    fetcher,
  );
}

export function shopifyClaimFrom(value: unknown): ShopifyClaimedJob[] | null {
  if (!Array.isArray(value) || value.length > 1) return null;
  try {
    return value.map((value) => {
      const row = record(value);
      if (
        !row ||
        Object.keys(row).sort().join(",") !==
          "inbox_id,job_id,lease_expires_at,lease_token,order_gid,shop_domain" ||
        !uuid(row.job_id) ||
        !uuid(row.inbox_id) ||
        !uuid(row.lease_token) ||
        !canonicalShop(row.shop_domain)
      )
        throw new Error("invalid_claim");
      canonicalGid(row.order_gid, "Order");
      canonicalTimestamp(row.lease_expires_at);
      return row as ShopifyClaimedJob;
    });
  } catch {
    return null;
  }
}

export function shopifyWorkerReceiptFrom(
  value: unknown,
  jobId: string,
): ShopifyWorkerReceipt | null {
  const row = record(value);
  if (
    !row ||
    Object.keys(row).some((key) => !["status", "reason", "job_id", "order_id"].includes(key)) ||
    row.job_id !== jobId ||
    !uuid(row.job_id) ||
    !statuses.includes(row.status as ShopifyApplyStatus) ||
    (row.reason !== null && !safeShopifyWorkerReason(row.reason)) ||
    (row.order_id !== undefined && !uuid(row.order_id))
  )
    return null;
  return row as ShopifyWorkerReceipt;
}

/** Separate service client: it never inherits browser cookies or user JWTs. */
export function createShopifyWorkerStore(config: ShopifyWorkerConfig): ShopifyWorkerStore {
  const client = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createShopifyWorkerFetch(config) },
  });
  async function rpc(
    name: string,
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<WorkerStoreResult<unknown>> {
    try {
      const { data, error } = await abortable(
        client.rpc(name, payload).abortSignal(signal),
        signal,
      );
      return error ? { ok: false } : { ok: true, value: data };
    } catch {
      return { ok: false };
    }
  }
  return {
    async claim(workerId, signal) {
      if (!uuid(workerId)) return { ok: false };
      const result = await rpc(
        "claim_shopify_order_jobs",
        { p_worker_id: workerId, p_limit: 1, p_lease_seconds: 120 },
        signal,
      );
      if (!result.ok) return result;
      const rows = shopifyClaimFrom(result.value);
      return rows ? { ok: true, value: rows } : { ok: false };
    },
    async apply(job, order, signal) {
      const result = await rpc(
        "apply_shopify_order",
        { p_job_id: job.job_id, p_lease_token: job.lease_token, p_canonical: order },
        signal,
      );
      if (!result.ok) return result;
      const receipt = shopifyWorkerReceiptFrom(result.value, job.job_id);
      return receipt ? { ok: true, value: receipt } : { ok: false };
    },
    async finish(job, outcome, reason, retrySeconds, signal) {
      if (
        !safeShopifyWorkerReason(reason) ||
        !Number.isInteger(retrySeconds) ||
        retrySeconds < 5 ||
        retrySeconds > 86400
      )
        return { ok: false };
      const result = await rpc(
        "finish_shopify_read_job",
        {
          p_job_id: job.job_id,
          p_lease_token: job.lease_token,
          p_outcome: outcome,
          p_reason: reason,
          p_retry_seconds: retrySeconds,
        },
        signal,
      );
      if (!result.ok) return result;
      const receipt = shopifyWorkerReceiptFrom(result.value, job.job_id);
      return receipt && receipt.status === outcome && receipt.reason === reason
        ? { ok: true, value: receipt }
        : { ok: false };
    },
  };
}
