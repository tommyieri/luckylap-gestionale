import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { ImapFlow, ImapFlowOptions } from "imapflow";
import type { PartnerAssistantMailConfig } from "./mail-config";
import {
  classifyPartnerAssistantImapError,
  openPartnerAssistantMailbox,
  type PartnerAssistantFolders,
  type PartnerAssistantMailbox,
} from "./imap";

// Solo dati sintetici; nessuna connessione vera: ImapFlow è finta.
const cfg: PartnerAssistantMailConfig = {
  user: "casella@luckylap.example.test",
  password: "synthetic-password",
  fromName: "Tommaso | LuckyLap",
  smtpHost: "smtp.ionos.it",
  imapHost: "imap.ionos.it",
  testTo: [],
  domain: "luckylap.example.test",
};
const addr = "info@club-951.example.test";
const since = new Date(Date.parse("2026-10-29T08:40:00Z") - 365 * 86_400_000);
const folders: PartnerAssistantFolders = { inbox: "INBOX", sent: "Posta inviata", junk: "Spam" };
const messageId = "<70000000-0000-4000-8000-000000000990@luckylap.example.test>";
const raw = "From: synthetic\r\n\r\nsynthetic body\r\n";
const sentAt = new Date("2026-10-29T08:41:00Z");

// Le voci hanno le forme che imapflow 2.4.2 può produrre. specialUseSource "extension": il
// flag è anche in `flags` (esm/special-use.js:884-891). "name": imapflow ha riconosciuto il
// nome e la cartella non ha flag di uso speciale, salvo con un server senza SPECIAL-USE o con
// i flag solo in LSUB. INBOX ha sempre \Inbox dal nome; un uso speciale va a una sola cartella.
type Entry = { path: string; specialUse?: string; specialUseSource?: string; flags?: Set<string> };
const byFlag = (path: string, use: string, ...flags: string[]): Entry => ({
  path,
  specialUse: use,
  specialUseSource: "extension",
  flags: new Set([use, ...flags]),
});
const byName = (path: string, use: string, ...flags: string[]): Entry => ({
  path,
  specialUse: use,
  specialUseSource: "name",
  flags: new Set(flags),
});
const inbox = byName("INBOX", "\\Inbox", "\\HasNoChildren");
// La LIST vera della casella IONOS: `list()` senza opzioni, imapflow 2.4.2 (30 ottobre).
const standardList: Entry[] = [
  inbox,
  byFlag("Posta inviata", "\\Sent", "\\HasNoChildren"),
  byFlag("Bozze", "\\Drafts", "\\HasNoChildren"),
  byFlag("Spam", "\\Junk", "\\HasNoChildren"),
  byFlag("Cestino", "\\Trash", "\\HasNoChildren"),
];
type SearchStep = number[] | false | undefined | "throw";
type Script = {
  create?: "throw";
  connect?: Record<string, unknown>;
  /** "not-array": `list()` risolve undefined. */
  list?: Entry[] | "throw" | "not-array";
  /** Lo stato di `client.mailbox` subito dopo il lock: il percorso di un'altra cartella o false. */
  lockMailbox?: string | false;
  lockThrows?: boolean;
  /** Un risultato per ogni chiamata, nell'ordine; dopo l'ultimo `[]`. */
  search?: SearchStep[];
  /** Lo stato della connessione subito dopo ogni search. */
  afterSearch?: { mailbox?: string | false; usable?: boolean };
  /** "unusable": il NOOP risolve ma la connessione non è più usabile (2.4.2 ingoia l'errore). */
  noop?: "throw" | "unusable";
  append?: unknown;
  appendThrows?: boolean;
  logout?: "throw";
  close?: "throw";
};
const imapError = (fields: Record<string, unknown>) =>
  Object.assign(new Error("synthetic imap error"), fields);

