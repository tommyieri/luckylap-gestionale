import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { financeDocumentAccess } from "../../../lib/finance/document-access";
import {
  FINANCE_ATTACHMENT_MAX_BYTES,
  financeAttachmentContentType,
  isAttachmentPdf,
} from "../../../lib/finance/movement-attachments";
import { stockUuid } from "../../../lib/stock/model";
import { isLocalPreviewEnabled } from "../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sourceKinds = new Set([
  "budgetflow",
  "manual",
  "payment",
  "refund",
  "consignment_settlement",
  "shop_payment",
]);
const noStore = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: noStore });
const unavailable = () => reply({ message: "Allegati temporaneamente non disponibili." }, 503);
const restricted = (status: number | undefined) =>
  status ? reply({ message: "Apri Finance per accedere agli allegati." }, status) : unavailable();
const attachmentPath = (id: string, sha256: string) => `movements/${id}/${sha256}`;
const attachmentBucket = (db: SupabaseClient) => db.storage.from("finance-documents");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const maxMultipartBytes = FINANCE_ATTACHMENT_MAX_BYTES + 65536;

async function readUpload(request: Request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maxMultipartBytes);
  let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (received + value.byteLength > bytes.byteLength) return null;
      bytes.set(value, received);
      received += value.byteLength;
    }
    const contentType = request.headers.get("content-type") ?? "";
    return await new Response(bytes.subarray(0, received), {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    return null;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function verifiedDownload(db: SupabaseClient, id: string, sha256: string, length: number) {
  const result = await attachmentBucket(db).download(attachmentPath(id, sha256));
  if (result.error || !result.data || result.data.size !== length) return null;
  const bytes = new Uint8Array(await result.data.arrayBuffer());
  return hash(bytes) === sha256 ? bytes : null;
}

export async function GET(request: Request) {
  if (isLocalPreviewEnabled()) return restricted(403);
  const access = await financeDocumentAccess().catch(() => null);
  if (!access?.allowed) return restricted(access?.status);

  const params = new URL(request.url).searchParams;
  const attachmentId = params.get("id");
  if (attachmentId !== null) {
    if (!stockUuid(attachmentId)) return reply({ message: "Allegato non trovato." }, 404);
    const result = await access.supabase
      .from("finance_movement_attachments")
      .select("file_name,content_type,byte_size,sha256")
      .eq("id", attachmentId)
      .maybeSingle();
    if (result.error) return unavailable();
    if (!result.data) return reply({ message: "Allegato non trovato." }, 404);
    const row = result.data;
    const bytes = await verifiedDownload(access.supabase, attachmentId, row.sha256, row.byte_size);
    if (!bytes || !isAttachmentPdf(bytes) || row.content_type !== financeAttachmentContentType)
      return unavailable();
    const name = encodeURIComponent(row.file_name).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16)}`,
    );
    return new Response(bytes, {
      headers: {
        ...noStore,
        "Content-Type": row.content_type,
        "Content-Length": String(row.byte_size),
        "Content-Disposition": `attachment; filename*=UTF-8''${name}`,
      },
    });
  }

  const source = params.get("source") ?? "";
  const sourceId = params.get("sourceId");
  if (!sourceKinds.has(source) || !stockUuid(sourceId))
    return reply({ message: "Movimento non valido." }, 400);
  const result = await access.supabase
    .from("finance_movement_attachments")
    .select("id,file_name", { count: "exact" })
    .eq("source_kind", source)
    .eq("source_id", sourceId)
    .order("created_at")
    .order("id")
    .limit(25);
  if (result.error || result.data?.length !== result.count) return unavailable();
  return reply({
    attachments: result.data?.map(({ id, file_name }) => ({ id, fileName: file_name })) ?? [],
  });
}

export async function POST(request: Request) {
  if (isLocalPreviewEnabled()) return restricted(403);
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin)
    return reply({ message: "Origine della richiesta non valida." }, 403);
  const length = Number(request.headers.get("content-length"));
  if (
    request.headers.has("content-length") &&
    (!Number.isSafeInteger(length) || length < 1 || length > maxMultipartBytes)
  )
    return reply({ message: "Scegli un file fino a 4 MB." }, 413);

  const access = await financeDocumentAccess().catch(() => null);
  if (!access?.allowed) return restricted(access?.status);
  const data = await readUpload(request);
  const source = data?.get("source");
  const sourceId = data?.get("sourceId");
  const file = data?.get("file");
  if (typeof source !== "string" || !sourceKinds.has(source) || !stockUuid(sourceId))
    return reply({ message: "Movimento non valido." }, 400);
  if (!(file instanceof File) || file.size < 1 || file.size > FINANCE_ATTACHMENT_MAX_BYTES)
    return reply({ message: "Scegli un file fino a 4 MB." }, 400);
  const fileName = file.name.normalize("NFC").trim();
  if (!fileName || fileName.length > 180 || /[\u0000-\u001f\u007f/\\]/u.test(fileName))
    return reply({ message: "Nome file non valido." }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isAttachmentPdf(bytes) || !/\.pdf$/i.test(fileName))
    return reply({ message: "Scegli un file PDF." }, 400);
  const sha256 = hash(bytes);
  const prepared = await access.supabase.rpc("prepare_finance_movement_attachment", {
    p_source_kind: source,
    p_source_id: sourceId,
    p_file_name: fileName,
    p_content_type: financeAttachmentContentType,
    p_byte_size: file.size,
    p_sha256: sha256,
  });
  if (prepared.error?.code === "42501") return restricted(403);
  if (prepared.error?.message === "finance_attachment_limit")
    return reply({ message: "Il movimento ha raggiunto il limite di 25 allegati." }, 409);
  const attachment = prepared.data;
  if (prepared.error || !stockUuid(attachment?.id) || typeof attachment.file_name !== "string")
    return unavailable();
  if (attachment.ready)
    return reply({ attachment: { id: attachment.id, fileName: attachment.file_name } });

  await attachmentBucket(access.supabase).upload(attachmentPath(attachment.id, sha256), bytes, {
    contentType: financeAttachmentContentType,
    upsert: false,
  });
  // Verify the existing bytes after a success, interrupted upload or concurrent retry.
  if (!(await verifiedDownload(access.supabase, attachment.id, sha256, file.size)))
    return reply({ message: "Caricamento da completare. Riprova con lo stesso file." }, 503);
  const finished = await access.supabase.rpc("finish_finance_movement_attachment", {
    p_attachment_id: attachment.id,
  });
  if (finished.error?.code === "42501") return restricted(403);
  if (finished.error || finished.data !== true) return unavailable();
  return reply({ attachment: { id: attachment.id, fileName: attachment.file_name } }, 201);
}
