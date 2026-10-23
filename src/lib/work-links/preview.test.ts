import { beforeEach, describe, expect, it, vi } from "vitest";
import { partnerWorkSnapshot } from "./model";
import { partnerWorkPreview } from "./preview";

const mocks = vi.hoisted(() => ({ preview: false, createClient: vi.fn(), execute: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../runtime", async (importActual) => ({
  ...(await importActual<typeof import("../runtime")>()),
  isLocalPreviewEnabled: (environment?: { LUCKYLAP_LOCAL_PREVIEW?: string }) =>
    environment ? environment.LUCKYLAP_LOCAL_PREVIEW === "true" : mocks.preview,
}));
vi.mock("../supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("./server", () => ({ executePartnerWork: mocks.execute }));
const { createPartnerWork } = await import("../../app/team/partner/actions");

const now = new Date("2026-10-23T10:00:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview = false;
});

describe("«Partner nel Team» in anteprima locale", () => {
  it("senza anteprima legge dal database", () => {
    expect(partnerWorkPreview(now, { LUCKYLAP_LOCAL_PREVIEW: "false" })).toBeNull();
  });
  it("usa i contatti sintetici di /partner, con un accordo fatto, senza collegamenti", () => {
    const preview = partnerWorkPreview(now, { LUCKYLAP_LOCAL_PREVIEW: "true" })!;
    expect(preview.snapshot.links).toEqual([]);
    expect(preview.snapshot.orders).toEqual([]);
    expect(preview.snapshot.partners.some((p) => p.stage === "chiuso")).toBe(true);
    const rows = preview.snapshot.partners.map((p) => ({
      id: p.id,
      co: p.co,
      name: p.name,
      sections: p.sections,
      event_starts_on: p.eventStartsOn,
      event_ends_on: p.eventEndsOn,
      application_deadline: p.applicationDeadline,
      stage: p.stage,
    }));
    expect(partnerWorkSnapshot(rows, []).partners).toEqual(preview.snapshot.partners);
  });
  it("i comandi non arrivano a Supabase", async () => {
    mocks.preview = true;
    await expect(createPartnerWork({})).resolves.toEqual({
      status: "rejected",
      code: "preview",
      message: "Anteprima locale: salvataggio disattivato.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
