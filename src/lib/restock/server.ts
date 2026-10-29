import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifiedMember } from "../auth/server";
import { consignmentPages } from "../consignment/read";
import { stockRecord as record, stockUuid as uuid } from "../stock/model";
import {
  parseRestockCommand,
  piecesLabel,
  STATE_LABEL,
  isRestockState,
  type RestockCommand,
  type RestockResult,
  type RestockTarget,
} from "./model";
import {
  incomingByItem,
  restockCatalogFromRows,
  restockDataFromRows,
  type RestockData,
  type RestockOrder,
  type RestockPage,
} from "./read";

/*
 * Letture e comandi del riassortimento con il client della persona collegata: nessun client
 * amministrativo, la RLS resta l'autorità. Le pagine verificano il membro con
 * `requireMember()` subito prima di leggere.
 */

type Filter = { column: string; value: string | boolean };
function pages(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  key = "id",
  filters: Filter[] = [],
  notNull?: string,
) {
  return consignmentPages((after, limit) => {
    let q = supabase.from(table).select(columns, { count: "exact" });
    for (const f of filters) q = q.eq(f.column, f.value);
    if (notNull) q = q.not(notNull, "is", null);
    q = q.order(key).limit(limit);
    if (after !== null) q = q.gt(key, after);
    return q;
  }, key);
}

const ORDER_COLUMNS =
  "id,title,notes,state,state_changed_at,state_changed_by,warehouse_location_id,shop_location_id,shop_done_at,shop_done_by,version,created_by,created_at,updated_at,deleted_at,deleted_by,deletion_note";

/** Riordini, righe, storico, arrivi, ordini del negozio legati, sedi e negozi. */
async function readCore(supabase: SupabaseClient): Promise<RestockData> {
  const settings = await supabase
    .from("app_settings")
    .select("stock_adjustments_enabled")
    .eq("id", true)
    .single();
  if (settings.error || !settings.data) throw Error("Stato del magazzino non disponibile.");
  const [orders, lines, events, arrivals, shopOrders, locations, shops, profiles, deletionEvents] =
    await Promise.all([
      pages(supabase, "restock_orders", ORDER_COLUMNS),
      pages(
        supabase,
        "restock_lines",
        "id,order_id,destination,product_id,color,size,stock_item_id,quantity",
      ),
      pages(
        supabase,
        "restock_state_events",
        "id,order_id,from_state,to_state,note,created_by,created_at",
      ),
      pages(
        supabase,
        "restock_arrivals",
        "id,order_id,location_id,previous_state,pieces,warehouse_pieces,shop_pieces,customer_pieces,created_by,created_at,undone_at,undone_by",
      ),
      pages(
        supabase,
        "consignment_orders",
        "id,location_id,order_number,status,restock_order_id",
        "id",
        [],
        "restock_order_id",
      ),
      pages(supabase, "stock_locations", "id,code,name,active,location_type"),
      pages(supabase, "consignment_shops", "location_id,sizes", "location_id"),
      pages(supabase, "profiles", "user_id,display_name", "user_id"),
      pages(supabase, "restock_deletion_events", "id,order_id,deleted,note,created_by,created_at"),
    ]);
  const linkedIds = shopOrders.map((raw) => record(raw)?.id).filter((v): v is string => uuid(v));
  const shopOrderLines = linkedIds.length
    ? await consignmentPages((after, limit) => {
        let q = supabase
          .from("consignment_order_lines")
          .select("id,order_id,stock_item_id,quantity,delivered_quantity,cancelled_quantity", {
            count: "exact",
          })
          .in("order_id", linkedIds)
          .order("id")
          .limit(limit);
        if (after !== null) q = q.gt("id", after);
        return q;
      })
    : [];
  return restockDataFromRows({
    settings: settings.data,
    orders,
    lines,
    events,
    arrivals,
    shopOrders,
    shopOrderLines,
    locations,
    shops,
    profiles,
    deletionEvents,
  });
}

