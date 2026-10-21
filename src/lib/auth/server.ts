import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { memberFromDatabase } from "./model";
import { inventoryFromDatabase } from "./inventory-model";

export async function verifiedMember(supabase: SupabaseClient) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { status: "signed-out" as const };
  const [membership, profile] = await Promise.all([
    supabase.from("memberships").select("user_id,role,active,finance_access").eq("user_id", user.id).eq("active", true).maybeSingle(),
    supabase.from("profiles").select("user_id,display_name").eq("user_id", user.id).maybeSingle(),
  ]);
  if (membership.error || profile.error) return { status: "unavailable" as const };
  const member = memberFromDatabase(user.id, membership.data, profile.data);
  return member ? { status: "member" as const, member } : { status: "denied" as const };
}

/** Caller must verify membership immediately before this RLS-scoped read. */
export async function loadAuthenticatedInventory(supabase: SupabaseClient) {
  const results = await Promise.all([
    supabase.from("products").select("id,model,category").limit(1000),
    supabase.from("stock_items").select("id,kind,sku,unit_cost_eur,list_price_eur,active,source").eq("kind", "product").order("sku").limit(1000),
    supabase.from("product_variants").select("stock_item_id,product_id,color,size,central_target_quantity").limit(1000),
    supabase.from("stock_balances").select("stock_item_id,location_id,quantity").limit(1000),
    supabase.from("stock_locations").select("id,code").limit(1000),
  ]);
  // A full page may be truncated by PostgREST. Refuse it instead of silently
  // dropping SKUs; add paginated reads before growing past this v1 bound.
  if (results.some(result => result.error || !result.data || result.data.length >= 1000)) throw new Error("Inventario non disponibile.");
  const [products, items, variants, balances, locations] = results.map(result => result.data!);
  return inventoryFromDatabase({ products, items, variants, balances, locations });
}
