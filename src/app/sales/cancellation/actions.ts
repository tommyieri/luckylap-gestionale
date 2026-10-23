"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  executeSaleCancellation,
  readSaleCancellationPreview,
} from "@/lib/sales-cancellation/server";
import type { SaleCancellationPreviewResult } from "@/lib/sales-cancellation/model";
import type { CommandResult } from "@/lib/sales/model";
export async function previewSaleCancellation(
  value: unknown,
): Promise<SaleCancellationPreviewResult> {
  try {
    return await readSaleCancellationPreview(await createSupabaseServerClient(), value);
  } catch {
    return {
      status: "rejected",
      code: "unavailable",
      message: "L’anteprima non è disponibile. Riprova a rileggere la vendita.",
    };
  }
}
export async function cancelSaleRegistration(value: unknown): Promise<CommandResult> {
  let result: CommandResult;
  try {
    result = await executeSaleCancellation(
      await createSupabaseServerClient({ writable: true }),
      value,
    );
  } catch {
    return {
      status: "uncertain",
      message: "L’esito non è confermato. Verifica lo stesso tentativo.",
    };
  }
  if (result.status === "success") {
    // L’esito del comando resta certo anche se la richiesta di aggiornamento delle pagine fallisce.
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
        /* Il prossimo caricamento legge il registro confermato. */
      }
    }
  }
  return result;
}
