import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { developmentPhotoFromDatabase, loadDevelopment } from "./server";

const project = "00000000-0000-4000-8000-000000000002";
const asset = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const row = (
  n: number,
  overrides: Record<string, unknown> = {},
  assetOverrides: Record<string, unknown> = {},
) => ({
  id: `00000000-0000-4000-8000-0000000005${String(n).padStart(2, "0")}`,
  project_id: project,
  asset_id: asset(n),
  position: n,
  created_at: "2026-10-23T10:00:00Z",
  created_by: "00000000-0000-4000-8000-000000000001",
  asset: {
    original_file_name: `IMG_${n}.HEIC`,
    content_type: "image/heic",
    file_size_bytes: 2048,
    archived_at: null,
    ...assetOverrides,
  },
  ...overrides,
});

describe("lettura delle foto dei progetti", () => {
  it("legge foto e contenuto, anche HEIC; salta i contenuti archiviati", () => {
    expect(developmentPhotoFromDatabase(row(1))).toEqual({
      id: asset(1),
      projectId: project,
      position: 1,
      originalName: "IMG_1.HEIC",
      contentType: "image/heic",
      size: 2048,
      createdAt: "2026-10-23T10:00:00Z",
      createdBy: "00000000-0000-4000-8000-000000000001",
    });
    expect(
      developmentPhotoFromDatabase(row(2, {}, { archived_at: "2026-10-23T11:00:00Z" })),
    ).toBeNull();
  });
  it("rifiuta righe incomplete", () => {
    for (const bad of [
      row(1, { asset: null }),
      row(1, { position: 0 }),
      row(1, { project_id: "x" }),
      row(1, {}, { content_type: "text/html", original_file_name: "a.html" }),
      row(1, {}, { file_size_bytes: 0 }),
    ])
      expect(() => developmentPhotoFromDatabase(bad)).toThrow();
  });
  it("carica progetti e foto in ordine di progetto e posizione", async () => {
    const tables: Record<string, unknown[]> = {
      product_development_projects: [],
      profiles: [],
      memberships: [],
      product_development_photos: [row(2), row(1)].sort((a, b) => a.id.localeCompare(b.id)),
    };
    const selects: Record<string, string> = {};
    const supabase = {
      from: (table: string) => {
        const query = {
          select: (columns: string) => {
            selects[table] = columns;
            return query;
          },
          order: () => query,
          limit: () => query,
          gt: () => query,
          then: (resolve: (value: unknown) => void) =>
            resolve({ data: tables[table], count: tables[table].length, error: null }),
        };
        return query;
      },
    };
    const result = await loadDevelopment(supabase as never);
    expect(result.photos.map((photo) => photo.position)).toEqual([1, 2]);
    expect(selects.product_development_photos).toContain(
      "asset:assets(original_file_name,content_type,file_size_bytes,archived_at)",
    );
  });
});
