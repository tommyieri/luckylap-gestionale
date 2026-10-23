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
import StockListPage from "../stock/conto-vendita/page";
import StockShopPage, {
  generateMetadata as stockShopMetadata,
} from "../stock/conto-vendita/[code]/page";
import CountPage, {
  generateMetadata as countMetadata,
} from "../stock/conto-vendita/[code]/conta/page";
import OrderPage, {
  generateMetadata as orderMetadata,
} from "../stock/conto-vendita/[code]/ordini/[order]/page";
import SettingsPage from "../stock/conto-vendita/[code]/impostazioni/page";
import NewShopPage from "../stock/conto-vendita/nuovo/page";
import { ConsignmentShops } from "../../../components/consignment-shops";
import {
  ConsignmentShopSales,
  ConsignmentShopStock,
  ShopFrame,
} from "../../../components/consignment-shop";
import { ConsignmentOrder } from "../../../components/consignment-order";
import { ConsignmentShopSettings } from "../../../components/consignment-shop-settings";
import { ShopCommandsProvider } from "../../../components/consignment-pending";
import { AccessPanel } from "../../../components/access-panel";

const params = <T,>(value: T) => ({ params: Promise.resolve(value) });
const query = (value: Record<string, string> = {}) => ({ searchParams: Promise.resolve(value) });
type Element = ReactElement<Record<string, unknown>>;
/** Primo figlio di `ShopFrame`: il contenuto della pagina. */
const content = (frame: Element) => frame.props.children as Element;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("LUCKYLAP_LOCAL_PREVIEW", "true");
  vi.stubEnv("VERCEL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("anteprima locale del conto vendita (00-sequenza §1.5)", () => {
  it("Vendite › Conto vendita: dati sintetici, vendite del negozio, mai Supabase", async () => {
    const list = (await ConsignmentPage()) as Element;
    expect(list.type).toBe(ConsignmentShops);
    expect(list.props).toMatchObject({ preview: true, side: "sales" });
    const shop = (await ShopPage(params({ code: "neg01" }))) as Element;
    expect(shop.type).toBe(ShopFrame);
    expect(shop.props).toMatchObject({
      preview: true,
      side: "sales",
      title: "Vendite del negozio",
    });
    expect(content(shop).type).toBe(ConsignmentShopSales);
    const report = (await ReportPage(params({ code: "NEG01", month: "2026-10" }))) as Element;
    expect(report.props).toMatchObject({ side: "sales", linkShop: true });
    expect(mocks.config).not.toHaveBeenCalled();
  });

  it("Magazzino › Conto vendita: dati sintetici, magazzino del negozio, conta, ordini, impostazioni", async () => {
    const list = (await StockListPage()) as Element;
    expect(list.type).toBe(ConsignmentShops);
    expect(list.props).toMatchObject({ preview: true, side: "stock" });
    const shop = (await StockShopPage(params({ code: "neg01" }))) as Element;
    expect(shop.type).toBe(ShopFrame);
    expect(shop.props).toMatchObject({
      preview: true,
      side: "stock",
      title: "Magazzino del negozio",
    });
    expect(content(shop).type).toBe(ConsignmentShopStock);
    for (const code of ["NEG01", "NEG02"]) {
      const count = (await CountPage(params({ code }))) as Element;
      expect(count.props).toMatchObject({ side: "stock", linkShop: true });
    }
    const order = (await OrderPage({
      ...params({ code: "NEG01", order: "2" }),
      ...query({ consegna: "1" }),
    })) as Element;
    expect(order.props).toMatchObject({ side: "stock", title: "Ordine n. 2" });
    expect(content(order).type).toBe(ConsignmentOrder);
    expect(content(order).props.startDelivery).toBe(true);
    const fresh = (await OrderPage({
      ...params({ code: "NEG01", order: "nuovo" }),
      ...query({ da: "2026-09" }),
    })) as Element;
    expect(fresh.props).toMatchObject({ side: "stock", title: "Nuovo ordine" });
    expect(content(fresh).props.prefill).not.toBeNull();
    const settings = (await SettingsPage(params({ code: "NEG01" }))) as Element;
    expect(settings.props).toMatchObject({ side: "stock", title: "Impostazioni del negozio" });
    expect(content(settings).type).toBe(ConsignmentShopSettings);
    const created = (await NewShopPage()) as Element;
    expect(created.type).toBe(ShopCommandsProvider);
    expect(created.props.preview).toBe(true);
    expect(mocks.config).not.toHaveBeenCalled();
  });

  it.each([
    ["VERCEL", "1"],
    ["NODE_ENV", "production"],
  ])(
    "con %s=%s il ramo dell'anteprima non si attiva, in nessuno dei due lati",
    async (name, value) => {
      vi.stubEnv(name, value);
      for (const page of [await ConsignmentPage(), await StockListPage()] as Element[]) {
        expect(page.type).toBe(AccessPanel);
        expect(page.props.status).toBe("unconfigured");
      }
      for (const page of [
        await ShopPage(params({ code: "NEG01" })),
        await StockShopPage(params({ code: "NEG01" })),
        await CountPage(params({ code: "NEG01" })),
        await SettingsPage(params({ code: "NEG01" })),
        await OrderPage({ ...params({ code: "NEG01", order: "2" }), ...query() }),
        await NewShopPage(),
      ] as Element[])
        expect(page.type).toBe(AccessPanel);
    },
  );

  it("codice sconosciuto o mese scritto male: pagina non trovata, con il titolo giusto", async () => {
    await expect(ShopPage(params({ code: "NEG09" }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(ShopPage(params({ code: "neg-01" }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(StockShopPage(params({ code: "NEG09" }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(
      OrderPage({ ...params({ code: "NEG01", order: "99" }), ...query() }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(ReportPage(params({ code: "NEG01", month: "2026-13" }))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(await shopMetadata(params({ code: "NEG09" }))).toEqual({ title: "Pagina non trovata" });
    expect(await shopMetadata(params({ code: "NEG01" }))).toEqual({
      title: "Vendite del negozio · Negozio sintetico",
    });
    expect(await stockShopMetadata(params({ code: "NEG09" }))).toEqual({
      title: "Pagina non trovata",
    });
    expect(await stockShopMetadata(params({ code: "NEG01" }))).toEqual({
      title: "Magazzino del negozio · Negozio sintetico",
    });
    expect(await orderMetadata({ ...params({ code: "NEG01", order: "2" }), ...query() })).toEqual({
      title: "Ordine n. 2",
    });
    expect(await orderMetadata({ ...params({ code: "NEG01", order: "99" }), ...query() })).toEqual({
      title: "Pagina non trovata",
    });
    expect(await reportMetadata(params({ code: "NEG01", month: "2026-09" }))).toEqual({
      title: "Resoconto di settembre 2026",
    });
    expect(await reportMetadata(params({ code: "NEG01", month: "09-2026" }))).toEqual({
      title: "Pagina non trovata",
    });
  });

  it("conta: titolo del documento uguale all'h1, prima conta o correzione", async () => {
    for (const [code, title] of [
      ["NEG01", "Correggi la conta"],
      ["NEG02", "Conta in negozio"],
    ]) {
      expect(await countMetadata(params({ code }))).toEqual({ title });
      const page = (await CountPage(params({ code }))) as Element;
      expect(page.props.title).toBe(title);
    }
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
    ...files(join(SRC, "app", "(workspace)", "stock", "conto-vendita")),
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
});
