import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type SMTPConnection from "nodemailer/lib/smtp-connection";
import type { SMTPConnectionOptions } from "nodemailer/lib/smtp-connection";
import type { PartnerAssistantMailConfig } from "./mail-config";
import {
  classifyPartnerAssistantSmtpError,
  createPartnerAssistantSmtp,
  type PartnerAssistantSmtpPhase,
} from "./smtp";

// Solo dati sintetici; nessuna connessione vera: SMTPConnection è finta.
const mail: PartnerAssistantMailConfig = {
  user: "casella@luckylap.example.test",
  password: "synthetic-password",
  fromName: "Tommaso | LuckyLap",
  smtpHost: "smtp.ionos.it",
  imapHost: "imap.ionos.it",
  testTo: [],
  domain: "luckylap.example.test",
};
const sent = { accepted: ["info@club-951.example.test"], rejected: [], response: "250 2.0.0 ok" };
type Failure = { error: Record<string, unknown>; as: "callback" | "event" | "both" };
type Script = {
  connect?: Failure | "hang";
  allowsAuth?: boolean;
  login?: Failure | "hang";
  send?: Failure | "hang" | { info: Record<string, unknown> } | "event_then_success";
};
const smtpError = (fields: Record<string, unknown>) =>
  Object.assign(new Error("synthetic smtp error"), fields);

class FakeConnection extends EventEmitter {
  calls: string[] = [];
  allowsAuth: boolean;
  pending: Array<() => void> = [];
  constructor(
    readonly options: SMTPConnectionOptions,
    readonly script: Script,
  ) {
    super();
    this.allowsAuth = script.allowsAuth ?? true;
  }
  override on(event: string | symbol, listener: (...args: unknown[]) => void) {
    this.calls.push(`on:${String(event)}`);
    return super.on(event, listener);
  }
  private fail(step: Failure, callback: (error: Error) => void) {
    const error = smtpError(step.error);
    if (step.as === "event" || step.as === "both") this.emit("error", error);
    if (step.as === "callback" || step.as === "both") callback(error);
  }
  connect = vi.fn((callback: (error?: Error) => void) => {
    this.calls.push("connect");
    const step = this.script.connect;
    if (step === "hang") return void this.pending.push(() => callback());
    setImmediate(() => (step ? this.fail(step, callback) : callback()));
  });
  login = vi.fn((_auth: unknown, callback: (error: Error | null, ok?: boolean) => void) => {
    this.calls.push("login");
    const step = this.script.login;
    if (step === "hang") return void this.pending.push(() => callback(null, true));
    setImmediate(() => (step ? this.fail(step, callback) : callback(null, true)));
  });
  send = vi.fn(
    (_envelope: unknown, _raw: string, callback: (error: Error | null, info?: unknown) => void) => {
      this.calls.push("send");
      const step = this.script.send;
      if (step === "hang") return void this.pending.push(() => callback(null, sent));
      setImmediate(() => {
        if (!step) return callback(null, sent);
        if (step === "event_then_success") {
          this.emit("error", smtpError({ code: "ECONNECTION", command: "CONN" }));
          return callback(null, sent);
        }
        if ("info" in step) return callback(null, step.info);
        this.fail(step, callback);
      });
    },
  );
  quit = vi.fn(() => void this.calls.push("quit"));
  close = vi.fn(() => void this.calls.push("close"));
}

let conn: FakeConnection;
let factory: ReturnType<typeof vi.fn<(options: SMTPConnectionOptions) => SMTPConnection>>;
const setup = (script: Script = {}) => {
  factory = vi.fn((options: SMTPConnectionOptions) => {
    conn = new FakeConnection(options, script);
    return conn as unknown as SMTPConnection;
  });
  return createPartnerAssistantSmtp(mail, factory);
};
const input = {
  raw: "From: synthetic\r\n\r\nsynthetic body\r\n",
  from: "casella@luckylap.example.test",
  to: "info@club-951.example.test",
  signal: new AbortController().signal,
};
const classify = (error: Record<string, unknown>, phase: PartnerAssistantSmtpPhase) =>
  classifyPartnerAssistantSmtpError(smtpError(error), phase);
