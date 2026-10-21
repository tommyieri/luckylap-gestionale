"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { verifiedMember } from "../../lib/auth/server";
import { isTeamId } from "../../lib/team/model";
import {
  ASSET_BUCKET,
  AssetInputError,
  assetStoragePath,
  parseAssetFields,
  parseBrandLink,
  parseUploadDescriptor,
  uploadContentType,
  type AssetFields,
  type AssetResult,
  type UploadDescriptor,
} from "../../lib/assets/model";
import { verifyAssetBytes } from "../../lib/assets/file-validation";

async function access() {
  const supabase = await createSupabaseServerClient({ writable: true });
  const result = await verifiedMember(supabase);
  if (result.status !== "member")
    throw new AssetInputError("Accedi di nuovo con un account abilitato al team.");
  return { supabase, member: result.member };
}
const failure = (error: unknown, stored = false): AssetResult => ({
  error:
    error instanceof AssetInputError
      ? error.message
      : stored
        ? "Il file può essere già caricato nel contenitore privato, ma la voce non è confermata. Usa Verifica e completa prima di inviarlo di nuovo."
        : "Operazione non confermata. Aggiorna la libreria prima di riprovare.",
});

export async function prepareBrandUpload(
  input: UploadDescriptor,
): Promise<{ error?: string; upload?: { path: string; token: string; contentType: string } }> {
  try {
    const { supabase, member } = await access();
    const file = parseUploadDescriptor(input);
    const path = assetStoragePath(member.userId, file);
    const { data, error } = await supabase.storage
      .from(ASSET_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    if (error || !data?.token || data.path !== path) throw new Error("Firma non disponibile.");
    return { upload: { path, token: data.token, contentType: uploadContentType(file) } };
  } catch (error) {
    return failure(error);
  }
}

function assertRegistration(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "23505")
    throw new AssetInputError(
      "Questa voce è già stata salvata con dati diversi. Aggiorna la libreria prima di riprovare.",
    );
  if (error.code === "42501")
    throw new AssetInputError("I permessi del tuo account sono cambiati. Accedi di nuovo.");
  if (error.code === "22023")
    throw new AssetInputError(
      "I dati del contenuto non sono validi o il caricamento non è ancora disponibile. Verifica il file e riprova.",
    );
  throw new Error("Registrazione non confermata.");
}

export async function finalizeBrandUpload(input: {
  descriptor: UploadDescriptor;
  fields: AssetFields;
}): Promise<AssetResult> {
  try {
    const { supabase, member } = await access();
    const file = parseUploadDescriptor(input?.descriptor),
      fields = parseAssetFields(input?.fields);
    const path = assetStoragePath(member.userId, file);
    const download = await supabase.storage.from(ASSET_BUCKET).download(path);
    if (download.error || !download.data)
      throw new AssetInputError(
        "Il file non è ancora disponibile. Se il trasferimento è terminato, usa Verifica e completa tra poco.",
      );
    if (download.data.size !== file.size)
      throw new AssetInputError(
        "La dimensione del file caricato è diversa da quella selezionata. Il file resta privato e non è stato aggiunto alla libreria.",
      );
    verifyAssetBytes(new Uint8Array(await download.data.arrayBuffer()), file);
    const registered = await supabase.rpc("register_brand_asset", {
      p_operation_id: file.operationId,
      p_name: fields.name,
      p_asset_type: fields.assetType,
      p_description: fields.description,
      p_external_url: null,
      p_storage_path: path,
      p_original_file_name: file.originalName,
      p_content_type: file.mime,
      p_file_size_bytes: file.size,
      p_sha256: file.sha256,
    });
    assertRegistration(registered.error);
    if (!isTeamId(registered.data)) throw new Error("Registrazione non confermata.");
    revalidatePath("/assets");
    return { id: registered.data, success: "Contenuto aggiunto alla libreria del team." };
  } catch (error) {
    return failure(error, true);
  }
}

export async function registerBrandLink(input: {
  operationId: string;
  fields: AssetFields;
  url: string;
}): Promise<AssetResult> {
  try {
    const { supabase } = await access();
    if (!isTeamId(input?.operationId))
      throw new AssetInputError("Ricarica la pagina per aggiungere il collegamento.");
    const fields = parseAssetFields(input.fields),
      url = parseBrandLink(input.url);
    const registered = await supabase.rpc("register_brand_asset", {
      p_operation_id: input.operationId,
      p_name: fields.name,
      p_asset_type: fields.assetType,
      p_description: fields.description,
      p_external_url: url,
      p_storage_path: null,
      p_original_file_name: null,
      p_content_type: null,
      p_file_size_bytes: null,
      p_sha256: null,
    });
    assertRegistration(registered.error);
    if (!isTeamId(registered.data)) throw new Error("Registrazione non confermata.");
    revalidatePath("/assets");
    return { id: registered.data, success: "Collegamento aggiunto alla libreria del team." };
  } catch (error) {
    return failure(error);
  }
}
