import { afterEach, describe, expect, it, vi } from "vitest";
import { progressFetch, uploadPhoto } from "./photo-transfer";

/** XMLHttpRequest finto: registra la richiesta e risponde quando il test lo dice. */
class FakeRequest {
  static last: FakeRequest;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  statusText = "";
  responseText = "";
  upload: {
    onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void;
  } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  constructor() {
    FakeRequest.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  getAllResponseHeaders() {
    return "content-type: application/json\r\n";
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
}
afterEach(() => vi.unstubAllGlobals());

describe("trasferimento con avanzamento", () => {
  it("riporta i byte inviati e restituisce la risposta di Storage", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const progress = vi.fn();
    const pending = progressFetch(progress)(
      "https://example.supabase.co/storage/v1/object/upload/sign/x",
      {
        method: "PUT",
        headers: { "x-upsert": "false" },
        body: "byte",
      },
    );
    const request = FakeRequest.last;
    expect([request.method, request.headers["x-upsert"], request.body]).toEqual([
      "PUT",
      "false",
      "byte",
    ]);
    request.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
    request.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });
    request.status = 200;
    request.responseText = '{"Key":"brand-assets/x"}';
    request.onload?.();
    const response = await pending;
    expect(progress.mock.calls).toEqual([[0.25]]);
    expect(await response.json()).toEqual({ Key: "brand-assets/x" });
    expect(response.headers.get("content-type")).toBe("application/json");
  });
  it("un errore di rete diventa un rifiuto", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const pending = progressFetch(vi.fn())("https://example.supabase.co/x", { method: "PUT" });
    FakeRequest.last.onerror?.();
    await expect(pending).rejects.toThrow(/Rete non disponibile/);
  });
  it("invia il file con il tipo firmato, anche HEIC come octet-stream", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const done = uploadPhoto(
      { url: "https://example.supabase.co", publishableKey: "sb_publishable_sintetica" },
      {
        assetId: "a",
        path: "utente/a/img.heic",
        token: "token-sintetico",
        contentType: "application/octet-stream",
      },
      new File([new Uint8Array(8)], "IMG.HEIC", { type: "image/heic" }),
      vi.fn(),
    );
    await vi.waitFor(() =>
      expect(FakeRequest.last?.url).toContain("/object/upload/sign/brand-assets/utente/a/img.heic"),
    );
    const request = FakeRequest.last;
    expect(request.url).toContain("token=token-sintetico");
    const part = (request.body as FormData).get("") as File;
    expect(part.type).toBe("application/octet-stream");
    expect(part.size).toBe(8);
    request.status = 200;
    request.responseText = '{"Key":"brand-assets/utente/a/img.heic"}';
    request.onload?.();
    expect(await done).toBe(true);
  });
});
