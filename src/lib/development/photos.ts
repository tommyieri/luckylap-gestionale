import { isTeamId } from "../team/model";
import {
  AssetInputError,
  MAX_ASSET_BYTES,
  parseStoredFileDescriptor,
  safeStoragePath,
  type UploadDescriptor,
} from "../assets/model";

/*
 * Foto dei progetti di Nuovi prodotti (docs/assets-development.md, «Foto dei nuovi prodotti»).
 * Ogni foto è un contenuto privato del bucket brand-assets, collegato al progetto da
 * public.product_development_photos. Stessi limiti della libreria: 25 MB per file.
 */
export const PHOTOS_PER_PROJECT = 60;
export const PHOTOS_PER_SEND = 10;
export const PHOTO_ACCEPT = "image/*";

const PHOTO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};
/** Tipi che alcuni browser danno ai file HEIC, oltre a quello «giusto». */
const HEIC_ALIASES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export type DevelopmentPhoto = {
  /** ID del contenuto in public.assets (anche l'operazione del caricamento). */
  id: string;
  projectId: string;
  position: number;
  originalName: string;
  contentType: string;
  size: number;
  createdAt: string;
  createdBy: string | null;
  /** Solo anteprima locale: immagine sintetica in public/, mai la route privata. */
  previewSrc?: string;
};

/** Un file pronto da caricare: l'operazione del caricamento è anche l'ID del contenuto. */
export type PhotoDescriptor = UploadDescriptor;

/** Un caricamento firmato: un solo percorso, senza sovrascrittura. Il token non si conserva. */
export type PreparedPhotoUpload = {
  assetId: string;
  path: string;
  token: string;
  contentType: string;
};

/** Un invio di foto da confermare: si ripete uguale, con lo stesso operation ID. */
export type PhotoSend = { operationId: string; projectId: string; photos: PhotoDescriptor[] };

export function isHeicPhoto(mime: string): boolean {
  return mime === "image/heic" || mime === "image/heif";
}

/** Estensione del nome, in minuscolo. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Il problema di un file scelto, in italiano, oppure null se si può caricare. Il tipo arriva
 * dall'estensione; quello dichiarato dal browser deve essere coerente (vuoto va bene: molti
 * browser non riconoscono HEIC).
 */
export function photoFileProblem(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  const label = `«${file.name || "senza nome"}»`;
  const expected = PHOTO_MIME[extensionOf(file.name)];
  const declared = file.type.toLowerCase();
  if (
    !expected ||
    (declared !== "" &&
      declared !== expected &&
      !(isHeicPhoto(expected) && HEIC_ALIASES.has(declared)) &&
      !(expected === "image/jpeg" && declared === "image/jpg"))
  )
    return `${label} non è una foto in un formato accettato: usa JPEG, PNG, WebP o HEIC.`;
  if (file.size < 1) return `${label} è vuoto: scegli di nuovo la foto.`;
  if (file.size > MAX_ASSET_BYTES)
    return `${label} supera 25 MB: scegli una foto più leggera o riducila prima di caricarla.`;
  if (file.name.length > 240 || /[\u0000-\u001f\u007f/\\]/.test(file.name))
    return `${label} ha un nome che non si può salvare: rinominalo e riprova.`;
  return null;
}

/** Il tipo da salvare: sempre quello dell'estensione, anche se il browser ne dichiara un altro. */
export function photoMime(name: string): string {
  const mime = PHOTO_MIME[extensionOf(name)];
  if (!mime) throw new AssetInputError("Usa JPEG, PNG, WebP o HEIC.");
  return mime;
}

/** Descrittore di una foto: solo i tipi di PHOTO_MIME, fino a 25 MB, hash SHA-256. */
export function parsePhotoDescriptor(value: unknown): PhotoDescriptor {
  const row = value as Partial<PhotoDescriptor> | null;
  if (!row || typeof row !== "object" || typeof row.originalName !== "string")
    throw new AssetInputError("La foto non è valida.");
  const mime = PHOTO_MIME[extensionOf(row.originalName)];
  if (!mime || row.mime !== mime) throw new AssetInputError("Usa JPEG, PNG, WebP o HEIC.");
  const parsed = parseStoredFileDescriptor(row);
  return { ...parsed, operationId: parsed.operationId.toLowerCase() };
}

