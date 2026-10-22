"use server";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { isLocalPreviewEnabled } from "../../../../lib/runtime";
import type { PartnerCommandResult } from "../../../../lib/partner/commands";
import {
  previewPartnerDeviceFile as previewDeviceFile,
  type PartnerPreviewResult,
} from "../../../../lib/partner/server";
import { runPartnerCommandAction } from "../command-runner";

/*
 * /partner/dati (spec 02 §5.8): «Controlla il file» calcola il piano senza scrivere; «Importa»
 * applica lo stesso piano con il suo operation_id. Il file arriva già controllato dal browser
 * (src/lib/partner/device-file.ts) e il server lo ricontrolla con le stesse regole.
 */

export async function previewPartnerDeviceFile(payload: unknown): Promise<PartnerPreviewResult> {
  if (isLocalPreviewEnabled())
    return {
      status: "rejected",
      code: "preview",
      message: "Anteprima locale: il controllo del file usa il database, qui è disattivato.",
    };
  try {
    const supabase = await createSupabaseServerClient({ writable: true });
    return await previewDeviceFile(supabase, payload);
  } catch {
    return {
      status: "rejected",
      code: "unavailable",
      message: "Controllo del file non disponibile. Riprova tra poco: niente è stato importato.",
    };
  }
}

export async function importPartnerDeviceFile(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("import_partner_device_file", command);
}
