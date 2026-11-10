import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { FetchMessageObject, ImapFlow, ImapFlowOptions } from "imapflow";
import {
  checkPartnerAssistantFollowupMailbox,
  type PartnerAssistantFollowupMailboxInput,
} from "./followup-mailbox";
import type { PartnerAssistantMailConfig } from "./mail-config";

// La compatibilità va verificata sul DTO realmente prodotto dalla versione locale di ImapFlow,
// non ricostruendo a mano un formato diverso da quello della libreria.
const require = createRequire(import.meta.url);
const { parseEnvelope } = require(join(dirname(require.resolve("imapflow")), "tools.js")) as {
  parseEnvelope: (value: unknown[]) => NonNullable<FetchMessageObject["envelope"]>;
};
const token = (value: string) => ({ type: "STRING", value });
const rawAddress = (address: string, name = "") => {
  const at = address.lastIndexOf("@");
  return [
    name ? token(name) : null,
    null,
    token(address.slice(0, at)),
    token(address.slice(at + 1)),
  ];
};
const rawGroup = (name: string) => [null, null, token(name), null];
const rawGroupEnd = () => [null, null, null, null];
type RawEnvelopeOptions = {
  from?: unknown;
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  replyTo?: unknown;
  sender?: unknown;
  subject?: string | null;
};
function realEnvelope(options: RawEnvelopeOptions = {}) {
  return parseEnvelope([
    null,
    options.subject == null ? null : token(options.subject),
    Object.hasOwn(options, "from") ? options.from : [rawAddress("notice@unrelated.example.test")],
    options.sender ?? null,
    options.replyTo ?? null,
    options.to ?? null,
    options.cc ?? null,
    options.bcc ?? null,
    null,
    token("<synthetic@unrelated.example.test>"),
  ]);
}

const own = "sender@brand.example.test";
const target = "info@partner.example.test";
const knownId = "<00000000-0000-4000-8000-000000000001@brand.example.test>";
const NOW = Date.parse("2026-11-09T08:00:00Z");
const input: PartnerAssistantFollowupMailboxInput = {
  ownAddress: own,
  addresses: [target],
  messageIds: [knownId],
  firstSentAt: "2026-11-01T10:00:00Z",
  subject: "Progetto sintetico",
  timezone: "Europe/Rome",
};
const mail: PartnerAssistantMailConfig = {
  user: own,
  password: "synthetic-password",
  fromName: "Nome sintetico",
  smtpHost: "smtp.example.test",
  imapHost: "imap.example.test",
  testTo: [],
  domain: "brand.example.test",
};
const folder = (path: string, flag?: string) => ({ path, flags: new Set(flag ? [flag] : []) });
const folders = [
  folder("INBOX"),
  folder("Sent", "\\Sent"),
  folder("Junk", "\\Junk"),
  folder("Archive", "\\Archive"),
  folder("Trash", "\\Trash"),
  folder("Clienti/Partner"),
];
function message(uid: number, change: Partial<FetchMessageObject> = {}): FetchMessageObject {
  return {
    uid,
    seq: uid,
    internalDate: new Date("2026-11-05T12:00:00Z"),
    envelope: {
      from: [{ address: "notice@unrelated.example.test" }],
      to: [{ address: own }],
      subject: "Avviso sintetico indipendente",
    },
    headers: Buffer.from(
      `Message-ID: <message-${uid}@unrelated.example.test>\r\nContent-Type: text/plain\r\n`,
    ),
    ...change,
  };
}
type FolderState = {
  path: string;
  uidValidity: bigint;
  uidNext: number;
  exists: number;
  readOnly: boolean;
};
class FakeImap extends EventEmitter {
  usable = false;
  mailbox: FolderState | false = false;
  readonly selected = new Map<string, number>();
  readonly releases = vi.fn();
  onLock?: (path: string, count: number) => void;
  constructor(readonly messages: Record<string, FetchMessageObject[]> = {}) {
    super();
  }
  connect = vi.fn(async () => {
    this.usable = true;
  });
  list = vi.fn(async () => folders);
  getMailboxLock = vi.fn(async (path: string, _options: { readOnly: boolean }) => {
    const rows = this.messages[path] ?? [];
    this.mailbox = {
      path,
      uidValidity: 100n,
      uidNext: Math.max(0, ...rows.map((row) => row.uid)) + 1,
      exists: rows.length,
      readOnly: true,
    };
    const count = (this.selected.get(path) ?? 0) + 1;
    this.selected.set(path, count);
    this.onLock?.(path, count);
    return { path, release: this.releases };
  });
  search = vi.fn(async (_query: unknown, _options: unknown): Promise<number[] | false> =>
    this.mailbox ? (this.messages[this.mailbox.path] ?? []).map((row) => row.uid) : false,
  );
  fetchAll = vi.fn(async (_uids: number[], _query: unknown, _options: unknown) =>
    this.mailbox ? (this.messages[this.mailbox.path] ?? []) : [],
  );
  fetchOne = vi.fn(async (uid: number, _query: unknown, _options: unknown) =>
    this.mailbox
      ? ((this.messages[this.mailbox.path] ?? []).find((row) => row.uid === uid) ?? false)
      : false,
  );
  noop = vi.fn(async () => {});
  logout = vi.fn(async () => {
    this.usable = false;
  });
  close = vi.fn(() => {
    this.usable = false;
  });
}
function fixture(messages: Record<string, FetchMessageObject[]> = {}, clock = NOW) {
  const fake = new FakeImap(messages);
  const create = vi.fn((_options: ImapFlowOptions) => fake as unknown as ImapFlow);
  const controller = new AbortController();
  const run = (value = input) =>
    checkPartnerAssistantFollowupMailbox(mail, value, controller.signal, {
      createImapFlow: create,
      now: () => clock,
    });
  return { fake, create, controller, run };
}

function autoReply(uid = 1, body = "I am out of the office. I will return on 2026-11-17.") {
  const headers = Buffer.from(
    `Message-ID: <ooo-${uid}@partner.example.test>\r\nIn-Reply-To: ${knownId}\r\nAuto-Submitted: auto-replied\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n`,
  );
  const source = Buffer.concat([headers, Buffer.from(`\r\n${body.replace(/\r?\n/gu, "\r\n")}`)]);
  return message(uid, {
    envelope: { from: [{ address: target }], to: [{ address: own }], subject: "Automatic reply" },
    headers,
    source,
    size: source.byteLength,
  });
}

