import { createClient } from "@supabase/supabase-js";
import { ASSET_BUCKET } from "../assets/model";
import type { SupabasePublicConfig } from "../supabase/config";
import type { PreparedPhotoUpload } from "./photos";

/*
 * Trasferimento di una foto verso il caricamento firmato, con l'avanzamento. Lo stesso client di
 * «Grafica e foto»: niente sessione Auth né token nel browser, solo la capability del percorso.
 * Il fetch passa da XMLHttpRequest, l'unico modo per leggere i byte già inviati.
 */
const NULL_BODY = new Set([101, 204, 205, 304]);

/** Un `fetch` che riporta l'avanzamento dell'invio (0..1). */
export function progressFetch(onProgress: (fraction: number) => void): typeof fetch {
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const request = new XMLHttpRequest();
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      request.open(init?.method ?? "GET", url);
      new Headers(init?.headers).forEach((value, key) => request.setRequestHeader(key, value));
      request.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
      };
      request.onload = () => {
        const headers = new Headers();
        for (const line of request
          .getAllResponseHeaders()
          .trim()
          .split(/[\r\n]+/)) {
          const colon = line.indexOf(":");
          if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
        }
        resolve(
          new Response(NULL_BODY.has(request.status) ? null : request.responseText, {
            status: request.status,
            statusText: request.statusText,
            headers,
          }),
        );
      };
      request.onerror = () => reject(new TypeError("Rete non disponibile."));
      request.onabort = () => reject(new DOMException("Invio interrotto.", "AbortError"));
      init?.signal?.addEventListener("abort", () => request.abort());
      request.send((init?.body as XMLHttpRequestBodyInit | null | undefined) ?? null);
    });
}

/** Invia i byte; true solo se Storage conferma. */
export async function uploadPhoto(
  config: SupabasePublicConfig,
  upload: PreparedPhotoUpload,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<boolean> {
  const storage = createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: progressFetch(onProgress) },
  });
  // Con un Blob, storage-js manda un multipart e Storage salva il tipo della parte, non l'opzione
  // contentType: il Blob porta il tipo firmato (application/octet-stream per HEIC), lo stesso che
  // add_development_photos ricontrolla nei metadati dell'oggetto.
  const body = new Blob([file], { type: upload.contentType });
  const result = await storage.storage
    .from(ASSET_BUCKET)
    .uploadToSignedUrl(upload.path, upload.token, body, {
      contentType: upload.contentType,
      upsert: false,
      cacheControl: "0",
    });
  return !result.error;
}
