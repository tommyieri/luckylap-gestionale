// Testo, frasi di uscita, Message-ID e MIME del messaggio dell'assistente Partner. Le costanti non
// sono solo del server (la pagina può mostrarle); nodemailer si carica solo dentro la funzione.
import type { PartnerAssistantLanguage, PartnerAssistantRegister } from "./types";

/** Appendice A del piano, così com'è. Le rivede Luca: una modifica è una pull request qui. */
export const PARTNER_ASSISTANT_OPT_OUT_LINES: Readonly<{
  it_voi: string;
  it_lei: string;
  en: string;
  de: string;
  fr: string;
  es: string;
}> = Object.freeze({
  it_voi:
    "Se non è il momento, o preferite non ricevere altre email, scrivetemelo pure: non vi ricontatterò.",
  it_lei:
    "Se non è il momento, o preferisce non ricevere altre email, me lo scriva pure: non la ricontatterò.",
  en: "If the timing isn't right, or you'd rather not hear from me again, just let me know and I won't write again.",
  de: "Falls es gerade nicht passt oder Sie keine weiteren E-Mails wünschen, schreiben Sie mir einfach, dann melde ich mich nicht mehr.",
  fr: "Si ce n'est pas le bon moment, ou si vous préférez ne plus recevoir d'e-mails de ma part, dites-le-moi simplement : je ne vous écrirai plus.",
  es: "Si no es el momento, o prefiere no recibir más correos, dígamelo sin problema: no volveré a escribirle.",
});

/** In italiano conta il registro (lei o voi); le altre lingue hanno una riga sola. */
export function partnerAssistantOptOutLine(
  language: PartnerAssistantLanguage,
  register: PartnerAssistantRegister,
): string {
  const lines = PARTNER_ASSISTANT_OPT_OUT_LINES;
  switch (language) {
    case "it":
      return register === "lei" ? lines.it_lei : lines.it_voi;
    case "en":
      return lines.en;
    case "de":
      return lines.de;
    case "fr":
      return lines.fr;
    case "es":
      return lines.es;
  }
}

/** Corpo della bozza, riga vuota, firma, riga vuota, frase di uscita. */
export function partnerAssistantMessageText(input: {
  body: string;
  signature: string;
  optOut: string;
}): string {
  return `${input.body}\n\n${input.signature}\n\n${input.optOut}`;
}

/** `<uuid@dominio della casella>`. */
export function partnerAssistantMessageId(
  domain: string,
  uuid: string = globalThis.crypto.randomUUID(),
): string {
  return `<${uuid}@${domain}>`;
}

export type PartnerAssistantOutgoing = {
  messageId: string;
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  date: Date;
};

/** Il messaggio RFC 5322 in CRLF: un destinatario, solo testo semplice, nient'altro. Lancia se il
 * risultato non è solo ASCII o se la riga del Message-ID non è quella che cerca la SQL. */
export async function composePartnerAssistantMessage(
  message: PartnerAssistantOutgoing,
): Promise<string> {
  const { default: MailComposer } = await import("nodemailer/lib/mail-composer");
  const built = await new MailComposer({
    from: message.from,
    to: { name: "", address: message.to },
    subject: message.subject,
    text: message.text,
    messageId: message.messageId,
    date: message.date,
    newline: "\r\n",
    disableFileAccess: true,
    disableUrlAccess: true,
  })
    .compile()
    .build();
  if (!built.every((byte) => byte < 0x80))
    throw new Error("Il messaggio composto non è solo ASCII.");
  const raw = built.toString("ascii");
  if (!`\r\n${raw}`.includes(`\r\nMessage-ID: ${message.messageId}\r\n`))
    throw new Error("Il Message-ID del messaggio composto non è su una riga sola.");
  return raw;
}
