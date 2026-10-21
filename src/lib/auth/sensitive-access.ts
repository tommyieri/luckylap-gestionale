import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canReadSensitiveArea, isSensitiveAreaEligible, type SensitiveArea, type VerifiedMember } from "./model";

/** Supply a just-verified DB membership. Status is always read from this caller's session, never cached. */
export async function verifiedSensitiveAccess(supabase: SupabaseClient, member: VerifiedMember, area: SensitiveArea): Promise<boolean> {
  if (!isSensitiveAreaEligible(member, area)) return false;
  const { data, error } = await supabase.rpc("sensitive_area_status", { p_area: area });
  if (error || typeof data !== "boolean") throw new Error("Verifica dell’area riservata non disponibile.");
  return canReadSensitiveArea(member, area, data);
}
