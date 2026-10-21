import { createHash } from "node:crypto";
import { financeDocumentAccess } from "@/lib/finance/document-access";
import { financeDocumentFromDatabase } from "@/lib/finance/documents";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await financeDocumentAccess().catch(() => null);
  if (!access?.allowed) return new Response("Account abilitato e password Finance per questa sessione richiesti.", { status: access?.status ?? 503, headers });
  const { id } = await context.params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return new Response("Documento non disponibile.", { status: 404, headers });
  const row = await access.supabase.from("finance_documents").select("id,source_kind,file_name,storage_path,sha256,byte_size,content_type,review_status").eq("id", id).maybeSingle();
  const document = financeDocumentFromDatabase(row.data);
  if (row.error || !document) return new Response("Documento non disponibile.", { status: 404, headers });
  const download = await access.supabase.storage.from("finance-documents").download(document.storagePath);
  if (download.error || !download.data || download.data.size !== document.bytes) return new Response("File temporaneamente non disponibile.", { status: 503, headers });
  const bytes = new Uint8Array(await download.data.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== document.sha256) return new Response("Verifica del file non riuscita.", { status: 503, headers });
  return new Response(bytes, { headers: { ...headers, "Content-Type": document.contentType, "Content-Length": String(document.bytes), "Content-Disposition": `attachment; filename="${document.fileName}"` } });
}
