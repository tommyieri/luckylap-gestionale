"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { confirmInvitation } from "@/lib/auth/invitation-server";
import type { InvitationState } from "@/lib/auth/invitation-model";

export async function acceptInvitation(_previous: InvitationState, form: FormData): Promise<InvitationState> {
  try {
    const supabase = await createSupabaseServerClient({ writable: true });
    const result = await confirmInvitation(supabase, form.get("token_hash"), form.get("type"));
    if (result.status === "error") return { error: result.error };
  } catch { return { error: "Conferma temporaneamente non disponibile. Riprova tra poco." }; }
  redirect("/auth/password");
}
