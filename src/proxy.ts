import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isLocalPreviewEnabled } from "@/lib/runtime";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const finish = () => {
    response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Referrer-Policy", "same-origin");
    return response;
  };
  if (isLocalPreviewEnabled()) return finish();
  let publicConfig;
  try { publicConfig = getSupabasePublicConfig(); } catch { return finish(); }
  const pending = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const supabase = createServerClient(publicConfig.url, publicConfig.publishableKey, {
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const cookie of cookiesToSet) { request.cookies.set(cookie.name, cookie.value); pending.set(cookie.name, cookie); }
        response = NextResponse.next({ request });
        for (const cookie of pending.values()) response.cookies.set(cookie.name, cookie.value, cookie.options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });
  // Refresh and verify against Auth, never trust getSession's embedded user.
  // Pages and every action independently verify getUser + DB membership again.
  try { await supabase.auth.getUser(); } catch { /* Protected pages fail closed. */ }
  return finish();
}

export const config = { matcher: ["/", "/auth/:path*", "/finance/:path*", "/team/:path*", "/sales/:path*", "/stock/:path*", "/audit/:path*"] };
