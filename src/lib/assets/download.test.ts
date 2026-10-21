import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), verify: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../supabase/server", () => ({ createSupabaseServerClient: mocks.create }));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.verify }));
import { GET } from "../../app/assets/files/[id]/route";

const id = "00000000-0000-4000-8000-000000000001";
function client(bytes: Uint8Array, mime = "image/png", originalName = "original.png", storageMime = mime) {
  const row = { id, storage_path: `system/${id}/${originalName}`, original_file_name: originalName, content_type: mime, file_size_bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) };
  const storage = { download: vi.fn().mockResolvedValue({ data: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: storageMime }), error: null }), createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://example.supabase.co/storage/v1/object/sign/brand-assets/synthetic?token=short-lived-storage-only" }, error: null }) };
  const db = { from: vi.fn(() => query), storage: { from: vi.fn(() => storage) } }; mocks.create.mockResolvedValue(db); return { db, storage };
}
beforeEach(() => { vi.clearAllMocks(); mocks.verify.mockResolvedValue({ status: "member" }); });
describe("private asset delivery", () => {
  it("rejects a revoked member before reading metadata or bytes", async () => {
    const { db } = client(Uint8Array.of(1)); mocks.verify.mockResolvedValue({ status: "denied" });
    const response = await GET(new Request(`https://example.test/assets/files/${id}`), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(401); expect(db.from).not.toHaveBeenCalled();
  });
  it("verifies a file larger than Vercel’s body limit but returns only a small redirect", async () => {
    const bytes = new Uint8Array(5 * 1024 * 1024); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const { storage } = client(bytes);
    const response = await GET(new Request(`https://example.test/assets/files/${id}?preview=1`), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(303); expect(await response.text()).toBe("");
    expect(storage.createSignedUrl).toHaveBeenCalledWith(`system/${id}/original.png`, 60, {});
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("forces SVG downloads even when an inline preview is requested", async () => {
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const { storage } = client(bytes, "image/svg+xml", "logo.svg", "application/octet-stream");
    const response = await GET(new Request(`https://example.test/assets/files/${id}?preview=1`), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(303); expect(storage.createSignedUrl).toHaveBeenCalledWith(`system/${id}/logo.svg`, 60, { download: "logo.svg" });
  });
  it("does not issue a URL for a forged metadata record whose file bytes are executable HTML", async () => {
    const { storage } = client(new TextEncoder().encode("<html>not png</html>"));
    const response = await GET(new Request(`https://example.test/assets/files/${id}?preview=1`), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(503); expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
});
