import { canonicalTimestamp } from "../shopify/canonical-model";
import { safeWorkerReason, workerRecord } from "../shopify/worker-io";

export type PacklinkSyncSnapshot = {
  configured: boolean;
  enabled: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  outcome: "running" | "applied" | "retry" | "review" | null;
  reason: string | null;
  counts: { inserted: number; replayed: number; ignored: number };
};
export type PacklinkSyncStatus =
  { status: "ready"; snapshot: PacklinkSyncSnapshot } | { status: "unavailable" };
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1000;
export function packlinkSyncSnapshotFrom(
  value: unknown,
  runtimeEnabled: boolean,
): PacklinkSyncSnapshot | null {
  const row = workerRecord(value),
    counts = workerRecord(row?.counts);
  if (
    !row ||
    !counts ||
    Object.keys(row).sort().join(",") !==
      "configured,counts,enabled,last_attempt_at,last_success_at,outcome,reason" ||
    Object.keys(counts).sort().join(",") !== "ignored,inserted,replayed" ||
    typeof row.configured !== "boolean" ||
    typeof row.enabled !== "boolean" ||
    (!row.configured && row.enabled) ||
    ![null, "running", "applied", "retry", "review"].includes(row.outcome as null) ||
    (row.reason !== null && !safeWorkerReason(row.reason)) ||
    !count(counts.inserted) ||
    !count(counts.replayed) ||
    !count(counts.ignored)
  )
    return null;
  try {
    if (row.last_attempt_at !== null) canonicalTimestamp(row.last_attempt_at);
    if (row.last_success_at !== null) canonicalTimestamp(row.last_success_at);
  } catch {
    return null;
  }
  return {
    configured: row.configured,
    enabled: row.enabled && runtimeEnabled,
    lastAttemptAt: row.last_attempt_at as string | null,
    lastSuccessAt: row.last_success_at as string | null,
    outcome: row.outcome as PacklinkSyncSnapshot["outcome"],
    reason: row.reason as string | null,
    counts: { inserted: counts.inserted, replayed: counts.replayed, ignored: counts.ignored },
  };
}
export function packlinkIssueLabel(reason: string | null): string {
  if (reason === "account_mismatch" || reason === "packlink_client_mismatch")
    return "La chiave appartiene a un account Packlink diverso da quello collegato.";
  if (reason === "access_denied")
    return "Packlink non autorizza la lettura: verifica la chiave del collegamento.";
  if (reason === "unsupported_transaction")
    return "Packlink ha restituito un tipo di transazione da verificare.";
  if (reason === "transaction_conflict" || reason === "packlink_transaction_conflict")
    return "Una transazione già acquisita è cambiata alla fonte e richiede una verifica.";
  if (
    reason === "pagination_changed" ||
    reason === "unavailable" ||
    reason === "throttled" ||
    reason === "aborted"
  )
    return "La lettura verrà ritentata automaticamente. Le voci già registrate restano disponibili.";
  return "La lettura richiede una verifica prima di registrare nuove voci. Controlla il collegamento Packlink.";
}
