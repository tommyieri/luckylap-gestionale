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
vi.mock("../../../lib/assets/server", () => ({ loadBrandAssets: mocks.load }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("../../assets/actions", () => ({}));

import AssetsPage from "./page";
import { BrandAssetsView } from "../../../components/brand-assets-view";

type Element = ReactElement<Record<string, unknown>>;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "true");
  vi.stubEnv("VERCEL", "");
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

describe("/assets", () => {
  it("in anteprima locale mostra contenuti sintetici, uno archiviato, senza Supabase", async () => {
    const page = (await AssetsPage()) as Element;
    expect(page.type).toBe(BrandAssetsView);
    expect(page.props.preview).toBe(true);
    const assets = page.props.assets as { archivedAt: string | null; externalUrl: string | null }[];
    expect(assets.filter((asset) => asset.archivedAt !== null)).toHaveLength(1);
    expect(
      assets.every(
        (asset) => !asset.externalUrl || asset.externalUrl.startsWith("https://example.test/"),
      ),
    ).toBe(true);
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it.each([
    ["VERCEL", "1"],
    ["NODE_ENV", "production"],
  ])("con %s=%s il ramo dell'anteprima non si attiva", async (name, value) => {
    vi.stubEnv(name, value);
    const page = (await AssetsPage()) as Element;
    expect(page.type).not.toBe(BrandAssetsView);
    expect(mocks.config).toHaveBeenCalled();
    expect(page.props.title).toBe("La libreria attende il collegamento.");
  });
});
