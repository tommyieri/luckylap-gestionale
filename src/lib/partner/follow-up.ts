// Partner: il sollecito nato da «Segna inviato» (decisione 10, correzione 05-7).
//
// Il trigger del database crea il sollecito nella stessa transazione dell'invio, collegato
// all'attività (`partner_work_links`, tipo `follow_up`). Dopo il comando la scheda lo rilegge
// per dire nella conferma quando scade: «Sollecito per te giovedì 29 ottobre.». Nessun
// sollecito (contatto chiuso, non interessato o da non contattare): la conferma resta quella.
import type { SupabaseClient } from "@supabase/supabase-js";
import { TEAM_TIME_ZONE } from "../team/model";
import { isPartnerId } from "./model";

export type SentFollowUp = { dueAt: string; assignedTo: string | null };

const dueDay = new Intl.DateTimeFormat("it-IT", {
  timeZone: TEAM_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** «Sollecito per te giovedì 29 ottobre.»: il giorno di Roma della scadenza. */
export function followUpConfirmation(followUp: SentFollowUp, userId: string): string {
  const day = dueDay.format(Date.parse(followUp.dueAt));
  return followUp.assignedTo === userId ? `Sollecito per te ${day}.` : `Sollecito ${day}.`;
}

/**
 * Il sollecito aperto creato dall'attività `activityId`, o `null` se non c'è. Lancia se la
 * lettura non riesce o la risposta non torna: chi chiama tiene la conferma senza data.
 */
export async function readSentFollowUp(
  supabase: SupabaseClient,
  activityId: string,
): Promise<SentFollowUp | null> {
  const links = await supabase
    .from("partner_work_links")
    .select("task_id")
    .eq("kind", "follow_up")
    .eq("activity_id", activityId)
    .limit(2);
  if (links.error || !Array.isArray(links.data) || links.data.length > 1)
    throw new Error("Sollecito non leggibile.");
  const taskId = (links.data[0] as { task_id?: unknown } | undefined)?.task_id;
  if (taskId === undefined || taskId === null) return null;
  if (!isPartnerId(taskId)) throw new Error("Sollecito non leggibile.");
  const tasks = await supabase
    .from("tasks")
    .select("id,due_at,assigned_to,status")
    .eq("id", taskId)
    .limit(1);
  if (tasks.error || !Array.isArray(tasks.data) || tasks.data.length > 1)
    throw new Error("Sollecito non leggibile.");
  const task = tasks.data[0] as
    { id?: unknown; due_at?: unknown; assigned_to?: unknown; status?: unknown } | undefined;
  if (!task || task.status === "done") return null;
  if (
    task.id !== taskId ||
    typeof task.due_at !== "string" ||
    !Number.isFinite(Date.parse(task.due_at)) ||
    (task.assigned_to !== null && !isPartnerId(task.assigned_to))
  )
    throw new Error("Sollecito non leggibile.");
  return { dueAt: task.due_at, assignedTo: task.assigned_to as string | null };
}
