import { isTeamId } from "../team/model";

export const ASSET_BUCKET = "brand-assets";
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const ASSET_TYPES = ["logo", "mockup", "photo", "video", "other"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export type UploadDescriptor = {
  operationId: string;
  originalName: string;
  mime: string;
  size: number;
  sha256: string;
};
export type AssetFields = { name: string; assetType: AssetType; description: string };
export type BrandAsset = {
  id: string;
  name: string;
  assetType: AssetType;
  description: string;
  externalUrl: string | null;
  storagePath: string | null;
  originalName: string | null;
  contentType: string | null;
  size: number | null;
  createdAt: string;
  /** Archiviato: fuori dalla libreria per tutti, ripristinabile. Il file resta dov'è. */
  archivedAt: string | null;
  /** Foto di un progetto di Nuovi prodotti: fuori dall'elenco principale, nel filtro «Nuovi prodotti». */
  developmentPhoto?: boolean;
};
export type AssetResult = { error?: string; success?: string; id?: string };
/** Archivia (`archived: true`) o ripristina un contenuto: un invio, un operation_id. */
export type AssetArchiveInput = { operationId: string; assetId: string; archived: boolean };
export type AssetArchiveResult = { error?: string; success?: string; archivedAt?: string | null };
export class AssetInputError extends Error {}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  svg: "image/svg+xml",
};
/** File già archiviati: quelli della libreria più le foto HEIC dei progetti (Nuovi prodotti). */
const STORED_MIME: Record<string, string> = { ...MIME, heic: "image/heic", heif: "image/heif" };
/** Valore del filtro «Tipo» che mostra solo le foto dei progetti di Nuovi prodotti. */
export const DEVELOPMENT_PHOTO_FILTER = "development";
export const assetTypeLabels: Record<AssetType, string> = {
  logo: "Loghi",
  mockup: "Grafiche e mockup",
  photo: "Foto",
  video: "Video",
  other: "Altri contenuti",
};
export function isBrandStoragePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:system|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9][a-z0-9._-]{0,119}\.(png|jpg|jpeg|webp|mp4|webm|svg|heic|heif)$/.test(
      value,
    )
  );
}
export function parseAssetFields(value: unknown): AssetFields {
  const row = value as Partial<AssetFields> | null;
  if (
    !row ||
    typeof row.name !== "string" ||
    !row.name.trim() ||
    row.name.trim().length > 240 ||
    typeof row.description !== "string" ||
    row.description.length > 8000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(row.name + row.description) ||
    !ASSET_TYPES.includes(row.assetType as AssetType)
  )
    throw new AssetInputError(
      "Inserisci un nome, un tipo e una descrizione valida (massimo 8.000 caratteri).",
    );
  return {
    name: row.name.trim(),
    assetType: row.assetType as AssetType,
    description: row.description.trim(),
  };
}
export function parseUploadDescriptor(value: unknown): UploadDescriptor {
  return parseDescriptor(
    value,
    MIME,
    "Usa PNG, JPEG, WebP, MP4, WebM o SVG con estensione e tipo coerenti.",
  );
}
/**
 * Un file già nel bucket, anche una foto HEIC di un progetto: lo usano la route privata e la
 * verifica dei byte. I caricamenti della libreria passano prima da `parseUploadDescriptor`.
 */
export function parseStoredFileDescriptor(value: unknown): UploadDescriptor {
  return parseDescriptor(value, STORED_MIME, "Il formato del file non è supportato.");
}
function parseDescriptor(
  value: unknown,
  types: Record<string, string>,
  typeError: string,
): UploadDescriptor {
  const row = value as Partial<UploadDescriptor> | null;
  if (
    !row ||
    !isTeamId(row.operationId) ||
    typeof row.originalName !== "string" ||
    row.originalName.length < 1 ||
    row.originalName.length > 240 ||
    /[\u0000-\u001f\u007f/\\]/.test(row.originalName) ||
    typeof row.mime !== "string" ||
    !Number.isSafeInteger(row.size) ||
    !row.size ||
    row.size < 1 ||
    row.size > MAX_ASSET_BYTES ||
    typeof row.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.sha256)
  )
    throw new AssetInputError("Il file non è valido o supera il limite di 25 MB.");
  const ext = row.originalName.split(".").pop()?.toLowerCase() ?? "";
  const expected = types[ext];
  if (
    !expected ||
    (row.mime !== "" &&
      row.mime !== expected &&
      !(ext === "svg" && row.mime === "application/octet-stream"))
  )
    throw new AssetInputError(typeError);
  return {
    operationId: row.operationId,
    originalName: row.originalName,
    mime: expected,
    size: row.size,
    sha256: row.sha256,
  };
}
export function assetStoragePath(userId: string, descriptor: UploadDescriptor): string {
  if (!isTeamId(userId)) throw new AssetInputError("Account non valido.");
  return safeStoragePath(userId, parseUploadDescriptor(descriptor), "contenuto");
}
/** `utente/operazione/nome-sicuro.estensione`, per un descrittore già validato. */
export function safeStoragePath(
  userId: string,
  parsed: UploadDescriptor,
  fallback: string,
): string {
  const ext = parsed.originalName.split(".").pop()!.toLowerCase();
  const stem =
    parsed.originalName
      .slice(0, -(ext.length + 1))
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^[-_]+|[-_]+$/g, "")
      .slice(0, 90) || fallback;
  return `${userId.toLowerCase()}/${parsed.operationId.toLowerCase()}/${stem}.${ext}`;
}
export function uploadContentType(descriptor: UploadDescriptor): string {
  return descriptor.mime === "image/svg+xml" ? "application/octet-stream" : descriptor.mime;
}
export function parseBrandLink(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value))
    throw new AssetInputError("Inserisci un link HTTPS completo e senza credenziali.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AssetInputError("Inserisci un link HTTPS completo.");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.href.length > 2048
  )
    throw new AssetInputError("Il link deve usare HTTPS, senza credenziali nell’indirizzo.");
  return url.href;
}

export function parseAssetArchiveInput(value: unknown): AssetArchiveInput {
  const row = value as Partial<AssetArchiveInput> | null;
  if (
    !row ||
    typeof row !== "object" ||
    !isTeamId(row.operationId) ||
    !isTeamId(row.assetId) ||
    typeof row.archived !== "boolean"
  )
    throw new AssetInputError("Ricarica la pagina e riprova.");
  return { operationId: row.operationId, assetId: row.assetId, archived: row.archived };
}
/**
 * Libreria visibile: i contenuti attivi, oppure solo gli archiviati con «Mostra archiviati».
 * Le foto dei progetti di Nuovi prodotti stanno fuori dall'elenco principale: compaiono solo con
 * il filtro «Nuovi prodotti» (`DEVELOPMENT_PHOTO_FILTER`).
 */
export function visibleBrandAssets(
  assets: BrandAsset[],
  { type, query, archived }: { type: string; query: string; archived: boolean },
): BrandAsset[] {
  const needle = query.trim().toLocaleLowerCase("it");
  const development = type === DEVELOPMENT_PHOTO_FILTER;
  return assets.filter(
    (asset) =>
      (asset.archivedAt !== null) === archived &&
      Boolean(asset.developmentPhoto) === development &&
      (!type || development || asset.assetType === type) &&
      `${asset.name} ${asset.description}`.toLocaleLowerCase("it").includes(needle),
  );
}
