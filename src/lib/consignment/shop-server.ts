import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerifiedMember } from "../auth/model";
import { verifiedMember } from "../auth/server";
import { verifiedSensitiveAccess } from "../auth/sensitive-access";
import { stockRecord as record, stockUuid as uuid } from "../stock/model";
import { consignmentPages } from "./read";
import {
  isFinanceShopCommand,
  parseShopCommand,
  shopCommandItems,
  tshirtsLabel,
  type OrderStatus,
  type ShopCommand,
  type ShopResult,
  type ShopTarget,
} from "./shop-model";
import { shopCode } from "./links";
import {
  shopLocationsFrom,
  shopPageFromRows,
  shopsFromRows,
  SHOP_TYPE,
  WAREHOUSE_TYPE,
  type ShopList,
  type ShopLocation,
  type ShopPage,
} from "./shop-read";

/*
 * Letture e comandi del conto vendita con il client della persona collegata:
 * nessun client amministrativo, la RLS resta l'autorità sui dati. Le pagine
 * verificano il membro con `requireMember()` subito prima di leggere.
 */

const SHOP_COLUMNS =
  "location_id,supply_location_id,brand_share_bps,markup_cents,first_counted_at,note,version,created_by,created_at";
const REPORT_COLUMNS =
  "id,location_id,period_month,revision,brand_share_bps,markup_cents,pieces,gross_cents,brand_cents,shop_cents,invoice_number,invoice_date,invoice_revision,payment_state,created_at,updated_at";
const AVAILABILITY_COLUMNS = "stock_item_id,location_id,on_hand,reserved,available";

type Filter = { column: string; value: string | boolean };
/** Lettura completa con conteggio esatto e chiave crescente (`consignmentPages`). */
function pages(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  key = "id",
  filters: Filter[] = [],
) {
  return consignmentPages((after, limit) => {
    let q = supabase.from(table).select(columns, { count: "exact" });
    for (const f of filters) q = q.eq(f.column, f.value);
    q = q.order(key).limit(limit);
    if (after !== null) q = q.gt(key, after);
    return q;
  }, key);
}
async function settingsRow(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("app_settings")
    .select("stock_adjustments_enabled,manual_sales_enabled,sales_started_at")
    .eq("id", true)
    .single();
  if (error || !data) throw Error("Stato conto vendita non disponibile.");
  return data;
}
/** Finance aperta in questa sessione. Un errore della verifica vale «chiusa»: nessuna lettura riservata. */
async function financeOpen(supabase: SupabaseClient, member: VerifiedMember) {
  try {
    return await verifiedSensitiveAccess(supabase, member, "finance");
  } catch {
    return false;
  }
}

export type ShopsRead = { status: "ready"; canFinance: boolean; list: ShopList };
/** Elenco dei negozi. `member` è il membro appena verificato dalla pagina. */
export async function readConsignmentShops(
  supabase: SupabaseClient,
  member: VerifiedMember,
  now: Date = new Date(),
): Promise<ShopsRead> {
  const [canFinance, settings, shops, locations, reports, openOrders] = await Promise.all([
    financeOpen(supabase, member),
    settingsRow(supabase),
    pages(supabase, "consignment_shops", SHOP_COLUMNS, "location_id"),
    pages(supabase, "stock_locations", "id,code,name,active,location_type"),
    pages(supabase, "consignment_reports", REPORT_COLUMNS),
    pages(supabase, "consignment_orders", "id,location_id,order_number,status", "id", [
      { column: "status", value: "open" },
    ]),
  ]);
  const availability = (
    await Promise.all(
      shops.map((raw) => {
        const location = record(raw)?.location_id;
        if (!uuid(location)) throw Error("Negozio non disponibile.");
        return pages(
          supabase,
          "operational_stock_availability",
          AVAILABILITY_COLUMNS,
          "stock_item_id",
          [{ column: "location_id", value: location }],
        );
      }),
    )
  ).flat();
  return {
    status: "ready",
    canFinance,
    list: shopsFromRows({ settings, shops, locations, availability, reports, openOrders }, now),
  };
}

export type NewShopRead = { canFinance: boolean; warehouses: ShopLocation[] };
/** Modulo del nuovo negozio: Finance aperta e magazzini attivi da cui partono le consegne. */
export async function readNewShopForm(
  supabase: SupabaseClient,
  member: VerifiedMember,
): Promise<NewShopRead> {
  const [canFinance, locations] = await Promise.all([
    financeOpen(supabase, member),
    pages(supabase, "stock_locations", "id,code,name,active,location_type"),
  ]);
  return {
    canFinance,
    warehouses: shopLocationsFrom(locations).filter((l) => l.type === WAREHOUSE_TYPE && l.active),
  };
}

