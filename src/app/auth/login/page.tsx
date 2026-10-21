import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/auth-login-form";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { verifiedMember } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  try { getSupabasePublicConfig(); } catch { return <AuthShell title="Prepariamo l’accesso del team." description="Il collegamento al workspace condiviso deve essere completato. I dati interni restano riservati." />; }
  const supabase = await createSupabaseServerClient();
  const access = await verifiedMember(supabase);
  if (access.status === "member") redirect("/");
  return <AuthShell title="Il brand, in un solo posto." description="Accedi con l’account LuckyLap abilitato per te."><LoginForm /></AuthShell>;
}
