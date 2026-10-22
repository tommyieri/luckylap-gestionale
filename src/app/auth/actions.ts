"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { parseCredentials } from "@/lib/auth/model";
import { verifiedMember } from "@/lib/auth/server";
import type { MfaState, SignInState } from "@/lib/auth/action-state";

const denied = "Accesso non riuscito. Verifica le credenziali e l’abilitazione al team.";

export async function signIn(_previous: SignInState, form: FormData): Promise<SignInState> {
  const credentials = parseCredentials(form.get("email"), form.get("password"));
  if (!credentials) return { error: denied };
  try {
    getSupabasePublicConfig();
  } catch {
    return { error: "Il collegamento al workspace deve essere completato." };
  }
  try {
    const supabase = await createSupabaseServerClient({ writable: true });
    const { error } = await supabase.auth.signInWithPassword(credentials);
    if (error) return { error: denied };
    const access = await verifiedMember(supabase);
    if (access.status !== "member") {
      await supabase.auth.signOut({ scope: "local" });
      return { error: denied };
    }
  } catch {
    return { error: "Accesso temporaneamente non disponibile. Riprova tra poco." };
  }
  redirect("/");
}

export async function signOut(): Promise<void> {
  try {
    getSupabasePublicConfig();
  } catch {
    redirect("/auth/login");
  }
  const supabase = await createSupabaseServerClient({ writable: true });
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw new Error("Uscita non completata. Riprova tra poco.");
  redirect("/auth/login");
}

export async function verifyTotp(_previous: MfaState, form: FormData): Promise<MfaState> {
  const factorId = form.get("factorId"),
    code = form.get("code");
  if (
    typeof factorId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(factorId) ||
    typeof code !== "string" ||
    !/^\d{6}$/.test(code.trim())
  )
    return { error: "Inserisci il codice a 6 cifre dell’app di autenticazione." };
  try {
    const supabase = await createSupabaseServerClient({ writable: true });
    if ((await verifiedMember(supabase)).status !== "member")
      return { error: "Accesso al team richiesto." };
    const factors = await supabase.auth.mfa.listFactors();
    if (
      factors.error ||
      !factors.data.all.some(
        (factor) =>
          factor.id === factorId && factor.factor_type === "totp" && factor.status === "verified",
      )
    )
      return { error: "Configurazione della verifica non disponibile." };
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (error) return { error: "Codice non valido o scaduto. Riprova con il codice corrente." };
  } catch {
    return { error: "Verifica temporaneamente non disponibile." };
  }
  redirect("/auth/password");
}