export type ShopRead =
  { status: "not_found" } | { status: "ready"; canFinance: boolean; page: ShopPage };
/**
 * Pagina di un negozio dal suo codice. I pagamenti e il loro storico si
 * leggono solo dopo aver verificato Finance in questa sessione.
 */
export async function readConsignmentShop(
  supabase: SupabaseClient,
  member: VerifiedMember,
  code: unknown,
): Promise<ShopRead> {
  const wanted = shopCode(code);
  if (!wanted) return { status: "not_found" };
  const locationRows = await pages(
    supabase,
    "stock_locations",
    "id,code,name,active,location_type",
  );
  const location = shopLocationsFrom(locationRows).find(
    (l) => l.code.toUpperCase() === wanted && l.type === SHOP_TYPE,
  );
  if (!location) return { status: "not_found" };
  const { data: shop, error } = await supabase
    .from("consignment_shops")
    .select(SHOP_COLUMNS)
    .eq("location_id", location.id)
    .maybeSingle();
  if (error) throw Error("Negozio non disponibile.");
  if (!shop) return { status: "not_found" };
  const supplyId = record(shop)?.supply_location_id ?? null;
  if (supplyId !== null && !uuid(supplyId)) throw Error("Negozio non disponibile.");
  const own = [{ column: "location_id", value: location.id }];
  const canFinance = await financeOpen(supabase, member);
  const [
    settings,
    items,
    variants,
    products,
    catalog,
    shopAvailability,
    supplyAvailability,
    counts,
    reports,
    reportLines,
    reportRevisions,
    orders,
    orderLines,
    shipments,
    profiles,
    payments,
    paymentRevisions,
  ] = await Promise.all([
    settingsRow(supabase),
    pages(supabase, "stock_items", "id,sku,name,kind,active,unit_cost_eur", "id", [
      { column: "kind", value: "product" },
    ]),
    pages(supabase, "product_variants", "stock_item_id,product_id,color,size", "stock_item_id"),
    pages(supabase, "products", "id,model,category"),
    // Una sola lettura del catalogo: varianti attive collegate a un articolo.
    consignmentPages((after, limit) => {
      let q = supabase
        .from("shopify_catalog_variants")
        .select(
          "shop_domain,variant_gid,stock_item_id,sku,status,currency_code,price_cents,observed_at,product_type",
          { count: "exact" },
        )
        .not("stock_item_id", "is", null)
        .eq("status", "ACTIVE")
        .order("variant_gid")
        .limit(limit);
      if (after !== null) q = q.gt("variant_gid", after);
      return q;
    }, "variant_gid"),
    pages(supabase, "operational_stock_availability", AVAILABILITY_COLUMNS, "stock_item_id", own),
    supplyId === null
      ? Promise.resolve([])
      : pages(supabase, "operational_stock_availability", AVAILABILITY_COLUMNS, "stock_item_id", [
          { column: "location_id", value: supplyId },
        ]),
    pages(
      supabase,
      "consignment_counts",
      "id,location_id,counted_at,full_count,pieces,note,created_by",
      "id",
      own,
    ),
    pages(supabase, "consignment_reports", REPORT_COLUMNS, "id", own),
    pages(
      supabase,
      "consignment_report_lines",
      "id,report_id,location_id,stock_item_id,sku_snapshot,quantity,before_count_quantity,shop_domain,variant_gid,catalog_observed_at,web_price_cents,markup_cents,brand_share_bps,unit_shop_price_cents,gross_cents,brand_cents,shop_cents,unit_cost_cents,priced_at",
      "id",
      own,
    ),
    pages(
      supabase,
      "consignment_report_revisions",
      "id,report_id,location_id,revision,change_kind,reason,snapshot,created_by,created_at",
      "id",
      own,
    ),
    pages(
      supabase,
      "consignment_orders",
      "id,location_id,order_number,requested_on,note,status,close_reason,version,created_by,created_at,updated_at",
      "id",
      own,
    ),
    pages(
      supabase,
      "consignment_order_lines",
      "id,order_id,location_id,stock_item_id,quantity,delivered_quantity,cancelled_quantity",
      "id",
      own,
    ),
    pages(
      supabase,
      "consignment_shipments",
      "id,location_id,direction,order_id,occurred_at,reason,pieces,created_by",
      "id",
      own,
    ),
    pages(supabase, "profiles", "user_id,display_name", "user_id"),
    canFinance
      ? pages(
          supabase,
          "consignment_report_payments",
          "id,report_id,location_id,amount_cents,paid_at,method,account_label,reference,voided,version",
          "id",
          own,
        )
      : null,
    canFinance
      ? pages(
          supabase,
          "consignment_payment_revisions",
          "id,payment_id,location_id,version,reason,snapshot,created_by,created_at",
          "id",
          own,
        )
      : null,
  ]);
  return {
    status: "ready",
    canFinance,
    page: shopPageFromRows({
      settings,
      locations: locationRows,
      shop,
      items,
      variants,
      products,
      catalog,
      availability: [...shopAvailability, ...supplyAvailability],
      counts,
      reports,
      reportLines,
      reportRevisions,
      orders,
      orderLines,
      shipments,
      profiles,
      payments,
      paymentRevisions,
    }),
  };
}

