import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

// /partner/assistente sul modello di /partner/dati: anteprima, accesso, letture complete o niente.
const mocks = vi.hoisted(() => ({
  config: vi.fn((): { url: string; publishableKey: string } => {
    throw Error("Supabase non configurato.");
  }),
  client: vi.fn(async () => ({})),
  verified: vi.fn(),
  status: vi.fn(),
  rules: vi.fn(),
  ids: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../../../../lib/supabase/config", () => ({ getSupabasePublicConfig: mocks.config }));
vi.mock("../../../../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("../../../../lib/auth/server", () => ({ verifiedMember: mocks.verified }));
vi.mock("../../../../lib/partner/server", () => ({
  loadPartnerAssistantStatus: mocks.status,
  loadPartnerAssistantRules: mocks.rules,
  loadPartnerIdsByCo: mocks.ids,
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Error(`NEXT_REDIRECT:${to}`);
  },
  unstable_rethrow: () => {},
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../../../auth/actions", () => ({ signOut: vi.fn() }));
// La vista ha i suoi test: qui conta che cosa la pagina le passa.
vi.mock("../../../../components/partner/partner-assistant-view", () => ({
  PartnerAssistantView: () => null,
}));

import PartnerAssistantPage, { dynamic, metadata } from "./page";
import { AccessPanel } from "../../../../components/access-panel";
import { PartnerAssistantView } from "../../../../components/partner/partner-assistant-view";
import { WorkspacePanel } from "../../../../components/workspace-panel";
import { partnerAssistantFixture, partnerFixtureId } from "../../../../lib/partner/fixtures";
import { partnerToday } from "../../../../lib/partner/periods";

type Element = ReactElement<Record<string, unknown>>;
const USER = "00000000-0000-4000-8000-000000000001";

const signedIn = () => {
  vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "");
  mocks.config.mockImplementation(() => ({
    url: "https://example.test",
    publishableKey: "chiave-sintetica",
  }));
  mocks.verified.mockResolvedValue({
    status: "member",
    member: { userId: USER, displayName: "Membro di prova", role: "consultant" },
  });
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "true");
  vi.stubEnv("VERCEL", "");
  for (const mock of [mocks.verified, mocks.status, mocks.rules, mocks.ids]) mock.mockReset();
  mocks.config.mockReset();
  mocks.config.mockImplementation(() => {
    throw Error("Supabase non configurato.");
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("/partner/assistente", () => {
  it("sempre letta al momento, con il titolo «Assistente» come l'h1", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(metadata).toEqual({ title: "Assistente" });
  });

  it("anteprima locale: dati sintetici, senza Supabase e senza utente", async () => {
    const page = (await PartnerAssistantPage()) as Element;
    expect(page.type).toBe(PartnerAssistantView);
    const today = partnerToday();
    const fixture = partnerAssistantFixture(today);
    expect(page.props).toMatchObject({
      status: fixture.status,
      rules: fixture.rules,
      partnerIds: { 1: partnerFixtureId(1) },
      today,
      preview: true,
      userId: null,
    });
    expect(Number.isFinite(Date.parse(page.props.now as string))).toBe(true);
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it("senza configurazione: il pannello comune «da collegare»", async () => {
    vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "");
    const page = (await PartnerAssistantPage()) as Element;
    expect(page.type).toBe(AccessPanel);
    expect(page.props.status).toBe("unconfigured");
  });

  it("membro: stato, regole e gli id delle schede da ridare all'assistente", async () => {
    signedIn();
    const fixture = partnerAssistantFixture("2026-10-22");
    mocks.status.mockResolvedValue(fixture.status);
    mocks.rules.mockResolvedValue(fixture.rules);
    mocks.ids.mockResolvedValue({ 1: partnerFixtureId(1) });
    const page = (await PartnerAssistantPage()) as Element;
    expect(page.type).toBe(PartnerAssistantView);
    expect(page.props).toMatchObject({
      status: fixture.status,
      rules: fixture.rules,
      partnerIds: { 1: partnerFixtureId(1) },
      preview: false,
      userId: USER,
    });
    expect(mocks.ids).toHaveBeenCalledWith(expect.anything(), [1]);
  });

  it("una lettura non riuscita: pannello di avviso, nessun dato parziale", async () => {
    signedIn();
    const fixture = partnerAssistantFixture("2026-10-22");
    for (const fail of [mocks.status, mocks.rules, mocks.ids]) {
      mocks.status.mockResolvedValue(fixture.status);
      mocks.rules.mockResolvedValue(fixture.rules);
      mocks.ids.mockResolvedValue({});
      fail.mockRejectedValue(new Error("lettura"));
      const page = (await PartnerAssistantPage()) as Element;
      expect(page.type).toBe(WorkspacePanel);
      expect(page.props).toMatchObject({ title: "Assistente non disponibile.", tone: "warning" });
    }
  });
});
