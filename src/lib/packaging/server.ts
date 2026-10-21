import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifiedMember } from "../auth/server";
import { readTeamPages } from "../team/read";
import { stockRecord, stockUuid } from "../stock/model";
import { packagingSnapshotFromRows, parsePackagingCount, parsePackagingCreate, type PackagingResult } from "./model";

export async function readPackagingWorkspace(supabase: SupabaseClient) {
  const access = await verifiedMember(supabase);
  if (access.status !== "member") return access;
  const read = (table: string, columns: string, idColumn = "id", packagingOnly = false) => readTeamPages((after, limit) => {
    let query = supabase.from(table).select(columns, { count: "exact" }).order(idColumn).limit(limit);
    if (packagingOnly) query = query.eq("kind", "packaging");
    if (after !== null) query = query.gt(idColumn, after);
    return query;
  }, idColumn);
  const [settings, items, packaging, locations] = await Promise.all([
    supabase.from("app_settings").select("stock_adjustments_enabled").eq("id", true).single(),
    read("stock_items", "id,sku,name,kind,active,unit_cost_eur", "id", true),
    read("packaging_items", "stock_item_id,packaging_type,specifications", "stock_item_id"),
    read("stock_locations", "id,code,name,active"),
  ]);
  if (settings.error || !settings.data) throw new Error("Stato materiali non disponibile.");
  const itemIds = items.map(raw => { const row = stockRecord(raw); if (!stockUuid(row?.id)) throw new Error("Materiale non disponibile."); return row.id; });
  // Bound IN filters and paginate each location/item batch by a unique key.
  // The exact counts fail closed on partial reads instead of inventing stock.
  const batches = Array.from({ length: Math.ceil(itemIds.length / 100) }, (_, index) => itemIds.slice(index * 100, index * 100 + 100));
  const availability = (await Promise.all(locations.flatMap(raw => {
    const location = stockRecord(raw); if (!stockUuid(location?.id)) throw new Error("Magazzino non disponibile.");
    return batches.map(batch => readTeamPages((after, limit) => {
      let query = supabase.from("operational_stock_availability").select("stock_item_id,location_id,on_hand,reserved,available", { count: "exact" }).eq("location_id", location.id).in("stock_item_id", batch).order("stock_item_id").limit(limit);
      if (after !== null) query = query.gt("stock_item_id", after);
      return query;
    }, "stock_item_id"));
  }))).flat();
  return { status: "ready" as const, member: access.member, snapshot: packagingSnapshotFromRows({ settings: settings.data, items, packaging, locations, availability }) };
}

const messages: Record<string, string> = {
  membership_required: "Accesso al team richiesto. Accedi di nuovo prima di registrare materiali.",
  stock_mutations_disabled: "Le modifiche al magazzino sono disattivate. Puoi consultare i materiali e rileggere i dati.",
  invalid_payload: "Controlla SKU, nome, tipo, magazzino e quantità. Usa importi con al massimo due decimali.",
  idempotency_conflict: "Il riferimento è già associato a dati diversi. Conserva il tentativo e verifica il registro con Tommi.",
  sku_already_exists: "Questo SKU è già utilizzato. Cerca il materiale esistente o scegli uno SKU interno diverso.",
  known_stock: "Questo materiale è già stato contato nel magazzino scelto. Rileggi i dati; le variazioni successive si registrano dalle rettifiche.",
  unknown_packaging: "Il materiale non è disponibile per questa operazione. Rileggi l’elenco prima di continuare.",
  invalid_location: "Il magazzino non è disponibile. Rileggi i dati e scegli un magazzino attivo.",
};
const uncertain = (): PackagingResult => ({ status: "uncertain", message: "L’esito non è confermato. Conserva e verifica lo stesso invio, senza modificare i dati né creare un secondo riferimento." });
const rejected = (code: string): PackagingResult => ({ status: "rejected", code, message: messages[code] });

/** Every mutation verifies Auth and current DB membership; the RPC owns the flag and atomic receipt. */
export async function executePackagingCommand(supabase: SupabaseClient, kind: "create" | "count", value: unknown): Promise<PackagingResult> {
  const retry = stockRecord(value)?.retry === true;
  let submitted = false;
  try {
    const access = await verifiedMember(supabase);
    if (access.status !== "member") return retry ? uncertain() : rejected("membership_required");
    const command = kind === "create" ? parsePackagingCreate(value) : parsePackagingCount(value);
    if (!command) return retry ? uncertain() : rejected("invalid_payload");
    // No client-side flag gate: the database can return an exact committed
    // receipt even if stock mutations were disabled after a lost response.
    submitted = true;
    const { data, error } = await supabase.rpc(kind === "create" ? "create_packaging_material" : "initialize_packaging_count", { p_operation_id: command.operationId, p_payload: command.payload });
    if (error) {
      // Auth, validation and flag guards may precede receipt verification. A
      // failed retry cannot prove the first request never committed.
      if (retry && ["membership_required", "stock_mutations_disabled", "invalid_payload"].includes(error.message)) return uncertain();
      return ["22023", "42501", "23505"].includes(error.code) && Object.hasOwn(messages, error.message) ? rejected(error.message) : uncertain();
    }
    const result = stockRecord(data);
    if (!result || result.operation_id !== command.operationId || !stockUuid(result.stock_item_id) || !(result.movement_id === null || stockUuid(result.movement_id)) || typeof result.replayed !== "boolean"
      || (kind === "create" && (((command.payload as { initial_quantity: number | null }).initial_quantity === null) !== (result.movement_id === null)))
      || (kind === "count" && (!stockUuid(result.movement_id) || result.stock_item_id !== (command.payload as { stock_item_id: string }).stock_item_id))) return uncertain();
    return { status: "success", operationId: command.operationId, stockItemId: result.stock_item_id, movementId: result.movement_id, replayed: result.replayed, message: result.replayed ? "Operazione già registrata: conferma recuperata, nessun movimento duplicato." : kind === "create" ? "Materiale registrato nel magazzino condiviso." : "Conta iniziale confermata nel registro del magazzino." };
  } catch {
    return submitted || retry ? uncertain() : { status: "rejected", code: "unavailable", message: "Verifica dell’accesso non disponibile. Nessun nuovo invio eseguito." };
  }
}
