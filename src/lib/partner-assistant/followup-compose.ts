// Controlli editoriali e MIME dei solleciti. Non attestano la ricerca, la seconda lettura o
// l'autorizzazione all'invio: queste verifiche appartengono al chiamante e alle RPC della posta.
import {
  checkPartnerAssistantDraft,
  partnerAssistantHasRetiredSocialProof,
  type PartnerAssistantCheckCode,
} from "./checks";
import { partnerAssistantMailAddress } from "./mail-config";
import type { PartnerAssistantOutgoing } from "./mail-compose";
import type { PartnerAssistantDraft } from "./types";

export type PartnerAssistantFollowupDraft = Pick<
  PartnerAssistantDraft,
  "language" | "subject" | "body" | "signature" | "rulesVersion"
>;
export type PartnerAssistantFollowupContext = {
  phone: string;
  currentRulesVersion: number;
  porscheCommunity: boolean;
  names: string[];
  /** Percorso della prima email: mantiene firma con cognome ed esclusione dei nomi Club. */
  template?: boolean;
  firstSubject: string;
};
export type PartnerAssistantFollowupCheckCode =
  | PartnerAssistantCheckCode
  | "oggetto_thread"
  | "prova_sociale"
  | "invito_telefonata"
  | "condizioni_commerciali"
  | "allegato";

const HEADER_CONTROL = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u;
const SUBJECT_MAX = 300;
const MIME_MAX = 65_536;

/** Un solo Re:, testo originale conservato. null per intestazioni vuote, controlli o oltre 300
 * caratteri (compreso il prefisso). L'oggetto è un dato e non viene interpretato come istruzione. */
export function partnerAssistantFollowupSubject(firstSubject: string): string | null {
  if (
    typeof firstSubject !== "string" ||
    HEADER_CONTROL.test(firstSubject) ||
    [...firstSubject].length > SUBJECT_MAX
  )
    return null;
  const original = firstSubject
    .trim()
    .replace(/^(?:re\s*:\s*)+/iu, "")
    .trim();
  if (!original) return null;
  const subject = `Re: ${original}`;
  return [...subject].length <= SUBJECT_MAX ? subject : null;
}

const PHONE_CTA =
  /(?<![\p{L}\p{N}])(?:telefon\p{L}*|téléphon\p{L}*|teléfon\p{L}*|chiamat\p{L}*|appuntament\p{L}*|sentiamoci|sentirci|call(?:s|ing)?|phone|appointment\p{L}*|meeting\p{L}*|rendez[\s-]vous|r?appel\p{L}*|anruf\p{L}*|gespräch\p{L}*|termin(?:e|en)?|llamad\p{L}*|cita(?:s)?)(?![\p{L}\p{N}])/iu;
const COMMERCIAL_TERMS =
  /(?<![\p{L}\p{N}])(?:prezz[oi]|prices?|pricing|prix|preis\p{L}*|precios?|euros?|dollars?|sterline|pounds?|margin\p{L}*|margen\p{L}*|commission\p{L}*|comision\p{L}*|comisión\p{L}*|condizion\p{L}*|konditionen|bedingungen|conditions?|condiciones?|(?:commercial|sales|payment|trade)\s+terms|quantità|quantities|quantity|mindest\p{L}*|minimum\s+order|MOQ|pedido\s+mínimo|commande\s+minimale|date\s+di\s+consegna|delivery\s+(?:dates?|times?)|liefer\p{L}*|délai\p{L}*\s+de\s+livraison|fechas?\s+de\s+entrega|partner\s+ufficiale|official\s+partner|offizieller\s+partner|partenaire\s+officiel|socio\s+oficial)(?![\p{L}\p{N}])/iu;
const UNSAFE_CONTENT =
  /(?:mailto|tel|data|cid|javascript|ftp):|<\s*\/?\s*(?:a|img|iframe|script|style|svg|video|audio|object|embed)(?:\s|>|\/)/iu;
// I solleciti non hanno allegati: fermiamo anche la promessa testuale di un file inesistente.
const ATTACHMENT_PROMISE =
  /(?<![\p{L}\p{N}])(?:pdf|lookbooks?|allegat\p{L}*|attach(?:ment\p{L}*|ed|ing)?|anhang|anhänge|angehängt\p{L}*|beigefügt\p{L}*|pièces?\s+jointes?|ci[\s-]joint\p{L}*|en\s+annexe|adjunt\p{L}*|anex[oa]s?)(?![\p{L}\p{N}])/iu;

