"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { verifiedMember } from "../../lib/auth/server";
import { isTeamId } from "../../lib/team/model";
import { ASSET_BUCKET, AssetInputError } from "../../lib/assets/model";
import { verifyAssetBytes } from "../../lib/assets/file-validation";
import {
  PHOTOS_PER_SEND,
  addPhotosPayload,
  parsePhotoDescriptor,
  parsePhotoMove,
  parsePhotoRemove,
  parsePhotoSend,
  photoStoragePath,
  photoUploadContentType,
  type PhotoCommandResult,
  type PhotoDescriptor,
  type PhotoMoveInput,
  type PreparedPhotoUpload,
  type PhotoRemoveInput,
  type PhotoSend,
  type PhotoSendResult,
} from "../../lib/development/photos";

/*
 * Foto dei progetti di Nuovi prodotti (docs/assets-development.md, «Foto dei nuovi prodotti»).
 * Stesso percorso dei caricamenti della libreria: firma di un upload per file, byte direttamente
 * a Storage, poi verifica dei byte e registrazione con add_development_photos. Il database
 * ricontrolla membership, percorso, oggetto e ricevuta.
 */

async function access() {
  const supabase = await createSupabaseServerClient({ writable: true });
  const result = await verifiedMember(supabase);
  if (result.status !== "member")
    throw new AssetInputError("Accedi di nuovo con un account abilitato al team.");
  return { supabase, member: result.member };
}

/** Firma un caricamento per ogni foto: un percorso, nessuna sovrascrittura. */
export async function prepareDevelopmentPhotoUploads(input: {
  projectId: string;
  photos: PhotoDescriptor[];
}): Promise<{ error?: string; uploads?: PreparedPhotoUpload[] }> {
  try {
    if (
      !isTeamId(input?.projectId) ||
      !Array.isArray(input.photos) ||
      input.photos.length < 1 ||
      input.photos.length > PHOTOS_PER_SEND
    )
      throw new AssetInputError(`Scegli da 1 a ${PHOTOS_PER_SEND} foto alla volta.`);
    const photos = input.photos.map(parsePhotoDescriptor);
    const { supabase, member } = await access();
    const uploads: PreparedPhotoUpload[] = [];
    for (const photo of photos) {
      const path = photoStoragePath(member.userId, photo);
      const { data, error } = await supabase.storage
        .from(ASSET_BUCKET)
        .createSignedUploadUrl(path, { upsert: false });
      if (error || !data?.token || data.path !== path) throw new Error("Firma non disponibile.");
      uploads.push({
        assetId: photo.operationId,
        path,
        token: data.token,
        contentType: photoUploadContentType(photo.mime),
      });
    }
    return { uploads };
  } catch (error) {
    return {
      error:
        error instanceof AssetInputError
          ? error.message
          : "Caricamento non disponibile in questo momento. Nessuna foto è stata aggiunta: riprova tra poco.",
    };
  }
}

const UNCERTAIN =
  "Le foto possono essere già nel progetto, ma l’aggiunta non è confermata. Usa «Verifica lo stesso invio» prima di sceglierle di nuovo.";

/**
 * Verifica i byte di ogni foto caricata e la registra nel progetto, tutte in un invio. Se una foto
 * non supera la verifica non si registra niente e la risposta elenca le foto da togliere: il resto
 * si reinvia con un operation ID nuovo (nessun comando è partito). Dopo una risposta incerta del
 * database si ripete lo stesso invio, con lo stesso ID.
 */