// ---------------------------------------------------------------------------
// Comandi.

type Message = (sku: string | null) => string;
const fixed =
  (text: string): Message =>
  () =>
    text;
const perSku =
  (withSku: (sku: string) => string, without: string): Message =>
  (sku) =>
    sku ? withSku(sku) : without;
/** Messaggi in italiano per ogni codice del database. Nessun dettaglio tecnico. */
export const SHOP_MESSAGES: Record<string, Message> = {
  membership_required: fixed("Accedi di nuovo con un account abilitato al team."),
  finance_access_required: fixed(
    "Apri Finance con la password dell’area per gestire negozi, fatture e pagamenti.",
  ),
  stock_mutations_disabled: fixed("Le modifiche al magazzino sono sospese."),
  sales_disabled: fixed("Le vendite non sono ancora attive nel gestionale."),
  invalid_payload: fixed("Controlla i dati inseriti: quantità, date e testi."),
  invalid_date: fixed("La data non è valida: non può essere nel futuro né prima del mese."),
  invalid_period: fixed(
    "Questo mese non si può registrare: scegli un mese dall’avvio delle vendite a oggi.",
  ),
  invalid_location: fixed("Il negozio o il magazzino scelto non è attivo. Rileggi la pagina."),
  invalid_tshirt: fixed("Il conto vendita è disponibile solo per T-shirt attive."),
  idempotency_conflict: fixed(
    "Questo invio è già legato a dati diversi. Rileggi la pagina prima di riprovare.",
  ),
  stale_version: fixed(
    "Qualcun altro ha appena modificato questi dati. Rileggi e ripeti la modifica.",
  ),
  stock_changed: fixed(
    "Nel frattempo la giacenza è cambiata. Controlla i numeri aggiornati e salva di nuovo.",
  ),
  full_count_required: fixed(
    "La prima conta deve comprendere tutte le magliette. Lascia 0 dove non ce ne sono.",
  ),
  shop_not_counted: fixed("Prima conta le magliette in negozio."),
  report_exists: fixed("Il resoconto di questo mese esiste già. Aprilo e usa «Modifica»."),
  report_not_found: fixed("Questo resoconto non c’è più. Rileggi la pagina."),
  unmatched_catalog: perSku(
    (sku) => `Per ${sku} manca il prezzo del sito. Collega lo SKU al catalogo Shopify.`,
    "Per questa maglietta manca il prezzo del sito. Collega lo SKU al catalogo Shopify.",
  ),
  catalog_changed: fixed("Il prezzo del sito è cambiato. Rileggi e controlla il nuovo prezzo."),
  before_count_not_allowed: fixed(
    "«Prima della conta» vale solo se hai contato il negozio in questo mese o dopo.",
  ),
  insufficient_shop_stock: perSku(
    (sku) =>
      `Per ${sku} il negozio ne ha meno di quelle indicate. Correggi il resoconto o la conta.`,
    "Per una maglietta il negozio ne ha meno di quelle indicate. Correggi il resoconto o la conta.",
  ),
  insufficient_stock: perSku(
    (sku) =>
      `Per ${sku} non ci sono abbastanza magliette libere in magazzino. Nessuna consegna registrata.`,
    "Per una maglietta non ci sono abbastanza magliette libere in magazzino. Nessuna consegna registrata.",
  ),
  unknown_stock: perSku(
    (sku) => `Per ${sku} la giacenza del magazzino non è verificata. Nessuna consegna registrata.`,
    "Per una maglietta la giacenza del magazzino non è verificata. Nessuna consegna registrata.",
  ),
  reserved_stock_conflict: fixed(
    "Le magliette sono riservate a ordini di vendita: rileggi i dati prima di continuare.",
  ),
  exceeds_order: perSku(
    (sku) => `Per ${sku} stai consegnando più di quanto resta nell’ordine.`,
    "Stai consegnando più di quanto resta nell’ordine.",
  ),
  below_delivered: perSku(
    (sku) => `Per ${sku} non puoi scendere sotto le magliette già consegnate.`,
    "Non puoi scendere sotto le magliette già consegnate.",
  ),
  order_not_open: fixed("L’ordine non è più aperto. Rileggi la pagina."),
  payment_exceeds_invoice: fixed("Il pagamento supera l’importo ancora da incassare."),
  payment_not_found: fixed("Questo pagamento non c’è più. Rileggi la pagina."),
  shop_not_empty: fixed("Il negozio ha ancora magliette, ordini aperti o resoconti da pagare."),
};
/** Errori che arrivano prima della ricevuta: in una verifica non provano che l'invio non sia avvenuto. */
const EARLY = [
  "membership_required",
  "finance_access_required",
  "invalid_payload",
  "invalid_date",
  "invalid_period",
  "stock_mutations_disabled",
  "sales_disabled",
];
/** Rifiuti che portano lo SKU della riga in `detail`. */
const LINE_CODES = [
  "stock_changed",
  "unmatched_catalog",
  "catalog_changed",
  "insufficient_shop_stock",
  "insufficient_stock",
  "unknown_stock",
  "exceeds_order",
  "below_delivered",
];
const SKU_SAFE = /^[A-Za-z0-9][A-Za-z0-9._\-/ ]{0,119}$/;

