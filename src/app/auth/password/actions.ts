"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setMemberPassword } from "@/lib/auth/invitation-server";
import type { PasswordState } from "@/lib/auth/invitation-model";

export async function savePassword(_previous: PasswordState, form: FormData): Promise<PasswordState> {
  try {
    const supabase = await createSupabaseServerClient({ writable: true });
    const result = await setMemberPassword(supabase, form.get("password"), form.get("confirmation"));
    if (result.status === "error") return { error: result.error };
    if (result.status === "mfa-required") return { mfaRequired: true };
    if (result.status === "updated-session-open") return { passwordUpdated: true, error: "Password aggiornata. Completa l’uscita dall’account prima di accedere con la nuova password." };
  } catch { return { error: "Aggiornamento temporaneamente non disponibile. Riprova tra poco." }; }
  redirect("/auth/login?password=updated");
}
