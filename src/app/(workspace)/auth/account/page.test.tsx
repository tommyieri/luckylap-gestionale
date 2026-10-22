import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  verified: vi.fn(),
  sensitive: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../../../../lib/supabase/config", () => ({
  getSupabasePublicConfig: () => ({ url: "https://example.test", publishableKey: "sintetica" }),
}));
vi.mock("../../../../lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({}),
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
});