/** Un solo riordine, per il nuovo ordine del negozio già compilato. `null` se non esiste. */
export async function readRestockOrder(
  supabase: SupabaseClient,
  orderId: unknown,
): Promise<RestockOrder | null> {
  if (!uuid(orderId)) return null;
  const data = await readCore(supabase);
  return data.orders.find((o) => o.id === orderId.toLowerCase() && !o.deleted) ?? null;
}

export type RestockListRead = { status: "ready"; data: RestockData };
/** Elenco dei riordini. */
export async function readRestockList(supabase: SupabaseClient): Promise<RestockListRead> {
  return { status: "ready", data: await readCore(supabase) };
}

export type { RestockPage };
export type RestockPageRead = { status: "not_found" } | { status: "ready"; page: RestockPage };
/** Un riordine con il catalogo, le giacenze del suo magazzino e i capi da produrre. */
export async function readRestockPage(
  supabase: SupabaseClient,
  orderId: unknown,
): Promise<RestockPageRead> {
  if (!uuid(orderId)) return { status: "not_found" };
  const data = await readCore(supabase);
  const order = data.orders.find((o) => o.id === orderId.toLowerCase());
  if (!order) return { status: "not_found" };
  const requirements = await pages(
    supabase,
    "production_requirements",
    "id,order_line_id,required_quantity,completed_quantity,cancelled_quantity,status",
  );
  const openLineIds = requirements.flatMap((raw) => {
    const r = record(raw);
    return r && (r.status === "to_plan" || r.status === "partially_ready") && uuid(r.order_line_id)
      ? [r.order_line_id]
      : [];
  });
  const [products, variants, items, availability, requirementLines] = await Promise.all([
    pages(supabase, "products", "id,model,category"),
    pages(
      supabase,
      "product_variants",
      "stock_item_id,product_id,color,size,central_target_quantity",
      "stock_item_id",
    ),
    pages(supabase, "stock_items", "id,sku,active", "id", [{ column: "kind", value: "product" }]),
    pages(
      supabase,
      "operational_stock_availability",
      "stock_item_id,location_id,on_hand,reserved,available",
      "stock_item_id",
      [{ column: "location_id", value: order.warehouse.id }],
    ),
    openLineIds.length
      ? consignmentPages((after, limit) => {
          let q = supabase
            .from("sales_order_lines")
            .select("id,stock_item_id", { count: "exact" })
            .in("id", openLineIds)
            .order("id")
            .limit(limit);
          if (after !== null) q = q.gt("id", after);
          return q;
        })
      : Promise.resolve([]),
  ]);
  const catalog = restockCatalogFromRows(
    { products, variants, items, availability, requirements, requirementLines },
    order.warehouse.id,
  );
  return {
    status: "ready",
    page: { data, order, catalog, incoming: incomingByItem(data.orders, order.id) },
  };
}

// ---------------------------------------------------------------------------
// Comandi.

type Message = (detail: string | null) => string;
const fixed =
  (text: string): Message =>
  () =>
    text;