const uncertain = (): ShopResult => ({
  status: "uncertain",
  message: "Esito non confermato. Conserva e verifica lo stesso invio senza cambiare i dati.",
});

/** Lo SKU di un rifiuto si mostra solo se è un articolo del gestionale letto con la RLS. */
async function knownSku(supabase: SupabaseClient, details: unknown) {
  if (typeof details !== "string" || !SKU_SAFE.test(details)) return null;
  try {
    const { data, error } = await supabase
      .from("stock_items")
      .select("id,sku")
      .eq("sku", details)
      .eq("kind", "product")
      .limit(1)
      .maybeSingle();
    const row = record(data);
    return !error && row && row.sku === details && uuid(row.id)
      ? { sku: details, itemId: row.id.toLowerCase() }
      : null;
  } catch {
    return null;
  }
}

const isInt = (v: unknown, min = 0): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const STATUSES: readonly OrderStatus[] = ["open", "delivered", "closed"];
/** Ricevuta coerente con il comando inviato; altrimenti `null` (esito incerto). */
function receiptTarget(command: ShopCommand, r: Record<string, unknown>): ShopTarget | null {
  const op = command.operationId;
  switch (command.kind) {
    case "save_consignment_shop": {
      const p = command.payload;
      if (
        !uuid(r.location_id) ||
        (p.location_id !== null && r.location_id !== p.location_id) ||
        typeof r.code !== "string" ||
        !shopCode(r.code) ||
        !isInt(r.version, 1)
      )
        return null;
      return { locationId: r.location_id, code: r.code, version: r.version };
    }
    case "count_consignment_stock":
      return r.count_id === op &&
        r.location_id === command.payload.location_id &&
        isInt(r.pieces) &&
        typeof r.full_count === "boolean"
        ? { locationId: command.payload.location_id, pieces: r.pieces }
        : null;
    case "save_consignment_report":
      return uuid(r.report_id) &&
        (command.payload.expected_revision !== null || r.report_id === op) &&
        isInt(r.revision, 1)
        ? { reportId: r.report_id, revision: r.revision }
        : null;
    case "set_consignment_invoice":
      return r.report_id === command.payload.report_id && isInt(r.revision, 2)
        ? { reportId: r.report_id, revision: r.revision }
        : null;
    case "record_consignment_payment":
      return r.payment_id === op && r.report_id === command.payload.report_id
        ? { paymentId: op, reportId: command.payload.report_id, version: 1 }
        : null;
    case "update_consignment_payment":
      return r.payment_id === command.payload.payment_id && uuid(r.report_id) && isInt(r.version, 2)
        ? { paymentId: command.payload.payment_id, reportId: r.report_id, version: r.version }
        : null;
    case "save_consignment_order": {
      const p = command.payload;
      return r.order_id === (p.order_id ?? op) &&
        isInt(r.order_number, 1) &&
        STATUSES.includes(r.status as OrderStatus) &&
        isInt(r.version, 1)
        ? {
            orderId: r.order_id as string,
            orderNumber: r.order_number,
            orderStatus: r.status as OrderStatus,
            version: r.version,
          }
        : null;
    }
    case "ship_consignment_order":
      return r.shipment_id === op &&
        r.order_id === command.payload.order_id &&
        STATUSES.includes(r.status as OrderStatus) &&
        isInt(r.version, 2)
        ? {
            orderId: command.payload.order_id,
            orderStatus: r.status as OrderStatus,
            version: r.version,
          }
        : null;
    case "close_consignment_order":
      return r.order_id === command.payload.order_id && r.status === "closed" && isInt(r.version, 2)
        ? { orderId: command.payload.order_id, orderStatus: "closed", version: r.version }
        : null;
    case "return_consignment_stock":
      return r.shipment_id === op && r.location_id === command.payload.location_id
        ? { locationId: command.payload.location_id }
        : null;
  }
}

