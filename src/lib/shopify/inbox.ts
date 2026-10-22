import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { ShopifyOrderNotification } from "./webhook";

export type ShopifyReceiverEnvironment = {
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
};
export type ShopifyReceiverConfig = {
  expectedShopDomain: string;
  clientSecret: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
};
export type ShopifyInboxReceipt = {
  inbox_id: string;
  job_id: string;
  received_at: string;
  state: "awaiting_app";
  replayed: boolean;
};
export type ShopifyInboxResult =
  | { ok: true; receipt: ShopifyInboxReceipt }
  | { ok: false; error: "delivery_conflict" | "persistence_unavailable" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A separate, server-only client. It must never inherit caller cookies or Auth. */
export function shopifyReceiverConfig(
  environment: ShopifyReceiverEnvironment = {
    SHOPIFY_SHOP_DOMAIN: process.env.SHOPIFY_SHOP_DOMAIN,
    SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  },
): ShopifyReceiverConfig | null {
  const expectedShopDomain = environment.SHOPIFY_SHOP_DOMAIN?.trim();
  const clientSecret = environment.SHOPIFY_CLIENT_SECRET?.trim();
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseSecretKey = environment.SUPABASE_SECRET_KEY?.trim();
  if (
    !expectedShopDomain ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(expectedShopDomain) ||
    !clientSecret ||
    clientSecret.length > 4096 ||
    !supabaseUrl ||
    !supabaseSecretKey ||
    !/^sb_secret_\S{8,4096}$/.test(supabaseSecretKey)
  )
    return null;
  try {
    const url = new URL(supabaseUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
  } catch {
    return null;
  }
  return { expectedShopDomain, clientSecret, supabaseUrl, supabaseSecretKey };
}

function receiptFrom(value: unknown): ShopifyInboxReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !== "inbox_id,job_id,received_at,replayed,state" ||
    typeof row.inbox_id !== "string" ||
    !uuid.test(row.inbox_id) ||
    typeof row.job_id !== "string" ||
    !uuid.test(row.job_id) ||
    typeof row.received_at !== "string" ||
    !Number.isFinite(Date.parse(row.received_at)) ||
    row.state !== "awaiting_app" ||
    typeof row.replayed !== "boolean"
  )
    return null;
  return row as ShopifyInboxReceipt;
}

export async function persistShopifyNotification(
  notification: ShopifyOrderNotification,
  config: ShopifyReceiverConfig,
  signal: AbortSignal,
): Promise<ShopifyInboxResult> {
  try {
    const client = createClient(config.supabaseUrl, config.supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await client
      .rpc("receive_shopify_order_notification", { p_cue: notification })
      .abortSignal(signal);
    if (error)
      return {
        ok: false,
        error:
          error.code === "22023" && error.message === "shopify_delivery_conflict"
            ? "delivery_conflict"
            : "persistence_unavailable",
      };
    const receipt = receiptFrom(data);
    return receipt ? { ok: true, receipt } : { ok: false, error: "persistence_unavailable" };
  } catch {
    return { ok: false, error: "persistence_unavailable" };
  }
}
