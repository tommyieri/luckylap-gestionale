"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { executeStockAdjustment } from "../../lib/stock/server";
import type { StockAdjustmentResult } from "../../lib/stock/model";

export async function adjustStock(value: unknown): Promise<StockAdjustmentResult> {
  let result: StockAdjustmentResult;
  try {
    result = await executeStockAdjustment(
      await createSupabaseServerClient({ writable: true }),
      value,
    );
  } catch {
    return {
      status: "uncertain",
      message:
        "La connessione non ha restituito un esito. Conserva lo stesso tentativo e verifica prima di continuare.",
    };
  }
  if (result.status === "success") {
    // Once the ledger receipt is known, a rendering/cache error must not erase
    // that confirmation or make the client generate a second operation.
    try {
      for (const path of ["/stock", "/", "/sales"]) revalidatePath(path);
    } catch {
      /* Client also refreshes the current route. */
    }
  }
  return result;
}
