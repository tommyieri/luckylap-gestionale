import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTeamId, type TeamMember } from "../team/model";
import { readTeamPages } from "../team/read";
import { DEVELOPMENT_STAGES, type DevelopmentProject } from "./model";
import { parseStoredFileDescriptor } from "../assets/model";
import type { DevelopmentPhoto } from "./photos";

/** Una riga di product_development_photos con il suo contenuto; null se il contenuto è archiviato. */
export function developmentPhotoFromDatabase(value: unknown): DevelopmentPhoto | null {
  const row = value as Record<string, unknown> | null;
  const asset = row?.asset as Record<string, unknown> | null | undefined;
  if (
    !row ||
    !isTeamId(row.id) ||
    !isTeamId(row.project_id) ||
    !isTeamId(row.asset_id) ||
    !Number.isSafeInteger(Number(row.position)) ||
    Number(row.position) < 1 ||
    typeof row.created_at !== "string" ||
    !Number.isFinite(Date.parse(row.created_at)) ||
    (row.created_by !== null && !isTeamId(row.created_by)) ||
    !asset ||
    typeof asset !== "object" ||
    (asset.archived_at !== null && typeof asset.archived_at !== "string")
  )
    throw new Error("Foto non disponibili.");
  // Un collegamento non punta mai a un contenuto archiviato (guardia nel database): se succede, la
  // foto non si mostra.
  if (asset.archived_at !== null) return null;
  const file = parseStoredFileDescriptor({
    operationId: row.asset_id,
    originalName: asset.original_file_name,
    mime: asset.content_type,
    size: Number(asset.file_size_bytes),
    sha256: "0".repeat(64),
  });
  return {
    id: row.asset_id,
    projectId: row.project_id,
    position: Number(row.position),
    originalName: file.originalName,
    contentType: file.mime,
    size: file.size,
    createdAt: row.created_at,
    createdBy: (row.created_by as string | null) ?? null,
  };
}

export async function loadDevelopment(
  supabase: SupabaseClient,
): Promise<{ projects: DevelopmentProject[]; members: TeamMember[]; photos: DevelopmentPhoto[] }> {
  const read = (table: string, columns: string, key = "id") =>
    readTeamPages((after, limit) => {
      let query = supabase.from(table).select(columns, { count: "exact" }).order(key).limit(limit);
      if (after) query = query.gt(key, after);
      return query;
    }, key);
  const [rows, profiles, memberships, photoRows] = await Promise.all([
    read(
      "product_development_projects",
      "id,name,brief,stage,target_date,owner_id,version,updated_at",
    ),
    read("profiles", "user_id,display_name", "user_id"),
    read("memberships", "user_id,active", "user_id"),
    read(
      "product_development_photos",
      "id,project_id,asset_id,position,created_at,created_by,asset:assets(original_file_name,content_type,file_size_bytes,archived_at)",
    ),
  ]);
  const activeIds = new Set(
    memberships
      .filter((value) => (value as Record<string, unknown>)?.active === true)
      .map((value) => (value as Record<string, unknown>).user_id),
  );
  const members = profiles.map((value) => {
    const row = value as Record<string, unknown>;
    if (
      !isTeamId(row.user_id) ||
      typeof row.display_name !== "string" ||
      !row.display_name ||
      row.display_name.length > 120
    )
      throw new Error("Team non disponibile.");
    return { id: row.user_id, name: row.display_name, active: activeIds.has(row.user_id) };
  });
  const projects = rows.map((value) => {
    const row = value as Record<string, unknown>;
    if (
      !isTeamId(row.id) ||
      typeof row.name !== "string" ||
      !row.name ||
      row.name.length > 240 ||
      typeof row.brief !== "string" ||
      row.brief.length > 8000 ||
      !DEVELOPMENT_STAGES.includes(row.stage as never) ||
      (row.target_date !== null &&
        (typeof row.target_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.target_date))) ||
      (row.owner_id !== null && !isTeamId(row.owner_id)) ||
      !Number.isSafeInteger(Number(row.version)) ||
      Number(row.version) < 1 ||
      typeof row.updated_at !== "string" ||
      !Number.isFinite(Date.parse(row.updated_at))
    )
      throw new Error("Schede prodotto non disponibili.");
    return {
      id: row.id,
      name: row.name,
      brief: row.brief,
      stage: row.stage as DevelopmentProject["stage"],
      targetDate: row.target_date as string | null,
      ownerId: row.owner_id as string | null,
      version: Number(row.version),
      updatedAt: row.updated_at,
    };
  });
  projects.sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id),
  );
  const photos = photoRows
    .map(developmentPhotoFromDatabase)
    .filter((photo): photo is DevelopmentPhoto => photo !== null)
    .sort(
      (a, b) =>
        a.projectId.localeCompare(b.projectId) ||
        a.position - b.position ||
        a.id.localeCompare(b.id),
    );
  return { projects, members, photos };
}
