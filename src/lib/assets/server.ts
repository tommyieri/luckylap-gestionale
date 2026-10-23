import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTeamId } from "../team/model";
import { readTeamPages } from "../team/read";
import { ASSET_TYPES, type BrandAsset } from "./model";

export const ASSET_COLUMNS =
  "id,name,asset_type,description,external_url,storage_path,original_file_name,content_type,file_size_bytes,sha256,created_at,archived_at,source_kind:source->>kind";
export function brandAssetFromDatabase(value: unknown): BrandAsset {
  const row = value as Record<string, unknown> | null;
  if (
    !row ||
    !isTeamId(row.id) ||
    typeof row.name !== "string" ||
    !row.name ||
    row.name.length > 240 ||
    !ASSET_TYPES.includes(row.asset_type as never) ||
    typeof row.description !== "string" ||
    row.description.length > 50000 ||
    typeof row.created_at !== "string" ||
    !Number.isFinite(Date.parse(row.created_at)) ||
    (row.archived_at !== null &&
      (typeof row.archived_at !== "string" || !Number.isFinite(Date.parse(row.archived_at))))
  )
    throw new Error("Libreria non disponibile.");
  for (const name of [
    "external_url",
    "storage_path",
    "original_file_name",
    "content_type",
    "source_kind",
  ])
    if (row[name] !== null && typeof row[name] !== "string")
      throw new Error("Libreria non disponibile.");
  if (
    row.file_size_bytes !== null &&
    (!Number.isSafeInteger(Number(row.file_size_bytes)) || Number(row.file_size_bytes) < 1)
  )
    throw new Error("Libreria non disponibile.");
  return {
    id: row.id,
    name: row.name,
    assetType: row.asset_type as BrandAsset["assetType"],
    description: row.description,
    externalUrl: row.external_url as string | null,
    storagePath: row.storage_path as string | null,
    originalName: row.original_file_name as string | null,
    contentType: row.content_type as string | null,
    size: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
    createdAt: row.created_at,
    archivedAt: row.archived_at as string | null,
    // Foto di un progetto di Nuovi prodotti: la riconosce il segno messo da add_development_photos.
    ...(row.source_kind === "development_photo" ? { developmentPhoto: true } : {}),
  };
}
export async function loadBrandAssets(supabase: SupabaseClient): Promise<BrandAsset[]> {
  const rows = await readTeamPages((after, limit) => {
    let query = supabase
      .from("assets")
      .select(ASSET_COLUMNS, { count: "exact" })
      .order("id")
      .limit(limit);
    if (after) query = query.gt("id", after);
    return query;
  });
  return rows
    .map(brandAssetFromDatabase)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
}
