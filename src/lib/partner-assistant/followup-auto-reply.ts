import { isCalendarDay } from "../partner/dates";

export const PARTNER_FOLLOWUP_AUTO_REPLY_MAX_BYTES = 65_536;
export type PartnerFollowupAutoReply =
  { status: "dated"; resumeOn: string } | { status: "ambiguous" };

// RFC 3834 §5: auto-replied identifica una risposta automatica, non ne autentica il contenuto.
// Il marker da solo non basta: il corpo completo deve contenere soltanto assenza, rientro
// assoluto e cortesia riconosciuta. Tutto ciò che non capiamo resta bloccato.
// Fonti: https://www.rfc-editor.org/rfc/rfc3834#section-5
// MIME/charset/transfer: https://www.rfc-editor.org/rfc/rfc2045
const ambiguous = (): PartnerFollowupAutoReply => ({ status: "ambiguous" });

function headers(value: string): Map<string, string[]> | null {
  if (/[^\x09\x0d\x0a\x20-\x7e]/u.test(value) || /\r(?!\n)|(?<!\r)\n/u.test(value)) return null;
  const result = new Map<string, string[]>();
  for (const line of value.replace(/\r\n[ \t]+/gu, " ").split("\r\n")) {
    const match = /^([!#$%&'*+\-.^_`|~\da-z]+):[ \t]*(.*)$/iu.exec(line);
    if (!match) return null;
    const name = match[1].toLowerCase();
    result.set(name, [...(result.get(name) ?? []), match[2].trim()]);
  }
  return result;
}

function plainBody(source: Buffer): string | null {
  const split = source.indexOf("\r\n\r\n");
  if (split < 1) return null;
  const parsed = headers(source.subarray(0, split).toString("latin1"));
  if (!parsed) return null;
  const single = (key: string, fallback: string): string | null => {
    const values = parsed.get(key) ?? [];
    return values.length > 1 ? null : (values[0] ?? fallback);
  };
  if (single("auto-submitted", "")?.toLowerCase() !== "auto-replied") return null;
  const mime = single("mime-version", "1.0");
  const contentType = single("content-type", "text/plain; charset=us-ascii");
  const disposition = single("content-disposition", "inline");
  const transfer = single("content-transfer-encoding", "7bit")?.toLowerCase();
  if (!contentType || mime !== "1.0" || disposition?.toLowerCase() !== "inline") return null;
  const type =
    /^text\/plain(?:\s*;\s*charset\s*=\s*(?:"(utf-8|us-ascii)"|(utf-8|us-ascii)))?\s*$/iu.exec(
      contentType,
    );
  // Multipart/HTML, allegati, charsets e parametri sconosciuti non vengono semplificati.
  if (!type) return null;
  const charset = (type[1] ?? type[2] ?? "us-ascii").toLowerCase();
  let body = source.subarray(split + 4);
  if (transfer === "base64") {
    if (body.some((byte) => byte > 0x7f)) return null;
    const encoded = body.toString("ascii").replace(/[\r\n\t ]/gu, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded))
      return null;
    body = Buffer.from(encoded, "base64");
    if (body.toString("base64") !== encoded) return null;
  } else if (transfer === "quoted-printable") {
    if (body.some((byte) => byte > 0x7f)) return null;
    const encoded = body.toString("ascii");
    if (/\r(?!\n)|(?<!\r)\n/u.test(encoded)) return null;
    const bytes: number[] = [];
    for (let index = 0; index < encoded.length; index++) {
      if (encoded[index] !== "=") bytes.push(encoded.charCodeAt(index));
      else if (encoded.slice(index + 1, index + 3) === "\r\n") index += 2;
      else if (/^[A-Fa-f0-9]{2}$/u.test(encoded.slice(index + 1, index + 3))) {
        bytes.push(parseInt(encoded.slice(index + 1, index + 3), 16));
        index += 2;
      } else return null;
    }
    body = Buffer.from(bytes);
  } else if (transfer !== "7bit" && transfer !== "8bit") return null;
  if ((charset === "us-ascii" || transfer === "7bit") && body.some((byte) => byte > 0x7f))
    return null;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);
    if (
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u2028\u2029\ufffd]/u.test(decoded) ||
      /\r(?!\n)|(?<!\r)\n/u.test(decoded) ||
      /<|>|\?/u.test(decoded)
    )
      return null;
    return decoded;
  } catch {
    return null;
  }
}

