import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifiedMember } from "../auth/server";
import { shopifySyncSnapshotFrom, type ShopifySyncStatus } from "./status-model";

export async function readShopifySyncStatus(
  supabase: SupabaseClient,
  runtimeEnabled = process.env.SHOPIFY_WORKER_ENABLED === "true",
): Promise<ShopifySyncStatus> {
  try {
    if ((await verifiedMember(supabase)).status !== "member") return { status: "unavailable" };
    const { data, error } = await supabase.rpc("get_shopify_sync_status");
    if (error) return { status: "unavailable" };
    const snapshot = shopifySyncSnapshotFrom(data, runtimeEnabled);
    return snapshot ? { status: "ready", snapshot } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
