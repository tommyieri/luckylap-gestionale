import type { Metadata } from "next";
import { AccessPanel } from "@/components/access-panel";
import { InventoryWorkspace } from "@/components/inventory-workspace";
import { RefreshButton } from "@/components/refresh-button";
import { PanelActions, WorkspacePanel } from "@/components/workspace-panel";
import { requireMember } from "@/lib/auth/current-member";
import { loadAuthenticatedInventory } from "@/lib/auth/server";
import { loadMagadzinoAvailability } from "@/lib/inventory/magadzino-availability";
import { MODEL_PARAM, parseModelParam } from "@/lib/inventory/model-filter";
import { countTshirtLines, type TshirtLineCount } from "@/lib/inventory/tshirt-lines";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Magazzino" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Giacenze: prima scheda di Magazzino (prima era la vista predefinita di `/`). In cima
 * «Magliette disponibili»; `?modello=` filtra la tabella su un modello del catalogo.
 */
export default async function StockPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, current] = await Promise.all([searchParams, requireMember()]);
  const model = parseModelParam(params[MODEL_PARAM]);
  if (current.status === "preview") {
    const [{ loadInventory }, { previewMagadzinoAvailability }] = await Promise.all([
      import("@/lib/inventory"),
      import("@/lib/inventory/tshirt-fixtures"),
    ]);
    const { items, sourceMeta } = await loadInventory();
    const lines = countTshirtLines(items, previewMagadzinoAvailability(items));
    return (
      <InventoryWorkspace
        items={items}
        sourceMeta={sourceMeta}
        shared={false}
        model={model}
        tshirts={{ lines, preview: true }}
      />
    );
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
  // Le magliette disponibili hanno una lettura a parte: se non riesce, la tabella resta.
  const availability = loadMagadzinoAvailability(current.supabase).catch(() => null);
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
  const rows = await availability;
  let lines: TshirtLineCount[] | null = null;
  try {
    lines = rows ? countTshirtLines(inventory.items, rows) : null;
  } catch {
    // Disponibilità duplicate: meglio nessun numero che un numero sbagliato.
  }
  return (
    <InventoryWorkspace
      items={inventory.items}
      sourceMeta={inventory.sourceMeta}
      shared
      model={model}
      tshirts={{ lines, preview: false }}
    />
  );
}