class FakeImap extends EventEmitter {
  calls: string[] = [];
  usable = false;
  mailbox: false | { path: string; readOnly: boolean } = false;
  private searchCount = 0;
  constructor(
    readonly options: ImapFlowOptions,
    readonly script: Script,
  ) {
    super();
  }
  override on(event: string | symbol, listener: (...args: unknown[]) => void) {
    this.calls.push(`on:${String(event)}`);
    return super.on(event, listener);
  }
  connect = vi.fn(async () => {
    this.calls.push("connect");
    if (this.script.connect) throw imapError(this.script.connect);
    this.usable = true;
  });
  list = vi.fn(async (options?: { listOnly?: boolean }) => {
    this.calls.push("list");
    if (this.script.list === "throw") throw imapError({ code: "ECONNRESET" });
    if (this.script.list === "not-array") return undefined;
    return (this.script.list ?? standardList).map((entry) => {
      const listed: Entry = { ...entry };
      // Come imapflow 2.4.2: con `listOnly` le cartelle tornano prima di assegnare specialUse.
      if (options?.listOnly === true) {
        delete listed.specialUse;
        delete listed.specialUseSource;
      }
      return {
        ...listed,
        name: entry.path,
        delimiter: "/",
        flags: entry.flags ?? new Set<string>(),
        listed: true,
        subscribed: true,
      };
    });
  });
  getMailboxLock = vi.fn(async (path: string, options?: { readOnly?: boolean }) => {
    this.calls.push(`lock:${path}:${options?.readOnly === true ? "examine" : "select"}`);
    if (this.script.lockThrows) throw imapError({ code: "NoConnection" });
    this.mailbox = { path, readOnly: options?.readOnly === true };
    if (this.script.lockMailbox !== undefined)
      this.mailbox =
        this.script.lockMailbox === false
          ? false
          : { path: this.script.lockMailbox, readOnly: true };
    return { path, release: vi.fn(() => void this.calls.push(`release:${path}`)) };
  });
  search = vi.fn(async (_query: unknown, _options?: unknown) => {
    this.calls.push(`search:${this.mailbox ? this.mailbox.path : "-"}`);
    const steps = this.script.search ?? [];
    const step = this.searchCount < steps.length ? steps[this.searchCount] : [];
    this.searchCount += 1;
    const after = this.script.afterSearch;
    if (after?.mailbox !== undefined)
      this.mailbox = after.mailbox === false ? false : { path: after.mailbox, readOnly: true };
    if (after?.usable !== undefined) this.usable = after.usable;
    if (step === "throw") throw imapError({ code: "ETIMEOUT" });
    return step;
  });
  noop = vi.fn(async () => {
    this.calls.push("noop");
    if (this.script.noop === "throw") throw imapError({ code: "NoConnection" });
    if (this.script.noop === "unusable") this.usable = false;
  });
  append = vi.fn(async (_path: string, _raw: string, _flags?: string[], _date?: Date) => {
    this.calls.push("append");
    if (this.script.appendThrows) throw imapError({ code: "EConnectionClosed" });
    return "append" in this.script
      ? this.script.append
      : { destination: "Posta inviata", uid: 7, uidValidity: BigInt(1) };
  });
  logout = vi.fn(async () => {
    this.calls.push("logout");
    if (this.script.logout === "throw") throw imapError({ code: "NoConnection" });
    this.usable = false;
  });
  close = vi.fn(() => {
    this.calls.push("close");
    if (this.script.close === "throw") throw imapError({ code: "NoConnection" });
    this.usable = false;
  });
}

let client: FakeImap;
let clients: FakeImap[] = [];
const factory = (script: Script = {}) =>
  vi.fn((options: ImapFlowOptions) => {
    if (script.create === "throw") throw imapError({ code: "ERR_INVALID_ARG_TYPE" });
    client = new FakeImap(options, script);
    clients.push(client);
    return client as unknown as ImapFlow;
  });
const failing = (fields: Record<string, unknown>) => factory({ connect: fields });
const open = async (script: Script = {}): Promise<PartnerAssistantMailbox> => {
  const result = await openPartnerAssistantMailbox(cfg, factory(script));
  if (!result.ok) throw new Error("apertura fallita nel test");
  return result.mailbox;
};
const mbWithout = (flag: "\\Sent" | "\\Junk") =>
  open({ list: standardList.filter((entry) => entry.specialUse !== flag) });
const mbSearching = (step: SearchStep, script: Script = {}) => open({ search: [step], ...script });
const searches = () => client.calls.filter((call) => call.startsWith("search:"));

const consoleMethods = ["log", "info", "warn", "error", "debug", "trace"] as const;
let consoleSpy: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
beforeEach(() => {
  clients = [];
  consoleSpy = vi.fn<(...args: unknown[]) => void>();
  for (const method of consoleMethods) vi.spyOn(console, method).mockImplementation(consoleSpy);
});
afterEach(() => vi.restoreAllMocks());

