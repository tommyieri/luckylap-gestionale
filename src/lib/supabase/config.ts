export type SupabasePublicConfig = { url: string; publishableKey: string };
type SupabaseEnvironment = { NEXT_PUBLIC_SUPABASE_URL?: string; NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string };

/** Only public, caller-scoped credentials belong in these clients. */
export function getSupabasePublicConfig(environment: SupabaseEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
}): SupabasePublicConfig {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase non configurato: impostare NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL deve essere un URL Supabase valido.");
  }

  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname);
  if (parsedUrl.protocol !== "https:" && !(local && parsedUrl.protocol === "http:")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL richiede HTTPS, oppure HTTP solo in locale.");
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash || parsedUrl.pathname !== "/") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL deve contenere soltanto l'indirizzo del progetto.");
  }
  if (!publishableKey.startsWith("sb_publishable_")) {
    throw new Error(
      "Usare una chiave pubblicabile Supabase (sb_publishable_...). Le chiavi segrete e service_role non sono ammesse nei client dell'app.",
    );
  }

  return { url, publishableKey };
}
