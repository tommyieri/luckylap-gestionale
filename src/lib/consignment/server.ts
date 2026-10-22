import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifiedMember } from "../auth/server";
import { verifiedSensitiveAccess } from "../auth/sensitive-access";
import { stockRecord as record, stockUuid as uuid } from "../stock/model";
import { parseConsignmentCommand, type ConsignmentResult } from "./model";
import { consignmentFromRows, consignmentPages } from "./read";
const salesColumns =
  "id,stock_item_id,location_id,sku_snapshot,quantity,web_price_cents,unit_shop_price_cents,gross_cents,brand_claim_cents,shop_share_cents,unit_cost_cents,external_reference,reason,occurred_at";
export async function readConsignmentWorkspace(supabase: SupabaseClient) {
  const access = await verifiedMember(supabase);
  if (access.status !== "member") return access;
  const canSettle = await verifiedSensitiveAccess(supabase, access.member, "finance");
  const read = (table: string, cols: string, key = "id", productOnly = false) =>
    consignmentPages((after, limit) => {
      let q = supabase.from(table).select(cols, { count: "exact" }).order(key).limit(limit);
      if (productOnly) q = q.eq("kind", "product");
      if (after !== null) q = q.gt(key, after);
      return q;
    }, key);
  const [settings, items, variants, products, locations, transfers, sales, settlements] =
    await Promise.all([
      supabase
        .from("app_settings")
        .select("stock_adjustments_enabled,manual_sales_enabled,sales_started_at")
        .eq("id", true)
        .single(),
      read("stock_items", "id,sku,name,kind,active,unit_cost_eur", "id", true),
      read("product_variants", "stock_item_id,product_id,color,size", "stock_item_id"),
      read("products", "id,category"),
      read("stock_locations", "id,code,name,active,location_type"),
      read(
        "consignment_transfers",
        "id,stock_item_id,from_location_id,to_location_id,quantity,reason,occurred_at",
      ),
      read("consignment_sales", salesColumns),
      canSettle
        ? read("consignment_settlements", "id,sale_id,amount_cents,occurred_at,method,reference")
        : null,
    ]);
  if (settings.error || !settings.data) throw Error("Stato conto vendita non disponibile.");
  const catalog = (
    await Promise.all(
      items.map((raw) => {
        const r = record(raw);
        if (typeof r?.sku !== "string") throw Error("SKU non disponibile.");
        return consignmentPages((after, limit) => {
          let q = supabase
            .from("shopify_catalog_variants")
            .select(
              "shop_domain,variant_gid,stock_item_id,sku,status,currency_code,price_cents,observed_at,product_type",
              { count: "exact" },
            )
            .eq("sku", r.sku)
            .eq("status", "ACTIVE")
            .order("shop_domain")
            .limit(limit);
          if (after !== null) q = q.gt("shop_domain", after);
          return q;
        }, "shop_domain");
      }),
    )
  ).flat();
  const availability = (
    await Promise.all(
      locations.map((raw) => {
        const r = record(raw);
        if (!uuid(r?.id)) throw Error("Magazzino non disponibile.");
        return consignmentPages((after, limit) => {
          let q = supabase
            .from("operational_stock_availability")
            .select("stock_item_id,location_id,on_hand,reserved,available", { count: "exact" })
            .eq("location_id", r.id)
            .order("stock_item_id")
            .limit(limit);
          if (after !== null) q = q.gt("stock_item_id", after);
          return q;
        }, "stock_item_id");
      }),
    )
  ).flat();
  return {
    status: "ready" as const,
    member: access.member,
    snapshot: consignmentFromRows({
      settings: settings.data,
      items,
      variants,
      products,
      locations,
      availability,
      catalog,
      transfers,
      sales,
      settlements,
    }),
  };
}
const messages: Record<string, string> = {
  membership_required: "Accedi di nuovo con un account abilitato al team.",
  finance_access_required:
    "Sblocca Finance con la password dell’area per registrare i regolamenti.",
  invalid_payload:
    "Controlla SKU, magazzini, quantità, data e riferimenti. Il negozio non può applicare sconti.",
  invalid_date: "La data non è valida, è futura o precede la vendita da regolare.",
  stock_mutations_disabled: "Le modifiche al magazzino sono disattivate.",
  sales_disabled: "Le nuove vendite sono disattivate finché non viene confermato l’avvio.",
  before_cutover: "La vendita precede la data di avvio del gestionale.",
  idempotency_conflict:
    "Questo riferimento è associato a dati diversi. Conserva il tentativo e verifica il registro.",
  invalid_tshirt: "Il conto vendita è disponibile solo per T-shirt attive.",
  invalid_location:
    "Scegli un magazzino centrale e un negozio conto vendita attivi. I magazzini esterni sono esclusi.",
  unknown_stock:
    "La quantità fisica non è verificata nel magazzino scelto. Non viene considerata pari a zero.",
  insufficient_stock:
    "Le unità libere non bastano: alcune potrebbero essere già riservate. Rileggi le quantità.",
  unmatched_catalog:
    "Manca un collegamento esatto a una variante Shopify attiva in euro. Rileggi il catalogo.",
  catalog_changed:
    "Il prezzo o la versione del catalogo sono cambiati. Rileggi i dati e verifica il nuovo prezzo prima di un altro invio.",
  duplicate_reference:
    "Questo riferimento risulta già registrato. Cerca la dichiarazione esistente.",
  unknown_sale: "La vendita da regolare non è disponibile.",
  settlement_exceeds_claim: "L’importo supera il credito LuckyLap ancora da ricevere.",
  reserved_stock_conflict: "La quantità è riservata a ordini: rileggi i dati prima di continuare.",
};
export async function executeConsignmentCommand(
  supabase: SupabaseClient,
  value: unknown,
): Promise<ConsignmentResult> {
  const retry = record(value)?.retry === true;
  let submitted = false;
  const uncertain = (): ConsignmentResult => ({
    status: "uncertain",
    message:
      "Esito non confermato. Conserva e verifica lo stesso invio senza cambiare dati o riferimento.",
  });
  try {
    const access = await verifiedMember(supabase);
    if (access.status !== "member")
      return retry
        ? uncertain()
        : {
            status: "rejected",
            code: "membership_required",
            message: messages.membership_required,
          };
    const command = parseConsignmentCommand(value);
    if (!command)
      return retry
        ? uncertain()
        : { status: "rejected", code: "invalid_payload", message: messages.invalid_payload };
    if (command.kind === "record_consignment_settlement") {
      if (!(await verifiedSensitiveAccess(supabase, access.member, "finance")))
        return retry
          ? uncertain()
          : {
              status: "rejected",
              code: "finance_access_required",
              message: messages.finance_access_required,
            };
    }
    submitted = true;
    const { data, error } = await supabase.rpc(command.kind, {
      p_operation_id: command.operationId,
      p_payload: command.payload,
    });
    if (error) {
      if (
        retry &&
        [
          "membership_required",
          "finance_access_required",
          "invalid_payload",
          "invalid_date",
          "stock_mutations_disabled",
          "sales_disabled",
        ].includes(error.message)
      )
        return uncertain();
      return ["22023", "42501", "23505"].includes(error.code) &&
        Object.hasOwn(messages, error.message)
        ? { status: "rejected", code: error.message, message: messages[error.message] }
        : uncertain();
    }
    const r = record(data);
    if (
      !r ||
      r.operation_id !== command.operationId ||
      typeof r.replayed !== "boolean" ||
      (command.kind === "transfer_consignment_stock"
        ? r.transfer_id !== command.operationId
        : !uuid(r.sale_id)) ||
      (command.kind === "register_consignment_sale" && r.sale_id !== command.operationId) ||
      (command.kind === "record_consignment_settlement" &&
        (r.settlement_id !== command.operationId || r.sale_id !== command.payload.sale_id))
    )
      return uncertain();
    return {
      status: "success",
      operationId: command.operationId,
      replayed: r.replayed,
      message: r.replayed
        ? "Operazione già registrata: conferma recuperata senza duplicare gli effetti."
        : command.kind === "transfer_consignment_stock"
          ? "Movimento confermato nei due magazzini."
          : command.kind === "register_consignment_sale"
            ? "Vendita negozio registrata. Scorte e credito LuckyLap aggiornati; nessun incasso dichiarato."
            : "Regolamento ricevuto registrato, distinto dalla vendita.",
    };
  } catch {
    return submitted || retry
      ? uncertain()
      : {
          status: "rejected",
          code: "unavailable",
          message: "Verifica dell’accesso non disponibile. Nessun invio eseguito.",
        };
  }
}
