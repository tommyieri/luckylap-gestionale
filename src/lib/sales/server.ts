import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readEffectiveSalesPayments,
  applyEffectiveSalesPayments,
} from "../finance-revisions/sales-projection";
import { verifiedMember } from "../auth/server";
import { parseSalesCommand, record, isUuid, type CommandResult } from "./model";
import { readSalesPages, salesSnapshotFromRows, type SalesRows } from "./read";

const selections = {
  settings: ["app_settings", "manual_sales_enabled,sales_started_at"],
  items: ["stock_items", "id,sku,name,active,unit_cost_eur,list_price_eur"],
  variants: ["product_variants", "stock_item_id,color,size"],
  locations: ["stock_locations", "id,code,name,active,location_type"],
  availability: [
    "operational_stock_availability",
    "stock_item_id,location_id,on_hand,reserved,available",
  ],
  orders: [
    "sales_orders",
    "id,operation_id,source_kind,channel,external_reference,occurred_at,total_cents,cancelled_cents,refund_due_cents,payment_state,fulfillment_state,order_state",
  ],
  lines: [
    "sales_order_lines",
    "id,order_id,source_kind,stock_item_id,location_id,sku_snapshot,quantity,fulfilled_quantity,cancelled_quantity,unit_price_cents,discount_cents,line_total_cents,cancelled_amount_cents,unit_cost_cents",
  ],
  reservations: ["stock_reservations", "order_line_id,stock_item_id,location_id,reserved_quantity"],
  requirements: [
    "production_requirements",
    "id,order_line_id,required_quantity,completed_quantity,cancelled_quantity,status",
  ],
} as const;

export async function readSalesWorkspace(supabase: SupabaseClient) {
  const access = await verifiedMember(supabase);
  if (access.status !== "member") return access;
  const entries = await Promise.all(
    Object.entries(selections).map(async ([key, [table, columns]]) => {
      const rows = await readSalesPages((from, to) => {
        let query = supabase.from(table).select(columns, { count: "exact" });
        if (key === "settings") query = query.eq("id", true);
        if (key === "items") query = query.eq("kind", "product");
        const ordering =
          key === "settings"
            ? "id"
            : key === "variants" || key === "availability"
              ? "stock_item_id"
              : key === "reservations"
                ? "order_line_id"
                : "id";
        query = query.order(ordering);
        if (key === "availability") query = query.order("location_id");
        return query.range(from, to);
      });
      return [key, rows];
    }),
  );
  const snapshot = salesSnapshotFromRows(Object.fromEntries(entries) as SalesRows);
  if (snapshot.orders.length) {
    const summaries = await readEffectiveSalesPayments(
      supabase,
      snapshot.orders.map((order) => order.id),
    );
    snapshot.orders = applyEffectiveSalesPayments(snapshot.orders, summaries);
  }
  return {
    status: "ready" as const,
    member: access.member,
    snapshot,
  };
}

const knownErrors: Record<string, string> = {
  membership_required: "Il tuo account non è più abilitato al team.",
  sales_disabled: "Le nuove operazioni sono disattivate finché non viene confermato l’avvio.",
  idempotency_conflict:
    "Questo tentativo è già associato a dati diversi. Verifica gli ordini prima di registrare altre operazioni.",
  duplicate_external_reference:
    "Questo riferimento esterno risulta già registrato. Cerca l’ordine esistente.",
  invalid_payload: "Controlla i dati, la data di avvio e gli importi dell’operazione.",
  unknown_stock: "La quantità fisica non è verificata per uno degli SKU nel magazzino scelto.",
  insufficient_ready_stock:
    "La disponibilità pronta non basta. Per un nuovo ordine scegli Da preparare; per consegnare completa prima la produzione.",
  reserved_stock_conflict: "La disponibilità è cambiata o è già riservata. Ricarica i dati.",
  inactive_item: "Uno degli articoli non è disponibile per nuove vendite.",
  price_change_reason_required:
    "Indica una motivazione per sconti, prezzi modificati o listini da verificare.",
  production_permission_required: "Il ricevimento produzione è riservato a Tommi e Gabriele.",
  production_quantity_exceeded: "La quantità supera il fabbisogno ancora da produrre.",
  unfulfilled_quantity_exceeded: "La quantità supera il residuo non consegnato e non annullato.",
  order_cancelled: "L’ordine è già annullato.",
  payment_already_recorded: "Per questo ordine è già dichiarato un incasso. Verifica l’ordine.",
  payment_amount_mismatch: "L’incasso deve coincidere con l’intero importo ancora dovuto.",
  external_order_managed_by_shopify:
    "Questo ordine è gestito da Shopify: consegne, annulli e pagamenti si aggiornano dalla fonte. Puoi registrare la produzione consentita dal tuo ruolo.",
};

