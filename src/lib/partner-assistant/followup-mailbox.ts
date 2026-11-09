import "server-only";
import { createHash } from "node:crypto";
import { ImapFlow, type ImapFlowOptions, type FetchMessageObject } from "imapflow";
import { partnerAssistantMailAddress, type PartnerAssistantMailConfig } from "./mail-config";
import { isCalendarDay, addDays } from "../partner/dates";
import {
  PARTNER_FOLLOWUP_AUTO_REPLY_MAX_BYTES,
  readPartnerFollowupAutoReply,
} from "./followup-auto-reply";

export type PartnerAssistantFollowupMailboxInput = {
  ownAddress: string;
  addresses: string[];
  messageIds: string[];
  firstSentAt: string;
  subject: string;
  timezone: string;
};

export type PartnerAssistantFollowupMailboxResult =
  | {
      status: "clear";
      checkedAt: string;
      proofSha256: string;
      folderCount: number;
      messageCount: number;
    }
  | {
      status: "deferred";
      resumeOn: string;
      checkedAt: string;
      proofSha256: string;
      folderCount: number;
      messageCount: number;
    }
  | { status: "found"; reason: "reply" | "manual" | "ambiguous"; checkedAt: string }
  | { status: "uncertain"; reason: string };

export type PartnerAssistantFollowupMailboxDependencies = {
  createImapFlow?: (options: ImapFlowOptions) => ImapFlow;
  now?: () => number;
};

const MAX_FOLDERS = 64;
const MAX_MESSAGES = 5000;
const MAX_HEADERS_BYTES = 65_536;
const HEADER_NAMES = [
  "Message-ID",
  "References",
  "In-Reply-To",
  "Content-Type",
  "Auto-Submitted",
  "Return-Path",
  "To",
  "Cc",
  "Bcc",
  "Reply-To",
];
const MESSAGE_ID = /^<[^<>\s@\x00-\x20\x7f-\uffff]+@[^<>\s@\x00-\x20\x7f-\uffff]+>$/u;
type FolderState = { path: string; uidValidity: string; uidNext: number; exists: number };

class MailboxUncertain extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}
function stop(reason: string): never {
  throw new MailboxUncertain(`followup_${reason}`);
}
function normalizeSubject(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/^(?:(?:re|fw|fwd|aw|wg|sv)\s*(?:\[\d+\])?\s*:\s*)+/iu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/** La data di rientro appartiene al destinatario: mezzanotte a Roma può ancora essere
 * il pomeriggio precedente nel suo fuso. Scarti numerici non sono nomi IANA. */
function recipientDay(now: number, timezone: unknown): string {
  if (
    typeof timezone !== "string" ||
    timezone.length < 1 ||
    timezone.length > 80 ||
    /^[+-]/u.test(timezone) ||
    /[\x00-\x20\x7f]/u.test(timezone) ||
    !Number.isFinite(now)
  )
    return stop("invalid_input");
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(now));
    const part = (name: string) => parts.find((value) => value.type === name)?.value;
    const day = `${part("year")}-${part("month")}-${part("day")}`;
    if (isCalendarDay(day)) return day;
  } catch {
    // Nessuna correzione implicita del fuso o ripiego su Roma.
  }
  return stop("invalid_input");
}

