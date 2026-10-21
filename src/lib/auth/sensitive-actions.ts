import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSensitiveAreaEligible, isValidWorkspacePassword, sensitiveAreaFrom, type SensitiveArea } from "./model";
import { verifiedMember } from "./server";

export type SensitiveAreaState = { error?: string };
type AreaResult = { status: "unlocked"; area: SensitiveArea } | { status: "error"; error: string };
const unavailable = "Verifica temporaneamente non disponibile. Riprova tra poco.";
const denied = "Accesso non riuscito. Controlla la password dell’area e l’abilitazione del tuo account.";

export async function unlockSensitiveArea(supabase: SupabaseClient, areaValue: unknown, password: unknown): Promise<AreaResult> {
  const area = sensitiveAreaFrom(areaValue);
  if (!area || !isValidWorkspacePassword(password)) return { status: "error", error: "Inserisci la password dell’area: almeno 6 caratteri, entro il limite di 72 byte." };
  try {
    const access = await verifiedMember(supabase);
    if (access.status !== "member" || !isSensitiveAreaEligible(access.member, area)) return { status: "error", error: denied };
    const { data, error } = await supabase.rpc("unlock_sensitive_area", { p_area: area, p_password: password });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return { status: "error", error: unavailable };
    const result = data as Record<string, unknown>;
    if (Object.keys(result).sort().join(",") !== "expires_at,status") return { status: "error", error: unavailable };
    if (result.status === "locked") return { status: "error", error: "Troppi tentativi. Attendi prima di riprovare con la password dell’area." };
    if (result.status === "denied") return { status: "error", error: denied };
    if (result.status !== "unlocked" || typeof result.expires_at !== "string" || !Number.isFinite(Date.parse(result.expires_at))
      || Date.parse(result.expires_at) <= Date.now()) return { status: "error", error: unavailable };
    return { status: "unlocked", area };
  } catch { return { status: "error", error: unavailable }; }
}

export async function lockSensitiveArea(supabase: SupabaseClient, areaValue: unknown): Promise<{ status: "locked"; area: SensitiveArea } | { status: "error"; error: string }> {
  const area = sensitiveAreaFrom(areaValue);
  if (!area) return { status: "error", error: unavailable };
  try {
    const access = await verifiedMember(supabase);
    if (access.status !== "member" || !isSensitiveAreaEligible(access.member, area)) return { status: "error", error: denied };
    const { data, error } = await supabase.rpc("lock_sensitive_area", { p_area: area });
    return error || data !== true ? { status: "error", error: unavailable } : { status: "locked", area };
  } catch { return { status: "error", error: unavailable }; }
}
