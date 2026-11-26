import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { boundedPhase, safeWorkerReason } from "../shopify/worker-io";
import { readPacklinkTransactions } from "./client";
import type { PacklinkReadResult } from "./types";
import {
  packlinkWorkerConfig,
  type PacklinkWorkerConfig,
  type PacklinkWorkerEnvironment,
} from "./worker-config";
import {
  createPacklinkWorkerStore,
  type PacklinkReceipt,
  type PacklinkWorkerStore,
} from "./worker-store";

export const PACKLINK_WORKER_BUDGET_MS = 45000;
type Read = typeof readPacklinkTransactions;
export type PacklinkWorkerDependencies = {
  store?: PacklinkWorkerStore;
  read?: Read;
  workerId?: () => string;
  now?: () => Date;
};
export type PacklinkWorkerRun = {
  status: "complete" | "uncertain";
  outcome: "idle" | PacklinkReceipt["status"];
  counts: { inserted: number; replayed: number; ignored: number };
};
export function authorizedPacklinkWorker(header: string | null, secret: string): boolean {
  if (!header || header.length > 512 || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) return false;
  const expected = Buffer.from(`Bearer ${secret}`),
    actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** One complete, account-bound snapshot enters one atomic DB transaction. */
export async function runPacklinkWorker(
  config: PacklinkWorkerConfig,
  parentSignal: AbortSignal,
  dependencies: PacklinkWorkerDependencies = {},
): Promise<PacklinkWorkerRun> {
  const uncertain: PacklinkWorkerRun = {
    status: "uncertain",
    outcome: "idle",
    counts: { inserted: 0, replayed: 0, ignored: 0 },
  };
  try {
    return await boundedPhase(parentSignal, PACKLINK_WORKER_BUDGET_MS, async (signal) => {
      const store = dependencies.store ?? createPacklinkWorkerStore(config);
      const claimed = await boundedPhase(signal, 4000, (s) =>
        store.claim((dependencies.workerId ?? randomUUID)(), s),
      );
      if (!claimed.ok) return uncertain;
      const claim = claimed.value;
      if (!claim) return { ...uncertain, status: "complete" };
      if (Date.parse(claim.lease_expires_at) - Date.now() < 50000) return uncertain;
      let read: PacklinkReadResult;
      try {
        read = await boundedPhase(signal, 35000, (s) =>
          (dependencies.read ?? readPacklinkTransactions)(
            {
              apiKey: config.apiKey,
              expectedClientId: claim.expected_client_id,
              cutoverAt: claim.cutover_at,
              now: (dependencies.now ?? (() => new Date()))(),
            },
            { signal: s },
          ),
        );
      } catch {
        read = { status: "retry", code: "unavailable" };
      }
      if (signal.aborted) return uncertain;
      if (read.status !== "ready") {
        const reason = safeWorkerReason(read.code) ? read.code : "unavailable";
        const finished = await boundedPhase(signal, 4000, (s) =>
          store.finish(claim, read.status, reason, s),
        );
        return finished.ok
          ? {
              status: "complete",
              outcome: finished.value.status,
              counts: { inserted: 0, replayed: 0, ignored: 0 },
            }
          : uncertain;
      }
      if (read.clientId !== claim.expected_client_id) {
        const finished = await boundedPhase(signal, 4000, (s) =>
          store.finish(claim, "review", "account_mismatch", s),
        );
        return finished.ok
          ? {
              status: "complete",
              outcome: "review",
              counts: { inserted: 0, replayed: 0, ignored: 0 },
            }
          : uncertain;
      }
      // Never finalize on a lost apply response: the commit may already exist.
      const applied = await boundedPhase(signal, 4000, (s) =>
        store.apply(
          claim,
          {
            schema_version: 1,
            client_id: read.clientId,
            transactions: read.transactions,
          },
          s,
        ),
      );
      if (!applied.ok) return uncertain;
      const { status: outcome, inserted, replayed, ignored } = applied.value;
      return { status: "complete", outcome, counts: { inserted, replayed, ignored } };
    });
  } catch {
    return uncertain;
  }
}
const reply = (status: number, body: object) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(status === 503 ? { "Retry-After": "60" } : {}),
    },
  });
export async function receivePacklinkWorkerTick(
  request: Request,
  dependencies: PacklinkWorkerDependencies & { environment?: PacklinkWorkerEnvironment } = {},
): Promise<Response> {
  const config = packlinkWorkerConfig(dependencies.environment);
  if (!config) return reply(503, { processed: false, error: "worker_unavailable" });
  if (!authorizedPacklinkWorker(request.headers.get("authorization"), config.workerSecret))
    return reply(401, { processed: false, error: "unauthorized" });
  // Request body, URL and user cookies never select the account or transaction.
  const result = await runPacklinkWorker(config, request.signal, dependencies);
  return result.status === "complete"
    ? reply(200, { processed: true, outcome: result.outcome, counts: result.counts })
    : reply(503, { processed: false, error: "worker_unavailable" });
}