/** Messaggi in italiano per ogni codice del database. Nessun dettaglio tecnico. */
export const RESTOCK_MESSAGES: Record<string, Message> = {
  membership_required: fixed("Accedi di nuovo con un account abilitato al team."),
  invalid_payload: fixed("Controlla i dati inseriti: titolo, quantità e note."),
  idempotency_conflict: fixed(
    "Questo invio è già legato a dati diversi. Rileggi la pagina prima di riprovare.",
  ),
  stale_version: fixed(
    "Qualcun altro ha appena modificato questo riordine. Rileggi e ripeti la modifica.",
  ),
  restock_not_found: fixed("Questo riordine non c’è più. Rileggi la pagina."),
  restock_deleted: fixed("Questo riassortimento è eliminato. Ripristinalo prima di modificarlo."),
  title_taken: fixed("C’è già un riordine con questo titolo. Scegline un altro."),
  invalid_location: fixed("Il magazzino o il negozio scelto non è attivo. Rileggi la pagina."),
  shop_has_lines: fixed(
    "Il riordine ha già magliette per il negozio: toglile prima di cambiare negozio.",
  ),
  restock_received: fixed(
    "Il riordine è già in mano nostra: per cambiarlo annulla prima l’arrivo.",
  ),
  restock_not_received: fixed("Il riordine non è in mano nostra. Rileggi la pagina."),
  no_shop: fixed("Scegli prima il negozio del riordine."),
  invalid_tshirt: fixed("Per il negozio vanno solo T-shirt."),
  size_not_in_shop: (sku) =>
    sku
      ? `${sku}: il negozio non tiene questa taglia.`
      : "Il negozio non tiene una di queste taglie.",
  unknown_variant: (sku) =>
    sku
      ? `${sku} non è attiva nel catalogo: per noi e per il negozio servono varianti attive.`
      : "Modello, colore o taglia non sono nel catalogo. Per il cliente scegli un modello e un colore a catalogo.",
  unknown_stock: (sku) =>
    sku
      ? `Per ${sku} la giacenza del magazzino non è verificata: serve prima una conta. Nessun pezzo caricato.`
      : "Per una variante la giacenza del magazzino non è verificata. Nessun pezzo caricato.",
  restock_stock_used: (sku) =>
    sku
      ? `Per ${sku} in magazzino ne restano meno di quelle caricate: alcune sono già uscite. Arrivo non annullato.`
      : "Alcune magliette caricate sono già uscite dal magazzino. Arrivo non annullato.",
  shop_order_linked: (number) =>
    number
      ? `C’è l’ordine n. ${number} del negozio legato a questo riordine: chiudilo o riporta le magliette dal Conto vendita prima di annullare l’arrivo.`
      : "Le magliette per il negozio sono segnate come consegnate: togli il segno prima di annullare l’arrivo.",
  stock_mutations_disabled: fixed("Le modifiche al magazzino sono sospese."),
};
/** Errori che arrivano prima della ricevuta: in una verifica non provano che l'invio non sia avvenuto. */
const EARLY = ["membership_required", "invalid_payload", "stock_mutations_disabled"];
/** Rifiuti con lo SKU (o il numero dell'ordine) nel dettaglio. */
const DETAIL_CODES = [
  "size_not_in_shop",
  "unknown_variant",
  "unknown_stock",
  "restock_stock_used",
  "invalid_tshirt",
];
const SKU_SAFE = /^[A-Za-z0-9][A-Za-z0-9._\-/ ]{0,119}$/;
const uncertain = (): RestockResult => ({
  status: "uncertain",
  message: "Esito non confermato. Conserva e verifica lo stesso invio senza cambiare i dati.",
});

/** Lo SKU di un rifiuto si mostra solo se è un articolo del gestionale letto con la RLS. */
async function knownSku(supabase: SupabaseClient, detail: unknown) {
  if (typeof detail !== "string" || !SKU_SAFE.test(detail)) return null;
  try {
    const { data, error } = await supabase
      .from("stock_items")
      .select("id,sku")
      .eq("sku", detail)
      .limit(1)
      .maybeSingle();
    const row = record(data);
    return !error && row && row.sku === detail && uuid(row.id)
      ? { sku: detail, itemId: row.id.toLowerCase() }
      : null;
  } catch {
    return null;
  }
}

const isInt = (v: unknown, min = 0): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min;
/** Ricevuta coerente con il comando inviato; altrimenti `null` (esito incerto). */
function receiptTarget(command: RestockCommand, r: Record<string, unknown>): RestockTarget | null {
  const p = command.payload;
  const orderId = "order_id" in p && p.order_id ? p.order_id : command.operationId;
  if (r.order_id !== orderId || !isInt(r.version, 1)) return null;
  const target: RestockTarget = { orderId, version: r.version };
  switch (command.kind) {
    case "save_restock_order":
      return isRestockState(r.state) ? { ...target, state: r.state } : null;
    case "set_restock_lines":
      return isInt(r.pieces) ? { ...target, pieces: r.pieces } : null;
    case "move_restock_order":
      return r.state === command.payload.state ? { ...target, state: command.payload.state } : null;
    case "receive_restock_order":
      return r.state === "in_hand" && r.arrival_id === command.operationId && isInt(r.pieces)
        ? { ...target, state: "in_hand", pieces: r.pieces }
        : null;
    case "undo_restock_arrival":
      return isRestockState(r.state) &&
        r.state !== "in_hand" &&
        uuid(r.arrival_id) &&
        isInt(r.pieces)
        ? { ...target, state: r.state, pieces: r.pieces }
        : null;
    case "set_restock_shop_done":
      return r.done === command.payload.done ? target : null;
    case "set_restock_deleted":
      return r.deleted === command.payload.deleted && isRestockState(r.state)
        ? { ...target, state: r.state, deleted: r.deleted }
        : null;
  }
}

