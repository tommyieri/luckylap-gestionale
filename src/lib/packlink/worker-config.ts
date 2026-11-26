import "server-only";
import { validWorkerSupabaseUrl } from "../shopify/worker-config";

export type PacklinkWorkerEnvironment = {
  PACKLINK_WORKER_ENABLED?: string;
  PACKLINK_API_KEY?: string;
  PACKLINK_WORKER_SECRET?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
};
export type PacklinkWorkerConfig = {
  apiKey: string;
  workerSecret: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
};

/** Credentials are used only on the server; an incomplete setup remains disabled. */
export function packlinkWorkerConfig(
  env: PacklinkWorkerEnvironment = {
    PACKLINK_WORKER_ENABLED: process.env.PACKLINK_WORKER_ENABLED,
    PACKLINK_API_KEY: process.env.PACKLINK_API_KEY,
    PACKLINK_WORKER_SECRET: process.env.PACKLINK_WORKER_SECRET,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  },
): PacklinkWorkerConfig | null {
  if (env.PACKLINK_WORKER_ENABLED !== "true") return null;
  const config = {
    apiKey: env.PACKLINK_API_KEY ?? "",
    workerSecret: env.PACKLINK_WORKER_SECRET ?? "",
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseSecretKey: env.SUPABASE_SECRET_KEY ?? "",
  };
  return /^[\x21-\x7e]{16,4096}$/.test(config.apiKey) &&
    /^[A-Za-z0-9_-]{32,256}$/.test(config.workerSecret) &&
    /^sb_secret_[\x21-\x7e]{8,4096}$/.test(config.supabaseSecretKey) &&
    validWorkerSupabaseUrl(config.supabaseUrl)
    ? config
    : null;
}
