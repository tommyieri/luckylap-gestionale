import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WorkspacePanel } from "@/components/workspace-panel";
import { PackagingWorkspace } from "@/components/packaging-workspace";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readSimplePackagingWorkspace } from "@/lib/packaging/simple-server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Packaging" };

export default async function PackagingPage() {
  try {
    getSupabasePublicConfig();
  } catch {
    return (
      <WorkspacePanel
        title="Packaging da collegare."
        description="Il collegamento al database è necessario per consultare scatole, adesivi per scatole e quantità condivise."
      />
    );
  }
  const access = await readSimplePackagingWorkspace(await createSupabaseServerClient()).catch(
    () => ({ status: "unavailable" as const }),
  );
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status !== "ready")
    return (
      <WorkspacePanel
        title="Materiali non disponibili."
        description="Non è stato possibile verificare l’accesso e leggere tutti i materiali. Ricarica tra poco: nessun elenco parziale viene mostrato."
      />
    );
  return <PackagingWorkspace snapshot={access.snapshot} member={access.member} />;
}
