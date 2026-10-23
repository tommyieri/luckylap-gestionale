import { describe, expect, it, vi } from "vitest";
import {
  runPhotoBatch,
  sendPhotos,
  sendSummary,
  type PhotoBatchDeps,
  type PhotoJob,
} from "./photo-batch";
import type { PhotoDescriptor, PhotoSend } from "./photos";

const project = "00000000-0000-4000-8000-000000000002";
const file = (name: string, size = 2048, type = "image/jpeg") =>
  new File([new Uint8Array(size)], name, { type });

function deps(overrides: Partial<PhotoBatchDeps> = {}) {
  let n = 0;
  const remembered: (PhotoSend | null)[] = [];
  const value: PhotoBatchDeps = {
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    hash: vi.fn(async () => "b".repeat(64)),
    prepare: vi.fn(async ({ photos }: { photos: PhotoDescriptor[] }) => ({
      uploads: photos.map((photo) => ({
        assetId: photo.operationId,
        path: `utente/${photo.operationId}/foto.jpg`,
        token: "token-sintetico",
        contentType: photo.mime,
      })),
    })),
    upload: vi.fn(async (_file, _upload, onProgress) => {
      onProgress(0.5);
      onProgress(1);
      return true;
    }),
    finalize: vi.fn(async (send: PhotoSend) => ({
      assetIds: send.photos.map((photo) => photo.operationId),
      success: `${send.photos.length} foto aggiunte al progetto.`,
    })),
    remember: (send) => remembered.push(send),
    ...overrides,
  };
  return { value, remembered };
}
const last = (updates: PhotoJob[][]) => updates.at(-1) ?? [];

describe("invio di foto", () => {
  it("controlla i file, carica con l'avanzamento e registra tutto in un invio", async () => {
    const { value, remembered } = deps();
    const updates: PhotoJob[][] = [];
    const outcome = await runPhotoBatch(
      {
        files: [
          file("IMG_1.jpg"),
          file("enorme.jpg", 25 * 1024 * 1024 + 1),
          file("nota.txt", 3, "text/plain"),
          file("IMG_2.HEIC", 10, ""),
        ],
        projectId: project,
        existing: 3,
      },
      value,
      (jobs) => updates.push(jobs),
    );
    expect(outcome.kind).toBe("added");
    expect(value.finalize).toHaveBeenCalledOnce();
    const send = vi.mocked(value.finalize).mock.calls[0][0];
    expect(send.photos.map((photo) => [photo.originalName, photo.mime])).toEqual([
      ["IMG_1.jpg", "image/jpeg"],
      ["IMG_2.HEIC", "image/heic"],
    ]);
    expect(remembered).toEqual([send, null]);
    expect(last(updates).map((job) => [job.name, job.status])).toEqual([
      ["IMG_1.jpg", "added"],
      ["enorme.jpg", "rejected"],
      ["nota.txt", "rejected"],
      ["IMG_2.HEIC", "added"],
    ]);
    expect(last(updates)[1].message).toMatch(/supera 25 MB/);
    expect(last(updates)[2].message).toMatch(/JPEG, PNG, WebP o HEIC/);
    expect(
      updates.some((jobs) => jobs.some((job) => job.status === "sending" && job.progress === 0.5)),
    ).toBe(true);
    if (outcome.kind === "added")
      expect([...outcome.files.values()].map((f) => f.name)).toEqual(["IMG_1.jpg", "IMG_2.HEIC"]);
  });
  it("con soli file non validi non chiede firme né invii", async () => {
    const { value } = deps();
    const outcome = await runPhotoBatch(
      { files: [file("listino.pdf", 4, "application/pdf")], projectId: project, existing: 0 },
      value,
      () => {},
    );
    expect(outcome).toEqual({ kind: "nothing" });
    expect(value.prepare).not.toHaveBeenCalled();
  });
  it("al massimo 10 foto per invio e 60 nel progetto", async () => {
    const { value } = deps();
    const updates: PhotoJob[][] = [];
    await runPhotoBatch(
      {
        files: Array.from({ length: 12 }, (_, n) => file(`IMG_${n}.jpg`)),
        projectId: project,
        existing: 0,
      },
      value,
      (jobs) => updates.push(jobs),
    );
    expect(vi.mocked(value.finalize).mock.calls[0][0].photos).toHaveLength(10);
    expect(
      last(updates)
        .slice(10)
        .map((job) => job.message),
    ).toEqual([
      "Al massimo 10 foto per volta: aggiungila con il prossimo invio.",
      "Al massimo 10 foto per volta: aggiungila con il prossimo invio.",
    ]);
    const full = deps();
    const fullUpdates: PhotoJob[][] = [];
    await runPhotoBatch(
      { files: [file("a.jpg"), file("b.jpg")], projectId: project, existing: 59 },
      full.value,
      (jobs) => fullUpdates.push(jobs),
    );
    expect(vi.mocked(full.value.finalize).mock.calls[0][0].photos).toHaveLength(1);
    expect(last(fullUpdates)[1].message).toBe("Il progetto arriva a 60 foto: questa non entra.");
  });
  it("un trasferimento fallito resta fuori, gli altri si registrano", async () => {
    const { value } = deps({
      upload: vi.fn(async (f: File) => f.name !== "rete.jpg"),
    });
    const updates: PhotoJob[][] = [];
    const outcome = await runPhotoBatch(
      { files: [file("ok.jpg"), file("rete.jpg")], projectId: project, existing: 0 },
      value,
      (jobs) => updates.push(jobs),
    );
    expect(outcome.kind).toBe("added");
    expect(vi.mocked(value.finalize).mock.calls[0][0].photos.map((p) => p.originalName)).toEqual([
      "ok.jpg",
    ]);
    expect(last(updates)[1]).toMatchObject({
      status: "failed",
      message: expect.stringMatching(/Invio non riuscito/),
    });
  });
  it("una firma non disponibile non invia byte", async () => {
    const { value } = deps({
      prepare: vi.fn(async () => ({ error: "Caricamento non disponibile." })),
    });
    const outcome = await runPhotoBatch(
      { files: [file("a.jpg")], projectId: project, existing: 0 },
      value,
      () => {},
    );
    expect(outcome).toEqual({ kind: "failed", message: "Caricamento non disponibile." });
    expect(value.upload).not.toHaveBeenCalled();
  });
});

