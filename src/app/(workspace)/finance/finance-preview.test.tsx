import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  config: vi.fn(() => {
    throw Error("Supabase non configurato.");
  }),
  client: vi.fn(() => {
    throw Error("Nessuna chiamata a Supabase nei test.");
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/supabase/config", () => ({ getSupabasePublicConfig: mocks.config }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/auth/server", () => ({ verifiedMember: vi.fn() }));
vi.mock("@/lib/auth/sensitive-access", () => ({ verifiedSensitiveAccess: vi.fn() }));
vi.mock("@/lib/finance/server", () => ({ loadFinanceImports: vi.fn() }));
vi.mock("@/lib/finance-work/server", () => ({ readFinanceWork: vi.fn() }));
vi.mock("@/lib/finance/dashboard-server", () => ({ readDashboardSettlements: vi.fn() }));
vi.mock("@/lib/finance-revisions/context-server", () => ({ loadFinanceRevisionContext: vi.fn() }));
vi.mock("@/lib/auth/model", () => import("../../../lib/auth/model"));
vi.mock("@/lib/runtime", () => import("../../../lib/runtime"));
vi.mock("@/lib/finance/model", () => import("../../../lib/finance/model"));
vi.mock("@/lib/finance/dashboard", () => import("../../../lib/finance/dashboard"));
vi.mock("@/lib/finance/categories", () => import("../../../lib/finance/categories"));
vi.mock("@/lib/consignment/shop-finance", () => import("../../../lib/consignment/shop-finance"));
vi.mock("@/lib/consignment/shop-fixtures", () => import("../../../lib/consignment/shop-fixtures"));
vi.mock(
  "@/components/finance-imports-view",
  () => import("../../../components/finance-imports-view"),
);
vi.mock(
  "@/components/consignment-monthly-finance",
  () => import("../../../components/consignment-monthly-finance"),
);
vi.mock("@/components/workspace-panel", () => import("../../../components/workspace-panel"));
vi.mock(
  "@/components/auth-sensitive-area-form",
  () => import("../../../components/auth-sensitive-area-form"),
);
vi.mock("@/app/auth/area/[area]/actions", () => ({ lockArea: vi.fn(), unlockArea: vi.fn() }));

import FinancePage from "./page";

const text = async () =>
  renderToStaticMarkup((await FinancePage()) as ReactElement)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "true");
  vi.stubEnv("VERCEL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("anteprima locale di Finance (00-sequenza §1.5)", () => {
  it("in sviluppo mostra il pannello del conto vendita sintetico, senza Supabase", async () => {
    const t = await text();
    expect(t).toContain("Anteprima locale: dati sintetici, salvataggio disattivato.");
    expect(t).toContain("Conto vendita · da incassare");
    expect(t).toContain("Negozio sintetico");
    expect(t).toContain("Pagamento del negozio");
    expect(t).toContain("Anteprima locale: la chiusura di Finance è disattivata.");
    expect(t).not.toContain("aperta su questo dispositivo");
    const html = renderToStaticMarkup((await FinancePage()) as ReactElement);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Chiudi Finance<\/button>/);
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each([
    ["VERCEL", "1"],
    ["NODE_ENV", "production"],
  ])("con %s=%s il ramo dell'anteprima non si attiva", async (name, value) => {
    vi.stubEnv(name, value);
    const t = await text();
    expect(t).toContain("Finance in attesa del collegamento.");
    expect(t).not.toContain("Negozio sintetico");
    expect(t).not.toContain("Chiudi Finance");
    expect(mocks.config).toHaveBeenCalled();
  });
});
