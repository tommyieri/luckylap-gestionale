import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  config: vi.fn(() => {
    throw Error("Supabase non configurato.");
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("../../../../lib/supabase/config", () => ({ getSupabasePublicConfig: mocks.config }));
vi.mock("../../../../lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(() => {
    throw Error("Nessuna chiamata a Supabase nei test.");
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw Error(`NEXT_REDIRECT:${to}`);
  },
  unstable_rethrow: () => {},
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../../../auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("./actions", () => ({ runRestockCommand: vi.fn() }));

import RestockPage from "./page";
import RestockOrderPage, { generateMetadata } from "./[id]/page";
import { RestockList } from "../../../../components/restock-list";
import { RestockDetail } from "../../../../components/restock-detail";
import { AccessPanel } from "../../../../components/access-panel";
import { rx } from "../../../../lib/restock/fixtures";

const params = <T,>(value: T) => ({ params: Promise.resolve(value) });

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "true");
  vi.stubEnv("VERCEL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("anteprima locale del riassortimento", () => {
  it("in sviluppo legge i dati sintetici, mai Supabase", async () => {
    const list = (await RestockPage()) as ReactElement<Record<string, unknown>>;
    expect(list.type).toBe(RestockList);
    expect(list.props.preview).toBe(true);
    const detail = (await RestockOrderPage(params({ id: rx.quality }))) as ReactElement<
      Record<string, unknown>
    >;
    expect(detail.type).toBe(RestockDetail);
    expect(detail.props.preview).toBe(true);
    expect(await generateMetadata(params({ id: rx.quality.toUpperCase() }))).toEqual({
      title: "Riordine sintetico di ottobre",
    });
    expect(mocks.config).not.toHaveBeenCalled();
  });

  it.each([
    ["VERCEL", "1"],
    ["NODE_ENV", "production"],
  ])("con %s=%s il ramo dell'anteprima non si attiva", async (name, value) => {
    vi.stubEnv(name, value);
    const list = (await RestockPage()) as ReactElement<Record<string, unknown>>;
    expect(list.type).toBe(AccessPanel);
    expect(list.props.status).toBe("unconfigured");
    const detail = (await RestockOrderPage(params({ id: rx.quality }))) as ReactElement<
      Record<string, unknown>
    >;
    expect(detail.type).toBe(AccessPanel);
  });

  it("riordine sconosciuto o indirizzo scritto male: pagina non trovata, con il titolo giusto", async () => {
    for (const id of ["95000000-0000-4000-8000-999999999999", "non-un-id"]) {
      await expect(RestockOrderPage(params({ id }))).rejects.toThrow("NEXT_NOT_FOUND");
      expect(await generateMetadata(params({ id }))).toEqual({ title: "Pagina non trovata" });
    }
  });
});
