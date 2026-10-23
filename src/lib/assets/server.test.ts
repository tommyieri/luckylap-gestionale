import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ASSET_COLUMNS, brandAssetFromDatabase } from "./server";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-000000000101",
  name: "Foto sintetica",
  asset_type: "photo",
  description: "",
  external_url: null,
  storage_path:
    "00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000101/foto.png",
  original_file_name: "Foto.png",
  content_type: "image/png",
  file_size_bytes: 8,
  sha256: "a".repeat(64),
  created_at: "2026-10-22T08:00:00Z",
  archived_at: null,
  source_kind: null,
  ...overrides,
});

describe("lettura della libreria", () => {
  it("legge anche archived_at", () => {
    expect(ASSET_COLUMNS.split(",")).toContain("archived_at");
    expect(brandAssetFromDatabase(row()).archivedAt).toBeNull();
    expect(
      brandAssetFromDatabase(row({ archived_at: "2026-10-22T09:30:00.123456+00:00" })).archivedAt,
    ).toBe("2026-10-22T09:30:00.123456+00:00");
  });
  it("riconosce le foto dei progetti di Nuovi prodotti dal segno in source", () => {
    expect(ASSET_COLUMNS.split(",")).toContain("source_kind:source->>kind");
    expect(brandAssetFromDatabase(row()).developmentPhoto).toBeUndefined();
    expect(
      brandAssetFromDatabase(row({ source_kind: "drive_admin_import" })).developmentPhoto,
    ).toBeUndefined();
    expect(
      brandAssetFromDatabase(row({ source_kind: "development_photo", content_type: "image/heic" }))
        .developmentPhoto,
    ).toBe(true);
    for (const source_kind of [undefined, 1, {}])
      expect(() => brandAssetFromDatabase(row({ source_kind }))).toThrow(
        "Libreria non disponibile.",
      );
  });
  it("rifiuta la lettura se la data dell'archivio non è valida o manca la colonna", () => {
    for (const archived_at of ["ieri", 42, true, undefined])
      expect(() => brandAssetFromDatabase(row({ archived_at }))).toThrow(
        "Libreria non disponibile.",
      );
  });
});