function successMessage(command: ShopCommand, target: ShopTarget): string {
  switch (command.kind) {
    case "save_consignment_shop":
      return command.payload.location_id === null
        ? `Negozio ${target.code} creato.`
        : "Impostazioni del negozio salvate.";
    case "count_consignment_stock":
      return `Conta salvata: ${tshirtsLabel(target.pieces ?? 0)} contate.`;
    case "save_consignment_report":
      return target.revision === 1
        ? "Resoconto salvato. Finance lo vede subito come importo da incassare."
        : `Resoconto corretto: versione ${target.revision}.`;
    case "set_consignment_invoice":
      return command.payload.invoice_number === null ? "Fattura tolta." : "Fattura segnata.";
    case "record_consignment_payment":
      return "Pagamento registrato.";
    case "update_consignment_payment":
      return command.payload.voided ? "Pagamento annullato." : "Pagamento modificato.";
    case "save_consignment_order":
      return command.payload.order_id === null
        ? `Ordine n. ${target.orderNumber} salvato.`
        : `Ordine n. ${target.orderNumber} modificato.`;
    case "ship_consignment_order":
      return target.orderStatus === "delivered"
        ? "Consegna registrata: l’ordine è consegnato tutto."
        : "Consegna registrata.";
    case "close_consignment_order":
      return "Ordine chiuso.";
    case "return_consignment_stock":
      return "Magliette riportate in magazzino.";
  }
}

/**
 * Un comando del conto vendita con il client della persona collegata.
 * Membership (e Finance per negozi, fatture e pagamenti) prima della RPC; in
 * una verifica (`retry`) ogni rifiuto che può precedere la ricevuta resta incerto.
 */
export async function executeShopCommand(
  supabase: SupabaseClient,
  value: unknown,
): Promise<ShopResult> {
  const retry = record(value)?.retry === true;
  let submitted = false;
  const rejected = (code: string, sku: string | null = null, itemId?: string): ShopResult => ({
    status: "rejected",
    code,
    message: SHOP_MESSAGES[code](sku),
    ...(itemId ? { itemId } : {}),
  });
  try {
    const access = await verifiedMember(supabase);
    if (access.status !== "member") return retry ? uncertain() : rejected("membership_required");
    const command = parseShopCommand(value);
    if (!command) return retry ? uncertain() : rejected("invalid_payload");
    if (
      isFinanceShopCommand(command.kind) &&
      !(await verifiedSensitiveAccess(supabase, access.member, "finance"))
    )
      return retry ? uncertain() : rejected("finance_access_required");
    submitted = true;
    const { data, error } = await supabase.rpc(command.kind, {
      p_operation_id: command.operationId,
      p_payload: command.payload,
    });
    if (error) {
      const code = typeof error.message === "string" ? error.message : "";
      if (retry && EARLY.includes(code)) return uncertain();
      if (!["22023", "42501", "23505"].includes(error.code) || !Object.hasOwn(SHOP_MESSAGES, code))
        return uncertain();
      const known = LINE_CODES.includes(code) ? await knownSku(supabase, error.details) : null;
      if (!known) return rejected(code);
      // La riga colpita si evidenzia solo se è una riga di questo invio.
      return rejected(
        code,
        known.sku,
        shopCommandItems(command).includes(known.itemId) ? known.itemId : undefined,
      );
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
