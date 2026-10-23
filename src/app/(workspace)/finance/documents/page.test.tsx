import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/finance.module.css", () => ({
  default: new Proxy({}, { get: (_target, name) => String(name) }),
}));
vi.mock("@/components/workspace-panel", () => import("../../../../components/workspace-panel"));
vi.mock("@/components/auth-sensitive-area-form", () => ({
  SensitiveAreaSessionBar: ({ area }: { area: string }) => <p data-area-bar={area}>Chiudi</p>,
}));
vi.mock("@/lib/finance/document-access", () => ({ financeDocumentAccess: mocks.access }));
vi.mock("@/lib/finance/documents", () => import("../../../../lib/finance/documents"));
import FinanceDocumentsPage from "./page";

const sha256 = "a".repeat(64);
const row = {
  id: "91000000-0000-4000-8000-000000000001",
  source_kind: "recap",
  file_name: "recap-sintetico.pdf",
  storage_path: `sources/${sha256}/recap-sintetico.pdf`,
  sha256,
  byte_size: 1024,
  content_type: "application/pdf",
  review_status: "unreviewed",
};
/** Client Supabase sintetico: una sola lettura di `finance_documents`. */
const supabase = (rows: unknown[], error: unknown = null) => {
  const query = {
    select: () => query,
    order: () => query,
    limit: async () => ({ data: rows, count: rows.length, error }),
  };
  return { from: vi.fn(() => query) };
};

beforeEach(() => vi.clearAllMocks());

describe("/finance/documents e «Chiudi Finance» (06 R12)", () => {
  it("con Finance aperta la striscia di chiusura sta in cima, sopra il titolo", async () => {
    mocks.access.mockResolvedValue({ allowed: true, supabase: supabase([row]), member: {} });
    const html = renderToStaticMarkup(await FinanceDocumentsPage());
    const bar = html.indexOf('<p data-area-bar="finance">Chiudi</p>');
    expect(bar).toBeGreaterThan(-1);
    expect(bar).toBeLessThan(html.indexOf("<h1>Documenti</h1>"));
    expect(html).toContain("recap-sintetico.pdf");
  });

  it("con Finance chiusa o una lettura incompleta la striscia non compare", async () => {
    mocks.access.mockResolvedValue({ allowed: false, status: 403 });
    let html = renderToStaticMarkup(await FinanceDocumentsPage());
    expect(html).toContain("Documenti Finance riservati.");
    expect(html).not.toContain("data-area-bar");
    mocks.access.mockResolvedValue({
      allowed: true,
      supabase: supabase([], new Error("lettura privata")),
      member: {},
    });
    html = renderToStaticMarkup(await FinanceDocumentsPage());
    expect(html).toContain("Documenti non disponibili.");
    expect(html).not.toContain("data-area-bar");
    expect(html).not.toContain("lettura privata");
  });

  it("senza sessione porta al login, senza leggere i documenti", async () => {
    mocks.access.mockResolvedValue({ allowed: false, status: 401 });
    await expect(FinanceDocumentsPage()).rejects.toThrow("redirect:/auth/login");
  });
});
