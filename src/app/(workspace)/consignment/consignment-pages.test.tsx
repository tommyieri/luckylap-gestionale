import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  config: vi.fn(() => {
    throw Error("Supabase non configurato.");
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("../../../lib/supabase/config", () => ({ getSupabasePublicConfig: mocks.config }));
vi.mock("../../../lib/supabase/server", () => ({
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
vi.mock("../../auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("../../consignment/actions", () => ({
  runShopCommand: vi.fn(),
  runConsignmentCommand: vi.fn(),
}));

import ConsignmentPage from "./page";
import ShopPage, { generateMetadata as shopMetadata } from "./[code]/page";
import ReportPage, { generateMetadata as reportMetadata } from "./[code]/resoconto/[month]/page";
import { ConsignmentShops } from "../../../components/consignment-shops";
import { ShopFrame } from "../../../components/consignment-shop";
import { AccessPanel } from "../../../components/access-panel";

const params = <T,>(value: T) => ({ params: Promise.resolve(value) });

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "true");
  vi.stubEnv("VERCEL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("anteprima locale del conto vendita (00-sequenza §1.5)", () => {
  it("in sviluppo legge i dati sintetici, mai Supabase", async () => {
    const list = (await ConsignmentPage()) as ReactElement<Record<string, unknown>>;
    expect(list.type).toBe(ConsignmentShops);
    expect(list.props.preview).toBe(true);
    const shop = (await ShopPage(params({ code: "neg01" }))) as ReactElement<
      Record<string, unknown>
    >;
    expect(shop.type).toBe(ShopFrame);
    expect(shop.props).toMatchObject({ preview: true, title: "Negozio sintetico" });
    expect(mocks.config).not.toHaveBeenCalled();
  });

  it.each([
    ["VERCEL", "1"],
    ["NODE_ENV", "production"],
  ])("con %s=%s il ramo dell'anteprima non si attiva", async (name, value) => {
    vi.stubEnv(name, value);
    const list = (await ConsignmentPage()) as ReactElement<Record<string, unknown>>;
    expect(list.type).toBe(AccessPanel);
    expect(list.props.status).toBe("unconfigured");
    const shop = (await ShopPage(params({ code: "NEG01" }))) as ReactElement<
      Record<string, unknown>
    >;
    expect(shop.type).toBe(AccessPanel);
  });

  it("codice sconosciuto o mese scritto male: pagina non trovata, con il titolo giusto", async () => {
    await expect(ShopPage(params({ code: "NEG09" }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(ShopPage(params({ code: "neg-01" }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(ReportPage(params({ code: "NEG01", month: "2026-13" }))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(await shopMetadata(params({ code: "NEG09" }))).toEqual({ title: "Pagina non trovata" });
    expect(await shopMetadata(params({ code: "NEG01" }))).toEqual({ title: "Negozio sintetico" });
    expect(await reportMetadata(params({ code: "NEG01", month: "2026-09" }))).toEqual({
      title: "Resoconto di settembre 2026",
    });
    expect(await reportMetadata(params({ code: "NEG01", month: "09-2026" }))).toEqual({
      title: "Pagina non trovata",
    });
  });
});

describe("parole del conto vendita", () => {
  const SRC = join(__dirname, "..", "..", "..");
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
    );
  const ui = [
    ...files(join(SRC, "app", "(workspace)", "consignment")),
    ...files(join(SRC, "components")).filter((f) =>
      /consignment-(shops|shop|stock-grid|count-form|report|order|shop-settings|pending|monthly-finance)\.tsx$/.test(
        f,
      ),
    ),
    join(SRC, "lib", "consignment", "shop-model.ts"),
    join(SRC, "lib", "consignment", "shop-read.ts"),
    join(SRC, "lib", "consignment", "shop-server.ts"),
  ].filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f));

  it("nessuna parola vietata nell'interfaccia (affido, rientro, vendita dichiarata, regolamento, credito commerciale)", () => {
    expect(ui.length).toBeGreaterThan(20);
    const forbidden = /affid|rientr|vendit[ae] dichiarat|regolament|credito commerciale/i;
    const found = ui.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => forbidden.test(line))
        .map(({ line, index }) => `${relative(SRC, file)}:${index + 1}: ${line.trim()}`),
    );
    expect(found).toEqual([]);
  });

  it("nessun «Magadzino» nei file nuovi", () => {
    expect(ui.filter((file) => /magadzino/i.test(readFileSync(file, "utf8")))).toEqual([]);
  });
});
