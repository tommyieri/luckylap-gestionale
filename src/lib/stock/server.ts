import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifiedMember } from "../auth/server";
import { readTeamPages } from "../team/read";
import {
  ADJUSTABLE_LOCATION_TYPE,
  parseStockAdjustment,
  stockRecord,
  stockUuid,
  type StockAdjustmentResult,
} from "./model";
import { stockSnapshotFromRows } from "./read";

export async function readStockWorkspace(supabase: SupabaseClient) {
  const access = await verifiedMember(supabase);
  if (access.status !== "member") return access;
  const read = (table: string, columns: string) =>
    readTeamPages((after, limit) => {
      let query = supabase.from(table).select(columns, { count: "exact" }).order("id").limit(limit);
      if (table === "stock_locations") query = query.eq("active", true);
      if (after !== null) query = query.gt("id", after);
      return query;
    });
  const [settings, items, locations] = await Promise.all([
    supabase.from("app_settings").select("stock_adjustments_enabled").eq("id", true).single(),
    read("stock_items", "id,sku,name,kind,active"),
    read("stock_locations", "id,code,name,active,location_type"),
  ]);
  if (settings.error || !settings.data) throw new Error("Stato rettifiche non disponibile.");
  // Each location has a unique item key, so pagination never splits a composite
  // item/location cursor or silently stops at PostgREST's default row ceiling.
  // Disponibilità solo dei magazzini: le altre sedi non si rettificano da qui.
  const availability = (
    await Promise.all(
      locations
        .filter((raw) => stockRecord(raw)?.location_type === ADJUSTABLE_LOCATION_TYPE)
        .map((raw) => {
          const location = stockRecord(raw);
          if (!stockUuid(location?.id)) throw new Error("Magazzino non disponibile.");
          return readTeamPages((after, limit) => {
            let query = supabase
              .from("operational_stock_availability")
              .select("stock_item_id,location_id,on_hand,reserved,available", { count: "exact" })
              .eq("location_id", location.id)
              .order("stock_item_id")
              .limit(limit);
            if (after !== null) query = query.gt("stock_item_id", after);
            return query;
          }, "stock_item_id");
        }),
    )
  ).flat();
  return {
    status: "ready" as const,
    member: access.member,
    snapshot: stockSnapshotFromRows({ settings: settings.data, items, locations, availability }),
  };
}

const messages: Record<string, string> = {
  membership_required: "Accesso al team richiesto. Accedi di nuovo prima di rettificare le scorte.",
  invalid_payload:
    "Scegli SKU e magazzino, una quantità intera diversa da zero e una causale da 3 a 500 caratteri.",
  disabled:
    "Le rettifiche sono ancora disattivate. Puoi consultare le quantità e rileggere i dati.",
  inactive_item: "Articolo o magazzino non più attivo. Rileggi i dati prima di continuare.",
  unknown_stock:
    "La quantità fisica è da verificare. Serve una conta iniziale autorizzata prima di applicare un delta.",
  insufficient_stock:
    "La sottrazione porterebbe la giacenza sotto zero. Rileggi le quantità e correggi il delta.",
  reserved_stock_conflict:
    "Questi capi sono già riservati. La rettifica non può ridurre il fisico sotto le riserve: rileggi i dati.",
  idempotency_conflict:
    "Il riferimento del tentativo è associato a dati diversi. Conserva il riferimento e verifica i movimenti con Tommi.",
  shop_location: "Le quantità del negozio si cambiano da Conto vendita.",
};
const rejected = (code: string): StockAdjustmentResult => ({
  status: "rejected",
  code,
  message: messages[code],
});
const uncertain = (
  message = "L’esito non è confermato. I dati restano congelati: verifica lo stesso invio senza creare una seconda rettifica.",
): StockAdjustmentResult => ({ status: "uncertain", message });

