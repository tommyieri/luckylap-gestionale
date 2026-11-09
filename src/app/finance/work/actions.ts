"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { executeFinanceWork } from "@/lib/finance-work/server";
import type { FinanceWorkResult } from "@/lib/finance-work/model";
import { isUuid } from "../../../lib/sales/model";
export async function runFinanceWork(value: unknown, actorId: string): Promise<FinanceWorkResult> {
  if (!isUuid(actorId))
    return {
      status: "uncertain",
      message:
        "L’account che ha preparato questo invio non è verificabile. Conserva il tentativo e rientra con lo stesso account.",
    };
  try {
    const supabase = await createSupabaseServerClient({ writable: true });
    const result = await executeFinanceWork(supabase, value, actorId);
    if (result.status === "success") {
      for (const path of ["/finance", "/finance/work", "/", "/audit"]) {
        try {
          revalidatePath(path);
        } catch {
          /* A confirmed receipt survives cache errors. */
        }
      }
    }
    return result;
  } catch {
    return {
      status: "uncertain",
      message:
        "L’esito non è confermato. Conserva e verifica lo stesso tentativo prima di inserire altre voci.",
    };
  }
}
