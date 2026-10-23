import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({ verified: vi.fn(), sensitive: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../../../../lib/supabase/config", () => ({
  getSupabasePublicConfig: () => ({ url: "https://example.test", publishableKey: "sintetica" }),
}));
vi.mock("../../../../../lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("../../../../../lib/auth/server", () => ({ verifiedMember: mocks.verified }));
vi.mock("../../../../../lib/auth/sensitive-access", () => ({
  verifiedSensitiveAccess: mocks.sensitive,
}));
vi.mock("../../../../../components/auth-sensitive-area-form", () => ({
  SensitiveAreaForm: () => null,
  SensitiveAreaLockForm: () => null,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw Error(`NEXT_REDIRECT:${to}`);
  },
}));

import SensitiveAreaPage from "./page";

type Element = ReactElement<{ title: string; description: string }>;
const open = async (area: string) =>
  (await SensitiveAreaPage({ params: Promise.resolve({ area }) })) as Element;

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

describe("/auth/area/[area]", () => {
  it("Finance chiusa spiega quale password serve e quanto resta aperta", async () => {
    const page = await open("finance");
    expect(page.props.title).toBe("Apri Finance");
    expect(page.props.description).toBe(
      "Inserisci la password Finance. Resta aperta su questo dispositivo fino a 8 ore.",
    );
  });
  it("Controllo CEO chiuso e Finance aperta mantengono i loro testi", async () => {
    expect((await open("audit")).props.description).toMatch(/password aggiuntiva/);
    mocks.sensitive.mockResolvedValue(true);
    expect((await open("finance")).props.description).toMatch(/aperta per questa sessione/);
  });
});
