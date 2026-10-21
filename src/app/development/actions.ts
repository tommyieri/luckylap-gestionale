"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { verifiedMember } from "../../lib/auth/server";
import { parseDevelopmentForm, type DevelopmentState } from "../../lib/development/model";

export async function saveDevelopment(_previous: DevelopmentState, form: FormData): Promise<DevelopmentState> {
  const revision = crypto.randomUUID();
  const values = Object.fromEntries(["id", "version", "name", "brief", "stage", "targetDate", "ownerId"].map(key => [key, typeof form.get(key) === "string" ? String(form.get(key)).slice(0, 8000) : ""]));
  try {
    const supabase = await createSupabaseServerClient({ writable: true });
    if ((await verifiedMember(supabase)).status !== "member") return { error: "Accedi di nuovo con un account abilitato al team.", revision, values };
    let input;
    try { input = parseDevelopmentForm(form); } catch (error) { return { error: error instanceof Error ? error.message : "Controlla i dati della scheda.", revision, values }; }
    const result = await supabase.rpc("save_development_project", { p_id: input.id, p_expected_version: input.expectedVersion, p_name: input.name, p_brief: input.brief, p_stage: input.stage, p_target_date: input.targetDate, p_owner_id: input.ownerId });
    if (result.error?.code === "40001") return { error: "Un altro membro ha modificato questa scheda. Aggiorna la pagina prima di salvare di nuovo; il tuo testo resta nel modulo.", revision, values };
    if (result.error?.code === "23505") return { error: "La scheda è già stata creata con dati diversi. Aggiorna la pagina prima di riprovare.", revision, values };
    if (result.error?.code === "22023") return { error: "Il referente selezionato non è più attivo o i dati non sono validi. Aggiorna la selezione.", revision, values };
    if (result.error || !result.data?.id) return { error: "Salvataggio non confermato. Aggiorna la pagina prima di riprovare; il testo resta nel modulo.", revision, values };
    revalidatePath("/development");
    return { success: input.expectedVersion === null ? "Scheda prodotto creata." : "Scheda prodotto aggiornata.", revision };
  } catch { return { error: "Workspace non disponibile. Aggiorna la pagina prima di riprovare; il testo resta nel modulo.", revision, values }; }
}
