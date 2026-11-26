import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { financeWorkAccess } from "../finance-work/server";
import { packlinkSyncSnapshotFrom, type PacklinkSyncStatus } from "./status-model";
import { packlinkWorkerConfig } from "./worker-config";

export async function readPacklinkSyncStatus(
  supabase: SupabaseClient,
  runtimeEnabled = packlinkWorkerConfig() !== null,
): Promise<PacklinkSyncStatus> {
  try {
    if ((await financeWorkAccess(supabase)).status !== "authorized")
      return { status: "unavailable" };
    const { data, error } = await supabase.rpc("get_packlink_sync_status");
    if (error) return { status: "unavailable" };
    const snapshot = packlinkSyncSnapshotFrom(data, runtimeEnabled);
    return snapshot ? { status: "ready", snapshot } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
