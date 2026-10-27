import "server-only";

export type PartnerAssistantEnvironment = {
  PARTNER_ASSISTANT_ENABLED?: string;
  PARTNER_ASSISTANT_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  PARTNER_ASSISTANT_SUPABASE_SECRET_KEY?: string;
  PARTNER_ASSISTANT_PHONE?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
};
export type PartnerAssistantConfig = {
  workerSecret: string;
  anthropicApiKey: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  phone: string;
};

/** Copia di shopifyWorkerConfig: nessun valore predefinito accende l'assistente. Le chiavi restano
 * nei moduli server; la chiave Supabase è propria, mai quella del worker Shopify. */
export function partnerAssistantConfig(
  environment: PartnerAssistantEnvironment = {
    PARTNER_ASSISTANT_ENABLED: process.env.PARTNER_ASSISTANT_ENABLED,
    PARTNER_ASSISTANT_SECRET: process.env.PARTNER_ASSISTANT_SECRET,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    PARTNER_ASSISTANT_SUPABASE_SECRET_KEY: process.env.PARTNER_ASSISTANT_SUPABASE_SECRET_KEY,
    PARTNER_ASSISTANT_PHONE: process.env.PARTNER_ASSISTANT_PHONE,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  },
): PartnerAssistantConfig | null {
  if (environment.PARTNER_ASSISTANT_ENABLED !== "true") return null;
  const config = {
    workerSecret: environment.PARTNER_ASSISTANT_SECRET ?? "",
    anthropicApiKey: environment.ANTHROPIC_API_KEY ?? "",
    supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseSecretKey: environment.PARTNER_ASSISTANT_SUPABASE_SECRET_KEY ?? "",
    phone: environment.PARTNER_ASSISTANT_PHONE ?? "",
  };
  if (
    !/^[A-Za-z0-9_-]{32,256}$/.test(config.workerSecret) ||
    !/^sb_secret_[\x21-\x7e]{8,4096}$/.test(config.supabaseSecretKey) ||
    config.supabaseSecretKey === environment.SUPABASE_SECRET_KEY ||
    !/^sk-ant-[\x21-\x7e]{16,512}$/.test(config.anthropicApiKey) ||
    // Prefisso internazionale, da 8 a 15 cifre, spazi singoli; il numero resta com'è.
    !/^\+[0-9]( ?[0-9]){7,14}$/.test(config.phone)
  )
    return null;
  try {
    const url = new URL(config.supabaseUrl);
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
  return config;
}