/** Validate identity and current membership for every action, not only page load. */
export async function executeStockAdjustment(
  supabase: SupabaseClient,
  value: unknown,
): Promise<StockAdjustmentResult> {
  let submitted = false;
  const retryRequested = stockRecord(value)?.retry === true;
  try {
    const access = await verifiedMember(supabase);
    if (access.status !== "member")
      return retryRequested
        ? uncertain(
            "L’accesso al team non è verificabile ora. Accedi di nuovo e conserva questo tentativo fino alla conferma del movimento.",
          )
        : rejected("membership_required");
    const command = parseStockAdjustment(value);
    if (!command) return rejected("invalid_payload");
    const existing = await supabase
      .from("stock_movements")
      .select("id,operation_id,stock_item_id,location_id,kind,quantity_delta,reason,actor_id")
      .eq("operation_id", command.operationId)
      .maybeSingle();
    if (existing.error)
      return command.retry
        ? uncertain()
        : {
            status: "rejected",
            code: "unavailable",
            message: "Verifica dei movimenti non disponibile. Nessun nuovo invio eseguito.",
          };
    if (existing.data) {
      const row = stockRecord(existing.data);
      if (
        !row ||
        !stockUuid(row.id) ||
        row.operation_id !== command.operationId ||
        row.actor_id !== access.member.userId ||
        row.kind !== "adjustment" ||
        row.stock_item_id !== command.itemId ||
        row.location_id !== command.locationId ||
        row.quantity_delta !== command.delta ||
        row.reason !== command.reason
      )
        return rejected("idempotency_conflict");
      // The immutable ledger proves the exact command already committed. This
      // also recovers a lost response if the flag was disabled in the meantime.
      return {
        status: "success",
        movementId: row.id,
        operationId: command.operationId,
        replayed: true,
        message: "Rettifica già registrata: esito recuperato, senza ripetere il movimento.",
      };
    }
    const settings = await supabase
      .from("app_settings")
      .select("stock_adjustments_enabled")
      .eq("id", true)
      .single();
    if (settings.error || typeof settings.data?.stock_adjustments_enabled !== "boolean")
      return command.retry
        ? uncertain()
        : {
            status: "rejected",
            code: "unavailable",
            message: "Verifica delle rettifiche non disponibile. Nessun nuovo invio eseguito.",
          };
    if (!settings.data.stock_adjustments_enabled)
      return command.retry
        ? uncertain(
            "Le rettifiche sono ora disattivate e questo movimento non è leggibile. Conserva lo stesso tentativo e verifica con Tommi; non creare un nuovo riferimento.",
          )
        : rejected("disabled");
    // Solo i magazzini (06 R7). Nessun movimento con questo riferimento esiste:
    // un rifiuto qui è definitivo anche per un tentativo da verificare.
    const location = await supabase
      .from("stock_locations")
      .select("location_type")
      .eq("id", command.locationId)
      .maybeSingle();
    if (location.error)
      return command.retry
        ? uncertain()
        : {
            status: "rejected",
            code: "unavailable",
            message: "Verifica del magazzino non disponibile. Nessun nuovo invio eseguito.",
          };
    if (location.data && location.data.location_type !== ADJUSTABLE_LOCATION_TYPE)
      return rejected("shop_location");
    submitted = true;
    const { data, error } = await supabase.rpc("adjust_stock", {
      p_operation_id: command.operationId,
      p_stock_item_id: command.itemId,
      p_location_id: command.locationId,
      p_quantity_delta: command.delta,
      p_reason: command.reason,
    });
    if (error) {
      const code =
        error.code === "22023" && error.message === "reserved_stock_conflict"
          ? "reserved_stock_conflict"
          : error.code === "22023" && error.message === "shop_location"
            ? "shop_location"
            : error.code === "22023" &&
                error.message === "operation_id già utilizzato per una richiesta diversa."
              ? "idempotency_conflict"
              : error.code === "22023" && error.message === "Articolo o location non disponibile."
                ? "inactive_item"
                : error.code === "22023" &&
                    [
                      "Stock non inizializzato: serve una conta iniziale autorizzata.",
                      "Quantità sconosciuta: registrare prima una conta iniziale.",
                    ].includes(error.message)
                  ? "unknown_stock"
                  : error.code === "22023" &&
                      error.message === "La rettifica produrrebbe una giacenza negativa."
                    ? "insufficient_stock"
                    : error.code === "42501" &&
                        error.message === "Rettifiche di magazzino non abilitate."
                      ? "disabled"
                      : error.code === "42501" &&
                          error.message === "Appartenenza LuckyLap richiesta."
                        ? "membership_required"
                        : null;
      // A retry disabled by the core RPC cannot prove the original outcome.
      if (code === "disabled" && command.retry)
        return uncertain(
          "Le rettifiche sono disattivate: l’esito precedente non è verificabile ora. Conserva questo tentativo e rileggi i movimenti con Tommi.",
        );
      if (code === "membership_required" && command.retry)
        return uncertain(
          "I permessi sono cambiati durante la verifica. Conserva questo tentativo fino alla conferma del movimento.",
        );
      return code ? rejected(code) : uncertain();
    }
    if (!stockUuid(data)) return uncertain();
    return {
      status: "success",
      movementId: data,
      operationId: command.operationId,
      replayed: false,
      message: "Rettifica confermata nel registro del magazzino.",
    };
  } catch {
    return submitted || retryRequested
      ? uncertain(
          "Connessione interrotta. La rettifica potrebbe essere già registrata: conserva e verifica lo stesso tentativo.",
        )
      : {
          status: "rejected",
          code: "unavailable",
          message: "Verifica dell’accesso non disponibile. Nessun nuovo invio eseguito.",
        };
  }
}
