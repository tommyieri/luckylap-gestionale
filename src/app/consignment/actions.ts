"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { executeConsignmentCommand } from "../../lib/consignment/server";
import { executeShopCommand } from "../../lib/consignment/shop-server";
import { isLocalPreviewEnabled } from "../../lib/runtime";
import type { ConsignmentResult } from "../../lib/consignment/model";
import type { ShopResult } from "../../lib/consignment/shop-model";

/** Pagine che mostrano dati del conto vendita: si rileggono dopo un invio confermato. */
const SHOP_PATHS: [string, "layout" | undefined][] = [
  ["/consignment", "layout"],
  ["/", undefined],
  ["/stock", undefined],
  ["/packaging", undefined],
  ["/finance", undefined],
  ["/finance/work", undefined],
];

/** Comandi del conto vendita semplice (negozi, conte, resoconti, ordini, pagamenti). */
export async function runShopCommand(value: unknown): Promise<ShopResult> {
  if (isLocalPreviewEnabled())
    return {
      status: "rejected",
      code: "preview",
      message: "Anteprima locale: il salvataggio è disattivato.",
    };
  let result: ShopResult;
  try {
    result = await executeShopCommand(await createSupabaseServerClient({ writable: true }), value);
  } catch {
    return {
      status: "uncertain",
      message: "Connessione interrotta. Conserva e verifica lo stesso invio prima di continuare.",
    };
  }
  if (result.status === "success") {
    for (const [path, type] of SHOP_PATHS) {
      try {
        revalidatePath(path, type);
      } catch {
        /* Una ricevuta confermata resta valida anche se la cache non si aggiorna. */
      }
    }
  }
  return result;
}

/** Comandi precedenti: servono solo a verificare un tentativo rimasto in sospeso. */
export async function runConsignmentCommand(value: unknown): Promise<ConsignmentResult> {
  let result: ConsignmentResult;
  try {
    result = await executeConsignmentCommand(
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
    try {
      for (const path of ["/consignment", "/stock", "/", "/finance/work", "/finance"])
        revalidatePath(path);
    } catch {
      /* A confirmed receipt survives cache errors. */
    }
  }
  return result;
}
