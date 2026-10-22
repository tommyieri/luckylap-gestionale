import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { verifiedMember } from "../../../../../lib/auth/server";
import { isLocalPreviewEnabled } from "../../../../../lib/runtime";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import {
  PARTNER_LOOKBOOK_MAX_BYTES,
  isPdfBytes,
  isPartnerLookbookCode,
  partnerLookbookHeaders,
} from "../../../../../lib/partner/lookbook";

/*
 * Lookbook Partner (00-sequenza §5, 02-2): i cinque PDF stanno in data/partner-lookbooks e
 * next.config.ts li include nella traccia di questa route. Solo per i membri, sempre come
 * allegato, mai in cache. Prima il membro, poi il codice: chi non è del team non scopre niente.
 */
export const dynamic = "force-dynamic";

const textHeaders = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const text = (body: string, status: number) => new Response(body, { status, headers: textHeaders });

async function memberStatus(): Promise<"member" | "outsider" | "unavailable"> {
  // Anteprima locale: niente Supabase, mai su Vercel né con NODE_ENV=production.
  if (isLocalPreviewEnabled()) return "member";
  try {
    const access = await verifiedMember(await createSupabaseServerClient());
    if (access.status === "member") return "member";
    return access.status === "unavailable" ? "unavailable" : "outsider";
  } catch {
    return "unavailable";
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const status = await memberStatus();
  if (status === "unavailable")
    return text("Verifica dell’accesso non disponibile. Riprova tra poco.", 503);
  if (status !== "member") return text("Accesso al team richiesto.", 401);
  const { code } = await params;
  // Solo i cinque codici arrivano al disco: nessun altro testo diventa un percorso. Il percorso
  // resta fisso fino alla cartella, così la traccia della build include solo data/partner-lookbooks.
  if (!isPartnerLookbookCode(code)) return text("Lookbook non disponibile.", 404);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(
      await readFile(join(process.cwd(), "data", "partner-lookbooks", `${code}.pdf`)),
    );
  } catch {
    return text("Lookbook non disponibile.", 404);
  }
  if (!isPdfBytes(bytes) || bytes.byteLength > PARTNER_LOOKBOOK_MAX_BYTES)
    return text("Lookbook non disponibile.", 404);
  return new Response(bytes, {
    status: 200,
    headers: partnerLookbookHeaders(code, bytes.byteLength),
  });
}
