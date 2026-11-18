import "server-only";
import {
  ImapFlow,
  type FetchMessageObject,
  type ImapFlowOptions,
  type MessageStructureObject,
} from "imapflow";
import { abortable } from "../shopify/worker-io";
import {
  PARTNER_ASSISTANT_IMAP_PORT,
  partnerAssistantMailAddress,
  type PartnerAssistantMailConfig,
} from "./mail-config";
import {
  isPartnerFollowupMessageId,
  parsePartnerFollowupIdentification,
} from "./followup-identification";
import type {
  PartnerInboxBatch,
  PartnerInboxCandidate,
  PartnerInboxCursor,
  PartnerInboxMessage,
} from "./inbox-store";

export type PartnerInboxMailboxInput = {
  activated_at: string;
  cursor: PartnerInboxCursor;
  candidates: PartnerInboxCandidate[];
};
export type PartnerInboxMailboxResult =
  { status: "complete"; batch: PartnerInboxBatch } | { status: "uncertain"; reason: string };
export type PartnerInboxMailboxDependencies = {
  createImapFlow?: (options: ImapFlowOptions) => ImapFlow;
  now?: () => number;
};
const MAX_BATCH = 50;
const MAX_HEADERS = 65_536;
const MAX_BODY = 32_768;
const HEADER_NAMES = [
  "From",
  "To",
  "Cc",
  "Sender",
  "Reply-To",
  "Message-ID",
  "In-Reply-To",
  "References",
  "Subject",
  "Content-Type",
  "Auto-Submitted",
  "X-Autoreply",
  "X-Autorespond",
  "Precedence",
  "List-Id",
  "List-Unsubscribe",
  "Return-Path",
];
const automaticSubject =
  /(?:^(?:automatic reply|auto(?:matic)?[- ]reply|out of (?:the )?office|risposta automatica|fuori ufficio|automatische antwort|abwesenheitsnotiz|r[eé]ponse automatique|respuesta autom[aá]tica|undeliverable|delivery status notification|mancata consegna)\b|(?:votre demande|your (?:enquiry|inquiry|request|application)|la (?:sua|tua|vostra) richiesta).{0,50}(?:re[cç]ue|received|ricevuta)|(?:confirmation|conferma).{0,35}(?:formulaire|form|registration|registrazione))/iu;
const normal = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
const uint = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 4_294_967_295;

function headersOf(message: FetchMessageObject): Map<string, string[]> | null {
  if (!Buffer.isBuffer(message.headers) || message.headers.byteLength > MAX_HEADERS) return null;
  const source = message.headers.toString("utf8");
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffd\u2028\u2029]/u.test(source)) return null;
  const result = new Map<string, string[]>();
  for (const line of source
    .replace(/\r?\n[ \t]+/gu, " ")
    .replace(/(?:\r?\n)+$/u, "")
    .split(/\r?\n/u)) {
    const match = /^([\x21-\x39\x3b-\x7e]+)[ \t]*:[ \t]*(.*)$/u.exec(line);
    if (!match) return null;
    const name = match[1].toLowerCase();
    result.set(name, [...(result.get(name) ?? []), match[2]]);
  }
  return result;
}
function addressOf(raw: string): string | null {
  const value = raw.trim();
  const bracket = /^(?:(?:"[^"\\]*"|[^<>()",;:@\\\[\]]+)\s*)?<([^<>]+)>$/u.exec(value);
  return partnerAssistantMailAddress(bracket ? bracket[1] : value);
}
function singleAddress(headers: Map<string, string[]>, field: string): string | null {
  const values = headers.get(field) ?? [];
  return values.length === 1 ? addressOf(values[0]) : null;
}
function recipientAddresses(headers: Map<string, string[]>, field: string): string[] | null {
  const values = headers.get(field) ?? [];
  if (!values.length) return [];
  if (values.length !== 1) return null;
  const tokens: string[] = [];
  let start = 0;
  let quoted = false;
  let angle = false;
  for (let index = 0; index < values[0].length; index++) {
    const char = values[0][index];
    if (quoted && char === "\\") {
      index++;
      continue;
    }
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === "<") {
      if (angle) return null;
      angle = true;
    } else if (!quoted && char === ">") {
      if (!angle) return null;
      angle = false;
    } else if (!quoted && !angle && char === ",") {
      tokens.push(values[0].slice(start, index));
      start = index + 1;
    }
  }
  if (quoted || angle) return null;
  tokens.push(values[0].slice(start));
  const addresses = tokens.map(addressOf);
  return addresses.every((value) => value !== null) ? addresses : null;
}
function headerIds(headers: Map<string, string[]>, name: string): string[] | null {
  const values = headers.get(name) ?? [];
  if (!values.length) return [];
  if (values.length !== 1) return null;
  const parsed = parsePartnerFollowupIdentification(
    values[0],
    name as "message-id" | "in-reply-to" | "references",
  );
  return parsed && parsed.form !== "bare" ? parsed.ids : null;
}

