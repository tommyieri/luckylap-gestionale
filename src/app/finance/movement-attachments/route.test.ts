import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/finance/document-access", () => ({ financeDocumentAccess: access }));
vi.mock("../../../lib/runtime", () => ({ isLocalPreviewEnabled: () => false }));
import { GET, POST } from "./route";

const host = "https://example.test";
const endpoint = `${host}/finance/movement-attachments`;
const sourceId = "91000000-0000-4000-8000-000000000001";
const attachment = {
  id: "91000000-0000-4000-8000-000000000002",
  file_name: "Ricevuta demo.pdf",
  ready: false,
};
const pdf = new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" });

function request(file = pdf, origin = host) {
  const body = new FormData();
  body.set("source", "manual");
  body.set("sourceId", sourceId);
  body.set("file", file, "Ricevuta demo.pdf");
  return new Request(endpoint, {
    method: "POST",
    body,
    headers: { origin, "content-length": "500" },
  });
}

beforeEach(() => vi.resetAllMocks());

describe("allegati Finance", () => {
  it("nega download senza Finance e un caricamento con origine esterna", async () => {
    access.mockResolvedValue({ allowed: false, status: 403 });
    expect((await GET(new Request(`${endpoint}?id=${attachment.id}`))).status).toBe(403);
    expect((await POST(request(pdf, "https://elsewhere.test"))).status).toBe(403);
    expect(access).toHaveBeenCalledTimes(1);
  });

  it("verifica i byte prima di chiedere spazio per un file", async () => {
    const rpc = vi.fn();
    access.mockResolvedValue({ allowed: true, supabase: { rpc } });
    expect((await POST(request(new Blob(["<svg />"])))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recupera un caricamento già scritto dopo un conflitto di rete", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: attachment })
      .mockResolvedValueOnce({ data: true });
    const upload = vi.fn().mockResolvedValue({ error: { message: "Already exists" } });
    const download = vi.fn().mockResolvedValue({ data: pdf });
    access.mockResolvedValue({
      allowed: true,
      supabase: { rpc, storage: { from: () => ({ download, upload }) } },
    });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      attachment: { id: attachment.id, fileName: attachment.file_name },
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenLastCalledWith("finish_finance_movement_attachment", {
      p_attachment_id: attachment.id,
    });
  });

  it("rifiuta un download se l’oggetto non corrisponde all’hash", async () => {
    const sha256 = createHash("sha256")
      .update(new Uint8Array(await pdf.arrayBuffer()))
      .digest("hex");
    const result = {
      file_name: attachment.file_name,
      byte_size: pdf.size,
      sha256,
      content_type: "application/pdf",
    };
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: result }),
    };
    const download = vi
      .fn()
      .mockResolvedValueOnce({ data: pdf })
      .mockResolvedValueOnce({ data: new Blob(["%PDF-2.0\n%%EOF"]) });
    access.mockResolvedValue({
      allowed: true,
      supabase: { from: () => query, storage: { from: () => ({ download }) } },
    });
    const url = `${endpoint}?id=${attachment.id}`;
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("Ricevuta%20demo.pdf");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await GET(new Request(url))).status).toBe(503);
  });
});
