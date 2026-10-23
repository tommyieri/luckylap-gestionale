import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerifiedMember } from "../auth/model";
import { loadAuthenticatedInventory } from "../auth/server";
import { loadTeamWorkspace } from "../team/server";
import { isTeamId } from "../team/model";
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
    const candidates = agendaFor(team.events, team.tasks, member.userId, now).tasks.map(
      (row) => row.task.id,
    );
    const followUps = await readFollowUpTaskIds(supabase, candidates);
    return {
      status: "ok",
      data: agendaFor(team.events, team.tasks, member.userId, now, followUps),
    };
  } catch (error) {
    unstable_rethrow(error);
    return { status: "error" };
  }
}

const FOLLOW_UP_CHUNK = 100;

/**
 * Quali attività dell'agenda sono solleciti Partner (collegamenti `follow_up`). Legge solo gli
 * id già in agenda, a gruppi di 100: una risposta incompleta o strana è un errore del riquadro.
 */
export async function readFollowUpTaskIds(
  supabase: SupabaseClient,
  taskIds: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let start = 0; start < taskIds.length; start += FOLLOW_UP_CHUNK) {
    const chunk = taskIds.slice(start, start + FOLLOW_UP_CHUNK);
    const { data, error } = await supabase
      .from("partner_work_links")
      .select("task_id")
      .eq("kind", "follow_up")
      .in("task_id", chunk);
    if (error || !Array.isArray(data) || data.length > chunk.length)
      throw new Error("Solleciti Partner non leggibili.");
    for (const row of data as unknown[]) {
      const taskId = (row as { task_id?: unknown } | null)?.task_id;
      if (!isTeamId(taskId) || !chunk.includes(taskId))
        throw new Error("Solleciti Partner non leggibili.");
      found.add(taskId);
    }
  }
  return found;
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