/** I metadati IMAP devono concordare con gli header; un messaggio automatico resta distinto
 * dalla risposta umana anche quando mittente o titolo corrispondono a una scheda. */
export function readPartnerInboxMessage(
  message: FetchMessageObject,
  own: string,
  activatedAt: number,
  now: number,
): PartnerInboxMessage | null {
  const h = headersOf(message);
  const e = message.envelope;
  const received = message.internalDate instanceof Date ? message.internalDate.getTime() : NaN;
  if (
    !h ||
    !e ||
    !Number.isFinite(received) ||
    received < activatedAt ||
    received > now ||
    e.from?.length !== 1
  )
    return null;
  const from =
    typeof e.from[0].address === "string" ? partnerAssistantMailAddress(e.from[0].address) : null;
  const envelopeAddresses = (field: "to" | "cc") =>
    (e[field] ?? []).map((entry) =>
      typeof entry.address === "string" ? partnerAssistantMailAddress(entry.address) : null,
    );
  const to = recipientAddresses(h, "to");
  const cc = recipientAddresses(h, "cc");
  const recipients = [...(to ?? []), ...(cc ?? [])];
  const ids = headerIds(h, "message-id");
  const id = ids?.length === 1 ? ids[0] : null;
  const subject = typeof e.subject === "string" ? e.subject.trim() : "";
  const subjectHeaders = h.get("subject") ?? [];
  if (
    !from ||
    from === own ||
    singleAddress(h, "from") !== from ||
    to === null ||
    cc === null ||
    JSON.stringify(to) !== JSON.stringify(envelopeAddresses("to")) ||
    JSON.stringify(cc) !== JSON.stringify(envelopeAddresses("cc")) ||
    !recipients.includes(own) ||
    !id ||
    !isPartnerFollowupMessageId(id) ||
    (e.messageId !== undefined && e.messageId !== id) ||
    subjectHeaders.length > 1 ||
    subject.length > 300 ||
    !subject.isWellFormed() ||
    /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(subject)
  )
    return null;
  const rawSubject = subjectHeaders[0]?.trim() ?? "";
  if (
    subjectHeaders.length &&
    !/=\?[^?\s]+\?[bq]\?[^?]+\?=/iu.test(rawSubject) &&
    rawSubject !== subject
  )
    return null;
  const auto = h.get("auto-submitted") ?? [];
  const precedence = h.get("precedence") ?? [];
  const content = h.get("content-type") ?? [];
  const returnPath = h.get("return-path") ?? [];
  const parent = headerIds(h, "in-reply-to");
  const references = headerIds(h, "references");
  const thread =
    parent !== null && references !== null
      ? [...new Set([...references, ...parent])].filter((reference) => reference !== id)
      : [];
  // Una persona può rispondere a un vecchio fuori ufficio conservandone l'oggetto.
  // La continuità valida evita soltanto l'euristica sul titolo, mai gli header automatici.
  const inheritedReplySubject = /^(?:re|aw|sv)\s*:\s*/iu.test(subject) && thread.length > 0;
  const automatic =
    (auto.length > 0 && (auto.length !== 1 || auto[0].trim().toLowerCase() !== "no")) ||
    ["x-autoreply", "x-autorespond", "list-id", "list-unsubscribe"].some((name) => h.has(name)) ||
    (precedence.length > 0 &&
      (precedence.length !== 1 || !/^normal$/iu.test(precedence[0].trim()))) ||
    /^(?:mailer-daemon|postmaster|no[-_.]?reply|do[-_.]?not[-_.]?reply|bounce(?:s)?)@/iu.test(
      from,
    ) ||
    returnPath.length > 1 ||
    (returnPath.length === 1 && !/^<[^<>\s]+@[^<>\s]+>$/u.test(returnPath[0].trim())) ||
    content.length > 1 ||
    (content.length === 1 &&
      !/^(?:text\/(?:plain|html)|multipart\/(?:alternative|mixed|related))(?:\s*;|$)/iu.test(
        content[0].trim(),
      )) ||
    (h.has("sender") && singleAddress(h, "sender") !== from) ||
    (!inheritedReplySubject &&
      automaticSubject.test(subject.replace(/^(?:(?:re|aw|sv|fwd?)\s*:\s*)+/iu, "")));
  return {
    message_id: id,
    from_address: from,
    received_at: new Date(received).toISOString(),
    subject,
    automatic,
    ...(thread.length && thread.length <= 64 ? { references: thread } : {}),
  };
}