const e450 = {
  code: "EENVELOPE",
  responseCode: 450,
  command: "RCPT TO",
  response: "450 Mail send limit exceeded.",
};
const e550 = {
  code: "EENVELOPE",
  responseCode: 550,
  command: "RCPT TO",
  response: "550 5.1.1 user unknown",
};
const e554spam = {
  code: "EMESSAGE",
  responseCode: 554,
  command: "DATA",
  response: "554 5.7.1 rejected as spam",
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const consoleMethods = ["log", "info", "warn", "error", "debug", "trace"] as const;
let consoleSpy: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
beforeEach(() => {
  consoleSpy = vi.fn<(...args: unknown[]) => void>();
  for (const method of consoleMethods) vi.spyOn(console, method).mockImplementation(consoleSpy);
});
afterEach(() => vi.restoreAllMocks());

describe("esiti SMTP per fase", () => {
  it.each([
    ["connect", { code: "ECONNECTION", command: "CONN" }, "non_partito"],
    [
      "connect",
      { code: "ETIMEDOUT", timeoutType: "SOCKET_TIMEOUT", command: "CONN" },
      "non_partito",
    ],
    [
      "connect",
      { code: "ETIMEDOUT", timeoutType: "GREETING_TIMEOUT", command: "CONN" },
      "non_partito",
    ],
    ["connect", { code: "EDNS", command: "CONN" }, "non_partito"],
    ["connect", { code: "ETLS", command: "STARTTLS" }, "non_partito"],
    [
      "connect",
      { code: "ECONNECTION", responseCode: 421, command: "CONN", response: "421 busy" },
      "temporaneo",
    ],
    [
      "connect",
      {
        code: "EPROTOCOL",
        responseCode: 554,
        command: "CONN",
        response: "554 5.7.1 blocked as spam",
      },
      "bloccato",
    ],
    [
      "connect",
      { code: "EPROTOCOL", responseCode: 554, command: "CONN", response: "554 no service" },
      "non_partito",
    ],
    ["login", { code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" }, "credenziali"],
    ["login", { code: "ENOAUTH", command: "API" }, "credenziali"],
    ["login", { code: "ECONNECTION", command: "CONN" }, "non_partito"],
    [
      "login",
      { code: "EPROTOCOL", responseCode: 554, command: "CONN", response: "554 5.7.1 spam source" },
      "bloccato",
    ],
    ["send", { code: "ECONNECTION", command: "CONN" }, "incerto"],
    ["send", { code: "ETIMEDOUT", timeoutType: "SOCKET_TIMEOUT", command: "CONN" }, "incerto"],
    ["send", { code: "ESOCKET", command: "CONN" }, "incerto"],
    ["send", { code: "ECONNECTION", command: "DATA" }, "incerto"],
    ["send", e450, "temporaneo"],
    [
      "send",
      { code: "ECONNECTION", responseCode: 421, command: "CONN", response: "421 closing" },
      "temporaneo",
    ],
    ["send", e550, "respinto"],
    ["send", e554spam, "respinto"],
    [
      "send",
      {
        code: "EENVELOPE",
        responseCode: 550,
        command: "MAIL FROM",
        response: "550 5.7.1 sender blocked",
      },
      "bloccato",
    ],
    [
      "send",
      {
        code: "EENVELOPE",
        responseCode: 552,
        command: "MAIL FROM",
        response: "552 5.3.4 too big",
      },
      "non_partito",
    ],
  ] as const)("%s %o → %s", (phase, err, kind) => expect(classify(err, phase).kind).toBe(kind)); // Fuoco 4
  it("un 4xx durante l'accesso è temporaneo, non credenziali", () =>
    expect(
      classify(
        {
          code: "EAUTH",
          responseCode: 454,
          command: "AUTH PLAIN",
          response: "454 4.7.0 try later",
        },
        "login",
      ),
    ).toEqual({ kind: "temporaneo", code: "smtp_454", responseCode: 454 }));
  it("450 limite: smtp_limite", () =>
    expect(classify(e450, "send")).toMatchObject({ code: "smtp_limite" }));
  it("5.1.1 e spam", () => {
    expect(classify(e550, "send")).toMatchObject({ enhanced: "5.1.1", spam: false });
    expect(classify(e554spam, "send")).toMatchObject({ enhanced: "5.7.1", spam: true });
  });
  it("esiti completi", () => {
    expect(classify(e550, "send")).toEqual({
      kind: "respinto",
      code: "smtp_550",
      responseCode: 550,
      enhanced: "5.1.1",
      spam: false,
    });
    expect(classify({ code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" }, "login")).toEqual({
      kind: "credenziali",
      code: "smtp_535",
    });
    expect(
      classify(
        { code: "EPROTOCOL", responseCode: 554, command: "CONN", response: "554 5.7.1 x" },
        "connect",
      ),
    ).toEqual({ kind: "bloccato", code: "smtp_554", responseCode: 554, enhanced: "5.7.1" });
    expect(
      classify(
        { code: "EPROTOCOL", responseCode: 554, command: "CONN", response: "554 no service" },
        "connect",
      ),
    ).toEqual({ kind: "non_partito", code: "smtp_554" });
    expect(classify({ code: "ECONNECTION", command: "CONN" }, "send")).toEqual({
      kind: "incerto",
      code: "smtp_econnection",
    });
    expect(classify({ code: "ETIMEDOUT", command: "CONN" }, "connect")).toEqual({
      kind: "non_partito",
      code: "smtp_etimedout",
    });
    expect(classify({ responseCode: 421, response: "421 4.7.0 busy" }, "send")).toEqual({
      kind: "temporaneo",
      code: "smtp_421",
      responseCode: 421,
    });
  });
  it("il codice esteso dai rifiuti dei destinatari", () =>
    expect(
      classify(
        {
          code: "EENVELOPE",
          responseCode: 550,
          command: "RCPT TO",
          response: "550 rejected",
          rejectedErrors: [{ response: "550 5.1.2 bad domain, spam trap" }],
        },
        "send",
      ),
    ).toMatchObject({ kind: "respinto", enhanced: "5.1.2", spam: true }));
  it("nessun testo del server nei codici", () => {
    expect(JSON.stringify(classify(e550, "send"))).not.toContain("user unknown");
    for (const error of [
      { code: "Strano codice!", command: "CONN" },
      { command: "CONN" },
      {},
      { code: "ETIMEDOUT", responseCode: 999, response: "999 strano" },
    ])
      for (const phase of ["connect", "login", "send"] as const)
        expect(JSON.stringify(classify(error, phase))).toMatch(/"code":"smtp_[a-z0-9_]{1,75}"/);
  });
  it("errori che non sono Error", () => {
    expect(classifyPartnerAssistantSmtpError(undefined, "connect")).toEqual({
      kind: "non_partito",
      code: "smtp_sconosciuto",
    });
    expect(classifyPartnerAssistantSmtpError("x", "send")).toEqual({
      kind: "incerto",
      code: "smtp_sconosciuto",
    });
  });
});

describe("invio SMTP per fasi", () => {
  it("opzioni della connessione e le fasi in ordine", async () => {
    const smtp = setup();
    await smtp.send(input);
    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith({
      host: "smtp.ionos.it",
      port: 587,
      secure: false,
      requireTLS: true,
      tls: { servername: "smtp.ionos.it", minVersion: "TLSv1.2" },
      name: "luckylap.example.test",
      connectionTimeout: 20_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
      dnsTimeout: 10_000,
      logger: false,
      debug: false,
    });
    expect(conn.calls).toEqual(["on:error", "connect", "login", "send", "quit", "close"]);
    expect(conn.login).toHaveBeenCalledWith(
      { user: "casella@luckylap.example.test", pass: "synthetic-password" },
      expect.any(Function),
    );
    expect(conn.send).toHaveBeenCalledWith(
      { from: "casella@luckylap.example.test", to: ["info@club-951.example.test"] },
      input.raw,
      expect.any(Function),
    );
  });
  it("inviato: accepted con il destinatario e 250; login ok", async () =>
    expect(await setup().send(input)).toEqual({
      outcome: { kind: "inviato", responseCode: 250 },
      login: "ok",
    }));
  it("destinatario non valido: non_partito senza connessione", async () => {
    expect(await setup().send({ ...input, to: "info;x@club.example.test" })).toEqual({
      outcome: { kind: "non_partito", code: "smtp_destinatario_non_valido" },
      login: null,
    });
    expect(factory).not.toHaveBeenCalled();
  }); // Fuoco 2
  it("destinatario con maiuscole: si manda all'indirizzo minuscolo", async () => {
    const smtp = setup();
    await smtp.send({ ...input, to: " Info@Club-951.Example.Test " });
    expect(conn.send).toHaveBeenCalledWith(
      { from: "casella@luckylap.example.test", to: ["info@club-951.example.test"] },
      input.raw,
      expect.any(Function),
    );
  }); // Fuoco 2
  it("server senza AUTH dopo STARTTLS: non_partito, nessun login né send", async () => {
    expect(await setup({ allowsAuth: false }).send(input)).toEqual({
      outcome: { kind: "non_partito", code: "smtp_auth_assente" },
      login: "smtp_auth_assente",
    });
    expect(conn.login).not.toHaveBeenCalled();
    expect(conn.send).not.toHaveBeenCalled();
    expect(conn.calls).toEqual(["on:error", "connect", "quit", "close"]);
  });
  it("connect fallito con ECONNECTION/CONN: non_partito, login = smtp_econnection", async () => {
    const result = await setup({
      connect: { error: { code: "ECONNECTION", command: "CONN" }, as: "event" },
    }).send(input);
    expect(result).toEqual({
      outcome: { kind: "non_partito", code: "smtp_econnection" },
      login: "smtp_econnection",
    });
    expect(conn.login).not.toHaveBeenCalled();
    expect(conn.send).not.toHaveBeenCalled();
    expect(conn.close).toHaveBeenCalled();
  });
  it("connect fallito come callback: non_partito", async () =>
    expect(
      await setup({
        connect: { error: { code: "ECONNECTION", command: "CONN" }, as: "callback" },
      }).send(input),
    ).toEqual({
      outcome: { kind: "non_partito", code: "smtp_econnection" },
      login: "smtp_econnection",
    }));
  it("credenziali rifiutate: login = smtp_535, niente send", async () => {
    expect(
      await setup({
        login: {
          error: { code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" },
          as: "callback",
        },
      }).send(input),
    ).toEqual({ outcome: { kind: "credenziali", code: "smtp_535" }, login: "smtp_535" });
    expect(conn.send).not.toHaveBeenCalled();
  });
  it("connessione caduta durante login: non_partito", async () =>
    expect(
      await setup({ login: { error: { code: "ECONNECTION", command: "CONN" }, as: "both" } }).send(
        input,
      ),
    ).toEqual({
      outcome: { kind: "non_partito", code: "smtp_econnection" },
      login: "smtp_econnection",
    }));
  it.each(["event", "callback", "both"] as const)(
    "connessione caduta durante send, come %s: un solo esito, incerto",
    async (as) => {
      const result = await setup({
        send: { error: { code: "ECONNECTION", command: "CONN" }, as },
      }).send(input);
      expect(result).toEqual({
        outcome: { kind: "incerto", code: "smtp_econnection" },
        login: "ok",
      });
      expect(conn.close).toHaveBeenCalled();
    },
  ); // Fuoco 4
  it("errore come evento e poi 250 alla callback: vale il primo, incerto", async () => {
    expect(await setup({ send: "event_then_success" }).send(input)).toEqual({
      outcome: { kind: "incerto", code: "smtp_econnection" },
      login: "ok",
    });
    expect(conn.quit).not.toHaveBeenCalled();
  }); // Fuoco 4
  it("rifiuto del destinatario alla callback: respinto", async () =>
    expect(await setup({ send: { error: e550, as: "callback" } }).send(input)).toEqual({
      outcome: {
        kind: "respinto",
        code: "smtp_550",
        responseCode: 550,
        enhanced: "5.1.1",
        spam: false,
      },
      login: "ok",
    }));
  it("rifiuto in info.rejected: respinto", async () =>
    expect(
      await setup({
        send: {
          info: {
            accepted: [],
            rejected: ["info@club-951.example.test"],
            rejectedErrors: [smtpError(e550)],
            response: "250 ok",
          },
        },
      }).send(input),
    ).toMatchObject({ outcome: { kind: "respinto", enhanced: "5.1.1" }, login: "ok" }));
  it("accettato senza 250: incerto", async () =>
    expect(
      await setup({ send: { info: { ...sent, response: "251 forwarded" } } }).send(input),
    ).toEqual({
      outcome: { kind: "incerto", code: "smtp_risposta_incerta" },
      login: "ok",
    }));
  it.each([
    { ...sent, accepted: [] },
    { ...sent, accepted: ["altro@club-951.example.test"] },
    { ...sent, accepted: ["info@club-951.example.test", "altro@club-951.example.test"] },
    { ...sent, response: undefined },
    {},
  ])("risposta senza il destinatario o senza 250 (%o): incerto", async (info) =>
    expect((await setup({ send: { info } }).send(input)).outcome).toEqual({
      kind: "incerto",
      code: "smtp_risposta_incerta",
    }),
  );
  it("signal interrotto in send: close e incerto smtp_scadenza", async () => {
    const controller = new AbortController();
    const smtp = setup({ send: "hang" });
    const result = smtp.send({ ...input, signal: controller.signal });
    await vi.waitFor(() => expect(conn.send).toHaveBeenCalled());
    controller.abort();
    expect(await result).toEqual({
      outcome: { kind: "incerto", code: "smtp_scadenza" },
      login: "ok",
    });
    expect(conn.close).toHaveBeenCalled();
    expect(conn.quit).not.toHaveBeenCalled();
    conn.pending.forEach((late) => late());
    await flush();
    expect(conn.calls.filter((c) => c === "send")).toHaveLength(1);
  }); // Fuoco 4
  it("signal interrotto in connect: non_partito smtp_scadenza, nessun login dopo", async () => {
    const controller = new AbortController();
    const smtp = setup({ connect: "hang" });
    const result = smtp.send({ ...input, signal: controller.signal });
    await vi.waitFor(() => expect(conn.connect).toHaveBeenCalled());
    controller.abort();
    expect(await result).toEqual({
      outcome: { kind: "non_partito", code: "smtp_scadenza" },
      login: "smtp_scadenza",
    });
    expect(conn.close).toHaveBeenCalled();
    conn.pending.forEach((late) => late());
    await flush();
    expect(conn.login).not.toHaveBeenCalled();
    expect(conn.send).not.toHaveBeenCalled();
  });
  it("signal interrotto in login: non_partito smtp_scadenza, nessun send dopo", async () => {
    const controller = new AbortController();
    const smtp = setup({ login: "hang" });
    const result = smtp.send({ ...input, signal: controller.signal });
    await vi.waitFor(() => expect(conn.login).toHaveBeenCalled());
    controller.abort();
    expect(await result).toEqual({
      outcome: { kind: "non_partito", code: "smtp_scadenza" },
      login: "smtp_scadenza",
    });
    conn.pending.forEach((late) => late());
    await flush();
    expect(conn.send).not.toHaveBeenCalled();
  });
  it("signal già interrotto: nessuna connessione", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await setup().send({ ...input, signal: controller.signal })).toEqual({
      outcome: { kind: "non_partito", code: "smtp_scadenza" },
      login: null,
    });
    expect(factory).not.toHaveBeenCalled();
  });
  it("una connessione per ogni invio", async () => {
    const smtp = setup();
    await smtp.send(input);
    await smtp.send(input);
    expect(factory).toHaveBeenCalledTimes(2);
  });
  it("nessun log e nessuna password negli esiti", async () => {
    const results = [
      await setup().send(input),
      await setup({
        login: { error: { code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" }, as: "both" },
      }).send(input),
      await setup({ send: { error: e554spam, as: "both" } }).send(input),
    ];
    expect(JSON.stringify(results)).not.toMatch(/synthetic|casella@|club-951|rejected as/);
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
