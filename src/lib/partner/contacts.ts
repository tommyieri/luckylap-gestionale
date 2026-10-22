// Partner: recapiti, pulsanti della riga e link sicuri (spec 02 §2.2, §5.4, §5.6). Funzioni pure.
//
// I recapiti della ricerca sono testo libero («Sede +49 …; Magazzino +49 …»). Il database calcola
// il valore pulito (private.partner_link_value); qui lo stesso calcolo serve al modulo dei
// recapiti per avvisare prima dell'invio, e ogni href nasce solo da un valore pulito:
// mai `javascript:`, `data:` o altri schemi.
import {
  charCount,
  type PartnerChannel,
  type PartnerContactKind,
  type PartnerContactLink,
} from "./model";

const EMAIL_FIND = /([A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24})/;
const EMAIL_LINK = /^[^@\s]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const EMAIL_HREF = /^([A-Za-z0-9._%+'-]{1,64})@([A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24})$/;
const PHONE_LINK = /^\+?[0-9]{5,20}$/;
const INSTAGRAM_LINK = /^@([A-Za-z0-9_.]{1,30})$/;
const URL_LINK = /^https?:\/\/[^\s/@?#]+([/?#]\S*)?$/;
const INSTAGRAM_RESERVED = new Set(["p", "reel", "reels", "explore", "stories", "tv", "accounts"]);

/** btrim di PostgreSQL: solo spazi, non tab o a capo. */
const btrim = (value: string) => value.replace(/^ +| +$/g, "");

/**
 * Valore pulito per il pulsante, come private.partner_link_value. Email: primo indirizzo.
 * Telefono e WhatsApp: primo numero, solo cifre e «+» iniziale. Instagram: primo @nome, o il nome
 * da un link instagram.com/…. Modulo, pagina brand e sito: il testo intero se è un URL http(s).
 */
export function partnerLinkValue(kind: PartnerContactKind, value: string | null): string | null {
  if (value === null) return null;
  if (kind === "email") {
    const found = EMAIL_FIND.exec(value)?.[1];
    return found && EMAIL_LINK.test(found) ? found : null;
  }
  if (kind === "phone" || kind === "whatsapp") {
    const found = /(\+?[0-9][0-9 ().-]{3,}[0-9])/.exec(value)?.[1];
    if (!found) return null;
    const digits = `${found.startsWith("+") ? "+" : ""}${found.replace(/[^0-9]/g, "")}`;
    return PHONE_LINK.test(digits) ? digits : null;
  }
  if (kind === "instagram") {
    let handle = /(?:^|[^A-Za-z0-9_.@/])@([A-Za-z0-9_.]{1,30})/.exec(value)?.[1];
    if (handle === undefined) {
      const fromLink = /instagram\.com\/([A-Za-z0-9_.]{1,30})/i.exec(value)?.[1];
      handle = fromLink && !INSTAGRAM_RESERVED.has(fromLink.toLowerCase()) ? fromLink : undefined;
    }
    const clean = handle?.replace(/\.+$/, "");
    return clean && /^[A-Za-z0-9_.]{1,30}$/.test(clean) ? `@${clean}` : null;
  }
  const url = btrim(value);
  return charCount(url) <= 2048 && URL_LINK.test(url) ? url : null;
}

/**
 * Dominio di un sito o di un'email, come private.partner_domain: minuscolo, senza «www.»,
 * «shop.» o «store.» iniziale. Serve alla lista «Non contattare» per dominio.
 */
export function partnerDomain(value: string | null): string | null {
  if (value === null) return null;
  let domain: string | undefined;
  if (/^https?:\/\//i.test(value))
    domain = /^https?:\/\/([^/:?#@\s]+)/i.exec(value)?.[1]?.toLowerCase();
  else if (value.includes("@")) domain = /@([A-Za-z0-9.-]+)/.exec(value)?.[1]?.toLowerCase();
  if (!domain) return null;
  domain = domain.replace(/\.+$/, "").replace(/^(www|shop|store)\./, "");
  return domain.length <= 253 && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

function safeHttpUrl(value: string): string | null {
  if (!URL_LINK.test(value) || charCount(value) > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

/** href sicuro per un valore pulito; `null` se il valore non ha la forma del suo tipo. */
export function contactHref(kind: PartnerContactKind, linkValue: string | null): string | null {
  if (linkValue === null) return null;
  switch (kind) {
    case "email": {
      const match = EMAIL_HREF.exec(linkValue);
      return match ? `mailto:${encodeURIComponent(match[1])}@${match[2]}` : null;
    }
    case "phone":
      return PHONE_LINK.test(linkValue) ? `tel:${linkValue}` : null;
    case "whatsapp":
      return PHONE_LINK.test(linkValue) ? `https://wa.me/${linkValue.replace(/\D/g, "")}` : null;
    case "instagram": {
      const handle = INSTAGRAM_LINK.exec(linkValue)?.[1];
      return handle ? `https://www.instagram.com/${handle}/` : null;
    }
    default:
      return safeHttpUrl(linkValue);
  }
}

// Prefissi internazionali di tre cifre (ITU-T E.164); gli altri che iniziano con 1 o 7 ne hanno una,
// il resto due.
const COUNTRY_CODE_3 = /^(2[1-689]|3[578]|42|5[09]|6[7-9]|8[035789]|9[679])/;

/**
 * Numero pulito leggibile, per il pulsante della riga: «+390000000003» → «+39 000 000 0003».
 * Prefisso internazionale a parte, poi gruppi di tre cifre; un'ultima cifra sola va col gruppo
 * prima. L'href `tel:` resta quello compatto.
 */
export function formatPhoneLink(linkValue: string): string {
  if (!PHONE_LINK.test(linkValue)) return linkValue;
  const international = linkValue.startsWith("+");
  const digits = linkValue.replace(/^\+/, "");
  const ccLength = !international
    ? 0
    : /^[17]/.test(digits)
      ? 1
      : COUNTRY_CODE_3.test(digits)
        ? 3
        : 2;
  const national = digits.slice(ccLength);
  const groups = national.match(/\d{1,3}/g) ?? [];
  if (groups.length > 1 && groups[groups.length - 1].length === 1)
    groups.splice(-2, 2, groups[groups.length - 2] + groups[groups.length - 1]);
  return [...(international ? [`+${digits.slice(0, ccLength)}`] : []), ...groups].join(" ");
}

/** «garage-uno.example.test/chi-siamo»: indirizzo leggibile, senza schema e senza «www.». */
export const hostLabel = (url: string) =>
  url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");

export type PartnerActionKind = "email" | "copy" | "form" | "instagram" | "phone" | "web";
export type PartnerAction = {
  kind: PartnerActionKind;
  label: string;
  /** Link del pulsante; nullo per «Copia». */
  href: string | null;
  /** Testo da copiare, solo per «Copia». */
  copyText: string | null;
  /** Il canale preferito: primo e pieno. */
  primary: boolean;
  /** Si apre in una nuova scheda (modulo, Instagram, sito). */
  external: boolean;
  ariaLabel: string | null;
};

const PRIMARY_KIND: Record<PartnerChannel, PartnerActionKind> = {
  email: "email",
  form: "form",
  ig: "instagram",
  phone: "phone",
  web: "web",
};

/**
 * Pulsanti della riga, come actionsHtml del sito: email (con «Copia»), modulo, Instagram, telefono
 * solo con canale preferito `phone`, sito solo se non c'è altro. Il principale è il canale
 * preferito, altrimenti il primo. Contatto bloccato: nessun pulsante.
 */
export function partnerActions(
  partner: { preferredChannel: PartnerChannel },
  contacts: readonly PartnerContactLink[],
  blocked: boolean,
): PartnerAction[] {
  if (blocked) return [];
  const usable = contacts
    .filter((contact) => contact.active && contactHref(contact.kind, contact.linkValue) !== null)
    .sort((a, b) => a.position - b.position);
  const first = (kind: PartnerContactKind) => usable.find((contact) => contact.kind === kind);
  const actions: Omit<PartnerAction, "primary">[] = [];
  const email = first("email");
  if (email) {
    actions.push({
      kind: "email",
      label: email.linkValue!,
      href: contactHref("email", email.linkValue),
      copyText: null,
      external: false,
      ariaLabel: null,
    });
    actions.push({
      kind: "copy",
      label: "Copia",
      href: null,
      copyText: email.linkValue,
      external: false,
      ariaLabel: "Copia l’indirizzo email",
    });
  }
  const form = first("form") ?? first("brand_page");
  if (form)
    actions.push({
      kind: "form",
      label: "Modulo",
      href: contactHref(form.kind, form.linkValue),
      copyText: null,
      external: true,
      ariaLabel: null,
    });
  const instagram = first("instagram");
  if (instagram)
    actions.push({
      kind: "instagram",
      label: "Instagram",
      href: contactHref("instagram", instagram.linkValue),
      copyText: null,
      external: true,
      ariaLabel: `Instagram ${instagram.linkValue}`,
    });
  const phone = first("phone");
  if (phone && partner.preferredChannel === "phone")
    actions.push({
      kind: "phone",
      label: formatPhoneLink(phone.linkValue!),
      href: contactHref("phone", phone.linkValue),
      copyText: null,
      external: false,
      ariaLabel: `Chiama ${formatPhoneLink(phone.linkValue!)}`,
    });
  const web = first("web");
  if (actions.length === 0 && web)
    actions.push({
      kind: "web",
      label: "Apri il sito",
      href: contactHref("web", web.linkValue),
      copyText: null,
      external: true,
      ariaLabel: null,
    });
  const primary =
    actions.find((action) => action.kind === PRIMARY_KIND[partner.preferredChannel]) ??
    actions.find((action) => action.kind !== "copy");
  const ordered = primary ? [primary, ...actions.filter((action) => action !== primary)] : actions;
  return ordered.map((action) => {
    const isPrimary = action === primary;
    const label =
      action.kind === "form" && isPrimary
        ? "Apri il modulo"
        : action.kind === "instagram" && isPrimary
          ? "Scrivi su Instagram"
          : action.label;
    return { ...action, label, primary: isPrimary };
  });
}

/** Testo di «Come contattarli», come routeText del sito. */
export function routeText(route: string, contacts: readonly PartnerContactLink[]): string {
  if (route.trim() !== "") return route;
  const usable = contacts.filter((contact) => contact.active && contact.linkValue !== null);
  const email = usable.find((contact) => contact.kind === "email");
  if (email) return `Email a ${email.linkValue}`;
  if (usable.some((contact) => contact.kind === "form")) return "Modulo contatti sul sito";
  const instagram = usable.find((contact) => contact.kind === "instagram");
  if (instagram) return `Messaggio diretto su Instagram a ${instagram.linkValue}`;
  return "Contatto da trovare sul sito";
}

/**
 * Prima frase del percorso per la riga («Come.»), come shortRoute del sito. Un indirizzo diventa
 * il suo dominio; a differenza del sito la punteggiatura dopo l'indirizzo resta, così la frase
 * finisce dove finisce davvero.
 */
export function shortRoute(text: string): string {
  const plain = text.replace(
    /https?:\/\/(?:www\.)?([^\s/]+?)(?:[/?#][^\s]*?)?([.,;:!?)]*)(?=\s|$)/gi,
    "$1$2",
  );
  const match = /^(.{40,180}?[.;:])(\s|$)/.exec(plain);
  const first = match ? match[1] : plain;
  return first.length > 190 ? `${first.slice(0, 180).replace(/\s+\S*$/, "")}…` : first;
}

/** Oltre questa lunghezza il testo non entra nel link mailto: (limiti dei programmi di posta). */
export const MAILTO_BODY_LIMIT = 1800;

const emails = (text: string) =>
  [...text.matchAll(new RegExp(EMAIL_FIND.source, "g"))]
    .map((match) => match[1])
    .filter((address) => EMAIL_HREF.test(address));

/**
 * «Apri l'email con il testo»: mailto: con destinatari, cc, oggetto e testo codificati. Un testo
 * oltre 1800 caratteri resta fuori («Copia il testo e incollalo»): `bodyIncluded` è falso.
 */
export function messageMailto(message: { to: string; cc: string; subject: string; body: string }): {
  href: string;
  bodyIncluded: boolean;
} {
  const encode = (value: string) => encodeURIComponent(value.replace(/\r?\n/g, "\r\n"));
  const to = emails(message.to)
    .map((address) => {
      const [local, domain] = address.split("@");
      return `${encodeURIComponent(local)}@${domain}`;
    })
    .join(",");
  const cc = emails(message.cc);
  const bodyIncluded = message.body !== "" && charCount(message.body) <= MAILTO_BODY_LIMIT;
  const params: string[] = [];
  if (cc.length) params.push(`cc=${encodeURIComponent(cc.join(","))}`);
  if (message.subject !== "") params.push(`subject=${encode(message.subject)}`);
  if (bodyIncluded) params.push(`body=${encode(message.body)}`);
  return {
    href: `mailto:${to}${params.length ? `?${params.join("&")}` : ""}`,
    bodyIncluded: bodyIncluded || message.body === "",
  };
}
