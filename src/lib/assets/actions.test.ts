import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), verify: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../supabase/server", () => ({ createSupabaseServerClient: mocks.create }));
vi.mock("../auth/server", () => ({ verifiedMember: mocks.verify }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import {
  finalizeBrandUpload,
  prepareBrandUpload,
  registerBrandLink,
} from "../../app/assets/actions";
import { assetStoragePath, type UploadDescriptor } from "./model";
const uid = "00000000-0000-4000-8000-000000000001",
  op = "00000000-0000-4000-8000-000000000002";
const bytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const descriptor: UploadDescriptor = {
  operationId: op,
  originalName: "logo.png",
  mime: "image/png",
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
};
const fields = { name: "Logo sintetico", assetType: "logo" as const, description: "" };
function client(body: Uint8Array = bytes) {
  const storage = {
    createSignedUploadUrl: vi.fn().mockResolvedValue({
      data: { token: "synthetic-upload-capability", path: assetStoragePath(uid, descriptor) },
      error: null,
    }),
    download: vi
      .fn()
      .mockResolvedValue({ data: new Blob([body as Uint8Array<ArrayBuffer>]), error: null }),
  };
  const db = {
    storage: { from: vi.fn(() => storage) },
    rpc: vi.fn().mockResolvedValue({ data: op, error: null }),
  };
  mocks.create.mockResolvedValue(db);
  return { db, storage };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue({ status: "member", member: { userId: uid } });
});
describe("private brand asset Server Actions", () => {
  it("does not sign an upload for a non-member", async () => {
    const { db, storage } = client();
    mocks.verify.mockResolvedValue({ status: "denied" });
    expect((await prepareBrandUpload(descriptor)).error).toMatch(/account abilitato/);
    expect(mocks.verify).toHaveBeenCalledWith(db);
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });
  it("signs exactly the member/operation path without allowing overwrite", async () => {
    const { storage } = client();
    const result = await prepareBrandUpload(descriptor);
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(assetStoragePath(uid, descriptor), {
      upsert: false,
    });
    expect(result.upload).toEqual({
      path: assetStoragePath(uid, descriptor),
      token: "synthetic-upload-capability",
      contentType: "image/png",
    });
  });
  it("downloads and validates bytes before registering metadata", async () => {
    const { db, storage } = client();
    const result = await finalizeBrandUpload({ descriptor, fields });
    expect(storage.download).toHaveBeenCalledWith(assetStoragePath(uid, descriptor));
    expect(db.rpc).toHaveBeenCalledWith(
      "register_brand_asset",
      expect.objectContaining({
        p_operation_id: op,
        p_storage_path: assetStoragePath(uid, descriptor),
        p_sha256: descriptor.sha256,
      }),
    );
    expect(result.id).toBe(op);
    expect(mocks.revalidate).toHaveBeenCalledWith("/assets");
  });
  it("does not register invalid bytes even when filename, MIME, size and digest claims agree", async () => {
    const fake = new TextEncoder().encode("<html/>");
    const { db } = client(fake);
    const result = await finalizeBrandUpload({
      descriptor: {
        ...descriptor,
        size: fake.length,
        sha256: createHash("sha256").update(fake).digest("hex"),
      },
      fields,
    });
    expect(result.error).toMatch(/formato dichiarato/);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("keeps an uncertain upload separate from confirmed library metadata", async () => {
    const { db } = client();
    db.rpc.mockResolvedValue({
      data: null,
      error: { code: "NETWORK", message: "Private diagnostic" },
    });
    const result = await finalizeBrandUpload({ descriptor, fields });
    expect(result.error).toMatch(/Verifica e completa/);
    expect(result.id).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("Private diagnostic");
  });
  it("revalidates membership before registering a link and refuses HTTP sources", async () => {
    const { db } = client();
    expect(
      (await registerBrandLink({ operationId: op, fields, url: "http://example.test" })).error,
    ).toMatch(/HTTPS/);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(
      (
        await registerBrandLink({
          operationId: op,
          fields,
          url: "https://drive.google.com/file/d/synthetic/view",
        })
      ).id,
    ).toBe(op);
  });
});
