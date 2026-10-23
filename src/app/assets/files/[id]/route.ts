import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { verifiedMember } from "../../../../lib/auth/server";
import { isTeamId } from "../../../../lib/team/model";
import {
  ASSET_BUCKET,
  MAX_ASSET_BYTES,
  isBrandStoragePath,
  parseStoredFileDescriptor,
} from "../../../../lib/assets/model";
import { verifyAssetBytes } from "../../../../lib/assets/file-validation";

export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isTeamId(id)) return new Response("Contenuto non disponibile.", { status: 404, headers });
    const supabase = await createSupabaseServerClient();
    const access = await verifiedMember(supabase);
    if (access.status !== "member")
      return new Response("Accesso al team richiesto.", { status: 401, headers });
    const asset = await supabase
      .from("assets")
      .select("id,storage_path,original_file_name,content_type,file_size_bytes,sha256")
      .eq("id", id)
      .maybeSingle();
    if (asset.error || !isBrandStoragePath(asset.data?.storage_path))
      return new Response("Contenuto non disponibile.", { status: 404, headers });
    const row = asset.data;
    // Anche le foto HEIC dei progetti di Nuovi prodotti, che stanno nello stesso bucket.
    const descriptor = parseStoredFileDescriptor({
      operationId: row.id,
      originalName: row.original_file_name,
      mime: row.content_type,
      size: Number(row.file_size_bytes),
      sha256: row.sha256,
    });
    const file = await supabase.storage.from(ASSET_BUCKET).download(row.storage_path);
    if (file.error || !file.data || file.data.size > MAX_ASSET_BYTES)
      return new Response("File non disponibile.", { status: 404, headers });
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    verifyAssetBytes(bytes, descriptor);
    // Every read revalidates bytes: even a direct forged metadata RPC cannot
    // turn an executable document into an inline image/video response.
    const inline =
      new URL(request.url).searchParams.get("preview") === "1" &&
      descriptor.mime !== "image/svg+xml";
    if (descriptor.mime === "image/svg+xml" && file.data.type !== "application/octet-stream")
      return new Response("Il formato di archiviazione SVG richiede una verifica amministrativa.", {
        status: 503,
        headers,
      });
    // HEIC/HEIF entrano nel bucket come application/octet-stream (il bucket non elenca image/heic):
    // in anteprima il browser prova a decodificarle, altrimenti la pagina mostra il nome del file.
    if (
      (descriptor.mime === "image/heic" || descriptor.mime === "image/heif") &&
      file.data.type !== "application/octet-stream"
    )
      return new Response(
        "Il formato di archiviazione HEIC richiede una verifica amministrativa.",
        {
          status: 503,
          headers,
        },
      );
    // Vercel also limits response bodies. Keep the response small: after byte
    // verification the immutable object is served directly by private Storage.
    const signed = await supabase.storage
      .from(ASSET_BUCKET)
      .createSignedUrl(row.storage_path, 60, inline ? {} : { download: descriptor.originalName });
    if (signed.error || !signed.data?.signedUrl)
      return new Response("Download temporaneamente non disponibile.", { status: 503, headers });
    return new Response(null, {
      status: 303,
      headers: { ...headers, Location: signed.data.signedUrl },
    });
  } catch {
    return new Response("Il contenuto non è disponibile o non supera la verifica del formato.", {
      status: 503,
      headers,
    });
  }
}
