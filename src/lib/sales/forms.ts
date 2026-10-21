import { euroCents, isUuid, parseSalesCommand, romeInputToIso, type CommandKind, type SalesSnapshot } from "./model";

function bad(message: string): never { throw new Error(message); }
const string = (form: FormData, key: string) => typeof form.get(key) === "string" ? form.get(key) as string : "";
const positive = (v: FormDataEntryValue | null) => typeof v === "string" && /^[1-9]\d{0,5}$/.test(v) && Number(v) <= 100000 ? Number(v) : bad("Inserisci una quantità intera fra 1 e 100.000.");
export function formTimestamp(form: FormData) { return romeInputToIso(string(form, "occurredAt")) ?? bad("Data non valida o ambigua al cambio d’ora. Gli orari sono in Europe/Rome."); }

export function newSalePayload(form: FormData, snapshot: SalesSnapshot): Record<string, unknown> {
  const ids = form.getAll("itemId"), quantities = form.getAll("quantity"), prices = form.getAll("unitPrice"), discounts = form.getAll("discount");
  if (!ids.length || ids.length > 50 || [quantities, prices, discounts].some(rows => rows.length !== ids.length)) bad("Aggiungi da una a 50 righe prodotto complete.");
  const lines = ids.map((itemId, i) => {
    if (!isUuid(itemId)) bad("Scegli un prodotto per ogni riga.");
    const item = snapshot.items.find(row => row.id === itemId && row.active);
    if (!item) bad("Scegli uno SKU attivo dal catalogo.");
    const quantity = positive(quantities[i]);
    const unitPrice = euroCents(prices[i], 1000000000), discount = euroCents(discounts[i]);
    if (unitPrice === null || discount === null || discount > unitPrice * quantity) bad("Controlla prezzi e sconti: usa euro senza separatori delle migliaia, con massimo due decimali.");
    return { stock_item_id: itemId, quantity, unit_price_cents: unitPrice, discount_cents: discount };
  });
  if (new Set(ids).size !== ids.length) bad("Ogni SKU può comparire una volta: modifica la quantità della riga esistente.");
  const reason = string(form, "reason").trim();
  if (lines.some(line => line.discount_cents! > 0 || line.unit_price_cents !== snapshot.items.find(item => item.id === line.stock_item_id)?.priceCents) && reason.length < 3) bad("Indica il motivo dello sconto o del prezzo diverso dal listino.");
  const occurred = formTimestamp(form), total = lines.reduce((sum, line) => sum + line.quantity * line.unit_price_cents! - line.discount_cents!, 0);
  const reference = string(form, "externalReference").trim(), paymentReference = string(form, "paymentReference").trim();
  const payload = { schema_version: 1, channel: string(form, "channel"), occurred_at: occurred, location_id: string(form, "locationId"), lines,
    fulfillment_mode: string(form, "mode"), ...(reference ? { external_reference: reference } : {}), ...(reason ? { reason } : {}),
    payment: string(form, "paymentState") === "paid" ? { status: "paid", method: string(form, "method"), amount_cents: total, occurred_at: occurred, ...(paymentReference ? { reference: paymentReference } : {}) } : { status: "unpaid" } };
  if (!snapshot.locations.some(row => row.id === payload.location_id && row.active&&row.type==="Magazzino")) bad("Le vendite dirette, gli eventi e gli altri canali manuali utilizzano Magadzino. LCM è riservato al conto vendita.");
  if (!parseSalesCommand({ operationId: "00000000-0000-4000-8000-000000000000", kind: "register_manual_sale", payload })) bad("Controlla canale, modalità, metodo di pagamento, data e riferimenti. Etsy richiede un riferimento ordine.");
  return payload;
}

export function quantityCommandPayload(form: FormData, kind: CommandKind, orderId: string, lineIds: string[]): Record<string, unknown> {
  const lines = lineIds.flatMap(id => { const value = string(form, `quantity:${id}`); return value === "" || value === "0" ? [] : [{ order_line_id: id, quantity: positive(value) }]; });
  const payload = { order_id: orderId, lines, occurred_at: formTimestamp(form), reason: string(form, "reason").trim() };
  if (!parseSalesCommand({ operationId: "00000000-0000-4000-8000-000000000000", kind, payload })) bad("Indica almeno una quantità e una motivazione di almeno tre caratteri.");
  return payload;
}
export function productionPayload(form: FormData, requirementId: string) {
  return { requirement_id: requirementId, quantity: positive(form.get("quantity")), occurred_at: formTimestamp(form), reason: string(form, "reason").trim() };
}
export function paymentPayload(form: FormData, orderId: string) {
  const amount = euroCents(string(form, "amount"));
  if (amount === null) bad("L’importo dell’incasso non è valido.");
  const reference = string(form, "reference").trim();
  return { order_id: orderId, amount_cents: amount, method: string(form, "method"), occurred_at: formTimestamp(form), ...(reference ? { reference } : {}) };
}
