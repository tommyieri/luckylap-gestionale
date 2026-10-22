import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerifiedMember } from "../auth/model";
import { loadAuthenticatedInventory } from "../auth/server";
import { loadTeamWorkspace } from "../team/server";
import { agendaFor, stockCounts, type Agenda, type StockCounts, type Tile } from "./model";

/**
 * Letture dei riquadri di Oggi (docs: 01-layout §9, 05-collegamenti §3).
 * Ogni riquadro riceve client e membro già verificati dalla pagina, usa la
 * sessione del membro sotto RLS e cattura i suoi errori: un riquadro che
 * fallisce non tocca gli altri, e mostra numeri completi o nessun numero.
 */
export async function loadAgendaTile(
  supabase: SupabaseClient,
  member: VerifiedMember,
  now: Date,
): Promise<Tile<Agenda>> {
  try {
    const team = await loadTeamWorkspace(supabase);
    return { status: "ok", data: agendaFor(team.events, team.tasks, member.userId, now) };
  } catch (error) {
    unstable_rethrow(error);
    return { status: "error" };
  }
}

export async function loadStockTile(supabase: SupabaseClient): Promise<Tile<StockCounts>> {
  try {
    const inventory = await loadAuthenticatedInventory(supabase);
    return { status: "ok", data: stockCounts(inventory.items) };
  } catch (error) {
    unstable_rethrow(error);
    return { status: "error" };
  }
}