const MONTHS = [
  ["january", "gennaio", "januar", "janvier", "enero"],
  ["february", "febbraio", "februar", "fevrier", "febrero"],
  ["march", "marzo", "marz", "mars"],
  ["april", "aprile", "avril", "abril"],
  ["may", "maggio", "mai", "mayo"],
  ["june", "giugno", "juni", "juin", "junio"],
  ["july", "luglio", "juli", "juillet", "julio"],
  ["august", "agosto", "aout"],
  ["september", "settembre", "septembre", "septiembre"],
  ["october", "ottobre", "oktober", "octobre", "octubre"],
  ["november", "novembre", "noviembre"],
  ["december", "dicembre", "dezember", "decembre", "diciembre"],
];
const MONTH = MONTHS.flat().join("|");
const ABSOLUTE_DATE = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}\.?\s+(?:de\s+)?(?:${MONTH})\s+(?:de\s+)?\d{4}|(?:${MONTH})\s+\d{1,2},?\s+\d{4})`;
const PREFIX = String.raw`(?:i\s+)?(?:will\s+)?(?:be\s+)?back\s+(?:in\s+the\s+office\s+)?on|(?:i\s+)?(?:will\s+)?return\s+(?:to\s+the\s+office\s+)?on|(?:io\s+)?(?:rientrero|rientro|tornero|torno)\s+(?:in\s+ufficio\s+)?il|saro\s+di\s+nuovo\s+in\s+ufficio\s+il|(?:je\s+)?(?:serai\s+de\s+retour|reviens|reviendrai)\s+(?:au\s+bureau\s+)?le|de\s+retour\s+(?:au\s+bureau\s+)?le|(?:ich\s+bin\s+)?(?:wieder\s+(?:im\s+buro\s+)?ab|ab\s+dem)|(?:yo\s+)?(?:vuelvo|volvere|regreso|regresare)\s+(?:a\s+la\s+oficina\s+)?el`;
const RETURN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:(?:and|e|et|und|y)\s+)?(?:${PREFIX})\s+(${ABSOLUTE_DATE})(?:\s+wieder\s+im\s+buro)?(?![\p{L}\p{N}\/-])`,
  "gu",
);
const ABSENCE =
  /(?<![\p{L}\p{N}])(?:i(?: am|'m)(?: currently)? (?:out of(?: the)? office|away from(?: the)? office|on (?:annual )?(?:leave|holiday|vacation))|sono(?: attualmente)? (?:fuori (?:dall')?ufficio|assente(?: dall'ufficio)?|in (?:ferie|vacanza))|je suis(?: actuellement)? (?:absente?(?: du bureau)?|en conge|en vacances|hors du bureau)|ich bin(?: derzeit)? (?:nicht im buro|ausser haus|abwesend|im urlaub)|estoy(?: actualmente)? (?:fuera de la oficina|ausente|de vacaciones))(?![\p{L}\p{N}])/gu;
const COURTESY =
  /(?<![\p{L}\p{N}])(?:thank you for your (?:email|message)|thanks for your (?:email|message)|i will (?:respond|reply) (?:to your (?:email|message) )?when i return|kind regards|best regards|hello|grazie per (?:il|questo) messaggio|grazie per la (?:vostra|sua) email|rispondero al (?:vostro|suo) messaggio al (?:mio )?rientro|un saluto|buongiorno|merci pour votre (?:message|e-mail)|cordialement|bonjour|vielen dank fur ihre (?:e-mail|nachricht)|mit freundlichen grussen|guten tag|gracias por su (?:correo|mensaje)|un saludo|buenos dias)(?![\p{L}\p{N}])/gu;

function dayOf(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return isCalendarDay(value) ? value : null;
  const parts = value
    .replace(/\bde\s+/gu, "")
    .replace(/[.,]/gu, "")
    .split(/\s+/u);
  if (parts.length !== 3) return null;
  const monthFirst = /^[a-z]/u.test(parts[0]);
  const month = MONTHS.findIndex((names) => names.includes(parts[monthFirst ? 0 : 1]));
  const date = Number(parts[monthFirst ? 1 : 0]);
  const result = `${parts[2]}-${String(month + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
  return month >= 0 && isCalendarDay(result) ? result : null;
}

/** Fonte RFC822 completa, verificata dallo scanner contro UID e RFC822.SIZE. Questo parser
 * non decide la pertinenza al thread, non usa la data corrente e non riporta testo o header. */
export function readPartnerFollowupAutoReply(source: Buffer): PartnerFollowupAutoReply {
  if (
    !Buffer.isBuffer(source) ||
    source.byteLength < 1 ||
    source.byteLength > PARTNER_FOLLOWUP_AUTO_REPLY_MAX_BYTES
  )
    return ambiguous();
  const decoded = plainBody(source);
  if (decoded === null) return ambiguous();
  let body = decoded
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replaceAll("ß", "ss")
    .replaceAll("’", "'")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
  const absence = [...body.matchAll(ABSENCE)];
  const returns = [...body.matchAll(RETURN)];
  if (absence.length !== 1 || returns.length !== 1) return ambiguous();
  const resumeOn = dayOf(returns[0][1]);
  if (resumeOn === null) return ambiguous();
  // Eliminiamo solo frasi riconosciute, non una finestra arbitraria intorno alla data:
  // stop, risposte umane, testo citato o altri fatti devono lasciare un residuo e bloccare.
  body = body.replace(ABSENCE, " ").replace(RETURN, " ").replace(COURTESY, " ");
  return /^[\s.,:;\-]*$/u.test(body) ? { status: "dated", resumeOn } : ambiguous();
}