function validatedInput(
  input: PartnerAssistantFollowupMailboxInput,
  mail: PartnerAssistantMailConfig,
  now: number,
): PartnerAssistantFollowupMailboxInput {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(",") !==
      "addresses,firstSentAt,messageIds,ownAddress,subject,timezone" ||
    typeof input.ownAddress !== "string" ||
    !Array.isArray(input.addresses) ||
    input.addresses.length < 1 ||
    input.addresses.length > 32 ||
    !Array.isArray(input.messageIds) ||
    input.messageIds.length < 1 ||
    input.messageIds.length > 64 ||
    typeof input.subject !== "string" ||
    input.subject.length > 300 ||
    /[\x00-\x1f\x7f]/u.test(input.subject) ||
    !normalizeSubject(input.subject) ||
    typeof input.firstSentAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      input.firstSentAt,
    )
  )
    return stop("invalid_input");
  recipientDay(now, input.timezone);
  const ownAddress = partnerAssistantMailAddress(input.ownAddress);
  const sent = Date.parse(input.firstSentAt);
  if (
    ownAddress === null ||
    ownAddress !== partnerAssistantMailAddress(mail.user) ||
    !Number.isFinite(sent) ||
    sent > now ||
    !Number.isFinite(now) ||
    !isCalendarDay(input.firstSentAt.slice(0, 10)) ||
    Number(input.firstSentAt.slice(11, 13)) > 23 ||
    Number(input.firstSentAt.slice(14, 16)) > 59 ||
    Number(input.firstSentAt.slice(17, 19)) > 59
  )
    return stop("invalid_input");
  const addresses = input.addresses.map((address) => {
    if (typeof address !== "string") return stop("invalid_input");
    const normalized = partnerAssistantMailAddress(address);
    if (normalized === null || normalized === ownAddress) return stop("invalid_input");
    return normalized;
  });
  if (
    new Set(addresses).size !== addresses.length ||
    input.messageIds.some(
      (id) => typeof id !== "string" || id.length > 254 || !MESSAGE_ID.test(id),
    ) ||
    new Set(input.messageIds).size !== input.messageIds.length
  )
    return stop("invalid_input");
  return { ...input, ownAddress, addresses };
}

function folderPaths(entries: Awaited<ReturnType<ImapFlow["list"]>>): string[] {
  if (!Array.isArray(entries)) return stop("folders_invalid");
  const paths: string[] = [];
  let inbox = 0;
  let sent = 0;
  let junk = 0;
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      entry.path.length < 1 ||
      entry.path.length > 1024 ||
      /[\x00-\x1f\x7f]/u.test(entry.path) ||
      !(entry.flags instanceof Set) ||
      [...entry.flags].some((flag) => typeof flag !== "string")
    )
      return stop("folders_invalid");
    const flags = new Set([...entry.flags].map((flag) => flag.toLowerCase()));
    if (flags.has("\\noselect") || flags.has("\\nonexistent")) continue;
    const use = entry.specialUse?.toLowerCase();
    if (entry.path.toLowerCase() !== "inbox" && (flags.has("\\inbox") || use === "\\inbox"))
      return stop("folders_invalid");
    if ((flags.has("\\sent") || use === "\\sent") && (flags.has("\\junk") || use === "\\junk"))
      return stop("folders_invalid");
    if (entry.path.toLowerCase() === "inbox") inbox++;
    if (flags.has("\\sent") || use === "\\sent") sent++;
    if (flags.has("\\junk") || use === "\\junk") junk++;
    paths.push(entry.path);
  }
  if (paths.length > MAX_FOLDERS) return stop("folder_limit");
  if (inbox !== 1 || sent !== 1 || junk !== 1) return stop("folders_missing");
  if (new Set(paths).size !== paths.length) return stop("folders_invalid");
  return paths.sort();
}

function folderState(client: ImapFlow, path: string): FolderState {
  const mailbox = client.mailbox;
  if (
    !mailbox ||
    mailbox.path !== path ||
    mailbox.readOnly !== true ||
    typeof mailbox.uidValidity !== "bigint" ||
    mailbox.uidValidity <= 0n ||
    !Number.isSafeInteger(mailbox.uidNext) ||
    mailbox.uidNext < 1 ||
    !Number.isSafeInteger(mailbox.exists) ||
    mailbox.exists < 0
  )
    return stop("mailbox_invalid");
  return {
    path,
    uidValidity: mailbox.uidValidity.toString(),
    uidNext: mailbox.uidNext,
    exists: mailbox.exists,
  };
}