describe("registrazione dell'invio", () => {
  const send: PhotoSend = {
    operationId: "00000000-0000-4000-8000-000000000090",
    projectId: project,
    photos: [1, 2].map((n) => ({
      operationId: `00000000-0000-4000-8000-00000000010${n}`,
      originalName: `IMG_${n}.jpg`,
      mime: "image/jpeg",
      size: 10,
      sha256: "c".repeat(64),
    })),
  };
  it("dopo una risposta incerta conserva lo stesso invio, con lo stesso ID", async () => {
    const { value, remembered } = deps({
      finalize: vi.fn(async () => ({ error: "Non confermata.", retry: true })),
    });
    const outcome = await sendPhotos(send, value);
    expect(outcome).toEqual({ kind: "pending", message: "Non confermata.", send, blocked: false });
    expect(remembered).toEqual([send]);
    const thrown = deps({ finalize: vi.fn(async () => Promise.reject(new Error("rete"))) });
    expect((await sendPhotos(send, thrown.value)).kind).toBe("pending");
  });
  it("un ID già usato con altri dati si può solo scartare", async () => {
    const { value } = deps({
      finalize: vi.fn(async () => ({ error: "Già usato.", blocked: true })),
    });
    expect(await sendPhotos(send, value)).toMatchObject({ kind: "pending", blocked: true });
  });
  it("le foto che non superano la verifica escono; il resto riparte con un ID nuovo", async () => {
    const finalize = vi
      .fn()
      .mockResolvedValueOnce({ error: "Una foto non va.", invalid: [send.photos[1].operationId] })
      .mockImplementationOnce(async (next: PhotoSend) => ({
        assetIds: next.photos.map((photo) => photo.operationId),
        success: "Foto aggiunta al progetto.",
      }));
    const onInvalid = vi.fn();
    const { value, remembered } = deps({ finalize });
    const outcome = await sendPhotos(send, value, onInvalid);
    expect(outcome).toMatchObject({ kind: "added", assetIds: [send.photos[0].operationId] });
    expect(onInvalid).toHaveBeenCalledWith([send.photos[1].operationId]);
    const second = finalize.mock.calls[1][0] as PhotoSend;
    expect(second.operationId).not.toBe(send.operationId);
    expect(second.photos).toEqual([send.photos[0]]);
    expect(remembered.at(-1)).toBeNull();
  });
  it("un errore definitivo libera il tentativo", async () => {
    const { value, remembered } = deps({
      finalize: vi.fn(async () => ({ error: "Il progetto non c’è più." })),
    });
    expect(await sendPhotos(send, value)).toEqual({
      kind: "failed",
      message: "Il progetto non c’è più.",
    });
    expect(remembered.at(-1)).toBeNull();
    expect(sendSummary(send)).toBe("2 foto: IMG_1.jpg, IMG_2.jpg");
  });
});