const otherPeer = "office@other-partner.example.test";
const otherSentId = "<other-outbound@brand.example.test>";
const otherSubject = "Progetto distinto";
function otherThread() {
  const original = message(7, {
    internalDate: new Date("2026-11-03T10:00:00Z"),
    envelope: realEnvelope({
      from: [rawAddress(own, "Nome sintetico")],
      to: [rawAddress(otherPeer)],
      subject: otherSubject,
    }),
    headers: Buffer.from(
      `From: "Nome sintetico" <${own}>\r\nTo: ${otherPeer}\r\nSubject: ${otherSubject}\r\nMessage-ID: ${otherSentId}\r\nContent-Type: text/plain; charset=utf-8\r\n`,
    ),
  });
  const replySubject = `Risposta automatica: ${otherSubject}`;
  const reply = message(8, {
    internalDate: new Date("2026-11-04T10:01:00Z"),
    envelope: realEnvelope({
      from: [rawAddress(otherPeer, "Ufficio sintetico")],
      to: [rawAddress(own, "Nome sintetico")],
      subject: replySubject,
    }),
    headers: Buffer.from(
      `Return-Path: <>\r\nFrom: Ufficio sintetico <${otherPeer}>\r\nTo: Nome sintetico <${own}>\r\nSubject: ${replySubject}\r\nMessage-ID: <other-automatic@other-partner.example.test>\r\nIn-Reply-To: ${otherSentId}\r\nReferences: ${otherSentId}\r\nAuto-Submitted: auto-generated\r\nContent-Type: multipart/alternative; boundary="synthetic"\r\n`,
    ),
  });
  return { original, reply };
}
function replaceHeader(message: FetchMessageObject, name: string, value: string | null) {
  const lines = message.headers!.toString().split("\r\n");
  message.headers = Buffer.from(
    lines
      .filter((line) => !line.toLowerCase().startsWith(`${name.toLowerCase()}:`))
      .filter(Boolean)
      .concat(value === null ? [] : [`${name}: ${value}`])
      .join("\r\n") + "\r\n",
  );
}