/** Fresh Auth + membership before each RPC; never accept a client-supplied role. */
export async function executeSalesCommand(
  supabase: SupabaseClient,
  value: unknown,
): Promise<CommandResult> {
  const isRetry = record(value)?.retry === true;
  const cannotVerify = (): CommandResult => ({
    status: "uncertain",
    message:
      "Il tentativo precedente non è ancora verificabile. Conserva lo stesso invio e riprova quando accesso e collegamento saranno disponibili.",
  });
  const command = parseSalesCommand(value);
  if (!command)
    return isRetry
      ? cannotVerify()
      : { status: "rejected", code: "invalid_payload", message: knownErrors.invalid_payload };
  let submitted = false;
  try {
    const access = await verifiedMember(supabase);
    if (access.status !== "member")
      return isRetry
        ? cannotVerify()
        : {
            status: "rejected",
            code: "membership_required",
            message: knownErrors.membership_required,
          };
    if (
      command.kind === "complete_production" &&
      !["founder", "production"].includes(access.member.role)
    )
      return isRetry
        ? cannotVerify()
        : {
            status: "rejected",
            code: "production_permission_required",
            message: knownErrors.production_permission_required,
          };
    const settings = await supabase
      .from("app_settings")
      .select("manual_sales_enabled,sales_started_at")
      .eq("id", true)
      .single();
    if (settings.error || !settings.data)
      return isRetry
        ? cannotVerify()
        : {
            status: "rejected",
            code: "unavailable",
            message: "Verifica dell’avvio non disponibile. Nessun invio eseguito.",
          };
    if (
      (!settings.data.manual_sales_enabled || !settings.data.sales_started_at) &&
      !command.retry &&
      command.kind !== "complete_production"
    )
      return { status: "rejected", code: "sales_disabled", message: knownErrors.sales_disabled };
    // When disabled, a frozen retry may still recover its original receipt.
    // The database rejects new manual writes while the flag is off, but permits
    // real production for externally managed orders independently of that flag.
    submitted = true;
    const { data, error } = await supabase.rpc(command.kind, {
      p_operation_id: command.operationId,
      p_payload: command.payload,
    });
    if (error) {
      const message = knownErrors[error.message];
      // These guards can run before the receipt lookup. On a retry they do not
      // prove that the original operation failed or rolled back.
      if (
        isRetry &&
        ["membership_required", "production_permission_required", "invalid_payload"].includes(
          error.message,
        )
      )
        return cannotVerify();
      if (message && ["22023", "42501", "23505"].includes(error.code))
        return { status: "rejected", code: error.message, message };
      return {
        status: "uncertain",
        message: "L’esito non è confermato. Riprova lo stesso invio senza modificare i dati.",
      };
    }
    const result = record(data);
    if (
      !result ||
      !isUuid(result.order_id) ||
      typeof result.replayed !== "boolean" ||
      result.operation_id !== command.operationId
    )
      return {
        status: "uncertain",
        message: "La risposta non è completa. Verifica lo stesso tentativo prima di continuare.",
      };
    return {
      status: "success",
      orderId: result.order_id,
      replayed: result.replayed,
      message: result.replayed
        ? "Operazione già registrata: esito recuperato, nessun effetto duplicato."
        : "Operazione registrata nel workspace condiviso.",
    };
  } catch {
    return submitted || isRetry
      ? {
          status: "uncertain",
          message:
            "Connessione interrotta durante la verifica. Conserva e riprova lo stesso tentativo per verificarne l’esito.",
        }
      : {
          status: "rejected",
          code: "unavailable",
          message: "Verifica dell’accesso non disponibile. Nessun invio eseguito.",
        };
  }
}
