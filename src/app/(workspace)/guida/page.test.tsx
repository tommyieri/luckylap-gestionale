import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { VerifiedMember } from "../../../lib/auth/model";

const mocks = vi.hoisted(() => ({
  config: vi.fn((): { url: string; publishableKey: string } => {
    throw Error("Supabase non configurato.");
  }),
  client: vi.fn(async () => ({})),
  verified: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../../../lib/supabase/config", () => ({ getSupabasePublicConfig: mocks.config }));
vi.mock("../../../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("../../../lib/auth/server", () => ({ verifiedMember: mocks.verified }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Error(`NEXT_REDIRECT:${to}`);
  },
  unstable_rethrow: () => {},
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../../auth/actions", () => ({ signOut: vi.fn() }));

import GuidePage, { metadata } from "./page";
import { GuideView } from "../../../components/guide-view";
import { AccessPanel } from "../../../components/access-panel";

type Element = ReactElement<Record<string, unknown>>;
const member = (role: VerifiedMember["role"], financeAccess: boolean): VerifiedMember => ({
  userId: "00000000-0000-4000-8000-000000000001",
  displayName: "Membro di prova",
  role,
  financeAccess,
});
/** Supabase configurato e un membro verificato, senza chiamate vere. */
const signedIn = (verified: VerifiedMember) => {
  mocks.config.mockImplementation(() => ({
    url: "https://example.test",
    publishableKey: "chiave-sintetica",
  }));
  mocks.verified.mockResolvedValue({ status: "member", member: verified });
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "true");
  vi.stubEnv("VERCEL", "");
  mocks.config.mockReset();
  mocks.config.mockImplementation(() => {
    throw Error("Supabase non configurato.");
  });
  mocks.verified.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("/guida", () => {
  it("ha il titolo «Come si usa»", () => {
    expect(metadata).toEqual({ title: "Come si usa" });
  });

  it("in anteprima locale mostra la guida di Tommi, senza Supabase (00-sequenza §1.5)", async () => {
    const page = (await GuidePage()) as Element;
    expect(page.type).toBe(GuideView);
    expect(page.props).toEqual({ access: { finance: true, ceo: true }, preview: true });
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each([
    ["VERCEL", "1"],
    ["NODE_ENV", "production"],
  ])("con %s=%s il ramo dell'anteprima non si attiva", async (name, value) => {
    vi.stubEnv(name, value);
    const page = (await GuidePage()) as Element;
    expect(page.type).toBe(AccessPanel);
    expect(page.props.status).toBe("unconfigured");
    expect(mocks.config).toHaveBeenCalled();
  });

  it.each([
    ["consultant", false, { finance: false, ceo: false }],
    ["logistics", false, { finance: false, ceo: false }],
    ["production", true, { finance: true, ceo: false }],
    ["finance", true, { finance: true, ceo: false }],
    ["founder", false, { finance: true, ceo: true }],
  ] as const)(
    "%s con finance_access=%s: Finance e Controllo CEO come nel menu",
    async (role, financeAccess, access) => {
      vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "");
      signedIn(member(role, financeAccess));
      const page = (await GuidePage()) as Element;
      expect(page.type).toBe(GuideView);
      expect(page.props).toEqual({ access });
    },
  );

  it("senza sessione porta al login, con account non abilitato mostra il pannello comune", async () => {
    vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "");
    signedIn(member("consultant", false));
    mocks.verified.mockResolvedValue({ status: "signed-out" });
    await expect(GuidePage()).rejects.toThrow("NEXT_REDIRECT:/auth/login");
    mocks.verified.mockResolvedValue({ status: "denied" });
    const page = (await GuidePage()) as Element;
    expect(page.type).toBe(AccessPanel);
    expect(page.props.status).toBe("denied");
  });
});
