import "server-only";
import { createClient } from "@supabase/supabase-js";
import { canonicalShop, canonicalTimestamp } from "../shopify/canonical-model";
import {
  abortable,
  createWorkerRpcFetch,
  safeWorkerReason,
  workerRecord,
  workerUuid,
} from "../shopify/worker-io";
import type { PacklinkCanonicalTransaction } from "./types";
import type { PacklinkWorkerConfig } from "./worker-config";

export type PacklinkClaim = {
  connection_id: string;
  expected_client_id: string;
  shop_domain: string;
  cutover_at: string;
  lease_token: string;
  lease_expires_at: string;
};
export type PacklinkReceipt = {
  status: "applied" | "review" | "retry";
  reason: string | null;
  inserted: number;
  replayed: number;
  ignored: number;
};
export type PacklinkPayload = {
  schema_version: 1;
  client_id: string;
  transactions: PacklinkCanonicalTransaction[];
};
export type PacklinkStoreResult<T> = { ok: true; value: T } | { ok: false };
export type PacklinkWorkerStore = {
  claim(workerId: string, signal: AbortSignal): Promise<PacklinkStoreResult<PacklinkClaim | null>>;
  apply(
    claim: PacklinkClaim,
    payload: PacklinkPayload,
    signal: AbortSignal,
  ): Promise<PacklinkStoreResult<PacklinkReceipt>>;
  finish(
    claim: PacklinkClaim,
    outcome: "retry" | "review",
    reason: string,
    signal: AbortSignal,
  ): Promise<PacklinkStoreResult<PacklinkReceipt>>;
};
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1000;

export function packlinkClaimFrom(value: unknown): PacklinkClaim | null | false {
  if (value === null) return null;
  const row = workerRecord(value);
  if (
    !row ||
    Object.keys(row).sort().join(",") !==
      "connection_id,cutover_at,expected_client_id,lease_expires_at,lease_token,shop_domain" ||
    !workerUuid(row.connection_id) ||
    !workerUuid(row.lease_token) ||
    typeof row.expected_client_id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(row.expected_client_id) ||
    !canonicalShop(row.shop_domain)
  )
    return false;
  try {
    canonicalTimestamp(row.cutover_at);
    canonicalTimestamp(row.lease_expires_at);
    return row as PacklinkClaim;
  } catch {
    return false;
  }
}
export function packlinkReceiptFrom(value: unknown): PacklinkReceipt | null {
  const row = workerRecord(value);
  if (
    !row ||
    Object.keys(row).sort().join(",") !== "ignored,inserted,reason,replayed,status" ||
    typeof row.status !== "string" ||
    !["applied", "review", "retry"].includes(row.status) ||
    !count(row.inserted) ||
    !count(row.replayed) ||
    !count(row.ignored) ||
    row.inserted + row.replayed + row.ignored > 1000 ||
    (row.status === "applied" ? row.reason !== null : !safeWorkerReason(row.reason)) ||
    (row.status !== "applied" && (row.inserted !== 0 || row.replayed !== 0 || row.ignored !== 0))
  )
    return null;
  return row as PacklinkReceipt;
}
export function createPacklinkWorkerFetch(
  config: Pick<PacklinkWorkerConfig, "supabaseUrl">,
  fetcher: typeof fetch = fetch,
): typeof fetch {
  return createWorkerRpcFetch(
    {
      supabaseUrl: config.supabaseUrl,
      rpcNames: ["claim_packlink_sync", "apply_packlink_transactions", "finish_packlink_sync"],
      timeoutMs: 4000,
      maxResponseBytes: 32768,
      maxRequestBytes: 4 * 1024 * 1024,
    },
    fetcher,
  );
}
export function createPacklinkWorkerStore(config: PacklinkWorkerConfig): PacklinkWorkerStore {
  const client = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createPacklinkWorkerFetch(config) },
  });
  async function rpc(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<PacklinkStoreResult<unknown>> {
    try {
      const { data, error } = await abortable(client.rpc(name, args).abortSignal(signal), signal);
      return error ? { ok: false } : { ok: true, value: data };
    } catch {
      return { ok: false };
    }
  }
  return {
    async claim(workerId, signal) {
      if (!workerUuid(workerId)) return { ok: false };
      const result = await rpc(
        "claim_packlink_sync",
        { p_worker_id: workerId, p_lease_seconds: 120 },
        signal,
      );
      if (!result.ok) return result;
      const claim = packlinkClaimFrom(result.value);
      return claim === false ? { ok: false } : { ok: true, value: claim };
    },
    async apply(claim, payload, signal) {
      const result = await rpc(
        "apply_packlink_transactions",
        {
          p_connection_id: claim.connection_id,
          p_lease_token: claim.lease_token,
          p_payload: payload,
        },
        signal,
      );
      if (!result.ok) return result;
      const receipt = packlinkReceiptFrom(result.value);
      return receipt &&
        receipt.status !== "retry" &&
        (receipt.status !== "applied" ||
          receipt.inserted + receipt.replayed + receipt.ignored === payload.transactions.length)
        ? { ok: true, value: receipt }
        : { ok: false };
    },
    async finish(claim, outcome, reason, signal) {
      if (!safeWorkerReason(reason)) return { ok: false };
      const result = await rpc(
        "finish_packlink_sync",
        {
          p_connection_id: claim.connection_id,
          p_lease_token: claim.lease_token,
          p_outcome: outcome,
          p_reason: reason,
        },
        signal,
      );
      if (!result.ok) return result;
      const receipt = packlinkReceiptFrom(result.value);
      return receipt && receipt.status === outcome && receipt.reason === reason
        ? { ok: true, value: receipt }
        : { ok: false };
    },
  };
}