type TextPart = { key: string; type: string; size: number; encoding: string; charset: string };
function textPart(structure: MessageStructureObject | undefined): TextPart | null {
  const found: TextPart[] = [];
  let count = 0;
  const visit = (node: MessageStructureObject | undefined, depth: number) => {
    if (
      !node ||
      ++count > 100 ||
      depth > 8 ||
      node.disposition?.toLowerCase() === "attachment" ||
      node.type?.toLowerCase() === "message/rfc822"
    )
      return;
    const type = node.type?.toLowerCase();
    const key = node.part ?? "TEXT";
    if (
      (type === "text/plain" || type === "text/html") &&
      /^(?:TEXT|[1-9][0-9]*(?:\.[1-9][0-9]*)*)$/u.test(key) &&
      Number.isSafeInteger(node.size) &&
      node.size! > 0 &&
      node.size! <= MAX_BODY &&
      !node.dispositionParameters?.filename &&
      !node.parameters?.name
    )
      found.push({
        key,
        type,
        size: node.size!,
        encoding: node.encoding?.toLowerCase() ?? "7bit",
        charset: node.parameters?.charset?.toLowerCase() ?? "us-ascii",
      });
    if (type?.startsWith("multipart/"))
      for (const child of node.childNodes ?? []) visit(child, depth + 1);
  };
  visit(structure, 0);
  return found.find((part) => part.type === "text/plain") ?? found[0] ?? null;
}
function textExcerpt(buffer: Buffer, part: TextPart, decoded: boolean): string | null {
  if (buffer.byteLength > MAX_BODY || (!decoded && buffer.byteLength !== part.size)) return null;
  let bytes = buffer;
  if (!decoded && part.encoding === "base64") {
    const value = buffer.toString("ascii").replace(/[\r\n\t ]/gu, "");
    if (
      buffer.some((byte) => byte > 127) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
    )
      return null;
    bytes = Buffer.from(value, "base64");
  } else if (!decoded && part.encoding === "quoted-printable") {
    const value = buffer.toString("latin1").replace(/=\r?\n/gu, "");
    const result: number[] = [];
    for (let index = 0; index < value.length; index++) {
      if (value[index] !== "=") result.push(value.charCodeAt(index));
      else if (/^[0-9a-f]{2}$/iu.test(value.slice(index + 1, index + 3))) {
        result.push(parseInt(value.slice(index + 1, index + 3), 16));
        index += 2;
      } else return null;
    }
    bytes = Buffer.from(result);
  } else if (!decoded && !["7bit", "8bit", "binary"].includes(part.encoding)) return null;
  try {
    let value = new TextDecoder(part.charset, { fatal: true }).decode(bytes);
    if (part.type === "text/html")
      value = value
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, " ")
        .replace(/<[^>]*>/gu, " ")
        .replace(
          /&(?:nbsp|amp|lt|gt|quot|apos);/giu,
          (entity) =>
            ({
              "&nbsp;": " ",
              "&amp;": "&",
              "&lt;": "<",
              "&gt;": ">",
              "&quot;": '"',
              "&apos;": "'",
            })[entity.toLowerCase()] ?? " ",
        );
    value = value
      .replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 2000)
      .replace(/[\ud800-\udbff]$/u, "");
    return value && value.isWellFormed() ? value : null;
  } catch {
    return null;
  }
}
function relevant(message: PartnerInboxMessage, candidates: PartnerInboxCandidate[]): boolean {
  const subject = ` ${normal(message.subject)} `;
  return candidates.some(
    (candidate) =>
      candidate.addresses.includes(message.from_address) ||
      (candidate.subject_alias !== null &&
        subject.includes(` ${normal(candidate.subject_alias)} `)),
  );
}

