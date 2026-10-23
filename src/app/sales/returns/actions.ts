"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { executeSaleReturn, readSaleReturnPreview } from "@/lib/sales-returns/server";
import type { SaleReturnPreviewResult } from "@/lib/sales-returns/model";
import type { CommandResult } from "@/lib/sales/model";
export async function previewSaleReturn(value: unknown): Promise<SaleReturnPreviewResult> {
  try {
    return await readSaleReturnPreview(await createSupabaseServerClient(), value);
  } catch {
    return {
      status: "rejected",
      code: "unavailable",
      message: "L’anteprima del reso non è disponibile. Rileggi la vendita.",
    };
  }
}
export async function registerSaleReturn(value: unknown): Promise<CommandResult> {
  let result: CommandResult;
  try {
    result = await executeSaleReturn(await createSupabaseServerClient({ writable: true }), value);
  } catch {
    return {
      status: "uncertain",
      message: "L’esito del reso non è confermato. Verifica lo stesso tentativo.",
    };
  }
  if (result.status === "success") {
    for (const path of [
      "/sales",
      "/stock",
      "/packaging",
      "/finance",
      "/finance/work",
      "/",
      "/audit",
    ]) {
      try {
        revalidatePath(path);
      } catch {
        /* Il risultato confermato non dipende dal rinnovo della pagina. */
      }
    }
  }
  return result;
}
