import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseInvitation, validateNewPassword } from "./invitation-model";
import { verifiedMember } from "./server";

const invalidLink = "Il link non è valido, è scaduto o è già stato usato. Chiedi a Tommi un nuovo collegamento.";
const unavailable = "Operazione temporaneamente non disponibile. Riprova tra poco.";
type FlowError = { status: "error"; error: string };

export async function confirmInvitation(supabase: SupabaseClient, tokenHash: unknown, type: unknown): Promise<{ status: "confirmed" } | FlowError> {
  const invitation = parseInvitation(tokenHash, type);
  if (!invitation) return { status: "error", error: invalidLink };
  try {
    const { error } = await supabase.auth.verifyOtp(invitation);
    if (error) return { status: "error", error: invalidLink };
    const access = await verifiedMember(supabase);
    if (access.status !== "member") {
      await supabase.auth.signOut({ scope: "local" });
      return { status: "error", error: "L’account non è abilitato al team. Chiedi a Tommi di verificare l’accesso." };
    }
    return { status: "confirmed" };
  } catch { return { status: "error", error: unavailable }; }
}

export async function readPasswordAccess(supabase: SupabaseClient) {
  try {
    const access = await verifiedMember(supabase);
    if (access.status !== "member") return access;
    const [level, factors] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);
    if (level.error || factors.error || !level.data || !factors.data || !level.data.currentLevel) return { status: "unavailable" as const };
    const hasVerifiedFactor = factors.data.all.some(factor => factor.status === "verified");
    if ((level.data.nextLevel === "aal2" || hasVerifiedFactor) && level.data.currentLevel !== "aal2") {
      return { status: "mfa-required" as const };
    }
    return { status: "ready" as const, member: access.member };
  } catch { return { status: "unavailable" as const }; }
}

export async function setMemberPassword(supabase: SupabaseClient, passwordValue: unknown, confirmation: unknown):
  Promise<{ status: "updated-signed-out" | "updated-session-open" | "mfa-required" } | FlowError> {
  const parsed = validateNewPassword(passwordValue, confirmation);
  if (!parsed.ok) return { status: "error", error: parsed.error };
  try {
    const access = await readPasswordAccess(supabase);
    if (access.status === "mfa-required") return { status: "mfa-required" };
    if (access.status !== "ready") return { status: "error", error: "Accedi con un account LuckyLap abilitato prima di impostare la password." };
    const { data, error } = await supabase.auth.updateUser({ password: parsed.password });
    if (error || !data.user || data.user.id !== access.member.userId) return { status: "error", error: "Password non aggiornata. Riprova con una password diversa o richiedi un nuovo link." };
    // Distinguish a completed password write from the following sign-out, so a
    // network failure never invites the user to repeat the password mutation.
    try {
      const signedOut = await supabase.auth.signOut({ scope: "local" });
      return { status: signedOut.error ? "updated-session-open" : "updated-signed-out" };
    } catch { return { status: "updated-session-open" }; }
  } catch { return { status: "error", error: unavailable }; }
}
