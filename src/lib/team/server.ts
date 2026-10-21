import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeEventDetails, EVENT_TYPES, isTeamId, TASK_STATUSES, type EventType, type TaskStatus, type TeamSnapshot } from "./model";
import { readTeamPages } from "./read";

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Workspace non disponibile.");
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 50000): string => {
  if (typeof value !== "string" || value.length > max) throw new Error("Workspace non disponibile.");
  return value;
};
const id = (value: unknown): string => {
  if (!isTeamId(value)) throw new Error("Workspace non disponibile.");
  return value;
};
const instant = (value: unknown): string => {
  const result = text(value, 80);
  if (!Number.isFinite(Date.parse(result))) throw new Error("Workspace non disponibile.");
  return result;
};

/** Caller checks getUser and current membership before entering. Every query uses that session under RLS. */
export async function loadTeamWorkspace(supabase: SupabaseClient): Promise<TeamSnapshot> {
  const read = (table: string, columns: string, idColumn = "id", activeOnly = false) => readTeamPages((after, limit) => {
    let query = supabase.from(table).select(columns, { count: "exact" }).order(idColumn).limit(limit);
    if (activeOnly) query = query.eq("active", true);
    if (after !== null) query = query.gt(idColumn, after);
    return query;
  }, idColumn);
  const [eventRows, taskRows, noteRows, profileRows, membershipRows] = await Promise.all([
    read("calendar_events", "id,title,description,starts_at,ends_at,event_type,created_by"),
    read("tasks", "id,title,description,status,due_at,assigned_to,created_by"),
    read("notes", "id,title,body,task_id,created_at,created_by"),
    read("profiles", "user_id,display_name", "user_id"),
    read("memberships", "user_id,active", "user_id", true),
  ]);
  const activeIds = new Set(membershipRows.map(value => id(object(value).user_id)));
  const members = profileRows.map(value => { const row = object(value); return { id: id(row.user_id), name: text(row.display_name, 120), active: activeIds.has(id(row.user_id)) }; });
  if (new Set(members.map(member => member.id)).size !== members.length || [...activeIds].some(value => !members.some(member => member.id === value))) throw new Error("Team non disponibile.");
  const events = eventRows.map(value => {
    const row = object(value);
    if (!EVENT_TYPES.includes(row.event_type as EventType)) throw new Error("Calendario non disponibile.");
    const startsAt = instant(row.starts_at), endsAt = instant(row.ends_at);
    if (Date.parse(endsAt) < Date.parse(startsAt)) throw new Error("Calendario non disponibile.");
    return { id: id(row.id), title: text(row.title, 240), startsAt, endsAt, eventType: row.event_type as EventType, details: decodeEventDetails(text(row.description)), createdBy: id(row.created_by) };
  });
  const tasks = taskRows.map(value => {
    const row = object(value);
    if (!TASK_STATUSES.includes(row.status as TaskStatus)) throw new Error("Attività non disponibili.");
    return { id: id(row.id), title: text(row.title, 240), description: text(row.description), status: row.status as TaskStatus, dueAt: row.due_at === null ? null : instant(row.due_at), assignedTo: row.assigned_to === null ? null : id(row.assigned_to), createdBy: id(row.created_by) };
  });
  const notes = noteRows.map(value => { const row = object(value); return { id: id(row.id), title: text(row.title, 240), body: text(row.body), taskId: row.task_id === null ? null : id(row.task_id), createdAt: instant(row.created_at), createdBy: id(row.created_by) }; });
  for (const collection of [events, tasks, notes]) if (new Set(collection.map(row => row.id)).size !== collection.length) throw new Error("Lettura non completa. Ricarica la pagina.");
  events.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
  tasks.sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") || a.id.localeCompare(b.id));
  notes.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  members.sort((a, b) => a.name.localeCompare(b.name, "it"));
  return { events, tasks, notes, members };
}
