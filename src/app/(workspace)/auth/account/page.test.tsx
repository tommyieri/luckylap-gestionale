import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  verified: vi.fn(),
  sensitive: vi.fn(),
  config: vi.fn(() => ({ url: "https://example.test", publishableKey: "sintetica" })),
  client: vi.fn(async () => ({})),
}));
vi.mock("server-only", () => ({}));
vi.mock("../../../../lib/supabase/config", () => ({
  getSupabasePublicConfig: mocks.config,
}));
vi.mock("../../../../lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.client,
}));
vi.mock("../../../../lib/auth/server", () => ({ verifiedMember: mocks.verified }));
vi.mock("../../../../lib/auth/sensitive-access", () => ({
  verifiedSensitiveAccess: mocks.sensitive,
}));
vi.mock("../../../auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("../../../../components/auth-sensitive-area-form", () => ({
  SensitiveAreaLockForm: ({ area }: { area: string }) => <p>Chiudi {area}</p>,
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Error(`NEXT_REDIRECT:${to}`);
  },
}));

import AccountPage from "./page";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const render = async () => renderToStaticMarkup((await AccountPage()) as ReactElement);

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "");
  vi.clearAllMocks();
  mocks.verified.mockResolvedValue({
    status: "member",
    member: {
      userId: "00000000-0000-4000-8000-000000000001",
      displayName: "Membro sintetico",
      role: "founder",
      financeAccess: false,
    },
  });
  mocks.sensitive.mockResolvedValue(false);
});
afterEach(() => vi.unstubAllEnvs());

describe("/auth/account", () => {
  it("la password personale è un link secondario, con l'avviso sotto (06 R13)", async () => {
    const html = await render();
    expect(html).not.toContain("Imposta password del tuo account");
    expect(html).toMatch(
      /<a[^>]*class="text-button"[^>]*href="\/auth\/password"|<a[^>]*href="\/auth\/password"[^>]*class="text-button"/,
    );
    const copy = text(html);
    expect(copy).toContain("Cambia la tua password");
    expect(copy.indexOf("Cambia la tua password")).toBeLessThan(
      copy.indexOf(
        "Di solito non serve: la password è la stessa per tutto il team. Se la cambi, vale solo per te. Avvisa Tommi.",
      ),
    );
    expect(html).toMatch(/href="\/guida"/);
  });

  it("le aree chiuse dicono quale password serve", async () => {
    const copy = text(await render());
    expect(copy).toContain("Finance Chiusa. Serve la password Finance.");
    expect(copy).toContain("Controllo CEO Chiusa. Serve la password CEO scelta da Tommi.");
    expect(copy).not.toContain("Area chiusa.");
  });

  it("in anteprima locale mostra un account sintetico con le aree chiuse, senza Supabase", async () => {
    vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "true");
    vi.stubEnv("VERCEL", "");
    const html = await render();
    const copy = text(html);
    expect(copy).toContain("Anteprima locale: dati sintetici, salvataggio disattivato.");
    expect(copy).toContain("Accesso di Tommi (anteprima).");
    expect(copy).toContain("Finance Chiusa. Serve la password Finance.");
    expect(copy).toContain("Controllo CEO Chiusa. Serve la password CEO scelta da Tommi.");
    expect(html).not.toContain("<form");
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.verified).not.toHaveBeenCalled();
    expect(mocks.sensitive).not.toHaveBeenCalled();
  });

  it.each([
    ["VERCEL", "1"],
    ["NODE_ENV", "production"],
  ])("con %s=%s il ramo dell'anteprima non si attiva", async (name, value) => {
    vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "true");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv(name, value);
    const copy = text(await render());
    expect(copy).not.toContain("Anteprima locale");
    expect(copy).toContain("Accesso di Membro sintetico.");
    expect(mocks.verified).toHaveBeenCalled();
  });
});
