import "server-only";
import { canReadSensitiveArea } from "@/lib/auth/model";
import { verifiedMember } from "@/lib/auth/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function financeDocumentAccess() {
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase);
  if (access.status !== "member") return { allowed: false as const, status: access.status === "signed-out" ? 401 : 403 };
  if (!canReadSensitiveArea(access.member, "finance", "aal2")) return { allowed: false as const, status: 403 };
  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error || !canReadSensitiveArea(access.member, "finance", assurance.data.currentLevel)) return { allowed: false as const, status: 403 };
  return { allowed: true as const, supabase, member: access.member };
}