export async function finalizeDevelopmentPhotos(input: PhotoSend): Promise<PhotoSendResult> {
  let send: PhotoSend;
  try {
    send = parsePhotoSend(input);
  } catch (error) {
    return {
      error: error instanceof AssetInputError ? error.message : "Invio non valido.",
      blocked: true,
    };
  }
  try {
    const { supabase, member } = await access();
    const invalid: string[] = [];
    for (const photo of send.photos) {
      const path = photoStoragePath(member.userId, photo);
      const download = await supabase.storage.from(ASSET_BUCKET).download(path);
      if (download.error || !download.data)
        return {
          error:
            "Una foto non è ancora disponibile nell’archivio. Se il caricamento è finito, usa «Verifica lo stesso invio» tra poco.",
          retry: true,
        };
      try {
        if (download.data.size !== photo.size) throw new AssetInputError("Dimensione diversa.");
        verifyAssetBytes(new Uint8Array(await download.data.arrayBuffer()), photo);
      } catch (error) {
        if (!(error instanceof AssetInputError)) throw error;
        invalid.push(photo.operationId);
      }
    }
    if (invalid.length)
      return {
        error:
          invalid.length === 1
            ? "Una foto non corrisponde al file scelto o non è un’immagine valida: non è stata aggiunta."
            : `${invalid.length} foto non corrispondono ai file scelti o non sono immagini valide: non sono state aggiunte.`,
        invalid,
      };
    const { data, error } = await supabase.rpc("add_development_photos", {
      p_operation_id: send.operationId,
      p_payload: addPhotosPayload(send, member.userId),
    });
    if (error) {
      if (error.code === "42501")
        return { error: "I permessi del tuo account sono cambiati. Accedi di nuovo." };
      if (error.code === "23505")
        return {
          error:
            "Questo invio è già stato usato con altri dati. Controlla le foto del progetto, poi scarta il tentativo.",
          blocked: true,
        };
      if (error.code === "22023") {
        if (error.message === "development_project_not_found")
          return { error: "Il progetto non c’è più. Ricarica la pagina." };
        if (error.message === "development_photo_limit")
          return {
            error:
              "Con queste foto il progetto supererebbe le 60 foto, il massimo: togline qualcuna prima di aggiungerne altre.",
          };
        if (error.message === "development_photo_upload_missing")
          return {
            error: "Una foto non risulta ancora caricata. Usa «Verifica lo stesso invio» tra poco.",
            retry: true,
          };
        return { error: "I dati delle foto non sono validi. Scegli di nuovo le foto." };
      }
      return { error: UNCERTAIN, retry: true };
    }
    const result = data as Record<string, unknown> | null;
    const ids = Array.isArray(result?.asset_ids) ? result.asset_ids : null;
    if (
      !result ||
      result.operation_id !== send.operationId ||
      result.project_id !== send.projectId ||
      !ids ||
      ids.length !== send.photos.length ||
      ids.some((value, index) => value !== send.photos[index].operationId)
    )
      return { error: UNCERTAIN, retry: true };
    revalidatePath("/development");
    return {
      assetIds: ids as string[],
      success:
        ids.length === 1
          ? "Foto aggiunta al progetto."
          : `${ids.length} foto aggiunte al progetto.`,
    };
  } catch (error) {
    if (error instanceof AssetInputError) return { error: error.message };
    return { error: UNCERTAIN, retry: true };
  }
}

function commandError(code: string | undefined, message: string | undefined, fallback: string) {
  if (code === "42501")
    return { error: "I permessi del tuo account sono cambiati. Accedi di nuovo." };
  if (code === "22023" && message === "development_photo_not_found")
    return {
      error: "La foto non è più nel progetto: ricarica la pagina per vedere le foto di adesso.",
    };
  if (code === "22023" && message === "development_project_not_found")
    return { error: "Il progetto non c’è più. Ricarica la pagina." };
  if (code === "23505")
    return { error: "Questo invio è già stato usato. Ricarica la pagina e riprova." };
  return { error: fallback, retry: true };
}

/** Toglie una foto dal progetto: il contenuto si archivia, il file resta nell'archivio privato. */
export async function removeDevelopmentPhoto(input: PhotoRemoveInput): Promise<PhotoCommandResult> {
  const fallback =
    "Rimozione non confermata. «Verifica lo stesso invio» la ripete senza togliere altre foto.";
  try {
    const command = parsePhotoRemove(input);
    const { supabase } = await access();
    const { data, error } = await supabase.rpc("remove_development_photo", {
      p_operation_id: command.operationId,
      p_payload: { schema_version: 1, project_id: command.projectId, asset_id: command.assetId },
    });
    if (error) return commandError(error.code, error.message, fallback);
    const result = data as Record<string, unknown> | null;
    if (!result || result.asset_id !== command.assetId || result.removed !== true)
      return { error: fallback, retry: true };
    revalidatePath("/development");
    return { success: "Foto tolta dal progetto." };
  } catch (error) {
    if (error instanceof AssetInputError) return { error: error.message };
    return { error: fallback, retry: true };
  }
}

/** Sposta una foto al posto indicato (1 = prima). */
export async function moveDevelopmentPhoto(input: PhotoMoveInput): Promise<PhotoCommandResult> {
  const fallback = "Spostamento non confermato. Riprova: lo stesso invio non sposta due volte.";
  try {
    const command = parsePhotoMove(input);
    const { supabase } = await access();
    const { data, error } = await supabase.rpc("move_development_photo", {
      p_operation_id: command.operationId,
      p_payload: {
        schema_version: 1,
        project_id: command.projectId,
        asset_id: command.assetId,
        position: command.position,
      },
    });
    if (error) return commandError(error.code, error.message, fallback);
    const result = data as Record<string, unknown> | null;
    if (!result || result.asset_id !== command.assetId || typeof result.position !== "number")
      return { error: fallback, retry: true };
    revalidatePath("/development");
    return { success: "Ordine delle foto aggiornato." };
  } catch (error) {
    if (error instanceof AssetInputError) return { error: error.message };
    return { error: fallback, retry: true };
  }
}
