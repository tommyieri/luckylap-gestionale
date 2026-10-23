import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), verify: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.create }));
vi.mock("../../lib/auth/server", () => ({ verifiedMember: mocks.verify }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import {
  finalizeDevelopmentPhotos,
  moveDevelopmentPhoto,
  prepareDevelopmentPhotoUploads,
  removeDevelopmentPhoto,
} from "./photo-actions";

const user = "00000000-0000-4000-8000-000000000001";
const project = "00000000-0000-4000-8000-000000000002";
const operation = "00000000-0000-4000-8000-000000000090";
const asset = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const JPEG = Uint8Array.of(255, 216, 255, 224, 0, 16);
const HEIC = Uint8Array.from([
  0,
  0,
  0,
  24,
  ...Buffer.from("ftypheic"),
  0,
  0,
  0,
  0,
  ...Buffer.from("mif1heic"),
]);
const photo = (n: number, bytes: Uint8Array, name: string, mime: string) => ({
  operationId: asset(n),
  originalName: name,
  mime,
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
});

function client({
  files = {} as Record<string, Uint8Array>,
  rpc = vi.fn(),
  signed = vi.fn(async (path: string) => ({
    data: { path, token: `token-${path.length}` },
    error: null,
  })),
} = {}) {
  const storage = {
    createSignedUploadUrl: signed,
    download: vi.fn(async (path: string) => {
      const bytes = files[path];
      return bytes
        ? { data: new Blob([bytes as Uint8Array<ArrayBuffer>]), error: null }
        : { data: null, error: { message: "Object not found" } };
    }),
  };
  const db = { rpc, storage: { from: vi.fn(() => storage) } };
  mocks.create.mockResolvedValue(db);
  return { db, storage };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue({ status: "member", member: { userId: user } });
});

describe("firma dei caricamenti", () => {
  it("firma un percorso per foto, senza sovrascrittura; HEIC come octet-stream", async () => {
    const { storage } = client();
    const result = await prepareDevelopmentPhotoUploads({
      projectId: project,
      photos: [
        photo(1, JPEG, "IMG_1.jpg", "image/jpeg"),
        photo(2, HEIC, "IMG_2.HEIC", "image/heic"),
      ],
    });
    expect(result.uploads?.map((upload) => [upload.path, upload.contentType])).toEqual([
      [`${user}/${asset(1)}/img_1.jpg`, "image/jpeg"],
      [`${user}/${asset(2)}/img_2.heic`, "application/octet-stream"],
    ]);
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(`${user}/${asset(1)}/img_1.jpg`, {
      upsert: false,
    });
  });
  it("chi non è più nel team non riceve firme; un SVG non passa", async () => {
    const { storage } = client();
    mocks.verify.mockResolvedValue({ status: "denied" });
    expect(
      (
        await prepareDevelopmentPhotoUploads({
          projectId: project,
          photos: [photo(1, JPEG, "a.jpg", "image/jpeg")],
        })
      ).error,
    ).toMatch(/account abilitato/);
    mocks.verify.mockResolvedValue({ status: "member", member: { userId: user } });
    expect(
      (
        await prepareDevelopmentPhotoUploads({
          projectId: project,
          photos: [photo(1, JPEG, "a.svg", "image/svg+xml")],
        })
      ).error,
    ).toMatch(/JPEG, PNG, WebP o HEIC/);
    expect(
      (await prepareDevelopmentPhotoUploads({ projectId: project, photos: [] })).error,
    ).toMatch(/da 1 a 10 foto/);
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe("registrazione delle foto", () => {
  const send = () => ({
    operationId: operation,
    projectId: project,
    photos: [photo(1, JPEG, "IMG_1.jpg", "image/jpeg"), photo(2, HEIC, "IMG_2.HEIC", "image/heic")],
  });
  const files = {
    [`${user}/${asset(1)}/img_1.jpg`]: JPEG,
    [`${user}/${asset(2)}/img_2.heic`]: HEIC,
  };
  it("verifica i byte e registra tutte le foto in un comando", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        operation_id: operation,
        project_id: project,
        asset_ids: [asset(1), asset(2)],
        replayed: false,
      },
      error: null,
    });
    client({ files, rpc });
    const result = await finalizeDevelopmentPhotos(send());
    expect(result).toEqual({
      assetIds: [asset(1), asset(2)],
      success: "2 foto aggiunte al progetto.",
    });
    expect(rpc).toHaveBeenCalledWith("add_development_photos", {
      p_operation_id: operation,
      p_payload: expect.objectContaining({
        schema_version: 1,
        project_id: project,
        photos: [
          expect.objectContaining({
            asset_id: asset(1),
            content_type: "image/jpeg",
            storage_path: `${user}/${asset(1)}/img_1.jpg`,
          }),
          expect.objectContaining({
            asset_id: asset(2),
            content_type: "image/heic",
            file_size_bytes: HEIC.length,
          }),
        ],
      }),
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/development");
  });
  it("una foto con byte diversi o non un'immagine non entra e nessun comando parte", async () => {
    const rpc = vi.fn();
    client({
      files: {
        ...files,
        [`${user}/${asset(2)}/img_2.heic`]: Uint8Array.from(
          Buffer.from("<html>no</html>".padEnd(24)),
        ),
      },
      rpc,
    });
    const result = await finalizeDevelopmentPhotos({
      ...send(),
      photos: [
        send().photos[0],
        photo(
          2,
          Uint8Array.from(Buffer.from("<html>no</html>".padEnd(24))),
          "IMG_2.HEIC",
          "image/heic",
        ),
      ],
    });
    expect(result.invalid).toEqual([asset(2)]);
    expect(result.error).toMatch(/non è stata aggiunta/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("un file non ancora disponibile o una risposta incerta chiedono di verificare lo stesso invio", async () => {
    client({ files: { [`${user}/${asset(1)}/img_1.jpg`]: JPEG } });
    expect(await finalizeDevelopmentPhotos(send())).toMatchObject({ retry: true });
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });
    client({ files, rpc });
    const uncertain = await finalizeDevelopmentPhotos(send());
    expect(uncertain).toMatchObject({ retry: true });
    expect(JSON.stringify(uncertain)).not.toContain("timeout");
    const wrong = vi.fn().mockResolvedValue({
      data: { operation_id: operation, project_id: project, asset_ids: [asset(1)] },
      error: null,
    });
    client({ files, rpc: wrong });
    expect(await finalizeDevelopmentPhotos(send())).toMatchObject({ retry: true });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("traduce i rifiuti del database", async () => {
    const cases: [Record<string, string>, RegExp, Record<string, unknown>][] = [
      [
        { code: "23505", message: "development_photo_idempotency_conflict" },
        /già stato usato/,
        { blocked: true },
      ],
      [{ code: "42501", message: "development_access_required" }, /permessi/, {}],
      [{ code: "22023", message: "development_project_not_found" }, /progetto non c’è più/, {}],
      [{ code: "22023", message: "development_photo_limit" }, /60 foto/, {}],
      [
        { code: "22023", message: "development_photo_upload_missing" },
        /non risulta ancora caricata/,
        { retry: true },
      ],
    ];
    for (const [error, message, extra] of cases) {
      client({ files, rpc: vi.fn().mockResolvedValue({ data: null, error }) });
      const result = await finalizeDevelopmentPhotos(send());
      expect(result.error, error.message).toMatch(message);
      expect(result, error.message).toMatchObject(extra);
    }
  });
  it("un invio illeggibile non si ripete", async () => {
    client();
    expect(
      await finalizeDevelopmentPhotos({ operationId: "x", projectId: project, photos: [] }),
    ).toMatchObject({
      blocked: true,
    });
  });
});

describe("rimuovere e spostare", () => {
  const input = { operationId: operation, projectId: project, assetId: asset(1) };
  it("rimuove con lo stesso operation ID e conferma solo l'esito giusto", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { asset_id: asset(1), removed: true }, error: null });
    client({ rpc });
    expect(await removeDevelopmentPhoto(input)).toEqual({ success: "Foto tolta dal progetto." });
    expect(rpc).toHaveBeenCalledWith("remove_development_photo", {
      p_operation_id: operation,
      p_payload: { schema_version: 1, project_id: project, asset_id: asset(1) },
    });
    client({
      rpc: vi.fn().mockResolvedValue({ data: { asset_id: asset(2), removed: true }, error: null }),
    });
    expect(await removeDevelopmentPhoto(input)).toMatchObject({ retry: true });
    client({ rpc: vi.fn().mockRejectedValue(new Error("rete")) });
    expect(await removeDevelopmentPhoto(input)).toMatchObject({ retry: true });
    client({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "22023", message: "development_photo_not_found" },
      }),
    });
    const gone = await removeDevelopmentPhoto(input);
    expect(gone.error).toMatch(/non è più nel progetto/);
    expect(gone.retry).toBeUndefined();
  });
  it("chi non è più nel team non rimuove", async () => {
    const rpc = vi.fn();
    client({ rpc });
    mocks.verify.mockResolvedValue({ status: "denied" });
    expect((await removeDevelopmentPhoto(input)).error).toMatch(/account abilitato/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sposta al posto indicato", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { asset_id: asset(1), position: 1, changed: true }, error: null });
    client({ rpc });
    expect(await moveDevelopmentPhoto({ ...input, position: 1 })).toEqual({
      success: "Ordine delle foto aggiornato.",
    });
    expect(rpc).toHaveBeenCalledWith("move_development_photo", {
      p_operation_id: operation,
      p_payload: { schema_version: 1, project_id: project, asset_id: asset(1), position: 1 },
    });
    expect((await moveDevelopmentPhoto({ ...input, position: 0 })).error).toMatch(/Ricarica/);
  });
});
