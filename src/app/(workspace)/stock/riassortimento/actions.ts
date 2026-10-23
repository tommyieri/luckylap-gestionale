"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { executeRestockCommand } from "../../../../lib/restock/server";
import { isLocalPreviewEnabled } from "../../../../lib/runtime";
import type { RestockResult } from "../../../../lib/restock/model";

/** Pagine che mostrano dati del riassortimento o del magazzino: si rileggono dopo un invio confermato. */
const RESTOCK_PATHS: [string, "layout" | undefined][] = [
  ["/stock/riassortimento", "layout"],
  ["/stock", undefined],
  ["/stock/rettifiche", undefined],
  ["/", undefined],
  ["/sales", undefined],
  ["/consignment", "layout"],
  ["/stock/conto-vendita", "layout"],
  ["/audit", undefined],
];

/** Comandi del riassortimento. In anteprima locale non parte niente. */
export async function runRestockCommand(value: unknown): Promise<RestockResult> {
  if (isLocalPreviewEnabled())
    return {
      status: "rejected",
      code: "preview",
      message: "Anteprima locale: il salvataggio è disattivato.",
    };
  let result: RestockResult;
  try {
    result = await executeRestockCommand(
      await createSupabaseServerClient({ writable: true }),
      value,
    );
  } catch {
    return {
      status: "uncertain",
      message: "Connessione interrotta. Conserva e verifica lo stesso invio prima di continuare.",
    };
  }
  if (result.status === "success") {
    for (const [path, type] of RESTOCK_PATHS) {
      try {
        revalidatePath(path, type);
      } catch {
        /* Una ricevuta confermata resta valida anche se la cache non si aggiorna. */
      }
    }
  }
  return result;
}
