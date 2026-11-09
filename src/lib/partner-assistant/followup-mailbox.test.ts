import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { FetchMessageObject, ImapFlow, ImapFlowOptions } from "imapflow";
import {
  checkPartnerAssistantFollowupMailbox,
  type PartnerAssistantFollowupMailboxInput,
} from "./followup-mailbox";
import type { PartnerAssistantMailConfig } from "./mail-config";

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
  noop = vi.fn(async () => {});
  logout = vi.fn(async () => {
    this.usable = false;
  });
  close = vi.fn(() => {
    this.usable = false;
  });
}
function fixture(messages: Record<string, FetchMessageObject[]> = {}) {
  const fake = new FakeImap(messages);
  const create = vi.fn((_options: ImapFlowOptions) => fake as unknown as ImapFlow);
  const controller = new AbortController();
  const run = (value = input) =>
    checkPartnerAssistantFollowupMailbox(mail, value, controller.signal, {
      createImapFlow: create,
      now: () => NOW,
    });
  return { fake, create, controller, run };
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
    expect(await f.run()).toMatchObject({ status: "found", reason: "reply" });
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
  ])("rifiuta input non valido prima di collegarsi (%#)", async (value) => {
    const f = fixture();
    expect(await f.run(value)).toEqual({ status: "uncertain", reason: "followup_invalid_input" });
    expect(f.create).not.toHaveBeenCalled();
  });
});
