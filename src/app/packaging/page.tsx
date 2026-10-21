import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { PackagingWorkspace } from "@/components/packaging-workspace";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readPackagingWorkspace } from "@/lib/packaging/server";

export const dynamic = "force-dynamic";

export default async function PackagingPage() {
  try { getSupabasePublicConfig(); } catch { return <AuthShell title="Packaging da collegare." description="Il collegamento al database è necessario per consultare scatole, adesivi per scatole e quantità condivise." />; }
  const access = await readPackagingWorkspace(await createSupabaseServerClient()).catch(() => ({ status: "unavailable" as const }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status !== "ready") return <AuthShell title="Materiali non disponibili." description="Non è stato possibile verificare l’accesso e leggere tutti i materiali. Ricarica tra poco: nessun elenco parziale viene mostrato."><Link href="/" className="button button-secondary">Torna al magazzino</Link></AuthShell>;
  return <PackagingWorkspace snapshot={access.snapshot} member={access.member} />;
}