/** Controlli deterministici di testo. Non verificano fatti, cronologia o approvazioni umane. */
export function checkPartnerAssistantFollowupDraft(
  draft: PartnerAssistantFollowupDraft,
  context: PartnerAssistantFollowupContext,
): { ok: true } | { ok: false; failures: PartnerAssistantFollowupCheckCode[] } {
  const result = checkPartnerAssistantDraft(draft, { ...context, followup: true });
  const failures: PartnerAssistantFollowupCheckCode[] = result.ok ? [] : [...result.failures];
  const expectedSubject = partnerAssistantFollowupSubject(context.firstSubject);
  if (expectedSubject === null || draft.subject !== expectedSubject)
    failures.push("oggetto_thread");
  if ((draft.body.match(/\?/gu) ?? []).length !== 1) failures.push("domande");
  const texts = `${draft.subject}\n${draft.body}`;
  if (partnerAssistantHasRetiredSocialProof(texts, context.names.slice(0, 1)))
    failures.push("prova_sociale");
  if (PHONE_CTA.test(texts)) failures.push("invito_telefonata");
  if (COMMERCIAL_TERMS.test(texts)) failures.push("condizioni_commerciali");
  if (ATTACHMENT_PROMISE.test(texts)) failures.push("allegato");
  if (
    UNSAFE_CONTENT.test(texts) ||
    (draft.body.match(/(?:https:\/\/)?(?:www\.)?luckylap\.com\/?/giu) ?? []).length > 1
  )
    failures.push("link");
  const unique = [...new Set(failures)];
  return unique.length === 0 ? { ok: true } : { ok: false, failures: unique };
}

// Message-ID ASCII, senza commenti o display name; la sintassi del dominio segue gli indirizzi
// stretti della posta. L'ordine delle References arriva dalla conversazione del database.
const MESSAGE_ID =
  /^<[a-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[a-z0-9!#$%&'*+\-/=?^_`{|}~]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+>$/iu;
function validMessageId(value: string): boolean {
  return typeof value === "string" && value.length <= 254 && MESSAGE_ID.test(value);
}

export type PartnerAssistantFollowupOutgoing = PartnerAssistantOutgoing & {
  inReplyTo: string;
  references: string[];
};

/** Solo messaggi nello stesso thread, un mittente e un destinatario, senza allegati. Le
 * References (1..5 distinte) iniziano con In-Reply-To, che il chiamante imposta al primo messaggio.
 * Lancia con un messaggio fisso senza dati personali per qualsiasi input invalido. */
export async function composePartnerAssistantFollowupMessage(
  message: PartnerAssistantFollowupOutgoing,
): Promise<string> {
  const invalid = () => new Error("Messaggio di sollecito non valido.");
  if (
    !message ||
    typeof message !== "object" ||
    !message.from ||
    typeof message.from.name !== "string" ||
    !/^[^\x00-\x1f\x7f-\x9f<>@"\\\u2028\u2029]{1,80}$/u.test(message.from.name) ||
    typeof message.from.address !== "string" ||
    HEADER_CONTROL.test(message.from.address) ||
    typeof message.to !== "string" ||
    HEADER_CONTROL.test(message.to) ||
    partnerAssistantFollowupSubject(message.subject) !== message.subject ||
    typeof message.text !== "string" ||
    !message.text.trim() ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\r(?!\n)/u.test(message.text) ||
    Buffer.byteLength(message.text, "utf8") > MIME_MAX ||
    !(message.date instanceof Date) ||
    !Number.isFinite(message.date.getTime()) ||
    !validMessageId(message.messageId) ||
    !validMessageId(message.inReplyTo) ||
    !Array.isArray(message.references) ||
    message.references.length < 1 ||
    message.references.length > 5 ||
    message.references.some((id) => !validMessageId(id)) ||
    new Set(message.references).size !== message.references.length ||
    message.references[0] !== message.inReplyTo ||
    !message.references.includes(message.inReplyTo) ||
    message.references.includes(message.messageId)
  )
    throw invalid();
  const from = partnerAssistantMailAddress(message.from.address);
  const to = partnerAssistantMailAddress(message.to);
  if (from === null || to === null || from === to) throw invalid();
  const { default: MailComposer } = await import("nodemailer/lib/mail-composer");
  const built = await new MailComposer({
    from: { name: message.from.name, address: from },
    to: { name: "", address: to },
    subject: message.subject,
    text: message.text,
    textEncoding: "quoted-printable",
    messageId: message.messageId,
    inReplyTo: message.inReplyTo,
    references: message.references,
    date: message.date,
    newline: "\r\n",
    disableFileAccess: true,
    disableUrlAccess: true,
  })
    .compile()
    .build();
  if (built.byteLength > MIME_MAX || !built.every((byte) => byte < 0x80)) throw invalid();
  const raw = built.toString("ascii");
  if (/(?<!\r)\n|\r(?!\n)/u.test(raw)) throw invalid();
  const headers = raw.slice(0, raw.indexOf("\r\n\r\n"));
  if (!`\r\n${headers}\r\n`.includes(`\r\nMessage-ID: ${message.messageId}\r\n`)) throw invalid();
  const unfolded = headers.replace(/\r\n[ \t]+/gu, " ");
  const header = (name: string) =>
    unfolded.split("\r\n").filter((line) => line.startsWith(`${name}:`));
  if (
    header("In-Reply-To").length !== 1 ||
    header("References").length !== 1 ||
    header("In-Reply-To")[0].slice("In-Reply-To:".length).trim() !== message.inReplyTo ||
    header("References")[0].slice("References:".length).trim().split(/\s+/u).join(" ") !==
      message.references.join(" ")
  )
    throw invalid();
  return raw;
}
