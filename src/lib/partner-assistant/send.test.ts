import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { partnerAssistantConfig } from "./config";
import type { PartnerAssistantFolders, PartnerAssistantMailboxOpening } from "./imap";
import { PARTNER_ASSISTANT_OPT_OUT_LINES } from "./mail-compose";
import type { PartnerAssistantMailConfig } from "./mail-config";
import {
  PARTNER_ASSISTANT_MAILBOX_DAYS,
  PARTNER_ASSISTANT_SEND_BUDGET_MS,
  PARTNER_ASSISTANT_SEND_LEASE_SECONDS,
  PARTNER_ASSISTANT_SEND_RECORD_MS,
  PARTNER_ASSISTANT_SMTP_MARGIN_MS,
  PARTNER_ASSISTANT_SMTP_MIN_MS,
  runPartnerAssistantSendStep,
} from "./send";
import type { PartnerAssistantSendStore } from "./send-store";
import type {
  PartnerAssistantFinishInput,
  PartnerAssistantPendingAppend,
  PartnerAssistantPrepareInput,
  PartnerAssistantReleaseInput,
  PartnerAssistantSendCandidate,
} from "./send-types";
import type { PartnerAssistantSmtpResult } from "./smtp";
import type { loadPartnerAssistantTestLookbook } from "./test-lookbook";
import {
  PARTNER_ASSISTANT_TEST_LOOKBOOKS,
  PARTNER_ASSISTANT_TEST_MIME_MAX_BYTES,
} from "./test-lookbook-metadata";
import type { StoreResult } from "./types";

// Solo dati sintetici: domini example.test, CO da 951, UUID inventati. Store, SMTP e casella sono
// finti e registrano le chiamate in un solo elenco: nessuna rete, nessun database.
const config = partnerAssistantConfig({
  PARTNER_ASSISTANT_ENABLED: "true",
  PARTNER_ASSISTANT_SECRET: "synthetic-partner-assistant-secret-0000",
  ANTHROPIC_API_KEY: "sk-ant-synthetic-0000000000000000",
  PARTNER_ASSISTANT_SUPABASE_SECRET_KEY: "sb_secret_synthetic-partner-assistant",
  PARTNER_ASSISTANT_PHONE: "+39 000 000 0000",
  NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_synthetic-server-only",
})!;
const mail: PartnerAssistantMailConfig = {
  user: "casella@luckylap.example.test",
  password: "synthetic-password",
  fromName: "Tommaso | LuckyLap",
  smtpHost: "smtp.ionos.it",
  imapHost: "imap.ionos.it",
  testTo: ["prova1@example.test", "prova2@example.test"],
  domain: "luckylap.example.test",
};
const id = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = Date.parse("2026-10-29T08:40:00Z");
const DAY_MS = 86_400_000;
const lease = id(2);
const address = "info@club-951.example.test";
const folders: PartnerAssistantFolders = { inbox: "INBOX", sent: "Posta inviata", junk: "Spam" };

const candidate: PartnerAssistantSendCandidate = {
  jobId: id(10),
  partnerId: id(951),
  co: 951,
  name: "Club Sintetico",
  mode: "invio",
  draft: {
    draftId: id(8),
    language: "it",
    subject: "Club Sintetico e LuckyLap",
    body: "Gentile segreteria,\ncorpo sintetico della bozza.\nUn cordiale saluto,",
    signature: "Tommaso\nLuckyLap\n+39 000 000 0000",
    sha256: "c".repeat(64),
    rulesVersion: 2,
    createdAt: "2026-10-28T09:00:00Z",
  },
  choice: { contactKind: "club", request: "merch_cobranding", eventStartsOn: "" },
  register: "voi",
  address,
  testRunId: null,
  testIndex: null,
  // I casi precedenti verificano altri confini; quelli sulla scadenza usano orari vicini.
  sendNotAfter: "2099-12-31T23:59:59Z",
};
const withBody = (
  body: string,
  draft: Partial<PartnerAssistantSendCandidate["draft"]> = {},
): PartnerAssistantSendCandidate => ({
  ...candidate,
  draft: { ...candidate.draft, body, ...draft },
});
const testCandidate = (testIndex: number): PartnerAssistantSendCandidate => ({
  ...withBody("Gentile segreteria,\nci vediamo il 25 ottobre.\nUn saluto,", {
    createdAt: "2026-10-20T09:00:00Z",
  }),
  mode: "prova",
  testRunId: id(20),
  testIndex,
});
const pending = (n: number): PartnerAssistantPendingAppend => ({
  messageRowId: id(100 + n),
  messageId: `<${id(200 + n)}@luckylap.example.test>`,
  raw: `Message-ID: <${id(200 + n)}@luckylap.example.test>\r\n\r\ncorpo\r\n`,
  sentAt: "2026-10-28T08:41:00Z",
});
const smtpOk: PartnerAssistantSmtpResult = {
  outcome: { kind: "inviato", responseCode: 250 },
  login: "ok",
};
const failed =
  (outcome: PartnerAssistantSmtpResult["outcome"], login: string | null = "ok") =>
  async (): Promise<PartnerAssistantSmtpResult> => ({ outcome, login });
const econnreset: PartnerAssistantMailboxOpening = {
  ok: false,
  error: { kind: "attesa", code: "imap_econnreset" },
};
const credentials: PartnerAssistantMailboxOpening = {
  ok: false,
  error: { kind: "credenziali", code: "imap_autenticazione" },
};

type SmtpInput = {
  raw: string;
  from: string;
  to: string;
  signal: AbortSignal;
  beforeSend?: () => Promise<boolean>;
};
type Options = {
  candidate?: PartnerAssistantSendCandidate | null;
  appends?: PartnerAssistantPendingAppend[];
  claim?: StoreResult<unknown>;
  open?: PartnerAssistantMailboxOpening | "ok";
  folders?: PartnerAssistantFolders | null;
  correspondence?: boolean | null;
  find?: (messageId: string) => number[] | null;
  append?: boolean;
  prepare?: StoreResult<unknown>;
  start?: StoreResult<unknown> | (() => Promise<StoreResult<unknown>>);
  finish?: StoreResult<unknown>;
  smtp?: (input: SmtpInput) => Promise<PartnerAssistantSmtpResult>;
  skipBeforeSend?: boolean;
  now?: number | (() => number);
  loadTestLookbook?: typeof loadPartnerAssistantTestLookbook;
  /** Il clock del budget dopo una chiamata, per simulare il tempo che passa. */
  clockAfter?: Partial<Record<"claim" | "correspondence" | "start", number>>;
  /** Una chiamata alla casella che non risponde: il clock arriva a fine budget e la promessa resta
   * aperta, finché il timer del budget non interrompe il giro. */
  hang?: "open" | "folders" | "correspondence" | "findMessageId";
};

