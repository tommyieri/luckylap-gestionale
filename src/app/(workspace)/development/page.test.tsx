import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  config: vi.fn((): { url: string; publishableKey: string } => {
    throw Error("Supabase non configurato.");
  }),
  client: vi.fn(async () => ({})),
  verified: vi.fn(),
  load: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../../../lib/supabase/config", () => ({ getSupabasePublicConfig: mocks.config }));
vi.mock("../../../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("../../../lib/auth/server", () => ({ verifiedMember: mocks.verified }));
vi.mock("../../../lib/development/server", () => ({ loadDevelopment: mocks.load }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("../../development/actions", () => ({}));
vi.mock("../../development/photo-actions", () => ({}));

import DevelopmentPage from "./page";
import { DevelopmentView } from "../../../components/development-view";
import type { DevelopmentPhoto } from "../../../lib/development/photos";

type Element = ReactElement<Record<string, unknown>>;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "true");
  vi.stubEnv("VERCEL", "");
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

describe("/development", () => {
  it("in anteprima locale mostra progetti e foto sintetici, senza Supabase", async () => {
    const page = (await DevelopmentPage()) as Element;
    expect(page.type).toBe(DevelopmentView);
    expect(page.props.preview).toBe(true);
    const photos = page.props.photos as DevelopmentPhoto[];
    expect(photos.length).toBeGreaterThan(3);
    expect(
      photos.every((photo) => photo.previewSrc?.startsWith("/anteprima/nuovi-prodotti/")),
    ).toBe(true);
    expect(photos.some((photo) => photo.contentType === "image/heic")).toBe(true);
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it.each([
    ["VERCEL", "1"],
    ["NODE_ENV", "production"],
  ])("con %s=%s il ramo dell'anteprima non si attiva", async (name, value) => {
    vi.stubEnv(name, value);
    const page = (await DevelopmentPage()) as Element;
    expect(page.type).not.toBe(DevelopmentView);
    expect(mocks.config).toHaveBeenCalled();
    expect(page.props.title).toBe("Lo sviluppo attende il collegamento.");
  });

  it("per un membro passa foto, utente e configurazione pubblica", async () => {
    vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "");
    const config = {
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_sintetica",
    };
    mocks.config.mockReturnValue(config);
    mocks.verified.mockResolvedValue({
      status: "member",
      member: { userId: "00000000-0000-4000-8000-000000000001", displayName: "Membro sintetico" },
    });
    mocks.load.mockResolvedValue({ projects: [], members: [], photos: [] });
    const page = (await DevelopmentPage()) as Element;
    expect(page.type).toBe(DevelopmentView);
    expect(page.props).toMatchObject({
      photos: [],
      userId: "00000000-0000-4000-8000-000000000001",
      config,
    });
    expect(page.props.preview).toBeUndefined();
  });
});
