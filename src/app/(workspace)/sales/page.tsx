import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WorkspacePanel } from "@/components/workspace-panel";
import { SalesWorkspace } from "@/components/sales-workspace";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readSalesWorkspace } from "@/lib/sales/server";
import { readShopifySyncStatus } from "@/lib/shopify/status-server";
import { ShopifySyncHealth } from "@/components/shopify-sync-health";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vendite" };

export default async function SalesPage() {
  try {
    getSupabasePublicConfig();
  } catch {
    return (
      <WorkspacePanel
        title="Vendite in attesa del collegamento."
        description="Il workspace condiviso deve essere configurato prima di leggere o registrare operazioni."
      />
    );
  }
  const supabase = await createSupabaseServerClient();
  const access = await readSalesWorkspace(supabase).catch(() => ({
    status: "unavailable" as const,
  }));
  if (access.status === "signed-out") redirect("/auth/login");
  if (access.status !== "ready")
    return (
      <WorkspacePanel
        title="Vendite non disponibili."
        description="Non è stato possibile verificare l’accesso o leggere tutti i dati. Ricarica tra poco: nessuna lista parziale viene mostrata."
      />
    );
  const syncStatus = await readShopifySyncStatus(supabase);
  return (
    <SalesWorkspace
      snapshot={access.snapshot}
      member={access.member}
      now={new Date().toISOString()}
      health={<ShopifySyncHealth status={syncStatus} />}
      cancelledRegistrationIds={access.cancelledRegistrationIds}
      returnSummaries={access.returnSummaries}
    />
  );
}