function successMessage(command: RestockCommand, target: RestockTarget): string {
  switch (command.kind) {
    case "save_restock_order":
      return command.payload.order_id === null ? "Riordine creato." : "Riordine salvato.";
    case "set_restock_lines":
      return `Quantità salvate: ${piecesLabel(target.pieces ?? 0)}.`;
    case "move_restock_order":
      return `Riordine spostato a «${STATE_LABEL[command.payload.state]}».`;
    case "receive_restock_order":
      return `Arrivo registrato: ${piecesLabel(target.pieces ?? 0)} caricati in magazzino.`;
    case "undo_restock_arrival":
      return `Arrivo annullato: ${piecesLabel(target.pieces ?? 0)} tolti dal magazzino. Il riordine si può modificare di nuovo.`;
    case "set_restock_shop_done":
      return command.payload.done
        ? "Magliette per il negozio segnate come consegnate."
        : "Segno di consegna tolto.";
    case "set_restock_deleted":
      return command.payload.deleted
        ? "Riassortimento eliminato. Puoi ripristinarlo da Eliminati; le scorte restano invariate."
        : "Riassortimento ripristinato. Le scorte restano invariate.";
  }
}

/**
 * Un comando del riassortimento con il client della persona collegata. Membership prima della
 * RPC; in una verifica (`retry`) ogni rifiuto che può precedere la ricevuta resta incerto.
 */
export async function executeRestockCommand(
  supabase: SupabaseClient,
  value: unknown,
): Promise<RestockResult> {
  const retry = record(value)?.retry === true;
  let submitted = false;
  const rejected = (
    code: string,
    detail: string | null = null,
    itemId?: string,
  ): RestockResult => ({
    status: "rejected",
    code,
    message: RESTOCK_MESSAGES[code](detail),
    ...(itemId ? { itemId } : {}),
  });
  try {
    const access = await verifiedMember(supabase);
    if (access.status !== "member") return retry ? uncertain() : rejected("membership_required");
    const command = parseRestockCommand(value);
    if (!command) return retry ? uncertain() : rejected("invalid_payload");
    submitted = true;
    const { data, error } = await supabase.rpc(command.kind, {
      p_operation_id: command.operationId,
      p_payload: command.payload,
    });
    if (error) {
      const code = typeof error.message === "string" ? error.message : "";
      if (retry && EARLY.includes(code)) return uncertain();
      if (
        !["22023", "42501", "23505"].includes(error.code) ||
        !Object.hasOwn(RESTOCK_MESSAGES, code)
      )
        return uncertain();
      if (code === "shop_order_linked")
        return rejected(
          code,
          typeof error.details === "string" && /^[1-9][0-9]{0,6}$/.test(error.details)
            ? error.details
            : null,
        );
      if (!DETAIL_CODES.includes(code)) return rejected(code);
      const known = await knownSku(supabase, error.details);
      return known ? rejected(code, known.sku, known.itemId) : rejected(code);
    }
    const r = record(data);
    const target =
      r && r.operation_id === command.operationId && typeof r.replayed === "boolean"
        ? receiptTarget(command, r)
        : null;
    if (!r || !target) return uncertain();
    return {
      status: "success",
      kind: command.kind,
      operationId: command.operationId,
      replayed: r.replayed as boolean,
      message: r.replayed
        ? "Operazione già registrata: conferma recuperata senza duplicare niente."
        : successMessage(command, target),
      target,
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
