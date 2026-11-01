import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { partnerAssistantDraftSha256, partnerAssistantSignature } from "./checks";
import { classifyClaudeError, type ClaudeCall, type ClaudeResult } from "./claude";
import { partnerAssistantConfig } from "./config";
import {
  PARTNER_ASSISTANT_MODEL,
  partnerAssistantCostUsd,
  type PartnerAssistantUsage,
} from "./cost";
import { extractCall, researchCall, reviewCall, writeCall } from "./prompts";
import { composePartnerAssistantTemplate } from "./template";
import type { PartnerAssistantSendStore } from "./send-store";
import type { PartnerAssistantStore } from "./store";
import type {
  PartnerAssistantChoice,
  PartnerAssistantContext,
  PartnerAssistantJob,
  PartnerAssistantStep,
} from "./types";
import {
  PARTNER_ASSISTANT_CLAUDE_TIMEOUT_MS,
  PARTNER_ASSISTANT_LEASE_SECONDS,
  PARTNER_ASSISTANT_MIN_CALL_MS,
  PARTNER_ASSISTANT_RESERVE_MS,
  PARTNER_ASSISTANT_STEP_BUDGET_MS,
  authorizedPartnerAssistant,
  receivePartnerAssistantTick,
  runPartnerAssistantStep,
} from "./worker";

// Solo dati sintetici: domini example.test, CO da 951, numero di telefono finto. Store e Claude
// sono finti: nessuna rete, nessun database.
const environment = {
  PARTNER_ASSISTANT_ENABLED: "true",
  PARTNER_ASSISTANT_SECRET: "synthetic-partner-assistant-secret-0000",
  ANTHROPIC_API_KEY: "sk-ant-synthetic-0000000000000000",
  PARTNER_ASSISTANT_SUPABASE_SECRET_KEY: "sb_secret_synthetic-partner-assistant",
  PARTNER_ASSISTANT_PHONE: "+39 000 000 0000",
  NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_synthetic-server-only",
};
const config = partnerAssistantConfig(environment)!;
const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const workerId = id(1);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const club: PartnerAssistantChoice = {
  contactKind: "club",
  porscheCommunity: false,
  reasonIt: "Club con un raduno in primavera",
  writeNow: true,
  writeOn: "",
  recipientEmail: "",
  recipientEmailSource: "",
  recipientEmailPublishedByOrg: false,
  personName: "Ada Prova",
  personTitle: "Presidente",
  language: "it",
  register: "voi",
  swiss: false,
  timezone: "Europe/Rome",
  factText: "Il club ha festeggiato trent'anni con un raduno",
  factDate: "2026-09-12",
  factSource: "https://club-sintetico.example.test/news",
  eventName: "",
  eventStartsOn: "",
  eventCity: "",
  eventCountry: "",
  eventReachable: false,
  notesIt: "Segreteria aperta il martedì",
  request: "merch_cobranding",
};
const signature = partnerAssistantSignature("it", environment.PARTNER_ASSISTANT_PHONE);
const savedDraft = (() => {
  const subject = "Club Sintetico e LuckyLap";
  const body = "Buongiorno,\nCorpo sintetico della bozza salvata.\nUn cordiale saluto,";
  return {
    draftId: id(8),
    language: "it" as const,
    subject,
    body,
    signature,
    sha256: partnerAssistantDraftSha256({ subject, body, signature }),
    rulesVersion: 1,
    createdAt: "2026-10-27T14:02:00+00:00",
  };
})();
const context: PartnerAssistantContext = {
  today: "2026-10-27",
  partner: {
    co: 951,
    name: "Club Sintetico",
    city: "Milano",
    country: "Italia",
    typeLabel: "Club",
    sections: ["collab"],
    priority: "alta",
    contactMonth: "2026-11-01",
    eventStartsOn: null,
    eventEndsOn: null,
    applicationDeadline: null,
    version: 3,
    research: { sito: "https://club-sintetico.example.test/" },
  },
  email: { contactId: id(5), address: "segreteria@club-sintetico.example.test", verified: true },
  rules: { version: 1, body: "Regole sintetiche dell'assistente, versione 1." },
  research: {
    noteId: id(6),
    text: "Ricerca sintetica: il club ha festeggiato trent'anni con un raduno.",
    sources: ["https://club-sintetico.example.test/news"],
    createdAt: "2026-10-27T14:00:00+00:00",
  },
  choice: { noteId: id(7), content: { ...club, decision: { kind: "scrivi" } } },
  draft: savedDraft,
  lastReview: null,
};
const leaseOf = (job: PartnerAssistantJob) => ({ jobId: job.jobId, leaseToken: job.leaseToken });

// Un corpo che passa tutti i controlli: 124 parole tra il saluto e la chiusura, una domanda.
const cleanBody = [
  "Buongiorno,",
  `${"Siamo un gruppo di appassionati di auto a Milano e disegniamo magliette. ".repeat(10)}Vi andrebbe di parlarne?`,
  "Un cordiale saluto,",
].join("\n");
const extracted = {
  contact_kind: "evento",
  porsche_community: false,
  reason_it: "Fiera con un'area dedicata ai giovani",
  write_now: true,
  write_on: "",
  recipient_email: "",
  recipient_email_source: "",
  recipient_email_published_by_org: false,
  person_name: "",
  person_title: "",
  language: "it",
  register: "voi",
  swiss: false,
  timezone: "Europe/Rome",
  fact_text: "La fiera ha aperto un'area per i giovani",
  fact_date: "2026-10-01",
  fact_source: "https://fiera-sintetica.example.test/news",
  event_name: "Fiera Sintetica",
  event_starts_on: "2026-11-17",
  event_city: "Milano",
  event_country: "Italia",
  event_reachable: true,
  notes_it: "",
};

// Risposte finte di Claude, con la forma di ClaudeResult.
const block = (value: Record<string, unknown>) => value as unknown as Anthropic.ContentBlock;
const text = (value: string, urls: string[] = []) =>
  block({
    type: "text",
    text: value,
    citations: urls.length
      ? urls.map((url) => ({
          type: "web_search_result_location",
          url,
          title: "Pagina sintetica",
          cited_text: value,
          encrypted_index: "synthetic",
        }))
      : null,
  });
const searchUse = block({
  type: "server_tool_use",
  id: "srvtoolu_synthetic",
  name: "web_search",
  input: { query: "Club Sintetico example.test" },
});
const searchResults = (urls: string[]) =>
  block({
    type: "web_search_tool_result",
    tool_use_id: "srvtoolu_synthetic",
    content: urls.map((url) => ({
      type: "web_search_result",
      url,
      title: "Risultato sintetico",
      encrypted_content: "synthetic",
      page_age: null,
    })),
  });
const usage = (input: number, searches = 0): PartnerAssistantUsage => ({
  inputTokens: input,
  outputTokens: 50,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 1000,
  cacheReadTokens: 0,
  webSearches: searches,
});
const answer = (
  content: Anthropic.ContentBlock[],
  usages = [usage(100)],
  stopReason: Anthropic.StopReason = "end_turn",
): ClaudeResult => ({
  ok: true,
  message: {
    id: "msg_synthetic",
    type: "message",
    role: "assistant",
    model: PARTNER_ASSISTANT_MODEL,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  } as unknown as Anthropic.Message,
  contents: content,
  usages,
});
const json = (value: unknown) => answer([text(JSON.stringify(value))]);
/** Un errore vero dell'SDK, classificato dal client vero. */
const apiFailure = (
  status: number,
  type: string,
  usages: PartnerAssistantUsage[] = [],
  detail = type,
) =>
  ({
    ok: false,
    code: classifyClaudeError(
      APIError.generate(
        status,
        { type: "error", error: { type, message: detail } },
        undefined,
        new Headers(),
      ),
    ),
    usages,
  }) as ClaudeResult;
/** Un consumo senza token di output: la richiesta non è arrivata a generare niente. */
const unpaid = (input: number): PartnerAssistantUsage => ({ ...usage(input), outputTokens: 0 });

const NEXT: Record<PartnerAssistantStep, PartnerAssistantStep> = {
  ricerca: "estrazione",
  estrazione: "scrittura",
  scrittura: "controllo",
  controllo: "controllo",
};
function setup(step: PartnerAssistantStep = "ricerca", current: PartnerAssistantContext = context) {
  const job: PartnerAssistantJob = {
    jobId: id(2),
    partnerId: id(3),
    step,
    leaseToken: id(4),
    leaseExpiresAt: new Date(Date.now() + 360_000).toISOString(),
    attempts: 0,
    rewrites: 0,
  };
  const done = {
    ok: true,
    value: { status: "done", jobStatus: "in_coda", step: NEXT[step], replayed: false },
  };
  const mocks = {
    claim: vi.fn().mockResolvedValue({ ok: true, value: { status: "claimed", job } }),
    context: vi.fn().mockResolvedValue({ ok: true, value: { status: "ok", context: current } }),
    checkpoint: vi.fn().mockResolvedValue({ ok: true, value: { status: "ok" } }),
    recordCall: vi.fn().mockResolvedValue({ ok: true, value: { status: "ok", replayed: false } }),
    completeResearch: vi.fn().mockResolvedValue(done),
    completeChoice: vi.fn().mockResolvedValue(done),
    completeDraft: vi.fn().mockResolvedValue(done),
    completeReview: vi.fn().mockResolvedValue(done),
    completeTemplate: vi.fn().mockResolvedValue(done),
    fail: vi.fn().mockResolvedValue({
      ok: true,
      value: { status: "done", jobStatus: "in_coda", attempts: 1 },
    }),
    pause: vi.fn().mockImplementation(async (reason: string) => ({
      ok: true,
      value: { status: "done", pausedReason: reason },
    })),
  };
  const store: PartnerAssistantStore = mocks;
  const call =
    vi.fn<(input: ClaudeCall, signal: AbortSignal, timeoutMs: number) => Promise<ClaudeResult>>();
  const completes = [
    mocks.completeResearch,
    mocks.completeChoice,
    mocks.completeDraft,
    mocks.completeReview,
    mocks.completeTemplate,
  ];
  return {
    job,
    lease: leaseOf(job),
    ...mocks,
    call,
    completes,
    dependencies: { store, claude: { call }, workerId: () => workerId },
  };
}
const run = (state: ReturnType<typeof setup>, extra: { now?: () => number } = {}) =>
  runPartnerAssistantStep(config, new AbortController().signal, {
    ...state.dependencies,
    ...extra,
  });
