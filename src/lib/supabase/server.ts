import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicConfig } from "./config";

/**
 * Create per request. Proxy refreshes cookies and sets no-store on all app/auth
 * responses. Server Components read only; actions explicitly opt into writes.
 * Tokens stay HttpOnly because this app performs Auth on the server exclusively.
 */
export async function createSupabaseServerClient(options: { writable?: boolean } = {}) {
  const { url, publishableKey } = getSupabasePublicConfig();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // A Server Component cannot write headers. Proxy already refreshed the
        // request and response cookies; actions may write before streaming.
        if (!options.writable) return;
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });
}
