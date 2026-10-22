import type { Metadata } from "next";
import { AccessPanel } from "@/components/access-panel";
import { InventoryWorkspace } from "@/components/inventory-workspace";
import { RefreshButton } from "@/components/refresh-button";
import { PanelActions, WorkspacePanel } from "@/components/workspace-panel";
import { requireMember } from "@/lib/auth/current-member";
import { loadAuthenticatedInventory } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Magazzino" };

/** Giacenze: prima scheda di Magazzino (prima era la vista predefinita di `/`). */
export default async function StockPage() {
  const current = await requireMember();
  if (current.status === "preview") {
    const { loadInventory } = await import("@/lib/inventory");
    const { items, sourceMeta } = await loadInventory();
    return <InventoryWorkspace items={items} sourceMeta={sourceMeta} shared={false} />;
  }
  if (current.status !== "member")
    return (
      <AccessPanel
        status={current.status}
        setup={{
          title: "Magazzino condiviso da collegare.",
          description:
            "Il collegamento al database è necessario per consultare le quantità reali. Le scorte non vengono caricate su questa pagina.",
        }}
      />
    );
  let inventory;
  try {
    inventory = await loadAuthenticatedInventory(current.supabase);
  } catch {
    return (
      <WorkspacePanel
        title="Inventario da collegare."
        description="L’accesso al team è verificato. L’inventario condiviso deve ancora essere importato o non è disponibile; non vengono utilizzate copie locali in sostituzione."
      >
        <PanelActions>
          <RefreshButton />
        </PanelActions>
      </WorkspacePanel>
    );
  }
  return <InventoryWorkspace items={inventory.items} sourceMeta={inventory.sourceMeta} shared />;
}
