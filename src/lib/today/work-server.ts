import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tile } from "./model";
import { romeDay } from "./model";
import {
  parsePartnerWork,
  preparationWork,
  type PartnerWork,
  type PreparationWork,
} from "./work-model";
import { readSalesWorkspace } from "../sales/server";
export async function loadPartnerWorkTile(
  supabase: SupabaseClient,
  now: Date,
): Promise<Tile<PartnerWork>> {
  try {
    const { data, error } = await supabase.rpc("read_partner_today", { p_day: romeDay(now) });
    if (error) throw error;
    return { status: "ok", data: parsePartnerWork(data) };
  } catch (error) {
    unstable_rethrow(error);
    return { status: "error" };
  }
}
export async function loadPreparationTile(
  supabase: SupabaseClient,
): Promise<Tile<PreparationWork>> {
  try {
    const sales = await readSalesWorkspace(supabase);
    if (sales.status !== "ready") throw new Error("Vendite non disponibili.");
    return { status: "ok", data: preparationWork(sales.snapshot.orders) };
  } catch (error) {
    unstable_rethrow(error);
    return { status: "error" };
  }
}