/** `utente/operazione/nome-sicuro.estensione`, come i caricamenti della libreria. */
export function photoStoragePath(userId: string, descriptor: PhotoDescriptor): string {
  if (!isTeamId(userId)) throw new AssetInputError("Account non valido.");
  return safeStoragePath(userId, parsePhotoDescriptor(descriptor), "foto");
}

/** Il bucket accetta HEIC solo come application/octet-stream, come gli SVG. */
export function photoUploadContentType(mime: string): string {
  return isHeicPhoto(mime) ? "application/octet-stream" : mime;
}

/** Indirizzo dell'immagine: la route privata, oppure l'immagine sintetica dell'anteprima. */
export function photoFileUrl(photo: DevelopmentPhoto, preview = true): string {
  if (photo.previewSrc) return photo.previewSrc;
  return `/assets/files/${photo.id}${preview ? "?preview=1" : ""}`;
}

export function parsePhotoSend(value: unknown): PhotoSend {
  const row = value as Partial<PhotoSend> | null;
  if (
    !row ||
    typeof row !== "object" ||
    !isTeamId(row.operationId) ||
    !isTeamId(row.projectId) ||
    !Array.isArray(row.photos) ||
    row.photos.length < 1 ||
    row.photos.length > PHOTOS_PER_SEND
  )
    throw new AssetInputError("Invio non valido. Ricarica la pagina e riprova.");
  const photos = row.photos.map(parsePhotoDescriptor);
  if (new Set(photos.map((photo) => photo.operationId)).size !== photos.length)
    throw new AssetInputError("Invio non valido. Ricarica la pagina e riprova.");
  return {
    operationId: row.operationId.toLowerCase(),
    projectId: row.projectId.toLowerCase(),
    photos,
  };
}

/** Il payload di add_development_photos (schema_version 1) per l'utente che invia. */
export function addPhotosPayload(send: PhotoSend, userId: string) {
  return {
    schema_version: 1,
    project_id: send.projectId,
    photos: send.photos.map((photo) => ({
      asset_id: photo.operationId,
      storage_path: photoStoragePath(userId, photo),
      original_file_name: photo.originalName,
      content_type: photo.mime,
      file_size_bytes: photo.size,
      sha256: photo.sha256,
    })),
  };
}

export type PhotoRemoveInput = { operationId: string; projectId: string; assetId: string };
export type PhotoMoveInput = PhotoRemoveInput & { position: number };

export function parsePhotoRemove(value: unknown): PhotoRemoveInput {
  const row = value as Partial<PhotoRemoveInput> | null;
  if (
    !row ||
    typeof row !== "object" ||
    !isTeamId(row.operationId) ||
    !isTeamId(row.projectId) ||
    !isTeamId(row.assetId)
  )
    throw new AssetInputError("Ricarica la pagina e riprova.");
  return {
    operationId: row.operationId.toLowerCase(),
    projectId: row.projectId.toLowerCase(),
    assetId: row.assetId.toLowerCase(),
  };
}

export function parsePhotoMove(value: unknown): PhotoMoveInput {
  const base = parsePhotoRemove(value);
  const position = (value as Partial<PhotoMoveInput>).position;
  if (
    !Number.isSafeInteger(position) ||
    (position as number) < 1 ||
    (position as number) > PHOTOS_PER_PROJECT
  )
    throw new AssetInputError("Ricarica la pagina e riprova.");
  return { ...base, position: position as number };
}

/** Esito di un invio di foto, per l'interfaccia. */
export type PhotoSendResult = {
  success?: string;
  error?: string;
  assetIds?: string[];
  /** File rifiutati alla verifica dei byte: non entrano, gli altri si possono reinviare. */
  invalid?: string[];
  /** Esito non chiaro: «Verifica lo stesso invio» ripete lo stesso invio. */
  retry?: boolean;
  /** Il tentativo non potrà riuscire (ID già usato con altri dati): si può solo scartare. */
  blocked?: boolean;
};
export type PhotoCommandResult = { success?: string; error?: string; retry?: boolean };

/** «12,4 MB», «850 KB». */
export function photoSize(bytes: number): string {
  if (bytes >= 1024 * 1024)
    return `${(bytes / 1024 / 1024).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("it-IT")} KB`;
}

/** «1 foto», «3 foto». */
export function photoCount(n: number): string {
  return `${n} foto`;
}

/** Indice dopo un passo avanti o indietro, in giro: dall'ultima si torna alla prima. */
export function stepPhoto(index: number, delta: number, length: number): number {
  if (length < 1) return 0;
  return (((index + delta) % length) + length) % length;
}
