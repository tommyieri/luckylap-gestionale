import "server-only";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { isLocalPreviewEnabled } from "../../../lib/runtime";
import {
  PARTNER_UNCERTAIN_MESSAGE,
  type PartnerCommandKind,
  type PartnerCommandResult,
} from "../../../lib/partner/commands";
import { executePartnerCommand } from "../../../lib/partner/server";
import { PARTNER_DATA_PATH, PARTNER_PATH } from "../../../lib/partner/links";

/** Nell'anteprima locale nessun comando arriva al database (00-sequenza §1.5). */
export const PARTNER_PREVIEW_REJECTION: PartnerCommandResult = {
  status: "rejected",
  code: "preview",
  message: "Anteprima locale: salvataggio disattivato.",
  refresh: false,
};

/**
 * Corpo comune delle Server Action di Partner: anteprima mai verso Supabase, client con i
 * cookie scrivibili, membro verificato prima di tutto (executePartnerCommand), solo il comando
 * della propria azione, poi la pagina riletta. Un'eccezione qui vuol dire esito da verificare.
 */
export async function runPartnerCommandAction(
  kind: PartnerCommandKind,
  value: unknown,
): Promise<PartnerCommandResult> {
  if (isLocalPreviewEnabled()) return PARTNER_PREVIEW_REJECTION;
  try {
    const supabase = await createSupabaseServerClient({ writable: true });
    const result = await executePartnerCommand(supabase, value, new Date(), { kind });
    // Dopo un salvataggio, o quando un collega ha cambiato il contatto, la pagina si rilegge.
    if (result.status === "success" || (result.status === "rejected" && result.refresh)) {
      revalidatePath(PARTNER_PATH);
      if (kind === "import_partner_device_file") revalidatePath(PARTNER_DATA_PATH);
    }
    return result;
  } catch {
    return { status: "uncertain", message: PARTNER_UNCERTAIN_MESSAGE };
  }
}
