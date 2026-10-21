import "server-only";
import { verifiedSensitiveAccess } from "../auth/sensitive-access";
import { verifiedMember } from "../auth/server";
import { createSupabaseServerClient } from "../supabase/server";

export async function financeDocumentAccess() {
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase);
  if (access.status !== "member") return { allowed: false as const, status: access.status === "signed-out" ? 401 : 403 };
  if (!await verifiedSensitiveAccess(supabase, access.member, "finance")) return { allowed: false as const, status: 403 };
  return { allowed: true as const, supabase, member: access.member };
}
