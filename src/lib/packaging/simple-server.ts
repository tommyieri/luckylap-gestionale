import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifiedMember } from "../auth/server";
import { stockRecord } from "../stock/model";
import { parseSimplePackagingCommand, simplePackagingSnapshot, type SimplePackagingResult } from "./simple";
export async function readSimplePackagingWorkspace(supabase: SupabaseClient) {
  const access = await verifiedMember(supabase); if (access.status !== "member") return access;
  const [settings, config, materials] = await Promise.all([
    supabase.from("app_settings").select("stock_adjustments_enabled").eq("id", true).single(),
    supabase.from("packaging_automation").select("started_at,location_id,box_item_id,sticker_item_id").eq("id", true).single(),
    supabase.from("packaging_material_status").select("stock_item_id,name,packaging_type,specifications,location_id,started_at,on_hand,reserved,unreserved,consumption_deficit,reconcilable_deficit,historical_review,automation_failures", { count: "exact" }).order("stock_item_id").limit(3),
  ]);
  if (settings.error || config.error || materials.error || !settings.data || !config.data || !Array.isArray(materials.data) || materials.count !== materials.data.length) throw new Error("Materiali non disponibili.");
  let locationName: string | null = null;
  if (config.data.started_at !== null) {
    const location = await supabase.from("stock_locations").select("name").eq("id", config.data.location_id).single();
    if (location.error || typeof location.data?.name !== "string") throw new Error("Magazzino non disponibile."); locationName = location.data.name;
  }
  return { status: "ready" as const, member: access.member, snapshot: simplePackagingSnapshot(settings.data, config.data, materials.data, locationName) };
}
const errors: Record<string, string> = {
  membership_required: "Accedi di nuovo prima di modificare le quantità.", invalid_payload: "Indica una quantità intera da 0 a 1.000.000.000 e una causale da 3 a 500 caratteri.",
  stock_mutations_disabled: "Le modifiche al magazzino sono sospese. Puoi consultare le quantità.", packaging_not_active: "I due materiali devono essere attivati prima di registrare variazioni.",
  unknown_packaging: "Il materiale non è più disponibile. Rileggi i materiali.", packaging_quantity_changed: "La quantità è cambiata nel frattempo. Rileggi i materiali e verifica la conta prima di confermare.",
  quantity_unchanged: "La quantità indicata è già registrata.", idempotency_conflict: "Il riferimento è associato a dati diversi. Conserva il tentativo e verifica il registro con Tommi.",
};
const uncertain = (): SimplePackagingResult => ({ status: "uncertain", message: "L’esito non è confermato. Verifica lo stesso invio prima di ripetere l’operazione." });
export async function executeSimplePackagingCommand(supabase: SupabaseClient, value: unknown): Promise<SimplePackagingResult> {
  const retry = stockRecord(value)?.retry === true; let submitted = false;
  try {
    const access = await verifiedMember(supabase);
    if (access.status !== "member") return retry ? uncertain() : { status: "rejected", code: "membership_required", message: errors.membership_required };
    const command = parseSimplePackagingCommand(value);
    if (!command) return retry ? uncertain() : { status: "rejected", code: "invalid_payload", message: errors.invalid_payload };
    submitted = true;
    const { data, error } = await supabase.rpc(command.kind === "adjust" ? "adjust_packaging_quantity" : "reconcile_packaging_consumption", { p_operation_id: command.operationId, p_payload: command.payload });
    if (error) {
      if (retry && ["membership_required", "invalid_payload", "stock_mutations_disabled"].includes(error.message)) return uncertain();
      return ["22023", "42501"].includes(error.code) && Object.hasOwn(errors, error.message) ? { status: "rejected", code: error.message, message: errors[error.message] } : uncertain();
    }
    const result = stockRecord(data);
    if (!result || result.operation_id !== command.operationId || typeof result.replayed !== "boolean" || typeof result.remaining_deficit !== "number" || !Number.isSafeInteger(result.remaining_deficit) || result.remaining_deficit < 0
      || (command.kind === "adjust" && result.stock_item_id !== command.payload.stock_item_id)) return uncertain();
    return { status: "success", replayed: result.replayed, remainingDeficit: result.remaining_deficit, message: result.replayed ? "Operazione già registrata: conferma recuperata." : command.kind === "adjust" ? "Quantità aggiornata. La rettifica è nel registro." : result.remaining_deficit === 0 ? "Consumi riconciliati." : "Consumi aggiornati. Le unità ancora da verificare restano segnalate." };
  } catch { return submitted || retry ? uncertain() : { status: "rejected", code: "unavailable", message: "Accesso non verificabile. Nessun nuovo invio eseguito." }; }
}