const failedWith = (state: ReturnType<typeof setup>) =>
  state.fail.mock.calls.map((c) => c.slice(0, 3));

const request = (authorization = `Bearer ${config.workerSecret}`, signal?: AbortSignal) =>
  new Request(
    "https://synthetic.test/api/integrations/partner-assistant/worker?step=controllo&partner=hostile",
    {
      method: "POST",
      headers: { authorization, cookie: "sb-access-token=private-cookie" },
      body: JSON.stringify({ job_id: "caller-controlled", phone: "+39 111 111 1111" }),
      signal,
    },
  );
afterEach(() => vi.useRealTimers());

const mailEnvironment = {
  PARTNER_MAIL_USER: "casella@luckylap.example.test",
  PARTNER_MAIL_PASSWORD: "synthetic-mail-password",
  PARTNER_TEST_TO: "prova1@example.test,prova2@example.test",
};
/** Lo store d'invio finto: solo recordEnvironment conta nella route. */
function sendSetup(environmentResult: unknown = { ok: true, value: { status: "done" } }) {
  const recordEnvironment = vi.fn(
    async (_input: unknown, _signal: AbortSignal) => environmentResult,
  );
  const unused = vi.fn(async () => ({ ok: false }));
  const store = {
    claim: unused,
    skip: unused,
    prepare: unused,
    start: unused,
    finish: unused,
    recordAppend: unused,
    pause: unused,
    release: unused,
    recordEnvironment,
  } as unknown as PartnerAssistantSendStore;
  return { recordEnvironment, sendDependencies: { store } };
}
/** Un giro completo: 202, poi il lavoro dentro after. */
async function tick(
  env: Record<string, string>,
  extra: {
    send?: ReturnType<typeof vi.fn>;
    run?: ReturnType<typeof vi.fn>;
    environmentResult?: unknown;
  } = {},
) {
  const state = setup();
  const sending = sendSetup(extra.environmentResult);
  const run = extra.run ?? vi.fn().mockResolvedValue({ status: "complete" });
  const send = extra.send ?? vi.fn().mockResolvedValue({ status: "idle" });
  const callbacks: (() => Promise<void>)[] = [];
  const response = await receivePartnerAssistantTick(
    request(),
    (callback) => {
      callbacks.push(callback);
    },
    {
      ...state.dependencies,
      environment: env,
      run: run as never,
      send: send as never,
      sendDependencies: sending.sendDependencies,
    },
  );
  for (const callback of callbacks) await callback();
  return { response, run, send, state, ...sending };
}

describe("route del worker dell'assistente Partner", () => {
  it("503 senza configurazione, 401 con bearer sbagliato, nessun claim", async () => {
    const state = setup();
    const schedule = vi.fn();
    const run = vi.fn();
    const unavailable = await receivePartnerAssistantTick(request(), schedule, {
      ...state.dependencies,
      environment: {},
      run,
    });
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("retry-after")).toBe("120");
    expect(await unavailable.json()).toEqual({ code: "worker_unavailable" });
    for (const authorization of [
      "",
      `bearer ${config.workerSecret}`,
      "Bearer wrong",
      `Bearer ${config.workerSecret}extra`,
      "x".repeat(600),
    ]) {
      const response = await receivePartnerAssistantTick(request(authorization), schedule, {
        ...state.dependencies,
        environment,
        run,
      });
      expect(response.status).toBe(401);
    }
    expect(schedule).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(state.claim).not.toHaveBeenCalled();
  });

  it("confronta solo il bearer esatto", () => {
    expect(authorizedPartnerAssistant(`Bearer ${config.workerSecret}`, config.workerSecret)).toBe(
      true,
    );
    expect(authorizedPartnerAssistant(null, config.workerSecret)).toBe(false);
    expect(authorizedPartnerAssistant("Bearer short", "short")).toBe(false);
  });

  it("202 subito; il passo gira in after e non usa il segnale della richiesta", async () => {
    const state = setup();
    const callbacks: (() => Promise<void>)[] = [];
    const schedule = vi.fn((callback: () => Promise<void>) => {
      callbacks.push(callback);
    });
    const run = vi.fn().mockResolvedValue({ status: "complete" });
    const caller = new AbortController();
    const response = await receivePartnerAssistantTick(
      request(undefined, caller.signal),
      schedule,
      {
        ...state.dependencies,
        environment,
        run,
        sendDependencies: sendSetup().sendDependencies,
      },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(schedule).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    // Il chiamante se ne va: il passo continua lo stesso.
    caller.abort();
    await callbacks[0]!();
    expect(run).toHaveBeenCalledOnce();
    const [runConfig, signal, dependencies] = run.mock.calls[0]!;
    expect(runConfig).toEqual(config);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect((signal as AbortSignal).aborted).toBe(false);
    expect(dependencies).toEqual(state.dependencies);
  });

  it("un passo che fallisce dentro after non lancia; una registrazione fallita dà 503", async () => {
    const state = setup();
    let callback!: () => Promise<void>;
    const run = vi.fn().mockRejectedValue(new Error("sb_secret_private worker failure"));
    const accepted = await receivePartnerAssistantTick(
      request(),
      (next) => {
        callback = next;
      },
      { ...state.dependencies, environment, run, ...sendSetup() },
    );
    expect(accepted.status).toBe(202);
    await expect(callback()).resolves.toBeUndefined();
    const refused = await receivePartnerAssistantTick(
      request(),
      () => {
        throw new Error("sb_secret_private platform failure");
      },
      { ...state.dependencies, environment, run },
    );
    expect(refused.status).toBe(503);
    expect(refused.headers.get("retry-after")).toBe("120");
    expect(await refused.json()).toEqual({ code: "worker_unavailable" });
  });

  it("non legge corpo né query", async () => {
    const state = setup();
    const incoming = request();
    const textSpy = vi.spyOn(incoming, "text");
    const readers = [
      vi.spyOn(incoming, "json"),
      vi.spyOn(incoming, "arrayBuffer"),
      vi.spyOn(incoming, "formData"),
      vi.spyOn(incoming, "blob"),
    ];
    const urlSpy = vi.spyOn(incoming, "url", "get");
    let callback!: () => Promise<void>;
    const run = vi.fn().mockResolvedValue({ status: "complete" });
    await receivePartnerAssistantTick(
      incoming,
      (next) => {
        callback = next;
      },
      { ...state.dependencies, environment, run, ...sendSetup() },
    );
    await callback();
    expect(textSpy).not.toHaveBeenCalled();
    for (const reader of readers) expect(reader).not.toHaveBeenCalled();
    expect(urlSpy).not.toHaveBeenCalled();
  });

  it("la risposta HTTP non contiene segreti né sb_secret", async () => {
    const state = setup();
    const responses = [
      await receivePartnerAssistantTick(request(), () => undefined, {
        ...state.dependencies,
        environment,
      }),
      await receivePartnerAssistantTick(request("Bearer wrong"), () => undefined, {
        ...state.dependencies,
        environment,
      }),
      await receivePartnerAssistantTick(request(), () => undefined, {
        ...state.dependencies,
        environment: {},
      }),
      await receivePartnerAssistantTick(
        request(),
        () => {
          throw new Error("sb_secret_private platform failure");
        },
        { ...state.dependencies, environment },
      ),
    ];
    expect(responses.map((response) => response.status)).toEqual([202, 401, 503, 503]);
    for (const response of responses) {
      const body = await response.text();
      expect(body).not.toMatch(
        /synthetic-partner-assistant-secret|sk-ant|sb_secret|000 000|example\.test|caller-controlled|private/,
      );
      for (const [name, value] of response.headers)
        expect(`${name}: ${value}`).not.toMatch(/secret|sk-ant|sb_secret|000 000/);
    }
  });
});