describe("verifica della casella prima dei solleciti", () => {
  it("legge tutte le cartelle in sola lettura, ricontrolla gli UID e chiude sempre il socket", async () => {
    const f = fixture({ Archive: [message(5)] });
    const result = await f.run();
    expect(result).toMatchObject({
      status: "clear",
      checkedAt: new Date(NOW).toISOString(),
      folderCount: 6,
      messageCount: 1,
      proofSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(JSON.stringify(result)).not.toMatch(/@|Progetto|Archive|Avviso/u);
    expect(f.fake.list).toHaveBeenCalledTimes(2);
    expect(f.fake.getMailboxLock).toHaveBeenCalledTimes(12);
    expect(f.fake.releases).toHaveBeenCalledTimes(12);
    expect(f.fake.getMailboxLock.mock.calls.every(([, options]) => options.readOnly)).toBe(true);
    expect(f.fake.search.mock.calls.every(([, options]) => (options as { uid: boolean }).uid)).toBe(
      true,
    );
    expect(f.fake.search.mock.calls[0][0]).toEqual({ since: new Date("2026-10-31T10:00:00Z") });
    expect(f.fake.fetchAll).toHaveBeenCalledWith(
      [5],
      expect.objectContaining({
        uid: true,
        envelope: true,
        headers: expect.arrayContaining(["References", "In-Reply-To", "Auto-Submitted"]),
      }),
      { uid: true },
    );
    expect(f.fake.noop).toHaveBeenCalledOnce();
    expect(f.fake.logout).toHaveBeenCalledOnce();
    expect(f.fake.close).toHaveBeenCalled();
    expect(f.create.mock.calls[0][0]).toMatchObject({
      port: 993,
      secure: true,
      logger: false,
      disableAutoIdle: true,
      tls: { minVersion: "TLSv1.2" },
    });
  });

  it.each(["INBOX", "Junk", "Archive", "Trash", "Clienti/Partner"])(
    "blocca una risposta nella cartella %s",
    async (path) => {
      const f = fixture({ [path]: [message(4, { envelope: { from: [{ address: target }] } })] });
      expect(await f.run()).toEqual({
        status: "found",
        reason: "reply",
        checkedAt: new Date(NOW).toISOString(),
      });
      expect(f.fake.close).toHaveBeenCalled();
    },
  );
  it.each(["References", "In-Reply-To"])(
    "riconosce alias da %s, anche con header ripiegato",
    async (header) => {
      const f = fixture({
        Archive: [message(2, { headers: Buffer.from(`${header}:\r\n\t${knownId}\r\n`) })],
      });
      expect(await f.run()).toMatchObject({ status: "found", reason: "reply" });
    },
  );
  it.each(["to", "cc", "replyTo", "sender"] as const)(
    "riconosce un indirizzo esatto nel campo %s",
    async (field) => {
      const f = fixture({
        INBOX: [
          message(2, { envelope: { from: [{ address: own }], [field]: [{ address: target }] } }),
        ],
      });
      expect(await f.run()).toMatchObject({ status: "found", reason: "manual" });
    },
  );
  it("esclude la prima email nota soltanto con il nostro mittente e il destinatario previsto", async () => {
    const original = message(1, {
      envelope: { from: [{ address: own }], to: [{ address: target }], subject: input.subject },
      headers: Buffer.from(`Message-ID: ${knownId}\r\n`),
    });
    expect(await fixture({ Sent: [original] }).run()).toMatchObject({
      status: "clear",
      messageCount: 1,
    });
    original.envelope!.from = [{ address: "other@unrelated.example.test" }];
    expect(await fixture({ Sent: [original] }).run()).toMatchObject({
      status: "found",
      reason: "reply",
    });
    original.envelope = {
      from: [{ address: own }],
      to: [{ address: "other@unrelated.example.test" }],
      subject: "Altro",
    };
    expect(await fixture({ Sent: [original] }).run()).toMatchObject({
      status: "found",
      reason: "manual",
    });
  });
  it("la corrispondenza parziale o il nome visualizzato non valgono come indirizzo esatto", async () => {
    const f = fixture({
      INBOX: [
        message(2, {
          envelope: { from: [{ name: target, address: `foo-${target}` }], subject: "Altro" },
        }),
      ],
    });
    expect(await f.run()).toMatchObject({ status: "clear" });
  });
  it("non ignora risposte automatiche, OOO e messaggi con stop", async () => {
    const f = fixture({
      INBOX: [
        message(2, {
          envelope: { from: [{ address: target }], subject: "Stop" },
          headers: Buffer.from("Auto-Submitted: auto-replied\r\n"),
        }),
      ],
    });
    expect(await f.run()).toMatchObject({ status: "found", reason: "ambiguous" });
  });
  it.each(["Re: Progetto sintetico", " Fwd: Re: Progetto sintetico", "AW: Progetto sintetico"])(
    "blocca un possibile inoltro con oggetto %s",
    async (subject) => {
      const f = fixture({
        INBOX: [
          message(2, {
            envelope: { from: [{ address: "alias@unrelated.example.test" }], subject },
          }),
        ],
      });
      expect(await f.run()).toMatchObject({ status: "found", reason: "ambiguous" });
    },
  );
  it("blocca un DSN potenzialmente nostro anche senza riferimenti", async () => {
    const f = fixture({
      INBOX: [
        message(2, {
          headers: Buffer.from(
            "Content-Type: multipart/report; report-type=delivery-status\r\nReturn-Path: <>\r\n",
          ),
        }),
      ],
    });
    expect(await f.run()).toMatchObject({ status: "found", reason: "ambiguous" });
  });
  it("un Return-Path vuoto ricevuto da noi resta ambiguo anche senza il formato DSN", async () => {
    const f = fixture({
      INBOX: [
        message(2, { headers: Buffer.from("Return-Path: <>\r\nContent-Type: text/plain\r\n") }),
      ],
    });
    expect(await f.run()).toMatchObject({ status: "found", reason: "ambiguous" });
  });
  it("distingue un autoresponder di un altro thread solo dalla copia originale in Sent e dopo la lettura completa", async () => {
    const { original, reply } = otherThread();
    const f = fixture({ INBOX: [reply], Sent: [original] });
    expect(await f.run()).toMatchObject({ status: "clear", messageCount: 2, folderCount: 6 });
    expect(f.fake.getMailboxLock).toHaveBeenCalledTimes(12);
    expect(f.fake.list).toHaveBeenCalledTimes(2);
    expect(f.fake.fetchOne).not.toHaveBeenCalled();
  });
  it("riconosce anche i default ENVELOPE di Sender e Reply-To quando gli header sono assenti", async () => {
    const { original, reply } = otherThread();
    original.envelope!.sender = [{ address: own }];
    original.envelope!.replyTo = [{ address: own }];
    reply.envelope!.sender = [{ address: otherPeer }];
    reply.envelope!.replyTo = [{ address: otherPeer }];
    expect(await fixture({ INBOX: [reply], Sent: [original] }).run()).toMatchObject({
      status: "clear",
    });
  });
  it.each(["missing", "outsideSent", "duplicate", "inconsistentDuplicate"] as const)(
    "non esclude l'autoresponder con originale %s",
    async (change) => {
      const { original, reply } = otherThread();
      const rows: Record<string, FetchMessageObject[]> = { INBOX: [reply] };
      if (change === "outsideSent") rows.INBOX.push(original);
      else if (change !== "missing") rows.Sent = [original];
      if (change === "duplicate" || change === "inconsistentDuplicate") {
        const copy = { ...original, uid: 9 };
        if (change === "inconsistentDuplicate")
          replaceHeader(copy, "From", "forged@unrelated.example.test");
        rows.Sent.push(copy);
      }
      expect(await fixture(rows).run()).toMatchObject({ status: "found", reason: "ambiguous" });
    },
  );
  it.each([
    "senderMismatch",
    "recipientMismatch",
    "subjectMismatch",
    "subjectHeaderMismatch",
    "missingFrom",
    "duplicateMessageId",
    "invalidDate",
    "laterDate",
  ] as const)("rifiuta l'originale non verificabile (%s)", async (change) => {
    const { original, reply } = otherThread();
    if (change === "senderMismatch")
      original.envelope!.from = [{ address: "forged@unrelated.example.test" }];
    if (change === "recipientMismatch")
      replaceHeader(original, "To", "other@unrelated.example.test");
    if (change === "subjectMismatch") {
      original.envelope!.subject = "Oggetto diverso";
      replaceHeader(original, "Subject", "Oggetto diverso");
    }
    if (change === "subjectHeaderMismatch") replaceHeader(original, "Subject", "Oggetto diverso");
    if (change === "missingFrom") replaceHeader(original, "From", null);
    if (change === "duplicateMessageId")
      original.headers = Buffer.concat([
        original.headers!,
        Buffer.from(`Message-ID: ${otherSentId}\r\n`),
      ]);
    if (change === "invalidDate") original.internalDate = new Date("invalid");
    if (change === "laterDate") original.internalDate = new Date("2026-11-05T10:00:00Z");
    expect(await fixture({ INBOX: [reply], Sent: [original] }).run()).toMatchObject({
      status: "found",
      reason: "ambiguous",
    });
  });
  it.each([
    "missingReference",
    "mixedReferences",
    "missingAuto",
    "unknownAuto",
    "unknownPrefix",
    "recipientHeaderMismatch",
    "hiddenRecipient",
    "duplicateReturnPath",
    "futureDate",
    "senderHeaderMismatch",
    "unknownReplyTo",
    "report",
    "mixedMime",
    "daemon",
  ] as const)("mantiene ambiguo l'automatismo non dimostrato (%s)", async (change) => {
    const { original, reply } = otherThread();
    if (change === "missingReference") replaceHeader(reply, "In-Reply-To", null);
    if (change === "mixedReferences")
      replaceHeader(reply, "References", `${otherSentId} <unknown@unrelated.example.test>`);
    if (change === "missingAuto") replaceHeader(reply, "Auto-Submitted", null);
    if (change === "unknownAuto")
      replaceHeader(reply, "Auto-Submitted", "auto-generated; unknown=1");
    if (change === "unknownPrefix") {
      reply.envelope!.subject = "Unrecognized response";
      replaceHeader(reply, "Subject", "Unrecognized response");
    }
    if (change === "recipientHeaderMismatch")
      replaceHeader(reply, "To", "other@brand.example.test");
    if (change === "hiddenRecipient") replaceHeader(reply, "Bcc", "");
    if (change === "duplicateReturnPath")
      reply.headers = Buffer.concat([reply.headers!, Buffer.from("Return-Path: <>\r\n")]);
    if (change === "futureDate") reply.internalDate = new Date("2026-11-10T10:00:00Z");
    if (change === "senderHeaderMismatch")
      replaceHeader(reply, "From", "forged@unrelated.example.test");
    if (change === "unknownReplyTo")
      replaceHeader(reply, "Reply-To", "alias@unrelated.example.test");
    if (change === "report")
      replaceHeader(reply, "Content-Type", "multipart/report; report-type=delivery-status");
    if (change === "mixedMime")
      replaceHeader(reply, "Content-Type", "multipart/mixed; boundary=synthetic");
    if (change === "daemon") {
      reply.envelope!.from = [{ address: "postmaster@other-partner.example.test" }];
      replaceHeader(reply, "From", "postmaster@other-partner.example.test");
      original.envelope!.to = [{ address: "postmaster@other-partner.example.test" }];
      replaceHeader(original, "To", "postmaster@other-partner.example.test");
    }
    expect(await fixture({ INBOX: [reply], Sent: [original] }).run()).toMatchObject({
      status: "found",
      reason: "ambiguous",
    });
  });
  it("non esclude un autoresponder relativo al destinatario controllato", async () => {
    const { original, reply } = otherThread();
    reply.envelope!.from = [{ address: target }];
    replaceHeader(reply, "From", target);
    expect(await fixture({ INBOX: [reply], Sent: [original] }).run()).toMatchObject({
      status: "found",
      reason: "reply",
    });
  });
  it.each(["riferimenti", "alias_reply_to"] as const)(
    "mantiene il blocco se l'automatismo estraneo contiene %s pertinenti",
    async (change) => {
      const { original, reply } = otherThread();
      if (change === "riferimenti") {
        replaceHeader(reply, "In-Reply-To", knownId);
        replaceHeader(reply, "References", knownId);
      } else {
        reply.envelope!.replyTo = [{ address: target }];
        replaceHeader(reply, "Reply-To", target);
      }
      expect(await fixture({ INBOX: [reply], Sent: [original] }).run()).toMatchObject({
        status: "found",
        reason: "reply",
      });
    },
  );
  it("non esclude un automatismo con l'oggetto del thread controllato anche se cita un altro invio", async () => {
    const { original, reply } = otherThread();
    reply.envelope!.subject = `Risposta automatica: ${input.subject}`;
    replaceHeader(reply, "Subject", reply.envelope!.subject!);
    expect(await fixture({ INBOX: [reply], Sent: [original] }).run()).toMatchObject({
      status: "found",
      reason: "ambiguous",
    });
  });
  it("una risposta pertinente in un'altra cartella prevale sull'automatismo estraneo", async () => {
    const { original, reply } = otherThread();
    const f = fixture({
      INBOX: [reply],
      Sent: [original],
      Trash: [message(10, { envelope: { from: [{ address: target }] } })],
    });
    expect(await f.run()).toMatchObject({ status: "found", reason: "reply" });
  });
  it("non esclude l'autoresponder se la cartella Sent cambia ruolo durante il controllo", async () => {
    const { original, reply } = otherThread();
    const f = fixture({ INBOX: [reply], Sent: [original] });
    f.fake.list
      .mockResolvedValueOnce(folders)
      .mockResolvedValueOnce(
        folders.map((entry) =>
          entry.path === "Sent"
            ? folder("Sent")
            : entry.path === "Archive"
              ? folder("Archive", "\\Sent")
              : entry,
        ),
      );
    expect(await f.run()).toEqual({ status: "uncertain", reason: "followup_folders_changed" });
  });
  it("lega la proof anche alle intestazioni dell'originale che prova il thread diverso", async () => {
    const a = otherThread();
    const first = await fixture({ INBOX: [a.reply], Sent: [a.original] }).run();
    const b = otherThread();
    replaceHeader(b.original, "From", `"Altro nome sintetico" <${own}>`);
    const second = await fixture({ INBOX: [b.reply], Sent: [b.original] }).run();
    expect(first.status).toBe("clear");
    expect(second.status).toBe("clear");
    if (first.status === "clear" && second.status === "clear")
      expect(first.proofSha256).not.toBe(second.proofSha256);
  });
  it("blocca una seconda Inbox indicata soltanto dal flag", async () => {
    const f = fixture();
    f.fake.list.mockResolvedValue([...folders, folder("Incoming", "\\Inbox")]);
    expect(await f.run()).toEqual({ status: "uncertain", reason: "followup_folders_invalid" });
  });

  it.each(["missing", "duplicate", "unexpected"] as const)("rifiuta FETCH %s", async (failure) => {
    const f = fixture({ INBOX: [message(1), message(2)] });
    f.fake.fetchAll.mockResolvedValue(
      failure === "missing"
        ? [message(1)]
        : failure === "duplicate"
          ? [message(1), message(1)]
          : [message(1), message(3)],
    );
    expect(await f.run()).toEqual({ status: "uncertain", reason: "followup_fetch_incomplete" });
  });
  it.each(["uidValidity", "uidNext", "exists"] as const)(
    "blocca il cambiamento di %s di una cartella già letta",
    async (field) => {
      const f = fixture();
      f.fake.onLock = (path, count) => {
        if (path === "Archive" && count === 2 && f.fake.mailbox) {
          if (field === "uidValidity") f.fake.mailbox.uidValidity++;
          else f.fake.mailbox[field]++;
        }
      };
      expect(await f.run()).toEqual({ status: "uncertain", reason: "followup_mailbox_changed" });
    },
  );
  it("blocca nuovi arrivi durante FETCH", async () => {
    const f = fixture({ INBOX: [message(1)] });
    f.fake.fetchAll.mockImplementation(async () => {
      if (f.fake.mailbox) f.fake.mailbox.uidNext++;
      return [message(1)];
    });
    expect(await f.run()).toMatchObject({
      status: "uncertain",
      reason: "followup_mailbox_changed",
    });
  });
  it.each(["missingInbox", "doubleInbox", "missingSent", "missingJunk", "sameSpecial"])(
    "blocca una LIST incompleta o ambigua (%s)",
    async (change) => {
      const f = fixture();
      const list = folders.filter(
        (entry) =>
          entry.path !==
          (
            { missingInbox: "INBOX", missingSent: "Sent", missingJunk: "Junk" } as Record<
              string,
              string
            >
          )[change],
      );
      if (change === "doubleInbox") list.push(folder("inbox"));
      if (change === "sameSpecial")
        list[1] = { path: "Sent", flags: new Set(["\\Sent", "\\Junk"]) };
      f.fake.list.mockResolvedValue(list);
      expect((await f.run()).status).toBe("uncertain");
    },
  );
  it("blocca cartelle nuove tra la prima LIST e quella finale", async () => {
    const f = fixture();
    f.fake.list.mockResolvedValueOnce(folders).mockResolvedValueOnce([...folders, folder("New")]);
    expect(await f.run()).toEqual({ status: "uncertain", reason: "followup_folders_changed" });
  });
  it.each(["connect", "search", "fetchAll", "getMailboxLock", "noop"] as const)(
    "fallisce chiuso se %s lancia, senza testo del server",
    async (method) => {
      const f = fixture({ INBOX: [message(1)] });
      f.fake[method].mockRejectedValue(new Error("Dati riservati del server"));
      expect(await f.run()).toEqual({ status: "uncertain", reason: "followup_imap_failed" });
      expect(f.fake.close).toHaveBeenCalled();
    },
  );
  it("non accetta una ricerca vuota su un socket non più usabile", async () => {
    const f = fixture();
    f.fake.noop.mockImplementation(async () => {
      f.fake.usable = false;
    });
    expect(await f.run()).toEqual({ status: "uncertain", reason: "followup_connection_failed" });
  });
  it("un evento di errore chiude il socket e non autorizza il sollecito", async () => {
    const f = fixture();
    f.fake.search.mockImplementation(async () => {
      f.fake.emit("error", new Error("Privato"));
      return [];
    });
    expect(await f.run()).toEqual({ status: "uncertain", reason: "followup_connection_failed" });
    expect(f.fake.close).toHaveBeenCalled();
  });
  it("l'abort interrompe anche una chiamata bloccata e chiude definitivamente il client", async () => {
    const f = fixture();
    f.fake.search.mockImplementation(() => new Promise(() => {}));
    const running = f.run();
    await vi.waitFor(() => expect(f.fake.search).toHaveBeenCalled());
    f.controller.abort();
    expect(await running).toEqual({ status: "uncertain", reason: "followup_aborted" });
    expect(f.fake.usable).toBe(false);
    expect(f.fake.close).toHaveBeenCalled();
  });
  it("non apre una connessione per un controllo già cancellato", async () => {
    const f = fixture();
    f.controller.abort();
    expect(await f.run()).toEqual({ status: "uncertain", reason: "followup_aborted" });
    expect(f.create).not.toHaveBeenCalled();
  });
  it("richiude anche una connessione che termina dopo l'abort", async () => {
    const f = fixture();
    let finish: () => void = () => {};
    f.fake.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            f.fake.usable = true;
            resolve();
          };
        }),
    );
    const running = f.run();
    await vi.waitFor(() => expect(f.fake.connect).toHaveBeenCalled());
    f.controller.abort();
    expect(await running).toMatchObject({ status: "uncertain", reason: "followup_aborted" });
    finish();
    await vi.waitFor(() => expect(f.fake.usable).toBe(false));
    expect(f.fake.list).not.toHaveBeenCalled();
  });
  it("l'abort interrompe un logout bloccato e invalida una prova altrimenti completa", async () => {
    const f = fixture();
    f.fake.logout.mockImplementation(() => new Promise(() => {}));
    const running = f.run();
    await vi.waitFor(() => expect(f.fake.logout).toHaveBeenCalled());
    f.controller.abort();
    expect(await running).toEqual({ status: "uncertain", reason: "followup_aborted" });
    expect(f.fake.usable).toBe(false);
  });
  it.each([false as const, [1, 1], [1, 0], [1, 3]])(
    "rifiuta SEARCH non completo o non valido (%#)",
    async (uids) => {
      const f = fixture({ INBOX: [message(1), message(2)] });
      f.fake.search.mockResolvedValue(uids);
      expect(await f.run()).toEqual({ status: "uncertain", reason: "followup_search_invalid" });
    },
  );
  it.each([
    { headers: undefined },
    { headers: Buffer.from("References: messaggio-senza-identificatore\r\n") },
    { headers: Buffer.from("Header privo di separatore\r\n") },
    { headers: Buffer.from(`X-Large: ${"x".repeat(65_536)}\r\n`) },
    { envelope: undefined },
    { envelope: { from: [{ name: "Solo nome" }], subject: "Altro" } },
  ])(
    "blocca dati incompleti o malformati anche su messaggi non pertinenti (%#)",
    async (change) => {
      const result = await fixture({ INBOX: [message(1, change)] }).run();
      expect(result.status).toBe("uncertain");
      if (result.status === "uncertain") expect(result.reason).toMatch(/^followup_[a-z_]+$/u);
    },
  );
  it("accetta un istante valido con offset senza cambiare il giorno del messaggio", async () => {
    const f = fixture();
    expect(await f.run({ ...input, firstSentAt: "2026-11-01T00:30:00+01:00" })).toMatchObject({
      status: "clear",
    });
  });
  it("un limite di cartelle o messaggi superato lascia il controllo incerto", async () => {
    const f = fixture();
    f.fake.list.mockResolvedValue([
      ...folders,
      ...Array.from({ length: 59 }, (_, i) => folder(`Extra${i}`)),
    ]);
    expect(await f.run()).toMatchObject({ status: "uncertain", reason: "followup_folder_limit" });
    const big = fixture({ INBOX: Array.from({ length: 5001 }, (_, i) => message(i + 1)) });
    expect(await big.run()).toMatchObject({
      status: "uncertain",
      reason: "followup_message_limit",
    });
    expect(big.fake.fetchAll).not.toHaveBeenCalled();
  });
  it.each([
    { ...input, extra: true },
    { ...input, addresses: [] },
    { ...input, addresses: [target, target.toUpperCase()] },
    { ...input, addresses: [own] },
    { ...input, ownAddress: "other@brand.example.test" },
    { ...input, messageIds: ["bad-id"] },
    { ...input, firstSentAt: "2026-02-30T12:00:00Z" },
    { ...input, firstSentAt: "2026-11-10T12:00:00Z" },
    { ...input, subject: "Injected\r\nheader" },
    { ...input, timezone: undefined },
    { ...input, timezone: null },
    { ...input, timezone: 1 },
    { ...input, timezone: "" },
    { ...input, timezone: "Not/A_Timezone" },
    { ...input, timezone: "+01:00" },
    { ...input, timezone: "-10:00" },
    { ...input, timezone: "Europe/Rome\n" },
  ])("rifiuta input non valido prima di collegarsi (%#)", async (value) => {
    const f = fixture();
    expect(await f.run(value as PartnerAssistantFollowupMailboxInput)).toEqual({
      status: "uncertain",
      reason: "followup_invalid_input",
    });
    expect(f.create).not.toHaveBeenCalled();
  });
});