let calls: string[];
let clockNow: number;
let state: ReturnType<typeof setup>;
const done = { ok: true as const, value: { status: "done" as const } };

function setup(options: Options) {
  const recorded = {
    prepare: [] as PartnerAssistantPrepareInput[],
    finish: [] as PartnerAssistantFinishInput[],
    release: [] as PartnerAssistantReleaseInput[],
    smtp: [] as SmtpInput[],
    correspondence: [] as { address: string; since: Date }[],
    append: [] as { path: string; raw: string; date: Date }[],
    recordAppend: [] as { messageRowId: string; found: boolean }[],
    skip: [] as { jobId: string | null; reason: string }[],
    skipAborted: [] as boolean[],
    pauseAborted: [] as boolean[],
    claim: [] as unknown[][],
    opened: 0,
  };
  const chosen = options.candidate === undefined ? candidate : options.candidate;
  const after = (phase: keyof NonNullable<Options["clockAfter"]>) => {
    const value = options.clockAfter?.[phase];
    if (value !== undefined) clockNow = value;
  };
  /** Ferma la chiamata `phase` fino alla fine del budget, se il test lo chiede. */
  const stuck = <T>(phase: NonNullable<Options["hang"]>, value: () => T): Promise<T> => {
    if (options.hang !== phase) return Promise.resolve(value());
    clockNow = PARTNER_ASSISTANT_SEND_BUDGET_MS;
    return new Promise<T>(() => undefined);
  };
  const store: PartnerAssistantSendStore = {
    claim: vi.fn(async (...args: unknown[]) => {
      calls.push("claim");
      recorded.claim.push(args);
      after("claim");
      return (options.claim ?? {
        ok: true,
        value: {
          status: "claimed",
          leaseToken: lease,
          mode: chosen?.mode ?? "invio",
          appends: options.appends ?? [],
          candidate: chosen,
        },
      }) as never;
    }),
    skip: vi.fn(async (_lease, jobId, reason, signal) => {
      calls.push(jobId === null ? `skip:null:${reason}` : `skip:${reason}`);
      recorded.skip.push({ jobId, reason });
      recorded.skipAborted.push(signal.aborted);
      return done;
    }),
    prepare: vi.fn(async (_lease, _operation, input) => {
      calls.push("prepare");
      recorded.prepare.push(input);
      return (options.prepare ?? {
        ok: true,
        value: { status: "pronto", messageRowId: id(300) },
      }) as never;
    }),
    start: vi.fn(async () => {
      calls.push("start");
      after("start");
      return (
        typeof options.start === "function"
          ? await options.start()
          : (options.start ?? { ok: true, value: { status: "in_invio" } })
      ) as never;
    }),
    finish: vi.fn(async (_lease, _operation, input) => {
      calls.push(`finish:${input.outcome}`);
      recorded.finish.push(input);
      return (options.finish ?? {
        ok: true,
        value: { status: "done", sendStatus: input.outcome, replayed: false },
      }) as never;
    }),
    recordAppend: vi.fn(async (_lease, messageRowId, found) => {
      calls.push(`recordAppend:${found}`);
      recorded.recordAppend.push({ messageRowId, found });
      return done;
    }),
    pause: vi.fn(async (_lease, signal) => {
      calls.push("pause");
      recorded.pauseAborted.push(signal.aborted);
      return done;
    }),
    release: vi.fn(async (_lease, input) => {
      calls.push("release");
      recorded.release.push(input);
      return done;
    }),
    recordEnvironment: vi.fn(async () => done),
  };
  const mailbox = {
    folders: vi.fn(async () => {
      calls.push("folders");
      return stuck("folders", () => (options.folders === undefined ? folders : options.folders));
    }),
    correspondence: vi.fn(async (_folders: PartnerAssistantFolders, to: string, since: Date) => {
      calls.push("correspondence");
      recorded.correspondence.push({ address: to, since });
      after("correspondence");
      return stuck("correspondence", () =>
        options.correspondence === undefined ? false : options.correspondence,
      );
    }),
    findMessageId: vi.fn(async (_path: string, messageId: string) => {
      calls.push("findMessageId");
      return stuck("findMessageId", () => (options.find ? options.find(messageId) : []));
    }),
    append: vi.fn(async (path: string, raw: string, date: Date) => {
      calls.push("append");
      recorded.append.push({ path, raw, date });
      return options.append ?? true;
    }),
    close: vi.fn(async () => {
      calls.push("close");
    }),
  };
  const openMailbox = vi.fn(async () => {
    calls.push("open");
    recorded.opened += 1;
    const opening = options.open ?? "ok";
    return stuck("open", () =>
      opening === "ok"
        ? { ok: true as const, mailbox }
        : (opening as PartnerAssistantMailboxOpening),
    );
  });
  const smtp = {
    send: vi.fn(async (input: SmtpInput) => {
      calls.push("smtp");
      recorded.smtp.push(input);
      if (input.beforeSend && !options.skipBeforeSend && !(await input.beforeSend()))
        return { outcome: { kind: "non_partito" as const, code: "smtp_preinvio" }, login: "ok" };
      if (!options.skipBeforeSend) calls.push("data");
      return (options.smtp ?? (async () => smtpOk))(input);
    }),
  };
  let next = 500;
  return {
    recorded,
    store,
    mailbox,
    smtp,
    dependencies: {
      store,
      smtp,
      openMailbox: openMailbox as never,
      clock: () => clockNow,
      now: () => (typeof options.now === "function" ? options.now() : (options.now ?? NOW)),
      workerId: () => id(1),
      uuid: () => id(next++),
      ...(options.loadTestLookbook ? { loadTestLookbook: options.loadTestLookbook } : {}),
    },
  };
}
async function runSend(options: Options = {}) {
  state = setup(options);
  return runPartnerAssistantSendStep(
    config,
    mail,
    new AbortController().signal,
    state.dependencies,
  );
}
/** Un giro con una chiamata alla casella ferma: il timer del budget (finto) scade e la sblocca. */
async function runUntilBudgetEnds(options: Options) {
  vi.useFakeTimers();
  try {
    const running = runSend(options);
    await vi.advanceTimersByTimeAsync(PARTNER_ASSISTANT_SEND_BUDGET_MS);
    return await running;
  } finally {
    vi.useRealTimers();
  }
}
const preparedRaw = () => state.recorded.prepare[0]!.raw;
const correspondenceSince = () => state.recorded.correspondence[0]!.since;
const released = () => state.recorded.release[0];
/** Un SMTP che dura `ms` sul clock del budget. */
const slow = (ms: number) => async () => {
  clockNow += ms;
  return smtpOk;
};

let consoleSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  calls = [];
  clockNow = 0;
  consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  // Mai due rilasci nello stesso giro, mai un secondo SMTP.
  expect(calls.filter((call) => call === "release").length).toBeLessThanOrEqual(1);
  expect(calls.filter((call) => call === "smtp").length).toBeLessThanOrEqual(1);
  consoleSpy.mockRestore();
});

describe("passo d'invio dell'assistente Partner", () => {
  it("costanti del passo", () => {
    expect(PARTNER_ASSISTANT_SEND_BUDGET_MS).toBe(120_000);
    expect(PARTNER_ASSISTANT_SEND_LEASE_SECONDS).toBe(300);
    expect(PARTNER_ASSISTANT_SMTP_MIN_MS).toBe(75_000);
    expect(PARTNER_ASSISTANT_SMTP_MARGIN_MS).toBe(15_000);
    expect(PARTNER_ASSISTANT_SEND_RECORD_MS).toBe(10_000);
    expect(PARTNER_ASSISTANT_MAILBOX_DAYS).toBe(365);
  });
  it("claim con la lease di 300 secondi e il numero degli indirizzi di prova", async () => {
    await runSend();
    expect(state.recorded.claim[0]!.slice(0, 3)).toEqual([id(1), 300, 2]);
  });
  it("claim senza risposta certa: uncertain, niente altro", async () => {
    expect(await runSend({ claim: { ok: false } })).toEqual({ status: "uncertain" });
    expect(calls).toEqual(["claim"]);
  });
  it("claim idle: idle, nessun rilascio", async () => {
    expect(
      await runSend({ claim: { ok: true, value: { status: "idle", reason: "vuota" } } }),
    ).toEqual({ status: "idle" });
    expect(calls).toEqual(["claim"]);
  });
  it("invio: l'ordine delle chiamate", async () => {
    expect(await runSend()).toEqual({ status: "complete" });
    expect(calls).toEqual([
      "claim",
      "open",
      "folders",
      "correspondence",
      "prepare",
      "smtp",
      "start",
      "data",
      "finish:inviato",
      "findMessageId",
      "append",
      "recordAppend:false",
      "close",
      "release",
    ]);
    expect(state.recorded.finish[0]).toEqual({
      messageRowId: id(300),
      outcome: "inviato",
      smtpCode: 250,
      enhancedCode: null,
      spam: false,
      reason: null,
    });
    expect(state.recorded.append[0]!.path).toBe("Posta inviata");
    expect(state.recorded.append[0]!.raw).toBe(preparedRaw());
    expect(state.recorded.smtp[0]).toMatchObject({
      raw: preparedRaw(),
      from: mail.user,
      to: address,
    });
  });
  it("Date: e since dall'ora vera, non dal clock del budget", async () => {
    await runSend();
    expect(preparedRaw()).toContain("Date: Thu, 29 Oct 2026 08:40:00 +0000");
    expect(correspondenceSince()).toEqual(
      new Date(Date.parse("2026-10-29T08:40:00Z") - 365 * DAY_MS),
    );
    expect(state.recorded.correspondence[0]!.address).toBe(address);
  });
  it("prepare con il testo approvato più la frase di uscita, oggetto della bozza, mailboxCheck vuota", async () => {
    await runSend();
    const input = state.recorded.prepare[0]!;
    const optOut = PARTNER_ASSISTANT_OPT_OUT_LINES.it_voi;
    expect(input).toEqual({
      jobId: candidate.jobId,
      draftId: candidate.draft.draftId,
      mode: "invio",
      testRunId: null,
      testIndex: null,
      messageId: input.messageId,
      toAddress: address,
      subject: candidate.draft.subject,
      text: `${candidate.draft.body}\n\n${candidate.draft.signature}\n\n${optOut}`,
      optOut,
      raw: input.raw,
      mailboxCheck: "vuota",
    });
    expect(input.raw).toContain("Subject: Club Sintetico e LuckyLap\r\n");
    expect(input.raw).toContain(`To: ${address}\r\n`);
    expect(input.raw).toContain('From: "Tommaso | LuckyLap" <casella@luckylap.example.test>\r\n');
  });
  it("in italiano con il lei, la frase del lei", async () => {
    await runSend({ candidate: { ...candidate, register: "lei" } });
    expect(state.recorded.prepare[0]!.optOut).toBe(PARTNER_ASSISTANT_OPT_OUT_LINES.it_lei);
  });
  it("prova con lookbook: un solo PDF, indirizzo di prova e stessi byte a prepare, SMTP e IMAP", async () => {
    const lookbook = PARTNER_ASSISTANT_TEST_LOOKBOOKS.porsche_club;
    const chosen = { ...testCandidate(1), lookbook };
    expect(await runSend({ candidate: chosen })).toEqual({ status: "complete" });
    const input = state.recorded.prepare[0]!;
    expect(input.lookbook).toEqual(lookbook);
    expect(input.toAddress).toBe(mail.testTo[1]);
    expect(input.subject).toBe(chosen.draft.subject);
    expect(input.text).toBe(
      `${chosen.draft.body}\n\n${chosen.draft.signature}\n\n${PARTNER_ASSISTANT_OPT_OUT_LINES.it_voi}`,
    );
    expect(input.raw.match(/Content-Disposition: attachment;/g)).toHaveLength(1);
    expect(input.raw).toContain("LuckyLap-Lookbook-Porsche-Clubs.pdf");
    expect(Buffer.byteLength(input.raw, "ascii")).toBeGreaterThan(65_536);
    expect(Buffer.byteLength(input.raw, "ascii")).toBeLessThanOrEqual(
      PARTNER_ASSISTANT_TEST_MIME_MAX_BYTES,
    );
    const boundary = input.raw.match(/boundary="([^"]+)"/)![1];
    const part = input.raw.split(`--${boundary}`).find((value) => /application\/pdf/.test(value))!;
    const content = Buffer.from(part.slice(part.indexOf("\r\n\r\n") + 4), "base64");
    expect(content.byteLength).toBe(lookbook.bytes);
    expect(createHash("sha256").update(content).digest("hex")).toBe(lookbook.sha256);
    expect(state.recorded.smtp).toHaveLength(1);
    expect(state.recorded.smtp[0]!.to).toBe(mail.testTo[1]);
    expect(state.recorded.smtp[0]!.raw).toBe(input.raw);
    expect(state.recorded.append[0]!.raw).toBe(input.raw);
  });
  it("dal 4 novembre di Roma il candidato reale porta il lookbook al recapito della scheda", async () => {
    const lookbook = PARTNER_ASSISTANT_TEST_LOOKBOOKS.club;
    expect(
      await runSend({
        candidate: { ...candidate, lookbook },
        now: Date.parse("2026-11-03T23:00:00Z"),
      }),
    ).toEqual({ status: "complete" });
    expect(state.recorded.prepare[0]!.lookbook).toEqual(lookbook);
    expect(preparedRaw()).toContain("LuckyLap-Lookbook-Clubs.pdf");
    expect(state.recorded.smtp[0]!.to).toBe(address);
    expect(state.recorded.append[0]!.raw).toBe(preparedRaw());
  });
  it("prima del 4 novembre di Roma un candidato reale con metadati non prepara né manda", async () => {
    expect(
      await runSend({
        candidate: { ...candidate, lookbook: PARTNER_ASSISTANT_TEST_LOOKBOOKS.club },
        now: Date.parse("2026-11-03T22:59:59Z"),
      }),
    ).toEqual({ status: "complete" });
    expect(calls).toEqual(["claim", "release"]);
    expect(released()?.outcome).toBe("allegato_prima_avvio");
    expect(state.recorded.prepare).toHaveLength(0);
    expect(state.recorded.smtp).toHaveLength(0);
  });
  it("un altro contatto reale resta solo testo e non passa metadati a prepare", async () => {
    await runSend({
      candidate: {
        ...candidate,
        choice: { contactKind: "brand", request: "collab_capsule", eventStartsOn: "" },
      },
      now: Date.parse("2026-11-04T09:00:00Z"),
    });
    expect(state.recorded.prepare[0]).not.toHaveProperty("lookbook");
    expect(preparedRaw()).not.toMatch(/multipart|application\/pdf|Content-Disposition/);
  });
  it("impronta prenotata diversa: nessun prepare né SMTP", async () => {
    await runSend({
      candidate: {
        ...testCandidate(0),
        lookbook: { ...PARTNER_ASSISTANT_TEST_LOOKBOOKS.club, sha256: "f".repeat(64) },
      },
    });
    expect(state.recorded.prepare).toHaveLength(0);
    expect(state.recorded.smtp).toHaveLength(0);
    expect(released()?.outcome).toBe("composizione_fallita");
  });
  it("file distribuito cambiato o mancante: nessun prepare né SMTP", async () => {
    const load = vi.fn(async () => {
      throw new Error("Impronta del PDF sintetico cambiata");
    });
    await runSend({
      candidate: { ...testCandidate(0), lookbook: PARTNER_ASSISTANT_TEST_LOOKBOOKS.club },
      loadTestLookbook: load,
    });
    expect(load).toHaveBeenCalledExactlyOnceWith(PARTNER_ASSISTANT_TEST_LOOKBOOKS.club);
    expect(state.recorded.prepare).toHaveLength(0);
    expect(state.recorded.smtp).toHaveLength(0);
    expect(released()?.outcome).toBe("composizione_fallita");
  });
  it.each([
    "Come per il Porsche Club Toscana.",
    "We made 150 bespoke T-shirts for their members.",
    "We made 150 bespoke ones for their members.",
  ])("una vecchia bozza approvata con riferimento ritirato non apre la posta: %s", async (body) => {
    await runSend({ candidate: withBody(`Gentile segreteria,\n${body}\nUn saluto,`) });
    expect(calls).toEqual(["claim", "skip:riferimento_superato", "release"]);
    expect(state.recorded.prepare).toHaveLength(0);
    expect(state.recorded.smtp).toHaveLength(0);
    expect(released()).toMatchObject({ outcome: "riferimento_superato" });
  });
  it("una prova con riferimento ritirato non viene spedita", async () => {
    await runSend({
      candidate: {
        ...testCandidate(0),
        draft: withBody("Come per il Porsche Club Toscana.").draft,
      },
    });
    expect(calls).toEqual(["claim", "skip:riferimento_superato", "release"]);
    expect(state.recorded.smtp).toHaveLength(0);
  });
  it("il riferimento generico ai Porsche Club italiani prosegue fino all'invio", async () => {
    await runSend({
      candidate: withBody(
        "Gentile segreteria,\nAbbiamo già collaborato con Porsche Club italiani.\nUn saluto,",
      ),
    });
    expect(calls).toContain("finish:inviato");
    expect(calls).not.toContain("skip:riferimento_superato");
  });
  it("bozza scaduta (data del corpo passata): skip bozza_scaduta, casella non aperta senza appends", async () => {
    expect(
      await runSend({
        candidate: withBody("Gentile segreteria,\nci vediamo il 25 ottobre.\nUn saluto,", {
          createdAt: "2026-10-20T09:00:00Z",
        }),
      }),
    ).toEqual({ status: "complete" });
    expect(calls).toEqual(["claim", "skip:bozza_scaduta", "release"]);
    expect(state.recorded.skip[0]).toEqual({ jobId: candidate.jobId, reason: "bozza_scaduta" });
    expect(released()).toEqual({ outcome: "bozza_scaduta", smtpLogin: null, imapLogin: null });
  });
  it("bozza scaduta (evento iniziato) con una copia arretrata: la copia si fa lo stesso", async () => {
    await runSend({
      candidate: {
        ...candidate,
        choice: { contactKind: "evento", request: "stand_evento", eventStartsOn: "2026-10-29" },
      },
      appends: [pending(1)],
      find: () => [7],
    });
    expect(calls).toEqual([
      "claim",
      "skip:bozza_scaduta",
      "open",
      "folders",
      "findMessageId",
      "recordAppend:true",
      "close",
      "release",
    ]);
  });
  it("conversazione trovata: skip conversazione_esistente, nessun prepare né SMTP", async () => {
    expect(await runSend({ correspondence: true })).toEqual({ status: "complete" });
    expect(calls).toEqual([
      "claim",
      "open",
      "folders",
      "correspondence",
      "skip:conversazione_esistente",
      "close",
      "release",
    ]);
  });
  it("ricerca null: skip casella_incerta, nessun SMTP", async () => {
    // Fuoco 5
    await runSend({ correspondence: null });
    expect(calls).toEqual([
      "claim",
      "open",
      "folders",
      "correspondence",
      "skip:casella_incerta",
      "close",
      "release",
    ]);
    expect(released()).toMatchObject({ outcome: "casella_incerta", imapLogin: "ok" });
  });
  it("cartelle null: come un errore di casella", async () => {
    // Fuoco 5
    await runSend({ folders: null });
    expect(calls).toEqual(["claim", "open", "folders", "skip:casella_incerta", "close", "release"]);
  });
  it("IMAP credenziali: pause, nessun SMTP, stopped, release con imap_login imap_autenticazione", async () => {
    expect(await runSend({ open: credentials })).toEqual({ status: "stopped" });
    expect(calls).toEqual(["claim", "open", "pause", "release"]);
    expect(released()).toEqual({
      outcome: "imap_autenticazione",
      smtpLogin: null,
      imapLogin: "imap_autenticazione",
    });
  });
  it("IMAP credenziali a budget finito: pause con i suoi 10 secondi, come gli altri esiti registrati", async () => {
    expect(
      await runSend({ open: credentials, clockAfter: { claim: PARTNER_ASSISTANT_SEND_BUDGET_MS } }),
    ).toEqual({ status: "stopped" });
    expect(calls).toEqual(["claim", "open", "pause", "release"]);
    expect(state.recorded.pauseAborted).toEqual([false]);
  });
  it("IMAP ECONNRESET con candidato: skip casella_incerta, release con imap_econnreset", async () => {
    // Fuoco 5
    expect(await runSend({ open: econnreset })).toEqual({ status: "complete" });
    expect(calls).toEqual(["claim", "open", "skip:casella_incerta", "release"]);
    expect(state.recorded.skip[0]).toEqual({ jobId: candidate.jobId, reason: "casella_incerta" });
    expect(released()).toEqual({
      outcome: "imap_econnreset",
      smtpLogin: null,
      imapLogin: "imap_econnreset",
    });
  });
  it("solo appends e IMAP ECONNRESET: skip(null, casella_incerta), un solo login", async () => {
    // Fuoco 5
    await runSend({ candidate: null, appends: [pending(1)], open: econnreset });
    expect(calls).toEqual(["claim", "open", "skip:null:casella_incerta", "release"]);
    expect(state.recorded.opened).toBe(1);
  });
  it("append arretrato con findMessageId null: skip(null, casella_incerta) a fine giro, un solo login", async () => {
    // Fuoco 5
    await runSend({ candidate: null, appends: [pending(1)], find: () => null });
    expect(calls).toEqual([
      "claim",
      "open",
      "folders",
      "findMessageId",
      "skip:null:casella_incerta",
      "close",
      "release",
    ]);
    expect(state.recorded.opened).toBe(1);
  });
  it("append arretrato non riuscito e un candidato: invio, poi una sola attesa a fine giro", async () => {
    // Fuoco 5
    await runSend({ appends: [pending(1)], append: false });
    expect(calls).toEqual([
      "claim",
      "open",
      "folders",
      "findMessageId",
      "append",
      "correspondence",
      "prepare",
      "smtp",
      "start",
      "data",
      "finish:inviato",
      "findMessageId",
      "append",
      "skip:null:casella_incerta",
      "close",
      "release",
    ]);
  });
  it("una ricerca incerta e un arretrato aperto: una sola attesa", async () => {
    await runSend({ appends: [pending(1)], find: () => null, correspondence: null });
    expect(calls.filter((call) => call.includes("casella_incerta"))).toEqual([
      "skip:casella_incerta",
    ]);
  });
  it("appends: search null non chiude, [] appende, UID registra found true", async () => {
    const appends = [pending(1), pending(2), pending(3)];
    await runSend({
      candidate: null,
      appends,
      find: (messageId) =>
        messageId === appends[0]!.messageId ? null : messageId === appends[1]!.messageId ? [] : [9],
    });
    expect(calls).toEqual([
      "claim",
      "open",
      "folders",
      "findMessageId",
      "findMessageId",
      "append",
      "recordAppend:false",
      "findMessageId",
      "recordAppend:true",
      "skip:null:casella_incerta",
      "close",
      "release",
    ]);
    expect(state.recorded.recordAppend).toEqual([
      { messageRowId: appends[1]!.messageRowId, found: false },
      { messageRowId: appends[2]!.messageRowId, found: true },
    ]);
    expect(state.recorded.append[0]).toEqual({
      path: "Posta inviata",
      raw: appends[1]!.raw,
      date: new Date("2026-10-28T08:41:00Z"),
    });
  });
  it("appends senza posta inviata: la casella resta incerta", async () => {
    await runSend({
      candidate: null,
      appends: [pending(1)],
      folders: { inbox: "INBOX", sent: null, junk: "Spam" },
    });
    expect(calls).toEqual([
      "claim",
      "open",
      "folders",
      "skip:null:casella_incerta",
      "close",
      "release",
    ]);
  });
  describe("budget finito durante una chiamata alla casella: lo skip si registra con i suoi 10 secondi", () => {
    // Fuoco 5: senza lo skip registrato il giro dopo, 2 minuti più tardi, rifà il login a IONOS
    // con lo stesso candidato, e il passo con Claude resta fermo.
    it("ricerca dei 12 mesi ferma: skip casella_incerta, complete, nessun SMTP", async () => {
      expect(await runUntilBudgetEnds({ hang: "correspondence" })).toEqual({ status: "complete" });
      expect(calls).toEqual([
        "claim",
        "open",
        "folders",
        "correspondence",
        "skip:casella_incerta",
        "close",
        "release",
      ]);
      expect(state.recorded.skip).toEqual([{ jobId: candidate.jobId, reason: "casella_incerta" }]);
      expect(state.recorded.skipAborted).toEqual([false]);
      expect(released()).toEqual({
        outcome: "casella_incerta",
        smtpLogin: null,
        imapLogin: "ok",
      });
    });
    it("apertura arrivata dopo la scadenza: skip casella_incerta, release con imap_scadenza", async () => {
      expect(await runUntilBudgetEnds({ hang: "open" })).toEqual({ status: "complete" });
      expect(calls).toEqual(["claim", "open", "skip:casella_incerta", "release"]);
      expect(state.recorded.skip).toEqual([{ jobId: candidate.jobId, reason: "casella_incerta" }]);
      expect(released()).toEqual({
        outcome: "imap_scadenza",
        smtpLogin: null,
        imapLogin: "imap_scadenza",
      });
    });
    it("cartelle ferme: skip casella_incerta, complete", async () => {
      expect(await runUntilBudgetEnds({ hang: "folders" })).toEqual({ status: "complete" });
      expect(calls).toEqual([
        "claim",
        "open",
        "folders",
        "skip:casella_incerta",
        "close",
        "release",
      ]);
      expect(released()).toMatchObject({ outcome: "imap_cartelle" });
    });
    it("arretrato fermo, senza candidato: skip(null, casella_incerta) di fine giro, complete", async () => {
      expect(
        await runUntilBudgetEnds({ candidate: null, appends: [pending(1)], hang: "findMessageId" }),
      ).toEqual({ status: "complete" });
      expect(calls).toEqual([
        "claim",
        "open",
        "folders",
        "findMessageId",
        "skip:null:casella_incerta",
        "close",
        "release",
      ]);
      expect(state.recorded.skipAborted).toEqual([false]);
    });
    it("arretrato fermo con un candidato: una sola attesa, sul candidato, nessuna ricerca né SMTP", async () => {
      expect(await runUntilBudgetEnds({ appends: [pending(1)], hang: "findMessageId" })).toEqual({
        status: "complete",
      });
      expect(calls).toEqual([
        "claim",
        "open",
        "folders",
        "findMessageId",
        "skip:casella_incerta",
        "close",
        "release",
      ]);
      expect(state.recorded.skip).toEqual([{ jobId: candidate.jobId, reason: "casella_incerta" }]);
    });
  });
  it("SMTP credenziali: finish scartato smtp_credenziali", async () => {
    await runSend({ smtp: failed({ kind: "credenziali", code: "smtp_535" }, "smtp_535") });
    expect(state.recorded.finish[0]).toEqual({
      messageRowId: id(300),
      outcome: "scartato",
      smtpCode: null,
      enhancedCode: null,
      spam: false,
      reason: "smtp_credenziali",
    });
    expect(released()).toMatchObject({ smtpLogin: "smtp_535" });
    expect(calls).not.toContain("append");
  });
  it("SMTP 450: finish scartato smtp_temporaneo", async () => {
    await runSend({
      smtp: failed({ kind: "temporaneo", code: "smtp_450", responseCode: 450 }),
    });
    expect(state.recorded.finish[0]).toMatchObject({
      outcome: "scartato",
      reason: "smtp_temporaneo",
      spam: false,
    });
  });
  it("SMTP non partito: finish scartato smtp_non_partito", async () => {
    await runSend({ smtp: failed({ kind: "non_partito", code: "smtp_esocket" }, "smtp_esocket") });
    expect(state.recorded.finish[0]).toMatchObject({
      outcome: "scartato",
      smtpCode: null,
      reason: "smtp_non_partito",
    });
  });
  it("SMTP 550 5.1.1: finish respinto con 5.1.1", async () => {
    await runSend({
      smtp: failed({
        kind: "respinto",
        code: "smtp_550",
        responseCode: 550,
        enhanced: "5.1.1",
        spam: false,
      }),
    });
    expect(state.recorded.finish[0]).toEqual({
      messageRowId: id(300),
      outcome: "respinto",
      smtpCode: 550,
      enhancedCode: "5.1.1",
      spam: false,
      reason: "smtp_550",
    });
    expect(calls).not.toContain("append");
  });
  it("SMTP 554 spam: finish respinto con spam", async () => {
    await runSend({
      smtp: failed({
        kind: "respinto",
        code: "smtp_554",
        responseCode: 554,
        enhanced: null,
        spam: true,
      }),
    });
    expect(state.recorded.finish[0]).toMatchObject({ outcome: "respinto", spam: true });
  });
  it("SMTP bloccato: finish scartato smtp_bloccato", async () => {
    await runSend({
      smtp: failed({ kind: "bloccato", code: "smtp_554", responseCode: 554, enhanced: "5.7.1" }),
    });
    expect(state.recorded.finish[0]).toMatchObject({
      outcome: "scartato",
      reason: "smtp_bloccato",
      spam: false,
    });
  });
  it("SMTP caduto durante send: finish incerto, niente append, niente secondo SMTP", async () => {
    // Fuoco 4
    await runSend({ smtp: failed({ kind: "incerto", code: "smtp_econnection" }) });
    expect(state.recorded.finish[0]).toEqual({
      messageRowId: id(300),
      outcome: "incerto",
      smtpCode: null,
      enhancedCode: null,
      spam: false,
      reason: "smtp_econnection",
    });
    expect(calls).toEqual([
      "claim",
      "open",
      "folders",
      "correspondence",
      "prepare",
      "smtp",
      "start",
      "data",
      "finish:incerto",
      "close",
      "release",
    ]);
    expect(state.smtp.send).toHaveBeenCalledOnce();
  });
  it("SMTP che lancia: finish incerto, mai un secondo SMTP", async () => {
    // Fuoco 4
    await runSend({
      smtp: async () => {
        throw new Error("boom");
      },
    });
    expect(state.recorded.finish[0]).toMatchObject({ outcome: "incerto" });
    expect(state.smtp.send).toHaveBeenCalledOnce();
  });
  it("SMTP lento: il 250 arriva a budget finito e finish parte lo stesso, con i suoi 10 secondi", async () => {
    await runSend({ smtp: slow(PARTNER_ASSISTANT_SEND_BUDGET_MS) });
    expect(calls).toContain("finish:inviato");
    expect(calls.slice(-2)).toEqual(["close", "release"]);
    // A budget finito la copia aspetta il giro dopo.
    expect(calls).not.toContain("append");
  });
  it("SMTP oltre la scadenza: signal interrotto prima della fine del budget", async () => {
    // A start restano 15 secondi e 40 millisecondi: la scadenza dell'SMTP è fra 40 millisecondi.
    let abortedAt: number | null = null;
    const startedAt = Date.now();
    await runSend({
      clockAfter: {
        start: PARTNER_ASSISTANT_SEND_BUDGET_MS - PARTNER_ASSISTANT_SMTP_MARGIN_MS - 40,
      },
      smtp: ({ signal }) =>
        new Promise((resolve) => {
          expect(signal.aborted).toBe(false);
          signal.addEventListener("abort", () => {
            abortedAt = Date.now();
            resolve({ outcome: { kind: "incerto", code: "smtp_scadenza" }, login: "ok" });
          });
        }),
    });
    expect(abortedAt).not.toBeNull();
    expect(abortedAt! - startedAt).toBeLessThan(5_000);
    expect(state.recorded.finish[0]).toMatchObject({ outcome: "incerto", reason: "smtp_scadenza" });
  });
  it("start stop dopo il login: nessun DATA", async () => {
    // Fuoco 3
    await runSend({ start: { ok: true, value: { status: "stop", reason: "non_idoneo" } } });
    expect(calls).toEqual([
      "claim",
      "open",
      "folders",
      "correspondence",
      "prepare",
      "smtp",
      "start",
      "close",
      "release",
    ]);
    expect(released()).toMatchObject({ outcome: "non_idoneo", smtpLogin: "ok" });
  });
  it("una scadenza assoluta già raggiunta non prepara né apre SMTP", async () => {
    await runSend({ candidate: { ...candidate, sendNotAfter: new Date(NOW).toISOString() } });
    expect(calls).not.toContain("prepare");
    expect(calls).not.toContain("smtp");
    expect(released()).toMatchObject({ outcome: "orario_scaduto" });
  });
  it("ricontrolla la scadenza dopo il login: niente start e niente DATA", async () => {
    let wall = NOW;
    await runSend({
      candidate: { ...candidate, sendNotAfter: new Date(NOW + 1000).toISOString() },
      now: () => wall,
      skipBeforeSend: true,
      smtp: async (input) => {
        wall = NOW + 1000;
        expect(await input.beforeSend!()).toBe(false);
        return { login: "ok", outcome: { kind: "non_partito", code: "smtp_preinvio" } };
      },
    });
    expect(calls).not.toContain("start");
    expect(calls).not.toContain("data");
    expect(state.recorded.finish[0]).toMatchObject({
      outcome: "scartato",
      reason: "smtp_non_partito",
    });
  });
  it("un errore di credenziali prima dell'autorizzazione scarta il MIME ancora pronto", async () => {
    await runSend({
      skipBeforeSend: true,
      smtp: failed({ kind: "credenziali", code: "smtp_535" }, "smtp_535"),
    });
    expect(calls).not.toContain("start");
    expect(calls).not.toContain("data");
    expect(state.recorded.finish[0]).toMatchObject({
      outcome: "scartato",
      reason: "smtp_credenziali",
    });
  });
  it("il termine assoluto interrompe un trasporto ancora attivo anche con budget residuo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    let abortedAt: number | null = null;
    try {
      const running = runSend({
        candidate: { ...candidate, sendNotAfter: new Date(NOW + 40).toISOString() },
        now: () => Date.now(),
        smtp: ({ signal }) =>
          new Promise((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                abortedAt = Date.now();
                resolve({ login: "ok", outcome: { kind: "incerto", code: "smtp_scadenza" } });
              },
              { once: true },
            );
          }),
      });
      await vi.advanceTimersByTimeAsync(39);
      expect(abortedAt).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      await running;
      expect(abortedAt).toBe(NOW + 40);
      expect(state.recorded.finish[0]).toMatchObject({ outcome: "incerto" });
      expect(calls.filter((call) => call === "data")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("start senza lease o senza risposta certa: nessun DATA", async () => {
    // Fuoco 3
    await runSend({ start: { ok: true, value: { status: "lease_persa" } } });
    expect(calls).not.toContain("data");
    calls = [];
    expect(await runSend({ start: { ok: false } })).toEqual({ status: "uncertain" });
    expect(calls).not.toContain("data");
  });
  it.each([true, false])(
    "attende start pendente dopo chiusura SMTP, esito certo=%s",
    async (certain) => {
      vi.useFakeTimers();
      let completeStart!: (result: StoreResult<unknown>) => void;
      try {
        const running = runSend({
          skipBeforeSend: true,
          start: () =>
            new Promise((resolve) => {
              completeStart = resolve;
            }),
          smtp: async (input) => {
            void input.beforeSend!();
            await vi.waitFor(() => expect(completeStart).toBeTypeOf("function"));
            calls.push("smtp:closed");
            return { login: "ok", outcome: { kind: "non_partito", code: "smtp_econnreset" } };
          },
        });
        await vi.waitFor(() => expect(calls).toContain("smtp:closed"));
        expect(state.store.finish).not.toHaveBeenCalled();
        expect(state.store.release).not.toHaveBeenCalled();
        completeStart(certain ? { ok: true, value: { status: "in_invio" } } : { ok: false });
        expect(await running).toEqual({ status: certain ? "complete" : "uncertain" });
        expect(calls).not.toContain("data");
        if (certain) {
          expect(state.recorded.finish).toMatchObject([
            { outcome: "scartato", reason: "smtp_non_partito" },
          ]);
          expect(calls.indexOf("finish:scartato")).toBeLessThan(calls.indexOf("release"));
        } else expect(state.store.finish).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("prepare rifiutato: nessuno start", async () => {
    await runSend({ prepare: { ok: true, value: { status: "rifiutato", reason: "limite" } } });
    expect(calls).toEqual([
      "claim",
      "open",
      "folders",
      "correspondence",
      "prepare",
      "close",
      "release",
    ]);
    expect(released()).toMatchObject({ outcome: "limite" });
  });
  it("prepare senza risposta certa: uncertain, nessuno start", async () => {
    expect(await runSend({ prepare: { ok: false } })).toEqual({ status: "uncertain" });
    expect(calls).not.toContain("start");
  });
  it("finish senza risposta dopo l'SMTP: uncertain, un solo SMTP", async () => {
    // Fuoco 4
    expect(await runSend({ finish: { ok: false } })).toEqual({ status: "uncertain" });
    expect(state.smtp.send).toHaveBeenCalledOnce();
  });
  it("tempo sotto 75 secondi: nessun prepare", async () => {
    await runSend({
      clockAfter: {
        correspondence: PARTNER_ASSISTANT_SEND_BUDGET_MS - PARTNER_ASSISTANT_SMTP_MIN_MS + 1,
      },
    });
    expect(calls).toEqual(["claim", "open", "folders", "correspondence", "close", "release"]);
    expect(released()).toMatchObject({ outcome: "tempo_insufficiente" });
  });
  it("tempo di 75 secondi esatti: si prepara", async () => {
    await runSend({
      clockAfter: {
        correspondence: PARTNER_ASSISTANT_SEND_BUDGET_MS - PARTNER_ASSISTANT_SMTP_MIN_MS,
      },
    });
    expect(calls).toContain("prepare");
  });
  it("prova: destinatario testTo[testIndex], oggetto senza [Prova], controllo sull'indirizzo vero, trovato non blocca, nessun ricontrollo delle date", async () => {
    await runSend({ candidate: testCandidate(1), correspondence: true });
    expect(state.recorded.correspondence[0]!.address).toBe(address);
    const input = state.recorded.prepare[0]!;
    expect(input).toMatchObject({
      mode: "prova",
      testRunId: id(20),
      testIndex: 1,
      toAddress: "prova2@example.test",
      subject: "Club Sintetico e LuckyLap",
      mailboxCheck: "trovata",
    });
    expect(input.raw).not.toContain("[Prova]");
    expect(input.raw).toContain("To: prova2@example.test\r\n");
    expect(state.recorded.smtp[0]!.to).toBe("prova2@example.test");
    expect(calls).not.toContain("skip:bozza_scaduta");
    expect(calls).toContain("finish:inviato");
  });
  it("prova con la ricerca incerta: mailboxCheck incerta, si manda la prova", async () => {
    await runSend({ candidate: testCandidate(0), correspondence: null });
    expect(state.recorded.prepare[0]!.mailboxCheck).toBe("incerta");
    expect(calls).not.toContain("skip:casella_incerta");
  });
  it("prova senza l'indirizzo vero: incerta senza ricerca", async () => {
    await runSend({ candidate: { ...testCandidate(0), address: null } });
    expect(calls).not.toContain("correspondence");
    expect(state.recorded.prepare[0]!.mailboxCheck).toBe("incerta");
  });
  it("prova con testIndex fuori da testTo: nessun SMTP", async () => {
    await runSend({ candidate: testCandidate(2) });
    expect(calls).toEqual(["claim", "open", "folders", "close", "release"]);
    expect(released()).toMatchObject({ outcome: "prova_destinatario_mancante" });
  });
  it("invio con l'indirizzo nullo: nessun SMTP", async () => {
    await runSend({ candidate: { ...candidate, address: null } });
    expect(calls).toEqual(["claim", "open", "folders", "close", "release"]);
    expect(released()).toMatchObject({ outcome: "destinatario_non_valido" });
  });
  it("release porta gli accessi: smtp_login ok, imap_login ok", async () => {
    await runSend();
    expect(released()).toEqual({ outcome: "inviato", smtpLogin: "ok", imapLogin: "ok" });
  });
  it("Message-ID con il dominio della casella", async () => {
    await runSend();
    const { messageId, raw } = state.recorded.prepare[0]!;
    expect(messageId).toMatch(
      /^<[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@luckylap\.example\.test>$/,
    );
    expect(raw).toContain(`\r\nMessage-ID: ${messageId}\r\n`);
  });
  it("una bozza con una data non valida: niente invio, niente skip, un log senza dati", async () => {
    await runSend({ candidate: withBody(candidate.draft.body, { createdAt: "non una data" }) });
    expect(calls).toEqual(["claim", "release"]);
    expect(released()).toMatchObject({ outcome: "ricontrollo_non_valido" });
    expect(consoleSpy).toHaveBeenCalledWith("partner_assistant_send_bug", {
      phase: "ricontrollo",
      error: "RangeError",
    });
  });
  it("un errore nel codice: uncertain, un solo rilascio, nessun SMTP", async () => {
    state = setup({});
    const result = await runPartnerAssistantSendStep(config, mail, new AbortController().signal, {
      ...state.dependencies,
      openMailbox: (() => {
        calls.push("open");
        throw new TypeError(`private ${address}`);
      }) as never,
    });
    expect(result).toEqual({ status: "uncertain" });
    expect(calls).toEqual(["claim", "open", "release"]);
    expect(released()).toMatchObject({ outcome: "errore_interno" });
    expect(consoleSpy).toHaveBeenCalledWith("partner_assistant_send_bug", {
      phase: "casella",
      error: "TypeError",
    });
  });
  it("log senza indirizzi né testi", async () => {
    await runSend({
      smtp: async () => {
        throw new Error(`Gentile ${address} Dear ${mail.password}`);
      },
    });
    expect(consoleSpy).toHaveBeenCalledWith("partner_assistant_send_bug", {
      phase: "smtp",
      error: "Error",
    });
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toMatch(/@|Gentile|Dear|synthetic/);
    expect(JSON.stringify(state.recorded.release)).not.toMatch(/@|Gentile|Dear/);
  });
});