describe("route del worker: variabili, invio e passo con Claude", () => {
  it("recordEnvironment a ogni giro dopo il 202, anche con la posta nulla, senza valori", async () => {
    const { response, recordEnvironment, send, run } = await tick(environment);
    expect(response.status).toBe(202);
    expect(recordEnvironment).toHaveBeenCalledOnce();
    expect(recordEnvironment.mock.calls[0]![0]).toEqual({
      mailboxOk: false,
      testOk: false,
      testCount: 0,
    });
    expect(send).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
  });
  it("con la posta configurata: casella, prova e numero degli indirizzi, mai i valori", async () => {
    const { recordEnvironment } = await tick({ ...environment, ...mailEnvironment });
    const [input, signal] = recordEnvironment.mock.calls[0]! as unknown as [unknown, AbortSignal];
    expect(input).toEqual({ mailboxOk: true, testOk: true, testCount: 2 });
    expect(JSON.stringify(input)).not.toMatch(/@|synthetic|example/);
    expect(signal).toBeInstanceOf(AbortSignal);
  });
  it("niente si registra con 503 o 401", async () => {
    const unavailable = await tick({});
    expect(unavailable.response.status).toBe(503);
    const unauthorized = sendSetup();
    const send = vi.fn();
    const run = vi.fn();
    const refused = await receivePartnerAssistantTick(request("Bearer wrong"), vi.fn(), {
      ...setup().dependencies,
      environment: { ...environment, ...mailEnvironment },
      run,
      send: send as never,
      ...unauthorized,
    });
    expect(refused.status).toBe(401);
    for (const recorded of [unavailable.recordEnvironment, unauthorized.recordEnvironment])
      expect(recorded).not.toHaveBeenCalled();
    for (const fn of [unavailable.send, unavailable.run, send, run])
      expect(fn).not.toHaveBeenCalled();
  });
  it.each<[string, unknown]>([
    ["una risposta incerta", { ok: false }],
    ["un'eccezione", "throw"],
  ])("recordEnvironment con %s non ferma l'invio né il passo con Claude", async (_, result) => {
    const state = setup();
    const sending = sendSetup();
    if (result === "throw") sending.recordEnvironment.mockRejectedValue(new Error("private"));
    else sending.recordEnvironment.mockResolvedValue(result);
    const send = vi.fn().mockResolvedValue({ status: "idle" });
    const run = vi.fn().mockResolvedValue({ status: "complete" });
    let callback!: () => Promise<void>;
    await receivePartnerAssistantTick(
      request(),
      (next) => {
        callback = next;
      },
      {
        ...state.dependencies,
        environment: { ...environment, ...mailEnvironment },
        run,
        send: send as never,
        ...sending,
      },
    );
    await expect(callback()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });
  it("con la posta configurata e l'invio idle parte anche il passo con Claude, dopo l'invio", async () => {
    const order: string[] = [];
    const send = vi.fn(async () => {
      order.push("send");
      return { status: "idle" };
    });
    const run = vi.fn(async () => {
      order.push("run");
      return { status: "complete" };
    });
    const { state, sendDependencies, recordEnvironment } = await tick(
      { ...environment, ...mailEnvironment },
      { send, run },
    );
    expect(order).toEqual(["send", "run"]);
    expect(recordEnvironment).toHaveBeenCalledOnce();
    const [sendConfig, mailConfig, signal, dependencies] = send.mock.calls[0]! as unknown as [
      unknown,
      { user: string; testTo: string[] },
      AbortSignal,
      unknown,
    ];
    expect(sendConfig).toEqual(config);
    expect(mailConfig).toMatchObject({
      user: "casella@luckylap.example.test",
      testTo: ["prova1@example.test", "prova2@example.test"],
    });
    expect(signal.aborted).toBe(false);
    expect(dependencies).toMatchObject({ store: sendDependencies.store });
    expect((run.mock.calls[0] as unknown[])[2]).toEqual(state.dependencies);
  });
  it.each(["complete", "uncertain", "stopped"])(
    "con l'invio %s il passo con Claude non parte",
    async (status) => {
      const { send, run } = await tick(
        { ...environment, ...mailEnvironment },
        { send: vi.fn().mockResolvedValue({ status }) },
      );
      expect(send).toHaveBeenCalledOnce();
      expect(run).not.toHaveBeenCalled();
    },
  );
  it("un invio che lancia non fa partire il passo con Claude", async () => {
    const { send, run } = await tick(
      { ...environment, ...mailEnvironment },
      { send: vi.fn().mockRejectedValue(new Error("private")) },
    );
    expect(send).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });
  it("senza posta l'invio non si chiama e il passo con Claude sì", async () => {
    const { send, run } = await tick({ ...environment, PARTNER_MAIL_USER: "non valido" });
    expect(send).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("un passo dell'assistente Partner", () => {
  it("le costanti del brief", () => {
    expect(PARTNER_ASSISTANT_STEP_BUDGET_MS).toBe(270_000);
    expect(PARTNER_ASSISTANT_RESERVE_MS).toBe(20_000);
    expect(PARTNER_ASSISTANT_CLAUDE_TIMEOUT_MS).toBe(240_000);
    expect(PARTNER_ASSISTANT_MIN_CALL_MS).toBe(60_000);
    expect(PARTNER_ASSISTANT_LEASE_SECONDS).toBe(360);
  });

  it("niente lavoro: idle, senza contesto né Claude", async () => {
    const state = setup();
    state.claim.mockResolvedValue({ ok: true, value: { status: "idle", reason: "vuota" } });
    expect(await run(state)).toEqual({ status: "idle" });
    expect(state.claim).toHaveBeenCalledWith(
      workerId,
      PARTNER_ASSISTANT_LEASE_SECONDS,
      expect.any(AbortSignal),
    );
    expect(state.context).not.toHaveBeenCalled();
    expect(state.call).not.toHaveBeenCalled();
  });

  it("lease persa alla lettura del contesto: nessun checkpoint, nessuna chiamata", async () => {
    const state = setup();
    state.context.mockResolvedValue({ ok: true, value: { status: "lease_persa" } });
    expect(await run(state)).toEqual({ status: "complete", step: "ricerca" });
    expect(state.context).toHaveBeenCalledWith(state.lease, expect.any(AbortSignal));
    expect(state.checkpoint).not.toHaveBeenCalled();
    expect(state.call).not.toHaveBeenCalled();
    expect(state.fail).not.toHaveBeenCalled();
  });

  it("claim o contesto senza risposta certa: uncertain, senza fail", async () => {
    const first = setup();
    first.claim.mockResolvedValue({ ok: false });
    expect(await run(first)).toEqual({ status: "uncertain" });
    const second = setup();
    second.context.mockRejectedValue(new Error("sb_secret_private database failure"));
    expect(await run(second)).toEqual({ status: "uncertain", step: "ricerca" });
    expect(second.call).not.toHaveBeenCalled();
    expect(second.fail).not.toHaveBeenCalled();
  });

  it("ricerca: una sola chiamata, complete_research con testo e fonti", async () => {
    const state = setup("ricerca");
    const contents = [
      searchUse,
      searchResults(["https://club-sintetico.example.test/", "https://altro.example.test/"]),
      text("Il club ", ["https://club-sintetico.example.test/raduno"]),
      text("ha un raduno a maggio."),
    ];
    let abortedAtCall: boolean | undefined;
    state.call.mockImplementation(async (_input, signal) => {
      abortedAtCall = signal.aborted;
      return answer(contents, [usage(100, 1), usage(200)]);
    });
    expect(await run(state)).toEqual({ status: "complete", step: "ricerca" });
    expect(state.call).toHaveBeenCalledOnce();
    const [input, , timeoutMs] = state.call.mock.calls[0]!;
    expect(input).toEqual(researchCall(context));
    expect(abortedAtCall).toBe(false);
    expect(timeoutMs).toBe(PARTNER_ASSISTANT_CLAUDE_TIMEOUT_MS);
    // Il checkpoint subito prima della chiamata.
    expect(state.checkpoint).toHaveBeenCalledWith(state.lease, expect.any(AbortSignal));
    expect(state.checkpoint.mock.invocationCallOrder[0]!).toBeLessThan(
      state.call.mock.invocationCallOrder[0]!,
    );
    expect(state.completeResearch).toHaveBeenCalledOnce();
    const [lease, research, operationId] = state.completeResearch.mock.calls[0]!;
    expect(lease).toEqual(state.lease);
    expect(research).toEqual({
      text: "Il club ha un raduno a maggio.",
      sources: [
        "https://club-sintetico.example.test/raduno",
        "https://club-sintetico.example.test/",
        "https://altro.example.test/",
      ],
      model: PARTNER_ASSISTANT_MODEL,
      rulesVersion: 1,
    });
    expect(operationId).toMatch(UUID);
    // Un costo per ogni usage, ognuno con la sua ricevuta.
    expect(state.recordCall.mock.calls.map((c) => c[0])).toEqual(
      [usage(100, 1), usage(200)].map((value) => ({
        ...value,
        partnerId: state.job.partnerId,
        step: "ricerca",
        model: PARTNER_ASSISTANT_MODEL,
        costUsd: partnerAssistantCostUsd(value),
        outcome: "ok",
      })),
    );
    const operations = state.recordCall.mock.calls.map((c) => c[1]);
    expect(new Set([...operations, operationId]).size).toBe(3);
    for (const value of operations) expect(value).toMatch(UUID);
    // I costi dopo l'esito: non consumano la riserva di tempo del passo.
    expect(state.recordCall.mock.invocationCallOrder[0]!).toBeGreaterThan(
      state.completeResearch.mock.invocationCallOrder[0]!,
    );
    expect(state.fail).not.toHaveBeenCalled();
  });

  it.each<[PartnerAssistantStep, ClaudeResult]>([
    ["ricerca", answer([text("Il club ha un raduno.")], [usage(100), usage(200)])],
    ["estrazione", answer([text(JSON.stringify(extracted))], [usage(100), usage(200)])],
    [
      "scrittura",
      answer(
        [text(JSON.stringify({ subject: "Club Sintetico e LuckyLap", body: cleanBody }))],
        [usage(100), usage(200)],
      ),
    ],
    [
      "controllo",
      answer([text(JSON.stringify({ approved: true, problems: [] }))], [usage(100), usage(200)]),
    ],
  ])(
    "%s concluso: i costi si registrano dopo la complete, a esito ricevuto",
    async (step, result) => {
      const state = setup(step);
      state.call.mockResolvedValue(result);
      const recordedBeforeAnswer: number[] = [];
      for (const complete of state.completes) {
        const reply = complete.getMockImplementation();
        complete.mockImplementation(async (...args: unknown[]) => {
          recordedBeforeAnswer.push(state.recordCall.mock.calls.length);
          return reply ? reply(...args) : { ok: false };
        });
      }
      expect(await run(state)).toEqual({ status: "complete", step });
      expect(recordedBeforeAnswer).toEqual([0]);
      expect(state.recordCall).toHaveBeenCalledTimes(2);
      expect(state.recordCall.mock.calls.map((c) => c[0].outcome)).toEqual(["ok", "ok"]);
    },
  );

  it("complete senza risposta certa: i costi si registrano lo stesso, dopo", async () => {
    const state = setup("ricerca");
    state.call.mockResolvedValue(answer([text("Il club ha un raduno.")]));
    state.completeResearch.mockResolvedValue({ ok: false });
    expect(await run(state)).toEqual({ status: "uncertain", step: "ricerca" });
    expect(state.recordCall).toHaveBeenCalledOnce();
    expect(state.recordCall.mock.invocationCallOrder[0]!).toBeGreaterThan(
      state.completeResearch.mock.invocationCallOrder[0]!,
    );
  });

  it("ricerca vuota dopo la pulizia: fail riprova, niente complete_research", async () => {
    const state = setup("ricerca");
    state.call.mockResolvedValue(
      answer([searchUse, text("\u0000\u0007 \n"), searchUse, text("\t")]),
    );
    expect(await run(state)).toEqual({ status: "complete", step: "ricerca" });
    expect(state.completeResearch).not.toHaveBeenCalled();
    expect(failedWith(state)).toEqual([[state.lease, "riprova", "risposta_non_valida"]]);
    expect(state.recordCall).toHaveBeenCalledOnce();
  });

  it("estrazione: complete_choice con request e decisione scrivi", async () => {
    const state = setup("estrazione");
    state.call.mockResolvedValue(json(extracted));
    expect(await run(state)).toEqual({ status: "complete", step: "estrazione" });
    expect(state.call.mock.calls[0]![0]).toEqual(extractCall(context));
    expect(state.completeChoice).toHaveBeenCalledOnce();
    const [lease, input, operationId] = state.completeChoice.mock.calls[0]!;
    expect(lease).toEqual(state.lease);
    expect(input).toEqual({
      choice: {
        contactKind: "evento",
        porscheCommunity: false,
        reasonIt: extracted.reason_it,
        writeNow: true,
        writeOn: "",
        recipientEmail: "",
        recipientEmailSource: "",
        recipientEmailPublishedByOrg: false,
        personName: "",
        personTitle: "",
        language: "it",
        register: "voi",
        swiss: false,
        timezone: "Europe/Rome",
        factText: extracted.fact_text,
        factDate: "2026-10-01",
        factSource: extracted.fact_source,
        eventName: "Fiera Sintetica",
        eventStartsOn: "2026-11-17",
        eventCity: "Milano",
        eventCountry: "Italia",
        eventReachable: true,
        notesIt: "",
        request: "stand_evento",
      },
      decision: { kind: "scrivi" },
      model: PARTNER_ASSISTANT_MODEL,
      rulesVersion: 1,
    });
    expect(operationId).toMatch(UUID);
  });

  it("estrazione: la decisione usa la data del contesto", async () => {
    const state = setup("estrazione", { ...context, today: "2026-09-01" });
    state.call.mockResolvedValue(json({ ...extracted, write_now: false, write_on: "2026-10-15" }));
    await run(state);
    expect(state.completeChoice.mock.calls[0]![1].decision).toEqual({
      kind: "attendi",
      writeOn: "2026-10-15",
    });
  });

  it("JSON rotto dall'estrazione: fail riprova risposta_non_valida", async () => {
    const state = setup("estrazione");
    state.call.mockResolvedValue(answer([text("{non è json")]));
    expect(await run(state)).toEqual({ status: "complete", step: "estrazione" });
    expect(state.completeChoice).not.toHaveBeenCalled();
    expect(failedWith(state)).toEqual([[state.lease, "riprova", "risposta_non_valida"]]);
    // La chiamata è costata lo stesso.
    expect(state.recordCall).toHaveBeenCalledOnce();
    expect(state.recordCall.mock.calls[0]![0]).toMatchObject({ step: "estrazione", outcome: "ok" });
  });

  it("scelta non valida dall'estrazione: fail riprova risposta_non_valida", async () => {
    const state = setup("estrazione");
    state.call.mockResolvedValue(json({ ...extracted, fact_date: "2026-09" }));
    await run(state);
    expect(state.completeChoice).not.toHaveBeenCalled();
    expect(failedWith(state)).toEqual([[state.lease, "riprova", "risposta_non_valida"]]);
  });

  // Rifiuto, risposta tagliata da max_tokens, contesto pieno: la risposta non è completa anche
  // quando ha del testo, e consuma un tentativo.
  const cutShort: Anthropic.StopReason[] = [
    "refusal",
    "max_tokens",
    "model_context_window_exceeded",
  ];

  it.each(cutShort)(
    "ricerca interrotta (%s) con del testo: fail riprova, niente complete_research",
    async (stopReason) => {
      const state = setup("ricerca");
      state.call.mockResolvedValue(
        answer(
          [
            searchUse,
            searchResults(["https://club-sintetico.example.test/"]),
            text("Il club ha un raduno a", ["https://club-sintetico.example.test/raduno"]),
          ],
          [usage(100, 1)],
          stopReason,
        ),
      );
      expect(await run(state)).toEqual({ status: "complete", step: "ricerca" });
      expect(state.call).toHaveBeenCalledOnce();
      expect(state.completeResearch).not.toHaveBeenCalled();
      expect(failedWith(state)).toEqual([[state.lease, "riprova", "risposta_non_valida"]]);
      // La chiamata è costata lo stesso, ricerche web comprese.
      expect(state.recordCall).toHaveBeenCalledOnce();
      expect(state.recordCall.mock.calls[0]![0]).toMatchObject({
        step: "ricerca",
        webSearches: 1,
        outcome: "ok",
      });
      expect(state.recordCall.mock.invocationCallOrder[0]!).toBeLessThan(
        state.fail.mock.invocationCallOrder[0]!,
      );
    },
  );

  it.each(
    cutShort.flatMap((stopReason): [PartnerAssistantStep, Anthropic.StopReason, unknown][] => [
      ["estrazione", stopReason, extracted],
      ["scrittura", stopReason, { subject: "Club Sintetico e LuckyLap", body: cleanBody }],
      ["controllo", stopReason, { approved: true, problems: [] }],
    ]),
  )(
    "%s interrotta (%s) con un JSON valido: fail riprova, nessuna complete",
    async (step, stopReason, value) => {
      const state = setup(step);
      state.call.mockResolvedValue(answer([text(JSON.stringify(value))], undefined, stopReason));
      expect(await run(state)).toEqual({ status: "complete", step });
      for (const complete of state.completes) expect(complete).not.toHaveBeenCalled();
      expect(failedWith(state)).toEqual([[state.lease, "riprova", "risposta_non_valida"]]);
      expect(state.recordCall).toHaveBeenCalledOnce();
    },
  );

  it("lo stesso JSON con end_turn conclude il passo", async () => {
    for (const [step, value] of [
      ["estrazione", extracted],
      ["scrittura", { subject: "Club Sintetico e LuckyLap", body: cleanBody }],
      ["controllo", { approved: true, problems: [] }],
    ] as [PartnerAssistantStep, unknown][]) {
      const state = setup(step);
      state.call.mockResolvedValue(answer([text(JSON.stringify(value))], undefined, "end_turn"));
      expect(await run(state)).toEqual({ status: "complete", step });
      expect(state.fail).not.toHaveBeenCalled();
    }
  });

  it("checkpoint non_idoneo: nessuna chiamata, fail rilascia", async () => {
    const state = setup("ricerca");
    state.checkpoint.mockResolvedValue({
      ok: true,
      value: { status: "stop", reason: "non_idoneo" },
    });
    expect(await run(state)).toEqual({ status: "complete", step: "ricerca" });
    expect(state.call).not.toHaveBeenCalled();
    expect(state.recordCall).not.toHaveBeenCalled();
    expect(failedWith(state)).toEqual([[state.lease, "rilascia", "non_idoneo"]]);
  });

  it.each(["spento", "pausa", "attesa", "lease_persa"])(
    "checkpoint %s: nessuna chiamata, fail rilascia con il motivo",
    async (reason) => {
      const state = setup("scrittura");
      state.checkpoint.mockResolvedValue({ ok: true, value: { status: "stop", reason } });
      await run(state);
      expect(state.call).not.toHaveBeenCalled();
      expect(failedWith(state)).toEqual([[state.lease, "rilascia", reason]]);
    },
  );

  it("contatto senza più email e non idoneo: si rilascia, nessun tentativo consumato", async () => {
    const state = setup("scrittura", { ...context, email: null });
    state.checkpoint.mockResolvedValue({
      ok: true,
      value: { status: "stop", reason: "non_idoneo" },
    });
    await run(state);
    expect(state.call).not.toHaveBeenCalled();
    expect(failedWith(state)).toEqual([[state.lease, "rilascia", "non_idoneo"]]);
  });

  it("checkpoint senza risposta certa: uncertain, nessuna chiamata né fail", async () => {
    const state = setup("ricerca");
    state.checkpoint.mockResolvedValue({ ok: false });
    expect(await run(state)).toEqual({ status: "uncertain", step: "ricerca" });
    expect(state.call).not.toHaveBeenCalled();
    expect(state.fail).not.toHaveBeenCalled();
  });

  it("tempo insufficiente: fail rilascia senza chiamare Claude", async () => {
    const state = setup("ricerca");
    let time = 0;
    // Il contesto arriva quando al budget mancano 79.999 ms: la chiamata avrebbe 59.999 ms.
    state.context.mockImplementation(async () => {
      time = PARTNER_ASSISTANT_STEP_BUDGET_MS - 79_999;
      return { ok: true, value: { status: "ok", context } };
    });
    expect(await run(state, { now: () => time })).toEqual({ status: "complete", step: "ricerca" });
    expect(state.call).not.toHaveBeenCalled();
    expect(failedWith(state)).toEqual([[state.lease, "rilascia", "tempo_insufficiente"]]);
  });

  it("con 80 secondi rimasti la chiamata parte, con 60 secondi di timeout", async () => {
    const state = setup("ricerca");
    let time = 0;
    state.context.mockImplementation(async () => {
      time = PARTNER_ASSISTANT_STEP_BUDGET_MS - 80_000;
      return { ok: true, value: { status: "ok", context } };
    });
    state.call.mockResolvedValue(answer([text("Il club ha un raduno.")]));
    await run(state, { now: () => time });
    expect(state.call.mock.calls[0]![2]).toBe(PARTNER_ASSISTANT_MIN_CALL_MS);
    expect(state.fail).not.toHaveBeenCalled();
  });

  it("timeout: il minimo tra 240 secondi e il tempo rimasto meno la riserva", async () => {
    const state = setup("ricerca");
    let time = 0;
    state.context.mockImplementation(async () => {
      time = 15_000;
      return { ok: true, value: { status: "ok", context } };
    });
    state.call.mockResolvedValue(answer([text("Il club ha un raduno.")]));
    await run(state, { now: () => time });
    expect(state.call.mock.calls[0]![2]).toBe(270_000 - 15_000 - 20_000);
  });

  it("402 a metà ricerca: pause credito, usage registrato, nessun fail", async () => {
    const state = setup("ricerca");
    state.call.mockResolvedValue(apiFailure(402, "billing_error", [usage(300, 2)]));
    expect(await run(state)).toEqual({ status: "paused", step: "ricerca" });
    expect(state.pause).toHaveBeenCalledWith("credito", expect.any(AbortSignal));
    expect(state.recordCall).toHaveBeenCalledOnce();
    expect(state.recordCall.mock.calls[0]![0]).toEqual({
      ...usage(300, 2),
      partnerId: state.job.partnerId,
      step: "ricerca",
      model: PARTNER_ASSISTANT_MODEL,
      costUsd: partnerAssistantCostUsd(usage(300, 2)),
      outcome: "credito",
    });
    expect(state.fail).not.toHaveBeenCalled();
    expect(state.completeResearch).not.toHaveBeenCalled();
    // Negli errori i costi prima della pausa.
    expect(state.recordCall.mock.invocationCallOrder[0]!).toBeLessThan(
      state.pause.mock.invocationCallOrder[0]!,
    );
  });

  it("401: pause errore_claude", async () => {
    const state = setup("scrittura");
    state.call.mockResolvedValue(apiFailure(401, "authentication_error"));
    expect(await run(state)).toEqual({ status: "paused", step: "scrittura" });
    expect(state.pause).toHaveBeenCalledWith("errore_claude", expect.any(AbortSignal));
    expect(state.fail).not.toHaveBeenCalled();
    expect(state.recordCall).not.toHaveBeenCalled();
  });

  it("pausa senza risposta certa: uncertain", async () => {
    const state = setup("ricerca");
    state.call.mockResolvedValue(apiFailure(402, "billing_error"));
    state.pause.mockResolvedValue({ ok: false });
    expect(await run(state)).toEqual({ status: "uncertain", step: "ricerca" });
    expect(state.fail).not.toHaveBeenCalled();
  });

  it("529 senza consumo pagato: fail attesa", async () => {
    const state = setup("controllo");
    state.call.mockResolvedValue(apiFailure(529, "overloaded_error", [unpaid(50)]));
    expect(await run(state)).toEqual({ status: "complete", step: "controllo" });
    expect(failedWith(state)).toEqual([[state.lease, "attesa", "claude_attesa"]]);
    expect(state.pause).not.toHaveBeenCalled();
    expect(state.recordCall.mock.calls[0]![0]).toMatchObject({ outcome: "attesa" });
  });

  it("attesa senza nessun consumo: fail attesa, nessun tentativo", async () => {
    const state = setup("ricerca");
    state.call.mockResolvedValue(apiFailure(529, "overloaded_error"));
    await run(state);
    expect(failedWith(state)).toEqual([[state.lease, "attesa", "claude_attesa"]]);
    expect(state.recordCall).not.toHaveBeenCalled();
  });

  // Un contatto non può spendere all'infinito: dopo consumo pagato l'attesa consuma un tentativo.
  it.each<[string, PartnerAssistantUsage[]]>([
    ["token di output già generati", [usage(300, 2)]],
    ["una continuazione", [unpaid(100), unpaid(200)]],
  ])("attesa dopo consumo pagato (%s): fail riprova", async (_, usages) => {
    const state = setup("ricerca");
    state.call.mockResolvedValue({ ok: false, code: "attesa", usages });
    expect(await run(state)).toEqual({ status: "complete", step: "ricerca" });
    expect(failedWith(state)).toEqual([[state.lease, "riprova", "claude_attesa"]]);
    expect(state.pause).not.toHaveBeenCalled();
    expect(state.recordCall).toHaveBeenCalledTimes(usages.length);
    expect(state.recordCall.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      state.fail.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    [404, "not_found_error", "model: claude-sintetico"],
    [400, "invalid_request_error", "web fetch is not enabled"],
  ])(
    "%i di configurazione (%s): pause errore_claude, nessun tentativo",
    async (status, type, detail) => {
      const state = setup("ricerca");
      state.call.mockResolvedValue(apiFailure(status, type, [], detail));
      expect(await run(state)).toEqual({ status: "paused", step: "ricerca" });
      expect(state.pause).toHaveBeenCalledWith("errore_claude", expect.any(AbortSignal));
      expect(state.fail).not.toHaveBeenCalled();
    },
  );

  it.each<[string, ClaudeResult, string]>([
    [
      "troppe_continuazioni",
      { ok: false, code: "troppe_continuazioni", usages: [usage(1), usage(2)] },
      "troppe_continuazioni",
    ],
    [
      "400 non riconosciuto (fallito)",
      apiFailure(400, "invalid_request_error"),
      "risposta_non_valida",
    ],
  ])("%s: fail riprova %s", async (_, result, reason) => {
    const state = setup("ricerca");
    state.call.mockResolvedValue(result);
    await run(state);
    expect(failedWith(state)).toEqual([[state.lease, "riprova", reason]]);
    expect(state.recordCall).toHaveBeenCalledTimes(result.usages.length);
    expect(state.pause).not.toHaveBeenCalled();
  });

  it("una chiamata a Claude che lancia: fail riprova risposta_non_valida", async () => {
    const state = setup("ricerca");
    state.call.mockRejectedValue(new Error("sk-ant private failure"));
    expect(await run(state)).toEqual({ status: "complete", step: "ricerca" });
    expect(failedWith(state)).toEqual([[state.lease, "riprova", "risposta_non_valida"]]);
  });

  it("timeout del nostro timer con fake timers: fail riprova timeout", async () => {
    vi.useFakeTimers();
    const state = setup("ricerca");
    // Come il client vero: allo scadere di timeoutMs l'esito è timeout, con l'usage parziale.
    state.call.mockImplementation(
      (_input, _signal, timeoutMs) =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ ok: false, code: "timeout", usages: [usage(300, 1)] }),
            timeoutMs,
          ),
        ),
    );
    let settled = false;
    const pending = run(state).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(PARTNER_ASSISTANT_CLAUDE_TIMEOUT_MS - 1);
    expect(state.call).toHaveBeenCalledOnce();
    expect(state.call.mock.calls[0]![2]).toBe(PARTNER_ASSISTANT_CLAUDE_TIMEOUT_MS);
    expect(settled).toBe(false);
    expect(state.fail).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    // Il budget del passo non era scaduto: restava la riserva per registrare costo ed esito.
    expect(await pending).toEqual({ status: "complete", step: "ricerca" });
    expect(failedWith(state)).toEqual([[state.lease, "riprova", "timeout"]]);
    expect(state.recordCall.mock.calls[0]![0]).toMatchObject({
      webSearches: 1,
      outcome: "timeout",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("il budget del passo ferma un Claude che non si ferma da solo: uncertain, senza fail", async () => {
    vi.useFakeTimers();
    const state = setup("ricerca");
    state.call.mockImplementation(
      (_input, signal) =>
        new Promise((resolve) =>
          signal.addEventListener("abort", () =>
            resolve({ ok: false, code: "timeout", usages: [] }),
          ),
        ),
    );
    const pending = run(state);
    await vi.advanceTimersByTimeAsync(PARTNER_ASSISTANT_STEP_BUDGET_MS);
    expect(await pending).toEqual({ status: "uncertain", step: "ricerca" });
    expect(state.fail).not.toHaveBeenCalled();
  });

  it("bozza con conto vendita: complete_draft con checks_ok false e parola_vietata", async () => {
    const state = setup("scrittura");
    const body = cleanBody.replace(
      "Vi andrebbe di parlarne?",
      "Proponiamo il conto vendita. Vi andrebbe di parlarne?",
    );
    state.call.mockResolvedValue(json({ subject: "Club Sintetico e LuckyLap", body }));
    expect(await run(state)).toEqual({ status: "complete", step: "scrittura" });
    expect(state.completeDraft).toHaveBeenCalledOnce();
    const [lease, input] = state.completeDraft.mock.calls[0]!;
    expect(lease).toEqual(state.lease);
    expect(input.checksOk).toBe(false);
    expect(input.failures).toContain("parola_vietata");
    expect(input.draft.body).toBe(body);
    expect(state.fail).not.toHaveBeenCalled();
  });

  it("la firma ha il telefono della configurazione", async () => {
    const state = setup("scrittura");
    const subject = "Club Sintetico e LuckyLap";
    state.call.mockResolvedValue(json({ subject, body: cleanBody }));
    await run(state);
    const [, input, operationId] = state.completeDraft.mock.calls[0]!;
    const expectedSignature = [
      "Tommaso",
      "Fondatore, LuckyLap",
      "+39 000 000 0000",
      "https://luckylap.com | Instagram @lucky.lap",
    ].join("\n");
    expect(input).toEqual({
      draft: {
        language: "it",
        subject,
        body: cleanBody,
        signature: expectedSignature,
        sha256: partnerAssistantDraftSha256({
          subject,
          body: cleanBody,
          signature: expectedSignature,
        }),
        rulesVersion: 1,
        partnerVersion: 3,
        contactId: id(5),
      },
      checksOk: true,
      failures: [],
    });
    expect(operationId).toMatch(UUID);
    // Il numero non arriva mai a Claude.
    expect(JSON.stringify(state.call.mock.calls[0]![0])).not.toContain("000 000");
  });

  it("nome del contatto e dell'evento con un modello: i controlli passano", async () => {
    const porsche: PartnerAssistantContext = {
      ...context,
      partner: { ...context.partner, name: "Porsche 356 Club Sintetico" },
      choice: {
        noteId: id(7),
        content: {
          ...club,
          porscheCommunity: true,
          eventName: "Raduno 911 Sintetico",
          decision: { kind: "scrivi" },
        },
      },
    };
    const subject = "Porsche 356 Club Sintetico e LuckyLap";
    const body = cleanBody.replace(
      "Vi andrebbe di parlarne?",
      "Ci vediamo al Raduno 911 Sintetico. Vi andrebbe di parlarne?",
    );
    const named = setup("scrittura", porsche);
    named.call.mockResolvedValue(json({ subject, body }));
    await run(named);
    expect(named.completeDraft.mock.calls[0]![1]).toMatchObject({ checksOk: true, failures: [] });
    // Un modello fuori dai nomi resta vietato.
    const model = setup("scrittura", porsche);
    model.call.mockResolvedValue(
      json({ subject, body: body.replace("Ci vediamo", "La 993. Ci vediamo") }),
    );
    await run(model);
    expect(model.completeDraft.mock.calls[0]![1]).toMatchObject({
      checksOk: false,
      failures: ["modello_porsche"],
    });
  });

  it.each([
    ["a capo", "Club Sintetico\ne LuckyLap"],
    ["ritorno a capo", "Club Sintetico\re LuckyLap"],
  ])("oggetto con un %s: bozza salvata con il controllo oggetto", async (_, subject) => {
    const state = setup("scrittura");
    state.call.mockResolvedValue(json({ subject, body: cleanBody }));
    expect(await run(state)).toEqual({ status: "complete", step: "scrittura" });
    expect(state.completeDraft.mock.calls[0]![1]).toMatchObject({
      checksOk: false,
      failures: ["oggetto"],
    });
    expect(state.fail).not.toHaveBeenCalled();
  });

  it("scrittura e controllo usano la data del contesto", async () => {
    const event: PartnerAssistantChoice = {
      ...club,
      contactKind: "evento",
      eventName: "Fiera Sintetica",
      eventStartsOn: "2026-11-17",
      eventCity: "Milano",
      eventCountry: "Italia",
      eventReachable: true,
      request: "stand_evento",
    };
    // Al 1° settembre mancano più di 31 giorni: la riga dice di proporre la maglietta.
    const current = {
      ...context,
      today: "2026-09-01",
      choice: { noteId: id(7), content: { ...event, decision: { kind: "scrivi" as const } } },
    };
    const writer = setup("scrittura", current);
    writer.call.mockResolvedValue(json({ subject: "Fiera Sintetica e LuckyLap", body: cleanBody }));
    await run(writer);
    const written = writer.call.mock.calls[0]![0];
    expect(written).toEqual(writeCall(current, "2026-09-01"));
    expect(JSON.stringify(written)).toContain("Maglietta co-firmata: puoi proporla");
    const reviewer = setup("controllo", current);
    reviewer.call.mockResolvedValue(json({ approved: true, problems: [] }));
    await run(reviewer);
    expect(reviewer.call.mock.calls[0]![0]).toEqual(reviewCall(current));
    expect(JSON.stringify(reviewer.call.mock.calls[0]![0])).toContain(
      "Maglietta co-firmata: puoi proporla",
    );
  });

  it("bozza con recapito cambiato: contesto_cambiato, nessun fail", async () => {
    const state = setup("scrittura");
    state.call.mockResolvedValue(json({ subject: "Club Sintetico e LuckyLap", body: cleanBody }));
    state.completeDraft.mockResolvedValue({ ok: true, value: { status: "contesto_cambiato" } });
    expect(await run(state)).toEqual({ status: "complete", step: "scrittura" });
    expect(state.fail).not.toHaveBeenCalled();
  });

  it("controllo con regole cambiate: review non approvata, nessuna chiamata", async () => {
    const state = setup("controllo", { ...context, rules: { version: 2, body: "Regole v2." } });
    expect(await run(state)).toEqual({ status: "complete", step: "controllo" });
    expect(state.call).not.toHaveBeenCalled();
    expect(state.recordCall).not.toHaveBeenCalled();
    expect(state.completeReview).toHaveBeenCalledOnce();
    const [lease, input, operationId] = state.completeReview.mock.calls[0]!;
    expect(lease).toEqual(state.lease);
    expect(input).toEqual({
      approved: false,
      problems: ["regole_superate"],
      sha256: savedDraft.sha256,
      model: null,
      rulesVersion: 2,
    });
    expect(operationId).toMatch(UUID);
    expect(state.fail).not.toHaveBeenCalled();
  });

  it("controllo approvato con l'impronta della bozza", async () => {
    const state = setup("controllo");
    state.call.mockResolvedValue(json({ approved: true, problems: [] }));
    expect(await run(state)).toEqual({ status: "complete", step: "controllo" });
    expect(state.call.mock.calls[0]![0]).toEqual(reviewCall(context));
    expect(state.completeReview.mock.calls[0]![1]).toEqual({
      approved: true,
      problems: [],
      sha256: savedDraft.sha256,
      model: PARTNER_ASSISTANT_MODEL,
      rulesVersion: 1,
    });
  });

  it.each([
    ["solo regole_superate", ["regole_superate"]],
    ["regole_superate tra altri problemi", ["La domanda è doppia.", "regole_superate"]],
  ])("controllo con %s dal modello: fail riprova risposta_non_valida", async (_, problems) => {
    const state = setup("controllo");
    state.call.mockResolvedValue(json({ approved: false, problems }));
    expect(await run(state)).toEqual({ status: "complete", step: "controllo" });
    expect(state.completeReview).not.toHaveBeenCalled();
    expect(failedWith(state)).toEqual([[state.lease, "riprova", "risposta_non_valida"]]);
  });

  it("controllo approvato ma con problemi: si salva non approvato", async () => {
    const state = setup("controllo");
    const problems = ["Il complimento cita un fatto di due anni fa."];
    state.call.mockResolvedValue(json({ approved: true, problems }));
    expect(await run(state)).toEqual({ status: "complete", step: "controllo" });
    expect(state.completeReview.mock.calls[0]![1]).toMatchObject({ approved: false, problems });
    expect(state.fail).not.toHaveBeenCalled();
  });

  it("un problema con un ritorno a capo si salva com'è, come lo accetta il database", async () => {
    const state = setup("controllo");
    const problems = ["La domanda è doppia.\r\nManca il vantaggio."];
    state.call.mockResolvedValue(json({ approved: false, problems }));
    await run(state);
    expect(state.completeReview.mock.calls[0]![1]).toMatchObject({ approved: false, problems });
  });

  it("controllo non approvato: i problemi passano com'erano", async () => {
    const state = setup("controllo");
    const problems = ["La domanda è doppia.", "Manca il vantaggio per loro."];
    state.call.mockResolvedValue(json({ approved: false, problems }));
    await run(state);
    expect(state.completeReview.mock.calls[0]![1]).toMatchObject({ approved: false, problems });
  });

  it.each<[string, PartnerAssistantStep, unknown]>([
    ["oggetto di 301 caratteri", "scrittura", { subject: "a".repeat(301), body: cleanBody }],
    ["corpo di 8001 caratteri", "scrittura", { subject: "Oggetto", body: "a".repeat(8001) }],
    ["oggetto vuoto", "scrittura", { subject: "", body: cleanBody }],
    ["oggetto di soli spazi", "scrittura", { subject: "   ", body: cleanBody }],
    [
      "corpo con un carattere di controllo",
      "scrittura",
      { subject: "Oggetto", body: "Ciao\u0007" },
    ],
    ["corpo con un ritorno a capo", "scrittura", { subject: "Oggetto", body: "Ciao,\r\nfine" }],
    ["corpo con un surrogato spezzato", "scrittura", { subject: "Oggetto", body: "Ciao \ud800" }],
    ["corpo mancante", "scrittura", { subject: "Oggetto" }],
    ["corpo non testo", "scrittura", { subject: "Oggetto", body: 12 }],
    [
      "21 problemi",
      "controllo",
      { approved: false, problems: Array.from({ length: 21 }, () => "Problema.") },
    ],
    ["un problema vuoto", "controllo", { approved: false, problems: [""] }],
    [
      "un problema di 1001 caratteri",
      "controllo",
      { approved: false, problems: ["a".repeat(1001)] },
    ],
    [
      "un problema con un carattere di controllo",
      "controllo",
      { approved: false, problems: ["a\u0001"] },
    ],
    ["approved non booleano", "controllo", { approved: "true", problems: [] }],
    ["problems non lista", "controllo", { approved: false, problems: "Problema." }],
  ])("%s: fail riprova risposta_non_valida, senza complete", async (_, step, value) => {
    const state = setup(step);
    state.call.mockResolvedValue(json(value));
    await run(state);
    expect(state.completeDraft).not.toHaveBeenCalled();
    expect(state.completeReview).not.toHaveBeenCalled();
    expect(failedWith(state)).toEqual([[state.lease, "riprova", "risposta_non_valida"]]);
  });

  it("ai limiti del database la bozza e la lettura passano", async () => {
    const writer = setup("scrittura");
    const subject = "€".repeat(300);
    const body = `Ciao,\n\t${"a".repeat(7988)}\nfine`;
    expect([...body].length).toBe(8000);
    writer.call.mockResolvedValue(json({ subject, body }));
    await run(writer);
    expect(writer.completeDraft.mock.calls[0]![1].draft).toMatchObject({ subject, body });
    const reviewer = setup("controllo");
    const problems = Array.from({ length: 20 }, () => "€".repeat(1000));
    reviewer.call.mockResolvedValue(json({ approved: false, problems }));
    await run(reviewer);
    expect(reviewer.completeReview.mock.calls[0]![1].problems).toEqual(problems);
    expect(writer.fail).not.toHaveBeenCalled();
    expect(reviewer.fail).not.toHaveBeenCalled();
  });

  it.each<[string, PartnerAssistantStep, Partial<PartnerAssistantContext>]>([
    ["estrazione senza ricerca", "estrazione", { research: null }],
    ["scrittura senza scelta", "scrittura", { choice: null }],
    ["scrittura senza ricerca", "scrittura", { research: null }],
    ["scrittura senza email", "scrittura", { email: null }],
    ["controllo senza bozza", "controllo", { draft: null }],
    ["controllo senza scelta", "controllo", { choice: null }],
  ])("%s: fail riprova risposta_non_valida, senza chiamare Claude", async (_, step, missing) => {
    const state = setup(step, { ...context, ...missing });
    expect(await run(state)).toEqual({ status: "complete", step });
    expect(state.call).not.toHaveBeenCalled();
    for (const complete of state.completes) expect(complete).not.toHaveBeenCalled();
    expect(failedWith(state)).toEqual([[state.lease, "riprova", "risposta_non_valida"]]);
  });

  // Solo i dati mancanti sono previsti; ogni altra eccezione è un errore nel codice.
  it("eccezione inattesa nei costruttori: uncertain, lavoro intatto, log senza testi", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const broken: PartnerAssistantContext = {
        ...context,
        partner: {
          ...context.partner,
          research: { nota: "Appunto riservato sintetico", valore: BigInt(1) },
        },
      };
      const state = setup("ricerca", broken);
      expect(await run(state)).toEqual({ status: "uncertain", step: "ricerca" });
      expect(state.call).not.toHaveBeenCalled();
      expect(state.fail).not.toHaveBeenCalled();
      for (const complete of state.completes) expect(complete).not.toHaveBeenCalled();
      expect(state.pause).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledOnce();
      const logged = JSON.stringify(error.mock.calls[0]);
      expect(logged).toContain("ricerca");
      expect(logged).not.toMatch(/Appunto|riservato|BigInt|serialize/);
    } finally {
      error.mockRestore();
    }
  });

  it("eccezione inattesa leggendo la risposta: uncertain, costi registrati, nessun fail", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const state = setup("ricerca");
      state.call.mockResolvedValue(
        answer([block({ type: "text", text: "Testo riservato sintetico", citations: 5 })]),
      );
      expect(await run(state)).toEqual({ status: "uncertain", step: "ricerca" });
      expect(state.completeResearch).not.toHaveBeenCalled();
      expect(state.fail).not.toHaveBeenCalled();
      expect(state.recordCall).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledOnce();
      expect(JSON.stringify(error.mock.calls[0])).not.toMatch(/riservato|iterable|citations/);
    } finally {
      error.mockRestore();
    }
  });

  it("ricerca con un surrogato isolato: a complete_research arriva il testo ricodificato", async () => {
    const state = setup("ricerca");
    const broken = "Il club \ud800 ha un raduno.";
    state.call.mockResolvedValue(answer([text(broken)]));
    expect(await run(state)).toEqual({ status: "complete", step: "ricerca" });
    const saved = state.completeResearch.mock.calls[0]![1].text;
    expect(saved).not.toBe(broken);
    expect(saved.isWellFormed()).toBe(true);
    expect(saved).toBe("Il club \ufffd ha un raduno.");
  });

  it.each<[PartnerAssistantStep, ClaudeResult]>([
    ["ricerca", answer([text("Il club ha un raduno.")])],
    ["estrazione", json(extracted)],
    ["scrittura", json({ subject: "Club Sintetico e LuckyLap", body: cleanBody })],
    ["controllo", json({ approved: true, problems: [] })],
  ])("complete ambiguo (%s): uncertain, nessun fail", async (step, result) => {
    const state = setup(step);
    state.call.mockResolvedValue(result);
    for (const complete of state.completes) complete.mockResolvedValue({ ok: false });
    expect(await run(state)).toEqual({ status: "uncertain", step });
    expect(state.completes.filter((complete) => complete.mock.calls.length)).toHaveLength(1);
    expect(state.fail).not.toHaveBeenCalled();
  });

  it.each(["lease_persa", "non_idoneo"])(
    "complete con %s: esito certo, nessun fail",
    async (status) => {
      const state = setup("ricerca");
      state.call.mockResolvedValue(answer([text("Il club ha un raduno.")]));
      state.completeResearch.mockResolvedValue({ ok: true, value: { status } });
      expect(await run(state)).toEqual({ status: "complete", step: "ricerca" });
      expect(state.fail).not.toHaveBeenCalled();
    },
  );

  it("fail senza risposta certa: uncertain", async () => {
    const state = setup("ricerca");
    state.call.mockResolvedValue(apiFailure(529, "overloaded_error"));
    state.fail.mockResolvedValue({ ok: false });
    expect(await run(state)).toEqual({ status: "uncertain", step: "ricerca" });
  });

  it("un costo non registrato non ferma il passo", async () => {
    const state = setup("ricerca");
    state.call.mockResolvedValue(answer([text("Il club ha un raduno.")]));
    state.recordCall.mockResolvedValue({ ok: false });
    expect(await run(state)).toEqual({ status: "complete", step: "ricerca" });
    expect(state.completeResearch).toHaveBeenCalledOnce();
  });

  // Un database vero risponde dopo un po': il passo non chiude il suo segnale prima della risposta.
  it.each<[string, (state: ReturnType<typeof setup>) => void, string]>([
    ["complete", () => undefined, "complete"],
    [
      "fail",
      (state) =>
        state.checkpoint.mockResolvedValue({
          ok: true,
          value: { status: "stop", reason: "pausa" },
        }),
      "complete",
    ],
    ["pause", (state) => state.call.mockResolvedValue(apiFailure(402, "billing_error")), "paused"],
  ])("aspetta la risposta di %s prima di chiudere il passo", async (_, arrange, status) => {
    const state = setup("ricerca");
    state.call.mockResolvedValue(answer([text("Il club ha un raduno.")]));
    arrange(state);
    const later = (method: (typeof state)["fail"]) => {
      const reply = method.getMockImplementation()!;
      method.mockImplementation(async (...args: unknown[]) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return reply(...args);
      });
    };
    for (const method of [state.completeResearch, state.fail, state.pause]) later(method);
    expect(await run(state)).toEqual({ status, step: "ricerca" });
  });

  it("un chiamante disconnesso ferma il passo senza fail né complete", async () => {
    const state = setup("ricerca");
    const parent = new AbortController();
    state.call.mockImplementation(async () => {
      parent.abort();
      return answer([text("Il club ha un raduno.")]);
    });
    expect(await runPartnerAssistantStep(config, parent.signal, state.dependencies)).toEqual({
      status: "uncertain",
      step: "ricerca",
    });
    expect(state.completeResearch).not.toHaveBeenCalled();
    expect(state.fail).not.toHaveBeenCalled();
  });
});

describe("modalità modello per i club", () => {
  const clubContext = (
    partner: Partial<PartnerAssistantContext["partner"]> = {},
    rest: Partial<PartnerAssistantContext> = {},
  ): PartnerAssistantContext => ({
    ...context,
    partner: {
      ...context.partner,
      name: "Porsche Club Sintetico (PCS)",
      city: "Stoccarda",
      country: "Germania",
      typeLabel: "Porsche Club",
      sections: ["club"],
      research: { lang: "tedesco (Sie)" },
      ...partner,
    },
    research: null,
    choice: null,
    draft: null,
    ...rest,
  });

  it("un club alla ricerca: niente Claude, bozza dal testo fisso salvata con scelta e fuso", async () => {
    const state = setup("ricerca", clubContext());
    expect(await run(state)).toEqual({ status: "complete", step: "ricerca" });
    expect(state.call).not.toHaveBeenCalled();
    expect(state.recordCall).not.toHaveBeenCalled();
    expect(state.completeResearch).not.toHaveBeenCalled();
    expect(state.completeDraft).not.toHaveBeenCalled();
    expect(state.completeTemplate).toHaveBeenCalledTimes(1);
    const [lease, input, operationId] = state.completeTemplate.mock.calls[0];
    expect(lease).toEqual(state.lease);
    expect(operationId).toMatch(UUID);
    expect(input).toMatchObject({
      templateVersion: 2,
      register: "sie",
      timezone: "Europe/Berlin",
      porscheCommunity: true,
      swiss: false,
      checksOk: true,
      failures: [],
    });
    expect(input.draft.language).toBe("de");
    expect(input.draft.subject).toBe("T-Shirts für die Mitglieder des Porsche Club Sintetico");
    expect(input.draft.body).toContain("mit dem Porsche Club Sintetico umsetzen");
    expect(input.draft.body).not.toContain("(PCS)");
    expect(input.draft.body).toContain(
      "In unserer Kollektion haben wir bereits den 964 und den GT3 RS",
    );
    expect(input.draft.body).toContain("freundliche Grüße");
    expect(input.draft.signature.split("\n")).toEqual([
      "Tommaso Ieri",
      "Gründer, LuckyLap",
      environment.PARTNER_ASSISTANT_PHONE,
      "https://luckylap.com | Instagram @lucky.lap",
    ]);
    expect(input.draft.sha256).toBe(partnerAssistantDraftSha256(input.draft));
    expect(input.draft).toMatchObject({ rulesVersion: 1, partnerVersion: 3, contactId: id(5) });
  });

  it("ogni passo prima del controllo ricompone la bozza, senza Claude", async () => {
    for (const step of ["estrazione", "scrittura"] as const) {
      const state = setup(step, clubContext());
      await run(state);
      expect(state.call).not.toHaveBeenCalled();
      expect(state.completeTemplate).toHaveBeenCalledTimes(1);
    }
  });

  it("in Svizzera il tedesco è senza «ß»", async () => {
    const state = setup("ricerca", clubContext({ country: "Svizzera", city: "Zurigo" }));
    await run(state);
    const [, input] = state.completeTemplate.mock.calls[0];
    expect(input).toMatchObject({ swiss: true, timezone: "Europe/Zurich" });
    expect(input.draft.body).toContain("freundliche Grüsse");
    expect(input.draft.body).not.toContain("ß");
  });

  it("paese senza fuso nell'elenco: a Tommi con fuso_mancante, niente salvato", async () => {
    const state = setup("ricerca", clubContext({ country: "Atlantide" }));
    await run(state);
    expect(state.completeTemplate).not.toHaveBeenCalled();
    expect(failedWith(state)).toEqual([[state.lease, "blocca", "fuso_mancante"]]);
  });

  it("club senza email: risposta non valida, come per la scrittura", async () => {
    const state = setup("ricerca", clubContext({}, { email: null }));
    await run(state);
    expect(state.completeTemplate).not.toHaveBeenCalled();
    expect(failedWith(state)).toEqual([[state.lease, "riprova", "risposta_non_valida"]]);
  });

  it("checkpoint fermo: la bozza non si compone", async () => {
    const state = setup("ricerca", clubContext());
    state.checkpoint.mockResolvedValue({ ok: true, value: { status: "stop", reason: "spento" } });
    await run(state);
    expect(state.completeTemplate).not.toHaveBeenCalled();
    expect(failedWith(state)).toEqual([[state.lease, "rilascia", "spento"]]);
  });

  it("un nome con un dominio non ferma i controlli: è un dato del club", async () => {
    const state = setup(
      "ricerca",
      clubContext({ name: "Pagodentreff.de", typeLabel: "Club Mercedes-Benz" }),
    );
    await run(state);
    const [, input] = state.completeTemplate.mock.calls[0];
    expect(input).toMatchObject({ checksOk: true, porscheCommunity: false });
  });

  /** Il lavoro al controllo con le note del modello e la bozza com'è oggi il testo per i club. */
  const atReview = (partner: Partial<PartnerAssistantContext["partner"]> = {}, body?: string) => {
    const base = clubContext(partner);
    const composed = composePartnerAssistantTemplate(
      base.partner,
      environment.PARTNER_ASSISTANT_PHONE,
    )!;
    const text = { ...composed, body: body ?? composed.body };
    return clubContext(partner, {
      research: {
        noteId: id(6),
        text: "Nessuna ricerca: bozza dal testo fisso per i club approvato da Tommaso (versione 1).",
        sources: [],
        createdAt: "2026-11-01T09:00:00+00:00",
      },
      choice: {
        noteId: id(7),
        content: {
          ...club,
          reasonIt: "Testo fisso per i club, versione 1, approvato da Tommaso.",
          language: composed.language,
          register: composed.register,
          decision: { kind: "scrivi" },
        },
      },
      draft: {
        ...savedDraft,
        language: composed.language,
        subject: text.subject,
        body: text.body,
        signature: text.signature,
        sha256: partnerAssistantDraftSha256(text),
      },
    });
  };

  it("controllo di una bozza del modello: la seconda lettura per i club, senza ricerca", async () => {
    const current = atReview();
    const state = setup("controllo", current);
    state.call.mockResolvedValue(json({ approved: true, problems: [] }));
    await run(state);
    expect(state.call).toHaveBeenCalledTimes(1);
    const [input] = state.call.mock.calls[0];
    expect(input.system).toBe(context.rules.body);
    expect(input.effort).toBe("medium");
    expect(JSON.stringify(input.messages)).toContain("testo fisso per i club");
    expect(JSON.stringify(input.messages)).not.toContain("<ricerca>");
    expect(state.completeReview).toHaveBeenCalledTimes(1);
    expect(state.completeReview.mock.calls[0][1]).toMatchObject({
      approved: true,
      sha256: current.draft!.sha256,
    });
    expect(state.completeTemplate).not.toHaveBeenCalled();
  });

  it("bozza del modello con un testo che non è più quello in vigore: torna indietro senza Claude", async () => {
    const current = atReview({}, "Sehr geehrte Damen und Herren,\nTesto di prima.\nGrüße");
    const state = setup("controllo", current);
    await run(state);
    expect(state.call).not.toHaveBeenCalled();
    expect(state.completeReview.mock.calls[0][1]).toEqual({
      approved: false,
      problems: ["regole_superate"],
      sha256: current.draft!.sha256,
      model: null,
      rulesVersion: 1,
    });
  });

  it("note del modello su un contatto tolto dalla sezione Club: al controllo la lettura normale", async () => {
    const current = atReview();
    const state = setup("controllo", {
      ...current,
      partner: { ...current.partner, sections: ["collab"] },
    });
    state.call.mockResolvedValue(json({ approved: false, problems: ["Manca un fatto vero."] }));
    await run(state);
    const [input] = state.call.mock.calls[0];
    expect(input.effort).toBe("high");
    expect(JSON.stringify(input.messages)).not.toContain("non l'ha scritta un modello");
  });

  it("note del modello su un contatto che non usa più il modello: Claude non scrive sopra", async () => {
    for (const sections of [["collab"], ["eventi", "club"]] as const) {
      const current = atReview();
      const state = setup("scrittura", {
        ...current,
        partner: { ...current.partner, sections: [...sections] },
      });
      await run(state);
      expect(state.call).not.toHaveBeenCalled();
      expect(state.completeTemplate).not.toHaveBeenCalled();
      expect(failedWith(state)).toEqual([[state.lease, "rilascia", "contesto_cambiato"]]);
    }
  });

  it("un club che è anche un evento resta sul percorso con Claude", async () => {
    const state = setup("ricerca", clubContext({ sections: ["eventi", "collab", "club"] }));
    state.call.mockResolvedValue(answer([text("Ricerca sintetica.")]));
    await run(state);
    expect(state.call).toHaveBeenCalledTimes(1);
    expect(state.completeTemplate).not.toHaveBeenCalled();
  });

  it("un club della rete Scuderia Ferrari Club passa a Tommi, senza bozza", async () => {
    const state = setup(
      "ricerca",
      clubContext({ name: "Scuderia Ferrari Club Madrid", typeLabel: "Fan club Ferrari" }),
    );
    await run(state);
    expect(state.call).not.toHaveBeenCalled();
    expect(state.completeTemplate).not.toHaveBeenCalled();
    expect(failedWith(state)).toEqual([[state.lease, "blocca", "rete_scuderia_ferrari"]]);
  });

  it("un contatto che non è nella sezione Club resta sul percorso con Claude", async () => {
    const state = setup("ricerca", clubContext({ sections: ["collab"] }));
    state.call.mockResolvedValue(answer([text("Ricerca sintetica.")]));
    await run(state);
    expect(state.call).toHaveBeenCalledTimes(1);
    expect(state.completeTemplate).not.toHaveBeenCalled();
  });
});
