import { describe, expect, it } from "vitest";
import {
  CONSIGNMENT_HREF,
  NEW_SHOP_HREF,
  SHOP_STOCK_HREF,
  consignmentCountHref,
  consignmentOrderHref,
  consignmentSettingsHref,
  consignmentShopHref,
  shopCode,
  shopOrderParam,
  shopPaymentAnchor,
  shopPaymentFinanceHref,
  shopStockHref,
} from "./links";
import { sx } from "./shop-fixtures";

describe("indirizzi del conto vendita", () => {
  it("vendite del negozio e resoconto del mese restano dove sono (decisione 17)", () => {
    expect(CONSIGNMENT_HREF).toBe("/consignment");
    expect(consignmentShopHref("NEG01")).toBe("/consignment/NEG01");
    expect(consignmentShopHref("neg01", "2026-10")).toBe("/consignment/NEG01/resoconto/2026-10");
    expect(consignmentShopHref("NEG01", null)).toBe("/consignment/NEG01");
  });
  it("magazzino del negozio: Magazzino › Conto vendita", () => {
    expect(SHOP_STOCK_HREF).toBe("/stock/conto-vendita");
    expect(shopStockHref("NEG01")).toBe("/stock/conto-vendita/NEG01");
    expect(shopStockHref("neg01")).toBe("/stock/conto-vendita/NEG01");
  });
  it("un codice o un mese non valido non rompe l'indirizzo: torna all'elenco del suo lato", () => {
    expect(consignmentShopHref("NEG-01")).toBe(CONSIGNMENT_HREF);
    expect(consignmentShopHref("../finance")).toBe(CONSIGNMENT_HREF);
    expect(consignmentShopHref("N")).toBe(CONSIGNMENT_HREF);
    expect(consignmentShopHref("NEG01", "2026-13")).toBe("/consignment/NEG01");
    expect(consignmentShopHref("NEG01", "2026-10/../x")).toBe("/consignment/NEG01");
    expect(shopStockHref("../finance")).toBe(SHOP_STOCK_HREF);
    expect(consignmentCountHref("x y")).toBe(SHOP_STOCK_HREF);
    expect(consignmentSettingsHref("NEG-01")).toBe(SHOP_STOCK_HREF);
    expect(consignmentOrderHref("N", 3)).toBe(SHOP_STOCK_HREF);
  });
  it("conta, impostazioni, ordini e nuovo negozio stanno nel magazzino del negozio", () => {
    expect(consignmentCountHref("NEG01")).toBe("/stock/conto-vendita/NEG01/conta");
    expect(consignmentSettingsHref("NEG01")).toBe("/stock/conto-vendita/NEG01/impostazioni");
    expect(consignmentOrderHref("NEG01", 3)).toBe("/stock/conto-vendita/NEG01/ordini/3");
    expect(consignmentOrderHref("NEG01", "nuovo")).toBe("/stock/conto-vendita/NEG01/ordini/nuovo");
    expect(consignmentOrderHref("NEG01", "nuovo", "2026-09")).toBe(
      "/stock/conto-vendita/NEG01/ordini/nuovo?da=2026-09",
    );
    expect(consignmentOrderHref("NEG01", 0)).toBe("/stock/conto-vendita/NEG01");
    expect(consignmentOrderHref("NEG01", 1.5)).toBe("/stock/conto-vendita/NEG01");
    expect(NEW_SHOP_HREF).toBe("/stock/conto-vendita/nuovo");
  });
  it("codici e numeri letti dall'indirizzo", () => {
    expect(shopCode("neg01")).toBe("NEG01");
    expect(shopCode("NEG0123456789")).toBeNull();
    expect(shopCode(undefined)).toBeNull();
    expect(shopOrderParam("nuovo")).toBe("nuovo");
    expect(shopOrderParam("12")).toBe(12);
    for (const bad of ["0", "012", "1.5", "-1", "2000000", "nuovi", undefined])
      expect(shopOrderParam(bad)).toBeNull();
  });
  it("ancora del pagamento in Finance (decisione 13)", () => {
    expect(shopPaymentAnchor(sx.payment)).toBe(`movimento-shop_payment-${sx.payment}`);
    expect(shopPaymentFinanceHref(sx.payment)).toBe(
      `/finance#movimento-shop_payment-${sx.payment}`,
    );
  });
});
