import "server-only";
import { cache } from "react";
import { redirect, unstable_rethrow } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerifiedMember } from "./model";
import { verifiedMember } from "./server";
import { createSupabaseServerClient } from "../supabase/server";
import { getSupabasePublicConfig } from "../supabase/config";
import { isLocalPreviewEnabled } from "../runtime";

export type CurrentMember =
  /** LUCKYLAP_LOCAL_PREVIEW: nessuna chiamata a Supabase. */
  | { status: "preview" }
  /** getSupabasePublicConfig() lancia. */
  | { status: "unconfigured" }
  | { status: "signed-out" }
  /** Utente senza membership attiva. */
  | { status: "denied" }
  /** Errore di rete o di lettura. */
  | { status: "unavailable" }
  | { status: "member"; member: VerifiedMember; supabase: SupabaseClient };

/**
 * Una sola verifica per richiesta (React `cache`), condivisa da menu e pagine.
 * Non è un cancello: ogni pagina decide cosa mostrare per ogni stato, e la RLS
 * resta l'autorità sui dati. Non lancia mai, tranne gli errori interni di Next.
 */
export const currentMember = cache(async (): Promise<CurrentMember> => {
  if (isLocalPreviewEnabled()) return { status: "preview" };
  try {
    getSupabasePublicConfig();
  } catch {
    return { status: "unconfigured" };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const access = await verifiedMember(supabase);
    if (access.status === "member") return { status: "member", member: access.member, supabase };
    return { status: access.status };
  } catch (error) {
    unstable_rethrow(error);
    return { status: "unavailable" };
  }
});

/** Come `currentMember`, ma reindirizza a /auth/login se non c'è sessione. */
export async function requireMember(): Promise<Exclude<CurrentMember, { status: "signed-out" }>> {
  const current = await currentMember();
  if (current.status === "signed-out") redirect("/auth/login");
  return current;
}
