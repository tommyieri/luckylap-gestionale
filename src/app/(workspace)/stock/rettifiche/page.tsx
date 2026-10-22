import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StockWorkspace } from "@/components/stock-workspace";
import { WorkspacePanel } from "@/components/workspace-panel";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readStockWorkspace } from "@/lib/stock/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rettifiche" };

export default async function StockAdjustmentsPage() {
  try {
    getSupabasePublicConfig();
  } catch {
    return (
      <WorkspacePanel
        title="Magazzino condiviso da collegare."
        description="Il collegamento al database è necessario per consultare e rettificare le quantità reali."
      />
    );
  }
  const access = await readStockWorkspace(await createSupabaseServerClient()).catch(() => ({
    status: "unavailable" as const,
  }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status !== "ready")
    return (
      <WorkspacePanel
        title="Rettifiche non disponibili."
        description="Non è stato possibile verificare l’accesso e leggere tutte le quantità. Ricarica tra poco: nessun elenco parziale viene mostrato."
      />
    );
  return <StockWorkspace snapshot={access.snapshot} member={access.member} />;
}
