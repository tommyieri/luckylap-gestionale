import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WorkspacePanel } from "@/components/workspace-panel";
import { ConsignmentWorkspace } from "@/components/consignment-workspace";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readConsignmentWorkspace } from "@/lib/consignment/server";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Conto vendita" };
export default async function ConsignmentPage() {
  try {
    getSupabasePublicConfig();
  } catch {
    return (
      <WorkspacePanel
        title="Conto vendita da collegare."
        description="Servono il database condiviso e il catalogo verificato per gestire magliette affidate, vendite e regolamenti."
      />
    );
  }
  const access = await readConsignmentWorkspace(await createSupabaseServerClient()).catch(() => ({
    status: "unavailable" as const,
  }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status !== "ready")
    return (
      <WorkspacePanel
        title="Conto vendita non disponibile."
        description="Non è stato possibile verificare l’accesso e leggere tutti i dati. Ricarica tra poco; nessun elenco parziale viene mostrato."
      />
    );
  return <ConsignmentWorkspace snapshot={access.snapshot} member={access.member} />;
}
