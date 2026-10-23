import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTeamId } from "../team/model";
import { readTeamPages } from "../team/read";
import { MAGADZINO_CODE, type MagadzinoAvailability } from "./tshirt-lines";

const fail = (): never => {
  throw new Error("Disponibilità del Magadzino non leggibile.");
};
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();
const quantity = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fail();
const maybeQuantity = (value: unknown): number | null => (value === null ? null : quantity(value));

/**
 * Fisico e riservato di ogni articolo nel Magadzino (`MAG01`), dalla vista
 * `operational_stock_availability` con i permessi del membro (RLS). Chi chiama ha già
 * verificato la membership. Una lettura incompleta o incoerente lancia: niente numeri parziali.
 */
export async function loadMagadzinoAvailability(
  supabase: SupabaseClient,
): Promise<MagadzinoAvailability[]> {
  const location = await supabase
    .from("stock_locations")
    .select("id,code")
    .eq("code", MAGADZINO_CODE)
    .limit(2);
  if (location.error || !Array.isArray(location.data) || location.data.length !== 1) fail();
  const locationId = record(location.data![0]).id;
  if (!isTeamId(locationId)) fail();
  const id = (locationId as string).toLowerCase();
  const rows = await readTeamPages((after, limit) => {
    let query = supabase
      .from("operational_stock_availability")
      .select("stock_item_id,location_id,on_hand,reserved,available", { count: "exact" })
      .eq("location_id", id)
      .order("stock_item_id")
      .limit(limit);
    if (after !== null) query = query.gt("stock_item_id", after);
    return query;
  }, "stock_item_id");
  return rows.map((value): MagadzinoAvailability => {
    const row = record(value);
    const stockItemId = row.stock_item_id;
    if (!isTeamId(stockItemId) || String(row.location_id).toLowerCase() !== id) fail();
    const onHand = maybeQuantity(row.on_hand);
    const reserved = quantity(row.reserved);
    const available = maybeQuantity(row.available);
    // Stessa coerenza delle Rettifiche: disponibile = fisico − riservato, ignoto resta ignoto.
    if (
      onHand === null
        ? available !== null || reserved !== 0
        : reserved > onHand || available !== onHand - reserved
    )
      fail();
    return {
      stockItemId: (stockItemId as string).toLowerCase(),
      locationCode: MAGADZINO_CODE,
      onHand,
      reserved,
    };
  });
}
