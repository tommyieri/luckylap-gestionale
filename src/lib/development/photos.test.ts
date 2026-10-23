import { describe, expect, it } from "vitest";
import {
  PHOTOS_PER_SEND,
  addPhotosPayload,
  parsePhotoDescriptor,
  parsePhotoMove,
  parsePhotoRemove,
  parsePhotoSend,
  photoFileProblem,
  photoFileUrl,
  photoMime,
  photoSize,
  photoStoragePath,
  photoUploadContentType,
  stepPhoto,
  type DevelopmentPhoto,
} from "./photos";

const user = "00000000-0000-4000-8000-000000000001";
const project = "00000000-0000-4000-8000-000000000002";
const asset = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const descriptor = (n: number, name = `IMG_${n}.jpg`, mime = "image/jpeg") => ({
  operationId: asset(n),
  originalName: name,
  mime,
  size: 2048,
  sha256: "a".repeat(64),
});

describe("file scelti", () => {
  it("accetta JPEG, PNG, WebP e HEIC, anche quando il browser non dichiara il tipo", () => {
    for (const [name, type] of [
      ["IMG_0001.JPG", "image/jpeg"],
      ["scatto.jpeg", "image/jpg"],
      ["mockup.png", "image/png"],
      ["web.webp", "image/webp"],
      ["IMG_0002.HEIC", ""],
      ["IMG_0003.heic", "image/heic"],
      ["IMG_0004.heif", "image/heif"],
    ])
      expect(photoFileProblem({ name, type, size: 1000 }), name).toBeNull();
    expect(photoMime("IMG_0002.HEIC")).toBe("image/heic");
    expect(photoMime("scatto.jpeg")).toBe("image/jpeg");
  });
  it("spiega in italiano file troppo grandi, di un altro tipo, vuoti o con un nome non valido", () => {
    expect(
      photoFileProblem({ name: "enorme.jpg", type: "image/jpeg", size: 25 * 1024 * 1024 + 1 }),
    ).toBe("«enorme.jpg» supera 25 MB: scegli una foto più leggera o riducila prima di caricarla.");
    expect(photoFileProblem({ name: "listino.pdf", type: "application/pdf", size: 10 })).toBe(
      "«listino.pdf» non è una foto in un formato accettato: usa JPEG, PNG, WebP o HEIC.",
    );
    expect(photoFileProblem({ name: "video.mp4", type: "video/mp4", size: 10 })).toMatch(
      /non è una foto/,
    );
    expect(photoFileProblem({ name: "logo.svg", type: "image/svg+xml", size: 10 })).toMatch(
      /non è una foto/,
    );
    expect(photoFileProblem({ name: "finto.jpg", type: "text/html", size: 10 })).toMatch(
      /non è una foto/,
    );
    expect(photoFileProblem({ name: "vuoto.png", type: "image/png", size: 0 })).toMatch(/è vuoto/);
    expect(photoFileProblem({ name: "a\u0001.png", type: "image/png", size: 5 })).toMatch(
      /rinominalo/,
    );
  });
});

describe("descrittori e invii", () => {
  it("salva HEIC come application/octet-stream nel percorso utente/operazione/nome", () => {
    const heic = parsePhotoDescriptor(descriptor(1, "Campione Già Fatto.HEIC", "image/heic"));
    expect(photoStoragePath(user, heic)).toBe(`${user}/${asset(1)}/campione-gia-fatto.heic`);
    expect(photoUploadContentType(heic.mime)).toBe("application/octet-stream");
    expect(photoUploadContentType("image/jpeg")).toBe("image/jpeg");
    expect(() => parsePhotoDescriptor(descriptor(2, "logo.svg", "image/svg+xml"))).toThrow();
    expect(() => parsePhotoDescriptor(descriptor(3, "foto.png", "image/jpeg"))).toThrow();
    expect(() => parsePhotoDescriptor({ ...descriptor(4), size: 25 * 1024 * 1024 + 1 })).toThrow(
      /25 MB/,
    );
  });
  it("un invio ha da 1 a 10 foto diverse e diventa il payload del comando", () => {
    const send = parsePhotoSend({
      operationId: asset(90).toUpperCase(),
      projectId: project,
      photos: [descriptor(1), descriptor(2, "retro.png", "image/png")],
    });
    expect(send.operationId).toBe(asset(90));
    expect(addPhotosPayload(send, user)).toEqual({
      schema_version: 1,
      project_id: project,
      photos: [
        {
          asset_id: asset(1),
          storage_path: `${user}/${asset(1)}/img_1.jpg`,
          original_file_name: "IMG_1.jpg",
          content_type: "image/jpeg",
          file_size_bytes: 2048,
          sha256: "a".repeat(64),
        },
        {
          asset_id: asset(2),
          storage_path: `${user}/${asset(2)}/retro.png`,
          original_file_name: "retro.png",
          content_type: "image/png",
          file_size_bytes: 2048,
          sha256: "a".repeat(64),
        },
      ],
    });
    const many = Array.from({ length: PHOTOS_PER_SEND + 1 }, (_, n) => descriptor(n + 1));
    for (const photos of [[], many, [descriptor(1), descriptor(1)]])
      expect(() => parsePhotoSend({ operationId: asset(90), projectId: project, photos })).toThrow(
        /Invio non valido/,
      );
    expect(() =>
      parsePhotoSend({ operationId: "x", projectId: project, photos: [descriptor(1)] }),
    ).toThrow();
  });
  it("rimuovere e spostare chiedono UUID e un posto da 1 a 60", () => {
    const base = { operationId: asset(91), projectId: project, assetId: asset(1) };
    expect(parsePhotoRemove(base)).toEqual(base);
    expect(parsePhotoMove({ ...base, position: 2 }).position).toBe(2);
    for (const position of [0, 61, 1.5, "2"])
      expect(() => parsePhotoMove({ ...base, position })).toThrow(/Ricarica/);
    expect(() => parsePhotoRemove({ ...base, assetId: "" })).toThrow(/Ricarica/);
  });
});

describe("visualizzazione", () => {
  const photo: DevelopmentPhoto = {
    id: asset(1),
    projectId: project,
    position: 1,
    originalName: "IMG_1.jpg",
    contentType: "image/jpeg",
    size: 2048,
    createdAt: "2026-10-23T10:00:00Z",
    createdBy: user,
  };
  it("usa la route privata, oppure l'immagine sintetica in anteprima", () => {
    expect(photoFileUrl(photo)).toBe(`/assets/files/${asset(1)}?preview=1`);
    expect(photoFileUrl(photo, false)).toBe(`/assets/files/${asset(1)}`);
    expect(photoFileUrl({ ...photo, previewSrc: "/anteprima/x.png" })).toBe("/anteprima/x.png");
  });
  it("scorre in giro e scrive le dimensioni in italiano", () => {
    expect(stepPhoto(0, -1, 3)).toBe(2);
    expect(stepPhoto(2, 1, 3)).toBe(0);
    expect(stepPhoto(1, 1, 3)).toBe(2);
    expect(stepPhoto(0, 1, 0)).toBe(0);
    expect(photoSize(2_400_000)).toBe("2,3 MB");
    expect(photoSize(41_000)).toBe("40 KB");
  });
});