describe("ENVELOPE reale: gruppi, NIL e destinatari nascosti", () => {
  const fieldHeaders = { to: "To", cc: "Cc", bcc: "Bcc", replyTo: "Reply-To" } as const;
  const fields = Object.keys(fieldHeaders) as (keyof typeof fieldHeaders)[];
  const groupMessage = (field: keyof typeof fieldHeaders, members: string[] = [], raw?: string) => {
    const envelope = realEnvelope({
      [field]: [
        rawGroup("Undisclosed recipients"),
        ...members.map((a) => rawAddress(a)),
        rawGroupEnd(),
      ],
    });
    return message(1, {
      envelope,
      headers: Buffer.from(
        `Message-ID: <synthetic@unrelated.example.test>\r\n${fieldHeaders[field]}: ${raw ?? `Undisclosed recipients:${members.join(",")};`}\r\n`,
      ),
    });
  };

  it.each(fields)(
    "accetta il gruppo vuoto %s solo con header sorgente corrispondente",
    async (field) => {
      const value = groupMessage(field);
      expect(value.envelope![field]).toEqual([{ name: "Undisclosed recipients", address: "" }]);
      expect(value.envelope!.subject).toBeUndefined();
      const f = fixture({ INBOX: [value] });
      expect(await f.run()).toMatchObject({ status: "clear", folderCount: 6, messageCount: 1 });
      expect(f.fake.getMailboxLock).toHaveBeenCalledTimes(12);
      expect(f.fake.fetchAll).toHaveBeenCalledWith(
        [1],
        expect.objectContaining({
          headers: expect.arrayContaining(["To", "Cc", "Bcc", "Reply-To"]),
        }),
        { uid: true },
      );
    },
  );

  it.each(fields)(
    "conserva il membro target dentro %s e blocca la conversazione",
    async (field) => {
      const value = groupMessage(field, ["other@unrelated.example.test", target]);
      expect(value.envelope![field]).toEqual([
        { name: "Undisclosed recipients", address: "" },
        { name: "", address: "other@unrelated.example.test" },
        { name: "", address: target },
      ]);
      expect(await fixture({ Archive: [value] }).run()).toMatchObject({
        status: "found",
        reason: "reply",
      });
    },
  );

  it("verifica anche liste miste e più gruppi, mantenendo tutti i membri e l'ordine", async () => {
    const envelope = realEnvelope({
      to: [
        rawAddress(own),
        rawGroup("Group A"),
        rawAddress("a@unrelated.example.test"),
        rawGroupEnd(),
        rawGroup("Group B"),
        rawGroupEnd(),
        rawAddress("b@unrelated.example.test"),
      ],
    });
    const headers = Buffer.from(
      `To: ${own}, Group A: a@unrelated.example.test;, Group B:;, b@unrelated.example.test\r\n`,
    );
    expect(await fixture({ INBOX: [message(1, { envelope, headers })] }).run()).toMatchObject({
      status: "clear",
    });
  });

  it.each([
    "Undisclosed recipients",
    "Undisclosed recipients: member@unrelated.example.test;",
    "Different name:;",
    "Undisclosed recipients:; trailing",
    '"Undisclosed recipients":;',
    "=?UTF-8?Q?Undisclosed_recipients?=:;",
    "Undisclosed recipients (comment):;",
    "Undisclosed recipients: nested:;",
    "Undisclosed recipients: a@unrelated.example.test,;",
    "Undisclosed recipients: invalid@;",
  ])("non converte un header non corrispondente o non supportato in clear %#", async (raw) => {
    expect(await fixture({ INBOX: [groupMessage("to", [], raw)] }).run()).toEqual({
      status: "uncertain",
      reason: "followup_envelope_to_group_unverified",
    });
  });

  it("senza header, con duplicati o con un membro perso il gruppo resta incerto", async () => {
    const absent = groupMessage("to");
    absent.headers = Buffer.from("Content-Type: text/plain\r\n");
    expect(await fixture({ INBOX: [absent] }).run()).toEqual({
      status: "uncertain",
      reason: "followup_envelope_to_group_unverified",
    });
    const duplicate = groupMessage("cc");
    duplicate.headers = Buffer.concat([
      duplicate.headers!,
      Buffer.from("Cc: Undisclosed recipients:;\r\n"),
    ]);
    expect(await fixture({ INBOX: [duplicate] }).run()).toEqual({
      status: "uncertain",
      reason: "followup_envelope_cc_group_unverified",
    });
    const missing = groupMessage("bcc", [], `Undisclosed recipients:${target};`);
    expect(await fixture({ INBOX: [missing] }).run()).toEqual({
      status: "uncertain",
      reason: "followup_envelope_bcc_group_unverified",
    });
  });

  it("un ordine diverso dei membri non viene normalizzato per nascondere una discrepanza", async () => {
    const value = groupMessage(
      "replyTo",
      ["a@unrelated.example.test", "b@unrelated.example.test"],
      "Undisclosed recipients:b@unrelated.example.test,a@unrelated.example.test;",
    );
    expect(await fixture({ INBOX: [value] }).run()).toEqual({
      status: "uncertain",
      reason: "followup_envelope_reply_to_group_unverified",
    });
  });

  it("NIL host e host malformato collassano nello stesso DTO: serve la conferma dall'header", async () => {
    const group = realEnvelope({ to: [rawGroup("Recipient"), rawGroupEnd()] });
    const malformed = realEnvelope({
      to: [[token("Recipient"), null, token("broken"), token("")]],
    });
    expect(group.to).toEqual(malformed.to);
    expect(
      await fixture({
        INBOX: [
          message(1, { envelope: malformed, headers: Buffer.from("To: Recipient <broken@>\r\n") }),
        ],
      }).run(),
    ).toEqual({ status: "uncertain", reason: "followup_envelope_to_group_unverified" });
  });

  it("un membro bare con doppio punto nel localpart non autorizza clear", async () => {
    const value = groupMessage("to", ["a..b@unrelated.example.test"]);
    expect(await fixture({ INBOX: [value] }).run()).toEqual({
      status: "uncertain",
      reason: "followup_envelope_to_group_unverified",
    });
  });

  it("label DNS con trattino iniziale o finale non diventano membri bare verificati", async () => {
    for (const address of ["a@-unrelated.example.test", "a@unrelated-.example.test"]) {
      const value = groupMessage("to", [address]);
      expect(await fixture({ INBOX: [value] }).run()).toEqual({
        status: "uncertain",
        reason: "followup_envelope_to_group_unverified",
      });
    }
  });

  it.each(["from", "sender"] as const)("non permette un gruppo nel campo %s", async (field) => {
    const envelope = realEnvelope({ [field]: [rawGroup("Originator"), rawGroupEnd()] });
    expect(await fixture({ INBOX: [message(1, { envelope })] }).run()).toEqual({
      status: "uncertain",
      reason: `followup_envelope_${field}_invalid`,
    });
  });

  it("richiede sempre un From valido, anche se il subject è NIL", async () => {
    const envelope = realEnvelope({ from: null });
    expect(envelope.from).toBeUndefined();
    expect(envelope.subject).toBeUndefined();
    expect(await fixture({ INBOX: [message(1, { envelope })] }).run()).toEqual({
      status: "uncertain",
      reason: "followup_envelope_from_invalid",
    });
  });

  it.each(["from", "to", "cc", "bcc", "replyTo", "sender"] as const)(
    "segnala la forma invalida di %s senza dati del messaggio",
    async (field) => {
      const envelope = { ...realEnvelope(), [field]: [{ name: "Solo nome" }] };
      const result = await fixture({ INBOX: [message(1, { envelope })] }).run();
      expect(result).toEqual({
        status: "uncertain",
        reason: `followup_envelope_${field === "replyTo" ? "reply_to" : field}_invalid`,
      });
      expect(JSON.stringify(result)).not.toMatch(/@|Solo nome|synthetic/u);
    },
  );

  it.each(
    [
      [{ name: "", address: "" }],
      [{ name: "Group\nInjected", address: "" }],
      [{ name: "Group", address: null }],
      [{ name: "Group", address: "", members: [target] }],
      [{ address: "invalid@" }],
      [{ address: 42 }],
      [],
      null,
      "not-a-list",
    ].map((to) => ({ to })),
  )("forme ambigue o indirizzi malformati restano incerti %#", async ({ to }) => {
    const envelope = { ...realEnvelope(), to } as unknown as FetchMessageObject["envelope"];
    expect(await fixture({ INBOX: [message(1, { envelope })] }).run()).toEqual({
      status: "uncertain",
      reason: "followup_envelope_to_invalid",
    });
  });

  it.each([undefined, null, ""])(
    "subject %j è assente senza bypassare le altre verifiche",
    async (subject) => {
      const envelope = { ...realEnvelope(), subject } as FetchMessageObject["envelope"];
      expect(await fixture({ INBOX: [message(1, { envelope })] }).run()).toMatchObject({
        status: "clear",
      });
      const replied = { ...envelope, from: [{ address: target }] };
      expect(await fixture({ INBOX: [message(1, { envelope: replied })] }).run()).toMatchObject({
        status: "found",
        reason: "reply",
      });
    },
  );
  it.each([42, {}, ["subject"], "A\nInjected"])(
    "subject di forma invalida %j resta incerto",
    async (subject) => {
      const envelope = { ...realEnvelope(), subject } as unknown as FetchMessageObject["envelope"];
      expect(await fixture({ INBOX: [message(1, { envelope })] }).run()).toEqual({
        status: "uncertain",
        reason: "followup_envelope_subject_invalid",
      });
    },
  );

  it("un messaggio manuale a Bcc target viene trovato anche con To estraneo", async () => {
    const envelope = realEnvelope({
      from: [rawAddress(own)],
      to: [rawAddress("other@unrelated.example.test")],
      bcc: [rawAddress(target)],
    });
    expect(await fixture({ Sent: [message(1, { envelope })] }).run()).toMatchObject({
      status: "found",
      reason: "manual",
    });
  });

  it.each(["bcc", "replyTo", "sender"] as const)(
    "non ignora un nostro ID noto con %s alterato",
    async (field) => {
      const envelope = realEnvelope({
        from: [rawAddress(own)],
        to: [rawAddress(target)],
        [field]: [rawAddress("altered@unrelated.example.test")],
      });
      expect(
        await fixture({
          Sent: [message(1, { envelope, headers: Buffer.from(`Message-ID: ${knownId}\r\n`) })],
        }).run(),
      ).toMatchObject({ status: "found", reason: "manual" });
    },
  );

  it("anche Bcc al target o un header Bcc non rappresentato impedisce l'esclusione dell'ID noto", async () => {
    for (const withEnvelope of [true, false]) {
      const envelope = realEnvelope({
        from: [rawAddress(own)],
        to: [rawAddress(target)],
        ...(withEnvelope ? { bcc: [rawAddress(target)] } : {}),
      });
      expect(
        await fixture({
          Sent: [
            message(1, {
              envelope,
              headers: Buffer.from(`Message-ID: ${knownId}\r\nBcc: ${target}\r\n`),
            }),
          ],
        }).run(),
      ).toMatchObject({ status: "found", reason: "manual" });
    }
  });

  it("Sender e Reply-To standard uguali al mittente non impediscono di riconoscere il nostro originale", async () => {
    const envelope = realEnvelope({
      from: [rawAddress(own)],
      to: [rawAddress(target)],
      sender: [rawAddress(own)],
      replyTo: [rawAddress(own)],
    });
    expect(
      await fixture({
        Sent: [
          message(1, {
            envelope,
            headers: Buffer.from(`Message-ID: ${knownId}\r\nReply-To: ${own}\r\n`),
          }),
        ],
      }).run(),
    ).toMatchObject({ status: "clear" });
  });

  it("un Reply-To aggiunto soltanto nelle intestazioni impedisce l'early skip dell'originale", async () => {
    const envelope = realEnvelope({ from: [rawAddress(own)], to: [rawAddress(target)] });
    expect(
      await fixture({
        Sent: [
          message(1, {
            envelope,
            headers: Buffer.from(
              `Message-ID: ${knownId}\r\nReply-To: altered@unrelated.example.test\r\n`,
            ),
          }),
        ],
      }).run(),
    ).toMatchObject({ status: "found", reason: "manual" });
  });

  it("un From con più autori che comprende noi non viene classificato come OOO ricevuto", async () => {
    const value = autoReply();
    value.envelope = { from: [{ address: own }, { address: target }], to: [{ address: own }] };
    expect(await fixture({ INBOX: [value] }).run()).toMatchObject({
      status: "found",
      reason: "manual",
    });
  });

  it("un DSN potenzialmente nostro ricevuto in Bcc resta ambiguo", async () => {
    const envelope = realEnvelope({ bcc: [rawAddress(own)] });
    expect(
      await fixture({
        INBOX: [
          message(1, { envelope, headers: Buffer.from("Content-Type: multipart/report\r\n") }),
        ],
      }).run(),
    ).toMatchObject({ status: "found", reason: "ambiguous" });
  });
});

