"use server";

import { revalidatePath } from "next/cache";
import { isLocalPreviewEnabled } from "../../../lib/runtime";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { executePartnerWork } from "../../../lib/work-links/server";
import type { PartnerWorkResult } from "../../../lib/work-links/model";

export async function createPartnerWork(value: unknown): Promise<PartnerWorkResult> {
  // Anteprima locale: dati sintetici, nessuna chiamata a Supabase (00-sequenza §1.5).
  if (isLocalPreviewEnabled())
    return {
      status: "rejected",
      code: "preview",
      message: "Anteprima locale: salvataggio disattivato.",
    };
  let result: PartnerWorkResult;
  try {
    result = await executePartnerWork(await createSupabaseServerClient({ writable: true }), value);
  } catch {
    return {
      status: "uncertain",
      message: "Esito non confermato. Conserva e verifica lo stesso invio prima di continuare.",
    };
  }
  if (result.status === "success") {
    try {
      for (const path of ["/team/partner", "/team", "/development", "/"]) revalidatePath(path);
    } catch {
      /* A confirmed receipt survives a cache refresh failure. */
    }
  }
  return result;
}