/** EXAMINE e BODY.PEEK: non marca letta la posta. Il cursore conserva l'ultimo UID del batch
 * completo, mai quello di un messaggio che un errore ha impedito di leggere. */
export async function checkPartnerAssistantInboxMailbox(
  mail: PartnerAssistantMailConfig,
  input: PartnerInboxMailboxInput,
  signal: AbortSignal,
  dependencies: PartnerInboxMailboxDependencies = {},
): Promise<PartnerInboxMailboxResult> {
  const now = dependencies.now ?? Date.now;
  const activated = Date.parse(input.activated_at);
  const own = partnerAssistantMailAddress(mail.user);
  if (
    !own ||
    !Number.isFinite(activated) ||
    activated > now() ||
    input.cursor.path !== "INBOX" ||
    !uint(input.cursor.last_uid) ||
    !(input.cursor.uid_validity === null || /^[1-9][0-9]{0,19}$/u.test(input.cursor.uid_validity))
  )
    return { status: "uncertain", reason: "inbox_input_non_valido" };
  let client: ImapFlow | null = null;
  let socketFailed = false;
  let lock: Awaited<ReturnType<ImapFlow["getMailboxLock"]>> | null = null;
  const abort = () => {
    try {
      client?.close();
    } catch {
      /* socket già chiuso */
    }
  };
  const call = <T>(task: () => Promise<T>) => abortable(task(), signal);
  try {
    if (signal.aborted) throw new Error("aborted");
    client = (dependencies.createImapFlow ?? ((options) => new ImapFlow(options)))({
      host: mail.imapHost,
      port: PARTNER_ASSISTANT_IMAP_PORT,
      secure: true,
      servername: mail.imapHost,
      tls: { minVersion: "TLSv1.2" },
      auth: { user: mail.user, pass: mail.password },
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    const box = client;
    box.on("error", () => {
      socketFailed = true;
    });
    signal.addEventListener("abort", abort, { once: true });
    await call(() => box.connect());
    lock = await call(() => box.getMailboxLock("INBOX", { readOnly: true }));
    const state = box.mailbox;
    if (
      !state ||
      state.path !== "INBOX" ||
      state.readOnly !== true ||
      typeof state.uidValidity !== "bigint" ||
      state.uidValidity <= 0n ||
      !uint(state.uidNext) ||
      state.uidNext < 1 ||
      !Number.isSafeInteger(state.exists) ||
      state.exists < 0
    )
      throw new Error("mailbox");
    const uidValidity = state.uidValidity.toString();
    const upper = state.uidNext - 1;
    if (input.cursor.uid_validity === uidValidity && input.cursor.last_uid > upper)
      throw new Error("uid_regressed");
    const lower = input.cursor.uid_validity === uidValidity ? input.cursor.last_uid + 1 : 1;
    let uids: number[] = [];
    if (lower <= upper) {
      const result = await call(() =>
        box.search(
          { uid: `${lower}:${upper}`, since: new Date(activated - 86_400_000) },
          { uid: true },
        ),
      );
      if (
        !Array.isArray(result) ||
        result.length > 50_000 ||
        result.some((uid) => !uint(uid) || uid < lower || uid > upper) ||
        new Set(result).size !== result.length
      )
        throw new Error("search");
      uids = result.sort((a, b) => a - b).slice(0, MAX_BATCH);
    }
    const rows = uids.length
      ? await call(() =>
          box.fetchAll(
            uids,
            {
              uid: true,
              size: true,
              envelope: true,
              headers: HEADER_NAMES,
              internalDate: true,
              bodyStructure: true,
            },
            { uid: true },
          ),
        )
      : [];
    if (
      !Array.isArray(rows) ||
      rows.length !== uids.length ||
      new Set(rows.map((row) => row.uid)).size !== uids.length ||
      rows.some((row) => !uids.includes(row.uid))
    )
      throw new Error("fetch");
    const messages: PartnerInboxMessage[] = [];
    for (const row of rows.sort((a, b) => a.uid - b.uid)) {
      const message = readPartnerInboxMessage(row, own, activated, now());
      if (!message) continue;
      if (!message.automatic && relevant(message, input.candidates)) {
        const part = textPart(row.bodyStructure);
        if (part) {
          const body = await call(() =>
            box.fetchOne(
              row.uid,
              { uid: true, bodyParts: [{ key: part.key, start: 0, maxLength: MAX_BODY + 1 }] },
              { uid: true },
            ),
          );
          if (!body || body.uid !== row.uid || !(body.bodyParts instanceof Map))
            throw new Error("body_fetch");
          const responseKey = part.key.toLowerCase();
          const bytes = body.bodyParts.get(responseKey);
          if (!Buffer.isBuffer(bytes)) throw new Error("body_fetch");
          const excerpt = textExcerpt(bytes, part, body.binaryParts?.has(responseKey) ?? false);
          if (excerpt) message.body_excerpt = excerpt;
        }
      }
      messages.push(message);
    }
    const after = box.mailbox;
    if (
      !after ||
      after.path !== "INBOX" ||
      after.uidValidity.toString() !== uidValidity ||
      after.readOnly !== true ||
      after.uidNext < upper + 1 ||
      box.usable !== true ||
      socketFailed
    )
      throw new Error("mailbox_changed");
    await call(() => box.noop());
    if (
      box.usable !== true ||
      socketFailed ||
      !box.mailbox ||
      box.mailbox.path !== "INBOX" ||
      box.mailbox.uidValidity.toString() !== uidValidity
    )
      throw new Error("connection");
    const last = uids.length === MAX_BATCH ? uids.at(-1)! : upper;
    return {
      status: "complete",
      batch: {
        folder: {
          path: "INBOX",
          uid_validity: uidValidity,
          expected_last_uid: input.cursor.last_uid,
          last_uid: Math.max(0, last),
        },
        messages,
      },
    };
  } catch {
    return { status: "uncertain", reason: "inbox_lettura_incompleta" };
  } finally {
    lock?.release();
    signal.removeEventListener("abort", abort);
    // Nessun logout può oltrepassare il budget: il socket chiuso non conserva una sessione.
    try {
      client?.close();
    } catch {
      /* già chiuso */
    }
  }
}
