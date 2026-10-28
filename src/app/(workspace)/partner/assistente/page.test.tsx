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
  send: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../../../../lib/supabase/config", () => ({ getSupabasePublicConfig: mocks.config }));
vi.mock("../../../../lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("../../../../lib/auth/server", () => ({ verifiedMember: mocks.verified }));
vi.mock("../../../../lib/partner/server", () => ({
  loadPartnerAssistantStatus: mocks.status,
  loadPartnerAssistantRules: mocks.rules,
  loadPartnerIdsByCo: mocks.ids,
  loadPartnerAssistantSend: mocks.send,
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

const signedIn = (role = "consultant") => {
  vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "");
  mocks.config.mockImplementation(() => ({
    url: "https://example.test",
    publishableKey: "chiave-sintetica",
  }));
  mocks.verified.mockResolvedValue({
    status: "member",
    member: { userId: USER, displayName: "Membro di prova", role },
  });
};

/** Le variabili dell'assistente e della posta, tutte sintetiche. */
const ENV_KEYS = [
  "PARTNER_ASSISTANT_ENABLED",
  "PARTNER_ASSISTANT_SECRET",
  "ANTHROPIC_API_KEY",
  "PARTNER_ASSISTANT_SUPABASE_SECRET_KEY",
  "PARTNER_ASSISTANT_PHONE",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "PARTNER_MAIL_USER",
  "PARTNER_MAIL_PASSWORD",
  "PARTNER_MAIL_FROM_NAME",
  "PARTNER_TEST_TO",
  "PARTNER_MAIL_SMTP_HOST",
  "PARTNER_MAIL_IMAP_HOST",
];
const fullEnv = () => {
  vi.stubEnv("PARTNER_ASSISTANT_ENABLED", "true");
  vi.stubEnv("PARTNER_ASSISTANT_SECRET", "synthetic-partner-assistant-secret-0000");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-synthetic-0000000000000000");
  vi.stubEnv("PARTNER_ASSISTANT_SUPABASE_SECRET_KEY", "sb_secret_synthetic-partner-assistant");
  vi.stubEnv("PARTNER_ASSISTANT_PHONE", "+39 000 000 0000");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_synthetic-shopify-worker");
  vi.stubEnv("PARTNER_MAIL_USER", "casella@luckylap.example.test");
  vi.stubEnv("PARTNER_MAIL_PASSWORD", "synthetic-password");
  vi.stubEnv("PARTNER_TEST_TO", "prova1@example.test,prova2@example.test");
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "true");
  vi.stubEnv("VERCEL", "");
  for (const key of ENV_KEYS) vi.stubEnv(key, "");
  for (const mock of [mocks.verified, mocks.status, mocks.rules, mocks.ids, mocks.send])
    mock.mockReset();
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
      send: fixture.send,
      rules: fixture.rules,
      partnerIds: { 1: partnerFixtureId(1) },
      today,
      preview: true,
      userId: null,
      // In anteprima si vede tutto, con i comandi spenti.
      founder: true,
      mail: { configured: true, testRecipients: 1, assistantConfigured: true },
    });
    expect(Number.isFinite(Date.parse(page.props.now as string))).toBe(true);
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
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
    mocks.send.mockResolvedValue(fixture.send);
    const page = (await PartnerAssistantPage()) as Element;
    expect(page.type).toBe(PartnerAssistantView);
    expect(page.props).toMatchObject({
      status: fixture.status,
      send: fixture.send,
      rules: fixture.rules,
      partnerIds: { 1: partnerFixtureId(1) },
      preview: false,
      userId: USER,
      founder: false,
      // Senza variabili: niente posta, niente indirizzi di prova, assistente non configurato.
      mail: { configured: false, testRecipients: 0, assistantConfigured: false },
    });
    expect(mocks.ids).toHaveBeenCalledWith(expect.anything(), [1]);
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it("Tommi con le variabili valide: posta, due indirizzi di prova, assistente configurato", async () => {
    signedIn("founder");
    fullEnv();
    const fixture = partnerAssistantFixture("2026-10-22");
    mocks.status.mockResolvedValue(fixture.status);
    mocks.rules.mockResolvedValue(fixture.rules);
    mocks.ids.mockResolvedValue({});
    mocks.send.mockResolvedValue(fixture.send);
    const page = (await PartnerAssistantPage()) as Element;
    expect(page.props).toMatchObject({
      founder: true,
      mail: { configured: true, testRecipients: 2, assistantConfigured: true },
    });
    // Mai i valori delle variabili nelle props della vista.
    const props = JSON.stringify(page.props);
    for (const value of ["example.test", "synthetic-password", "sk-ant-", "sb_secret_"])
      expect(props).not.toContain(value);
  });

  it("stato dell'invio non leggibile: la pagina si vede, con l'invio a null", async () => {
    signedIn();
    const fixture = partnerAssistantFixture("2026-10-22");
    mocks.status.mockResolvedValue(fixture.status);
    mocks.rules.mockResolvedValue(fixture.rules);
    mocks.ids.mockResolvedValue({});
    mocks.send.mockRejectedValue(new Error("lettura"));
    const page = (await PartnerAssistantPage()) as Element;
    expect(page.type).toBe(PartnerAssistantView);
    expect(page.props).toMatchObject({ status: fixture.status, send: null });
  });

  it("migrazioni non ancora applicate: pannello neutro «non ancora attivo», senza ambra", async () => {
    signedIn();
    mocks.status.mockResolvedValue("non_attivo");
    // Senza le tabelle anche le regole non si leggono: non è un errore da ricaricare.
    mocks.rules.mockRejectedValue(new Error("tabella mancante"));
    // E nemmeno lo stato dell'invio: la funzione non c'è ancora.
    mocks.send.mockRejectedValue(new Error("funzione mancante"));
    const page = (await PartnerAssistantPage()) as Element;
    expect(page.type).toBe(WorkspacePanel);
    expect(page.props.title).toBe("Assistente non ancora attivo.");
    expect(page.props.tone).toBeUndefined();
    expect(String(page.props.description)).toContain("Tommi");
    expect(mocks.ids).not.toHaveBeenCalled();
  });

  it("una lettura non riuscita: pannello di avviso, nessun dato parziale", async () => {
    signedIn();
    const fixture = partnerAssistantFixture("2026-10-22");
    for (const fail of [mocks.status, mocks.rules, mocks.ids]) {
      mocks.send.mockResolvedValue(fixture.send);
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
