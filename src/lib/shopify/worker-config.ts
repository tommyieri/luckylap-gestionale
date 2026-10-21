import "server-only";
import { canonicalShop } from "./canonical-model";

export type ShopifyWorkerEnvironment = {
  SHOPIFY_WORKER_ENABLED?: string;
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  SHOPIFY_WORKER_SECRET?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
};
export type ShopifyWorkerConfig = {
  expectedShopDomain: string;
  clientId: string;
  clientSecret: string;
  workerSecret: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
};
export type ShopifyTokenCredentials = Pick<ShopifyWorkerConfig, "expectedShopDomain" | "clientId" | "clientSecret">;

export function validShopifyTokenCredentials(value: ShopifyTokenCredentials): boolean {
  return canonicalShop(value.expectedShopDomain)
    && typeof value.clientId === "string" && /^[A-Za-z0-9_-]{8,256}$/.test(value.clientId)
    && typeof value.clientSecret === "string" && /^[\x21-\x7e]{16,4096}$/.test(value.clientSecret);
}

/** No defaults enable this worker. All credentials remain in server modules. */
export function shopifyWorkerConfig(environment: ShopifyWorkerEnvironment = {
  SHOPIFY_WORKER_ENABLED: process.env.SHOPIFY_WORKER_ENABLED,
  SHOPIFY_SHOP_DOMAIN: process.env.SHOPIFY_SHOP_DOMAIN,
  SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
  SHOPIFY_WORKER_SECRET: process.env.SHOPIFY_WORKER_SECRET,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
}): ShopifyWorkerConfig | null {
  if (environment.SHOPIFY_WORKER_ENABLED !== "true") return null;
  const config = {
    expectedShopDomain: environment.SHOPIFY_SHOP_DOMAIN ?? "",
    clientId: environment.SHOPIFY_CLIENT_ID ?? "",
    clientSecret: environment.SHOPIFY_CLIENT_SECRET ?? "",
    workerSecret: environment.SHOPIFY_WORKER_SECRET ?? "",
    supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseSecretKey: environment.SUPABASE_SECRET_KEY ?? "",
  };
  if (!validShopifyTokenCredentials(config) || !/^[A-Za-z0-9_-]{32,256}$/.test(config.workerSecret)
    || !/^sb_secret_[\x21-\x7e]{8,4096}$/.test(config.supabaseSecretKey)) return null;
  try {
    const url = new URL(config.supabaseUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash) return null;
  } catch { return null; }
  return config;
}
