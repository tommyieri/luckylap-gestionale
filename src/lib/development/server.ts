import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTeamId, type TeamMember } from "../team/model";
import { readTeamPages } from "../team/read";
import { DEVELOPMENT_STAGES, type DevelopmentProject } from "./model";

export async function loadDevelopment(supabase: SupabaseClient): Promise<{ projects: DevelopmentProject[]; members: TeamMember[] }> {
  const read = (table: string, columns: string, key = "id") => readTeamPages((after, limit) => {
    let query = supabase.from(table).select(columns, { count: "exact" }).order(key).limit(limit);
    if (after) query = query.gt(key, after);
    return query;
  }, key);
  const [rows, profiles, memberships] = await Promise.all([read("product_development_projects", "id,name,brief,stage,target_date,owner_id,version,updated_at"), read("profiles", "user_id,display_name", "user_id"), read("memberships", "user_id,active", "user_id")]);
  const activeIds = new Set(memberships.filter(value => (value as Record<string, unknown>)?.active === true).map(value => (value as Record<string, unknown>).user_id));
  const members = profiles.map(value => { const row = value as Record<string, unknown>; if (!isTeamId(row.user_id) || typeof row.display_name !== "string" || !row.display_name || row.display_name.length > 120) throw new Error("Team non disponibile."); return { id: row.user_id, name: row.display_name, active: activeIds.has(row.user_id) }; });
  const projects = rows.map(value => {
    const row = value as Record<string, unknown>;
    if (!isTeamId(row.id) || typeof row.name !== "string" || !row.name || row.name.length > 240 || typeof row.brief !== "string" || row.brief.length > 8000 || !DEVELOPMENT_STAGES.includes(row.stage as never) || (row.target_date !== null && (typeof row.target_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.target_date))) || (row.owner_id !== null && !isTeamId(row.owner_id)) || !Number.isSafeInteger(Number(row.version)) || Number(row.version) < 1 || typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))) throw new Error("Schede prodotto non disponibili.");
    return { id: row.id, name: row.name, brief: row.brief, stage: row.stage as DevelopmentProject["stage"], targetDate: row.target_date as string | null, ownerId: row.owner_id as string | null, version: Number(row.version), updatedAt: row.updated_at };
  });
  projects.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
  return { projects, members };
}