describe("errori IMAP", () => {
  it.each([
    "ETHROTTLE",
    "CONNECT_TIMEOUT",
    "GREETING_TIMEOUT",
    "UPGRADE_TIMEOUT",
    "ETIMEOUT",
    "NoConnection",
    "EConnectionClosed",
    "ClosedAfterConnectText",
    "ClosedAfterConnectTLS",
    "ECONNREFUSED",
    "ENOTFOUND",
    "ECONNRESET",
  ])("%s: attesa", (code) =>
    expect(classifyPartnerAssistantImapError(imapError({ code }))).toEqual({
      kind: "attesa",
      code: `imap_${code.toLowerCase()}`,
    }),
  );

  it("TLS fallito: attesa, con il codice di Node", () => {
    expect(
      classifyPartnerAssistantImapError(
        imapError({ code: "ERR_TLS_CERT_ALTNAME_INVALID", tlsFailed: true }),
      ),
    ).toEqual({ kind: "attesa", code: "imap_err_tls_cert_altname_invalid" });
    expect(classifyPartnerAssistantImapError(imapError({ tlsFailed: true }))).toEqual({
      kind: "attesa",
      code: "imap_sconosciuto",
    });
  });

  it("credenziali: prima di tutto, senza testo del server", () => {
    expect(
      classifyPartnerAssistantImapError(
        imapError({
          authenticationFailed: true,
          serverResponseCode: "AUTHENTICATIONFAILED",
          response: "NO [AUTHENTICATIONFAILED] casella@luckylap.example.test",
          code: "ETHROTTLE",
        }),
      ),
    ).toEqual({ kind: "credenziali", code: "imap_autenticazione" });
  });

  it("authenticationFailed diverso da true non vale come credenziali", () => {
    expect(
      classifyPartnerAssistantImapError(imapError({ authenticationFailed: "true", code: "X" })),
    ).toEqual({ kind: "fallito", code: "imap_x" });
  });

  it.each([
    [{ code: "LockTimeout" }, "imap_locktimeout"],
    [{ code: "ParserError11" }, "imap_parsererror11"],
    [{ code: "ETIMEDOUT" }, "imap_etimedout"],
    [{ serverResponseCode: "UNAVAILABLE", response: "NO [UNAVAILABLE] busy" }, "imap_unavailable"],
    [
      { code: "MissingServerExtension", serverResponseCode: "TRYCREATE" },
      "imap_missingserverextension",
    ],
    [{ code: "", serverResponseCode: "NONEXISTENT" }, "imap_nonexistent"],
    [{ code: "a-b.c d" }, "imap_a_b_c_d"],
    [{ response: "NO casella@luckylap.example.test" }, "imap_sconosciuto"],
    [{ code: 42 }, "imap_sconosciuto"],
  ])("il resto: fallito (%o)", (fields, code) =>
    expect(classifyPartnerAssistantImapError(imapError(fields))).toEqual({
      kind: "fallito",
      code,
    }),
  );

  it("errori che non sono oggetti", () => {
    for (const error of [null, undefined, "ECONNRESET", 42])
      expect(classifyPartnerAssistantImapError(error)).toEqual({
        kind: "fallito",
        code: "imap_sconosciuto",
      });
  });

  it("codici sempre nella forma ammessa, mai il testo del server", () => {
    const errors = [
      imapError({ code: "X".repeat(200) }),
      imapError({ serverResponseCode: "Ü[X]" }),
      imapError({ response: "NO [ALERT] info@club-951.example.test", code: "NoConnection" }),
      imapError({ authenticationFailed: true, response: "NO synthetic-password" }),
    ];
    for (const error of errors) {
      const { code } = classifyPartnerAssistantImapError(error);
      expect(code).toMatch(/^[a-z][a-z0-9_]{0,79}$/);
      expect(code).not.toMatch(/example|password|club|casella|no_/);
    }
  });
});

