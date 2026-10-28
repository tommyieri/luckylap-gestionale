import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

// /partner: lo stato dell'assistente per la striscia ha un catch proprio e non oscura la pagina.
const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  workspace: vi.fn(),
  detail: vi.fn(),
  status: vi.fn(),
  send: vi.fn(),
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
vi.mock(
  "@/lib/partner-assistant/mail-config",
  () => import("../../../lib/partner-assistant/mail-config"),
);
vi.mock("@/lib/partner/model", () => import("../../../lib/partner/model"));
vi.mock("@/lib/partner/periods", () => import("../../../lib/partner/periods"));
vi.mock("@/lib/partner/server", () => ({
  loadPartnerWorkspace: mocks.workspace,
  loadPartnerDetail: mocks.detail,
  loadPartnerAssistantStatus: mocks.status,
  loadPartnerAssistantSend: mocks.send,
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

function signedIn(role = "consultant") {
  mocks.member.mockResolvedValue({
    status: "member",
    member: { userId: USER, displayName: "Membro di prova", role },
    supabase,
  });
  mocks.workspace.mockResolvedValue(partnerFixtureWorkspace(TODAY));
  mocks.detail.mockResolvedValue(partnerFixtureDetail(2, TODAY));
  mocks.status.mockResolvedValue(partnerAssistantFixture(TODAY).status);
  mocks.send.mockResolvedValue(partnerAssistantFixture(TODAY).send);
}

/** La posta dell'assistente con valori sintetici. */
const mailEnv = () => {
  vi.stubEnv("PARTNER_MAIL_USER", "casella@luckylap.example.test");
  vi.stubEnv("PARTNER_MAIL_PASSWORD", "synthetic-password");
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "true");
  vi.stubEnv("VERCEL", "");
  for (const key of [
    "PARTNER_MAIL_USER",
    "PARTNER_MAIL_PASSWORD",
    "PARTNER_MAIL_FROM_NAME",
    "PARTNER_TEST_TO",
    "PARTNER_MAIL_SMTP_HOST",
    "PARTNER_MAIL_IMAP_HOST",
  ])
    vi.stubEnv(key, "");
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
      send: partnerAssistantFixture(partnerToday()).send,
      // In anteprima si vede tutto, con i comandi spenti.
      mailConfigured: true,
      founder: true,
      preview: true,
    });
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
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
      send: partnerAssistantFixture(TODAY).send,
      mailConfigured: false,
      founder: false,
      preview: false,
      memberId: USER,
    });
    expect(mocks.status).toHaveBeenCalledExactlyOnceWith(supabase);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(supabase);
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

  it("Tommi con la posta configurata: founder e posta passati alla pagina", async () => {
    signedIn("founder");
    mailEnv();
    const page = await open();
    expect(page.props).toMatchObject({ mailConfigured: true, founder: true });
  });

  it("stato dell'invio non leggibile: la pagina si vede, la striscia lo dice", async () => {
    signedIn();
    mocks.send.mockRejectedValue(new Error("Partner non disponibile"));
    const page = await open({ co: "2" });
    expect(page.type).toBe(PartnerWorkspace);
    expect(page.props).toMatchObject({
      assistant: partnerAssistantFixture(TODAY).status,
      send: null,
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
    mocks.send.mockRejectedValue(new Error("Partner non disponibile"));
    expect(((await open()) as Element).type).toBe(WorkspacePanel);
  });
});
