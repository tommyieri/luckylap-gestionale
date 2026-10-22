import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { financeWorkAccess } from "../finance-work/server";
import { readCompletePages } from "./read";
import { dashboardSettlementsFromRows } from "./settlements";

/** Caller-scoped read after a fresh Finance password grant; no administrative client. */
export async function readDashboardSettlements(supabase: SupabaseClient) {
  const access = await financeWorkAccess(supabase);
  if (access.status !== "authorized") throw new Error("Lettura Finance non disponibile.");
  const rows = await readCompletePages((from, to) =>
    supabase
      .from("consignment_settlements")
      .select("id,sale_id,amount_cents,occurred_at,method,reference", { count: "exact" })
      .order("id")
      .range(from, to),
  );
  return dashboardSettlementsFromRows(rows);
}
