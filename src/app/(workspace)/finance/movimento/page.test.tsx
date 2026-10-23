import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  grant: vi.fn(),
  history: vi.fn(),
  profiles: vi.fn(),
  config: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/workspace-panel", () => ({
  WorkspacePanel: ({
    title,
    description,
    children,
  }: {
    title: string;
    description: string;
    children: ReactNode;
  }) => (
    <section>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </section>
  ),
  PanelActions: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/auth-sensitive-area-form", () => ({
  SensitiveAreaSessionBar: ({ area }: { area: string }) => <p data-area-bar={area}>Chiudi</p>,
}));
vi.mock("@/components/finance-revision-editor", () => ({
  FinanceRevisionEditor: () => <div data-protected-history="true">Synthetic editor</div>,
}));
vi.mock("@/lib/auth/server", () => ({ verifiedMember: mocks.member }));
vi.mock("@/lib/auth/model", () => import("../../../../lib/auth/model"));
vi.mock("@/lib/auth/sensitive-access", () => ({ verifiedSensitiveAccess: mocks.grant }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/supabase/config", () => ({ getSupabasePublicConfig: mocks.config }));
vi.mock("@/lib/finance-revisions/model", () => import("../../../../lib/finance-revisions/model"));
vi.mock("@/lib/finance-revisions/server", () => ({ loadFinanceRevisionHistory: mocks.history }));
vi.mock("@/lib/team/read", () => ({ readTeamPages: mocks.profiles }));
vi.mock("@/lib/runtime", () => ({ isLocalPreviewEnabled: () => false }));
import Page, { dynamic } from "./page";
const actor = "91000000-0000-4000-8000-000000000001",
  source = "91000000-0000-4000-8000-000000000002";
const params = () => Promise.resolve({ source_kind: "manual", source_id: source });
beforeEach(() => {
  mocks.member.mockReset().mockResolvedValue({
    status: "member",
    member: { userId: actor, role: "finance", financeAccess: true },
  });
  mocks.grant.mockReset().mockResolvedValue(true);
  mocks.config.mockReset();
  mocks.profiles
    .mockReset()
    .mockResolvedValue([{ user_id: actor, display_name: "Synthetic user" }]);
  mocks.history
    .mockReset()
    .mockResolvedValue({ original: { sourceKind: "manual", sourceId: source }, revisions: [] });
});
describe("Finance editor server page gate", () => {
  it("remains dynamic and redirects locked/signed-out sessions without loading financial data", async () => {
    expect(dynamic).toBe("force-dynamic");
    mocks.member.mockResolvedValue({ status: "signed-out" });
    await expect(Page({ searchParams: params() })).rejects.toThrow("redirect:/auth/login");
    expect(mocks.history).not.toHaveBeenCalled();
    mocks.member.mockResolvedValue({
      status: "member",
      member: { userId: actor, role: "finance", financeAccess: true },
    });
    mocks.grant.mockResolvedValue(false);
    await expect(Page({ searchParams: params() })).rejects.toThrow("redirect:/auth/area/finance");
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.profiles).not.toHaveBeenCalled();
  });
  it.each(["logistics", "consultant"])("does not pass source history to %s", async (role) => {
    mocks.member.mockResolvedValue({
      status: "member",
      member: { userId: actor, role, financeAccess: true },
    });
    const html = renderToStaticMarkup(await Page({ searchParams: params() }));
    expect(html).not.toContain("data-protected-history");
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it("fails closed on unavailable password verification and forged source kinds", async () => {
    mocks.grant.mockRejectedValue(new Error("Private failure"));
    let html = renderToStaticMarkup(await Page({ searchParams: params() }));
    expect(html).not.toContain("data-protected-history");
    expect(html).not.toContain("Private failure");
    expect(mocks.history).not.toHaveBeenCalled();
    mocks.grant.mockResolvedValue(true);
    html = renderToStaticMarkup(
      await Page({
        searchParams: Promise.resolve({ source_kind: "shop_payment", source_id: source }),
      }),
    );
    expect(html).not.toContain("data-protected-history");
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it("loads a complete history only after authorization and hides partial reader failures", async () => {
    const page = (await Page({ searchParams: params() })) as ReactElement<{
      children: ReactElement[];
    }>;
    const [bar, editor] = page.props.children;
    expect(bar!.props).toEqual({ area: "finance" });
    expect(editor!.key).toBe(`${actor}:manual:${source}`);
    expect(renderToStaticMarkup(page)).toContain("data-protected-history");
    expect(renderToStaticMarkup(page)).toContain('<p data-area-bar="finance">Chiudi</p>');
    expect(mocks.history).toHaveBeenCalledWith({}, { sourceKind: "manual", sourceId: source });
    mocks.history.mockRejectedValue(new Error("Private raw source"));
    const html = renderToStaticMarkup(await Page({ searchParams: params() }));
    expect(html).not.toContain("data-protected-history");
    expect(html).not.toContain("Private raw source");
    expect(html).not.toContain("data-area-bar");
  });
});
