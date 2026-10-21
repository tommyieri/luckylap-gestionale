import { isTeamId } from "../team/model";

export const ASSET_BUCKET = "brand-assets";
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const ASSET_TYPES = ["logo", "mockup", "photo", "video", "other"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export type UploadDescriptor = { operationId: string; originalName: string; mime: string; size: number; sha256: string };
export type AssetFields = { name: string; assetType: AssetType; description: string };
export type BrandAsset = { id: string; name: string; assetType: AssetType; description: string; externalUrl: string | null; storagePath: string | null; originalName: string | null; contentType: string | null; size: number | null; createdAt: string };
export type AssetResult = { error?: string; success?: string; id?: string };
export class AssetInputError extends Error {}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", webm: "video/webm", svg: "image/svg+xml" };
export const assetTypeLabels: Record<AssetType, string> = { logo: "Loghi", mockup: "Grafiche e mockup", photo: "Foto", video: "Video", other: "Altri contenuti" };
export function isBrandStoragePath(value: unknown): value is string {
  return typeof value === "string" && /^(?:system|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9][a-z0-9._-]{0,119}\.(png|jpg|jpeg|webp|mp4|webm|svg)$/.test(value);
}
export function parseAssetFields(value: unknown): AssetFields {
  const row = value as Partial<AssetFields> | null;
  if (!row || typeof row.name !== "string" || !row.name.trim() || row.name.trim().length > 240 || typeof row.description !== "string" || row.description.length > 8000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(row.name + row.description) || !ASSET_TYPES.includes(row.assetType as AssetType)) throw new AssetInputError("Inserisci un nome, un tipo e una descrizione valida (massimo 8.000 caratteri).");
  return { name: row.name.trim(), assetType: row.assetType as AssetType, description: row.description.trim() };
}
export function parseUploadDescriptor(value: unknown): UploadDescriptor {
  const row = value as Partial<UploadDescriptor> | null;
  if (!row || !isTeamId(row.operationId) || typeof row.originalName !== "string" || row.originalName.length < 1 || row.originalName.length > 240 || /[\u0000-\u001f\u007f/\\]/.test(row.originalName) || typeof row.mime !== "string" || !Number.isSafeInteger(row.size) || !row.size || row.size < 1 || row.size > MAX_ASSET_BYTES || typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new AssetInputError("Il file non è valido o supera il limite di 25 MB.");
  const ext = row.originalName.split(".").pop()?.toLowerCase() ?? "";
  const expected = MIME[ext];
  if (!expected || (row.mime !== "" && row.mime !== expected && !(ext === "svg" && row.mime === "application/octet-stream"))) throw new AssetInputError("Usa PNG, JPEG, WebP, MP4, WebM o SVG con estensione e tipo coerenti.");
  return { operationId: row.operationId, originalName: row.originalName, mime: expected, size: row.size, sha256: row.sha256 };
}
export function assetStoragePath(userId: string, descriptor: UploadDescriptor): string {
  if (!isTeamId(userId)) throw new AssetInputError("Account non valido.");
  const parsed = parseUploadDescriptor(descriptor);
  const ext = parsed.originalName.split(".").pop()!.toLowerCase();
  const stem = parsed.originalName.slice(0, -(ext.length + 1)).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 90) || "contenuto";
  return `${userId.toLowerCase()}/${parsed.operationId.toLowerCase()}/${stem}.${ext}`;
}
export function uploadContentType(descriptor: UploadDescriptor): string { return descriptor.mime === "image/svg+xml" ? "application/octet-stream" : descriptor.mime; }
export function parseBrandLink(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) throw new AssetInputError("Inserisci un link HTTPS completo e senza credenziali.");
  let url: URL;
  try { url = new URL(value); } catch { throw new AssetInputError("Inserisci un link HTTPS completo."); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.href.length > 2048) throw new AssetInputError("Il collegamento deve usare HTTPS, senza credenziali nell’indirizzo.");
  return url.href;
}