describe("rinvio per assenza automatica con rientro certo", () => {
  it("rinvia solo dopo aver verificato tutte le cartelle e il messaggio completo in PEEK", async () => {
    const f = fixture({ Archive: [autoReply()] });
    const result = await f.run();
    expect(result).toMatchObject({
      status: "deferred",
      resumeOn: "2026-11-17",
      checkedAt: new Date(NOW).toISOString(),
      folderCount: 6,
      messageCount: 1,
      proofSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(f.fake.fetchOne).toHaveBeenCalledWith(
      1,
      {
        uid: true,
        size: true,
        source: { start: 0, maxLength: 65_537 },
      },
      { uid: true },
    );
    expect(f.fake.list).toHaveBeenCalledTimes(2);
    expect(f.fake.getMailboxLock).toHaveBeenCalledTimes(12);
    expect(f.fake.noop).toHaveBeenCalledOnce();
    expect(f.fake.close).toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/@|office|Archive/u);
  });

  it.each(["2026-11-08", "2026-11-09"])(
    "può ignorare un OOO solo datato già rientrato il %s",
    async (date) => {
      const f = fixture({ INBOX: [autoReply(1, `I am out of the office. I return on ${date}.`)] });
      expect(await f.run()).toMatchObject({ status: "clear", messageCount: 1 });
      expect(f.fake.fetchOne).toHaveBeenCalledOnce();
    },
  );

  it("per il destinatario a Roma il rientro segue il giorno locale, non UTC", async () => {
    const f = fixture(
      { INBOX: [autoReply(1, "I am out of the office. I return on 2026-11-09.")] },
      Date.parse("2026-11-08T23:30:00Z"),
    );
    expect(await f.run()).toMatchObject({ status: "clear" });
  });

  it("non anticipa il rientro a Honolulu quando Roma è già al giorno successivo", async () => {
    const f = fixture({ Archive: [autoReply()] }, Date.parse("2026-11-16T23:30:00Z"));
    expect(await f.run({ ...input, timezone: "Pacific/Honolulu" })).toMatchObject({
      status: "deferred",
      resumeOn: "2026-11-17",
      folderCount: 6,
      messageCount: 1,
    });
    expect(f.fake.list).toHaveBeenCalledTimes(2);
    expect(f.fake.getMailboxLock).toHaveBeenCalledTimes(12);
    expect(f.fake.noop).toHaveBeenCalledOnce();
    expect(f.fake.close).toHaveBeenCalled();
  });

  it("può riprendere solo dal 17 locale a Honolulu, dopo tutta la scansione stabile", async () => {
    const f = fixture({ Archive: [autoReply()] }, Date.parse("2026-11-17T10:00:00Z"));
    expect(await f.run({ ...input, timezone: "Pacific/Honolulu" })).toMatchObject({
      status: "clear",
      folderCount: 6,
      messageCount: 1,
    });
    expect(f.fake.list).toHaveBeenCalledTimes(2);
    expect(f.fake.getMailboxLock).toHaveBeenCalledTimes(12);
    expect(f.fake.noop).toHaveBeenCalledOnce();
  });

  it("il ritorno locale non rende completa una lettura parziale della casella", async () => {
    const f = fixture(
      { Archive: [autoReply()], Trash: [message(7)] },
      Date.parse("2026-11-17T10:00:00Z"),
    );
    f.fake.fetchAll.mockImplementation(async () =>
      f.fake.mailbox && f.fake.mailbox.path !== "Trash"
        ? (f.fake.messages[f.fake.mailbox.path] ?? [])
        : [],
    );
    expect(await f.run({ ...input, timezone: "Pacific/Honolulu" })).toEqual({
      status: "uncertain",
      reason: "followup_fetch_incomplete",
    });
    expect(f.fake.close).toHaveBeenCalled();
  });

  it("una data locale già raggiunta a Auckland non dipende dal giorno di Roma", async () => {
    const f = fixture({ Archive: [autoReply()] }, Date.parse("2026-11-16T11:00:00Z"));
    expect(await f.run({ ...input, timezone: "Pacific/Auckland" })).toMatchObject({
      status: "clear",
      folderCount: 6,
      messageCount: 1,
    });
  });

  it("non invia al server rinvii oltre il budget di 366 giorni", async () => {
    const far = fixture({
      INBOX: [autoReply(1, "I am out of the office. I return on 2027-11-11.")],
    });
    expect(await far.run()).toMatchObject({ status: "found", reason: "ambiguous" });
  });

  it("sceglie il rientro più lontano fra OOO certi, anche in cartelle differenti", async () => {
    const f = fixture({
      Archive: [autoReply(1, "I am out of the office. I return on 2026-11-20.")],
      "Clienti/Partner": [autoReply(2)],
      Trash: [autoReply(3, "I am out of the office. I return on 2026-11-08.")],
    });
    expect(await f.run()).toMatchObject({
      status: "deferred",
      resumeOn: "2026-11-20",
      messageCount: 3,
    });
    expect(f.fake.fetchOne).toHaveBeenCalledTimes(3);
  });

  it.each(["reply", "manual", "ambiguous"] as const)(
    "una risposta %s prevale sempre sul rinvio, anche dopo l'OOO",
    async (reason) => {
      const later =
        reason === "manual"
          ? message(2, {
              envelope: { from: [{ address: own }], to: [{ address: target }], subject: "Altro" },
            })
          : reason === "ambiguous"
            ? message(2, {
                envelope: {
                  from: [{ address: "alias@different.example.test" }],
                  subject: `Re: ${input.subject}`,
                },
              })
            : message(2, { envelope: { from: [{ address: target }], subject: "Risposta reale" } });
      const f = fixture({ Archive: [autoReply()], Trash: [later] });
      expect(await f.run()).toMatchObject({ status: "found", reason });
      expect(f.fake.fetchOne).toHaveBeenCalledOnce();
    },
  );

  it("dopo OOO passato una risposta umana impedisce comunque clear", async () => {
    const f = fixture({
      Archive: [autoReply(1, "I am out of the office. I return on 2026-11-08.")],
      INBOX: [message(2, { envelope: { from: [{ address: target }] } })],
    });
    expect(await f.run()).toMatchObject({ status: "found", reason: "reply" });
  });

  it.each([
    "I am out of the office.",
    "I am out of the office until 2026-11-17.",
    "I am out of the office. I return tomorrow.",
    "I am out of the office. I return on 10/11/2026.",
    "I am out of the office. I return on 2026-11-17. I return on 2026-11-18.",
    "I am out of the office. I return on 2026-11-08. Please unsubscribe me.",
  ])("non ignora assenza ambigua o mescolata ad altro contenuto %#", async (body) => {
    expect(await fixture({ INBOX: [autoReply(1, body)] }).run()).toMatchObject({
      status: "found",
      reason: "ambiguous",
    });
  });

  it("un alias è attribuito da References prima di leggere l'OOO", async () => {
    const value = autoReply();
    value.envelope = {
      from: [{ address: "alias@different.example.test" }],
      to: [{ address: own }],
      subject: "Automatic reply",
    };
    expect(await fixture({ Trash: [value] }).run()).toMatchObject({
      status: "deferred",
      resumeOn: "2026-11-17",
    });
  });

  it.each(["2026-11-17", "2026-11-08"])(
    "un OOO datato %s collegato solo dall'oggetto resta ambiguo",
    async (date) => {
      const value = autoReply(1, `I am out of the office. I return on ${date}.`);
      value.envelope = {
        from: [{ address: "estraneo@different.example.test" }],
        to: [{ address: own }],
        subject: `Re: ${input.subject}`,
      };
      value.headers = Buffer.from(
        value.headers!.toString("utf8").replace(`In-Reply-To: ${knownId}\r\n`, ""),
      );
      value.source = Buffer.from(
        value.source!.toString("utf8").replace(`In-Reply-To: ${knownId}\r\n`, ""),
      );
      value.size = value.source.byteLength;
      const f = fixture({ INBOX: [value] });
      expect(await f.run()).toMatchObject({ status: "found", reason: "ambiguous" });
      expect(f.fake.fetchOne).not.toHaveBeenCalled();
    },
  );

  it("il solo oggetto automatico o un header assente non bastano", async () => {
    const value = autoReply();
    value.headers = Buffer.from(
      `Message-ID: <ooo-1@partner.example.test>\r\nIn-Reply-To: ${knownId}\r\n`,
    );
    const f = fixture({ INBOX: [value] });
    expect(await f.run()).toMatchObject({ status: "found", reason: "reply" });
    expect(f.fake.fetchOne).not.toHaveBeenCalled();
  });

  it("Auto-Submitted nel risultato FETCH non sostituisce quello della fonte completa", async () => {
    const value = autoReply();
    value.source = Buffer.from(
      value
        .source!.toString("utf8")
        .replace("Auto-Submitted: auto-replied", "X-Untrusted: auto-replied"),
    );
    value.size = value.source.byteLength;
    expect(await fixture({ INBOX: [value] }).run()).toMatchObject({
      status: "found",
      reason: "ambiguous",
    });
  });

  it.each(["missing", "short", "changedSize", "oversized"])(
    "fonte %s non autorizza rinvio o ripresa",
    async (kind) => {
      const value = autoReply();
      const f = fixture({ INBOX: [value] });
      const full = { ...value };
      if (kind === "missing") full.source = undefined;
      if (kind === "short") full.source = full.source!.subarray(0, full.source!.byteLength - 1);
      if (kind === "changedSize") full.size = full.size! + 1;
      if (kind === "oversized") {
        full.source = Buffer.alloc(65_537);
        full.size = 65_537;
        value.size = 65_537;
      }
      f.fake.fetchOne.mockResolvedValue(full);
      expect(await f.run()).toMatchObject({ status: "found", reason: "ambiguous" });
    },
  );

  it.each([false as const, { ...autoReply(), uid: 99 }])(
    "FETCH full assente o UID sbagliato resta incerto %#",
    async (full) => {
      const f = fixture({ INBOX: [autoReply()] });
      f.fake.fetchOne.mockResolvedValue(full);
      expect(await f.run()).toEqual({ status: "uncertain", reason: "followup_fetch_incomplete" });
    },
  );

  it("una fonte UTF-8 danneggiata o un multipart non decodificato resta ambiguo", async () => {
    for (const kind of ["utf8", "multipart"]) {
      const value = autoReply();
      value.source =
        kind === "utf8"
          ? Buffer.concat([value.source!, Buffer.from([0xc3, 0x28])])
          : Buffer.from(
              value
                .source!.toString("utf8")
                .replace(
                  "text/plain; charset=utf-8",
                  'multipart/alternative; boundary="synthetic"',
                ),
            );
      value.size = value.source.byteLength;
      expect(await fixture({ INBOX: [value] }).run()).toMatchObject({
        status: "found",
        reason: "ambiguous",
      });
    }
  });

  it("una scansione incompleta dopo OOO non viene trasformata in deferred", async () => {
    const f = fixture({ Archive: [autoReply()], INBOX: [message(2)] });
    f.fake.fetchAll
      .mockResolvedValueOnce([autoReply()])
      .mockRejectedValueOnce(new Error("Riservato"));
    expect(await f.run()).toEqual({ status: "uncertain", reason: "followup_imap_failed" });
  });

  it("cambiamenti di UIDNEXT o delle cartelle dopo OOO invalidano anche il rinvio", async () => {
    const changed = fixture({ Archive: [autoReply()] });
    changed.fake.onLock = (path, count) => {
      if (path === "Archive" && count === 2 && changed.fake.mailbox) changed.fake.mailbox.uidNext++;
    };
    expect(await changed.run()).toEqual({
      status: "uncertain",
      reason: "followup_mailbox_changed",
    });
    const lost = fixture({ Archive: [autoReply()] });
    lost.fake.list
      .mockResolvedValueOnce(folders)
      .mockResolvedValueOnce(folders.filter((f) => f.path !== "Trash"));
    expect(await lost.run()).toEqual({ status: "uncertain", reason: "followup_folders_changed" });
  });

  it("l'abort durante il FETCH completo chiude il socket e impedisce clear/deferred", async () => {
    const f = fixture({ INBOX: [autoReply()] });
    f.fake.fetchOne.mockImplementation(() => new Promise<false | FetchMessageObject>(() => {}));
    const pending = f.run();
    await vi.waitFor(() => expect(f.fake.fetchOne).toHaveBeenCalled());
    f.controller.abort();
    expect(await pending).toEqual({ status: "uncertain", reason: "followup_aborted" });
    expect(f.fake.close).toHaveBeenCalled();
    expect(f.fake.usable).toBe(false);
  });
});