function headersOf(message: FetchMessageObject): Map<string, string[]> {
  if (!Buffer.isBuffer(message.headers) || message.headers.byteLength > MAX_HEADERS_BYTES)
    return stop("headers_invalid");
  const text = message.headers.toString("utf8");
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffd]/u.test(text)) return stop("headers_invalid");
  const result = new Map<string, string[]>();
  for (const line of text.replace(/\r?\n[ \t]+/gu, " ").split(/\r?\n/u)) {
    if (line === "") continue;
    const match = /^([!#$%&'*+\-.^_`|~\da-z]+):[ \t]*(.*)$/iu.exec(line);
    if (!match) return stop("headers_invalid");
    const name = match[1].toLowerCase();
    result.set(name, [...(result.get(name) ?? []), match[2]]);
  }
  return result;
}

type EnvelopeField = "from" | "to" | "cc" | "bcc" | "replyTo" | "sender";
type AddressToken = { group: string } | { address: string };
const GROUP_HEADERS = { to: "to", cc: "cc", bcc: "bcc", replyTo: "reply-to" } as const;
const groupName = (value: string) =>
  value
    .trim()
    .replace(/[ \t]+/gu, " ")
    .toLowerCase();

/** Forma minima verificabile del gruppo RFC 9051: frase ASCII semplice e membri bare addr-spec.
 * Nomi quoted/encoded, commenti e altre forme non supportate restano incerti. Non scartiamo parti
 * che non sappiamo leggere. L'ordine include il marker iniziale e tutti i membri, senza end marker. */
function canonicalAddressList(value: string): AddressToken[] | null {
  if (!value || /[^\x09\x20-\x7e]/u.test(value)) return null;
  const result: AddressToken[] = [];
  let cursor = 0;
  const space = () => {
    while (cursor < value.length && /[ \t]/u.test(value[cursor])) cursor++;
  };
  const mailbox = (): boolean => {
    const end = value.slice(cursor).search(/[,;]/u);
    const until = end < 0 ? value.length : cursor + end;
    const raw = value.slice(cursor, until).trim();
    const address = partnerAssistantMailAddress(raw);
    if (address === null) return false;
    const [local, domain] = address.split("@");
    if (
      local.split(".").some((atom) => atom.length === 0) ||
      domain.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
    )
      return false;
    result.push({ address });
    cursor = until;
    return true;
  };
  space();
  while (cursor < value.length) {
    const group = /^([A-Za-z0-9][A-Za-z0-9 _-]{0,199}):/u.exec(value.slice(cursor));
    if (group) {
      result.push({ group: groupName(group[1]) });
      cursor += group[0].length;
      space();
      while (value[cursor] !== ";") {
        if (!mailbox()) return null;
        if (value[cursor] === ";") break;
        if (value[cursor] !== ",") return null;
        cursor++;
        space();
        if (value[cursor] === ";") return null;
      }
      if (value[cursor] !== ";") return null;
      cursor++;
    } else if (!mailbox()) return null;
    space();
    if (cursor === value.length) return result;
    if (value[cursor] !== ",") return null;
    cursor++;
    space();
    if (cursor === value.length) return null;
  }
  return null;
}

function messageReason(
  message: FetchMessageObject,
  input: PartnerAssistantFollowupMailboxInput,
): "reply" | "manual" | "ambiguous" | null {
  const envelope = message.envelope;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
    return stop("envelope_invalid");
  const headers = headersOf(message);
  const grouped = new Set<EnvelopeField>();
  const addresses = (field: EnvelopeField): string[] => {
    const value: unknown = envelope[field];
    const code = field === "replyTo" ? "reply_to" : field;
    const invalid = (): never => stop(`envelope_${code}_invalid`);
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length === 0) return invalid();
    const tokens: AddressToken[] = [];
    const members: string[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return invalid();
      if (Object.keys(entry).some((key) => key !== "name" && key !== "address")) return invalid();
      if (
        entry.name !== undefined &&
        (typeof entry.name !== "string" ||
          !entry.name.isWellFormed() ||
          /[\x00-\x1f\x7f-\x9f\u2028\u2029\ufffd]/u.test(entry.name))
      )
        return invalid();
      // ImapFlow 2.4.2 tools.parseEnvelope restituisce address:'' solo per NIL host.
      // Poiché !host confonde anche host malformati, prima di clear verifichiamo l'header reale.
      if (entry.address === "" && field !== "from" && field !== "sender") {
        if (typeof entry.name !== "string" || !entry.name.trim()) return invalid();
        grouped.add(field);
        tokens.push({ group: groupName(entry.name) });
        continue;
      }
      if (typeof entry.address !== "string") return invalid();
      const address = partnerAssistantMailAddress(entry.address);
      if (address === null) return invalid();
      tokens.push({ address });
      members.push(address);
    }
    if (grouped.has(field)) {
      const values = headers.get(GROUP_HEADERS[field as keyof typeof GROUP_HEADERS]) ?? [];
      const parsed = values.length === 1 ? canonicalAddressList(values[0]) : null;
      if (parsed === null || JSON.stringify(parsed) !== JSON.stringify(tokens))
        return stop(`envelope_${code}_group_unverified`);
    }
    return members;
  };
  const from = addresses("from");
  const to = addresses("to");
  const cc = addresses("cc");
  const bcc = addresses("bcc");
  const replyTo = addresses("replyTo");
  const sender = addresses("sender");
  if (from.length === 0) return stop("envelope_from_invalid");
  const subject: unknown = envelope.subject;
  if (
    subject !== undefined &&
    subject !== null &&
    (typeof subject !== "string" ||
      !subject.isWellFormed() ||
      subject.length > MAX_HEADERS_BYTES ||
      /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(subject))
  )
    return stop("envelope_subject_invalid");
  const ids = (name: string): string[] => {
    const values = headers.get(name) ?? [];
    return values.flatMap((value) => {
      const matched = value.match(/<[^<>\s@]+@[^<>\s@]+>/gu) ?? [];
      if (value.trim() && matched.length === 0) return stop("headers_invalid");
      return matched;
    });
  };
  const messageIds = ids("message-id");
  const references = [...ids("in-reply-to"), ...ids("references")];
  const own = from.includes(input.ownAddress);
  const expected = new Set(input.addresses);
  const known = new Set(input.messageIds);
  if (
    own &&
    from.length === 1 &&
    messageIds.length === 1 &&
    known.has(messageIds[0]) &&
    to.length > 0 &&
    [...to, ...cc].every((address) => expected.has(address)) &&
    bcc.length === 0 &&
    !headers.has("bcc") &&
    grouped.size === 0 &&
    (sender.length === 0 || (sender.length === 1 && sender[0] === input.ownAddress)) &&
    (replyTo.length === 0 || (replyTo.length === 1 && replyTo[0] === input.ownAddress)) &&
    (!headers.has("reply-to") ||
      JSON.stringify(canonicalAddressList((headers.get("reply-to") ?? []).join(","))) ===
        JSON.stringify([{ address: input.ownAddress }]))
  )
    return null;
  if (
    references.some((id) => known.has(id)) ||
    [...from, ...to, ...cc, ...bcc, ...replyTo, ...sender].some((address) => expected.has(address))
  )
    return own ? "manual" : "reply";
  if (messageIds.some((id) => known.has(id))) return own ? "manual" : "ambiguous";
  if (typeof subject === "string" && normalizeSubject(subject) === normalizeSubject(input.subject))
    return "ambiguous";
  const report = (headers.get("content-type") ?? []).some((value) =>
    /(?:multipart\/report|message\/delivery-status)/iu.test(value),
  );
  const daemon = from.some((address) => /^(?:mailer-daemon|postmaster)@/iu.test(address));
  const emptyReturnPath = (headers.get("return-path") ?? []).some((value) => value.trim() === "<>");
  if ([...to, ...cc, ...bcc].includes(input.ownAddress) && (report || daemon || emptyReturnPath))
    return "ambiguous";
  return null;
}

