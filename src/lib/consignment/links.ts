/*
 * Indirizzi del conto vendita. Un solo posto per i percorsi, così Oggi, Finance
 * e il feed del Controllo CEO portano alla stessa pagina (decisione 17).
 * Due lati, due prefissi:
 * - Vendite › Conto vendita (`/consignment`): vendite del negozio, resoconto
 *   mensile, fattura e pagamenti;
 * - Magazzino › Conto vendita (`/stock/conto-vendita`): magliette in negozio,
 *   conta, ordini e consegne, impostazioni e nuovo negozio.
 * Un codice o un mese non valido non produce mai un indirizzo rotto: si torna
 * all'elenco del lato giusto o alla pagina del negozio.
 */

/** Vendite › Conto vendita. */
export const CONSIGNMENT_HREF = "/consignment";
/** Magazzino › Conto vendita. */
export const SHOP_STOCK_HREF = "/stock/conto-vendita";
const SHOP_CODE = /^[A-Z0-9]{2,12}$/;
const MONTH = /^2\d{3}-(0[1-9]|1[0-2])$/;

/** Codice del negozio dall'indirizzo («neg01» → «NEG01»), oppure `null`. */
export function shopCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase();
  return SHOP_CODE.test(code) ? code : null;
}

/**
 * Vendite del negozio: `/consignment/NEG01`, oppure `/consignment/NEG01/resoconto/2026-10`
 * con il mese. Forme della decisione 17: il feed del Controllo CEO le costruisce in SQL.
 */
export function consignmentShopHref(code: string, month?: string | null): string {
  const shop = shopCode(code);
  if (!shop) return CONSIGNMENT_HREF;
  const base = `${CONSIGNMENT_HREF}/${shop}`;
  return typeof month === "string" && MONTH.test(month) ? `${base}/resoconto/${month}` : base;
}

/** Magazzino del negozio: `/stock/conto-vendita/NEG01`. */
export function shopStockHref(code: string): string {
  const shop = shopCode(code);
  return shop ? `${SHOP_STOCK_HREF}/${shop}` : SHOP_STOCK_HREF;
}

/** `/stock/conto-vendita/NEG01/conta`. */
export function consignmentCountHref(code: string): string {
  const base = shopStockHref(code);
  return base === SHOP_STOCK_HREF ? base : `${base}/conta`;
}

/** `/stock/conto-vendita/NEG01/impostazioni`. */
export function consignmentSettingsHref(code: string): string {
  const base = shopStockHref(code);
  return base === SHOP_STOCK_HREF ? base : `${base}/impostazioni`;
}

/**
 * `/stock/conto-vendita/NEG01/ordini/3`, oppure `/stock/conto-vendita/NEG01/ordini/nuovo`;
 * con `fromMonth` il nuovo ordine parte dalle magliette vendute in quel mese.
 */
export function consignmentOrderHref(
  code: string,
  order: number | "nuovo",
  fromMonth?: string | null,
): string {
  const base = shopStockHref(code);
  if (base === SHOP_STOCK_HREF) return base;
  if (order === "nuovo")
    return `${base}/ordini/nuovo${typeof fromMonth === "string" && MONTH.test(fromMonth) ? `?da=${fromMonth}` : ""}`;
  return Number.isSafeInteger(order) && order >= 1 && order <= 1_000_000
    ? `${base}/ordini/${order}`
    : base;
}

/** Numero d'ordine dall'indirizzo, «nuovo», oppure `null`. */
export function shopOrderParam(value: unknown): number | "nuovo" | null {
  if (value === "nuovo") return "nuovo";
  if (typeof value !== "string" || !/^[1-9][0-9]{0,6}$/.test(value)) return null;
  const n = Number(value);
  return n <= 1_000_000 ? n : null;
}

export const NEW_SHOP_HREF = `${SHOP_STOCK_HREF}/nuovo`;

/** Ancora del pannello «Conto vendita · da incassare» nelle pagine Finance. */
export const CONSIGNMENT_FINANCE_ANCHOR = "conto-vendita-da-incassare";

/** Ancora di un pagamento del negozio in Finance (decisione 13). */
export const shopPaymentAnchor = (paymentId: string) => `movimento-shop_payment-${paymentId}`;
/** `/finance#movimento-shop_payment-<id>`. */
export const shopPaymentFinanceHref = (paymentId: string) =>
  `/finance#${shopPaymentAnchor(paymentId)}`;
