/*
 * Indirizzi del conto vendita. Un solo posto per i percorsi, così Oggi, Finance
 * e il feed del Controllo CEO portano alla stessa pagina (decisione 17).
 * Un codice o un mese non valido non produce mai un indirizzo rotto: si torna
 * all'elenco o alla pagina del negozio.
 */

export const CONSIGNMENT_HREF = "/consignment";
const SHOP_CODE = /^[A-Z0-9]{2,12}$/;
const MONTH = /^2\d{3}-(0[1-9]|1[0-2])$/;

/** Codice del negozio dall'indirizzo («neg01» → «NEG01»), oppure `null`. */
export function shopCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase();
  return SHOP_CODE.test(code) ? code : null;
}

/** `/consignment/NEG01`, oppure `/consignment/NEG01/resoconto/2026-10` con il mese. */
export function consignmentShopHref(code: string, month?: string | null): string {
  const shop = shopCode(code);
  if (!shop) return CONSIGNMENT_HREF;
  const base = `${CONSIGNMENT_HREF}/${shop}`;
  return typeof month === "string" && MONTH.test(month) ? `${base}/resoconto/${month}` : base;
}

/** `/consignment/NEG01/conta`. */
export function consignmentCountHref(code: string): string {
  const base = consignmentShopHref(code);
  return base === CONSIGNMENT_HREF ? base : `${base}/conta`;
}

/** `/consignment/NEG01/impostazioni`. */
export function consignmentSettingsHref(code: string): string {
  const base = consignmentShopHref(code);
  return base === CONSIGNMENT_HREF ? base : `${base}/impostazioni`;
}

/**
 * `/consignment/NEG01/ordini/3`, oppure `/consignment/NEG01/ordini/nuovo`;
 * con `fromMonth` il nuovo ordine parte dalle magliette vendute in quel mese.
 */
export function consignmentOrderHref(
  code: string,
  order: number | "nuovo",
  fromMonth?: string | null,
): string {
  const base = consignmentShopHref(code);
  if (base === CONSIGNMENT_HREF) return base;
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

export const NEW_SHOP_HREF = `${CONSIGNMENT_HREF}/nuovo`;

/** Ancora del pannello «Conto vendita · da incassare» nelle pagine Finance. */
export const CONSIGNMENT_FINANCE_ANCHOR = "conto-vendita-da-incassare";

/** Ancora di un pagamento del negozio in Finance (decisione 13). */
export const shopPaymentAnchor = (paymentId: string) => `movimento-shop_payment-${paymentId}`;
/** `/finance#movimento-shop_payment-<id>`. */
export const shopPaymentFinanceHref = (paymentId: string) =>
  `/finance#${shopPaymentAnchor(paymentId)}`;
