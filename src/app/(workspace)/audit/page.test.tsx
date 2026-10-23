import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VerifiedMember } from "../../../lib/auth/model";

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  client: vi.fn(),
  member: vi.fn(),
  feed: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/audit-view", () => import("../../../components/audit-view"));
vi.mock("@/components/workspace-panel", () => import("../../../components/workspace-panel"));
vi.mock("@/components/auth-sensitive-area-form", () => ({
  SensitiveAreaSessionBar: ({ area }: { area: string }) => <p data-area-bar={area}>Chiudi</p>,
}));
vi.mock("@/lib/auth/model", () => import("../../../lib/auth/model"));
vi.mock("@/lib/auth/sensitive-access", () => import("../../../lib/auth/sensitive-access"));
vi.mock("@/lib/auth/server", () => ({ verifiedMember: mocks.member }));
vi.mock("@/lib/audit/feed-model", () => import("../../../lib/audit/feed-model"));
vi.mock("@/lib/audit/feed-server", () => ({ loadActivityFeed: mocks.feed }));
vi.mock("@/lib/supabase/config", () => ({ getSupabasePublicConfig: mocks.config }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
import AuditPage from "./page";

const founder: VerifiedMember = {
  userId: "10000000-0000-4000-8000-000000000001",
  displayName: "Founder sintetico",
  role: "founder",
  financeAccess: true,
};
const expiresAt = new Date("2026-10-22T16:00:00Z").getTime();
const rpc = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T08:00:00Z"));
  mocks.config.mockReturnValue({});
  rpc.mockImplementation(async () => ({ data: Date.now() < expiresAt, error: null }));
  mocks.client.mockResolvedValue({ rpc });
  mocks.member.mockResolvedValue({ status: "member", member: founder });
  mocks.feed.mockResolvedValue({ items: [], actors: [], nextCursor: null, hasCursor: false });
});
afterEach(() => vi.useRealTimers());

describe("accesso e caricamento del feed CEO", () => {
  it.each(["founder", "production", "finance", "logistics", "consultant"] as const)(
    "rimanda %s alla password prima di leggere il feed se la sua area è chiusa",
    async (role) => {
      mocks.member.mockResolvedValue({
        status: "member",
        member: { ...founder, role, financeAccess: false },
      });
      rpc.mockResolvedValue({ data: false, error: null });
      await expect(AuditPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
        "redirect:/auth/area/audit",
      );
      expect(rpc).toHaveBeenCalledExactlyOnceWith("sensitive_area_status", { p_area: "audit" });
      expect(mocks.feed).not.toHaveBeenCalled();
    },
  );
  it.each(["founder", "production", "finance", "logistics", "consultant"] as const)(
    "apre il feed a %s soltanto dopo il grant CEO corrente",
    async (role) => {
      const member = { ...founder, role, financeAccess: false };
      mocks.member.mockResolvedValue({ status: "member", member });
      const html = renderToStaticMarkup(await AuditPage({ searchParams: Promise.resolve({}) }));
      expect(html).toContain('data-area-bar="audit"');
      expect(rpc).toHaveBeenCalledExactlyOnceWith("sensitive_area_status", { p_area: "audit" });
      expect(mocks.feed).toHaveBeenCalledExactlyOnceWith({ rpc }, member, true, {
        actor: null,
        area: null,
        before: null,
      });
      expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.feed.mock.invocationCallOrder[0]);
    },
  );
  it.each(["signed-out", "denied", "unavailable"])(
    "non carica la sessione riservata o il feed se la membership corrente è %s",
    async (status) => {
      mocks.member.mockResolvedValue({ status });
      if (status === "signed-out")
        await expect(AuditPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
          "redirect:/auth/login",
        );
      else
        expect(
          renderToStaticMarkup(await AuditPage({ searchParams: Promise.resolve({}) })),
        ).not.toContain("data-area-bar");
      expect(rpc).not.toHaveBeenCalled();
      expect(mocks.feed).not.toHaveBeenCalled();
    },
  );
  it("a otto ore ricontrolla il gate DB e rimanda allo sblocco senza caricare dati", async () => {
    vi.setSystemTime(expiresAt);
    await expect(AuditPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "redirect:/auth/area/audit",
    );
    expect(rpc).toHaveBeenCalledExactlyOnceWith("sensitive_area_status", { p_area: "audit" });
    expect(mocks.feed).not.toHaveBeenCalled();
  });

  it("passa filtri e cursore integri al loader soltanto dopo il gate fresco", async () => {
    const search = {
      actor: "system",
      area: "team",
      beforeAt: "2026-10-21T12:00:00.123456Z",
      beforeId: "20000000-0000-4000-8000-000000000001",
    };
    const html = renderToStaticMarkup(await AuditPage({ searchParams: Promise.resolve(search) }));
    expect(mocks.feed).toHaveBeenCalledExactlyOnceWith({ rpc }, founder, true, {
      actor: "system",
      area: "team",
      before: { occurredAt: search.beforeAt, id: search.beforeId },
    });
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.feed.mock.invocationCallOrder[0]);
    expect(html).toContain("Nessuna attività per questi filtri.");
    // «Chiudi Controllo CEO» in cima, prima del titolo, solo con l'area aperta (06 R12).
    expect(html.indexOf('<p data-area-bar="audit">Chiudi</p>')).toBe(0);
    expect(html.indexOf("<h1>Controllo CEO</h1>")).toBeGreaterThan(0);
  });

  it("mostra uno stato di errore sicuro se il gate DB del loader rifiuta la lettura", async () => {
    mocks.feed.mockRejectedValue(new Error("audit_logs old_data private.can_audit denied"));
    const html = renderToStaticMarkup(await AuditPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Attività non disponibili.");
    expect(html).not.toMatch(/audit_logs|old_data|can_audit|denied|Nessuna attività/);
    expect(html).not.toContain("data-area-bar");
  });

  it("rifiuta i parametri non validi senza leggere il feed", async () => {
    const html = renderToStaticMarkup(
      await AuditPage({ searchParams: Promise.resolve({ actor: "not-an-actor" }) }),
    );
    expect(html).toContain("Il collegamento alle attività non è valido.");
    expect(mocks.feed).not.toHaveBeenCalled();
  });
});
