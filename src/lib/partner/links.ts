// Partner: indirizzi della pagina (spec 02 §5.3; 00-sequenza decisione 17 e §5, 05-4).
// Il Controllo CEO, Oggi e il calendario usano partnerHref({ co }): il CO è stabile, l'id no.
import { isPartnerCo, isPartnerLookbookCode, type PartnerLookbookCode } from "./model";

export const PARTNER_PATH = "/partner";
export const PARTNER_DATA_PATH = "/partner/dati";
export const PARTNER_RULES_PATH = "/partner/regole";

/** Ancora della riga: `lead-12`. */
export const partnerLeadAnchor = (co: number) => `lead-${co}`;

/** `/partner?co=12#lead-12`: apre il contatto 12 con i dettagli. CO non valido: `/partner`. */
export function partnerHref({ co }: { co: number }): string {
  if (!isPartnerCo(co)) return PARTNER_PATH;
  return `${PARTNER_PATH}?co=${co}#${partnerLeadAnchor(co)}`;
}

/** CO dall'ancora `#lead-12` (link del Controllo CEO senza `co`); `null` se non è un'ancora valida. */
export function coFromLeadHash(hash: string): number | null {
  const match = /^#?lead-([1-9][0-9]{0,4})$/.exec(hash);
  if (!match) return null;
  const co = Number(match[1]);
  return isPartnerCo(co) ? co : null;
}

/** `/partner/lookbook/negozi`: la route verifica il membro e scarica il PDF come allegato. */
export function partnerLookbookHref(code: PartnerLookbookCode): string {
  if (!isPartnerLookbookCode(code)) throw new RangeError("Lookbook sconosciuto.");
  return `${PARTNER_PATH}/lookbook/${code}`;
}