describe("apertura della casella", () => {
  it("opzioni, logger false e listener d'errore prima di connect", async () => {
    const create = factory();
    const result = await openPartnerAssistantMailbox(cfg, create);
    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(client.options).toEqual({
      host: "imap.ionos.it",
      port: 993,
      secure: true,
      servername: "imap.ionos.it",
      tls: { minVersion: "TLSv1.2" },
      auth: { user: "casella@luckylap.example.test", pass: "synthetic-password" },
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: 20_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });
    expect(client.calls).toEqual(["on:error", "connect"]);
    expect(client.listenerCount("error")).toBe(1);
  });

  it("host della configurazione e un client nuovo a ogni apertura", async () => {
    const create = factory();
    const other = { ...cfg, imapHost: "imap.luckylap.example.test" };
    await openPartnerAssistantMailbox(other, create);
    await openPartnerAssistantMailbox(other, create);
    expect(create).toHaveBeenCalledTimes(2);
    expect(clients).toHaveLength(2);
    expect(clients[0]).not.toBe(clients[1]);
    expect(clients[1].options).toMatchObject({
      host: "imap.luckylap.example.test",
      servername: "imap.luckylap.example.test",
      port: 993,
    });
  });

  it("un errore di socket dopo l'apertura non lancia e non scrive", async () => {
    await open();
    expect(() => client.emit("error", imapError({ code: "ECONNRESET" }))).not.toThrow();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("credenziali rifiutate: credenziali, senza testo", async () =>
    expect(
      await openPartnerAssistantMailbox(
        cfg,
        failing({ authenticationFailed: true, response: "NO casella@luckylap.example.test" }),
      ),
    ).toEqual({ ok: false, error: { kind: "credenziali", code: "imap_autenticazione" } }));

  it("ETHROTTLE e ECONNRESET: attesa", async () => {
    expect(await openPartnerAssistantMailbox(cfg, failing({ code: "ETHROTTLE" }))).toEqual({
      ok: false,
      error: { kind: "attesa", code: "imap_ethrottle" },
    });
    expect(await openPartnerAssistantMailbox(cfg, failing({ code: "ECONNRESET" }))).toEqual({
      ok: false,
      error: { kind: "attesa", code: "imap_econnreset" },
    });
  });

  it("connessione fallita: il client si chiude, anche se close lancia", async () => {
    await openPartnerAssistantMailbox(cfg, failing({ code: "CONNECT_TIMEOUT" }));
    expect(client.calls).toEqual(["on:error", "connect", "close"]);
    const result = await openPartnerAssistantMailbox(
      cfg,
      factory({ connect: { code: "GREETING_TIMEOUT" }, close: "throw" }),
    );
    expect(result).toEqual({ ok: false, error: { kind: "attesa", code: "imap_greeting_timeout" } });
  });

  it("creazione del client fallita: fallito, senza eccezione", async () =>
    expect(await openPartnerAssistantMailbox(cfg, factory({ create: "throw" }))).toEqual({
      ok: false,
      error: { kind: "fallito", code: "imap_err_invalid_arg_type" },
    }));
});

describe("cartelle", () => {
  it("LIST vera di IONOS: cartelle dai flag del server", async () => {
    const mb = await open();
    expect(await mb.folders()).toEqual({ inbox: "INBOX", sent: "Posta inviata", junk: "Spam" });
    // Con i flag del server IONOS funzionerebbe anche con `listOnly`; `list()` senza opzioni
    // serve al ripiego per nome.
    expect(client.list).toHaveBeenCalledWith();
  });

  it("solo i flag \\Sent e \\Junk del server nella LIST, nessuno specialUse \\Sent o \\Junk: cartelle dai flag", async () => {
    // Server senza SPECIAL-USE, con nomi che imapflow non riconosce.
    const mb = await open({
      list: [
        inbox,
        { path: "Spedite", flags: new Set(["\\Sent", "\\HasNoChildren"]) },
        byName("Bozze", "\\Drafts", "\\HasNoChildren"),
        { path: "Sospette", flags: new Set(["\\Junk", "\\HasNoChildren"]) },
        byName("Cestino", "\\Trash", "\\HasNoChildren"),
      ],
    });
    expect(await mb.folders()).toEqual({ inbox: "INBOX", sent: "Spedite", junk: "Sospette" });
  });

  it("il flag del server vince sul nome riconosciuto da imapflow", async () => {
    // Server senza SPECIAL-USE: imapflow dà \Sent a «Inviati», prima in ordine alfabetico.
    const mb = await open({
      list: [
        inbox,
        byName("Inviati", "\\Sent"),
        { path: "Posta inviata", flags: new Set(["\\Sent"]) },
        byName("Spam", "\\Junk"),
      ],
    });
    expect(await mb.folders()).toEqual({ inbox: "INBOX", sent: "Posta inviata", junk: "Spam" });
  });

  it("due cartelle con il flag \\Sent, una anche con specialUse: sent null, nessuna ricerca", async () => {
    const mb = await open({
      list: [
        inbox,
        byFlag("Posta inviata", "\\Sent"),
        { path: "Vecchia posta inviata", flags: new Set(["\\Sent"]) },
        byFlag("Spam", "\\Junk"),
      ],
    });
    const f = await mb.folders();
    expect(f).toEqual({ inbox: "INBOX", sent: null, junk: "Spam" });
    expect(await mb.correspondence(f!, addr, since)).toBeNull();
    expect(client.search).not.toHaveBeenCalled();
    expect(client.getMailboxLock).not.toHaveBeenCalled();
  });

  it("due cartelle con il flag \\Junk: junk null", async () => {
    const mb = await open({
      list: [
        inbox,
        byFlag("Posta inviata", "\\Sent"),
        byFlag("Posta indesiderata", "\\Junk"),
        { path: "Spam", flags: new Set(["\\Junk"]) },
      ],
    });
    expect(await mb.folders()).toEqual({ inbox: "INBOX", sent: "Posta inviata", junk: null });
  });

  it("flag con maiuscole diverse: \\SENT e \\junk valgono", async () => {
    // Server senza SPECIAL-USE, con nomi che imapflow non riconosce.
    const mb = await open({
      list: [
        inbox,
        { path: "Spedite", flags: new Set(["\\SENT"]) },
        { path: "Sospette", flags: new Set(["\\junk"]) },
      ],
    });
    expect(await mb.folders()).toEqual({ inbox: "INBOX", sent: "Spedite", junk: "Sospette" });
  });

  it.each(["\\Noselect", "\\NOSELECT"])(
    "una cartella %s con \\Sent non conta: sent dall'altra",
    async (noselect) => {
      // imapflow dà \Sent ad «Archivio», prima in ordine alfabetico.
      const mb = await open({
        list: [
          inbox,
          byFlag("Archivio", "\\Sent", noselect),
          { path: "Posta inviata", flags: new Set(["\\Sent"]) },
          byFlag("Spam", "\\Junk"),
        ],
      });
      expect(await mb.folders()).toEqual({ inbox: "INBOX", sent: "Posta inviata", junk: "Spam" });
    },
  );

  it.each(["\\Noselect", "\\NOSELECT"])(
    "solo una cartella %s con \\Sent e specialUse \\Sent: sent null",
    async (noselect) => {
      const mb = await open({
        list: [inbox, byFlag("Posta inviata", "\\Sent", noselect), byFlag("Spam", "\\Junk")],
      });
      expect(await mb.folders()).toEqual({ inbox: "INBOX", sent: null, junk: "Spam" });
    },
  );

  it.each(["\\NonExistent", "\\nonexistent"])(
    "solo una cartella %s con \\Sent e specialUse \\Sent: sent null",
    async (nonexistent) => {
      // imapflow aggiunge \Noselect solo a \NonExistent scritto così.
      const flags = nonexistent === "\\NonExistent" ? [nonexistent, "\\Noselect"] : [nonexistent];
      const mb = await open({
        list: [inbox, byFlag("Posta inviata", "\\Sent", ...flags), byFlag("Spam", "\\Junk")],
      });
      expect(await mb.folders()).toEqual({ inbox: "INBOX", sent: null, junk: "Spam" });
    },
  );

  it("solo «Sent» \\Noselect riconosciuta dal nome: sent null", async () => {
    const mb = await open({
      list: [
        inbox,
        byName("Sent", "\\Sent", "\\Noselect", "\\HasChildren"),
        byFlag("Spam", "\\Junk"),
      ],
    });
    expect(await mb.folders()).toEqual({ inbox: "INBOX", sent: null, junk: "Spam" });
  });

  it("flag \\Sent solo su una cartella \\Noselect: sent null, nessun ripiego per nome", async () => {
    // Server senza SPECIAL-USE: imapflow riconosce le cartelle dal nome.
    const mb = await open({
      list: [
        inbox,
        byName("Archivio", "\\Archive", "\\Noselect", "\\Sent"),
        byName("Inviati", "\\Sent"),
        byName("Spam", "\\Junk"),
      ],
    });
    expect(await mb.folders()).toEqual({ inbox: "INBOX", sent: null, junk: "Spam" });
  });

  it("specialUse \\Sent dal nome su una cartella con il flag \\Junk: sent null", async () => {
    // Server senza SPECIAL-USE: imapflow riconosce «Inviati» dal nome.
    const mb = await open({ list: [inbox, byName("Inviati", "\\Sent", "\\Junk")] });
    expect(await mb.folders()).toEqual({ inbox: "INBOX", sent: null, junk: "Inviati" });
  });

  it.each([
    "\\All",
    "\\Archive",
    "\\Drafts",
    "\\Flagged",
    "\\Trash",
    "\\Important",
    "\\DRAFTS",
    "\\important",
  ])("specialUse \\Sent dal nome su una cartella con il flag %s: sent null", async (use) => {
    // imapflow 2.4.2 non conosce \Important e lo lascia accanto al \Sent dal nome anche con
    // SPECIAL-USE; gli altri flag restano così su un server senza SPECIAL-USE o dalla LSUB.
    const mb = await open({
      list: [inbox, byName("Inviati", "\\Sent", use), byFlag("Spam", "\\Junk")],
    });
    expect(await mb.folders()).toEqual({ inbox: "INBOX", sent: null, junk: "Spam" });
  });

  it("flag \\Sent solo su una cartella \\nonexistent: sent null, nessun ripiego per nome", async () => {
    // Server senza SPECIAL-USE: imapflow dà \Sent a «Inviati», prima in ordine alfabetico, e
    // aggiunge \Noselect solo a \NonExistent scritto così.
    const mb = await open({
      list: [
        inbox,
        byName("Inviati", "\\Sent"),
        { path: "Posta inviata", flags: new Set(["\\Sent", "\\nonexistent"]) },
        byFlag("Spam", "\\Junk"),
      ],
    });
    expect(await mb.folders()).toEqual({ inbox: "INBOX", sent: null, junk: "Spam" });
  });

  it("una cartella con \\Sent e \\Junk: sent e junk null", async () => {
    // imapflow le dà il primo uso nel suo ordine, \Junk.
    const mb = await open({ list: [inbox, byFlag("Posta", "\\Junk", "\\Sent")] });
    expect(await mb.folders()).toEqual({ inbox: "INBOX", sent: null, junk: null });
  });

  it("senza flag del server vale lo specialUse di imapflow, non il nome della cartella", async () => {
    // imapflow dà \Sent a «Gesendet» e \Junk a «Junk-E-Mail», primi in ordine alfabetico.
    const mb = await open({
      list: [
        inbox,
        byName("Gesendet", "\\Sent"),
        byName("Junk-E-Mail", "\\Junk"),
        { path: "Sent" },
        { path: "Spam" },
      ],
    });
    expect(await mb.folders()).toEqual({
      inbox: "INBOX",
      sent: "Gesendet",
      junk: "Junk-E-Mail",
    });
  });

  it("senza \\Sent: sent null", async () => {
    const mb = await mbWithout("\\Sent");
    expect(await mb.folders()).toEqual({ inbox: "INBOX", sent: null, junk: "Spam" });
  });

  it("LIST fallita: null", async () => {
    const mb = await open({ list: "throw" });
    expect(await mb.folders()).toBeNull();
  });

  it("LIST che non è un array: null", async () => {
    const mb = await open({ list: "not-array" });
    expect(await mb.folders()).toBeNull();
  });

  it("senza \\Junk: junk null e correspondence null, senza search", async () => {
    // Fuoco 5
    const mb = await mbWithout("\\Junk");
    const f = await mb.folders();
    expect(f?.junk).toBeNull();
    expect(await mb.correspondence(f!, addr, since)).toBeNull();
    expect(client.search).not.toHaveBeenCalled();
    expect(client.getMailboxLock).not.toHaveBeenCalled();
  });

  it("senza \\Sent: correspondence null, senza search", async () => {
    const mb = await open();
    expect(await mb.correspondence({ ...folders, sent: null }, addr, since)).toBeNull();
    expect(client.search).not.toHaveBeenCalled();
  });
});

describe("controllo dei 12 mesi", () => {
  it("EXAMINE in sola lettura nelle tre cartelle, release sempre", async () => {
    const mb = await open();
    expect(await mb.correspondence(folders, addr, since)).toBe(false);
    expect(client.calls.slice(2)).toEqual([
      "lock:INBOX:examine",
      "search:INBOX",
      "release:INBOX",
      "lock:Posta inviata:examine",
      "search:Posta inviata",
      "release:Posta inviata",
      "lock:Spam:examine",
      "search:Spam",
      "release:Spam",
      "noop",
    ]);
    for (const path of ["INBOX", "Posta inviata", "Spam"])
      expect(client.getMailboxLock).toHaveBeenCalledWith(path, { readOnly: true });
  });

  it("release anche quando la search lancia", async () => {
    const mb = await open({ search: [[], "throw"] });
    expect(await mb.correspondence(folders, addr, since)).toBeNull();
    expect(client.calls.slice(2)).toEqual([
      "lock:INBOX:examine",
      "search:INBOX",
      "release:INBOX",
      "lock:Posta inviata:examine",
      "search:Posta inviata",
      "release:Posta inviata",
    ]);
  });

  it("lock fallito: null, senza search", async () => {
    const mb = await open({ lockThrows: true });
    expect(await mb.correspondence(folders, addr, since)).toBeNull();
    expect(client.search).not.toHaveBeenCalled();
  });

  it("cartella aperta diversa da quella chiesta dopo il lock: null, senza search", async () => {
    for (const lockMailbox of [false, "Archivio"] as const) {
      const mb = await open({ lockMailbox });
      expect(await mb.correspondence(folders, addr, since)).toBeNull();
      expect(client.search).not.toHaveBeenCalled();
      expect(client.calls).toContain("release:INBOX");
    }
  });

  it("ricerca da, a, in copia, da 365 giorni", async () => {
    const mb = await open();
    await mb.correspondence(folders, "info@club-951.example.test", since);
    expect(client.search).toHaveBeenCalledTimes(3);
    for (const call of client.search.mock.calls)
      expect(call).toEqual([
        {
          since,
          or: [
            { from: "info@club-951.example.test" },
            { to: "info@club-951.example.test" },
            { cc: "info@club-951.example.test" },
          ],
        },
        { uid: true },
      ]);
    expect(client.search).toHaveBeenCalledWith(
      {
        since,
        or: [
          { from: "info@club-951.example.test" },
          { to: "info@club-951.example.test" },
          { cc: "info@club-951.example.test" },
        ],
      },
      { uid: true },
    );
  });

  it("trovato in spam: true", async () => {
    const mb = await open({ search: [[], [], [42]] });
    expect(await mb.correspondence(folders, addr, since)).toBe(true);
    expect(searches()).toEqual(["search:INBOX", "search:Posta inviata", "search:Spam"]);
  });

  it("trovato in posta in arrivo: true, senza cercare oltre", async () => {
    const mb = await open({ search: [[3, 9]] });
    expect(await mb.correspondence(folders, addr, since)).toBe(true);
    expect(searches()).toEqual(["search:INBOX"]);
    expect(client.calls).toContain("release:INBOX");
    expect(client.noop).not.toHaveBeenCalled();
  });

  it("nessuna cartella con UID: false", async () => {
    const mb = await open({ search: [[], [], []] });
    expect(await mb.correspondence(folders, addr, since)).toBe(false);
  });

  it("tre [] con mailbox giusta, usable e noop riuscito: false", async () => {
    const mb = await open();
    expect(await mb.correspondence(folders, addr, since)).toBe(false);
    expect(client.noop).toHaveBeenCalledTimes(1);
    expect(client.calls.at(-1)).toBe("noop");
  });

  it.each([false, undefined, "throw"] as const)("search %s: null", async (r) => {
    // Fuoco 5
    expect(await (await mbSearching(r)).correspondence(folders, addr, since)).toBeNull();
    expect(searches()).toEqual(["search:INBOX"]);
    expect(client.calls).toContain("release:INBOX");
  });

  it.each([false, undefined, "throw"] as const)(
    "search %s in spam dopo due []: null, mai false",
    async (r) => {
      const mb = await open({ search: [[], [], r] });
      expect(await mb.correspondence(folders, addr, since)).toBeNull();
    },
  );

  it("search [] con la connessione non più usabile: null", async () =>
    // Fuoco 5
    expect(
      await (
        await mbSearching([], { afterSearch: { usable: false } })
      ).correspondence(folders, addr, since),
    ).toBeNull());

  it("search [] con la connessione non più usabile: nessun noop", async () => {
    const mb = await mbSearching([], { afterSearch: { usable: false } });
    await mb.correspondence(folders, addr, since);
    expect(client.noop).not.toHaveBeenCalled();
  });

  it("search [] e noop che lancia: null", async () =>
    // Fuoco 5
    expect(
      await (await mbSearching([], { noop: "throw" })).correspondence(folders, addr, since),
    ).toBeNull());

  it("search [] e noop che lascia la connessione non usabile: null", async () =>
    expect(
      await (await mbSearching([], { noop: "unusable" })).correspondence(folders, addr, since),
    ).toBeNull());

  it("search [] con client.mailbox falso o di un'altra cartella: null", async () => {
    // Fuoco 5
    for (const mailbox of [false, "Archivio"] as const) {
      const mb = await mbSearching([], { afterSearch: { mailbox } });
      expect(await mb.correspondence(folders, addr, since)).toBeNull();
      expect(searches()).toEqual(["search:INBOX"]);
      expect(client.noop).not.toHaveBeenCalled();
    }
  });

  it("UID trovati nonostante una mailbox cambiata: true resta il lato prudente", async () => {
    const mb = await open({ search: [[5]], afterSearch: { mailbox: false } });
    expect(await mb.correspondence(folders, addr, since)).toBe(true);
  });
});

describe("Message-ID in una cartella", () => {
  it("ricerca per intestazione in sola lettura: gli UID", async () => {
    const mb = await open({ search: [[7]] });
    expect(await mb.findMessageId("Posta inviata", messageId)).toEqual([7]);
    expect(client.getMailboxLock).toHaveBeenCalledWith("Posta inviata", { readOnly: true });
    expect(client.search).toHaveBeenCalledWith(
      { header: { "message-id": messageId } },
      { uid: true },
    );
    expect(client.calls.slice(2)).toEqual([
      "lock:Posta inviata:examine",
      "search:Posta inviata",
      "release:Posta inviata",
    ]);
  });

  it("[] con mailbox giusta, usable e noop riuscito: []", async () => {
    const mb = await open();
    expect(await mb.findMessageId("Posta inviata", messageId)).toEqual([]);
    expect(client.calls.at(-1)).toBe("noop");
  });

  it("findMessageId [] con usable falso: null", async () => {
    const mb = await mbSearching([], { afterSearch: { usable: false } });
    expect(await mb.findMessageId("Posta inviata", messageId)).toBeNull();
  });

  it("findMessageId [] con noop che lancia o lascia la connessione non usabile: null", async () => {
    for (const noop of ["throw", "unusable"] as const) {
      const mb = await mbSearching([], { noop });
      expect(await mb.findMessageId("Posta inviata", messageId)).toBeNull();
    }
  });

  it("findMessageId [] con client.mailbox falso o di un'altra cartella: null", async () => {
    for (const mailbox of [false, "INBOX"] as const) {
      const mb = await mbSearching([], { afterSearch: { mailbox } });
      expect(await mb.findMessageId("Posta inviata", messageId)).toBeNull();
    }
  });

  it("findMessageId false: null", async () => {
    const mb = await mbSearching(false);
    expect(await mb.findMessageId("Posta inviata", messageId)).toBeNull();
  });

  it("findMessageId undefined, eccezione o lock fallito: null, release sempre", async () => {
    for (const step of [undefined, "throw"] as const) {
      const mb = await mbSearching(step);
      expect(await mb.findMessageId("Posta inviata", messageId)).toBeNull();
      expect(client.calls).toContain("release:Posta inviata");
    }
    const mb = await open({ lockThrows: true });
    expect(await mb.findMessageId("Posta inviata", messageId)).toBeNull();
  });
});

describe("copia in «Posta inviata» e chiusura", () => {
  it("append con \\Seen e la data; false: false", async () => {
    const mb = await open();
    expect(await mb.append("Posta inviata", raw, sentAt)).toBe(true);
    expect(client.append).toHaveBeenCalledWith("Posta inviata", raw, ["\\Seen"], sentAt);
    expect(await (await open({ append: false })).append("Posta inviata", raw, sentAt)).toBe(false);
  });

  it("append che lancia o senza risposta: false", async () => {
    expect(await (await open({ appendThrows: true })).append("Posta inviata", raw, sentAt)).toBe(
      false,
    );
    expect(await (await open({ append: undefined })).append("Posta inviata", raw, sentAt)).toBe(
      false,
    );
  });

  it("logout riuscito: niente close", async () => {
    const mb = await open();
    await mb.close();
    expect(client.calls.slice(2)).toEqual(["logout"]);
  });

  it("logout fallito: close, nessuna eccezione", async () => {
    const mb = await open({ logout: "throw" });
    await expect(mb.close()).resolves.toBeUndefined();
    expect(client.calls.slice(2)).toEqual(["logout", "close"]);
  });

  it("logout e close falliti: nessuna eccezione", async () => {
    const mb = await open({ logout: "throw", close: "throw" });
    await expect(mb.close()).resolves.toBeUndefined();
  });
});

describe("nessun log", () => {
  it("nessun console.* durante le chiamate", async () => {
    await openPartnerAssistantMailbox(cfg, failing({ authenticationFailed: true }));
    await openPartnerAssistantMailbox(cfg, failing({ code: "ECONNRESET" }));
    const mb = await open({ search: [[], "throw"], logout: "throw" });
    client.emit("error", imapError({ code: "ECONNRESET" }));
    await mb.folders();
    await mb.correspondence(folders, addr, since);
    await mb.findMessageId("Posta inviata", messageId);
    await mb.append("Posta inviata", raw, sentAt);
    await mb.close();
    const broken = await open({ list: "throw", appendThrows: true, noop: "throw" });
    await broken.folders();
    await broken.correspondence(folders, addr, since);
    await broken.findMessageId("Posta inviata", messageId);
    await broken.append("Posta inviata", raw, sentAt);
    await broken.close();
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
