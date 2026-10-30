import "server-only";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { isLocalPreviewEnabled } from "../../../lib/runtime";
import {
  PARTNER_ASSISTANT_ACTION_MESSAGES,
  PARTNER_UNCERTAIN_MESSAGE,
  type PartnerAssistantActionRejection,
  type PartnerCommand,
  type PartnerCommandKind,
  type PartnerCommandResult,
} from "../../../lib/partner/commands";
import { partnerAssistantMailConfig } from "../../../lib/partner-assistant/mail-config";
import { executePartnerCommand } from "../../../lib/partner/server";
import {
  PARTNER_ASSISTANT_PATH,
  PARTNER_DATA_PATH,
  PARTNER_PATH,
} from "../../../lib/partner/links";

/** Nell'anteprima locale nessun comando arriva al database (00-sequenza §1.5). */
export const PARTNER_PREVIEW_REJECTION: PartnerCommandResult = {
  status: "rejected",
  code: "preview",
  message: "Anteprima locale: salvataggio disattivato.",
  refresh: false,
};

/** Comandi che aprono o chiudono solleciti: si rileggono anche Oggi e il Team. */
const FOLLOW_UP_KINDS: readonly PartnerCommandKind[] = [
  "record_partner_activity",
  "set_partner_state",
  "set_partner_do_not_contact",
  "import_partner_device_file",
];

/** Comandi dell'assistente: si rilegge anche la sua pagina. */
const ASSISTANT_KINDS: readonly PartnerCommandKind[] = [
  "set_partner_assistant_mode",
  "set_partner_assistant_contact",
  "save_partner_assistant_rules",
  "start_partner_assistant_test",
  "confirm_partner_assistant_test",
  "set_partner_assistant_send_priority",
  "resume_partner_assistant_send",
  "set_partner_assistant_settings",
];

const assistantRejection = (code: PartnerAssistantActionRejection): PartnerCommandResult => ({
  status: "rejected",
  code,
  message: PARTNER_ASSISTANT_ACTION_MESSAGES[code],
  refresh: false,
});

/**
 * La posta dell'assistente, controllata sul server dopo la verifica del membro e prima della RPC
 * (`precheck` di executePartnerCommand, sul comando già letto): «Prova» e «Invio» solo con la
 * casella configurata; «Manda la prova» solo con gli indirizzi di prova, e con lo stesso numero
 * che la pagina ha mostrato a Tommi (`recipients`). Un comando di un altro tipo passa oltre. Una
 * ripetizione passa oltre: la ricevuta dà l'esito del primo invio. Chi non è membro riceve prima
 * l'errore di accesso e non sa niente della posta. Nessun valore della posta esce da qui.
 */
function assistantMailRejection(command: PartnerCommand): PartnerCommandResult | null {
  if (
    command.kind !== "set_partner_assistant_mode" &&
    command.kind !== "start_partner_assistant_test"
  )
    return null;
  // «Verifica lo stesso invio» ripete un invio forse già arrivato: decide la ricevuta del database,
  // non la posta di adesso. Senza posta il worker non manda comunque niente.
  if (command.retry) return null;
  if (
    command.kind === "set_partner_assistant_mode" &&
    !["prova", "invio"].includes(command.payload.mode as string)
  )
    return null;
  const mail = partnerAssistantMailConfig();
  if (mail === null) return assistantRejection("partner_assistant_mail_not_configured");
  if (command.kind === "start_partner_assistant_test") {
    if (mail.testTo.length === 0)
      return assistantRejection("partner_assistant_mail_not_configured");
    if (command.payload.recipients !== mail.testTo.length)
      return assistantRejection("partner_assistant_test_to_changed");
  }
  return null;
}

/**
 * Corpo comune delle Server Action di Partner: anteprima mai verso Supabase, client con i cookie
 * scrivibili, membro verificato prima di tutto (executePartnerCommand), solo il comando della
 * propria azione, poi la posta dell'assistente per «Prova», «Invio» e «Manda la prova» (senza RPC
 * se manca), poi la RPC e la pagina riletta. Un'eccezione qui vuol dire esito da verificare.
 */
export async function runPartnerCommandAction(
  kind: PartnerCommandKind,
  value: unknown,
): Promise<PartnerCommandResult> {
  if (isLocalPreviewEnabled()) return PARTNER_PREVIEW_REJECTION;
  try {
    const now = new Date();
    const supabase = await createSupabaseServerClient({ writable: true });
    const result = await executePartnerCommand(supabase, value, now, {
      kind,
      precheck: assistantMailRejection,
    });
    // Dopo un salvataggio, o quando un collega ha cambiato il contatto, la pagina si rilegge.
    if (result.status === "success" || (result.status === "rejected" && result.refresh)) {
      revalidatePath(PARTNER_PATH);
      if (kind === "import_partner_device_file") revalidatePath(PARTNER_DATA_PATH);
      if (ASSISTANT_KINDS.includes(kind)) revalidatePath(PARTNER_ASSISTANT_PATH);
      if (FOLLOW_UP_KINDS.includes(kind)) for (const path of ["/", "/team"]) revalidatePath(path);
    }
    return result;
  } catch {
    return { status: "uncertain", message: PARTNER_UNCERTAIN_MESSAGE };
  }
}
