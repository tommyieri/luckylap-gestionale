// Testo, Message-ID e MIME del messaggio dell'assistente Partner.
// Nodemailer si carica solo dentro le funzioni di composizione MIME.
import { isPdfBytes, partnerLookbookFileName } from "../partner/lookbook";
import {
  PARTNER_ASSISTANT_TEST_MIME_MAX_BYTES,
  type PartnerAssistantTestLookbook,
} from "./test-lookbook-metadata";

export { partnerAssistantOptOutLine } from "./opt-out";

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

export type PartnerAssistantLookbookAttachment = {
  code: PartnerAssistantTestLookbook["code"];
  content: Buffer;
};

/** Gli stessi campi dell'email di testo e un solo lookbook Club già letto e verificato.
 * Si accettano byte, mai percorsi, URL o opzioni di nodemailer dal chiamante. */
export async function composePartnerAssistantLookbookMessage(
  message: PartnerAssistantOutgoing,
  lookbook: PartnerAssistantLookbookAttachment,
): Promise<string> {
  if (
    (lookbook.code !== "porsche_club" && lookbook.code !== "club") ||
    !Buffer.isBuffer(lookbook.content) ||
    !isPdfBytes(lookbook.content)
  )
    throw new Error("Allegato del messaggio non valido.");
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
    attachments: [
      {
        filename: partnerLookbookFileName(lookbook.code),
        content: lookbook.content,
        contentType: "application/pdf",
        contentDisposition: "attachment",
      },
    ],
  })
    .compile()
    .build();
  if (built.byteLength > PARTNER_ASSISTANT_TEST_MIME_MAX_BYTES)
    throw new Error("Il messaggio con lookbook supera 4 MiB.");
  if (!built.every((byte) => byte < 0x80))
    throw new Error("Il messaggio composto non è solo ASCII.");
  const raw = built.toString("ascii");
  if (!`\r\n${raw}`.includes(`\r\nMessage-ID: ${message.messageId}\r\n`))
    throw new Error("Il Message-ID del messaggio composto non è su una riga sola.");
  return raw;
}

/** Nome mantenuto per i chiamanti della prova; l'autorizzazione dell'invio resta nel worker. */
export const composePartnerAssistantLookbookTestMessage = composePartnerAssistantLookbookMessage;