/** Lettura completa della casella: un risultato incerto non autorizza mai un sollecito. */
export async function checkPartnerAssistantFollowupMailbox(
  mail: PartnerAssistantMailConfig,
  input: PartnerAssistantFollowupMailboxInput,
  signal: AbortSignal,
  dependencies: PartnerAssistantFollowupMailboxDependencies = {},
): Promise<PartnerAssistantFollowupMailboxResult> {
  const now = dependencies.now ?? Date.now;
  let client: ImapFlow | null = null;
  let socketFailed = false;
  const close = () => {
    try {
      client?.close();
    } catch {
      // Il socket può essere già chiuso.
    }
  };
  const active = () => {
    if (signal.aborted) stop("aborted");
    if (socketFailed) stop("connection_failed");
  };
  async function call<T>(operation: () => Promise<T>): Promise<T> {
    active();
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new MailboxUncertain("followup_aborted"));
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      const pending = operation().finally(() => {
        if (signal.aborted || socketFailed) close();
      });
      const value = await Promise.race([pending, cancelled]);
      active();
      return value;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  let result: PartnerAssistantFollowupMailboxResult;
  signal.addEventListener("abort", close, { once: true });
  try {
    active();
    const value = validatedInput(input, mail, now());
    client = (dependencies.createImapFlow ?? ((options) => new ImapFlow(options)))({
      host: mail.imapHost,
      port: 993,
      secure: true,
      servername: mail.imapHost,
      tls: { minVersion: "TLSv1.2" },
      auth: { user: mail.user, pass: mail.password },
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: 20_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });
    const box = client;
    box.on("error", () => {
      socketFailed = true;
      close();
    });
    await call(() => box.connect());
    const paths = folderPaths(await call(() => box.list()));
    const states: (FolderState & { uids: number[] })[] = [];
    const datedReplies: { path: string; uid: number; resumeOn: string; sha256: string }[] = [];
    const today = recipientDay(now(), value.timezone);
    let resumeOn: string | null = null;
    let messageCount = 0;
    // SINCE cerca giorni interni IMAP, non millisecondi né il Date: scritto dal mittente.
    const since = new Date(Date.parse(value.firstSentAt) - 86_400_000);
    for (const path of paths) {
      const lock = await call(() => box.getMailboxLock(path, { readOnly: true }));
      try {
        const before = folderState(box, path);
        const uids = await call(() => box.search({ since }, { uid: true }));
        if (
          !Array.isArray(uids) ||
          uids.some((uid) => !Number.isSafeInteger(uid) || uid < 1 || uid >= before.uidNext) ||
          new Set(uids).size !== uids.length ||
          uids.length > before.exists
        )
          stop("search_invalid");
        messageCount += uids.length;
        if (messageCount > MAX_MESSAGES) stop("message_limit");
        const messages = uids.length
          ? await call(() =>
              box.fetchAll(
                uids,
                {
                  uid: true,
                  size: true,
                  envelope: true,
                  headers: HEADER_NAMES,
                  internalDate: true,
                },
                { uid: true },
              ),
            )
          : [];
        if (
          !Array.isArray(messages) ||
          messages.length !== uids.length ||
          new Set(messages.map((message) => message.uid)).size !== uids.length ||
          messages.some((message) => !uids.includes(message.uid))
        )
          stop("fetch_incomplete");
        for (const message of messages) {
          const reason = messageReason(message, value);
          if (!reason) continue;
          const headers = headersOf(message);
          const auto = headers.get("auto-submitted") ?? [];
          const collision = (headers.get("message-id") ?? []).some((id) =>
            value.messageIds.includes(id.trim()),
          );
          if (
            reason === "reply" &&
            !collision &&
            auto.length === 1 &&
            auto[0].trim().toLowerCase() === "auto-replied"
          ) {
            const full = await call(() =>
              box.fetchOne(
                message.uid,
                {
                  uid: true,
                  size: true,
                  source: { start: 0, maxLength: PARTNER_FOLLOWUP_AUTO_REPLY_MAX_BYTES + 1 },
                },
                { uid: true },
              ),
            );
            if (!full || full.uid !== message.uid) stop("fetch_incomplete");
            const source = full.source;
            // RFC822.SIZE deve coincidere prima/dopo e con gli ottetti ricevuti. Il byte
            // extra richiesto rileva anche un messaggio oltre il budget, senza troncarlo.
            if (
              !Number.isSafeInteger(message.size) ||
              message.size! < 1 ||
              !Number.isSafeInteger(full.size) ||
              full.size !== message.size ||
              !Buffer.isBuffer(source) ||
              source.byteLength !== full.size ||
              source.byteLength > PARTNER_FOLLOWUP_AUTO_REPLY_MAX_BYTES
            )
              return {
                status: "found",
                reason: "ambiguous",
                checkedAt: new Date(now()).toISOString(),
              };
            const automatic = readPartnerFollowupAutoReply(source);
            if (automatic.status !== "dated" || automatic.resumeOn > addDays(today, 366))
              return {
                status: "found",
                reason: "ambiguous",
                checkedAt: new Date(now()).toISOString(),
              };
            datedReplies.push({
              path,
              uid: message.uid,
              resumeOn: automatic.resumeOn,
              sha256: createHash("sha256").update(source).digest("hex"),
            });
            if (automatic.resumeOn > today && (resumeOn === null || automatic.resumeOn > resumeOn))
              resumeOn = automatic.resumeOn;
            // Anche dopo una data futura continuiamo: una risposta umana in un'altra
            // cartella prevale sul rinvio; un errore successivo rende tutto incerto.
            continue;
          }
          return { status: "found", reason, checkedAt: new Date(now()).toISOString() };
        }
        if (JSON.stringify(folderState(box, path)) !== JSON.stringify(before))
          stop("mailbox_changed");
        states.push({ ...before, uids: [...uids].sort((a, b) => a - b) });
      } finally {
        lock.release();
      }
    }
    // Anche una cartella già letta può ricevere una risposta mentre leggiamo le successive.
    for (const state of states) {
      const lock = await call(() => box.getMailboxLock(state.path, { readOnly: true }));
      try {
        const { uids: _, ...before } = state;
        if (JSON.stringify(folderState(box, state.path)) !== JSON.stringify(before))
          stop("mailbox_changed");
      } finally {
        lock.release();
      }
    }
    const finalPaths = folderPaths(await call(() => box.list()));
    if (JSON.stringify(paths) !== JSON.stringify(finalPaths)) stop("folders_changed");
    await call(() => box.noop());
    if (box.usable !== true) stop("connection_failed");
    const checkedAt = new Date(now()).toISOString();
    const complete = {
      checkedAt,
      proofSha256: createHash("sha256")
        .update(JSON.stringify({ version: 2, input: value, states, datedReplies, checkedAt }))
        .digest("hex"),
      folderCount: paths.length,
      messageCount,
    };
    result =
      resumeOn === null
        ? { status: "clear", ...complete }
        : { status: "deferred", resumeOn, ...complete };
  } catch (error) {
    close();
    result = {
      status: "uncertain",
      reason: error instanceof MailboxUncertain ? error.reason : "followup_imap_failed",
    };
  } finally {
    if (client?.usable && !signal.aborted && !socketFailed) {
      try {
        await call(() => client!.logout());
      } catch {
        close();
      }
    }
    close();
    signal.removeEventListener("abort", close);
  }
  if (signal.aborted) return { status: "uncertain", reason: "followup_aborted" };
  if (socketFailed) return { status: "uncertain", reason: "followup_connection_failed" };
  return result;
}
