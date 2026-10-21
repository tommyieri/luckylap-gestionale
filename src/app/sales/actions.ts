"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { executeSalesCommand } from "@/lib/sales/server";
import type { CommandResult } from "@/lib/sales/model";

export async function runSalesCommand(value: unknown): Promise<CommandResult> {
  try {
    const supabase = await createSupabaseServerClient({ writable: true });
    const result = await executeSalesCommand(supabase, value);
    if (result.status === "success") {
      revalidatePath("/sales");
      revalidatePath("/");
      revalidatePath("/finance");
    }
    return result;
  } catch { return { status: "uncertain", message: "L’esito non è confermato. Conserva questo tentativo e riprova lo stesso invio." }; }
}
