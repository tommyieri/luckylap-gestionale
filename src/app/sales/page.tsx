import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { SalesWorkspace } from "@/components/sales-workspace";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readSalesWorkspace } from "@/lib/sales/server";

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  try { getSupabasePublicConfig(); } catch { return <AuthShell title="Vendite in attesa del collegamento." description="Il workspace condiviso deve essere configurato prima di leggere o registrare operazioni." />; }
  const supabase = await createSupabaseServerClient();
  const access = await readSalesWorkspace(supabase).catch(() => ({ status: "unavailable" as const }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status !== "ready") return <AuthShell title="Vendite non disponibili." description="Non è stato possibile verificare l’accesso o leggere tutti i dati. Ricarica tra poco: nessuna lista parziale viene mostrata."><Link href="/" className="button button-secondary">Torna al workspace</Link></AuthShell>;
  return <SalesWorkspace snapshot={access.snapshot} member={access.member} now={new Date().toISOString()} />;
}
