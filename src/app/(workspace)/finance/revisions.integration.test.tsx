import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  gate: vi.fn(),
  imports: vi.fn(),
  work: vi.fn(),
  settlements: vi.fn(),
  monthly: vi.fn(),
  legacy: vi.fn(),
  context: vi.fn(),
  preview: vi.fn(),
  history: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw Error(`redirect:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/finance-imports-view", () => ({
  FinanceImportsView: () => <div>Finance completa</div>,
}));
vi.mock("@/components/finance-work-view", () => ({
  FinanceWorkView: () => <div>Registro completo</div>,
}));
vi.mock("@/components/finance-shop-payment-editor", () => ({
  FinanceShopPaymentEditor: () => <div>Editor pagamento</div>,
}));
vi.mock("@/components/consignment-monthly-finance", () => ({
  ConsignmentMonthlyFinance: () => <div>Conto vendita</div>,
  FinancePreviewNotice: () => <div>Anteprima sintetica</div>,
}));
vi.mock("@/components/workspace-panel", () => import("../../../components/workspace-panel"));
vi.mock("@/components/auth-sensitive-area-form", () => ({
  SensitiveAreaSessionBar: ({ area, preview }: { area: string; preview?: boolean }) => (
    <p data-area-bar={area}>{preview ? "Chiusura spenta" : "Chiudi l’area"}</p>
  ),
}));
vi.mock("@/lib/auth/model", () => import("../../../lib/auth/model"));
vi.mock("@/lib/auth/server", () => ({ verifiedMember: mocks.member }));
vi.mock("@/lib/auth/sensitive-access", () => ({ verifiedSensitiveAccess: mocks.gate }));
vi.mock("@/lib/finance/server", () => ({ loadFinanceImports: mocks.imports }));
vi.mock("@/lib/finance/model", () => import("../../../lib/finance/model"));
vi.mock("@/lib/finance/dashboard", () => import("../../../lib/finance/dashboard"));
vi.mock("@/lib/finance/dashboard-server", () => ({ readDashboardSettlements: mocks.settlements }));
vi.mock("@/lib/finance-work/server", () => ({ readFinanceWork: mocks.work }));
vi.mock("@/lib/consignment/shop-finance", () => ({
  readConsignmentMonthlyFinance: mocks.monthly,
  dashboardShopPaymentsFromRows: () => [],
  monthlyFinanceFromRows: () => ({ rows: [], toCollectCents: 0 }),
}));
vi.mock("@/lib/consignment/shop-fixtures", () => ({
  shopFinanceRows: () => ({ reports: [], payments: [], locations: [] }),
}));
vi.mock("@/lib/consignment/finance", () => ({ readConsignmentFinance: mocks.legacy }));
vi.mock("@/lib/finance-revisions/context-server", () => ({
  loadFinanceRevisionContext: mocks.context,
}));
vi.mock("@/lib/finance-revisions/shop-payment-server", () => ({
  loadShopPaymentFinanceHistory: mocks.history,
}));
vi.mock("@/lib/finance-revisions/model", () => import("../../../lib/finance-revisions/model"));
vi.mock("@/lib/team/read", () => ({ readTeamPages: () => Promise.resolve([]) }));
vi.mock("@/lib/runtime", () => ({ isLocalPreviewEnabled: mocks.preview }));
vi.mock("@/lib/supabase/config", () => ({ getSupabasePublicConfig: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => ({}) }));
import FinancePage from "./page";
import FinanceWorkPage from "./work/page";
import ShopPaymentPage from "./incasso/[id]/page";
type Page = ReactElement<{ children: ReactElement<Record<string, unknown>>[] }>;
/** Le pagine Finance aperte sono la striscia «Chiudi Finance» seguita dal contenuto. */
const opened = (page: unknown) => {
  const [bar, content] = (page as Page).props.children;
  expect(bar!.props).toEqual({ area: "finance" });
  return content!;
};
const id = "91000000-0000-4000-8000-000000000001";
const member = {
  userId: id,
  role: "founder",
  financeAccess: true,
  displayName: "Membro sintetico",
};
const work = {
  entries: [],
  facts: [],
  payments: [],
  orders: [],
  refunds: [],
  shopifyFinancials: [],
  shopifyTransactions: [],
};
const context = {
  heads: [{ marker: "correzione sintetica" }],
  originals: [{ marker: "fonte sintetica" }],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview.mockReturnValue(false);
  mocks.member.mockResolvedValue({ status: "member", member });
  mocks.gate.mockResolvedValue(true);
  mocks.imports.mockResolvedValue({ batches: [], transactions: [] });
  mocks.work.mockResolvedValue({ status: "ready", member, snapshot: work });
  mocks.settlements.mockResolvedValue([]);
  mocks.monthly.mockResolvedValue({
    status: "ready",
    snapshot: { rows: [], toCollectCents: 0 },
    shopPayments: [],
    deletedShopPayments: [],
  });
  mocks.legacy.mockResolvedValue({ status: "ready", snapshot: { rows: [] } });
  mocks.context.mockResolvedValue(context);
});
describe("callsite e gate Finance con revisioni", () => {
  it("passa il contesto completo alla dashboard e le teste efficaci al registro manuale", async () => {
    const overview = opened(await FinancePage());
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith({}, []);
    expect(overview.props.revisionHeads).toBe(context.heads);
    expect(overview.props.revisionOriginals).toBe(context.originals);
    expect(overview.props.deletedShopPayments).toEqual([]);
    const registry = opened(await FinanceWorkPage());
    expect(registry.props.revisionHeads).toBe(context.heads);
  });
  it("passa lo storico P3 completo all’editor corretto dopo il gate", async () => {
    const history = {
      paymentId: id,
      version: 2,
      current: { synthetic: true },
      revisions: [{ version: 1 }, { version: 2 }],
    };
    mocks.history.mockResolvedValue(history);
    const editor = opened(await ShopPaymentPage({ params: Promise.resolve({ id }) }));
    expect(editor.key).toBe(`${id}:${id}`);
    expect(mocks.history).toHaveBeenCalledExactlyOnceWith({}, id);
    expect(editor.props.history).toBe(history);
    expect(editor.props.actorId).toBe(id);
  });
  it("non mostra totali parziali se le revisioni non sono leggibili", async () => {
    mocks.context.mockRejectedValue(Error("private SQL"));
    const html = renderToStaticMarkup(await FinancePage());
    expect(html).toContain("Revisioni Finance non disponibili");
    expect(html).not.toContain("data-area-bar");
    expect(html).not.toContain("private SQL");
    expect(html).not.toContain("Finance completa");
  });
  it("il gate scaduto impedisce tutti i caricamenti finanziari e dello storico incassi", async () => {
    mocks.gate.mockResolvedValue(false);
    await expect(FinancePage()).rejects.toThrow("redirect:/auth/area/finance");
    await expect(ShopPaymentPage({ params: Promise.resolve({ id }) })).rejects.toThrow(
      "redirect:/auth/area/finance",
    );
    expect(mocks.imports).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it("nega l’editor incasso ai membri senza accesso Finance prima di leggere la fonte", async () => {
    mocks.member.mockResolvedValue({
      status: "member",
      member: { ...member, role: "consultant", financeAccess: false },
    });
    const html = renderToStaticMarkup(await ShopPaymentPage({ params: Promise.resolve({ id }) }));
    expect(html).toContain("Accesso non disponibile");
    expect(html).not.toContain("data-area-bar");
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it("conserva la preview sintetica senza leggere database o revisioni", async () => {
    mocks.preview.mockReturnValue(true);
    const html = renderToStaticMarkup(await FinancePage());
    expect(html).toContain("Anteprima sintetica");
    expect(html).toContain('<p data-area-bar="finance">Chiusura spenta</p>');
    expect(renderToStaticMarkup(await FinanceWorkPage())).not.toContain("data-area-bar");
    expect(
      renderToStaticMarkup(await ShopPaymentPage({ params: Promise.resolve({ id }) })),
    ).not.toContain("data-area-bar");
    expect(mocks.member).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
  });
});
