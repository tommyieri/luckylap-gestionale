import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

// /partner: lo stato dell'assistente per la striscia ha un catch proprio e non oscura la pagina.
const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  workspace: vi.fn(),
  detail: vi.fn(),
  status: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../../auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("@/components/access-panel", () => import("../../../components/access-panel"));
// La pagina ha i suoi test: qui conta che cosa la pagina le passa.
vi.mock("@/components/partner/partner-workspace", () => ({ PartnerWorkspace: () => null }));
vi.mock("@/components/refresh-button", () => import("../../../components/refresh-button"));
vi.mock("@/components/workspace-panel", () => import("../../../components/workspace-panel"));
vi.mock("@/lib/auth/current-member", () => ({ requireMember: mocks.member }));
vi.mock("@/lib/partner/fixtures", () => import("../../../lib/partner/fixtures"));
vi.mock("@/lib/partner/model", () => import("../../../lib/partner/model"));
vi.mock("@/lib/partner/periods", () => import("../../../lib/partner/periods"));
vi.mock("@/lib/partner/server", () => ({
  loadPartnerWorkspace: mocks.workspace,
  loadPartnerDetail: mocks.detail,
  loadPartnerAssistantStatus: mocks.status,
}));

import PartnerPage from "./page";
import { PartnerWorkspace } from "@/components/partner/partner-workspace";
import { WorkspacePanel } from "@/components/workspace-panel";
import {
  partnerAssistantFixture,
  partnerFixtureDetail,
  partnerFixtureWorkspace,
} from "../../../lib/partner/fixtures";
import { partnerToday } from "../../../lib/partner/periods";

type Element = ReactElement<Record<string, unknown>>;
const USER = "00000000-0000-4000-8000-000000000001";
const TODAY = "2026-10-22";
const supabase = { sintetico: true };

const open = (params: Record<string, string> = {}) =>
  PartnerPage({ searchParams: Promise.resolve(params) }) as Promise<Element>;

function signedIn() {
  mocks.member.mockResolvedValue({
    status: "member",
    member: { userId: USER, displayName: "Membro di prova", role: "consultant" },
    supabase,
  });
  mocks.workspace.mockResolvedValue(partnerFixtureWorkspace(TODAY));
  mocks.detail.mockResolvedValue(partnerFixtureDetail(2, TODAY));
  mocks.status.mockResolvedValue(partnerAssistantFixture(TODAY).status);
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "true");
  vi.stubEnv("VERCEL", "");
  for (const mock of Object.values(mocks)) mock.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("/partner", () => {
  it("anteprima locale: lo stato sintetico dell'assistente, senza letture", async () => {
    mocks.member.mockResolvedValue({ status: "preview" });
    const page = await open();
    expect(page.type).toBe(PartnerWorkspace);
    expect(page.props).toMatchObject({
      assistant: partnerAssistantFixture(partnerToday()).status,
      preview: true,
    });
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it("membro: contatti, scheda e stato dell'assistente letti insieme", async () => {
    signedIn();
    const page = await open({ co: "2" });
    expect(page.type).toBe(PartnerWorkspace);
    expect(page.props).toMatchObject({
      workspace: partnerFixtureWorkspace(TODAY),
      detail: partnerFixtureDetail(2, TODAY),
      assistant: partnerAssistantFixture(TODAY).status,
      preview: false,
      memberId: USER,
    });
    expect(mocks.status).toHaveBeenCalledExactlyOnceWith(supabase);
    expect(mocks.detail).toHaveBeenCalledWith(supabase, 2);
  });

  it("stato dell'assistente non leggibile: la pagina Partner si vede lo stesso", async () => {
    signedIn();
    mocks.status.mockRejectedValue(new Error("Partner non disponibile"));
    const page = await open({ co: "2" });
    expect(page.type).toBe(PartnerWorkspace);
    expect(page.props).toMatchObject({
      workspace: partnerFixtureWorkspace(TODAY),
      detail: partnerFixtureDetail(2, TODAY),
      assistant: null,
    });
  });

  it("contatti non leggibili: il pannello di avviso, anche con lo stato dell'assistente letto", async () => {
    signedIn();
    mocks.workspace.mockRejectedValue(new Error("Partner non disponibile"));
    const page = await open();
    expect(page.type).toBe(WorkspacePanel);
    expect(page.props).toMatchObject({ title: "Partner non disponibile.", tone: "warning" });
    // Anche con tutte e due le letture non riuscite: nessun rifiuto lasciato senza catch.
    mocks.status.mockRejectedValue(new Error("Partner non disponibile"));
    expect(((await open()) as Element).type).toBe(WorkspacePanel);
  });
});
